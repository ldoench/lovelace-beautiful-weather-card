import { Tooltip } from 'chart.js';
import { DEFAULT_PRECIP_BANDS, DEFAULT_TEMP_STOPS, buildTempGradient, colorAtTemp, precipBandColor } from './colors.js';

// `interaction: { mode: 'index', intersect: false }` collects every dataset at
// the hovered index — the temperature line and every stacked precipitation bar
// — and Chart.js's default 'average' positioner places the tooltip at the mean
// of their pixel y, which the bars drag toward the bottom. This positioner
// ignores the bars and follows the temperature point instead, falling back to
// the raw event position if that point is ever unavailable.
//
// It also fixes the alignment: `yAlign: 'bottom'` puts the box's own bottom
// edge at the point, i.e. the box sits above the curve, flipping to below only
// when there isn't room above — estimated from the previous frame's own
// height, since Chart.js resolves this position before it measures the new
// box, so an exact height isn't available yet. `xAlign` stays centered
// either way. Whatever the alignment, Chart.js clamps the drawn box to the
// canvas itself (see `getBackgroundPoint`'s `_limitValue` calls in its
// source) — it can overhang into the axis label area but can never be cut off
// at the canvas edge, so there is nothing more to do here for that case.
Tooltip.positioners.meteogramCurve = function meteogramCurve(items, eventPosition) {
  if (!items.length) {
    return eventPosition;
  }

  const chart = this.chart;
  const meta = chart.getDatasetMeta(0);
  const point = meta && meta.data && meta.data[items[0].dataIndex];
  if (!point) {
    return eventPosition;
  }

  const estimatedHeight = (this._size && this._size.height) || 70;
  const yAlign = (point.y - chart.chartArea.top) < estimatedHeight ? 'top' : 'bottom';

  return { x: point.x, y: point.y, xAlign: 'center', yAlign };
};

// Both axes snap to a fixed ladder instead of tracking the data continuously, so
// the chart looks the same from day to day and only changes when a real threshold
// is crossed. A continuously fitted axis would drift on every forecast update.
const PRECIP_AXIS_STEPS = [2, 5, 10, 20, 50, 100];
const TEMP_AXIS_STEP = 5;
// The overview is meant to be read at a glance, so it gets a wider axis: the same
// curve comes out visibly flatter and the day-to-day trend stands out instead of
// every night's dip. Detail belongs to the day view, which keeps the tight span.
// Done through the value range rather than the height so the card does not change
// size when switching between the two.
const TEMP_AXIS_MIN_SPAN = { today: 10, trend: 28 };
const MAX_BAND_LABELS = 4;

function cssVar(name, fallback) {
  const value = getComputedStyle(document.body).getPropertyValue(name);
  return value && value.trim() ? value.trim() : fallback;
}

// data.js emits {x, y} points keyed by bucket start time, which in trend mode is
// coarser than the hourly temperature line. Map them onto the label index so both
// series share one category axis, comparing parsed timestamps rather than strings.
function alignToLabels(points, labels) {
  const index = new Map();
  labels.forEach((label, i) => index.set(Date.parse(label), i));

  const aligned = new Array(labels.length).fill(null);
  points.forEach((point) => {
    const i = index.get(Date.parse(point.x));
    if (i !== undefined) {
      aligned[i] = point.y;
    }
  });

  return aligned;
}

function axisMax(alignedBands) {
  let observed = 0;

  if (alignedBands.length) {
    alignedBands[0].forEach((_, index) => {
      const total = alignedBands.reduce((sum, series) => sum + (series[index] || 0), 0);
      observed = Math.max(observed, total);
    });
  }

  return PRECIP_AXIS_STEPS.find((step) => step >= observed)
    || Math.ceil(observed / 100) * 100;
}

