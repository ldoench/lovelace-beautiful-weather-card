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
import { buildMeteogramChartConfig, nextTempRange } from './meteogram/chart.js';
import { fetchMeasuredHours, mergeMeasured } from './meteogram/history.js';
import { MAX_STRIP_DAYS, alignDayStrip, fitDayCount, renderDayStrip } from './day-strip.js';
import { alignHourStrip, renderHourStrip, renderPctRow } from './hour-strip.js';
import { cardStyles } from './styles.js';
import './card-editor.js';

Chart.register(...registerables);

const DAY_MS = 24 * 60 * 60 * 1000;

// The band under the day chart mirrors the overview, scaled down to a fraction
// of the day chart's own configured height. Lowered from 0.2 after real-data
// feedback that the day chart itself reads too flat — what this gives up goes
// straight to the chart, since chartHeight is chart_height minus every other
// block's measured height (see render()).
const BAND_HEIGHT_RATIO = 0.14;

// Mirrors TEMP_AXIS_MIN_SPAN.today in meteogram/chart.js, which is not
// exported — nextTempRange() needs a minimum span to fall back on the same
// way buildMeteogramChartConfig itself would if left to pick its own default,
// so this is kept in sync with that constant by hand. Lowered from 15 after
// real-data feedback that the day view's temperature swing read too flat.
const DAY_TEMP_MIN_SPAN = 10;

