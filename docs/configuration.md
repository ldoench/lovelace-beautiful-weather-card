# Configuration reference

```yaml
type: custom:beautiful-weather-card
entity: weather.home
```

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | — | **Required.** A `weather.*` entity with hourly forecast support |
| `title` | string | entity name | Card heading |
| `chart_mode` | string | `trend` | Initial view: `trend` (week overview) or `today` (single day) |
| `trend_days` | number | `7` | Upper limit for the days the overview covers (max 7; a narrow card shows fewer) |
| `trend_bucket_hours` | number | `1` | Hours aggregated per bar in the trend view |
| `chart_height` | number | `300` | Pixel budget for the whole card body below the card's edge — header, strips, chart and precipitation band together — so the card is the same height in both modes |
| `show_current` | boolean | `true` | Header with the current temperature and condition |
| `show_hour_strip` | boolean | `true` | Row of per-hour condition icon and rain probability above the day chart |
| `show_day_strip` | boolean | `true` | Show day tiles above the chart |
| `round_temp` | boolean | `false` | Show whole degrees only |
| `header_extras` | list | `[{ attribute: precipitation_probability }]` | Up to two small values next to the header temperature |
| `locale` | string | — (Home Assistant's language) | Force the card's texts to `de` or `en` |
| `temperature_gradient` | list | see below | Custom temperature colour scale — **YAML only**, no editor widget |
| `precip_bands` | list | see below | Custom precipitation intensity bands — **YAML only**, no editor widget |
| `history` | map | — | Sensors supplying recorded values for hours already past |

## Navigation

The card opens on the week overview. Tapping a day's area in the chart opens the
day view for that day; the tiles of the day strip do the same. The day view
carries a row of three controls — previous day, back to the overview, next day —
with the arrows disabled at the ends of the available period.

Forward, that end is the reach of the hourly forecast. Backward, the day view
can step up to seven days into the past, entirely from recorded values — but
only if the `history:` sensors below are configured; without them there is no
source for past days and the previous-day arrow stays disabled at today.

## The day strip

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

## Header extras

Up to two small values can sit left of the current temperature in the header, each with an optional icon:

```yaml
header_extras:
  - attribute: precipitation_probability   # from the current hourly forecast entry
    icon: mdi:umbrella                     # optional
  - entity: sensor.outdoor_humidity        # alternative to attribute: a custom entity's state
    icon: mdi:water-percent
```

Each entry sets exactly one of `attribute` or `entity`. `attribute` accepts `precipitation_probability` (read off the hourly forecast) or `humidity`, `wind_speed`, `pressure`, `apparent_temperature` (read off the weather entity's own attributes). Default is a single `precipitation_probability` entry; set `header_extras: []` to show none.

## Measured values for past hours and days

Both views start at midnight of their first day, and the forecast only reaches
forward — so without this the hours of today that already passed stay empty in
the day view and at the left edge of the overview, and the day view has no way
to show days before today at all. Point the card at the sensor entities of
your station and those hours — up to seven days back in the day view — are
filled from the recorder instead:

```yaml
type: custom:beautiful-weather-card
entity: weather.home
history:
  temperature: sensor.home_temperature
  precipitation: sensor.home_precipitation
  precipitation_probability: sensor.home_precipitation_probability
```

All keys are optional — configure only the ones you have. Entity names differ
per station, which is why they are configured explicitly rather than guessed.
If the recorder holds no data for the period, the card falls back to the
forecast alone instead of erroring.

Recorded hours are set apart from the forecast by a shaded background and a
vertical line at the current hour, labelled *Measured* / *Forecast* in the day
view. The overview draws the same line without the labels — there is no room
for them next to it.

## Custom colours

The temperature scale is a list of stops; values between them are interpolated linearly.

```yaml
type: custom:beautiful-weather-card
entity: weather.home
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

## Two cards side by side

`chart_mode` only picks the view a card starts on, so both can sit next to each other:

```yaml
type: horizontal-stack
cards:
  - type: custom:beautiful-weather-card
    entity: weather.home
    chart_mode: today
  - type: custom:beautiful-weather-card
    entity: weather.home
    chart_mode: trend
```
