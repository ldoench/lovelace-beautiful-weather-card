import { LitElement, html, css, nothing } from 'lit';
import {
  DEFAULT_CONFIG,
  HEADER_EXTRA_ATTRIBUTES,
  HEADER_EXTRAS_MAX,
} from './const.js';

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
  locale: 'Language',
};

// Labels for the header-extras attribute picker. Order matches
// HEADER_EXTRA_ATTRIBUTES (forecast attribute first, then entity attributes).
const HEADER_EXTRA_ATTRIBUTE_LABELS = {
  precipitation_probability: 'Precipitation probability (hourly forecast)',
  humidity: 'Humidity (weather entity attribute)',
  wind_speed: 'Wind speed (weather entity attribute)',
  pressure: 'Pressure (weather entity attribute)',
  apparent_temperature: 'Apparent temperature (weather entity attribute)',
};

function computeLabel(schema) {
  return LABELS[schema.name] || schema.name;
}

// Flat, top-level options only. `history.temperature` / `history.precipitation`
// and `header_extras` are handled by hand-written fields below the form (see
// render()) — the first needs a different entity domain filter than `entity`,
// the second is a small array of `{ attribute | entity, icon }` objects, and
// nesting either into this schema would require ha-form's object-selector,
// which has no sensible widget. `temperature_gradient` and `precip_bands` are
// deliberately left out entirely: both are arrays of nested `{ ... , color }`
// objects, and there is no usable HA form widget for editing nested lists
// like that — they stay YAML-only.
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
  {
    name: 'locale',
    selector: {
      select: {
        mode: 'dropdown',
        options: [
          { value: '', label: "Home Assistant's language (default)" },
          { value: 'de', label: 'Deutsch' },
          { value: 'en', label: 'English' },
        ],
      },
    },
  },
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

      .history-fields,
      .header-extras-fields {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .history-hint {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin: -8px 0 0;
      }

      .header-extra-slot {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 8px 0;
        border-top: 1px solid var(--divider-color);
      }

      .header-extra-slot:first-of-type {
        border-top: none;
        padding-top: 0;
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

  // header_extras as currently configured, falling back to the default so a
  // freshly-added card shows its one default slot instead of two empty ones.
  get _headerExtras() {
    return this._config.header_extras || DEFAULT_CONFIG.header_extras;
  }

  _headerExtraSourceChanged(index, ev) {
    ev.stopPropagation();
    const value = ev.detail.value;
    const current = this._headerExtras[index] || {};

    if (!value) {
      this._setHeaderExtra(index, null);
    } else if (value === '__entity__') {
      this._setHeaderExtra(index, { entity: current.entity || '', ...(current.icon ? { icon: current.icon } : {}) });
    } else {
      this._setHeaderExtra(index, { attribute: value, ...(current.icon ? { icon: current.icon } : {}) });
    }
  }

  _headerExtraEntityChanged(index, ev) {
    ev.stopPropagation();
    const current = this._headerExtras[index] || {};
    this._setHeaderExtra(index, {
      entity: ev.detail.value || '',
      ...(current.icon ? { icon: current.icon } : {}),
    });
  }

  _headerExtraIconChanged(index, ev) {
    ev.stopPropagation();
    const current = this._headerExtras[index] || {};
    if (!current.attribute && !current.entity) {
      return;
    }
    const next = { ...current };
    if (ev.detail.value) {
      next.icon = ev.detail.value;
    } else {
      delete next.icon;
    }
    this._setHeaderExtra(index, next);
  }

  // Writes one slot back into the array, drops trailing empty slots, and
  // removes the config key entirely once nothing is left.
  _setHeaderExtra(index, value) {
    const extras = [...this._headerExtras];
    extras[index] = value;

    while (extras.length && !extras[extras.length - 1]) {
      extras.pop();
    }
    const cleaned = extras.filter(Boolean).slice(0, HEADER_EXTRAS_MAX);

    const config = { ...this._config };
    if (cleaned.length) {
      config.header_extras = cleaned;
    } else {
      delete config.header_extras;
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

  // One slot renders as a source picker (attribute or custom entity), plus an
  // entity picker and/or icon picker once a source is chosen.
  _renderHeaderExtraSlot(index) {
    const extra = this._headerExtras[index] || {};
    const sourceValue = extra.entity !== undefined ? '__entity__' : (extra.attribute || '');

    return html`
      <div class="header-extra-slot">
        <ha-selector
          .hass=${this.hass}
          .selector=${{
            select: {
              mode: 'dropdown',
              options: [
                { value: '', label: `Extra value ${index + 1}: none` },
                ...HEADER_EXTRA_ATTRIBUTES.map((attribute) => ({
                  value: attribute,
                  label: HEADER_EXTRA_ATTRIBUTE_LABELS[attribute],
                })),
                { value: '__entity__', label: 'Custom sensor entity…' },
              ],
            },
          }}
          .value=${sourceValue}
          .label=${`Extra value ${index + 1}`}
          @value-changed=${(ev) => this._headerExtraSourceChanged(index, ev)}
        ></ha-selector>

        ${sourceValue === '__entity__'
          ? html`
              <ha-entity-picker
                .hass=${this.hass}
                .value=${extra.entity || ''}
                .label=${'Sensor entity'}
                .includeDomains=${['sensor']}
                allow-custom-entity
                @value-changed=${(ev) => this._headerExtraEntityChanged(index, ev)}
              ></ha-entity-picker>
            `
          : nothing}

        ${sourceValue
          ? html`
              <ha-selector
                .hass=${this.hass}
                .selector=${{ icon: {} }}
                .value=${extra.icon || ''}
                .label=${'Icon (optional)'}
                @value-changed=${(ev) => this._headerExtraIconChanged(index, ev)}
              ></ha-selector>
            `
          : nothing}
      </div>
    `;
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

      <div class="header-extras-fields">
        <p class="history-hint">
          Up to two small values next to the current temperature in the header.
        </p>
        ${[0, 1].map((index) => this._renderHeaderExtraSlot(index))}
      </div>

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
