const translations = {
  en: {
    today: 'Today',
    trend: '{days} days',
    temperature: 'Temperature',
    precipitation: 'Precipitation',
    probability: 'Chance of rain',
    wind: 'Wind',
    gusts: 'Gusts',
    now: 'Now',
    overview: 'Overview',
    previousDay: 'Previous day',
    nextDay: 'Next day',
    noForecast: 'No hourly forecast available for this entity.',
    intensity: {
      veryLight: 'very light',
      light: 'light',
      moderate: 'moderate',
      moderateHigh: 'steady',
      heavy: 'heavy',
      veryHeavy: 'very heavy',
      extreme: 'extreme',
    },
    measured: 'Measured',
    forecast: 'Forecast',
    condition: {
      'clear-night': 'Clear',
      cloudy: 'Cloudy',
      exceptional: 'Exceptional',
      fog: 'Fog',
      hail: 'Hail',
      lightning: 'Lightning',
      'lightning-rainy': 'Thunderstorm',
      partlycloudy: 'Partly cloudy',
      pouring: 'Pouring',
      rainy: 'Rainy',
      snowy: 'Snow',
      'snowy-rainy': 'Sleet',
      sunny: 'Sunny',
      windy: 'Windy',
      'windy-variant': 'Windy',
    },
  },
  de: {
    today: 'Heute',
    trend: '{days} Tage',
    temperature: 'Temperatur',
    precipitation: 'Niederschlag',
    probability: 'Regenwahrscheinlichkeit',
    wind: 'Wind',
    gusts: 'Böen',
    now: 'Jetzt',
    overview: 'Übersicht',
    previousDay: 'Voriger Tag',
    nextDay: 'Nächster Tag',
    noForecast: 'Für diese Entität ist keine Stundenprognose verfügbar.',
    intensity: {
      veryLight: 'sehr gering',
      light: 'gering',
      moderate: 'leicht',
      moderateHigh: 'mäßig',
      heavy: 'stark',
      veryHeavy: 'sehr stark',
      extreme: 'extrem',
    },
    measured: 'Messwerte',
    forecast: 'Prognose',
    condition: {
      'clear-night': 'Klar',
      cloudy: 'Bewölkt',
      exceptional: 'Außergewöhnlich',
      fog: 'Nebel',
      hail: 'Hagel',
      lightning: 'Gewitter',
      'lightning-rainy': 'Gewitter mit Regen',
      partlycloudy: 'Teils bewölkt',
      pouring: 'Starkregen',
      rainy: 'Regnerisch',
      snowy: 'Schnee',
      'snowy-rainy': 'Schneeregen',
      sunny: 'Sonnig',
      windy: 'Windig',
      'windy-variant': 'Windig',
    },
  },
};

function lookup(lang, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), translations[lang]);
}

// Falls back to English for every language we do not ship.
export function localize(language, path, vars) {
  const base = (language || 'en').split('-')[0];
  const lang = translations[base] ? base : 'en';
  let result = lookup(lang, path);

  if (result == null) {
    result = lookup('en', path);
  }

  if (typeof result === 'string' && vars) {
    Object.keys(vars).forEach((key) => {
      result = result.replace(`{${key}}`, vars[key]);
    });
  }

  return result;
}

export default translations;
