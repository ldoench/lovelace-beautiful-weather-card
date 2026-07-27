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

  /* One tile per day, each exactly as wide as that day's stretch of the chart
     below. No gaps and no scrolling: the strip is a header for the plot area,
     and its horizontal padding is set from the chart's own layout (see
     alignDayStrip in day-strip.js). */
  .day-strip {
    display: flex;
    align-items: flex-start;
    gap: 0;
    padding: 0 0 6px;
    margin: 0;
  }

  /* Tiles carry no chrome at all — no border, no fill. Only their content is
     visible, the way the app template shows it. */
  .day-strip__tile {
    appearance: none;
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 2px 1px 4px;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--primary-text-color);
    font: inherit;
    line-height: 1.2;
    overflow: hidden;
    cursor: pointer;
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

  /* A part-day at the start of the overview owns only a sliver of the chart.
     Its tile keeps that width and drops what no longer fits, instead of
     clipping glyphs in half. */
  .day-strip__tile--tight .day-strip__temps {
    display: none;
  }

  .day-strip__tile--sliver .day-strip__icon,
  .day-strip__tile--sliver .day-strip__label {
    display: none;
  }

  /* Value bar between strip and chart: hairline-boxed single line, grey labels,
     values in text colour. Fixed height keeps the chart from jumping when the
     selected hour has fewer values. */
  .detail {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 14px;
    min-height: 22px;
    padding: 4px 0 5px;
    margin-bottom: 4px;
    border-top: 1px solid var(--divider-color);
    border-bottom: 1px solid var(--divider-color);
    font-size: 11px;
    line-height: 1.4;
    color: var(--secondary-text-color);
  }

  .detail .time {
    font-size: 13px;
    font-weight: 500;
    color: var(--primary-text-color);
    min-width: 3.2em;
  }

  .detail .item {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
  }

  .detail .item b {
    font-size: 13px;
    font-weight: 400;
    color: var(--primary-text-color);
  }

  .chart-wrap {
    position: relative;
    width: 100%;
  }

  .chart-wrap--clickable {
    cursor: pointer;
  }

  .day-nav {
    display: flex;
    align-items: stretch;
    gap: 4px;
    margin: 6px 0 0;
  }

  .day-nav__button {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 8px;
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    background: transparent;
    color: var(--primary-text-color);
    font: inherit;
    font-size: 12px;
    line-height: 1.2;
    cursor: pointer;
    transition: background-color 100ms ease, border-color 100ms ease;
  }

  .day-nav__button:hover:not(:disabled) {
    background: var(--secondary-background-color);
  }

  .day-nav__button:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 1px;
  }

  .day-nav__button:disabled {
    color: var(--secondary-text-color);
    opacity: 0.45;
    cursor: default;
  }

  .day-nav__button ha-icon {
    --mdc-icon-size: 18px;
  }

  /* The middle button carries a label, the arrows only an icon. */
  .day-nav__overview {
    flex: 1 1 auto;
  }

  .message {
    padding: 12px 0;
    color: var(--secondary-text-color);
    font-size: 13px;
  }
`;
