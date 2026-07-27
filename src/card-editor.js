import { LitElement, html, css, nothing } from 'lit';
import { DEFAULT_CONFIG } from './const.js';

// Labels for the ha-form schema below. HA editors are conventionally English-only
// regardless of the dashboard language, matching most third-party cards.
const LABELS = {
  entity: 'Weather entity',
  title: 'Title',
  chart_mode: 'Initial view',
  trend_days: 'Overview days (upper limit)',
  trend_bucket_hours: 'Trend bucket hours',
  chart_height: 'Chart height (px)',
  show_current: 'Show current conditions header',
  show_detail_row: 'Show detail row',
  show_day_strip: 'Show day strip',
  round_temp: 'Round temperatures',
};

function computeLabel(schema) {
  return LABELS[schema.name] || schema.name;
}

// Flat, top-level options only. `history.temperature` / `history.precipitation`
// are handled by two dedicated ha-entity-picker elements below the form (they
// need a different entity domain filter than `entity`, and nesting them into
// this schema would require ha-form's object-selector, which has no sensible
// widget). `temperature_gradient` and `precip_bands` are deliberately left out
// entirely: both are arrays of nested `{ ... , color }` objects, and there is no
// usable HA form widget for editing nested lists like that — they stay YAML-only.
const SCHEMA = [
  { name: 'entity', required: true, selector: { entity: { domain: 'weather' } } },
  { name: 'title', selector: { text: {} } },
  {
    name: 'chart_mode',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: 'trend', label: 'Overview' },
          { value: 'today', label: 'Single day' },
        ],
      },
    },
  },
  // Seven is the ceiling: the day strip does not scroll, and beyond a week the
  // tiles fall below a readable width even on a full-width card.
  { name: 'trend_days', selector: { number: { min: 1, max: 7, mode: 'box' } } },
  { name: 'trend_bucket_hours', selector: { number: { min: 1, max: 24, mode: 'box' } } },
  { name: 'chart_height', selector: { number: { min: 100, max: 600, step: 10, mode: 'box' } } },
  { name: 'show_current', selector: { boolean: {} } },
  { name: 'show_detail_row', selector: { boolean: {} } },
  { name: 'show_day_strip', selector: { boolean: {} } },
  { name: 'round_temp', selector: { boolean: {} } },
];

class BeautifulWeatherCardEditor extends LitElement {
  static get properties() {
    return {
      hass: { attribute: false },
      _config: { state: true },
    };
  }

  static get styles() {
    return css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .history-fields {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .history-hint {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin: -8px 0 0;
      }
    `;
  }

  setConfig(config) {
    this._config = config;
  }

  // ha-form's .data is only ever read from, never mutated in place, so every
  // change produces a fresh object and typing never fights the form for the
  // cursor position.
  get _formData() {
    return { ...DEFAULT_CONFIG, ...this._config };
  }

  _formChanged(ev) {
    ev.stopPropagation();
    this._updateConfig({ ...ev.detail.value });
  }

  _historyEntityChanged(key, ev) {
    ev.stopPropagation();
    const entityId = ev.detail.value;
    const history = { ...(this._config.history || {}) };

    if (entityId) {
      history[key] = entityId;
    } else {
      delete history[key];
    }

    const config = { ...this._config, history };
    if (Object.keys(history).length === 0) {
      delete config.history;
    }

    this._config = config;
    this._fireConfigChanged();
  }

  _updateConfig(value) {
    this._config = { ...this._config, ...value };
    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    const event = new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  render() {
    if (!this.hass || !this._config) {
      return nothing;
    }

    const history = this._config.history || {};

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this._formData}
        .schema=${SCHEMA}
        .computeLabel=${computeLabel}
        @value-changed=${this._formChanged}
      ></ha-form>

      <div class="history-fields">
        <p class="history-hint">
          Optional: sensors that supply recorded values for hours of the current
          day that already passed (the forecast only reaches forward).
        </p>
        <ha-entity-picker
          .hass=${this.hass}
          .value=${history.temperature || ''}
          .label=${'Temperature history sensor'}
          .includeDomains=${['sensor']}
          allow-custom-entity
          @value-changed=${(ev) => this._historyEntityChanged('temperature', ev)}
        ></ha-entity-picker>
        <ha-entity-picker
          .hass=${this.hass}
          .value=${history.precipitation || ''}
          .label=${'Precipitation history sensor'}
          .includeDomains=${['sensor']}
          allow-custom-entity
          @value-changed=${(ev) => this._historyEntityChanged('precipitation', ev)}
        ></ha-entity-picker>
        <ha-entity-picker
          .hass=${this.hass}
          .value=${history.precipitation_probability || ''}
          .label=${'Precipitation probability history sensor'}
          .includeDomains=${['sensor']}
          allow-custom-entity
          @value-changed=${(ev) => this._historyEntityChanged('precipitation_probability', ev)}
        ></ha-entity-picker>
      </div>
    `;
  }
}

customElements.define('beautiful-weather-card-editor', BeautifulWeatherCardEditor);
