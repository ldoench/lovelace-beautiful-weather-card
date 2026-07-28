// Hour strip: the row above the day chart showing, per hour, the forecast
// condition icon and the hour number — the DWD-Warnwetter app's own
// "time + weather" header for its day view. The rain probability used to
// live in this same row; it now has its own row below the chart instead
// (see renderPctRow/.pct-row), in the space the x-axis's hour labels used
// to occupy — the day view's axis suppresses its own tick labels for
// exactly this reason (see buildMeteogramChartConfig in meteogram/chart.js).
//
// Built after the pattern of day-strip.js: a template plus the geometry that
// lines it up with the chart's plot area, kept out of main.js's own state.
// Unlike the day strip, every column is exactly one hour and therefore the
// same width as every other — no `flex-grow` share to compute per tile.
import { html, nothing } from 'lit';
import { conditionColor, conditionIcon } from './const.js';

// Lightest a probability value ever gets, and how much darker 100% goes on
// top of that — see the opacity note on .pct-row__value in styles.js. Kept
// well short of 1 so even 100% stays at --secondary-text-color rather than
// reading as important as the primary text around it.
const PROBABILITY_OPACITY_MIN = 0.3;
const PROBABILITY_OPACITY_RANGE = 0.7;

// The percentage row is deliberately coarse — a swing from 42% to 47% between
// two forecast refreshes should not visibly redraw the row — so the display
// value itself is rounded to this step, and the opacity below is derived from
// that already-rounded value rather than the raw one.
const PROBABILITY_ROUND_STEP = 10;

function probabilityOpacity(pct) {
  if (pct == null) {
    return PROBABILITY_OPACITY_MIN;
  }
  const clamped = Math.min(100, Math.max(0, pct));
  return PROBABILITY_OPACITY_MIN + (clamped / 100) * PROBABILITY_OPACITY_RANGE;
}

function roundedProbability(raw) {
  if (raw == null) {
    return null;
  }
  const clamped = Math.min(100, Math.max(0, raw));
  return Math.round(clamped / PROBABILITY_ROUND_STEP) * PROBABILITY_ROUND_STEP;
}