// Rounds outward to whole steps and keeps a minimum span, so a calm day with a
// three-degree swing does not get blown up to fill the whole height. The edges
// stay snug against the data — a step is only added on a side when the data
// would otherwise sit right on it — and any extra span the minSpan still
// requires is added below the coldest reading rather than above the hottest
// one. Growing the top edge on every shortfall was how a 35.6° day ended up
// with a 45° axis; growing downward instead leaves the ceiling wherever the
// data actually put it, which is also why the tick callback below has to
// blank out labels above the real maximum.
function tempBounds(values, minSpan) {
  if (!values.length) {
    return { min: 0, max: minSpan };
  }

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);

  let min = Math.floor(dataMin / TEMP_AXIS_STEP) * TEMP_AXIS_STEP;
  let max = Math.ceil(dataMax / TEMP_AXIS_STEP) * TEMP_AXIS_STEP;
  if (max - dataMax < 1) {
    max += TEMP_AXIS_STEP;
  }
  if (dataMin - min < 1) {
    min -= TEMP_AXIS_STEP;
  }

  while (max - min < minSpan) {
    min -= TEMP_AXIS_STEP;
  }

  return { min, max };
}

// Keeps the temperature axis still while paging between days: it only moves
// when the data actually stops fitting, or when the current range has grown
// needlessly wide (which happens once the data that justified it scrolls
// away). Without `previous` this is just `tempBounds`. When it does move, the
// side that was exceeded gets rounded outward by one extra step so the next
// few days are likely to still fit, instead of jumping again immediately.
export function nextTempRange(previous, values, minSpan) {
  if (!previous) {
    return tempBounds(values, minSpan);
  }

  if (!values.length) {
    return previous;
  }

  const min = Math.min(...values) - 1;
  const max = Math.max(...values) + 1;
  const fits = min >= previous.min && max <= previous.max;

  const tight = tempBounds(values, minSpan);
  const prevSpan = previous.max - previous.min;
  const tightSpan = tight.max - tight.min;
  const tooWide = prevSpan - tightSpan > 10;

  if (fits && !tooWide) {
    return previous;
  }

  let { min: newMin, max: newMax } = tight;
  if (newMin < previous.min) {
    newMin -= TEMP_AXIS_STEP;
  }
  if (newMax > previous.max) {
    newMax += TEMP_AXIS_STEP;
  }

  return { min: newMin, max: newMax };
}

// Category labels sit at the middle of their band rather than at the boundaries.
// Only bands actually visible on the current axis get a label, and at most
// MAX_BAND_LABELS of those, so the right-hand axis never crowds. The lowest band
// never gets a label at all (index > 0) — it sits right against the x-axis, so
// its text is the widest cost driver for the axis while telling readers the
// least; dropping it lets the plot area claim that width instead.
function bandTicks(bands, max, localize) {
  const visible = bands
    .map((band, index) => {
      const upper = Number.isFinite(band.to) ? Math.min(band.to, max) : max;
      return { value: (band.from + upper) / 2, label: band.label, index };
    })
    .filter((tick) => tick.index > 0 && tick.value > 0 && tick.value < max);

  if (visible.length <= MAX_BAND_LABELS) {
    return visible.map((tick) => ({ ...tick, label: localize(tick.label) || tick.label }));
  }

  const step = (visible.length - 1) / (MAX_BAND_LABELS - 1);
  const picked = [];
  for (let i = 0; i < MAX_BAND_LABELS; i++) {
    const tick = visible[Math.round(i * step)];
    if (tick && !picked.includes(tick)) {
      picked.push(tick);
    }
  }

  return picked.map((tick) => ({ ...tick, label: localize(tick.label) || tick.label }));
}

// Chart.js's own hover point is suppressed everywhere (see pointHoverRadius
// below) because its grow/fade animation reads as a stray flicker rather than a
// highlight. This draws a plain, static dot instead — same radius every frame,
// no animation — colored to match the curve at that index via the temperature
// gradient logic, with a thin ring in the card background color so it stands
// out against the line underneath it.
//
// Runs in both today and trend mode without any mode check — it only depends
// on `getActiveIndex`, which is null whenever the caller has no hover to
// report, so it is the card side (main.js) that decides per mode whether
// anything is wired up, not this plugin. Kept visually distinct from the
// "now" divider, which marks the fixed measured/forecast boundary rather than
// the mouse: the divider is dialed down to 40% opacity, so this stays at full
// opacity and a touch thicker.
function crosshairPlugin(getIndex, lineColor, pointColor, ringColor) {
  return {
    id: 'meteogramCrosshair',
    afterDatasetsDraw(chart) {
      const index = getIndex();
      if (index == null) {
        return;
      }

      const meta = chart.getDatasetMeta(0);
      const point = meta && meta.data && meta.data[index];
      if (!point) {
        return;
      }

      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = lineColor;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = typeof pointColor === 'function' ? pointColor(index) : pointColor;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ringColor;
      ctx.stroke();
      ctx.restore();
    },
  };
}

