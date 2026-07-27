// Recorded measurements for the hours of the current day that already passed.
// The forecast subscription only reaches forward, so without this the day view
// would start at the current hour instead of at midnight.
//
// The weather entity itself is unsuitable as a source: its temperature lives in an
// attribute, and querying attribute history is expensive. Dedicated sensor
// entities are used instead, configured explicitly because their names differ per
// station.

function sampleTime(sample) {
  if (typeof sample.lu === 'number') {
    return new Date(sample.lu * 1000);
  }
  if (sample.last_updated) {
    return new Date(sample.last_updated);
  }
  if (sample.last_changed) {
    return new Date(sample.last_changed);
  }
  return null;
}

function sampleValue(sample) {
  const raw = sample.s !== undefined ? sample.s : sample.state;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function hourKey(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime();
}

// The recorder samples irregularly, so values are collapsed onto whole hours.
// `mean` suits a temperature reading, `last` a sensor that already reports the
// accumulated amount for its hour. Returns the per-hour aggregates plus the
// sorted raw samples and the last sample's time, which `hourlyValue` below
// needs to carry a value forward across hours that have no sample of their own.
function toHourly(samples, aggregate) {
  const parsed = [];
  (samples || []).forEach((sample) => {
    const time = sampleTime(sample);
    const value = sampleValue(sample);
    if (time !== null && value !== null) {
      parsed.push({ time, value });
    }
  });
  parsed.sort((a, b) => a.time - b.time);

  const buckets = new Map();
  parsed.forEach(({ time, value }) => {
    const key = hourKey(time);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(value);
  });

  const aggregated = new Map();
  buckets.forEach((values, key) => {
    if (aggregate === 'mean') {
      aggregated.set(key, values.reduce((sum, v) => sum + v, 0) / values.length);
    } else if (aggregate === 'max') {
      aggregated.set(key, Math.max(...values));
    } else {
      aggregated.set(key, values[values.length - 1]);
    }
  });

  return { aggregated, parsed, lastSampleTime: parsed.length ? parsed[parsed.length - 1].time : null };
}

// The recorder (with `significant_changes_only: false`) still compresses a run
// of unchanged states into a single sample, so an hour where nothing changed
// gets none of its own. This carries the last known value forward into that
// gap. It never reaches past `series.lastSampleTime`: an hour after the last
// real sample isn't a compression gap, it's simply data we don't have (yet),
// and must stay `null` rather than be extrapolated as unchanged.
function hourlyValue(series, hour) {
  const key = hourKey(hour);
  if (series.aggregated.has(key)) {
    return series.aggregated.get(key);
  }
  if (series.lastSampleTime === null || hour > series.lastSampleTime) {
    return null;
  }

  for (let i = series.parsed.length - 1; i >= 0; i--) {
    if (series.parsed[i].time < hour) {
      return series.parsed[i].value;
    }
  }
  return null;
}

export async function fetchMeasuredHours(hass, historyConfig, start, end) {
  const tempId = historyConfig && historyConfig.temperature;
  const precipId = historyConfig && historyConfig.precipitation;
  const probabilityId = historyConfig && historyConfig.precipitation_probability;
  const entityIds = [tempId, precipId, probabilityId].filter(Boolean);

  if (!entityIds.length || end <= start) {
    return [];
  }

  let response;
  try {
    response = await hass.callWS({
      type: 'history/history_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: entityIds,
      minimal_response: true,
      no_attributes: true,
      // Without this HA drops states it considers insignificant, which for a
      // slowly changing sensor collapses an entire hour to zero samples —
      // exactly the gap `hourlyValue` is built to fill in.
      significant_changes_only: false,
    });
  } catch (error) {
    // A missing entity or a recorder without data must not break the card.
    console.warn('beautiful-weather-card: history unavailable', error);
    return [];
  }

  // The precipitation sensor reports an intensity in mm/h (device_class
  // precipitation_intensity), sampled every few minutes — not an accumulated
  // amount for the hour. Averaging the rate over the hour yields the millimetres
  // that fell; taking the last sample would read 0 for an hour that rained early.
  const temperatures = toHourly(tempId ? response[tempId] : [], 'mean');
  const precipitation = toHourly(precipId ? response[precipId] : [], 'mean');
  const probabilities = toHourly(probabilityId ? response[probabilityId] : [], 'mean');

  const entries = [];
  for (let hour = new Date(start); hour < end; hour.setHours(hour.getHours() + 1)) {
    const key = hourKey(hour);
    const rawTemperature = hourlyValue(temperatures, hour);
    // Carrying the rate forward across a gap only reads correctly if the sensor
    // truly writes solely on change (confirmed for this integration) — otherwise
    // a missing sample could just as well mean the rain stopped, not that it
    // continued at the last known intensity.
    const rawPrecip = hourlyValue(precipitation, hour);
    const rawProbability = hourlyValue(probabilities, hour);

    const temperature = rawTemperature === null ? null : Math.round(rawTemperature * 10) / 10;
    const precip = rawPrecip === null ? null : Math.round(rawPrecip * 100) / 100;
    const probability = rawProbability === null ? null : Math.round(rawProbability);

    if (temperature === null && precip === null && probability === null) {
      continue;
    }

    entries.push({
      datetime: new Date(key).toISOString(),
      temperature,
      // `null` means "no data", distinct from a measured 0 mm — mergeMeasured
      // relies on that to fall back to the forecast value instead of blanking it.
      precipitation: precip,
      precipitation_probability: probability,
      measured: true,
    });
  }

  return entries;
}

// Measured hours win over forecast hours for the same timestamp, but only
// field by field: an hour with no sample for e.g. precipitation must not blank
// out a forecast value that's otherwise still the best information available
// (this matters most for the current, still in-progress hour, where both a
// partial measurement and a forecast exist side by side).
export function mergeMeasured(measured, forecasts) {
  if (!measured.length) {
    return forecasts;
  }

  const forecastByTime = new Map((forecasts || []).map((entry) => [Date.parse(entry.datetime), entry]));
  const measuredTimes = new Set(measured.map((entry) => Date.parse(entry.datetime)));

  const merged = measured.map((entry) => {
    const forecastEntry = forecastByTime.get(Date.parse(entry.datetime));
    return {
      ...forecastEntry,
      ...entry,
      temperature: entry.temperature !== null ? entry.temperature : (forecastEntry ? forecastEntry.temperature : null),
      precipitation: entry.precipitation !== null ? entry.precipitation : (forecastEntry ? forecastEntry.precipitation : null),
      precipitation_probability: entry.precipitation_probability !== null
        ? entry.precipitation_probability
        : (forecastEntry ? forecastEntry.precipitation_probability : null),
      measured: true,
    };
  });

  const future = (forecasts || []).filter((entry) => !measuredTimes.has(Date.parse(entry.datetime)));

  return [...merged, ...future].sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
}