// Lines both the hour strip and the percentage row up with the plot area of
// the chart below them, and thins them out together — same idea and same
// onLayout-driven timing as alignDayStrip, kept as its own function rather
// than a shared helper since the day strip drops whole rows of content while
// this pair drops every Nth column instead.
//
// The two rows share one thinning decision (rather than each measuring and
// deciding for itself) so a column is never left with an icon+hour in one
// row and nothing lining up with it in the other, or vice versa: whichever
// row needs more room decides for both.
export function alignHourStrip(hourStrip, pctRow, { left, right, width } = {}) {
  if (!hourStrip || !pctRow || !Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(width)) {
    return;
  }

  const paddingLeft = `${Math.round(left)}px`;
  const paddingRight = `${Math.round(Math.max(0, width - right))}px`;
  [hourStrip, pctRow].forEach((row) => {
    row.style.paddingLeft = paddingLeft;
    row.style.paddingRight = paddingRight;
  });

  // The "24" end marker (see renderHourStrip) sits outside the padded flex
  // row — as an absolutely positioned sibling of the hour tiles, not a flex
  // child — so that adding it never takes width away from those tiles and
  // shifts their column alignment with the chart below. It still has to land
  // flush with the plot area's right edge, which an explicit `right` offset
  // does regardless of the row's own padding (that offset is measured from
  // the row's outer edge, the same reference paddingRight itself is computed
  // against above), so the same value lines it up exactly there.
  const endMarker = hourStrip.querySelector('.hour-strip__end');
  if (endMarker) {
    endMarker.style.right = paddingRight;
  }

  const hourTiles = Array.from(hourStrip.querySelectorAll('.hour-strip__tile'));
  const pctTiles = Array.from(pctRow.querySelectorAll('.pct-row__tile'));
  if (!hourTiles.length || !pctTiles.length) {
    return;
  }

  // Content shown first, measured afterwards — a thinned-out tile's hidden
  // label has no width, so deciding from the previous pass would latch (same
  // reasoning as alignDayStrip's own two-phase write/read).
  hourTiles.forEach((tile) => {
    tile.classList.remove('hour-strip__tile--thin2', 'hour-strip__tile--thin3');
  });
  pctTiles.forEach((tile) => {
    tile.classList.remove('pct-row__tile--thin2', 'pct-row__tile--thin3');
  });

  // Every column is the same width, so the first tile's measured width
  // stands for the whole pair of rows — unlike the day strip, whose tiles
  // are proportional to how many hours each day covers.
  const tileWidth = hourTiles[0].getBoundingClientRect().width;
  const neededHour = hourTiles.reduce((widest, tile) => {
    const label = tile.querySelector('.hour-strip__label');
    return label ? Math.max(widest, label.getBoundingClientRect().width) : widest;
  }, 0);
  const neededPct = pctTiles.reduce((widest, tile) => {
    const value = tile.querySelector('.pct-row__value');
    return value ? Math.max(widest, value.getBoundingClientRect().width) : widest;
  }, 0);
  const needed = Math.max(neededHour, neededPct);

  if (tileWidth >= needed + 2) {
    return;
  }

  // Too tight for every hour: keep only every second column's content in
  // both rows. The columns themselves stay put and stay the same width —
  // only `visibility` toggles — so neither row loses its column-for-column
  // alignment with the chart underneath or with each other.
  hourTiles.forEach((tile, index) => {
    tile.classList.toggle('hour-strip__tile--thin2', index % 2 !== 0);
  });
  pctTiles.forEach((tile, index) => {
    tile.classList.toggle('pct-row__tile--thin2', index % 2 !== 0);
  });

  // A thinned column is exactly as wide as before (thinning hides content, it
  // does not merge columns), so whether every second column now has enough
  // room again depends on the same needed-width measurement, not on a second
  // guess.
  if (tileWidth >= needed + 2) {
    return;
  }

  hourTiles.forEach((tile, index) => {
    tile.classList.remove('hour-strip__tile--thin2');
    tile.classList.toggle('hour-strip__tile--thin3', index % 3 !== 0);
  });
  pctTiles.forEach((tile, index) => {
    tile.classList.remove('pct-row__tile--thin2');
    tile.classList.toggle('pct-row__tile--thin3', index % 3 !== 0);
  });
}

// `entries` is the day view's own `data.entries` (computeMeteogramData in
// mode 'today') — one per hour, already starting at local midnight, same
// order the chart's x-axis uses. The axis below carries no labels of its own
// in the day view (see buildMeteogramChartConfig), so this strip is what
// tells the reader which hour each column is — just the hour number, no
// minutes or colon, since every entry always falls on the hour.
//
// The trailing "24" (see .hour-strip__end / alignHourStrip) belongs to no
// hour column — it marks where the plot area itself ends, so a reader who
// only glances at the numbers still recognizes them as a 0-24 time axis
// rather than, say, a bare hour count.
export function renderHourStrip({ entries, language } = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    return nothing;
  }

  return html`
    <div class="hour-strip">
      ${entries.map((entry) => {
        const hour = new Date(entry.datetime).getHours();
        return html`
          <div class="hour-strip__tile">
            <ha-icon
              class="hour-strip__icon"
              style="color: ${conditionColor(entry.condition)}"
              .icon=${conditionIcon(entry.condition)}
            ></ha-icon>
            <span class="hour-strip__label">${hour.toLocaleString(language)}</span>
          </div>
        `;
      })}
      <span class="hour-strip__end">24</span>
    </div>
  `;
}

// The rain-probability row below the day chart, one column per hour, aligned
// to the same plot area and thinned in lockstep with the hour strip above the
// chart (see alignHourStrip). Sits where the x-axis's own hour labels would
// otherwise go, so it doubles as that axis's replacement.
export function renderPctRow({ entries, language } = {}) {
  if (!Array.isArray(entries) || !entries.length) {
    return nothing;
  }

  return html`
    <div class="pct-row">
      ${entries.map((entry) => {
        const pct = roundedProbability(entry.precipitation_probability);

        return html`
          <div class="pct-row__tile">
            <span
              class="pct-row__value"
              style="opacity: ${probabilityOpacity(pct)}"
            >${pct == null ? '–' : `${pct.toLocaleString(language)} %`}</span>
          </div>
        `;
      })}
    </div>
  `;
}