// How many calendar days into the past the day view can page, when history
// sensors are configured — the past-facing counterpart to how far the
// forecast reaches forward (see _maxDayOffset). Without `history:` there is
// no source for a day before today at all, so _minDayOffset() falls back to
// 0 regardless of this constant.
const MAX_HISTORY_DAYS = 7;

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
      _headerHeight: { state: true },
      _stripHeight: { state: true },
      _dayNavHeight: { state: true },
      _hourStripHeight: { state: true },
      _pctRowHeight: { state: true },
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
    this._headerHeight = 0;
    this._stripHeight = 0;
    this._dayNavHeight = 0;
    this._hourStripHeight = 0;
    this._pctRowHeight = 0;
    this._bandHeight = 0;
    // Full plot-area rectangle of the day chart, in CSS pixels, as last
    // reported by buildMeteogramChartConfig's onLayout — kept around so a
    // day-nav swipe knows what to freeze into a bitmap before it rebuilds the
    // chart. Not reactive state: it never drives a render on its own.
    this._lastLayout = null;
    // Earliest instant `_measured` currently covers, or null before the first
    // load — lets _loadMeasured tell "already have this range" apart from
    // "need to fetch further back", so paging through the day view does not
    // re-fetch the whole history on every step (see _loadMeasured).
    this._measuredLoadedFrom = null;
    // Day view's own temperature axis range, carried forward across day-nav
    // steps by nextTempRange() so the axis mostly stays still while paging —
    // see _renderChart. Not reactive state: it only feeds the chart builder,
    // never the template. Discarded on the way back to the overview (see
    // _showOverview), which always computes its own default range instead.
    this._dayTempRange = null;
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

  // Both views need the recorded hours: the overview for this morning's hours
  // at its left edge, the day view for the same when it is open on today, and
  // for whole days on their own when paged back before today (see
  // _bandStartOffset). Only the stretch not already covered is fetched — the
  // gap between `neededStart` and whatever `_measuredLoadedFrom` already is —
  // so stepping day-to-day does not re-run a multi-day history query every
  // time. The running hour changes independently of how far back is loaded,
  // so today's slice is re-fetched on every call regardless.
  async _loadMeasured() {
    if (!this._hass || !this._config.history) {
      return;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const neededStart = new Date(
      now.getFullYear(), now.getMonth(), now.getDate() + this._bandStartOffset(),
    );

    if (this._measuredLoadedFrom === null) {
      this._measured = await fetchMeasuredHours(this._hass, this._config.history, neededStart, now);
      this._measuredLoadedFrom = neededStart;
      return;
    }

    if (neededStart < this._measuredLoadedFrom) {
      const older = await fetchMeasuredHours(
        this._hass, this._config.history, neededStart, this._measuredLoadedFrom,
      );
      this._measured = mergeMeasured(older, this._measured);
      this._measuredLoadedFrom = neededStart;
    }

    const current = await fetchMeasuredHours(this._hass, this._config.history, todayStart, now);
    this._measured = mergeMeasured(current, this._measured);
  }

  // mergeMeasured is a true union over the timestamp now, so folding it in
  // unconditionally is correct for every window: the overview always slices
  // from today 00:00 regardless (see _data()'s day_offset), and a day view
  // opened on a past day has no forecast entries for that day at all — measured
  // history ends up being its only source, exactly as intended.
  _source() {
    if (!this._forecasts || !this._forecasts.length) {
      return null;
    }

    return mergeMeasured(this._measured || [], this._forecasts);
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
  // which day happens to be open in the day view, and that window is always
  // today onward, so the measured hours it needs are always today's.
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

  // Same shape as the overview mode's own data, but windowed from
  // _bandStartOffset() rather than always today — used for the compact band
  // under the day chart, which starts one day before whichever day is open
  // (or 0 in the overview, where there is no band at all).
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
      day_offset: this._bandStartOffset(),
    });
  }

  updated(changed) {
    super.updated(changed);
    this._renderChart();
    this._renderBandChart();
    this._measureHeaderHeight();
    this._measureStripHeight();
    this._measureDayNavHeight();
    this._measureHourStripHeight();
    this._measurePctRowHeight();
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

  // Mirror of _measureStripHeight for the header: only present in the
  // overview (see _renderHeader), so it measures 0 in the day view. Its
  // height looks fixed, but a theme's font size can still change it, so it is
  // measured rather than assumed, same as every other block in this budget.
  _measureHeaderHeight() {
    const header = this.renderRoot && this.renderRoot.querySelector('.header');
    const height = header ? header.getBoundingClientRect().height : 0;

    if (height !== this._headerHeight) {
      this._headerHeight = height;
    }
  }

  // Mirror of _measureStripHeight for the day-nav row: only present in mode
  // 'today', where it now stands in for the header (see _renderDayNav and the
  // block-order note there).
  _measureDayNavHeight() {
    const nav = this.renderRoot && this.renderRoot.querySelector('.day-nav');
    const height = nav ? nav.getBoundingClientRect().height : 0;

    if (height !== this._dayNavHeight) {
      this._dayNavHeight = height;
    }
  }

  // Mirror of _measureStripHeight for the hour strip above the day chart: only
  // present in mode 'today', so it measures 0 in the overview, same as
  // _measureStripHeight does for the day strip in the day view.
  _measureHourStripHeight() {
    const strip = this.renderRoot && this.renderRoot.querySelector('.hour-strip');
    const height = strip ? strip.getBoundingClientRect().height : 0;

    if (height !== this._hourStripHeight) {
      this._hourStripHeight = height;
    }
  }

  // Mirror of _measureStripHeight for the percentage row below the day chart:
  // only present in mode 'today', alongside the hour strip it shares its
  // thinning decision with (see alignHourStrip in hour-strip.js).
  _measurePctRowHeight() {
    const row = this.renderRoot && this.renderRoot.querySelector('.pct-row');
    const height = row ? row.getBoundingClientRect().height : 0;

    if (height !== this._pctRowHeight) {
      this._pctRowHeight = height;
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

    // No canvas to draw into — either nothing has loaded yet, or render()
    // swapped it out for the "no data" message because the currently open day
    // is empty (see the dayEmpty computation there). Either way any previous
    // chart instance is now pointing at a canvas that is no longer in the DOM.
    if (!canvas || !data) {
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
        this._chartSignature = null;
      }
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

    // The day view keeps its temperature axis mostly still while paging
    // between days, by folding each day's own known values into the range
    // remembered from the previous one (see nextTempRange in meteogram/chart.js
    // and the field comment on _dayTempRange). The overview never carries a
    // range forward — it always gets its own default from a null tempRange,
    // same as before this task.
    let tempRange = null;
    if (this._mode === 'today') {
      const known = (data.temperatures || []).filter((value) => value != null);
      this._dayTempRange = nextTempRange(this._dayTempRange, known, DAY_TEMP_MIN_SPAN);
      tempRange = this._dayTempRange;
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
      tempRange,
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
      // The band's own window can start before today (see _bandStartOffset),
      // so the open day's index within it is no longer _dayOffset itself but
      // its position relative to that window's start.
      activeDay: this._dayOffset - this._bandStartOffset(),
      onSelect: (index) => this._onBandSelect(index, this._trendData()),
    });

    this._bandChart = new Chart(canvas.getContext('2d'), config);
    this._bandChartSignature = signature;
  }

  // The band's own day picker: tapping the day already open in the day view
  // above it returns to the full overview (the band's equivalent of clicking
  // the active day-strip tile), tapping any other day loads it — same
  // swipe-vs-fade transition rule _selectDay already applies everywhere else
  // a day gets picked.
  _onBandSelect(index, data) {
    const entry = data && data.entries[index];
    if (!entry) {
      return;
    }

    const offset = dayOffsetFrom(new Date(entry.datetime));
    if (offset === this._dayOffset) {
      this._showOverview();
      return;
    }

    this._selectDay(offset);
  }

  _alignDayStrip(area) {
    const strip = this.renderRoot && this.renderRoot.querySelector('.day-strip');
    alignDayStrip(strip, area);
  }

  _alignHourStrip(area) {
    const strip = this.renderRoot && this.renderRoot.querySelector('.hour-strip');
    const pctRow = this.renderRoot && this.renderRoot.querySelector('.pct-row');
    alignHourStrip(strip, pctRow, area);
  }

  _onChartLayout(area) {
    this._lastLayout = area;
    this._alignDayStrip(area);
    this._alignHourStrip(area);
  }

  // Index the day view's crosshair falls back to once there is no hover: the
  // current hour when today's day view is open, otherwise the day's first
  // entry. Called only when there is no hover already — see _activeIndex,
  // the only caller.
  _displayIndex(data) {
    return this._dayOffset === 0 ? nowIndex(data.entries) : 0;
  }

  // Index the chart's crosshair highlights, in both modes now: a hover
  // overrides everything until the pointer leaves the chart. Without a hover,
  // the day view still rests on a default (the current hour, via
  // _displayIndex) but the overview does not — it never had a single "current
  // point" to show at rest, so leaving the chart there clears the crosshair
  // entirely instead of resting on some default index, same "clean fallback"
  // shape as the day view's own reset just landing on a different value.
  _activeIndex() {
    if (this._hoverIndex != null) {
      return this._hoverIndex;
    }
    if (this._mode !== 'today') {
      return null;
    }

    const data = this._data();
    return data ? this._displayIndex(data) : null;
  }

  // Drives the crosshair in both modes now (see _activeIndex) — only the main
  // chart wires onHover at all (the compact band under the day chart never
  // does, see _renderBandChart), so this never fires for that one.
  _onHover(index) {
    if (index === this._hoverIndex) {
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

  // First calendar day the day view can page back into — the past-facing
  // counterpart to _maxDayOffset(). Without configured history sensors there
  // is nothing to show for a day before today, so the left arrow keeps
  // locking at 0 exactly as it did before this could go negative.
  _minDayOffset() {
    return this._config.history ? -MAX_HISTORY_DAYS : 0;
  }

  // First day the compact band under the day chart covers: one day before
  // whichever day is currently open, so paging back always surfaces exactly
  // one more past day there — never clamped tighter than _minDayOffset()
  // allows. 0 outside the day view, where there is no band to begin with.
  _bandStartOffset() {
    if (this._mode !== 'today') {
      return 0;
    }
    return Math.max(this._minDayOffset(), this._dayOffset - 1);
  }

  // Switches to the day view for one specific day, from a day-strip tile, a tap
  // in the trend chart or a day arrow. Measured (recorder) history is what makes
  // a day before today possible at all — see _minDayOffset().
  _selectDay(offset) {
    const target = Math.min(Math.max(offset, this._minDayOffset()), this._maxDayOffset());

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
      // The remembered day-view axis range has nothing to do with the
      // overview's own — discarded here so the next day view opened starts
      // fresh from that day's own values instead of an unrelated leftover.
      this._dayTempRange = null;
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
  // _displayIndex's "now" fallback relies on) rather than re-deriving "current
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

  // Overview-only: current condition, header_extras and the large "now"
  // temperature all describe the present moment, not whichever day happens
  // to be open in the day view — paging there would otherwise leave stale
  // values sitting above a chart for a different day. The day view gets its
  // own top row instead (see _renderDayNav), which carries no per-moment
  // value at all.
  _renderHeader() {
    if (!this._config.show_current || !this._weather || this._mode !== 'trend') {
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

  // The compact week band under the day chart — a second chart that doubles
  // as a day picker: tapping the day already open returns to the overview,
  // tapping any other day loads it (see _onBandSelect, wired through the
  // band chart's own onClick, not an element listener here — which day was
  // tapped now matters). Only present in the day view; the overview is
  // reached from here or the day-nav arrows (see _renderDayNav).
  _renderBand(height) {
    if (this._mode !== 'today') {
      return nothing;
    }

    return html`
      <div class="band-wrap" style="height: ${height}px">
        <canvas id="band-chart"></canvas>
      </div>
    `;
  }

  // Day navigation row: previous/next arrows plus the weekday/date of the day
  // currently shown, centered between them (see .day-nav in styles.js for the
  // fixed-edge-column grid that keeps it genuinely centered). Stands in for
  // the header at the very top of the day view (see the block-order note on
  // _renderHeader) rather than sitting below it, since it carries no
  // per-moment value that a header would otherwise duplicate. Per-hour values
  // (temperature, precipitation, probability, wind) used to live here too;
  // they are now a chart tooltip instead (see buildMeteogramChartConfig's
  // tooltip in meteogram/chart.js), and the hour strip plus the percentage row
  // around the chart (see _renderHourStrip/_renderPctRow) took over the
  // per-hour condition/probability read-out.
  _renderDayNav(data) {
    if (this._mode !== 'today' || !data) {
      return nothing;
    }

    // Derived from _dayOffset/now rather than from data.entries[0]: a day the
    // recorder has nothing for (see _renderChart's dayEmpty) still has to show
    // its own date and keep the arrows usable, even though entries is empty
    // there. Hovering does not move anything in this row either way, now that
    // it carries no per-hour value.
    const now = new Date();
    const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + this._dayOffset);
    const dayLabel = dayDate.toLocaleDateString(this._language, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
    const min = this._minDayOffset();
    const max = this._maxDayOffset();
    const overviewLabel = this._ll('overview');

    return html`
      <div class="day-nav">
        <button
          type="button"
          class="day-nav__arrow"
          title=${this._ll('previousDay')}
          aria-label=${this._ll('previousDay')}
          ?disabled=${this._dayOffset <= min}
          @click=${() => this._selectDay(this._dayOffset - 1)}
        ><ha-icon .icon=${'mdi:chevron-left'}></ha-icon></button>
        <button
          type="button"
          class="day-nav__date"
          title=${overviewLabel}
          aria-label=${overviewLabel}
          @click=${() => this._showOverview()}
        >${dayLabel}</button>
        <button
          type="button"
          class="day-nav__arrow"
          title=${this._ll('nextDay')}
          aria-label=${this._ll('nextDay')}
          ?disabled=${this._dayOffset >= max}
          @click=${() => this._selectDay(this._dayOffset + 1)}
        ><ha-icon .icon=${'mdi:chevron-right'}></ha-icon></button>
      </div>
    `;
  }

  // The hour strip above the day chart: one column per hour with that hour's
  // condition icon and hour number, DWD-Warnwetter-style. Only in the day
  // view, and only when show_hour_strip allows it — same gating shape as
  // _renderDayStrip's own show_day_strip/mode check. Paired with _renderPctRow
  // below the chart, which shares this same gate and the same thinning
  // decision (see alignHourStrip in hour-strip.js).
  _renderHourStrip(data) {
    if (!this._config.show_hour_strip || this._mode !== 'today' || !data) {
      return nothing;
    }

    return renderHourStrip({ entries: data.entries, language: this._language });
  }

  // The rain-probability row below the day chart, in the space the x-axis's
  // own hour labels would otherwise occupy (see the day view's `ticks` in
  // buildMeteogramChartConfig). Gated the same way as _renderHourStrip, whose
  // pairing partner this is.
  _renderPctRow(data) {
    if (!this._config.show_hour_strip || this._mode !== 'today' || !data) {
      return nothing;
    }

    return renderPctRow({ entries: data.entries, language: this._language });
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
    // A day the recorder (and, this far out, the forecast) has nothing at all
    // for — reachable now that the day view can page up to a week into the
    // past (see _minDayOffset). Rendered as a quiet message in place of the
    // chart instead of an empty plot with dead axes; day-nav and the band
    // stay live either way, since both are computed independently of `data`.
    const dayEmpty = this._mode === 'today' && !!data && data.entries.length === 0;
    // chart_height is the budget for everything below the card's own padding,
    // in both modes — not just the chart itself. Every block above and below
    // the chart in the currently active mode is deducted from it: header plus
    // day strip in the overview, day-nav plus hour strip plus the percentage
    // row plus the band in the day view (see the block order in the template
    // below). Each one's own real, measured height is what gets deducted —
    // a guessed constant would drift the moment its content (a wrapped label,
    // a thinned-out strip, a theme's font size) changes, and that includes
    // the header and day-nav even though their height looks fixed. Whichever
    // mode is not active has its measurement(s) pinned at 0 since those
    // elements do not exist to measure.
    const reservedHeight = this._mode === 'trend'
      ? this._headerHeight + this._stripHeight
      : this._dayNavHeight + this._hourStripHeight + this._pctRowHeight + this._bandHeight;
    const chartHeight = Math.max(0, this._config.chart_height - reservedHeight);
    // Target, not measured: the band's own height request, a fifth of the day
    // chart's budget. _measureBandHeight() reads back what this actually laid
    // out to feed the deduction above.
    const bandHeight = Math.round(this._config.chart_height * BAND_HEIGHT_RATIO);

    return html`
      <ha-card>
        ${this._renderHeader()}
        ${this._renderDayStrip()}
        ${this._renderDayNav(data)}
        ${this._renderHourStrip(data)}
        <div
          class="chart-wrap ${this._mode === 'trend' ? 'chart-wrap--clickable' : ''}"
          style="height: ${chartHeight}px"
        >
          <div class="chart-anim">
            ${dayEmpty
              ? html`<div class="message">${this._ll('noForecast')}</div>`
              : html`<canvas id="chart"></canvas>`}
          </div>
        </div>
        ${this._renderPctRow(data)}
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