// Reports where the plot area sits as soon as Chart.js has measured its axes, so
// the day strip above can be padded to the same edges. `afterLayout` rather than
// `afterRender`: it fires before the first paint and on every resize, and the
// callback only touches DOM outside the chart, so there is nothing to loop back.
// Reports the full chartArea rect (left/right/top/bottom) plus the chart's own
// width/height, so a swipe overlay can be sized against the plot area exactly —
// left/right/width keep their existing meaning for callers that only used those.
function layoutReportPlugin(onLayout) {
  return {
    id: 'meteogramLayout',
    afterLayout(chart) {
      const area = chart.chartArea;
      if (!area) {
        return;
      }
      onLayout({
        left: area.left,
        right: area.right,
        top: area.top,
        bottom: area.bottom,
        width: chart.width,
        height: chart.height,
      });
    },
  };
}

// Calendar-day boundaries over the flat entries array, grouped in order of first
// appearance — the same order `sliceForecast`'s `day_offset` counts in (0 =
// today). Kept local to chart.js instead of reusing data.js's `groupByDay`
// because only index ranges are needed here, not the aggregates that helper
// also computes.
function dayBoundaries(entries) {
  const days = [];
  let lastKey = null;

  entries.forEach((entry, index) => {
    const date = new Date(entry.datetime);
    const key = date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate();
    if (key !== lastKey) {
      days.push({ startIndex: index, endIndex: index });
      lastKey = key;
    } else {
      days[days.length - 1].endIndex = index;
    }
  });

  return days;
}

// Compact mode's overview band shows which day is currently open in the day
// view above it. Two earlier attempts were rejected: a stripe under the
// active day in the accent color read too much like a precipitation bar, and
// a plain background tint on the active day itself was rejected too. Inverted
// instead — every *inactive* day gets tinted toward the card background so it
// recedes, leaving the active day untouched, plus a plain 2px baseline in the
// neutral text color (not the accent color, so it still can't be mistaken for
// a precip bar). Drawn in `afterDatasetsDraw` rather than before: the tint has
// to sit on top of the curve and bars to actually dim them, not be painted
// over by them.
function activeDayPlugin(entries, activeDay, baselineColor, overlayColor) {
  return {
    id: 'meteogramActiveDay',
    afterDatasetsDraw(chart) {
      const days = dayBoundaries(entries);
      const meta = chart.getDatasetMeta(0);
      const { ctx, chartArea } = chart;

      days.forEach((day, index) => {
        const startPoint = meta && meta.data && meta.data[day.startIndex];
        const endPoint = meta && meta.data && meta.data[day.endIndex];
        if (!startPoint || !endPoint) {
          return;
        }

        if (index !== activeDay) {
          ctx.save();
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = overlayColor;
          ctx.fillRect(
            startPoint.x, chartArea.top,
            endPoint.x - startPoint.x, chartArea.bottom - chartArea.top,
          );
          ctx.restore();
          return;
        }

        ctx.save();
        ctx.fillStyle = baselineColor;
        ctx.fillRect(startPoint.x, chartArea.bottom - 2, endPoint.x - startPoint.x, 2);
        ctx.restore();
      });
    },
  };
}

function xTickCallback(entries, mode, language) {
  return function tick(value, index) {
    const entry = entries[index];
    if (!entry) {
      return '';
    }

    const date = new Date(entry.datetime);

    if (mode === 'trend') {
      // Only label midnight, so the axis carries one weekday per day.
      if (date.getHours() !== 0) {
        return '';
      }
      return date.toLocaleDateString(language, { weekday: 'short' });
    }

    if (date.getHours() % 3 !== 0) {
      return '';
    }

    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  };
}

