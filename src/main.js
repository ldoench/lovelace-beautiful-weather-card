import { LitElement, html, nothing } from 'lit';
import { Chart, registerables } from 'chart.js';
import {
  CARD_VERSION,
  DEFAULT_CONFIG,
  HEADER_EXTRA_ENTITY_ATTRIBUTES,
  HEADER_EXTRA_FORECAST_ATTRIBUTES,
  HEADER_EXTRAS_MAX,
  WeatherEntityFeature,
  conditionIcon,
} from './const.js';
import { localize } from './locale.js';
import { computeMeteogramData } from './meteogram/data.js';
import { buildMeteogramChartConfig } from './meteogram/chart.js';
import { fetchMeasuredHours, mergeMeasured } from './meteogram/history.js';
import { MAX_STRIP_DAYS, alignDayStrip, fitDayCount, renderDayStrip } from './day-strip.js';
import { cardStyles } from './styles.js';
import './card-editor.js';

Chart.register(...registerables);

const DAY_MS = 24 * 60 * 60 * 1000;

// The band under the day chart mirrors the overview, scaled down to a fraction
// of the day chart's own configured height.
const BAND_HEIGHT_RATIO = 0.2;

// Default icon per header_extras attribute, used when a config entry does not
// set its own `icon`. A custom `entity` slot prefers that entity's own icon
// over this map — see _headerExtraSlot.
const HEADER_EXTRA_DEFAULT_ICONS = {
  precipitation_probability: 'mdi:umbrella',
  humidity: 'mdi:water-percent',
  wind_speed: 'mdi:weather-windy',
  pressure: 'mdi:gauge',
  apparent_temperature: 'mdi:thermometer',
};
const HEADER_EXTRA_FALLBACK_ICON = 'mdi:information-outline';

// Whole calendar days between today and `date`, both taken in local time — which
// is exactly what sliceForecast()'s `day_offset` counts.
function dayOffsetFrom(date, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((to - from) / DAY_MS);
}

// Index of the entry whose hour is the current one. Entries are hourly and in
// order, so at most one can match; falls back to the first entry if none does.
function nowIndex(entries, now = new Date()) {
  const index = entries.findIndex((entry) => {
    const dt = new Date(entry.datetime);
    return dt.getFullYear() === now.getFullYear()
      && dt.getMonth() === now.getMonth()
      && dt.getDate() === now.getDate()
      && dt.getHours() === now.getHours();
  });
  return index === -1 ? 0 : index;
}

// Whether the chart needs rebuilding rather than just redrawing. Hovering
// changes only which index is highlighted, not the shape of the data — a
// signature that ignores hover state lets _renderChart tell the two apart and
// keep the chart alive under the mouse for the second case.
function chartSignature(mode, dayOffset, visibleDays, entries) {
  const first = entries.length ? entries[0].datetime : '';
  const last = entries.length ? entries[entries.length - 1].datetime : '';
  return [mode, dayOffset, visibleDays, entries.length, first, last].join('|');
}

// Copies the plot-area rectangle of a chart canvas (as reported by
// buildMeteogramChartConfig's onLayout, in CSS pixels) into a same-content
// offscreen canvas, in device pixels — the canvas backing store is
// devicePixelRatio-scaled, so the source rectangle has to be too. Returns
// null instead of throwing on anything that would leave a swipe with nothing
// to show: a not-yet-painted canvas, a zero-size rectangle, drawImage
// rejecting the source for any reason.
function capturePlotBitmap(canvas, rect) {
  if (!canvas || !rect) {
    return null;
  }

  const dpr = window.devicePixelRatio || 1;
  const width = Math.round((rect.right - rect.left) * dpr);
  const height = Math.round((rect.bottom - rect.top) * dpr);
  if (width <= 0 || height <= 0) {
    return null;
  }

  const bitmap = document.createElement('canvas');
  bitmap.width = width;
  bitmap.height = height;

  try {
    const ctx = bitmap.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.drawImage(
      canvas,
      Math.round(rect.left * dpr), Math.round(rect.top * dpr), width, height,
      0, 0, width, height,
    );
  } catch (err) {
    return null;
  }

  return bitmap;
}

// Sizes a captured bitmap for display at its original CSS size inside
// .chart-swipe-track: the canvas's own width/height attributes are device
// pixels (see capturePlotBitmap), so the visible size has to be set
// separately via style — the same relationship the live chart canvas has
// between its attribute size and its responsive CSS size.
function styleBitmapCanvas(bitmap, cssWidth, cssHeight) {
  bitmap.style.display = 'block';
  bitmap.style.flex = 'none';
  bitmap.style.width = `${cssWidth}px`;
  bitmap.style.height = `${cssHeight}px`;
  return bitmap;
}

