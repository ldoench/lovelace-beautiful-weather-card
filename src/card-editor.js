import { LitElement, html, css, nothing } from 'lit';
import { DEFAULT_CONFIG, HEADER_EXTRAS_MAX } from './const.js';

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
  show_hour_strip: 'Show hour strip',
  show_day_strip: 'Show day strip',
  round_temp: 'Round temperatures',
  locale: 'Language',
};

function computeLabel(schema) {
  return LABELS[schema.name] || schema.name;
}

// Flat, top-level options only. `history.*` and `header_extras` are handled by
// hand-written fields below the form (see render()) — the first needs a
// different entity domain filter than `entity` and lives inside a collapsed
// section, the second is a small array of `{ attribute | entity }` objects,
// and nesting either into this schema would require ha-form's object
// selector, which has no sensible widget. `temperature_gradient` and
// `precip_bands` are deliberately left out entirely: both are arrays of
// nested `{ ... , color }` objects, and there is no usable HA form widget for
// editing nested lists like that — they stay YAML-only.
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
  { name: 'show_hour_strip', selector: { boolean: {} } },
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

// Sensor keys history.* accepts, and the heuristics used to spot a matching
// sensor of the same provider for each. Order matches the fields rendered in
// the "measured values" section. Kept close to LABELS below rather than in
// const.js: this is editor-only guesswork, main.js never needs it.
const HISTORY_FIELDS = [
  { key: 'temperature', label: 'Temperature history sensor' },
  { key: 'precipitation', label: 'Precipitation history sensor' },
  { key: 'precipitation_probability', label: 'Precipitation probability history sensor' },
];

