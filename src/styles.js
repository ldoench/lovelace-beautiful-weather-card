import { css } from 'lit';

// Visual language follows the DWD-Warnwetter app: dense rows, flat surfaces,
// hairline dividers instead of elevation, small grey labels next to large light
// numbers. Colour belongs to the chart alone — every surface here is built from
// HA theme variables so light and dark themes both hold up.
export const cardStyles = css`
  :host {
    display: block;
  }

  ha-card {
    padding: 10px 12px 6px;
    overflow: hidden;
    font-variant-numeric: tabular-nums;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-bottom: 8px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--divider-color);
  }

  .header .icon {
    --mdc-icon-size: 28px;
    color: var(--primary-text-color);
    flex: 0 0 auto;
  }

  .header .titles {
    flex: 1 1 auto;
    min-width: 0;
  }

  .header .name {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header .place {
    font-size: 11px;
    line-height: 1.3;
    color: var(--secondary-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header .temp {
    font-size: 32px;
    font-weight: 200;
    line-height: 1;
    letter-spacing: -0.01em;
    flex: 0 0 auto;
  }

  /* header_extras: up to two small values left of the temperature, in
     configuration order (see HEADER_EXTRAS_MAX / _renderHeader in main.js). A
     slot with no value right now is left out of the DOM entirely rather than
     rendered empty — the header's height already comes from the icon and
     temperature next to these, so nothing here needs to reserve space. */
  .header .header__extra {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--secondary-text-color);
    font-size: 12px;
    white-space: nowrap;
  }

  .header .header__extra-icon {
    --mdc-icon-size: 16px;
    flex: 0 0 auto;
  }

  /* One tile per day, each exactly as wide as that day's stretch of the chart
     below. No gaps and no scrolling: the strip is a header for the plot area,
     and its horizontal padding is set from the chart's own layout (see
     alignDayStrip in day-strip.js). align-items: stretch (rather than
     flex-start) gives every tile the same height regardless of how much of
     its content --tight/--sliver hide, so the day-boundary divider below
     always runs the full height of the row, not just of that tile's own
     content. */
  .day-strip {
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0;
    margin: 0;
  }

  /* Tiles carry no chrome of their own beyond the day-boundary divider — no
     fill. Only their content (plus that divider) is visible, the way the app
     template shows it. box-sizing: border-box is what lets the divider below
     be a border without changing the tile's width: flexbox sizes border-box
     items by their outer edge, so the 1px border is absorbed from the
     content box instead of adding to the width alignDayStrip lined up
     against the chart. The bottom padding carries the 6px gap that used to
     sit on .day-strip itself, so the divider (and the --active hairline)
     reach all the way down to the chart instead of stopping short of it. */
  .day-strip__tile {
    box-sizing: border-box;
    appearance: none;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 2px 1px 10px;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--primary-text-color);
    font: inherit;
    line-height: 1.2;
    overflow: hidden;
    cursor: pointer;
  }

  /* The day-boundary divider, carried down from the chart's own gridline so a
     tile and its chart segment read as one column. Skipped on the first
     tile: there is no previous segment to its left to separate from. */
  .day-strip__tile:not(:first-child) {
    border-left: 1px solid var(--divider-color);
  }

  .day-strip__tile:focus-visible {
    outline: 1px solid var(--secondary-text-color);
    outline-offset: -1px;
  }

  /* The selected day is marked by a hairline under the tile rather than a fill,
     so the row keeps its flat look. */
  .day-strip__tile--active {
    box-shadow: inset 0 -2px 0 var(--primary-text-color);
  }

  .day-strip__label {
    font-size: 11px;
    font-weight: 400;
    color: var(--secondary-text-color);
    white-space: nowrap;
  }

  .day-strip__tile--active .day-strip__label {
    color: var(--primary-text-color);
    font-weight: 500;
  }

  .day-strip__icon {
    --mdc-icon-size: 20px;
    margin: 1px 0;
    flex: 0 0 auto;
  }

  /* Sized so a "33° 21°" pair still leaves air inside a minimum-width tile. */
  .day-strip__temps {
    display: flex;
    gap: 3px;
    font-size: 12px;
    font-weight: 400;
    white-space: nowrap;
  }

  .day-strip__temps b {
    font-weight: 500;
  }

  .day-strip__min {
    color: var(--secondary-text-color);
  }

  /* Second, smaller line below min/max: daily precipitation total (sunshine
     hours would join it here if the forecast ever carries that field — see
     computeMeteogramData in meteogram/data.js). */
  .day-strip__extra {
    font-size: 10px;
    color: var(--secondary-text-color);
    white-space: nowrap;
  }

  /* A part-day at the start of the overview owns only a sliver of the chart.
     Its tile keeps that width and drops what no longer fits, instead of
     clipping glyphs in half. Shrink order: the precipitation row first, then
     min/max, then icon and label. */
  .day-strip__tile--compact .day-strip__extra {
    display: none;
  }

  .day-strip__tile--tight .day-strip__temps {
    display: none;
  }

  .day-strip__tile--sliver .day-strip__icon,
  .day-strip__tile--sliver .day-strip__label {
    display: none;
  }

  /* Value row between strip and chart: a fixed-column grid instead of the
     previous wrapping flex row. Every slot is always present (a missing value
     renders as "–", never as nothing), and the grid tracks are sized by
     minmax(0, 1fr) or a fixed width rather than by their content, so neither a
     one-digit/three-digit value nor "Jetzt" vs. a five-character time ever
     changes a column's width. Combined with a fixed height (not a
     min-height), that is what keeps the row from jumping or rewrapping on
     every hover — including the day-nav arrows now living at its outer edges,
     which flip between enabled and disabled without moving anything next to
     them. Icons replace spelled-out labels so the row never wraps on narrow
     cards. */
  .detail {
    display: grid;
    grid-template-columns: 24px 7.5em repeat(4, minmax(0, 1fr)) 24px;
    align-items: center;
    column-gap: 8px;
    height: 26px;
    padding: 0;
    margin-bottom: 4px;
    border-top: 1px solid var(--divider-color);
    border-bottom: 1px solid var(--divider-color);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
  }

  /* Day-nav's back/forward arrows, now flanking the detail row instead of
     sitting in a row of their own below the chart. */
  .detail__nav {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--primary-text-color);
    cursor: pointer;
  }

  .detail__nav ha-icon {
    --mdc-icon-size: 18px;
  }

  .detail__nav:disabled {
    color: var(--secondary-text-color);
    opacity: 0.45;
    cursor: default;
  }

  .detail__nav:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: -1px;
  }

  /* Weekday + date of the day currently shown, with the hovered hour's time
     (or "Jetzt") beside it — a quiet spot for that read-out now that it no
     longer heads the row on its own. */
  .detail__date {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }

  .detail__weekday {
    font-size: 13px;
    font-weight: 500;
    color: var(--primary-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .detail__time {
    font-size: 11px;
    color: var(--secondary-text-color);
    white-space: nowrap;
  }

  .detail__item {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .detail__icon {
    --mdc-icon-size: 16px;
    color: var(--secondary-text-color);
    flex: 0 0 auto;
  }

  .detail__value {
    font-size: 13px;
    color: var(--primary-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chart-wrap {
    position: relative;
    width: 100%;
    /* Clips the sliding/zooming .chart-anim content below so a transition
       never grows the card or is visible outside the chart area. */
    overflow: hidden;
  }

  .chart-wrap--clickable {
    cursor: pointer;
  }

  /* Wraps the canvas so a mode switch (see _fadeSwitch in main.js) can
     crossfade this layer alone: chart-wrap keeps its own fixed height
     throughout, so neither the card nor the day strip above it ever moves.
     The class is toggled imperatively from main.js rather than bound in the
     Lit template, so it survives the re-render that swaps the chart
     underneath. Day-to-day navigation no longer touches this element at all —
     see .chart-swipe-mask below — so the only motion left here is opacity. */
  .chart-anim {
    width: 100%;
    height: 100%;
    transition: opacity 180ms ease;
  }

  .chart-anim--fade-hidden {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .chart-anim {
      transition: none;
    }
  }

  /* Day-to-day swipe (see _slideSwitch in main.js): an overlay pinned exactly
     over the chart's plot area — the axes, ticks and gridline labels around it
     are deliberately outside this rectangle and stay put. It hides the live
     canvas underneath (own background, so the rebuild behind it is invisible)
     while .chart-swipe-track slides two frozen bitmaps of the plot — the day
     being left, the day being entered — past each other. Position/size are set
     inline per switch, since they come from the chart's own measured layout. */
  .chart-swipe-mask {
    position: absolute;
    overflow: hidden;
    background: var(--card-background-color);
    pointer-events: none;
  }

  .chart-swipe-track {
    display: flex;
    height: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .chart-swipe-track {
      transition: none;
    }
  }

  /* The compact week band under the day chart, replacing the old day-nav row
     (its arrows now flank .detail instead, its "Overview" button is this
     whole element). Sits below the chart now, not above it: top margin is the
     breathing room against the plot, and there is deliberately no bottom
     margin — ha-card's own 6px bottom padding is what keeps this flush with
     the card edge. Height comes from render()'s inline style (a fraction of
     chart_height); position: relative plus that explicit height is what lets
     Chart.js's responsive option size the canvas inside it. Click handling
     for "return to overview" is a plain element listener rather than the
     chart's own onClick, since a tap anywhere on the band should work, not
     only where the chart resolves a data index. */
  .band-wrap {
    position: relative;
    width: 100%;
    margin: 8px 0 0;
    cursor: pointer;
  }

  .message {
    padding: 12px 0;
    color: var(--secondary-text-color);
    font-size: 13px;
  }
`;