// Marks where the recorded hours end and the forecast begins. Three things used
// to compete here — a shaded block, a thick line and the two words "Messwerte"
// and "Prognose" flanking it. Now the shading is barely-there tint that only
// says "this part already happened", the line is a plain hairline, and a single
// small "Jetzt" names the line instead of labelling both regions. Drawn before
// the datasets, so nothing of it can ever sit on top of the curve.
// Does nothing when no measured values are configured. `showLabel` drops just the
// "now" text for the compact overview band, which keeps the hairline but has no
// room for a caption.
function nowDividerPlugin(entries, localize, lineColor, showLabel = true) {
  return {
    id: 'meteogramNowDivider',
    beforeDatasetsDraw(chart) {
      const lastMeasured = entries.reduce((acc, entry, i) => (entry.measured ? i : acc), -1);
      if (lastMeasured < 0) {
        return;
      }

      const meta = chart.getDatasetMeta(0);
      const point = meta && meta.data && meta.data[lastMeasured];
      if (!point) {
        return;
      }

      const { ctx, chartArea } = chart;
      ctx.save();

      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = lineColor;
      // The line itself is dialed back so it reads as a subtle marker rather
      // than a hard divider; the "Jetzt" label below stays at full opacity.
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (!showLabel) {
        ctx.restore();
        return;
      }

      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = lineColor;
      ctx.textBaseline = 'top';
      // Right of the line where there is room, otherwise left of it — the line
      // sits at the current hour and can be close to either edge.
      const label = localize('now');
      const fits = point.x + ctx.measureText(label).width + 8 < chartArea.right;
      ctx.textAlign = fits ? 'left' : 'right';
      ctx.fillText(label, point.x + (fits ? 4 : -4), chartArea.top + 1);

      ctx.restore();
    },
  };
}

