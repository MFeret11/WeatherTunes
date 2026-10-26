# WeatherTunes — Spec

Status: M0–M2 built and live at mferet.com/WeatherTunes/, 2026-10-23 (the composer, the audio engine, live weather for your location or any city, and ten sample days). After M2 the climate also picks the melody and pad instruments (§6.2), so places sound different, not just play different notes. On 2026-10-24 the sky and the air joined in (§6.3b): the moon, auroras, meteor showers, solstices, holidays, air quality, UV, dew point, snow cover and frost. Replaces the 2022 Python/pyo prototype.

## 1. The pitch

Open the page, allow location (or type a city), press Play. Today's forecast where you are becomes a 20-second piece of music. Each hour of the day gets two beats (half a bar). The temperature curve shapes the melody, the sky picks the scale, the wind sets the tempo, and rain adds percussion. Then you can play with it: change the waveform, EQ, filter and effects, mute layers, or play along on your keyboard in the day's key.

Same place and same day always gives the same song, so a link can be shared. A different city or a different day gives a different song.

It's a portfolio piece, so the reasoning should be on screen. Every song comes with **liner notes**, a short explanation like: *"Kyoto, Thu Oct 23 — D Dorian at 96 BPM. Mostly cloudy (Dorian), breezy (96 BPM), high of 19 °C at 2 pm (the melody's peak), 60 % rain after 6 pm (rain shakers come in at bar 19)."*

## 2. Goals and non-goals

**Goals**
- Works for anyone, anywhere in the world, in a desktop or phone browser.
- Sounds musical every time: notes stay in a scale, strong beats land on chord tones, and phrases resolve.
- A listener can see how the weather became the song.
- Static site with no backend, no API keys, no accounts and nothing to pay for.
- Fits the portfolio's style (shared colour tokens, light and dark themes, no build step).

**Non-goals (v1)**
- AI or ML music generation. The mapping is hand-designed and explainable on purpose.
- Saving user data or locations on any server.
- Historical climate data, multi-day pieces, or a native app.
- Commercial use. That would change the Open-Meteo terms (§4).

## 3. Prior art (what exists, what's different)

