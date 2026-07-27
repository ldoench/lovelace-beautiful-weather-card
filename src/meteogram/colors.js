// Farbkodierung des Meteogramm-Stils: Temperatur-Farbverlauf und Niederschlagsbänder.
// Kein Chart.js-Import — ctx, chartArea und Skala werden übergeben.

const DEFAULT_TEMP_STOPS = [
  { temp: -25, color: 'rgb(90, 60, 160)' },
  { temp: -15, color: 'rgb(60, 100, 200)' },
  { temp: -5, color: 'rgb(80, 170, 220)' },
  { temp: 0, color: 'rgb(60, 180, 120)' },
  { temp: 8, color: 'rgb(180, 200, 60)' },
  { temp: 15, color: 'rgb(245, 200, 40)' },
  { temp: 22, color: 'rgb(245, 150, 30)' },
  { temp: 30, color: 'rgb(230, 70, 40)' },
  { temp: 38, color: 'rgb(160, 20, 40)' }
];

// Radar-style intensity ramp: light blue through blue into green, then yellow,
// orange and red for the heaviest hours. Labels are localisation keys; the chart
// only draws a few of them so the right axis stays readable.
const DEFAULT_PRECIP_BANDS = [
  { from: 0, to: 0.1, color: 'rgb(190, 240, 250)', label: 'intensity.veryLight' },
  { from: 0.1, to: 0.5, color: 'rgb(60, 220, 240)', label: 'intensity.light' },
  { from: 0.5, to: 1, color: 'rgb(38, 140, 60)', label: 'intensity.moderate' },
  { from: 1, to: 2, color: 'rgb(120, 200, 70)', label: 'intensity.moderateHigh' },
  { from: 2, to: 5, color: 'rgb(240, 205, 45)', label: 'intensity.heavy' },
  { from: 5, to: 10, color: 'rgb(240, 140, 35)', label: 'intensity.veryHeavy' },
  { from: 10, to: Infinity, color: 'rgb(215, 45, 40)', label: 'intensity.extreme' }
];

// Genutzt, solange weder Skala noch Stops eine sinnvolle Farbe hergeben.
const FALLBACK_TEMP_COLOR = 'rgb(245, 200, 40)';

const HEX_PATTERN = /^#([0-9a-f]+)$/i;
const RGB_PATTERN = /^rgba?\(([^)]*)\)$/i;

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

function channel(token) {
  const raw = token.endsWith('%') ? parseFloat(token) * 2.55 : parseFloat(token);
  return Number.isFinite(raw) ? clamp(Math.round(raw), 0, 255) : null;
}

function alpha(token) {
  const raw = token.endsWith('%') ? parseFloat(token) / 100 : parseFloat(token);
  return Number.isFinite(raw) ? clamp(raw, 0, 1) : null;
}

// Versteht Hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb() und rgba(), da Stops konfigurierbar sind.
function parseColor(str) {
  if (typeof str !== 'string') return null;
  const value = str.trim();

  const hex = HEX_PATTERN.exec(value);
  if (hex) {
    const digits = hex[1];
    const short = digits.length === 3 || digits.length === 4;
    if (!short && digits.length !== 6 && digits.length !== 8) return null;
    const size = short ? 1 : 2;
    const part = (i) => {
      const chunk = digits.substr(i * size, size);
      return parseInt(short ? chunk + chunk : chunk, 16);
    };
    const hasAlpha = digits.length === 4 || digits.length === 8;
    return {
      r: part(0),
      g: part(1),
      b: part(2),
      a: hasAlpha ? Math.round((part(3) / 255) * 1000) / 1000 : 1
    };
  }

  const fn = RGB_PATTERN.exec(value);
  if (fn) {
    const tokens = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (tokens.length < 3) return null;
    const r = channel(tokens[0]);
    const g = channel(tokens[1]);
    const b = channel(tokens[2]);
    if (r === null || g === null || b === null) return null;
    const a = tokens.length > 3 ? alpha(tokens[3]) : 1;
    return { r, g, b, a: a === null ? 1 : a };
  }

  return null;
}

