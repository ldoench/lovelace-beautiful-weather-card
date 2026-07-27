import { DEFAULT_PRECIP_BANDS, DEFAULT_TEMP_STOPS, buildTempGradient, precipBandColor } from './colors.js';

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
const TEMP_AXIS_MIN_SPAN = { today: 15, trend: 28 };
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
// three-degree swing does not get blown up to fill the whole height.
function tempBounds(values, minSpan) {
  if (!values.length) {
    return { min: 0, max: minSpan };
  }

  let min = Math.floor((Math.min(...values) - 1) / TEMP_AXIS_STEP) * TEMP_AXIS_STEP;
  let max = Math.ceil((Math.max(...values) + 1) / TEMP_AXIS_STEP) * TEMP_AXIS_STEP;

  while (max - min < minSpan) {
    max += TEMP_AXIS_STEP;
    if (max - min < minSpan) {
      min -= TEMP_AXIS_STEP;
    }
  }

  return { min, max };
}

// Category labels sit at the middle of their band rather than at the boundaries.
// Only bands actually visible on the current axis get a label, and at most
// MAX_BAND_LABELS of those, so the right-hand axis never crowds.
function bandTicks(bands, max, localize) {
  const visible = bands
    .map((band) => {
      const upper = Number.isFinite(band.to) ? Math.min(band.to, max) : max;
      return { value: (band.from + upper) / 2, label: band.label };
    })
    .filter((tick) => tick.value > 0 && tick.value < max);

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

function crosshairPlugin(getIndex, lineColor) {
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
      ctx.lineWidth = 1;
      ctx.strokeStyle = lineColor;
      ctx.stroke();
      ctx.restore();
    },
  };
}

// Reports where the plot area sits as soon as Chart.js has measured its axes, so
// the day strip above can be padded to the same edges. `afterLayout` rather than
// `afterRender`: it fires before the first paint and on every resize, and the
// callback only touches DOM outside the chart, so there is nothing to loop back.
function layoutReportPlugin(onLayout) {
  return {
    id: 'meteogramLayout',
    afterLayout(chart) {
      const area = chart.chartArea;
      if (!area) {
        return;
      }
      onLayout({ left: area.left, right: area.right, width: chart.width });
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

// Separates recorded hours from forecast ones, the way the DWD app does. Does
// nothing when no measured values are configured, so the chart stays unchanged.
// `withLabels` is off in the overview: a week's worth of hours leaves the early
// morning only a few pixels, far too little for the word "Messwerte" to sit
// beside the line without colliding with it. The shaded area carries the same
// meaning there.
function nowDividerPlugin(entries, localize, lineColor, shadeColor, withLabels) {
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

      ctx.globalAlpha = 0.35;
      ctx.fillStyle = shadeColor;
      ctx.fillRect(chartArea.left, chartArea.top, point.x - chartArea.left, chartArea.bottom - chartArea.top);
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.moveTo(point.x, chartArea.top);
      ctx.lineTo(point.x, chartArea.bottom);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = lineColor;
      ctx.stroke();

      if (withLabels) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillStyle = lineColor;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'right';
        ctx.fillText(localize('measured'), point.x - 6, chartArea.top + 2);
        ctx.textAlign = 'left';
        ctx.fillText(localize('forecast'), point.x + 6, chartArea.top + 2);
      }

      ctx.restore();
    },
  };
}

export function buildMeteogramChartConfig({ data, mode, cardConfig, language, localize, onSelect, onLayout }) {
  const entries = data.entries;
  const bands = cardConfig.precip_bands || DEFAULT_PRECIP_BANDS;
  const stops = cardConfig.temperature_gradient || DEFAULT_TEMP_STOPS;

  const labels = entries.map((entry) => entry.datetime);
  const temperatures = data.temperatures;
  const known = temperatures.filter((value) => value != null);
  const alignedBands = data.precipBands.map((series) => alignToLabels(series, labels));
  const precipMax = axisMax(alignedBands);
  // What the stacked bar at an index actually adds up to — the tooltip reports
  // that single number instead of one line per band dataset.
  const precipTotals = labels.map((_, index) => (
    alignedBands.reduce((sum, series) => sum + (series[index] || 0), 0)
  ));
  const tempRange = tempBounds(known, TEMP_AXIS_MIN_SPAN[mode] || TEMP_AXIS_MIN_SPAN.today);
  const visibleBandTicks = bandTicks(bands, precipMax, localize);
  const bucketHours = mode === 'trend' ? (cardConfig.trend_bucket_hours || 3) : 1;

  const textColor = cssVar('--primary-text-color', '#212121');
  const secondaryColor = cssVar('--secondary-text-color', '#727272');
  const gridColor = cssVar('--divider-color', 'rgba(127,127,127,0.25)');

  let selectedIndex = null;

  const datasets = [
    {
      type: 'line',
      label: localize('temperature'),
      data: temperatures,
      yAxisID: 'temp',
      order: 0,
      borderWidth: 2.5,
      tension: 0.35,
      pointRadius: 0,
      pointHitRadius: 12,
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
      nowDividerPlugin(entries, localize, secondaryColor, gridColor, mode !== 'trend'),
      crosshairPlugin(() => selectedIndex, secondaryColor),
      ...(onLayout ? [layoutReportPlugin(onLayout)] : []),
    ],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      // `intersect: false` means a tap anywhere in the plot area counts, not just
      // on the curve. In the trend view the card turns that index into a day and
      // navigates; in the day view it moves the read-out crosshair.
      onClick: (event, elements, chart) => {
        const points = chart.getElementsAtEventForMode(event, 'index', { intersect: false }, true);
        if (!points.length) {
          return;
        }

        if (mode !== 'trend') {
          selectedIndex = points[0].index;
          chart.draw();
        }

        if (onSelect) {
          onSelect(points[0].index);
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: {
            display: mode === 'trend',
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
          ticks: {
            color: secondaryColor,
            maxRotation: 0,
            autoSkip: false,
            font: { size: 11 },
            callback: xTickCallback(entries, mode, language),
          },
        },
        temp: {
          position: 'left',
          // Horizontal guides are what make the curve readable at a glance.
          grid: {
            display: true,
            drawTicks: false,
            color: gridColor,
            borderDash: [2, 3],
          },
          border: { display: false },
          min: tempRange.min,
          max: tempRange.max,
          ticks: {
            color: secondaryColor,
            font: { size: 11 },
            stepSize: TEMP_AXIS_STEP,
            callback: (value) => `${Math.round(value)}°`,
          },
        },
        precip: {
          position: 'right',
          stacked: true,
          min: 0,
          max: precipMax,
          grid: { display: false, drawTicks: false },
          border: { display: false },
          afterBuildTicks: (axis) => {
            axis.ticks = visibleBandTicks.map((tick) => ({ value: tick.value }));
          },
          ticks: {
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
          enabled: mode === 'trend',
          displayColors: false,
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
              const entry = entries[items[0].dataIndex];
              return new Date(entry.datetime).toLocaleString(language, {
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
              });
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

              const precip = precipTotals[item.dataIndex] || 0;
              if (precip > 0) {
                parts.push(`${localize('precipitation')}: ${precip.toFixed(1)} mm`);
              }

              if (entry.precipitation_probability != null) {
                parts.push(`${localize('probability')}: ${Math.round(entry.precipitation_probability)} %`);
              }

              return parts;
            },
          },
        },
      },
      layout: { padding: { top: 4, bottom: 0 } },
      color: textColor,
    },
  };
}