| Project | What it does | Takeaway |
|---|---|---|
| [Weather Machine](https://www.synthtopia.com/content/2018/02/22/weather-machine-an-experiment-in-forecast-sonification/) (Matt McCorkle, 2018) | Ambient soundscape from Dark Sky forecasts; pick a location and toggle forecast facets | Closest idea. Dark Sky shut down, and it's soundscape, not melody. Good model for "toggle facets". |
| [TwoTone](https://twotone.io/) | General data-to-music web tool; upload a dataset | Proves the mapping approach; not live, not weather-specific. |
| [Helioradar AV](https://av.helioradar.com/) | Live browser soundscape from NOAA solar wind data | Good reference for a live, data-driven, generative page. |
| [Listening to the Weather](https://www.paulfletcherartwork.com/listening-to-the-weather.html) (Paul Fletcher) | Artwork sonifying weather | Art-side inspiration. |
| [Generative Music with JavaScript — Sonification](https://meleyal.github.io/generative-music-with-javascript/generative/sonification) | Tutorial chapter on mapping data to pitch, duration, volume, pan, timbre | Handy reference while building. |

**What's different here:** today's forecast for *your* location, a melody built with music theory rather than a raw data-to-pitch mapping, a synth you can play, deterministic shareable songs, and liner notes that explain the result.

## 4. Building blocks (reuse, don't build)

### Weather: Open-Meteo (switch from NWS)
- `api.weather.gov` covers the US only, which rules it out for a worldwide audience.
- **[Open-Meteo](https://open-meteo.com/)**: worldwide, no API key, CORS open (`Access-Control-Allow-Origin: *`, checked 2026-10-23), hourly data, and `timezone=auto` returns the hours in the location's local time. It's free for non-commercial use up to about 10,000 calls a day. The data is CC BY 4.0, so the page must show *"Weather data by Open-Meteo.com"* with a link.
- Its **geocoding API** (`geocoding-api.open-meteo.com/v1/search?name=…`) handles the city search box. It is also free, keyless and worldwide.
- One request per song:
  ```
  https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}
    &hourly=temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,
            wind_gusts_10m,wind_direction_10m,precipitation_probability,
            precipitation,cloud_cover,weather_code,is_day
    &daily=sunrise,sunset,temperature_2m_max,temperature_2m_min
    &timezone=auto&forecast_days=1
  ```
  Shared links for past dates add `&past_days=N` (Open-Meteo allows up to 92) or use `start_date`/`end_date`.

### Sky, air and calendar (added 2026-10-24)
All optional: each is fetched alongside the forecast with a 4-second limit, and a song simply leaves out anything that doesn't arrive. CORS open on all three (checked 2026-10-24).
- **Air quality:** Open-Meteo's air-quality API (`air-quality-api.open-meteo.com/v1/air-quality?hourly=us_aqi`), same terms and rounded coordinates as the forecast.
- **Aurora activity:** NOAA SWPC's planetary Kp forecast (`services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json`), 3-hourly, public domain. No location is sent. Sample days use GFZ Potsdam's definitive Kp (CC BY 4.0).
- **Public holidays:** Nager.Date (`date.nager.at/api/v3/PublicHolidays/{year}/{cc}`). Only the country code is sent; it comes from the city search, the featured-city list, a `cc` link parameter, or (for your own location) the browser's language region. Cached a week per country.
- **Recent lows** for "first frost": the forecast API's daily minimum with `past_days=60`.
- **UV index and snow depth** join the main forecast request. **Dew point and feels-like** are calculated from temperature, humidity and wind (Magnus formula; the Australian apparent temperature, as Open-Meteo uses).
- **The moon and the calendar need no service:** `src/sky.js` works out the moon's phase, rise and set, lunar eclipses, solstices and equinoxes, meteor showers (a table of the eight major ones) and magnetic latitude in the browser. Times use the browser's time-zone rules, because Open-Meteo reports today's UTC offset even for past dates.

### Sound: Tone.js
- **[Tone.js](https://github.com/Tonejs/Tone.js)** (MIT) is a Web Audio framework with a transport and scheduler, ready-made synths (`Synth`, `FMSynth`, `AMSynth`, `MonoSynth`, `PolySynth`, `NoiseSynth`, `MetalSynth`), and effects (`EQ3`, `Filter`, `Reverb`, `FeedbackDelay`, `Recorder`). That covers almost the whole audio engine.
- Pin **15.1.22** (latest stable, April 2025). Bundle it as `vendor/tone-15.1.22.js` (345 KB, about 80 KB gzipped) instead of loading it from a CDN. The portfolio has a no-CDN rule because a dead CDN broke it once.
- Alternative considered: raw Web Audio API. It would mean no dependency, but we'd have to write our own scheduler and synth voices. Not worth it.

### Location: browser Geolocation API
- `navigator.geolocation.getCurrentPosition` needs a user click and HTTPS (GitHub Pages provides HTTPS).
- If the user declines or it fails, show the city search box. No IP-based lookup, because it would send visitor data to a third party.
- Your own location is labelled **"Near you"**, not a town name. Open-Meteo has no reverse geocoding, and the services that do would receive visitors' coordinates. It is never put in the URL. The browser only remembers that you chose your location, and uses it again on later visits only if location permission is already granted.
- A searched city is remembered in `localStorage` (this browser only) and put in the URL as `?name=&lat=&lon=` with coordinates rounded to 0.1°, so the link can be shared.

## 5. Architecture

Static site, plain ES modules, no build step, no framework.

```
WeatherTunes/
  index.html            page shell, controls, liner notes
  styles.css            uses the portfolio's tokens and both themes
  src/
    weather.js          fetch + normalize Open-Meteo → Forecast object; geocoding; cache; extras (air, Kp, holidays, lows)
    sky.js              PURE: moon, eclipses, solstices, meteor showers, magnetic latitude
    compose.js          PURE: (Forecast, seed) → Score   ← the heart; no Tone, no DOM
    mapping.js          all tunable constants (ranges, mode table, progressions)
    engine.js           Tone.js graph: instruments, effects, schedules a Score (always inside Tone.Offline)
    stream.js           renders ahead and streams the audio to a buffer player (see §10)
    tap.worklet.js      hands an offline render's audio to the page block by block
    controls.js         synth panel ↔ engine params; "back to the forecast" reset
    theory.js           modes, triads, note names, seeded RNG
    viz.js              forecast chart with a moving playhead; notes light up
    keyboard.js         play-along: computer keys / touch → notes in today's scale
    share.js            URL params ⇄ state
    main.js             wiring
  vendor/tone-15.1.22.js
  samples/*.json        real forecasts for ten contrasting days (tests + offline fallback)
  tools/fetch_fixtures.py   picks and saves those days from Open-Meteo's archive
  test/
    index.html + compose.test.js   composer tests; run in a browser (the Pi has no Node)
    summary.html        every sample's key, mode, tempo and liner notes
    render.html         offline render → peak, loudness, clipping (per layer with &solo=)
```

**Data flow:** location → `weather.js` → `Forecast` → `compose.js` → `Score` → `stream.js` + `engine.js` (audio) + `viz.js` (picture) + liner notes (text).

`compose.js` is a pure function with no browser or audio APIs, so it is easy to test. Its output is plain data:

```js
Score = {
  meta:   { place, date, root: "D", mode: "dorian", bpm: 96, bars: 24, voices: { melody, pad }, notes: [...liner note strings] },
  melody: [{ time: "0:0:0", note: "D4", dur: "4n", vel: 0.8 }, ...],
  bass:   [...], pad: [...chords...], rain: [...hits...], fx: [{ time, type: "thunder" }, ...],
  automation: { melodyPan: [...per bar], filterCutoff: [...per bar], reverbWet: 0.35 }
}
```

**Caching:** keep the raw forecast in `sessionStorage`, keyed by rounded lat/lon and date, so pressing Replay or changing controls doesn't call the API again.

## 6. Weather → music mapping

All numbers live in `mapping.js` so they can be tuned by ear without touching the logic. The rule of thumb is **weather picks the musical choices, music theory keeps them in tune.**

### 6.1 Form
- 24 hourly values give **24 half-bar slots (12 bars of 4/4)**, from midnight to 11 pm local time. That's about 18–29 s at 100–156 BPM. Every hour keeps its own slot, so a storm that passes in an hour still gets its moment.
- Three 8-bar sections: Night (0–7), Day (8–15), Evening (16–23). These line up with the 4-chord loop at 2 bars per chord, which a 6-bar section would not.
- The piece plays once, fading in at the start and out over the last hour, then stops. Pressing Play again starts it over.

### 6.2 Global choices (computed once per day)

| Musical choice | Weather input | Rule |
|---|---|---|
| **Mode (scale)** | "Brightness" = 1 − cloud − rain chance − rainfall − storm | Modes ranked bright to dark: **Lydian → Ionian (major) → Mixolydian → Dorian → Aeolian (minor) → Phrygian**. Lydian also needs a warm day (mean ≥ 15 °C), so a clear polar day is plain major. Sunny is Lydian or Ionian, partly cloudy Mixolydian, grey Dorian, rainy Aeolian, downpours and storms Phrygian. The cut-offs (0.88, 0.76, 0.66, 0.56, 0.2) were set from 89 ordinary days, so everyday weather spreads across the modes instead of bunching in the bright ones. A **storm day** is any thunder code, any hour with ≥ 8 mm of rain, or ≥ 75 km/h gusts with rain. Thunder codes alone aren't enough because the forecast model rarely issues them. Snow days keep the mode's chords but play a **pentatonic** melody (soft, bell-like). |
| **Key (root)** | Mean sea-level pressure (hPa) | `root = round(meanPressure) mod 12`. Pressure ranges from about 980 to 1040 hPa, so every key turns up. |
| **Tempo** | Mean wind speed | `bpm = clamp(100 + 2.6 × wind_kmh, 100, 156)`: ordinary days (4–19 km/h) spread from about 110 to 150 |
| **Register** | Daily mean temperature | Cold days sit lower and hot days higher, shifting by up to ±3 scale steps |
| **Chord progression** | Pressure trend over the day (rising, steady, falling) | Each mode has two proven 4-chord loops per trend, and the day's seed picks one. Rising (clearing) loops climb or resolve, like I–V–vi–IV or i–ii–♭III–IV. Falling (worsening) loops descend, like IV–♭III–ii–i or i–♭VII–♭VI–v. Diminished chords are left out. The chord changes every 2 bars, the loop runs 3 times, and the last 2 bars always return to the tonic chord. |
| **Reverb amount** | Mean humidity | 10 % at 30 % RH up to 60 % at 100 % RH, so muggy days sound wetter |
| **Melody instrument** | Mean feels-like temperature (§6.3b) | Below −8 °C glass bells (FM), below 6 °C a breathy flute with vibrato, below 13 °C soft keys (triangle), below 20 °C plucked strings (a saw with a snapping filter), below 30 °C a marimba (FM), hotter a reedy pipe (pulse wave with vibrato). Named in the liner notes. |
| **Pad instrument** | Storm, snow, rain, cloud, temperature, humidity (first match wins) | Storm: dark detuned saws. Snow: hushed choir. Grey drizzle (≥ 75 % cloud, ≤ 20 °C, ≥ 6 drizzly hours): ghostly wordless voices. Wet (≥ 50 % rain chance or ≥ 5 mm): wobbling electric piano (tremolo). Cloudy (≥ 50 %) splits three ways: 18 °C or warmer, warm hazy horns; heavy grey (≥ 75 %), muffled organ; otherwise broken cloud, slow drifting swells. (One organ used to take every cloudy day, 40 % of ordinary days.) Clear and below 0 °C: thin icy shimmer. Clear and humid (≥ 60 % RH): lush strings. Otherwise an airy, open pad. |

### 6.3 Per-bar choices (hour by hour)

| Layer | Weather input | Rule |
|---|---|---|
| **Melody pitch** | Temperature | The hour's temperature sets the **anchor note** on beat 1. Temperatures are scaled across the day's range, with a **minimum span of 8 °C** so a flat day doesn't stretch tiny changes into big leaps, then mapped onto about 1.5 octaves of the scale. The melody's high point is the day's high temperature. |
| **Melody rhythm** | Wind gusts | Calm hours get 1–2 notes (whole or half notes); gusty hours get up to 8 (eighth notes). |
| **Passing notes** | — (music rules) | Fill the bar by **walking stepwise** from this hour's anchor toward the next hour's. Leftover slots get neighbour tones picked with the seeded RNG. |
| **Rests** | Cloud cover | `restChance = 0.3 × cloud_cover`, so overcast hours are sparser. Never on beat 1. |
| **Melody pan** | Wind direction | `pan = 0.6 × sin(bearing)`: east wind leans right, west wind leans left. |
| **Brightness** | Cloud cover, day or night | Filter cutoff drops with cloud cover and drops more at night (`is_day = 0`). |
| **Bass** | Chord root | Root on beats 1 and 3. Windier hours add an octave or fifth on the off-beats. |
| **Pad** | Chord and cloud cover | Held chord; louder on cloudier hours. |
| **Rain shakers** | Precipitation probability and amount | Filtered-noise hits on off-beats. Rain probability sets how many; rainfall in mm sets how loud. This keeps the noise-plus-filter idea from the pyo prototype. |
| **Atmosphere** | Weather code and rainfall | A continuous noise bed that follows the hour's conditions. Its colour and level crossfade bar by bar: fog is a faint white hiss, drizzle is light white noise, rain and showers are pink noise that gets louder with rainfall, snow is muffled pink noise, and storm hours are deep brown noise. |
| **Wind noise** | Gusts above 45 km/h | Pink noise through a slowly sweeping band-pass filter, reaching full level at 100 km/h. The threshold is high because models often forecast 40 km/h gusts on calm days. |
| **Snow** | Weather codes 71–77, 85–86 | Rain hits become FM bell notes in the scale. |
| **Thunder** | Storm hours (see Mode) | A low brown-noise rumble on beat 3 of that bar. |
| **Sunrise / sunset** | Daily sunrise and sunset times | A short cymbal-like swell at those bars, and the melody fades in and out around them. |

### 6.3a The day's story

The day's mode is only the starting mood. Each chord (2 hours) takes the brightness of its darker hour, lightly smoothed, and when that clearly leaves the current mode's band (by `STORY.margin`, after at least `STORY.minChords` chords) the song starts a new chapter in that mode on the same tonic. Darker chapters open straight on their tonic; brighter ones (a clearing) are prepared by V or IV of the new mode and get a cymbal swell. A calm, even day keeps one mood; a day that builds to a storm and clears tells that story. Bass feel, distortion, EQ and dynamics follow the same weather hour by hour, never the clock.

### 6.3a+ Chord colour and the dry beat (added 2026-10-24)

Numbers are in `CHORD_COLOUR` and `DRY_BEAT` in `mapping.js`. Each chord (2 hours) takes its colour from its own hours:

| Input | What you hear |
|---|---|
| **Dew point** (10 → 20 °C) | The chord's 7th fades in, so humid days sound lush (i7, IVmaj7). |
| **Clear daylight** ((1 − cloud) × daylight, 0.5 → 0.9) | The 9th fades in, so sunny days sound open (add9). Only a whole-tone 9th. |
| **Fog** | sus2: the third gives way to the second, neither major nor minor. |
| **Pressure moving ≥ 2.5 hPa in 2 hours** | sus4: a front passing leaves the chord hanging. Only a perfect 4th; never on the final chord. |
| **Mean wind ≥ 25 km/h** | The chord spreads over more than an octave. |

Pad chords are voice-led (each note moves as little as it can), and colour notes sit just above the chord. On a sus chord the melody's strong beats follow the sus note instead of the third.

**Held notes** (`HOLD`): when the melody would strike the same pitch again straight away and the hour is steady (gusts, cloud, rain chance and rainfall barely moved since the hour before), the two notes become one, up to a whole note. The same pitch already means the temperature held. A new section always strikes a fresh note, and a change in the weather strikes it again.

The **dry beat** plays in the hours the rain beat leaves alone (no rain, no snow, not a storm's build or peak): hi-hats from the wind (none when still, off-beats in a breeze, up to sixteenths), the kick from the feels-like temperature (a heartbeat once per chord in cold air, every beat 1 when mild, plus a push when hot), and a rim backbeat from clear sky, fading out by 60 % cloud.

The master ends in a **soft clip** (`SOFT_CLIP`): untouched below 60 % of full scale, then a smooth shoulder that never passes −1 dBFS (the headroom streaming services leave, so Bluetooth and other lossy encoders don't crackle on overshoots), so a storm's loudest hits get a little warm crunch instead of digital clipping. `test/render.html` reports how much of a song it rounds off.

**Game-music touches** (`ARP`, `ECHO`, `SWELL`, added 2026-10-24). The songs already leaned toward video game area themes, so two of that genre's signatures were added, quietly and driven by the weather:

| Input | What you hear |
|---|---|
| **Clear daylight** ((1 − cloud) × daylight, 0.4 → 0.85) | A soft pulse-wave arpeggio of the chord, above the pad. None in rain, snow, a storm's build or peak, or the last hour. |
| **Wind** (under / over 12 km/h) | The arpeggio plays eighths or sixteenths. |
| **Pressure trend** | Rising climbs, falling descends, steady goes up and back down. |
| **Clear, still, dry air** ((1 − cloud) × calm gusts, 0 when wet or foggy) | A dotted-eighth echo on the melody rings out longer. |

The sunrise, sunset and clearing swell is a short, soft breath of band-passed pink noise rather than a long white-noise rise.

### 6.3b Sky and air

None of these change the melody, bass, pad or drums; they add parts on top or shape the mix, so a song with no extras is the same song minus these touches. Numbers are in the "Sky and air" section of `mapping.js`.

| Input | What you hear |
|---|---|
| **Moonlight** (lit fraction × height × darkness × clear sky) | The night dims the melody and filter less under a bright moon. A moonrise after dark, under a clear enough sky, rings one bell on the key's fifth. A visible lunar eclipse takes the moonlight away for its hour. |
| **Aurora** (magnetic latitude and Kp → reach, × deep darkness × clear sky) | A slow, wavering chord two octaves above the pad over each chord change it reaches. |
| **Meteor shower** (within a day or two of a major peak, radiant high enough) | Shooting stars: quick runs of three falling bell notes in dark, clear hours, fewer under moonlight. |
| **Solstice or equinox** | Root and fifth rung together at the exact moment. |
| **Public holiday** | A rising bell arpeggio over the final chord. |
| **Air quality** (US AQI, from 75 to full at 175) | Haze: the top end dulls, the master filter closes a little, and dust crackles in. |
| **UV index** (from 3 to full at 9) | A soft sine doubles the melody an octave up. |
| **Dew point** | Sets the swing (straight at 10 °C, full at 22 °C), since it's what makes air feel muggy. Replaces the old humidity × warmth rule. |
| **Feels-like temperature** | Picks the melody instrument (§6.2), so wind chill or humid heat can change it. |
| **Snow on the ground** | Soaks up the room: up to 45% less reverb and a softer top end at 15 cm. |
| **Frost** (clear, still, ≤ 0.5 °C, before 10 am) | Tiny high bells; two per hour on the season's first frost (no frost in the past 60 days). |

The page shows these as chips under the forecast, draws tonight's real moon phase (or stars when it's down) on the chart, and glows green over aurora hours. The liner notes mention the most notable of these (an eclipse, auroras, a meteor shower, a solstice or equinox, a holiday, the first frost) in one sentence.

### 6.4 The rules that keep it musical
1. Every melody note is in the scale, with no exceptions.
2. **Beat 1 and beat 3 snap to the nearest chord tone** of the current chord. This rule matters more than any other for making the result sound composed.
3. The last note of every section lands on the key's root or fifth. If the chord there contains neither (for example ♭II in Phrygian), it lands on a chord tone instead, which is a half cadence. The final bar is a single held root over the tonic chord.
4. Leaps bigger than a sixth are moved an octave toward the previous note. That keeps the pitch class, so chord tones stay chord tones.
5. Melody velocity follows the temperature contour gently (0.6–0.9) with a slight accent on beat 1.

### 6.5 Determinism and shareability
- Seeded PRNG (`mulberry32`). The seed is a hash of `lat.toFixed(1)`, `lon.toFixed(1)` and the date. Same inputs give the same song.
- Share URL: `?lat=35.0&lon=135.8&date=2026-10-23&name=Kyoto` plus any changed synth settings. Coordinates are **rounded to 0.1° (about 11 km)** before they go in a URL or the API call, so a shared link never shows someone's house.

## 7. The synth (what the public plays with)

The weather sets the defaults, and the user can change anything. A marker shows which controls the weather set, and **"Back to the forecast"** resets them all.

**Master**
- **EQ: Bass / Mid / Treble**, ±12 dB each (`Tone.EQ3`)
- Filter cutoff and resonance
- Reverb (decay, wet) and delay (time, feedback, wet)
- Tempo (override), volume

**Per layer: Melody, Bass, Pad, Rain**
- Mute/solo, volume
- **Wave** for Melody and Bass: sine, triangle, sawtooth, square, plus "fat" (detuned), FM and AM variants
- Envelope (ADSR) for Melody and Pad
- Octave shift for Melody

**Play along**
- Computer keys (A–K row) and an on-screen strip play notes **locked to today's scale**, so nothing played can be out of key. This lets visitors join in with the weather.

**Controls UI:** native `<input type="range">` and `<select>` with labels, so they work with a keyboard and screen readers and on touch screens. They can be styled to look like hardware later.

## 8. Page layout

1. **Header:** "WeatherTunes", a location chip ("Kyoto · Use my location · Search · Random city"), and the date. Random city picks from about 70 cities across every climate and never repeats the one playing; it links and remembers like a searched city.
2. **Hero:** the big Play button and a forecast chart. The temperature line is the melody line, with rain bars below, cloud shading behind and a sun or moon strip on top. A playhead moves across the hours, and notes light up as they play.
3. **Liner notes:** one short plain-English paragraph explaining today's choices.
4. **Synth panel:** collapsible groups (Master, Melody, Bass, Pad, Rain).
5. **Footer:** Open-Meteo attribution, a "How it works" link to the mapping table, a GitHub link and a link back to mferet.com.

Mobile: one column, the panel collapses, and the play-along strip becomes a row of touch pads. Respect `prefers-reduced-motion`: the playhead jumps instead of sliding and nothing animates.

## 9. Hosting and the portfolio

- **The app lives in this repo** and is published with GitHub Pages from `main`. Because the user site has a custom domain, it is served at **`mferet.com/WeatherTunes/`** with no change to the portfolio repo's deployment. It also stays a standalone public repo with its own history, which works better as a portfolio piece than a folder inside the site.
- **Portfolio changes** (in `MFeret11.github.io`):
  - A new story on `projects.html`: the idea, the mapping table, one or two "same day, different cities" comparisons, and what was hard (making data sound musical).
  - A card on `index.html` and a mention in the About page's Music section, next to SoundCloud.
  - Reuse the portfolio's theme tokens and fonts so the two feel like one site.
- **Retire the prototype:** remove `main.py` and `.idea/` from `main` (git history keeps them). Rewrite the README around the web app and leave a line about the Python/pyo origin.
- Note: `main.py` has a hardcoded NWS gridpoint. It's a coarse 2.5 km cell and has been public for years, so this is low risk, but the rewrite removes it.

## 10. Testing

**Automated:** `test/index.html` runs in any browser or headless Chromium (the Pi has no Node, and the project has no npm). It covers ten real forecasts picked from Open-Meteo's historical-forecast archive by `tools/fetch_fixtures.py`:
- clear, hot desert day (Phoenix, July, 47 °C)
- clear spring day (Kyoto)
- overcast drizzle (London)
- monsoon (Mumbai)
- flooding downpour (Houston, 196 mm)
- snowstorm (Oslo)
- polar night (McMurdo Station, −38 °C)
- almost flat temperatures (Honolulu)
- gale (Reykjavik, 99 km/h gusts)
- crisp, clear autumn day (Philadelphia, October)

`test/render.html` renders any sample offline and reports peak level, loudness and clipping, for the whole mix or one layer.

Assertions:
- Determinism: the same input gives an identical Score.
- Every melody note is in the scale.
- Beats 1 and 3 are chord tones, and sections and the piece end on the root or fifth.
- Notes stay within the instrument range (no note below C2 or above C7).
- No leap is bigger than a sixth.
- Rhythms fill their bars without overlapping.
- Atmosphere follows conditions (a dry day is silent, snow gives a snow bed, a gale gives wind noise).
- Missing or `null` hourly values (Open-Meteo sometimes has gaps) are filled in rather than crashing.
- The mode table gives the expected mode for each fixture.

**Manual:** Chrome, Firefox, Safari (macOS), Safari iOS and Chrome Android.
- **iOS gotcha:** Web Audio is silent when the ringer switch is off. Tell users this in a small note if no sound plays.
- Audio can only start after a click, so the Play button makes (or wakes) the audio context.
- **Phones can't run the synths live.** The Tone.js graph is hundreds of nodes, and a Pixel crackled even in 32-bit mode. So nothing is synthesised in real time: `stream.js` renders the song with `Tone.Offline` as fast as the device allows, a worklet at the end of the chain posts the audio in blocks as it's made, and a plain `AudioBufferSourceNode` player plays them back to back. Play waits until enough is ready that the rest will stay ahead (well under a second on a laptop, a couple of seconds on a phone, longer on a Raspberry Pi), so a slow device waits a little instead of crackling. A mute or 32-bit change mid-song renders from a moment ahead (`Engine.start(when, offset)` sets that hour's settings and the fade) and crossfades over. Without worklets (plain-http pages), the whole song renders first. Download reuses the same render.

**By ear:** listen to every fixture before release. If any fixture sounds bad, fix the constants in `mapping.js`.

## 11. Milestones

| # | Deliverable | Done when |
|---|---|---|
| **M0** ✅ | Repo cleanup and skeleton: remove the prototype, add `index.html`, bundle Tone.js, enable Pages | `mferet.com/WeatherTunes/` loads and a test tone plays |
| **M1** ✅ built, needs ears | `compose.js` + `mapping.js` + tests, playing a **fixture** forecast | All tests pass, and every fixture sounds good by ear |
| **M2** ✅ | Live weather: geolocation, city search, caching, attribution, error states | Your location or any searched city plays today's song |
| **M2b** ✅ | Sky and air (§6.3b): moon, aurora, meteors, solstices, holidays, air quality, UV, dew point, feels-like, snow cover, frost | Every sample day shows and plays its sky; tests check the sky maths against published events |
| **M2c** ✅ | Chord colour, dry beat, soft clip (§6.3a+) | Every sample day shows its chord names in `test/summary.html`; no sample clips hard |
| **M3** | Synth panel, "Back to the forecast", play-along keyboard | Every control in §7 works on desktop and phone |
| **M4** | Forecast chart with playhead, liner notes, share links, mobile layout, accessibility pass | A shared link reproduces the song on another device |
| **M5** | Portfolio story, homepage card and About mention | Live on mferet.com |
| Stretch | ~~Download as WAV~~ (done 2026-10-24: a Download button renders the song offline to a WAV), MIDI export (`@tonejs/midi`), "what if" sliders to change the weather, side-by-side cities | — |

M1 is the riskiest part (does it sound good?), so it comes before any UI work.

## 12. Risks

| Risk | Mitigation |
|---|---|
| It sounds random or bad | Theory rules (§6.4), fixtures checked by ear, and all constants in one file |
| Open-Meteo is down or rate-limited | Per-session cache. On error, offer to play a bundled sample day so the page is never empty. |
| User denies location | City search is always visible and the page works without location |
| Mobile audio quirks | Start audio on tap, show the iOS ringer note, cap polyphony to keep CPU low |
| Location privacy | Round coordinates to 0.1°, keep everything in the browser, use no third-party analytics |
| An extra service (air, Kp, holidays) is slow or down | Each has a 4-second limit and is optional; the song is built without it |

## 13. Open questions (defaults chosen; change if you disagree)

1. **Units shown:** °F and mph for US visitors, °C and km/h elsewhere, based on the browser locale, with a toggle that is remembered. *(Built in M2. Units change only the liner notes, never the music.)*
2. **Default before location:** a rotating "song of the day" from 14 world cities, one per day, so Play works right away. *(Built in M2.)*
3. **Length:** 12 bars (about 20 s), played once. Could offer a "long" version with a bar or more per hour.
4. **Time of day:** always play the whole day from midnight. A later option could start at the current hour.
