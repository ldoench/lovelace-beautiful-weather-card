// Reine Datentransformation für den Meteogramm-Stil: Slicing, Niederschlagsbänder,
// Bucket-Aggregation und Tagesgruppierung. Kein Chart.js, kein DOM, keine Imports.
// `datetime` kommt als UTC-ISO-String; alle Tages-/Stundenberechnungen laufen über
// die lokalen Date-Getter (getFullYear/getHours/…) und landen damit automatisch in
// der lokalen Zeitzone des Browsers/der Instanz.

// Fallback, falls kein `precip_bands` übergeben wird — Werte aus der Spec-Tabelle,
// ohne Farbe/Label (das ist Sache von meteogram/colors.js, nicht dieser Datei).
const DEFAULT_PRECIP_BANDS = [
  { from: 0, to: 0.5 },
  { from: 0.5, to: 2.5 },
  { from: 2.5, to: 10 },
  { from: 10, to: Infinity }
];

function clamp(value, min, max) {
  return value < min ? min : (value > max ? max : value);
}

// null/undefined/NaN -> 0, damit precipitation_probability o.ä. nie durchrutscht.
function toNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function localDateKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

// Buckets fangen an geraden Stundengrenzen an (bei step=3 also 00/03/06/…), nicht
// beim ersten Eintrag — sonst verschiebt sich die Ausrichtung mit dem Slice-Start.
function startOfBucket(date, step) {
  const hour = Math.floor(date.getHours() / step) * step;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour);
}

// `day_offset` shifts the slice window by N calendar days (0 = today, the default
// and the only behaviour existing callers relied on). Used to preview a day other
// than today — e.g. a tap on a day-strip tile — without duplicating this logic.
function sliceForecast(forecasts, mode, opts = {}) {
  if (!Array.isArray(forecasts) || !forecasts.length) return [];

  const now = opts.now instanceof Date ? opts.now : new Date(opts.now || Date.now());
  const dayOffset = Number.isFinite(opts.day_offset) ? Math.trunc(opts.day_offset) : 0;
  const trendDays = Number.isFinite(opts.trend_days) && opts.trend_days > 0 ? opts.trend_days : 7;

  // Both views cover whole calendar days from local midnight — the day view one
  // of them, the overview `trend_days` of them. Not a rolling window: the day
  // strip above the chart puts one tile per calendar day, and the hours of today
  // that already passed are filled from the recorder, so the chart starts where
  // the day started. Without configured history those hours are simply missing,
  // which is all the forecast alone can offer.
  // Calendar arithmetic rather than `+ n * 24 h` so a DST switch inside the
  // window does not shift the end off midnight.
  const span = mode === 'trend' ? trendDays : 1;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset + span);

  return forecasts.filter((entry) => {
    const t = toDate(entry && entry.datetime);
    return t !== null && t >= start && t < end;
  });
}

function splitPrecipBands(values, bands) {
  const list = Array.isArray(values) ? values : [];
  const bandList = Array.isArray(bands) && bands.length ? bands : DEFAULT_PRECIP_BANDS;

  return bandList.map((band) => {
    const from = toNumber(band && band.from);
    const toRaw = band && band.to;
    const to = toRaw === undefined || toRaw === null || Number.isNaN(Number(toRaw)) ? Infinity : Number(toRaw);
    const width = to - from;

    return list.map((raw) => clamp(toNumber(raw) - from, 0, width));
  });
}

function bucketPrecipitation(entries, bucketHours) {
  const list = Array.isArray(entries) ? entries : [];
  const step = Number.isFinite(bucketHours) && bucketHours > 0 ? bucketHours : 1;

  const order = [];
  const sums = new Map();

  for (const entry of list) {
    const t = toDate(entry && entry.datetime);
    if (t === null) continue;

    const bucketDate = startOfBucket(t, step);
    const key = bucketDate.getTime();
    if (!sums.has(key)) {
      sums.set(key, { datetime: bucketDate.toISOString(), precipitation: 0 });
      order.push(key);
    }
    sums.get(key).precipitation += toNumber(entry.precipitation);
  }

  return order.map((key) => {
    const bucket = sums.get(key);
    return { datetime: bucket.datetime, precipitation: round2(bucket.precipitation) };
  });
}

