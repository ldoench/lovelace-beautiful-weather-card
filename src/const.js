export const CARD_VERSION = '0.1.0';

export const WeatherEntityFeature = {
  FORECAST_DAILY: 1,
  FORECAST_HOURLY: 2,
  FORECAST_TWICE_DAILY: 4,
};

export const DEFAULT_CONFIG = {
  // The week overview is the entry point; a tap on a day in the chart drills
  // down into that day.
  chart_mode: 'trend',
  trend_days: 7,
  trend_bucket_hours: 1,
  chart_height: 220,
  show_current: true,
  show_detail_row: true,
  show_day_strip: true,
  round_temp: false,
};

// HA weather conditions -> mdi icon. Uses HA's own icon set, so nothing is bundled.
export const CONDITION_ICONS = {
  'clear-night': 'mdi:weather-night',
  cloudy: 'mdi:weather-cloudy',
  exceptional: 'mdi:alert-circle-outline',
  fog: 'mdi:weather-fog',
  hail: 'mdi:weather-hail',
  lightning: 'mdi:weather-lightning',
  'lightning-rainy': 'mdi:weather-lightning-rainy',
  partlycloudy: 'mdi:weather-partly-cloudy',
  pouring: 'mdi:weather-pouring',
  rainy: 'mdi:weather-rainy',
  snowy: 'mdi:weather-snowy',
  'snowy-rainy': 'mdi:weather-snowy-rainy',
  sunny: 'mdi:weather-sunny',
  windy: 'mdi:weather-windy',
  'windy-variant': 'mdi:weather-windy-variant',
};

// The one place outside the chart where colour is allowed: the day-strip icons.
// A row of grey glyphs is hard to scan, and sun/rain/cloud are exactly the kind
// of distinction colour makes instantly. Fixed values rather than theme
// variables — these have to keep meaning the same in light and dark.
export const CONDITION_COLORS = {
  'clear-night': '#8e9ac9',
  cloudy: '#9aa5b1',
  exceptional: '#e05252',
  fog: '#a8b0b8',
  hail: '#69b7e0',
  lightning: '#e8b21a',
  'lightning-rainy': '#e8b21a',
  partlycloudy: '#9bacbd',
  pouring: '#2f7dc4',
  rainy: '#4a90d9',
  snowy: '#a9c9e8',
  'snowy-rainy': '#7fb0d8',
  sunny: '#f2b705',
  windy: '#9aa5b1',
  'windy-variant': '#9aa5b1',
};

export function conditionIcon(condition) {
  return CONDITION_ICONS[condition] || 'mdi:weather-cloudy';
}

export function conditionColor(condition) {
  return CONDITION_COLORS[condition] || CONDITION_COLORS.cloudy;
}
