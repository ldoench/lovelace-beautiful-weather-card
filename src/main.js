import { LitElement, html, nothing } from 'lit';
import { Chart, registerables } from 'chart.js';
import { CARD_VERSION, DEFAULT_CONFIG, WeatherEntityFeature, conditionIcon } from './const.js';
import { localize } from './locale.js';
import { computeMeteogramData } from './meteogram/data.js';
import { buildMeteogramChartConfig } from './meteogram/chart.js';
import { fetchMeasuredHours, mergeMeasured } from './meteogram/history.js';
import { MAX_STRIP_DAYS, alignDayStrip, fitDayCount, renderDayStrip } from './day-strip.js';
import { cardStyles } from './styles.js';
import './card-editor.js';

Chart.register(...registerables);

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole calendar days between today and `date`, both taken in local time — which
// is exactly what sliceForecast()'s `day_offset` counts.
function dayOffsetFrom(date, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((to - from) / DAY_MS);
}

class BeautifulWeatherCard extends LitElement {
  static get properties() {
    return {
      _config: { state: true },
      _forecasts: { state: true },
      _weather: { state: true },
      _mode: { state: true },
      _measured: { state: true },
      _selectedIndex: { state: true },
      _dayOffset: { state: true },
      _visibleDays: { state: true },
    };
  }

  static get styles() {
    return cardStyles;
  }

  constructor() {
    super();
    this._forecasts = null;
    this._measured = [];
    this._selectedIndex = null;
    this._dayOffset = 0;
    this._visibleDays = MAX_STRIP_DAYS;
    this._chart = null;
    this._forecastUnsub = null;
    this._subscribedEntity = null;
    this._resizeObserver = null;
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
        this._selectedIndex = null;
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
  // a tap on a tile only changes what the chart shows, not what the strip lists.
  // Built from the same source and the same day count as the overview, so a tile
  // and the day below it always describe the same hours.
  _stripDays() {
    const source = this._source();
    if (!source) {
      return [];
    }

    const data = computeMeteogramData(source, 'trend', {
      trend_days: this._trendDays(),
      precip_bands: this._config.precip_bands,
    });

    return data.days;
  }

  updated(changed) {
    super.updated(changed);
    this._renderChart();
  }

  _renderChart() {
    const canvas = this.renderRoot && this.renderRoot.querySelector('#chart');
    const data = this._data();

    if (!canvas || !data) {
      return;
    }

    if (this._chart) {
      this._chart.destroy();
    }

    const config = buildMeteogramChartConfig({
      data,
      mode: this._mode,
      cardConfig: this._config,
      language: this._language,
      localize: (path, vars) => this._ll(path, vars),
      onSelect: (index) => this._onSelect(index, data),
      // Chart.js knows where the plot area starts only after it has measured its
      // axes; the day strip is padded to those edges from there.
      onLayout: (area) => this._alignDayStrip(area),
    });

    this._chart = new Chart(canvas.getContext('2d'), config);
  }

  _alignDayStrip(area) {
    const strip = this.renderRoot && this.renderRoot.querySelector('.day-strip');
    alignDayStrip(strip, area);
  }

  // The trend chart doubles as the day picker: a tap on a day's area opens that
  // day. In the day view the same tap only moves the read-out to that hour.
  _onSelect(index, data) {
    if (this._mode !== 'trend') {
      this._selectedIndex = index;
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

    this._mode = 'today';
    this._dayOffset = target;
    this._selectedIndex = null;

    // `_measured` always holds today's recorded hours; whether they belong in the
    // current window is decided in _source(). Refreshed here so a day view opened
    // hours after the card loaded is not missing the hours in between.
    this._loadMeasured();
  }

  _showOverview() {
    this._mode = 'trend';
    this._dayOffset = 0;
    this._selectedIndex = null;
    this._loadMeasured();
  }

  _renderHeader() {
    if (!this._config.show_current || !this._weather) {
      return nothing;
    }

    const attrs = this._weather.attributes;
    const temp = attrs.temperature;
    const name = this._config.title || attrs.friendly_name || this._config.entity;

    return html`
      <div class="header">
        <ha-icon class="icon" .icon=${conditionIcon(this._weather.state)}></ha-icon>
        <div class="titles">
          <div class="name">${name}</div>
          <div class="place">${this._ll(`condition.${this._weather.state}`) || this._weather.state}</div>
        </div>
        ${temp == null ? nothing : html`<div class="temp">${Math.round(temp)}°</div>`}
      </div>
    `;
  }

  _renderDayStrip() {
    if (!this._config.show_day_strip) {
      return nothing;
    }

    const days = this._stripDays();
    if (!days.length) {
      return nothing;
    }

    return renderDayStrip({
      days,
      // No tile is the active one while the overview is showing all of them.
      activeIndex: this._mode === 'today' ? this._dayOffset : null,
      language: this._language,
      onSelect: (index) => this._selectDay(index),
    });
  }

  // Only the day view needs controls: step a day back or forward, or return to
  // the week overview. The overview itself is navigated by tapping the chart.
  _renderDayNav() {
    if (this._mode !== 'today') {
      return nothing;
    }

    const max = this._maxDayOffset();

    return html`
      <div class="day-nav">
        <button
          type="button"
          class="day-nav__button"
          title=${this._ll('previousDay')}
          aria-label=${this._ll('previousDay')}
          ?disabled=${this._dayOffset <= 0}
          @click=${() => this._selectDay(this._dayOffset - 1)}
        ><ha-icon .icon=${'mdi:chevron-left'}></ha-icon></button>
        <button
          type="button"
          class="day-nav__button day-nav__overview"
          @click=${() => this._showOverview()}
        >${this._ll('overview')}</button>
        <button
          type="button"
          class="day-nav__button"
          title=${this._ll('nextDay')}
          aria-label=${this._ll('nextDay')}
          ?disabled=${this._dayOffset >= max}
          @click=${() => this._selectDay(this._dayOffset + 1)}
        ><ha-icon .icon=${'mdi:chevron-right'}></ha-icon></button>
      </div>
    `;
  }

  _renderDetail(data) {
    if (!this._config.show_detail_row || this._mode !== 'today' || !data) {
      return nothing;
    }

    const index = this._selectedIndex == null ? 0 : this._selectedIndex;
    const entry = data.entries[index];

    if (!entry) {
      return nothing;
    }

    const time = new Date(entry.datetime).toLocaleTimeString(this._language, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const precip = entry.precipitation == null ? 0 : entry.precipitation;

    return html`
      <div class="detail">
        <span class="time">${index === 0 && this._selectedIndex == null ? this._ll('now') : time}</span>
        <span class="item">${this._ll('temperature')} <b>${entry.temperature}°</b></span>
        <span class="item">${this._ll('precipitation')} <b>${precip.toFixed(1)} mm</b></span>
        ${entry.precipitation_probability == null
          ? nothing
          : html`<span class="item">${this._ll('probability')} <b>${Math.round(entry.precipitation_probability)} %</b></span>`}
        ${entry.wind_speed == null
          ? nothing
          : html`<span class="item">${this._ll('wind')} <b>${Math.round(entry.wind_speed)} km/h</b></span>`}
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

    return html`
      <ha-card>
        ${this._renderHeader()}
        ${this._renderDayStrip()}
        ${this._renderDayNav()}
        ${this._renderDetail(data)}
        <div
          class="chart-wrap ${this._mode === 'trend' ? 'chart-wrap--clickable' : ''}"
          style="height: ${this._config.chart_height}px"
        >
          <canvas id="chart"></canvas>
        </div>
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