function groupByDay(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const order = [];
  const byDay = new Map();

  for (const entry of list) {
    const t = toDate(entry && entry.datetime);
    if (t === null) continue;

    const key = localDateKey(t);
    if (!byDay.has(key)) {
      byDay.set(key, []);
      order.push(key);
    }
    byDay.get(key).push(entry);
  }

  return order.map((key) => {
    const dayEntries = byDay.get(key);
    const temps = [];
    const counts = new Map();
    let precipitationSum = 0;
    let hasPrecipitation = false;
    let noonEntry = null;
    let noonDiff = Infinity;

    for (const entry of dayEntries) {
      if (typeof entry.temperature === 'number' && Number.isFinite(entry.temperature)) {
        temps.push(entry.temperature);
      }
      if (typeof entry.templow === 'number' && Number.isFinite(entry.templow)) {
        temps.push(entry.templow);
      }
      if (typeof entry.precipitation === 'number' && Number.isFinite(entry.precipitation)) {
        // Hourly rate (mm/h) summed over the hour is the millimetres that fell —
        // see the note on measured precipitation being an intensity, not a total.
        precipitationSum += entry.precipitation;
        hasPrecipitation = true;
      }

      if (entry.condition) {
        counts.set(entry.condition, (counts.get(entry.condition) || 0) + 1);
      }

      const hour = toDate(entry.datetime).getHours();
      const diff = Math.abs(hour - 12);
      if (diff < noonDiff) {
        noonDiff = diff;
        noonEntry = entry;
      }
    }

    let maxCount = 0;
    for (const count of counts.values()) {
      if (count > maxCount) maxCount = count;
    }
    const tied = [];
    for (const [cond, count] of counts) {
      if (count === maxCount) tied.push(cond);
    }
    // Bei Gleichstand gewinnt die Bedingung der Mittagsstunde, sonst die erstgesehene.
    let condition = tied.length ? tied[0] : null;
    if (tied.length > 1 && noonEntry && tied.includes(noonEntry.condition)) {
      condition = noonEntry.condition;
    }

    return {
      date: key,
      min: temps.length ? Math.min(...temps) : null,
      max: temps.length ? Math.max(...temps) : null,
      entries: dayEntries,
      // A day with no valid readings at all gets `null`, not 0 — the two mean
      // different things for a "–" vs. "0 mm" display in the day strip.
      precipitationSum: hasPrecipitation ? round2(precipitationSum) : null,
      condition
    };
  });
}

function computeMeteogramData(forecasts, mode, opts = {}) {
  const entries = sliceForecast(forecasts, mode, opts);
  const labels = entries.map((entry) => entry.datetime);
  const temperatures = entries.map((entry) => (
    typeof entry.temperature === 'number' && Number.isFinite(entry.temperature) ? entry.temperature : null
  ));

  const bucketHours = mode === 'trend'
    ? (Number.isFinite(opts.trend_bucket_hours) && opts.trend_bucket_hours > 0 ? opts.trend_bucket_hours : 3)
    : 1;
  const buckets = bucketPrecipitation(entries, bucketHours);
  const bandSeries = splitPrecipBands(buckets.map((bucket) => bucket.precipitation), opts.precip_bands);
  // {x, y}-Punkte statt paralleler Arrays: im trend-Modus sind die Precip-Buckets
  // gröber als die stündliche Temperaturkurve, ein Chart braucht dann eigene x-Werte.
  const precipBands = bandSeries.map((series) => series.map((value, i) => ({ x: buckets[i].datetime, y: value })));

  const days = groupByDay(entries);
  const unit = opts.unit === undefined ? null : opts.unit;

  return { entries, labels, temperatures, precipBands, days, unit };
}

export {
  sliceForecast,
  splitPrecipBands,
  bucketPrecipitation,
  groupByDay,
  computeMeteogramData
};
