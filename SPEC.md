# WeatherTunes — Spec

Status: M0–M2 built and live at mferet.com/WeatherTunes/, 2026-10-23 (the composer, the audio engine, live weather for your location or any city, and nine sample days). After M2 the climate also picks the melody and pad instruments (§6.2), so places sound different, not just play different notes. Replaces the 2022 Python/pyo prototype.

## 1. The pitch

Open the page, allow location (or type a city), press Play. Today's forecast where you are becomes a one-minute piece of music. Each hour of the day is one bar. The temperature curve shapes the melody, the sky picks the scale, the wind sets the tempo, and rain adds percussion. Then you can play with it: change the waveform, EQ, filter and effects, mute layers, or play along on your keyboard in the day's key.

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
    weather.js          fetch + normalize Open-Meteo → Forecast object; geocoding; cache
    compose.js          PURE: (Forecast, seed) → Score   ← the heart; no Tone, no DOM
    mapping.js          all tunable constants (ranges, mode table, progressions)
    engine.js           Tone.js graph: instruments, effects, schedules a Score
    controls.js         synth panel ↔ engine params; "back to the forecast" reset
    theory.js           modes, triads, note names, seeded RNG
    viz.js              forecast chart with a moving playhead; notes light up
    keyboard.js         play-along: computer keys / touch → notes in today's scale
    share.js            URL params ⇄ state
    main.js             wiring
  vendor/tone-15.1.22.js
  samples/*.json        real forecasts for nine contrasting days (tests + offline fallback)
  tools/fetch_fixtures.py   picks and saves those days from Open-Meteo's archive
  test/
    index.html + compose.test.js   composer tests; run in a browser (the Pi has no Node)
    summary.html        every sample's key, mode, tempo and liner notes
    render.html         offline render → peak, loudness, clipping (per layer with &solo=)
```

**Data flow:** location → `weather.js` → `Forecast` → `compose.js` → `Score` → `engine.js` (audio) + `viz.js` (picture) + liner notes (text).

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
- 24 hourly values give **24 bars of 4/4**, from midnight to 11 pm local time. That's about 60 s at 96 BPM.
- Three 8-bar sections: Night (0–7), Day (8–15), Evening (16–23). These line up with the 4-chord loop at 2 bars per chord, which a 6-bar section would not.
- The piece loops by default with a 1-bar gap. A toggle switches to play-once.

### 6.2 Global choices (computed once per day)

| Musical choice | Weather input | Rule |
|---|---|---|
| **Mode (scale)** | "Brightness" = 1 − cloud − rain chance − rainfall − storm | Modes ranked bright to dark: **Lydian → Ionian (major) → Mixolydian → Dorian → Aeolian (minor) → Phrygian**. Lydian also needs a warm day (mean ≥ 15 °C), so a clear polar day is plain major. Sunny is Lydian or Ionian, overcast is Dorian, rainy is Aeolian, storms are Phrygian. A **storm day** is any thunder code, any hour with ≥ 8 mm of rain, or ≥ 75 km/h gusts with rain. Thunder codes alone aren't enough because the forecast model rarely issues them. Snow days keep the mode's chords but play a **pentatonic** melody (soft, bell-like). |
| **Key (root)** | Mean sea-level pressure (hPa) | `root = round(meanPressure) mod 12`. Pressure ranges from about 980 to 1040 hPa, so every key turns up. |
| **Tempo** | Mean wind speed | `bpm = clamp(72 + 1.5 × wind_kmh, 72, 132)` |
| **Register** | Daily mean temperature | Cold days sit lower and hot days higher, shifting by up to ±3 scale steps |
| **Chord progression** | Pressure trend over the day (rising, steady, falling) | Each mode has two proven 4-chord loops per trend, and the day's seed picks one. Rising (clearing) loops climb or resolve, like I–V–vi–IV or i–ii–♭III–IV. Falling (worsening) loops descend, like IV–♭III–ii–i or i–♭VII–♭VI–v. Diminished chords are left out. The chord changes every 2 bars, the loop runs 3 times, and the last 2 bars always return to the tonic chord. |
| **Reverb amount** | Mean humidity | 10 % at 30 % RH up to 60 % at 100 % RH, so muggy days sound wetter |
| **Melody instrument** | Mean temperature | Below −8 °C glass bells (FM), below 6 °C a breathy flute with vibrato, below 20 °C soft keys (triangle), below 30 °C a marimba (FM), hotter a reedy pipe (pulse wave with vibrato). Named in the liner notes. |
| **Pad instrument** | Storm, snow, rain, cloud, temperature, humidity (first match wins) | Storm: dark detuned saws. Snow: hushed choir. Wet (≥ 50 % rain chance or ≥ 5 mm): wobbling electric piano (tremolo). Cloudy (≥ 50 %): muffled organ. Clear and below 0 °C: thin icy shimmer. Clear and humid (≥ 60 % RH): lush strings. Otherwise an airy, open pad. |

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
| **Sunrise / sunset** | Daily sunrise and sunset times | A short cymbal-like swell at those bars, named in the liner notes. |

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

1. **Header:** "WeatherTunes", a location chip ("Kyoto · Use my location · Search"), and the date.
2. **Hero:** the big Play button and a forecast chart. The temperature line is the melody line, with rain bars below, cloud shading behind and a sun or moon strip on top. A playhead moves across the hours, and notes light up as they play.
3. **Liner notes:** 3–6 plain-English lines explaining today's choices.
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

**Automated:** `test/index.html` runs in any browser or headless Chromium (the Pi has no Node, and the project has no npm). It covers nine real forecasts picked from Open-Meteo's historical-forecast archive by `tools/fetch_fixtures.py`:
- clear, hot desert day (Phoenix, July, 47 °C)
- clear spring day (Kyoto)
- overcast drizzle (London)
- monsoon (Mumbai)
- flooding downpour (Houston, 196 mm)
- snowstorm (Oslo)
- polar night (McMurdo Station, −38 °C)
- almost flat temperatures (Honolulu)
- gale (Reykjavik, 99 km/h gusts)

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
- Audio can only start after a click, so the Play button calls `Tone.start()`.

**By ear:** listen to every fixture before release. If any fixture sounds bad, fix the constants in `mapping.js`.

## 11. Milestones

| # | Deliverable | Done when |
|---|---|---|
| **M0** ✅ | Repo cleanup and skeleton: remove the prototype, add `index.html`, bundle Tone.js, enable Pages | `mferet.com/WeatherTunes/` loads and a test tone plays |
| **M1** ✅ built, needs ears | `compose.js` + `mapping.js` + tests, playing a **fixture** forecast | All tests pass, and every fixture sounds good by ear |
| **M2** ✅ | Live weather: geolocation, city search, caching, attribution, error states | Your location or any searched city plays today's song |
| **M3** | Synth panel, "Back to the forecast", play-along keyboard | Every control in §7 works on desktop and phone |
| **M4** | Forecast chart with playhead, liner notes, share links, mobile layout, accessibility pass | A shared link reproduces the song on another device |
| **M5** | Portfolio story, homepage card and About mention | Live on mferet.com |
| Stretch | Download as WAV/WebM (`Tone.Recorder`), MIDI export (`@tonejs/midi`), "what if" sliders to change the weather, side-by-side cities | — |

M1 is the riskiest part (does it sound good?), so it comes before any UI work.

## 12. Risks

| Risk | Mitigation |
|---|---|
| It sounds random or bad | Theory rules (§6.4), fixtures checked by ear, and all constants in one file |
| Open-Meteo is down or rate-limited | Per-session cache. On error, offer to play a bundled sample day so the page is never empty. |
| User denies location | City search is always visible and the page works without location |
| Mobile audio quirks | Start audio on tap, show the iOS ringer note, cap polyphony to keep CPU low |
| Location privacy | Round coordinates to 0.1°, keep everything in the browser, use no third-party analytics |

## 13. Open questions (defaults chosen; change if you disagree)

1. **Units shown:** °F and mph for US visitors, °C and km/h elsewhere, based on the browser locale, with a toggle that is remembered. *(Built in M2. Units change only the liner notes, never the music.)*
2. **Default before location:** a rotating "song of the day" from 14 world cities, one per day, so Play works right away. *(Built in M2.)*
3. **Length:** 24 bars (about 1 min), looping. Could offer a "long" version with 2 bars per hour.
4. **Time of day:** always play the whole day from midnight. A later option could start at the current hour.