export function buildMeteogramChartConfig({
  data, mode, cardConfig, language, localize, onSelect, onLayout, onHover, getActiveIndex,
  animate = true, compact = false, activeDay = null, tempRange: suppliedTempRange = null,
}) {
  const entries = data.entries;
  const bands = cardConfig.precip_bands || DEFAULT_PRECIP_BANDS;
  const stops = cardConfig.temperature_gradient || DEFAULT_TEMP_STOPS;

  const labels = entries.map((entry) => entry.datetime);
  const temperatures = data.temperatures;
  const known = temperatures.filter((value) => value != null);
  // The axis itself may run a step past the data on either side (see
  // tempBounds), to keep a visual buffer — but a label out there reads as
  // "the forecast reaches this high/low," which it doesn't. Kept separately
  // from tempRange, which is the rounded axis range, not the raw data extent.
  const dataTempMin = known.length ? Math.min(...known) : null;
  const dataTempMax = known.length ? Math.max(...known) : null;
  const alignedBands = data.precipBands.map((series) => alignToLabels(series, labels));
  const precipMax = axisMax(alignedBands);
  // What the stacked bar at an index actually adds up to — the tooltip reports
  // that single number instead of one line per band dataset.
  const precipTotals = labels.map((_, index) => (
    alignedBands.reduce((sum, series) => sum + (series[index] || 0), 0)
  ));
  const tempRange = suppliedTempRange
    || tempBounds(known, TEMP_AXIS_MIN_SPAN[mode] || TEMP_AXIS_MIN_SPAN.today);
  const visibleBandTicks = bandTicks(bands, precipMax, localize);
  const bucketHours = mode === 'trend' ? (cardConfig.trend_bucket_hours || 3) : 1;

  const textColor = cssVar('--primary-text-color', '#212121');
  const secondaryColor = cssVar('--secondary-text-color', '#727272');
  const gridColor = cssVar('--divider-color', 'rgba(127,127,127,0.25)');
  const cardBackgroundColor = cssVar('--card-background-color', '#ffffff');
  const activePointColor = (index) => {
    const temp = temperatures[index];
    return temp != null ? colorAtTemp(temp, stops) : textColor;
  };

  const datasets = [
    {
      type: 'line',
      label: localize('temperature'),
      data: temperatures,
      yAxisID: 'temp',
      order: 0,
      borderWidth: compact ? 1.5 : 2.5,
      segment: {
        borderWidth: (ctx) => {
          const p0 = entries[ctx.p0DataIndex];
          const p1 = entries[ctx.p1DataIndex];
          const bothMeasured = p0 && p1 && p0.measured && p1.measured;
          return compact
            ? (bothMeasured ? 1 : 1.5)
            : (bothMeasured ? 1.5 : 2.5);
        },
      },
      tension: 0.35,
      pointRadius: 0,
      pointHitRadius: 12,
      // The hover dot Chart.js normally draws on the active point reads as a
      // stray mark rather than a highlight — suppressed everywhere, not just in
      // compact mode. `pointHitRadius` stays untouched: the card's detail row
      // still needs hover to work.
      pointHoverRadius: 0,
      hoverRadius: 0,
      pointHoverBorderWidth: 0,
      fill: false,
      borderColor: (context) => {
        const { ctx, chartArea, scales } = context.chart;
        return buildTempGradient(ctx, chartArea, scales.temp, stops);
      },
    },
  ];

  alignedBands.forEach((series, index) => {
    datasets.push({
      type: 'bar',
      label: bands[index].label,
      data: series,
      yAxisID: 'precip',
      order: 1 + index,
      stack: 'precip',
      backgroundColor: precipBandColor(index, bands),
      borderWidth: 0,
      // A trend bar covers a whole bucket, so it spans that many categories.
      barPercentage: bucketHours * 0.9,
      categoryPercentage: 1.0,
    });
  });

  return {
    type: 'bar',
    data: { labels, datasets },
    plugins: [
      nowDividerPlugin(entries, localize, secondaryColor, !compact),
      crosshairPlugin(
        () => (getActiveIndex ? getActiveIndex() : null),
        secondaryColor,
        activePointColor,
        cardBackgroundColor,
      ),
      ...(activeDay != null ? [activeDayPlugin(entries, activeDay, textColor, cardBackgroundColor)] : []),
      ...(onLayout ? [layoutReportPlugin(onLayout)] : []),
    ],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      // Off for chart rebuilds triggered by day/mode navigation — main.js already
      // plays its own slide/zoom transition on the surrounding element for that
      // case, and Chart.js's own entrance animation (drawing up from the axis) is
      // exactly the "jumps in from below" the card used to be criticized for. A
      // plain data refresh (new forecast, same mode/day) still gets the fade.
      animation: animate ? { duration: 250 } : false,
      interaction: { mode: 'index', intersect: false },
      // `intersect: false` means a tap anywhere in the plot area counts, not just
      // on the curve. In the trend view the card turns that index into a day and
      // navigates; in the day view it moves the read-out crosshair.
      onClick: (event, elements, chart) => {
        const points = chart.getElementsAtEventForMode(event, 'index', { intersect: false }, true);
        if (!points.length) {
          return;
        }

        if (onSelect) {
          onSelect(points[0].index);
        }
      },
      ...(onHover ? {
        onHover: (event, elements) => onHover(elements.length ? elements[0].index : null),
      } : {}),
      scales: {
        x: {
          stacked: true,
          grid: {
            // Compact's overview band keeps the day dividers regardless of mode —
            // they are the only structure left once ticks/labels are gone.
            display: compact || mode === 'trend',
            drawTicks: false,
            color: (context) => {
              const entry = entries[context.index];
              if (!entry) {
                return 'transparent';
              }
              // In trend mode a line marks every midnight, separating the days.
              return new Date(entry.datetime).getHours() === 0 ? gridColor : 'transparent';
            },
          },
          border: { display: false },
          // The day view moves its hour labels into the hour strip above the
          // chart, so the axis itself carries no ticks there — only the trend
          // view's weekday labels stay.
          ticks: (compact || mode !== 'trend') ? { display: false } : {
            color: secondaryColor,
            maxRotation: 0,
            autoSkip: false,
            font: { size: 11 },
            callback: xTickCallback(entries, mode, language),
          },
        },
        temp: {
          position: 'left',
          // Horizontal guides are what make the curve readable at a glance — but
          // compact's whole point is to show nothing except the curve itself and
          // the day dividers, so they go along with the ticks there.
          grid: {
            display: !compact,
            drawTicks: false,
            color: gridColor,
          },
          border: { display: false, dash: [2, 3] },
          min: tempRange.min,
          max: tempRange.max,
          ticks: compact ? { display: false } : {
            color: secondaryColor,
            font: { size: 11 },
            stepSize: TEMP_AXIS_STEP,
            callback: (value) => {
              if (dataTempMax != null && (value > dataTempMax || value < dataTempMin)) {
                return '';
              }
              return `${Math.round(value)}°`;
            },
          },
        },
        precip: {
          position: 'right',
          // Already hidden in trend mode; compact hides it in day mode too, since
          // the overview band never shows band labels.
          display: compact ? false : mode !== 'trend',
          stacked: true,
          min: 0,
          max: precipMax,
          grid: { display: false, drawTicks: false },
          border: { display: false },
          afterBuildTicks: (axis) => {
            axis.ticks = visibleBandTicks.map((tick) => ({ value: tick.value }));
          },
          ticks: compact ? { display: false } : {
            color: secondaryColor,
            font: { size: 10 },
            autoSkip: false,
            callback: (value) => {
              const match = visibleBandTicks.find((tick) => tick.value === value);
              return match ? match.label : '';
            },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          // Was trend-only because the day view had its own hover row above the
          // chart; that row is going away, so the tooltip now carries the hourly
          // read-out in both modes. Compact stays off — there is no room for it.
          enabled: !compact,
          displayColors: false,
          // Follows the temperature point instead of Chart.js's default
          // 'average' positioner, which the stacked precipitation bars would
          // otherwise drag toward the bottom of the chart (see the
          // Tooltip.positioners.meteogramCurve registration above).
          position: 'meteogramCurve',
          // The animated glide toward a new position was the "always lags
          // behind the mouse" delay reported by the user — the position
          // itself is already instant via the custom positioner above; only
          // the tween made it look delayed. Disabling both stops the box
          // (and its fade) from easing between points.
          animation: false,
          animations: false,
          // `interaction.mode: 'index'` yields one item per dataset — one line plus
          // one per precipitation band. Everything the tooltip shows belongs to the
          // point in time, not to a single dataset, so only the first item survives
          // and the label callback below renders the whole block from it.
          filter: (item, index) => index === 0,
          callbacks: {
            title: (items) => {
              if (!items.length) {
                return '';
              }
              const date = new Date(entries[items[0].dataIndex].datetime);
              // Trend keeps the weekday since one point can be any of up to seven
              // days; the day view already shows just one day, so the time alone
              // is enough there.
              if (mode === 'trend') {
                return date.toLocaleString(language, {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                });
              }
              return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
            },
            label: (item) => {
              const entry = entries[item.dataIndex];
              if (!entry) {
                return '';
              }

              const parts = [];

              if (entry.temperature != null) {
                const temp = cardConfig.round_temp ? Math.round(entry.temperature) : entry.temperature;
                parts.push(`${localize('temperature')}: ${temp}°`);
              }

              // Always shown, even at 0 — a dry hour is still worth confirming.
              const precip = precipTotals[item.dataIndex] || 0;
              parts.push(`${localize('precipitation')}: ${precip.toFixed(1)} mm`);

              // Rain probability gets its own row above the chart instead — it is
              // a forecast property of the whole hour, not a measured value like
              // the two above, so it does not belong in this readout. Wind is not
              // shown here either — it is not part of this card's readout.

              return parts;
            },
          },
        },
      },
      // Compact's band is roughly a fifth of the normal height, so even the
      // small default padding would eat into it noticeably.
      layout: { padding: compact ? { top: 1, bottom: 1 } : { top: 4, bottom: 0 } },
      color: textColor,
    },
  };
}