function toCssColor(rgba) {
  if (!rgba) return FALLBACK_TEMP_COLOR;
  if (rgba.a >= 1) return `rgb(${rgba.r}, ${rgba.g}, ${rgba.b})`;
  return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a})`;
}

function mixColors(from, to, t) {
  const f = clamp(t, 0, 1);
  return {
    r: Math.round(from.r + (to.r - from.r) * f),
    g: Math.round(from.g + (to.g - from.g) * f),
    b: Math.round(from.b + (to.b - from.b) * f),
    a: Math.round((from.a + (to.a - from.a) * f) * 1000) / 1000
  };
}

// Parst die Stops und sortiert sie nach Temperatur — die Konfiguration darf unsortiert sein.
function normalizeStops(stops) {
  const source = Array.isArray(stops) && stops.length ? stops : DEFAULT_TEMP_STOPS;
  const parsed = [];
  for (const stop of source) {
    if (!stop) continue;
    const temp = Number(stop.temp);
    const rgba = parseColor(stop.color);
    if (Number.isFinite(temp) && rgba) parsed.push({ temp, rgba });
  }
  return parsed.sort((a, b) => a.temp - b.temp);
}

function sampleStops(sorted, temp) {
  if (!sorted.length || !Number.isFinite(temp)) return null;
  if (temp <= sorted[0].temp) return sorted[0].rgba;
  const last = sorted[sorted.length - 1];
  if (temp >= last.temp) return last.rgba;

  for (let i = 1; i < sorted.length; i++) {
    const upper = sorted[i];
    if (temp > upper.temp) continue;
    const lower = sorted[i - 1];
    const span = upper.temp - lower.temp;
    return span > 0 ? mixColors(lower.rgba, upper.rgba, (temp - lower.temp) / span) : upper.rgba;
  }
  return last.rgba;
}

function colorAtTemp(temp, stops = DEFAULT_TEMP_STOPS) {
  return toCssColor(sampleStops(normalizeStops(stops), Number(temp)));
}

function scaleBound(scale, key) {
  const value = scale ? Number(scale[key]) : NaN;
  return Number.isFinite(value) ? value : null;
}

function solidFallback(sorted, min, max) {
  if (min !== null && max !== null) return toCssColor(sampleStops(sorted, (min + max) / 2));
  if (min !== null) return toCssColor(sampleStops(sorted, min));
  if (sorted.length) return toCssColor(sorted[Math.floor(sorted.length / 2)].rgba);
  return FALLBACK_TEMP_COLOR;
}

function buildTempGradient(ctx, chartArea, scale, stops = DEFAULT_TEMP_STOPS) {
  const sorted = normalizeStops(stops);
  const min = scaleBound(scale, 'min');
  const max = scaleBound(scale, 'max');

  // Beim ersten Render steht das Layout noch nicht; Chart.js ruft den Callback danach erneut auf.
  if (!chartArea || !ctx || typeof ctx.createLinearGradient !== 'function') {
    return solidFallback(sorted, min, max);
  }

  const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);

  if (min === null || max === null || max <= min) {
    const solid = solidFallback(sorted, min, max);
    gradient.addColorStop(0, solid);
    gradient.addColorStop(1, solid);
    return gradient;
  }

  // Die Ränder werden immer explizit interpoliert, sonst rastet ein Skalenbereich,
  // der komplett zwischen zwei Stops liegt, auf eine Einzelfarbe ein.
  const span = max - min;
  gradient.addColorStop(0, toCssColor(sampleStops(sorted, min)));
  let previous = 0;
  for (const stop of sorted) {
    if (stop.temp <= min || stop.temp >= max) continue;
    const offset = Math.max(previous, clamp((stop.temp - min) / span, 0, 1));
    gradient.addColorStop(offset, toCssColor(stop.rgba));
    previous = offset;
  }
  gradient.addColorStop(1, toCssColor(sampleStops(sorted, max)));

  return gradient;
}

function precipBandColor(index, bands = DEFAULT_PRECIP_BANDS) {
  const source = Array.isArray(bands) && bands.length ? bands : DEFAULT_PRECIP_BANDS;
  const position = clamp(Math.round(Number(index)) || 0, 0, source.length - 1);
  const band = source[position];
  const color = typeof band === 'string' ? band : (band && band.color);
  if (typeof color === 'string' && color.trim()) return color;
  return DEFAULT_PRECIP_BANDS[clamp(position, 0, DEFAULT_PRECIP_BANDS.length - 1)].color;
}

export {
  DEFAULT_TEMP_STOPS,
  DEFAULT_PRECIP_BANDS,
  colorAtTemp,
  buildTempGradient,
  precipBandColor,
  parseColor,
  toCssColor,
  mixColors
};
