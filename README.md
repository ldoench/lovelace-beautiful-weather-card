# Beautiful Weather Card

A Home Assistant Lovelace card that renders a **meteogram**: a colour-coded temperature curve layered over stacked precipitation intensity bars. The design is inspired by the charts in the DWD *Warnwetter* app.

Two views share the same hourly forecast:

| View | Range | Purpose |
|---|---|---|
| **Day** | one calendar day, hour by hour | detailed read-out — tap any hour for its exact values |
| **Overview** | up to 7 days | temperature trend and when rain is expected, at a glance |

The temperature line is coloured by value — blue below freezing, green around 0 °C, yellow and orange through the mild range, red when it gets hot. Precipitation bars darken as intensity rises, so a heavy hour reads differently from a drizzle even at the same glance.

## Requirements

The weather entity must support **hourly** forecasts (`FORECAST_HOURLY`). Both views are built from that single hourly forecast, so the longer it reaches, the more days the trend view can show.

Developed against [`FL550/dwd_weather`](https://github.com/FL550/dwd_weather), which provides 9 days of hourly data. Any integration exposing hourly forecasts will work; the trend view simply shows fewer days if the forecast is shorter.

## Installation

### HACS (custom repository)

1. HACS → Frontend → ⋮ → *Custom repositories*
2. Add `https://github.com/ldoench/lovelace-beautiful-weather-card` with category *Lovelace*
3. Install **Beautiful Weather Card**, then reload your browser

### Manual

Copy `beautiful-weather-card.js` into `<config>/www/` and register it as a Lovelace resource:

```yaml
url: /local/beautiful-weather-card.js
type: module
```

## Configuration

```yaml
type: custom:beautiful-weather-card
entity: weather.your_station
```

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | — | **Required.** A `weather.*` entity with hourly forecast support |
| `title` | string | entity name | Card heading |
| `chart_mode` | string | `trend` | Initial view: `trend` (week overview) or `today` (single day) |
| `trend_days` | number | `7` | Upper limit for the days the overview covers (max 7; a narrow card shows fewer) |
| `trend_bucket_hours` | number | `3` | Hours aggregated per bar in the trend view |
| `chart_height` | number | `220` | Chart height in pixels |
| `show_current` | boolean | `true` | Header with the current temperature and condition |
| `show_detail_row` | boolean | `true` | Read-out row for the selected hour |
| `show_day_strip` | boolean | `true` | Show day tiles above the chart |
| `round_temp` | boolean | `false` | Show whole degrees only |
| `temperature_gradient` | list | see below | Custom temperature colour scale |
| `precip_bands` | list | see below | Custom precipitation intensity bands |
| `history` | map | — | Sensors supplying recorded values for hours already past |

### Navigation

The card opens on the week overview. Tapping a day's area in the chart opens the
day view for that day; the tiles of the day strip do the same. The day view
carries a row of three controls — previous day, back to the overview, next day —
with the arrows disabled at the ends of the available forecast period.

### The day strip

Above the chart sits a row of day tiles: weekday, condition icon and the day's
high and low. Each tile is exactly as wide as that day's stretch of the chart
below it, so the strip reads as a header for the plot rather than as a separate
control.

The strip does not scroll. How many days fit follows from the card width — a
full-width card shows seven, a narrow one in a column layout fewer — and the
chart always covers exactly the days the strip lists. `trend_days` caps that
number but cannot raise it above what fits.

Turn it off with `show_day_strip: false`; the overview then labels the weekdays
on its own axis.

### Measured values for the current day

Both views start at midnight of their first day, and the forecast only reaches
forward — so without this the hours of today that already passed stay empty in
the day view and at the left edge of the overview. Point the card at the sensor
entities of your station and those hours are filled from the recorder:

```yaml
type: custom:beautiful-weather-card
entity: weather.muenchen_stadt
history:
  temperature: sensor.muenchen_stadt_temperatur
  precipitation: sensor.muenchen_stadt_niederschlag
  precipitation_probability: sensor.muenchen_stadt_niederschlagswahrscheinlichkeit
```

All keys are optional — configure only the ones you have. Entity names differ
per station, which is why they are configured explicitly rather than guessed.
If the recorder holds no data for the period, the card falls back to the
forecast alone instead of erroring.

Recorded hours are set apart from the forecast by a shaded background and a
vertical line at the current hour, labelled *Measured* / *Forecast* in the day
view. The overview draws the same line without the labels — there is no room
for them next to it.

### Custom colours

The temperature scale is a list of stops; values between them are interpolated linearly.

```yaml
type: custom:beautiful-weather-card
entity: weather.your_station
temperature_gradient:
  - { temp: -25, color: 'rgb(90, 60, 160)' }
  - { temp: 0,   color: 'rgb(60, 180, 120)' }
  - { temp: 15,  color: 'rgb(245, 200, 40)' }
  - { temp: 30,  color: 'rgb(230, 70, 40)' }
```

Stops accept hex, `rgb()` and `rgba()`. Named CSS colours are not supported here.

Precipitation bands stack from the bottom up, so a bar showing 4 mm/h is drawn as a light segment, a medium one and a dark one on top:

```yaml
precip_bands:
  - { from: 0,   to: 0.5, color: 'rgba(178, 235, 245, .9)',  label: 'light' }
  - { from: 0.5, to: 2.5, color: 'rgba(77, 208, 225, .95)',  label: 'moderate' }
  - { from: 2.5, to: 10,  color: 'rgba(0, 151, 190, 1)',     label: 'heavy' }
  - { from: 10,  to: ~,   color: 'rgba(10, 80, 140, 1)',     label: 'extreme' }
```

### Two cards side by side

`chart_mode` only picks the view a card starts on, so both can sit next to each other:

```yaml
type: horizontal-stack
cards:
  - type: custom:beautiful-weather-card
    entity: weather.your_station
    chart_mode: today
  - type: custom:beautiful-weather-card
    entity: weather.your_station
    chart_mode: trend
```

## Known limitations

The DWD app draws a grey uncertainty band around the temperature curve, derived from ensemble spread. Home Assistant weather entities do not expose that data, so this card does not draw it — an approximated band would imply a forecast precision that isn't there.

## Credits

This project is not affiliated with or endorsed by the Deutscher Wetterdienst. The chart design is *inspired by* the Warnwetter app.

Built with [Chart.js](https://www.chartjs.org/) and [Lit](https://lit.dev/).

MIT licensed.
