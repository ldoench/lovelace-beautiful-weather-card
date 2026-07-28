# Meteogramm-Stil — Design-Spezifikation

Referenz für `forecast.style: meteogram`. Vorlage ist die Diagrammdarstellung der DWD-Warnwetter-App.

Zwei Elemente überlagern sich auf einer gemeinsamen Zeitachse:

1. **Temperaturkurve**, deren Farbe den Temperaturwert kodiert
2. **Niederschlagsbalken** in mm/h, nach oben hin dunkler werdend

## Ansichten

| Modus | Zeitraum | Zweck |
|---|---|---|
| `today` | ein **Kalendertag** (00:00–24:00 lokal), stündlich | Detailansicht, Stundenwerte gehovert für Details |
| `trend` | **ganze Kalendertage ab heute 00:00**, bis zu 7, stündliche Balken | Temperaturverlauf und Regenzeitpunkte auf einen Blick, keine Detailwerte nötig |

Beide Ansichten zeigen bewusst Kalendertage, kein rollendes Fenster ab der
aktuellen Stunde: die Tagesleiste darüber setzt eine Kachel pro Kalendertag, und
die bereits vergangenen Stunden des heutigen Tages kommen aus dem Recorder
(siehe „Messwerte"). Ohne konfigurierte `history:` fehlen diese Stunden schlicht
— mehr hat die Prognose allein nicht zu bieten.

**Einstieg ist die Wochenübersicht** (`trend`). Es gibt keinen Moduswähler: Ein Tap auf die Chart-Fläche eines Wochentags öffnet dessen Tagesansicht — der geklickte Index wird über seinen Kalendertag in einen `day_offset` übersetzt. Die Tagesleiste (`show_day_strip`) tut dasselbe und bleibt als zusätzlicher Weg bestehen.

In der Tagesansicht steht eine Reihe mit genau drei Bedienelementen: voriger Tag, zurück zur Übersicht, nächster Tag. Die Pfeile werden am Rand des verfügbaren Prognosezeitraums **deaktiviert, nicht versteckt** — sonst springt die Reihe in der Breite.

Beide Ansichten stammen aus **derselben stündlichen Prognose**. Moduswechsel = Daten neu slicen + `chart.update()`, keine zweite Subscription.

## Temperatur-Farbverlauf

Die Farbe kodiert den **Wert**, also die vertikale Position — nicht die Steigung.

Umsetzung als vertikaler `CanvasGradient`:

```js
ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top)
```

Die Stops werden aus dem aktuellen Wertebereich der `TempAxis` berechnet: für jeden Farbstop wird seine Temperatur auf eine relative Position `0…1` innerhalb von `[scale.min, scale.max]` abgebildet. Gesetzt wird das als *scriptable* Option `borderColor: (ctx) => …`, damit der Gradient bei Resize und Skalenwechsel neu entsteht.

**Edge Cases, die abgefangen werden müssen:**

- `chart.chartArea` ist beim allerersten Render `undefined` → dann eine einfache Fallback-Farbe zurückgeben, Chart.js ruft den Callback danach erneut auf.
- Der sichtbare Skalenbereich kann komplett zwischen zwei Stops liegen (z. B. 16–19 °C) → dann muss trotzdem korrekt interpoliert werden, nicht auf einen Stop einrasten.
- Stops außerhalb des Skalenbereichs müssen auf `0`/`1` geklemmt werden; `addColorStop` wirft bei Werten außerhalb `[0,1]`.

### Default-Stops

Konfigurierbar über `forecast.temperature_gradient`.

| °C | Farbe | |
|---:|---|---|
| −25 | `rgb(90, 60, 160)` | violett |
| −15 | `rgb(60, 100, 200)` | blau |
| −5 | `rgb(80, 170, 220)` | hellblau |
| 0 | `rgb(60, 180, 120)` | grün |
| 8 | `rgb(180, 200, 60)` | gelbgrün |
| 15 | `rgb(245, 200, 40)` | gelb |
| 22 | `rgb(245, 150, 30)` | orange |
| 30 | `rgb(230, 70, 40)` | rot |
| 38 | `rgb(160, 20, 40)` | dunkelrot |

Zwischenwerte werden linear im RGB-Raum interpoliert.

Kalibrierung gegen die Vorlage: bei 15 °C goldgelb, bei 21 °C orange, bei 33 °C tiefrot.

## Niederschlags-Intensitätsbänder

Der mm/h-Wert einer Stunde wird auf mehrere gestapelte Datasets aufgeteilt. Band *k* mit Grenzen `[lower, upper]` erhält:

```
clamp(v - lower, 0, upper - lower)
```

Mit `stacked: true` auf x-Achse und `PrecipAxis` ergibt das einen Balken, der unten hell beginnt und nach oben dunkler wird — je mehr Niederschlag, desto mehr dunkle Segmente.

### Default-Bänder

Radartypische Intensitätsrampe, konfigurierbar über `precip_bands`.

| Band | mm/h | Farbe | Label |
|---|---|---|---|
| 1 | 0 – 0.1 | `rgb(190, 240, 250)` hellcyan | sehr gering |
| 2 | 0.1 – 0.5 | `rgb(60, 220, 240)` cyan | gering |
| 3 | 0.5 – 1 | `rgb(38, 140, 60)` grün | leicht |
| 4 | 1 – 2 | `rgb(120, 200, 70)` hellgrün | mäßig |
| 5 | 2 – 5 | `rgb(240, 205, 45)` gelb | stark |
| 6 | 5 – 10 | `rgb(240, 140, 35)` orange | sehr stark |
| 7 | > 10 | `rgb(215, 45, 40)` rot | extrem |

### Skalierung der Niederschlagsachse

Die Achse skaliert **adaptiv** auf `max(2 mm, beobachtetes Maximum × 1.25)`. Eine feste Achse bis zur Extremschwelle würde Nieselregen unsichtbar quetschen, weil die unteren Bänder viel schmaler sind als die oberen. Die Farbe kodiert weiterhin die absolute Intensität — eine nachskalierte Achse kann leichten Regen also nicht schwer aussehen lassen.

## Tagesleiste

Über dem Diagramm steht eine Reihe von Tageskacheln, wie in der Vorlage. Sie ist
**Kopfzeile des Diagramms, kein eigenes Bedienelement**:

- **Jede Kachel ist exakt so breit wie der Bereich ihres Tages im Diagramm.** Die
  Plotfläche ist schmaler als die Karte (Temperaturachse links, Intensitätslabels
  rechts), deshalb wird das horizontale Padding der Leiste aus `chart.chartArea`
  gesetzt. Chart.js kennt die Werte erst nach dem Vermessen der Achsen — gelesen
  wird im `afterLayout`-Hook (`layoutReportPlugin` in `chart.js`,
  `alignDayStrip()` in `day-strip.js`).
- Die Kachelbreiten sind **proportional zur Stundenzahl des Tages**, nicht gleich.
  Ohne Recorder-Historie beginnt der erste Tag mittendrin und bekommt eine
  entsprechend schmale Kachel.
- **Kein Scrollen.** Wie viele Tage passen, folgt aus der Kartenbreite
  (`ResizeObserver`, ~44 px Mindestbreite pro Kachel), gedeckelt auf 7 und auf
  `trend_days`. Das Ergebnis ist das effektive `trend_days` — **Leiste und
  Diagramm decken immer denselben Zeitraum ab**.
- Kacheln zu schmal für den Min/Max-Wert lassen ihn weg statt ihn abzuschneiden;
  gemessen wird der breiteste Wert der Reihe, damit nicht einzelne Kacheln
  ausscheren.
- **Keine Button-Optik**: kein Rahmen, kein Kachelhintergrund. Der ausgewählte Tag
  bekommt eine Haarlinie unter der Kachel.
- Inhalt je Kachel: Wochentag auf **zwei Buchstaben** gekürzt, darunter das
  Wetter-Icon, darunter Max/Min **ohne Nachkommastellen**.
- **Das Icon ist farbig** (Sonne gelb, Regen blau, Wolke grau) — die einzige
  Ausnahme von der Regel „keine Farbe außerhalb des Diagramms". Eine Reihe grauer
  Glyphen ist schlecht zu scannen, und genau diese Unterscheidung leistet Farbe
  sofort. Werte in `CONDITION_COLORS` (`const.js`), fest statt aus Theme-Variablen:
  Sie müssen in hell und dunkel dasselbe bedeuten.

## Achsen

- **Links (`TempAxis`)** — Temperatur, Ticks sichtbar, kein Gitter. `suggestedMin/Max` mit etwas Luft um die Datenwerte. Die **Mindestspanne ist modusabhängig**: `today` 15 °, `trend` 28 ° (durch die 5er-Schritte praktisch 30 °). Die Übersicht wird dadurch flacher und zeigt den Wochentrend statt jeder Nachtabsenkung — ohne dass die Karte beim Moduswechsel ihre Höhe ändert. Details gehören in die Tagesansicht.
- **Rechts (`PrecipAxis`)** — Niederschlag, aber **mit Kategorie-Labels statt Zahlen**: `gering / leicht / stark / extrem`. Umsetzung über `afterBuildTicks` (Ticks auf die Bandgrenzen setzen) plus `ticks.callback` (Bandnamen zurückgeben, lokalisiert).
- **x-Achse** — im `today`-Modus Uhrzeit alle 3 h; im `trend`-Modus ein Label pro Tag (Wochentag kurz) an Mitternacht, mit Gitterlinie an den Tagesgrenzen.

## Interaktion (`today`)

- `interaction: { mode: 'index', intersect: false }`
- Ein kleines Chart.js-Plugin zeichnet eine **vertikale Crosshair-Linie** am aktiven Index.
- Statt eines flüchtigen Floating-Tooltips werden die Werte in eine **feste, von Lit gerenderte Detailzeile** über dem Chart geschrieben: Uhrzeit, Temperatur, mm, Regenwahrscheinlichkeit, Wind.
- Die Auswahl per Tap bleibt stehen (`_selectedIndex`), Default ist die aktuelle Stunde.

Begründung: auf dem Handy ist ein Floating-Tooltip schlecht bedienbar und verdeckt den Chart. Die feste Zeile entspricht auch der Vorlage.

## Trend-Ansicht

- Temperaturkurve stündlich, `tension: 0.3`, `pointRadius: 0`, gleicher Gradient.
- Niederschlag auf **3-h-Buckets** aggregiert (`trend_bucket_hours`, Default 3) — 168 Einzelbalken wären zu dicht. Aggregation ist die **Summe** der mm pro Bucket.
- Keine Datalabels. Tooltip bleibt aktiv, aber ohne Crosshair-Detailzeile.
- Der Tooltip zeigt **einen Block pro Zeitpunkt**, keinen Eintrag pro Dataset: Temperatur, die Summe der Niederschlagsbänder (nur > 0) und die Regenwahrscheinlichkeit (nur wenn vorhanden). Mit `interaction.mode: 'index'` erzeugt Chart.js sonst je einen Eintrag für die Linie und für jedes der Bänder. Umsetzung über `tooltip.filter`, das alles außer dem ersten Item verwirft.

## Messwerte für vergangene Stunden

Die Vorlage teilt den Chart in **Messwerte** (Vergangenheit, abgesetzter Hintergrund) und **Prognose** (Zukunft), getrennt durch eine senkrechte Linie. Die Prognose-Subscription liefert nur Zukunftswerte — für die vergangenen Stunden des aktuellen Tages müssen die aufgezeichneten Werte aus dem HA-Recorder kommen.

Das gilt für **beide Ansichten**: seit beide um 00:00 beginnen, braucht auch die Übersicht die Messwerte für ihren linken Rand. Die Trennlinie wird dort ebenfalls gezeichnet, aber **ohne die Beschriftungen** — bei einer Woche pro Plotfläche bleiben neben der Linie nur wenige Pixel, der abgesetzte Hintergrund trägt die Bedeutung allein.

Vorgehen:

- Abruf über `hass.callWS({ type: 'history/history_during_period', start_time, end_time, entity_ids, minimal_response: true, no_attributes: true })`, Zeitraum von lokal 00:00 bis jetzt.
- Die `weather.*`-Entität selbst taugt dafür nicht: die Temperatur steckt in einem Attribut, und Attributhistorie ist teuer abzufragen. Stattdessen die **dedizierten Sensor-Entitäten** der DWD-Integration nutzen.
- Konfiguration explizit statt Autoerkennung (Sensornamen variieren je Station):

  ```yaml
  history:
    temperature: sensor.station_temperature
    precipitation: sensor.station_precipitation
    precipitation_probability: sensor.station_precipitation_probability
  ```

- Ohne Konfiguration bleibt es beim reinen Prognoseverlauf — kein Fehler, nur kein Messwertteil (und ein schmaler erster Tag in der Übersicht).
- Gemessene Stunden werden visuell abgesetzt plus senkrechte „Jetzt"-Linie, in der Tagesansicht mit den Beschriftungen `Messwerte` / `Prognose` (Locale-Keys `measured` / `forecast`).
- Stundenwerte aus der Historie müssen auf volle Stunden aggregiert werden (Temperatur: Mittel oder letzter Wert; Niederschlag: Summe), da der Recorder unregelmäßig abtastet.

## Nicht umsetzbar: Unsicherheitsband

Die Vorlage zeigt ein graues Band um die Temperaturkurve (Ensemble-Spread). Die HA-Weather-Entity liefert diese Daten nicht. **Nicht nachbauen** — ein erfundenes Band würde eine Genauigkeit suggerieren, die nicht existiert. Im README vermerken.

## Konfigurationsoptionen

Alle auf oberster Ebene der Kartenkonfiguration (kein `forecast:`-Block — der stammte aus dem Upstream und entfiel beim Neuschrieb):

| Option | Typ | Default | Bedeutung |
|---|---|---|---|
| `entity` | string | — | Pflicht, die `weather.*`-Entität |
| `title` | string | — | optionale Kartenüberschrift |
| `chart_mode` | string | `trend` | `trend` \| `today` — Startansicht |
| `trend_days` | number | `7` | Obergrenze für den Zeitraum der Übersicht (max. 7, schmale Karten zeigen weniger) |
| `trend_bucket_hours` | number | `3` | Aggregationsfenster der Trend-Balken |
| `chart_height` | number | `220` | Höhe der Chart-Fläche in px |
| `show_current` | bool | `true` | Kopfzeile mit aktueller Temperatur und Bedingung |
| `show_detail_row` | bool | `true` | Detailzeile für den angetippten Stundenwert |
| `show_day_strip` | bool | `true` | Tagesleiste über dem Chart |
| `round_temp` | bool | `false` | Temperaturen ganzzahlig anzeigen |
| `temperature_gradient` | array | s. o. | `[{ temp, color }, …]` |
| `precip_bands` | array | s. o. | `[{ from, to, color, label }, …]` |

Beispiel:

```yaml
type: custom:beautiful-weather-card
entity: weather.home
chart_mode: trend
trend_days: 7
```

## Datengrundlage

Ausgangspunkt war [`FL550/dwd_weather`](https://github.com/FL550/dwd_weather):

- 216 Stundeneinträge verfügbar (9 Tage) — reicht für `trend_days` bis 9
- `precipitation` ist bereits mm pro Stunde, keine Umrechnung nötig
- `precipitation_probability` kann `None` sein → Detailzeile und Tooltip müssen das auslassen statt `NaN` zu zeigen
- Fallback wenn `hourly` nicht reicht (andere Integrationen): auf `daily` zurückfallen, Kurve aus Min/Max