class BeautifulWeatherCard extends LitElement {
  static get properties() {
    return {
      _config: { state: true },
      _forecasts: { state: true },
      _weather: { state: true },
      _mode: { state: true },
      _measured: { state: true },
      _hoverIndex: { state: true },
      _dayOffset: { state: true },
      _visibleDays: { state: true },
      _stripHeight: { state: true },
      _bandHeight: { state: true },
    };
  }

  static get styles() {
    return cardStyles;
  }

  constructor() {
    super();
    this._forecasts = null;
    this._measured = [];
    this._hoverIndex = null;
    this._dayOffset = 0;
    this._visibleDays = MAX_STRIP_DAYS;
    this._stripHeight = 0;
    this._bandHeight = 0;
    // Full plot-area rectangle of the day chart, in CSS pixels, as last
    // reported by buildMeteogramChartConfig's onLayout — kept around so a
    // day-nav swipe knows what to freeze into a bitmap before it rebuilds the
    // chart. Not reactive state: it never drives a render on its own.
    this._lastLayout = null;
    this._chart = null;
    this._chartSignature = null;
    this._bandChart = null;
    this._bandChartSignature = null;
    this._forecastUnsub = null;
    this._subscribedEntity = null;
    this._resizeObserver = null;
    // Set by _switchView right before it mutates state for a navigation-driven
    // rebuild, consumed once by _renderChart to turn off Chart.js's own entrance
    // animation for that one rebuild — see buildMeteogramChartConfig's `animate`.
    this._navRebuildPending = false;
    // True for the whole exit+enter duration of a _switchView transition, so a
    // fast double click on the day-nav arrows (or a tap on the trend chart) is
    // ignored instead of stacking a second transition on top of the first.
    this._transitioning = false;
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error('Please define an entity in the card config');
    }

    if (!config.entity.startsWith('weather.')) {
      throw new Error('The entity must be a weather entity');
    }

