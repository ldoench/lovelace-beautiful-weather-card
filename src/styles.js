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

  /* Day navigation row: back/forward arrows in fixed-width edge columns so the
     weekday/date label between them sits at the row's true horizontal
     center, not merely between two same-content buttons (which drifted
     off-center once one arrow's disabled state changed nothing about its
     width, but real optical centering still depends on both edges matching).
     Fixed height, nothing else in the row — the four value columns this used
     to carry (temperature, precipitation, probability, wind) are gone; their
     per-hour values now live in the chart's own tooltip instead. Sits at the
     very top of the day view in place of the header (see the block-order
     note on _renderHeader in main.js), so it only needs the one divider
     below it, not one on both sides the way it did back when the header sat
     above it too. */
  .day-nav {
    display: grid;
    grid-template-columns: 24px 1fr 24px;
    align-items: center;
    height: 26px;
    padding: 0;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--divider-color);
    font-variant-numeric: tabular-nums;
  }

  .day-nav__arrow {
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

  .day-nav__arrow ha-icon {
    --mdc-icon-size: 18px;
  }

  .day-nav__arrow:disabled {
    color: var(--secondary-text-color);
    opacity: 0.45;
    cursor: default;
  }

  .day-nav__arrow:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: -1px;
  }

  /* Weekday + date of the day currently shown, centered in the middle grid
     track between the two fixed-width arrow columns. A real button (see
     _renderDayNav in main.js) that returns to the overview — bold rather than
     accent-colored, so it reads as regular header text rather than a link;
     that it is clickable comes across through cursor, title/aria-label and
     the hover below instead of through color. */
  .day-nav__date {
    appearance: none;
    min-width: 0;
    overflow: hidden;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: center;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    color: var(--primary-text-color);
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .day-nav__date:hover {
    opacity: 0.7;
  }

  .day-nav__date:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: -1px;
  }

  /* Hour strip: one column per hour of the day chart below, condition icon
     above the hour number — the DWD app's own per-hour header row. No
     day-boundary dividers (unlike day-strip, there is only one day here).
     Icons are colored the same way the day strip's are (see conditionColor in
     const.js) — real-instance feedback was that neutral icons here read as an
     inconsistency against the day strip rather than a deliberate restraint.
     Kept flat/low-height per that same feedback: small icon, small label,
     barely-there padding, no bottom padding at all so the row sits flush
     against the chart below it (see also .pct-row and .band-wrap, which give
     up their own padding/margin the same way). The rain probability that used
     to sit here now lives in .pct-row below the chart instead, sharing this
     row's thinning decision (see alignHourStrip in hour-strip.js) so the two
     rows are always in step. position: relative anchors .hour-strip__end
     (below), the "24" marker past the last hour column. */
  .hour-strip {
    position: relative;
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 2px 0 0;
    margin: 0;
  }

  .hour-strip__tile {
    box-sizing: border-box;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .hour-strip__icon {
    --mdc-icon-size: 13px;
    flex: 0 0 auto;
  }

  .hour-strip__label {
    font-size: 9px;
    color: var(--secondary-text-color);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* The "24" end-of-day marker: not a flex child (adding one would steal width
     from the 24 equal-share hour tiles and shift their column alignment with
     the chart below — see renderHourStrip/alignHourStrip in hour-strip.js),
     so it is positioned out of flow instead. The 'right' offset is set inline
     per layout to land flush with the plot area's right edge; 'bottom: 0'
     lines its baseline up with the hour tiles' own labels, which — now that
     the row has no bottom padding — sit flush with the row's own bottom edge
     too. */
  .hour-strip__end {
    position: absolute;
    bottom: 0;
    font-size: 9px;
    color: var(--secondary-text-color);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  /* Too narrow for all 24 columns' content at once: every second (then, if
     still too tight, every third) column's content is hidden via visibility
     rather than the tile itself being removed or resized, so the columns
     stay put and stay aligned with the chart below and with .pct-row's own
     columns (see alignHourStrip in hour-strip.js). */
  .hour-strip__tile--thin2,
  .hour-strip__tile--thin3 {
    visibility: hidden;
  }

  /* Percentage row below the day chart, in the space the x-axis's own hour
     labels would otherwise occupy there (see the day view's ticks option in
     buildMeteogramChartConfig). Same column geometry as .hour-strip above the
     chart, aligned and thinned together with it — see alignHourStrip in
     hour-strip.js — so a column is never left with an icon in one row and
     nothing lining up with it in the other. */
  .pct-row {
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0;
    margin: 0;
  }

  .pct-row__tile {
    box-sizing: border-box;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    justify-content: center;
  }

  /* 0% sits at its lightest (still legible, not invisible) and 100% at
     var(--secondary-text-color) itself — never darker, i.e. never as
     prominent as primary text — by scaling this element's opacity rather
     than interpolating a color; see probabilityOpacity() in hour-strip.js. */
  .pct-row__value {
    font-size: 10px;
    color: var(--secondary-text-color);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .pct-row__tile--thin2,
  .pct-row__tile--thin3 {
    visibility: hidden;
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
    /* ease-out: starts at full speed so the switch reads as immediate,
       instead of the slow-in of a plain ease easing into a change that's
       already over 120ms later. */
    transition: opacity 120ms ease-out;
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
     (its arrows now flank .day-nav instead). Sits below the chart now, not
     above it: top margin is the breathing room against the plot, and there is
     deliberately no bottom margin — ha-card's own 6px bottom padding is what
     keeps this flush with the card edge. Height comes from render()'s inline
     style (a fraction of chart_height); position: relative plus that
     explicit height is what lets Chart.js's responsive option size the
     canvas inside it. Clicking a day loads it, clicking the day already open
     returns to the overview — both handled by the band chart's own onClick
     via onSelect (see _onBandSelect in main.js), not by an element listener
     here, since which day was tapped now matters. */
  .band-wrap {
    position: relative;
    width: 100%;
    margin: 2px 0 0;
    cursor: pointer;
  }

  .message {
    padding: 12px 0;
    color: var(--secondary-text-color);
    font-size: 13px;
  }
`;
