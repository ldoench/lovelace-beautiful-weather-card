// Day strip: the row of day tiles above the chart, after the DWD-Warnwetter app.
// Each tile is exactly as wide as that day's stretch of the plot area below it,
// so the strip reads as a header for the chart rather than as a separate widget.
// Exports a template plus the two bits of geometry that go with it — main.js owns
// the state (active day, click handling), the prototype reuses the same code.
import { html, nothing } from 'lit';
import { conditionColor, conditionIcon } from './const.js';

// Two letters, an icon and a min/max pair need roughly this much room. Below it
// the tile drops its content instead of clipping it mid-glyph.
export const MIN_TILE_WIDTH = 44;
const TEMPS_MIN_WIDTH = 34;
const ICON_MIN_WIDTH = 22;

// Roughly what the temperature axis, the intensity labels and the card padding
// take off the card width. Only used to pick the day count, and deliberately a
// constant: deriving it from the measured plot width would feed the chart's own
// layout back into the day count, which can oscillate between two values.
const AXIS_ALLOWANCE = 64;

// The strip never scrolls, so the overview shows as many days as fit and no more.
export const MAX_STRIP_DAYS = 7;

// `day.date` is a local 'YYYY-MM-DD' key (see groupByDay in meteogram/data.js).
// Parsed manually rather than via `new Date(key)` to avoid the UTC-midnight
// shift that would land on the wrong local day west of UTC.
function parseDayKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Two characters is what a day column can hold on a narrow card, and it is what
// the app template uses. Locale short names come as 'Mo.' / 'Mon' / 'lun.' — the
// trailing dot goes first so the cut lands on letters.
function weekdayLabel(date, language) {
  return date
    .toLocaleDateString(language, { weekday: 'short' })
    .replace(/\.$/, '')
    .slice(0, 2);
}

// How many whole days the strip can show at this card width. The caller caps it
// against the configured `trend_days`; this only answers what fits.
export function fitDayCount(cardWidth, maxDays = MAX_STRIP_DAYS) {
  if (!Number.isFinite(cardWidth) || cardWidth <= 0) {
    return maxDays;
  }

  const fits = Math.floor((cardWidth - AXIS_ALLOWANCE) / MIN_TILE_WIDTH);
  return Math.max(1, Math.min(maxDays, fits));
}

// Lines the strip up with the plot area of the chart below it. Chart.js only
// knows where that area starts once it has laid out its axes, so this runs from
// the chart's afterLayout hook rather than at render time.
//
// Tiles are proportional, not equal: the first day of the overview starts at the
// current hour and therefore owns a narrower slice of the chart than a full day.
// The ones that come out too small drop their content rather than clip it.
export function alignDayStrip(strip, { left, right, width } = {}) {
  if (!strip || !Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(width)) {
    return;
  }

  strip.style.paddingLeft = `${Math.round(left)}px`;
  strip.style.paddingRight = `${Math.round(Math.max(0, width - right))}px`;

  const tiles = Array.from(strip.querySelectorAll('.day-strip__tile'));

  // Everything is shown first and measured afterwards: a hidden temperature pair
  // has no width, so deciding from the previous state would latch. Writes and
  // reads stay in separate passes to keep it at one reflow.
  tiles.forEach((tile) => {
    tile.classList.remove('day-strip__tile--tight', 'day-strip__tile--sliver');
  });

  // Two below-zero temperatures are far wider than two above-zero ones, so the
  // threshold is measured rather than assumed — and measured once for the whole
  // row, so a week around freezing does not end up with temperatures on some
  // tiles and not on others.
  const needed = tiles.reduce((widest, tile) => {
    const temps = tile.querySelector('.day-strip__temps');
    return temps ? Math.max(widest, temps.getBoundingClientRect().width) : widest;
  }, 0);

  tiles.forEach((tile) => {
    const tileWidth = tile.getBoundingClientRect().width;

    tile.classList.toggle(
      'day-strip__tile--tight',
      tileWidth < TEMPS_MIN_WIDTH || tileWidth < needed + 2,
    );
    tile.classList.toggle('day-strip__tile--sliver', tileWidth < ICON_MIN_WIDTH);
  });
}

// `days` is the `days` array produced by computeMeteogramData() (via groupByDay) —
// not recomputed here. Array index doubles as the day offset that sliceForecast's
// `day_offset` option expects, since both start counting from today.
export function renderDayStrip({ days, activeIndex, language, onSelect } = {}) {
  if (!Array.isArray(days) || !days.length) {
    return nothing;
  }

  return html`
    <div class="day-strip">
      ${days.map((day, index) => {
        const date = parseDayKey(day.date);
        // Hours in the day decide the tile width: whatever share of the chart
        // this day covers, the tile covers the same share of the strip.
        const share = Math.max(1, (day.entries && day.entries.length) || 1);
        const min = day.min == null ? null : Math.round(day.min);
        const max = day.max == null ? null : Math.round(day.max);

        return html`
          <button
            type="button"
            class="day-strip__tile ${index === activeIndex ? 'day-strip__tile--active' : ''}"
            style="flex-grow: ${share}"
            @click=${() => onSelect && onSelect(index)}
          >
            <span class="day-strip__label">${weekdayLabel(date, language)}</span>
            <ha-icon
              class="day-strip__icon"
              style="color: ${conditionColor(day.condition)}"
              .icon=${conditionIcon(day.condition)}
            ></ha-icon>
            <span class="day-strip__temps">
              ${max == null ? nothing : html`<b>${max}°</b>`}
              ${min == null ? nothing : html`<span class="day-strip__min">${min}°</span>`}
            </span>
          </button>
        `;
      })}
    </div>
  `;
}