    this._config = { ...DEFAULT_CONFIG, ...config };
    this._mode = this._config.chart_mode === 'today' ? 'today' : 'trend';
  }

  set hass(hass) {
    this._hass = hass;
    this._language = this._config && this._config.locale ? this._config.locale : hass.language;
    this._weather = hass.states[this._config.entity] || null;

    if (this._weather && this._subscribedEntity !== this._config.entity) {
      this._subscribeForecast();
    }
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._hass && this._weather && !this._forecastUnsub) {
      this._subscribeForecast();
    }
    this._observeWidth();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeForecast();

    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }

    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }

    if (this._bandChart) {
      this._bandChart.destroy();
      this._bandChart = null;
    }
  }

  // The day strip does not scroll, so the card width decides how many days it can
  // show — and the chart below has to cover exactly those days. Observed on the
  // host rather than the ha-card: it is display:block with no margin, so its width
  // is the card width, and unlike the ha-card it exists before the first render.
  _observeWidth() {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (entry) {
          this._updateVisibleDays(entry.contentRect.width);
        }
      });
    }

    this._resizeObserver.observe(this);
  }

  _updateVisibleDays(width) {
    const days = fitDayCount(width, MAX_STRIP_DAYS);
    if (days !== this._visibleDays) {
      this._visibleDays = days;
    }
  }

  // Days the overview actually covers: what the card is wide enough for, never
  // more than the strip's seven and never more than the configured `trend_days`.
  _trendDays() {
    const configured = Number(this._config.trend_days) > 0
      ? Math.trunc(this._config.trend_days)
      : MAX_STRIP_DAYS;

    return Math.max(1, Math.min(configured, MAX_STRIP_DAYS, this._visibleDays));
  }

  _supportsHourly() {
    const features = this._weather && this._weather.attributes.supported_features;
    return ((features || 0) & WeatherEntityFeature.FORECAST_HOURLY) !== 0;
  }

  _unsubscribeForecast() {
    if (this._forecastUnsub) {
      this._forecastUnsub.then((unsub) => unsub()).catch(() => undefined);
      this._forecastUnsub = null;
    }
    this._subscribedEntity = null;
  }

  _subscribeForecast() {
    this._unsubscribeForecast();

    if (!this._supportsHourly()) {
      return;
    }

    this._subscribedEntity = this._config.entity;
    this._forecastUnsub = this._hass.connection.subscribeMessage(
      (event) => {
        this._forecasts = event.forecast || [];
        this._hoverIndex = null;
        this._loadMeasured();
      },
      {
        type: 'weather/subscribe_forecast',
        forecast_type: 'hourly',
        entity_id: this._config.entity,
      },
    );
  }

  _ll(path, vars) {
    return localize(this._language, path, vars);
  }

  // Both views start at midnight of their first day, so both need the recorded
  // hours: the day view for today's morning, the overview for the same hours at
  // the left edge of the week.
  async _loadMeasured() {
    if (!this._hass || !this._config.history) {
      return;
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    this._measured = await fetchMeasuredHours(this._hass, this._config.history, start, now);
  }

  // Recorded hours only exist for today, so they are merged in whenever today is
  // part of the window — always in the overview, in the day view only at offset 0.
  _source() {
    if (!this._forecasts || !this._forecasts.length) {
      return null;
    }

    const showsToday = this._mode === 'trend' || this._dayOffset === 0;

    return showsToday
      ? mergeMeasured(this._measured || [], this._forecasts)
      : this._forecasts;
  }

  _data() {
    const source = this._source();
    if (!source) {
      return null;
    }

    return computeMeteogramData(source, this._mode, {
      trend_days: this._trendDays(),
      trend_bucket_hours: this._config.trend_bucket_hours,
      temperature_gradient: this._config.temperature_gradient,
      precip_bands: this._config.precip_bands,
      round_temp: this._config.round_temp,
      day_offset: this._mode === 'today' ? this._dayOffset : 0,
    });
  }

  // Days for the day strip, independent of the currently displayed mode/offset —
  // the strip always spans the same midnight-to-midnight window regardless of
  // which day happens to be open in the day view. Unlike _source(), this always
  // merges in the measured hours: they only exist for today, but today is
  // always part of the strip's window, no matter which day is currently shown.
  _stripDays() {
    if (!this._forecasts || !this._forecasts.length) {
      return [];
    }

    const source = mergeMeasured(this._measured || [], this._forecasts);
    const data = computeMeteogramData(source, 'trend', {
      trend_days: this._trendDays(),
      precip_bands: this._config.precip_bands,
    });

    return data.days;
  }

  // Same shape as the overview mode's own data, independent of the day view
  // currently open — used for the compact band under the day chart, which
  // always shows the whole week regardless of which day is selected.
  _trendData() {
    if (!this._forecasts || !this._forecasts.length) {
      return null;
    }

    const source = mergeMeasured(this._measured || [], this._forecasts);
    return computeMeteogramData(source, 'trend', {
      trend_days: this._trendDays(),
      trend_bucket_hours: this._config.trend_bucket_hours,
      temperature_gradient: this._config.temperature_gradient,
      precip_bands: this._config.precip_bands,
      round_temp: this._config.round_temp,
    });
  }

  updated(changed) {
    super.updated(changed);
    this._renderChart();
    this._renderBandChart();
    this._measureStripHeight();
    this._measureBandHeight();
  }

  // The day strip's real, current height — not a guessed constant, since its
  // content (wrapped labels, icon-only tiles at narrow widths) varies with
  // theme, font and card width. Absent (day view, disabled, or no data), it
  // measures 0, which render() reads as "give the chart the full height back".
  // Cached and only reassigned on an actual change so a stable measurement
  // does not keep re-triggering updates.
  _measureStripHeight() {
    const strip = this.renderRoot && this.renderRoot.querySelector('.day-strip');
    const height = strip ? strip.getBoundingClientRect().height : 0;

    if (height !== this._stripHeight) {
      this._stripHeight = height;
    }
  }

  // Mirror of _measureStripHeight for the band under the day chart: its target
  // height is itself computed from chart_height (see render()), but measured
  // rather than assumed so the deduction below always matches what actually
  // got laid out.
  _measureBandHeight() {
    const band = this.renderRoot && this.renderRoot.querySelector('.band-wrap');
    const height = band ? band.getBoundingClientRect().height : 0;

    if (height !== this._bandHeight) {
      this._bandHeight = height;
    }
  }

  _renderChart() {
    const canvas = this.renderRoot && this.renderRoot.querySelector('#chart');
    const data = this._data();

    if (!canvas || !data) {
      return;
    }

    const signature = chartSignature(this._mode, this._dayOffset, this._visibleDays, data.entries);

    // Hovering re-renders the card (to move the detail row), which would
    // otherwise destroy and rebuild the chart out from under the mouse on
    // every mouse move. Rebuild only when the data actually changed.
    if (this._chart && signature === this._chartSignature) {
      return;
    }

    // Consumed once per rebuild: true only for the rebuild that _switchView
    // triggered by mutating state, false for every other rebuild (initial load,
    // a fresh forecast arriving, a resize changing the visible day count) —
    // those keep the ordinary fade-in.
    const animate = !this._navRebuildPending;
    this._navRebuildPending = false;

    if (this._chart) {
      this._chart.destroy();
    }

    const config = buildMeteogramChartConfig({
      data,
      mode: this._mode,
      cardConfig: this._config,
      language: this._language,
      localize: (path, vars) => this._ll(path, vars),
      onSelect: (index) => this._onSelect(index, this._data()),
      // Chart.js knows where the plot area starts only after it has measured its
      // axes; the day strip is padded to those edges from there, and the area
      // itself is kept for the next day-nav swipe (see _slideSwitch).
      onLayout: (area) => this._onChartLayout(area),
      onHover: (index) => this._onHover(index),
      getActiveIndex: () => this._activeIndex(),
      animate,
    });

    this._chart = new Chart(canvas.getContext('2d'), config);
    this._chartSignature = signature;
  }

  // The compact overview band under the day chart — a second Chart.js
  // instance, alive only in mode 'today'. A click anywhere on it (handled by
  // the wrapping element in render(), not by the chart itself) returns to the
  // full overview; picking a specific day happens there or via the day-nav
  // arrows, not in the band.
  _renderBandChart() {
    const canvas = this.renderRoot && this.renderRoot.querySelector('#band-chart');

    if (!canvas || this._mode !== 'today') {
      if (this._bandChart) {
        this._bandChart.destroy();
        this._bandChart = null;
        this._bandChartSignature = null;
      }
      return;
    }

    const data = this._trendData();
    if (!data) {
      return;
    }

    // Reuses chartSignature with a distinct mode tag: the band's data does not
    // depend on dayOffset (it always covers the whole week), but activeDay —
    // baked into the chart config at construction, not a live getter — does,
    // so a day-nav step still has to rebuild. Hovering in the day chart above
    // does not touch dayOffset, so it leaves this signature, and therefore
    // this chart, untouched.
    const signature = chartSignature('band', this._dayOffset, this._visibleDays, data.entries);
    if (this._bandChart && signature === this._bandChartSignature) {
      return;
    }

    if (this._bandChart) {
      this._bandChart.destroy();
    }

    const config = buildMeteogramChartConfig({
      data,
      mode: 'trend',
      cardConfig: this._config,
      language: this._language,
      localize: (path, vars) => this._ll(path, vars),
      compact: true,
      activeDay: this._dayOffset,
    });

    this._bandChart = new Chart(canvas.getContext('2d'), config);
    this._bandChartSignature = signature;
  }

  _alignDayStrip(area) {
    const strip = this.renderRoot && this.renderRoot.querySelector('.day-strip');
    alignDayStrip(strip, area);
  }

  _onChartLayout(area) {
    this._lastLayout = area;
    this._alignDayStrip(area);
  }

  // Index the detail row (and the chart's crosshair) shows: a hover overrides
  // everything until the pointer leaves the chart; failing that, the current
  // hour when today's day view is open, otherwise the day's first entry.
  _displayIndex(data) {
    if (this._hoverIndex != null) {
      return this._hoverIndex;
    }
    return this._dayOffset === 0 ? nowIndex(data.entries) : 0;
  }

  // Only the day view has a detail row to line the crosshair up with; the
  // overview gets no crosshair at all.
  _activeIndex() {
    if (this._mode !== 'today') {
      return null;
    }

    const data = this._data();
    return data ? this._displayIndex(data) : null;
  }

  // Hover only matters in the day view (that is where the detail row and
  // crosshair live) — ignored in the overview so pointer movement there does
  // not cause a re-render for nothing.
  _onHover(index) {
    if (this._mode !== 'today' || index === this._hoverIndex) {
      return;
    }

    this._hoverIndex = index;
    if (this._chart) {
      this._chart.draw();
    }
  }

  // The trend chart doubles as the day picker: a tap on a day's area opens that
  // day. In the day view a tap no longer does anything — hover already drives
  // the read-out there.
  _onSelect(index, data) {
    if (this._mode !== 'trend') {
      return;
    }

    const entry = data && data.entries[index];
    if (!entry) {
      return;
    }

    this._selectDay(dayOffsetFrom(new Date(entry.datetime)));
  }

  // Last calendar day the forecast still reaches into. The day arrows stop here
  // instead of scrolling into empty charts.
  _maxDayOffset() {
    if (!this._forecasts || !this._forecasts.length) {
      return 0;
    }

    const last = this._forecasts[this._forecasts.length - 1];
    return Math.max(0, dayOffsetFrom(new Date(last.datetime)));
  }

  // Switches to the day view for one specific day, from a day-strip tile, a tap
  // in the trend chart or a day arrow. Measured (recorder) history only applies
  // to the current calendar day.
  _selectDay(offset) {
    const target = Math.min(Math.max(offset, 0), this._maxDayOffset());

    // Already there — day-nav's edge buttons are disabled at the boundary, but a
    // tap that resolves to the day already open (e.g. the same day-strip tile)
    // should not restart a transition into itself.
    if (this._mode === 'today' && target === this._dayOffset) {
      return;
    }

    // From the day view, one day steps to its neighbour: swipe the plot area,
    // direction from the sign of the change. From the overview (a day-strip
    // tile or a tap in the trend chart), this opens a day view: a plain
    // crossfade, same as _showOverview's way back.
    const transition = this._mode === 'today'
      ? { type: 'slide', direction: Math.sign(target - this._dayOffset) }
      : { type: 'fade' };

    this._switchView(transition, () => {
      this._mode = 'today';
      this._dayOffset = target;
      this._hoverIndex = null;

      // `_measured` always holds today's recorded hours; whether they belong in
      // the current window is decided in _source(). Refreshed here so a day view
      // opened hours after the card loaded is not missing the hours in between.
      this._loadMeasured();
    });
  }

  _showOverview() {
    if (this._mode === 'trend') {
      return;
    }

    this._switchView({ type: 'fade' }, () => {
      this._mode = 'trend';
      this._dayOffset = 0;
      this._hoverIndex = null;
      this._loadMeasured();
    });
  }

  // Encapsulates every mode/day switch: plays a transition, then applies the
  // state change that actually swaps the data — which _renderChart picks up
  // as a rebuild and, via _navRebuildPending, builds without Chart.js's own
  // entrance animation so the two transitions don't fight each other. Two
  // very different transitions share this entry point: a day-to-day step
  // within the day view swipes the plot bitmap (_slideSwitch), any switch
  // between overview and day view is a plain crossfade (_fadeSwitch).
  //
  // Ignored while a previous switch is still animating, so a fast double
  // click cannot stack transitions or leave the chart mid-way. Falls back to
  // applying the state immediately — no transition — when the user prefers
  // reduced motion; the two switch methods have their own further fallbacks
  // for when the DOM/layout they each need is not there.
  _switchView(transition, applyState) {
    if (this._transitioning) {
      return;
    }

    if (this._prefersReducedMotion()) {
      applyState();
      return;
    }

    if (transition.type === 'slide') {
      this._slideSwitch(transition.direction, applyState);
      return;
    }

    this._fadeSwitch(applyState);
  }

  // Day-to-day navigation within the day view. Freezes the current plot area
  // (axes/labels excluded — they live outside the rectangle onLayout reports
  // and are left alone) as a bitmap, rebuilds the chart hidden behind an
  // opaque mask so the rebuild itself is never visible, freezes the result as
  // a second bitmap, then slides both across each other inside the mask.
  // Once the swipe finishes the mask is removed outright — the live canvas
  // underneath already shows the new day, so there is nothing left to swap.
  //
  // Falls back to applying the state with no animation at all — no mask ever
  // created, or one created and then torn down — the moment any step can't
  // deliver something to show: no known plot rectangle yet, the canvas not
  // actually painted, drawImage rejecting the source.
  async _slideSwitch(direction, applyState) {
    const canvas = this.renderRoot && this.renderRoot.querySelector('#chart');
    const chartWrap = this.renderRoot && this.renderRoot.querySelector('.chart-wrap');
    const rect = this._lastLayout;
    const oldBitmap = capturePlotBitmap(canvas, rect);

    if (!chartWrap || !oldBitmap) {
      applyState();
      return;
    }

    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;

    const mask = document.createElement('div');
    mask.className = 'chart-swipe-mask';
    mask.style.left = `${rect.left}px`;
    mask.style.top = `${rect.top}px`;
    mask.style.width = `${width}px`;
    mask.style.height = `${height}px`;

    const track = document.createElement('div');
    track.className = 'chart-swipe-track';
    track.style.transition = 'none';
    track.appendChild(styleBitmapCanvas(oldBitmap, width, height));
    mask.appendChild(track);
    chartWrap.appendChild(mask);

    this._transitioning = true;
    this._navRebuildPending = true;

    try {
      applyState();
      await this.updateComplete;

      const newCanvas = this.renderRoot && this.renderRoot.querySelector('#chart');
      const newBitmap = capturePlotBitmap(newCanvas, this._lastLayout || rect);

      if (!newBitmap) {
        return;
      }
      styleBitmapCanvas(newBitmap, width, height);

      // Next day slides left (old exits left, new enters from the right):
      // append the new bitmap after the old one and later shift the track
      // left by one plot-width. Previous day is the mirror: insert the new
      // bitmap before the old one and start already shifted left by one
      // plot-width, so the old bitmap — now the second child — sits exactly
      // where it visually already was; shifting back to 0 then brings the
      // new bitmap into view from the left. Both insertions happen with
      // transitions off, so reordering the flex children is never itself
      // animated — only the deliberate transform change below is.
      const forward = direction >= 0;
      if (forward) {
        track.appendChild(newBitmap);
      } else {
        track.insertBefore(newBitmap, oldBitmap);
        track.style.transform = `translateX(-${width}px)`;
      }

      // Commit the "before" position, then switch transitions on and move to
      // the "after" one in a separate style write — the same reflow trick
      // _onTransitionEnd's callers have always used to keep the two states
      // from being coalesced into a no-op.
      void track.offsetWidth;
      track.style.transition = 'transform 200ms ease';
      track.style.transform = forward ? `translateX(-${width}px)` : 'translateX(0)';

      await new Promise((resolve) => this._onTransitionEnd(track, resolve));
    } finally {
      mask.remove();
      this._transitioning = false;
    }
  }

  // Mode switch (overview <-> day view): a plain opacity crossfade on the
  // whole chart-anim element, nothing else — the zoom this used to play,
  // scaled from wherever the day involved sat in the overview, is gone
  // without replacement.
  _fadeSwitch(applyState) {
    const wrap = this.renderRoot && this.renderRoot.querySelector('.chart-anim');
    if (!wrap) {
      applyState();
      return;
    }

    this._transitioning = true;
    this._navRebuildPending = true;

    this._onTransitionEnd(wrap, () => {
      // Rebuild while still fully hidden — the class stays on throughout —
      // then force a reflow before removing it, so the browser commits that
      // hidden state as the definite "before" rather than folding the
      // rebuild and the class removal into a single no-op step that skips
      // the fade-in transition entirely.
      applyState();
      void wrap.offsetWidth;
      wrap.classList.remove('chart-anim--fade-hidden');

      this._onTransitionEnd(wrap, () => {
        this._transitioning = false;
      });
    });

    wrap.classList.add('chart-anim--fade-hidden');
  }

  // `transitionend` with a timeout fallback of the same order as the CSS
  // duration, so a missed event — a property that never actually changed, a
  // style recalculation that coalesces two transitions, prefers-reduced-motion
  // disabling the transition after it was already started — cannot leave the
  // chart stuck mid-switch.
  _onTransitionEnd(el, callback) {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      el.removeEventListener('transitionend', onEnd);
      clearTimeout(timer);
      callback();
    };
    const onEnd = (event) => {
      if (event.target === el) {
        finish();
      }
    };
    el.addEventListener('transitionend', onEnd);
    const timer = setTimeout(finish, 250);
  }

  _prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // The running hour's value for a forecast-sourced header_extras attribute
  // (today only precipitation_probability) — independent of mode, the hovered
  // index or the day currently open. Reuses nowIndex (the same lookup
  // _renderDetail's "now" check relies on) rather than re-deriving "current
  // hour" a second way; its 0 fallback for "not found" is guarded against here
  // by re-checking the hour matches. Generalized from the single hardcoded
  // probability lookup this used to be so any forecast attribute can reuse it.
  _currentForecastAttribute(attribute) {
    const source = this._source();
    if (!source || !source.length) {
      return null;
    }

    const now = new Date();
    const entry = source[nowIndex(source, now)];
    if (!entry) {
      return null;
    }

    const dt = new Date(entry.datetime);
    const isCurrentHour = dt.getFullYear() === now.getFullYear()
      && dt.getMonth() === now.getMonth()
      && dt.getDate() === now.getDate()
      && dt.getHours() === now.getHours();

    return isCurrentHour ? entry[attribute] : null;
  }

  // One header_extras slot's {icon, text}, or null when the value is not
  // (yet) available — a null slot is left out of the header entirely rather
  // than rendered empty, see _renderHeader.
  _headerExtraSlot(extra) {
    if (extra.entity) {
      const state = this._hass.states[extra.entity];
      if (!state || state.state === 'unknown' || state.state === 'unavailable') {
        return null;
      }

      const unit = state.attributes.unit_of_measurement;
      const numeric = Number(state.state);
      const text = Number.isFinite(numeric)
        ? `${Math.round(numeric * 10) / 10}${unit ? ` ${unit}` : ''}`
        : `${state.state}${unit ? ` ${unit}` : ''}`;

      return {
        icon: extra.icon || state.attributes.icon || HEADER_EXTRA_FALLBACK_ICON,
        text,
      };
    }

    if (!extra.attribute) {
      return null;
    }

    const icon = extra.icon || HEADER_EXTRA_DEFAULT_ICONS[extra.attribute] || HEADER_EXTRA_FALLBACK_ICON;

    if (HEADER_EXTRA_FORECAST_ATTRIBUTES.includes(extra.attribute)) {
      const value = this._currentForecastAttribute(extra.attribute);
      return value == null ? null : { icon, text: `${Math.round(value)} %` };
    }

    if (HEADER_EXTRA_ENTITY_ATTRIBUTES.includes(extra.attribute)) {
      const attrs = this._weather.attributes;
      const raw = attrs[extra.attribute];
      if (raw == null) {
        return null;
      }

      const value = Math.round(raw);
      switch (extra.attribute) {
        case 'humidity':
          return { icon, text: `${value} %` };
        case 'wind_speed':
          return { icon, text: `${value} ${attrs.wind_speed_unit || 'km/h'}` };
        case 'pressure':
          return { icon, text: `${value} ${attrs.pressure_unit || 'hPa'}` };
        case 'apparent_temperature':
          return { icon, text: `${value}°` };
        default:
          return null;
      }
    }

    return null;
  }

  _renderHeader() {
    if (!this._config.show_current || !this._weather) {
      return nothing;
    }

    const attrs = this._weather.attributes;
    const temp = attrs.temperature;
    const name = this._config.title || attrs.friendly_name || this._config.entity;
    // Left of the temperature, in configuration order. A slot with no value
    // right now is skipped entirely — the header's height comes from the icon
    // and temperature, not from these, so nothing needs a reserved space.
    const extras = (this._config.header_extras || [])
      .slice(0, HEADER_EXTRAS_MAX)
      .map((extra) => this._headerExtraSlot(extra))
      .filter((slot) => slot != null);

    return html`
      <div class="header">
        <ha-icon class="icon" .icon=${conditionIcon(this._weather.state)}></ha-icon>
        <div class="titles">
          <div class="name">${name}</div>
          <div class="place">${this._ll(`condition.${this._weather.state}`) || this._weather.state}</div>
        </div>
        ${extras.map((slot) => html`
          <div class="header__extra">
            <ha-icon class="header__extra-icon" .icon=${slot.icon}></ha-icon>
            <span class="header__extra-value">${slot.text}</span>
          </div>
        `)}
        ${temp == null ? nothing : html`<div class="temp">${Math.round(temp)}°</div>`}
      </div>
    `;
  }

  // Only the overview shows the strip: the day view frees that height for the
  // chart instead (see render()'s height calculation).
  _renderDayStrip() {
    if (!this._config.show_day_strip || this._mode !== 'trend') {
      return nothing;
    }

    const days = this._stripDays();
    if (!days.length) {
      return nothing;
    }

    return renderDayStrip({
      days,
      // No tile is the active one while the overview is showing all of them.
      activeIndex: null,
      language: this._language,
      onSelect: (index) => this._selectDay(index),
    });
  }

  // The compact week band under the day chart — a second chart, not this
  // element's own click target list, decides which day it highlights; a click
  // anywhere on it returns to the full overview (see render()'s onClick).
  // Only present in the day view; the overview is reached from here or the
  // day-nav arrows now living in the detail row (see _renderDetail).
  _renderBand(height) {
    if (this._mode !== 'today') {
      return nothing;
    }

    return html`
      <div
        class="band-wrap"
        style="height: ${height}px"
        title=${this._ll('overview')}
        @click=${() => this._showOverview()}
      >
        <canvas id="band-chart"></canvas>
      </div>
    `;
  }

  // Day-nav arrows now live at the outer edges of the detail row rather than
  // in a row of their own below the chart — the "Overview" button they used
  // to flank is gone; the band under the chart (see _renderBand) replaces it.
  _renderDetail(data) {
    if (!this._config.show_detail_row || this._mode !== 'today' || !data) {
      return nothing;
    }

    const index = this._displayIndex(data);
    const entry = data.entries[index];

    if (!entry) {
      return nothing;
    }

    // "Jetzt"/"Now" only when the shown index actually is the current hour of
    // today's day view — a different day has no "now" to fall back to.
    const isNow = this._dayOffset === 0 && index === nowIndex(data.entries);
    const time = new Date(entry.datetime).toLocaleTimeString(this._language, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const precip = entry.precipitation == null ? 0 : entry.precipitation;
    const probability = entry.precipitation_probability == null
      ? '–'
      : `${Math.round(entry.precipitation_probability)} %`;
    const wind = entry.wind_speed == null
      ? '–'
      : `${Math.round(entry.wind_speed)} km/h`;

    // The day currently shown, not the hovered hour — so it stays put while
    // hovering moves the time/value columns next to it.
    const dayDate = new Date(data.entries[0].datetime);
    const dayLabel = dayDate.toLocaleDateString(this._language, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
    const max = this._maxDayOffset();

    // Every slot is always rendered — a missing value becomes "–" rather than
    // disappearing — inside a fixed-column grid (see .detail in styles.js), so
    // hovering across hours never reflows or resizes the row, and neither do
    // the arrows changing between enabled/disabled at the range's edges.
    return html`
      <div class="detail">
        <button
          type="button"
          class="detail__nav"
          title=${this._ll('previousDay')}
          aria-label=${this._ll('previousDay')}
          ?disabled=${this._dayOffset <= 0}
          @click=${() => this._selectDay(this._dayOffset - 1)}
        ><ha-icon .icon=${'mdi:chevron-left'}></ha-icon></button>
        <span class="detail__date">
          <span class="detail__weekday">${dayLabel}</span>
          <span class="detail__time">${isNow ? this._ll('now') : time}</span>
        </span>
        <span class="detail__item" title=${this._ll('temperature')}>
          <ha-icon class="detail__icon" .icon=${'mdi:thermometer'}></ha-icon>
          <span class="detail__value">${entry.temperature}°</span>
        </span>
        <span class="detail__item" title=${this._ll('precipitation')}>
          <ha-icon class="detail__icon" .icon=${'mdi:weather-pouring'}></ha-icon>
          <span class="detail__value">${precip.toFixed(1)} mm</span>
        </span>
        <span class="detail__item" title=${this._ll('probability')}>
          <ha-icon class="detail__icon" .icon=${'mdi:umbrella'}></ha-icon>
          <span class="detail__value">${probability}</span>
        </span>
        <span class="detail__item" title=${this._ll('wind')}>
          <ha-icon class="detail__icon" .icon=${'mdi:weather-windy'}></ha-icon>
          <span class="detail__value">${wind}</span>
        </span>
        <button
          type="button"
          class="detail__nav"
          title=${this._ll('nextDay')}
          aria-label=${this._ll('nextDay')}
          ?disabled=${this._dayOffset >= max}
          @click=${() => this._selectDay(this._dayOffset + 1)}
        ><ha-icon .icon=${'mdi:chevron-right'}></ha-icon></button>
      </div>
    `;
  }

  render() {
    if (!this._config || !this._hass) {
      return nothing;
    }

    if (!this._weather) {
      return html`<ha-card><div class="message">Entity ${this._config.entity} not found.</div></ha-card>`;
    }

    if (!this._supportsHourly()) {
      return html`<ha-card>${this._renderHeader()}<div class="message">${this._ll('noForecast')}</div></ha-card>`;
    }

    const data = this._data();
    // Two extra elements share the same height budget as the chart, one per
    // mode: the day strip (overview only) and the band (day view only). Each
    // one's own real, measured height is what gets deducted here — a guessed
    // constant would drift the moment its content (a wrapped label, the
    // band's rounded target height) changes. Whichever mode is not active has
    // its measurement pinned at 0 since its element does not exist to measure.
    const reservedHeight = this._mode === 'trend' ? this._stripHeight : this._bandHeight;
    const chartHeight = reservedHeight > 0
      ? Math.max(0, this._config.chart_height - reservedHeight)
      : this._config.chart_height;
    // Target, not measured: the band's own height request, a fifth of the day
    // chart's budget. _measureBandHeight() reads back what this actually laid
    // out to feed the deduction above.
    const bandHeight = Math.round(this._config.chart_height * BAND_HEIGHT_RATIO);

    return html`
      <ha-card>
        ${this._renderHeader()}
        ${this._renderDayStrip()}
        ${this._renderDetail(data)}
        <div
          class="chart-wrap ${this._mode === 'trend' ? 'chart-wrap--clickable' : ''}"
          style="height: ${chartHeight}px"
        >
          <div class="chart-anim">
            <canvas id="chart"></canvas>
          </div>
        </div>
        ${this._renderBand(bandHeight)}
      </ha-card>
    `;
  }

  getCardSize() {
    return 5;
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass.states).find((id) => id.startsWith('weather.'));
    return { entity: entity || 'weather.home' };
  }

  static getConfigElement() {
    return document.createElement('beautiful-weather-card-editor');
  }
}

customElements.define('beautiful-weather-card', BeautifulWeatherCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'beautiful-weather-card',
  name: 'Beautiful Weather Card',
  description: 'DWD-inspired meteogram: colour-coded temperature curve over stacked precipitation bars',
  preview: true,
});

/* eslint-disable no-console */
console.info(`%c BEAUTIFUL-WEATHER-CARD %c ${CARD_VERSION} `,
  'color: white; background: #0097be; font-weight: 700;',
  'color: #0097be; background: white; font-weight: 700;');
