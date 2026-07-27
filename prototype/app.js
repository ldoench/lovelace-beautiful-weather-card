import { render } from 'lit';
import { Chart, registerables } from 'chart.js';
import { computeMeteogramData } from '../src/meteogram/data.js';
import { buildMeteogramChartConfig } from '../src/meteogram/chart.js';
import { MAX_STRIP_DAYS, alignDayStrip, fitDayCount, renderDayStrip } from '../src/day-strip.js';
import { cardStyles } from '../src/styles.js';
import { localize } from '../src/locale.js';

Chart.register(...registerables);

// The card's own stylesheet, so the prototype shows the real day strip rather
// than a copy of it. `:host` rules simply do not match outside a shadow root.
const cardStyleTag = document.createElement('style');
cardStyleTag.textContent = cardStyles.cssText;
document.head.appendChild(cardStyleTag);

// Stand-in for HA's <ha-icon>. Text glyphs, so the colour set by the day strip is
// visible — that is the point of rendering icons here at all.
const GLYPHS = {
  'mdi:weather-sunny': '☀',
  'mdi:weather-night': '☽',
  'mdi:weather-partly-cloudy': '⛅',
  'mdi:weather-cloudy': '☁',
  'mdi:weather-rainy': '☂',
  'mdi:weather-pouring': '☔',
  'mdi:weather-snowy': '❄',
  'mdi:weather-lightning': '⚡',
  'mdi:weather-lightning-rainy': '⚡',
  'mdi:weather-fog': '≈',
};

class StubIcon extends HTMLElement {
  set icon(value) {
    this._icon = value;
    this._paint();
  }

  connectedCallback() {
    this._paint();
  }

  _paint() {
    this.textContent = GLYPHS[this._icon] || GLYPHS['mdi:weather-cloudy'];
  }
}

customElements.define('ha-icon', StubIcon);

const HOURS = 216;

// Deliberately plain mock data — enough to judge colours and layout, nothing clever.
function mockForecast(scenario) {
  const base = { summer: 23, mild: 12, winter: -8 }[scenario];
  // Starts at midnight so both views are complete — in the real card the hours
  // before now come from recorded measurements rather than the forecast.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const entries = [];
  for (let i = 0; i < HOURS; i++) {
    const time = new Date(start.getTime() + i * 3600000);
    const hour = time.getHours();
    const day = Math.floor(i / 24);

    // Daily swing plus a slow drift across the week.
    const swing = Math.sin(((hour - 9) / 24) * 2 * Math.PI) * 6;
    const drift = Math.sin(day / 2) * 5;
    const temperature = Math.round((base + swing + drift) * 10) / 10;

    // Rain blocks, one heavy enough to reach the top band. The first block sits
    // inside the next 24 h on purpose, so the "today" view always shows bars.
    let precipitation = 0;
    if (i >= 6 && i <= 12) {
      precipitation = [0.2, 0.8, 1.6, 3.2, 6.5, 12.0, 1.1][i - 6];
    } else if (day % 3 === 2 && hour >= 14 && hour <= 19) {
      precipitation = [0.3, 0.9, 2.1, 4.0, 1.2, 0.4][hour - 14];
    }

    entries.push({
      datetime: time.toISOString(),
      temperature,
      precipitation,
      precipitation_probability: precipitation > 0 ? Math.min(95, 25 + precipitation * 8) : 10,
      wind_speed: 8 + ((i * 7) % 20),
      condition: precipitation > 1 ? 'rainy' : (temperature > base + 3 ? 'sunny' : 'partlycloudy'),
      // Stands in for what the recorder supplies in the real card.
      measured: i < now.getHours(),
    });
  }

  return entries;
}

const charts = {};
let activeDay = null;

// Without `history:` configured the card has nothing for the hours before now, so
// the first day of the overview starts mid-day and its tile owns only a sliver of
// the strip. Worth being able to look at.
function withoutHistory(entries) {
  const now = Date.now();
  return entries.filter((entry) => Date.parse(entry.datetime) >= now);
}

function draw(mode, canvasId, scenario, trendDays, noHistory) {
  const cardConfig = { trend_days: trendDays, trend_bucket_hours: 1, chart_height: 260 };
  const forecasts = noHistory ? withoutHistory(mockForecast(scenario)) : mockForecast(scenario);
  const data = computeMeteogramData(forecasts, mode, cardConfig);
  const canvas = document.getElementById(canvasId);
  const strip = document.getElementById(`${canvasId}-strip`);

  if (strip) {
    render(renderDayStrip({
      days: computeMeteogramData(forecasts, 'trend', cardConfig).days,
      activeIndex: activeDay,
      language: 'de',
      onSelect: (index) => {
        activeDay = activeDay === index ? null : index;
        drawAll();
      },
    }), strip);
  }

  if (charts[canvasId]) {
    charts[canvasId].destroy();
  }

  charts[canvasId] = new Chart(canvas.getContext('2d'), buildMeteogramChartConfig({
    data,
    mode,
    cardConfig,
    language: 'de',
    localize: (path, vars) => localize('de', path, vars),
    onSelect: (index) => {
      const entry = data.entries[index];
      document.getElementById(`${canvasId}-readout`).textContent =
        `${new Date(entry.datetime).toLocaleString('de')} — ${entry.temperature}° · ${entry.precipitation.toFixed(1)} mm · ${entry.precipitation_probability}%`;
    },
    onLayout: strip ? (area) => alignDayStrip(strip.querySelector('.day-strip'), area) : undefined,
  }));
}

function drawAll() {
  const scenario = document.querySelector('input[name="scenario"]:checked').value;
  const cardWidth = Number(document.getElementById('width').value);
  const noHistory = document.getElementById('no-history').checked;
  const trendDays = fitDayCount(cardWidth, MAX_STRIP_DAYS);

  document.querySelectorAll('.card').forEach((card) => {
    card.style.width = `${cardWidth}px`;
  });
  document.getElementById('fit').textContent = `${trendDays} Tage passen`;

  draw('today', 'today', scenario, trendDays, noHistory);
  draw('trend', 'trend', scenario, trendDays, noHistory);
}

document.querySelectorAll('input[name="scenario"]').forEach((input) => {
  input.addEventListener('change', drawAll);
});

document.getElementById('width').addEventListener('input', drawAll);
document.getElementById('no-history').addEventListener('change', drawAll);

document.getElementById('theme').addEventListener('change', (event) => {
  document.body.classList.toggle('dark', event.target.checked);
  drawAll();
});

drawAll();