// Matches a HA state object against a history.* key by device_class/unit/name.
// Best-effort only — a suggestion is offered, never written without the user
// clicking it, so a wrong guess costs nothing.
const HISTORY_MATCHERS = {
  temperature: (state) => state.attributes.device_class === 'temperature',
  precipitation: (state) => ['precipitation_intensity', 'precipitation'].includes(state.attributes.device_class),
  precipitation_probability: (state) => {
    // Providers rarely set a device_class for a plain "% chance" sensor, so
    // lean on the unit plus a name hint instead — otherwise this collides
    // with humidity, which is also '%'.
    if (state.attributes.device_class) {
      return false;
    }
    if (state.attributes.unit_of_measurement !== '%') {
      return false;
    }
    return /precip|niederschlag|rain|regen/i.test(`${state.entity_id} ${state.attributes.friendly_name || ''}`);
  },
};

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

      .history-fields {
        padding: 8px 0 0;
      }

      .history-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .history-hint {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin: -8px 0 0;
      }

      .header-extra-slot {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 8px 0;
        border-top: 1px solid var(--divider-color);
      }

      .header-extra-slot:first-of-type {
        border-top: none;
        padding-top: 0;
      }

      .entity-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .entity-chip {
        font: inherit;
        font-size: 12px;
        line-height: 1;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid var(--divider-color);
        background: var(--card-background-color, transparent);
        color: var(--primary-text-color);
        cursor: pointer;
      }

      .entity-chip:hover {
        border-color: var(--primary-color);
      }

      .entity-chip--active {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .suggestion-row {
        align-self: flex-start;
        background: none;
        border: none;
        padding: 0;
        font-size: 12px;
        color: var(--primary-color);
        text-decoration: underline;
        cursor: pointer;
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

  // The weather entity's registry entry, giving us platform + device_id to
  // find its sibling sensors. `hass.entities` is missing on older HA cores —
  // every caller of this treats null as "no suggestions", never an error.
  get _weatherEntityMeta() {
    const entities = this.hass && this.hass.entities;
    const weatherEntityId = this._config && this._config.entity;
    if (!entities || !weatherEntityId) {
      return null;
    }
    return entities[weatherEntityId] || null;
  }

  // Sensor entities belonging to the same device as the weather entity, or —
  // if it has no device — the same integration. Empty array (not an error)
  // when hass.entities is unavailable or the weather entity isn't known yet.
  get _providerSensors() {
    const meta = this._weatherEntityMeta;
    const entities = this.hass && this.hass.entities;
    if (!meta || !entities) {
      return [];
    }
    return Object.values(entities).filter((entry) => {
      if (!entry.entity_id.startsWith('sensor.')) {
        return false;
      }
      if (meta.device_id) {
        return entry.device_id === meta.device_id;
      }
      return entry.platform === meta.platform;
    });
  }

  _entityLabel(entityId) {
    const state = this.hass && this.hass.states && this.hass.states[entityId];
    return (state && state.attributes.friendly_name) || entityId;
  }

  // Best-effort match among the provider's sibling sensors for a history.*
  // key — null when there are no siblings or none look right.
  _suggestHistoryEntity(key) {
    const matcher = HISTORY_MATCHERS[key];
    if (!matcher || !this.hass || !this.hass.states) {
      return null;
    }
    for (const entry of this._providerSensors) {
      const state = this.hass.states[entry.entity_id];
      if (state && matcher(state)) {
        return state.entity_id;
      }
    }
    return null;
  }

  _setHistoryEntity(key, entityId) {
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

  _historyEntityChanged(key, ev) {
    ev.stopPropagation();
    this._setHistoryEntity(key, ev.detail.value);
  }

  // header_extras as currently configured, falling back to the default so a
  // freshly-added card shows its one default slot instead of two empty ones.
  get _headerExtras() {
    return this._config.header_extras || DEFAULT_CONFIG.header_extras;
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

  // Sets a slot to a specific entity, keeping its icon if YAML set one (the
  // editor never offers an icon picker, but shouldn't drop one it finds).
  _selectHeaderExtraEntity(index, entityId) {
    const current = this._headerExtras[index] || {};
    this._setHeaderExtra(index, {
      entity: entityId,
      ...(current.icon ? { icon: current.icon } : {}),
    });
  }

  _headerExtraEntityChanged(index, ev) {
    ev.stopPropagation();
    const value = ev.detail.value || '';
    const current = this._headerExtras[index] || {};
    const previousEntity = current.entity || '';

    // A slot configured via `attribute` shows this picker empty; guard
    // against a no-op event clobbering that attribute when nothing actually
    // changed (some pickers fire on blur even without an edit).
    if (value === previousEntity) {
      return;
    }

    if (!value) {
      this._setHeaderExtra(index, null);
    } else {
      this._selectHeaderExtraEntity(index, value);
    }
  }

  // One slot: sibling sensors of the weather provider as quick-pick chips
  // (when discoverable), then a free entity picker. A slot set via
  // `attribute`/`icon` in YAML shows the picker empty and stays that way
  // until the user picks something here — see _headerExtraEntityChanged.
  _renderHeaderExtraSlot(index) {
    const extra = this._headerExtras[index] || {};
    const entityValue = extra.entity || '';
    const siblings = this._providerSensors;

    return html`
      <div class="header-extra-slot">
        ${siblings.length
          ? html`
              <div class="entity-chips">
                ${siblings.map((entry) => html`
                  <button
                    type="button"
                    class="entity-chip ${entry.entity_id === entityValue ? 'entity-chip--active' : ''}"
                    @click=${() => this._selectHeaderExtraEntity(index, entry.entity_id)}
                  >${this._entityLabel(entry.entity_id)}</button>
                `)}
              </div>
            `
          : nothing}
        <ha-entity-picker
          .hass=${this.hass}
          .value=${entityValue}
          .label=${`Extra value ${index + 1}`}
          .includeDomains=${['sensor']}
          allow-custom-entity
          @value-changed=${(ev) => this._headerExtraEntityChanged(index, ev)}
        ></ha-entity-picker>
      </div>
    `;
  }

  // One history.* field: the picker (with the suggestion as placeholder, so
  // it's visible without being written), plus a clickable row to apply that
  // suggestion when the field doesn't already hold it.
  _renderHistoryField(key, label) {
    const history = this._config.history || {};
    const value = history[key] || '';
    const suggestion = this._suggestHistoryEntity(key);
    const showSuggestion = suggestion && suggestion !== value;

    return html`
      <div class="history-field">
        <ha-entity-picker
          .hass=${this.hass}
          .value=${value}
          .label=${label}
          .placeholder=${suggestion || ''}
          .includeDomains=${['sensor']}
          allow-custom-entity
          @value-changed=${(ev) => this._historyEntityChanged(key, ev)}
        ></ha-entity-picker>
        ${showSuggestion
          ? html`
              <button
                type="button"
                class="suggestion-row"
                @click=${() => this._setHistoryEntity(key, suggestion)}
              >Use suggestion: ${this._entityLabel(suggestion)}</button>
            `
          : nothing}
      </div>
    `;
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

      <ha-expansion-panel .header=${'Measured values (optional)'} outlined>
        <div class="history-fields">
          <p class="history-hint">
            Optional: sensors that supply recorded values for hours of the
            current day that already passed (the forecast only reaches
            forward).
          </p>
          ${HISTORY_FIELDS.map(({ key, label }) => this._renderHistoryField(key, label))}
        </div>
      </ha-expansion-panel>
    `;
  }
}

customElements.define('beautiful-weather-card-editor', BeautifulWeatherCardEditor);
