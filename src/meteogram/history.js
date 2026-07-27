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
// accumulated amount for its hour.
function toHourly(samples, aggregate) {
  const buckets = new Map();

  (samples || []).forEach((sample) => {
    const time = sampleTime(sample);
    const value = sampleValue(sample);
    if (time === null || value === null) {
      return;
    }

    const key = hourKey(time);
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(value);
  });

  const result = new Map();
  buckets.forEach((values, key) => {
    if (aggregate === 'mean') {
      result.set(key, values.reduce((sum, v) => sum + v, 0) / values.length);
    } else if (aggregate === 'max') {
      result.set(key, Math.max(...values));
    } else {
      result.set(key, values[values.length - 1]);
    }
  });

  return result;
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
    const temperature = temperatures.has(key) ? Math.round(temperatures.get(key) * 10) / 10 : null;
    const precip = precipitation.has(key) ? Math.round(precipitation.get(key) * 100) / 100 : null;
    const probability = probabilities.has(key) ? Math.round(probabilities.get(key)) : null;

    if (temperature === null && precip === null && probability === null) {
      continue;
    }

    entries.push({
      datetime: new Date(key).toISOString(),
      temperature,
      precipitation: precip === null ? 0 : precip,
      precipitation_probability: probability,
      measured: true,
    });
  }

  return entries;
}

// Measured hours win over forecast hours for the same timestamp.
export function mergeMeasured(measured, forecasts) {
  if (!measured.length) {
    return forecasts;
  }

  const taken = new Set(measured.map((entry) => Date.parse(entry.datetime)));
  const future = (forecasts || []).filter((entry) => !taken.has(Date.parse(entry.datetime)));

  return [...measured, ...future].sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime));
}
