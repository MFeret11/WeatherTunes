# WeatherTunes

Turns a day's weather forecast into a short piece of music you can play in the browser.

Each hour of the day gets two beats (half a bar), so a song lasts about 20 seconds. The temperature curve shapes the melody, cloud and rain pick the scale (bright Lydian on sunny days down to dark Phrygian in storms), air pressure picks the key, wind sets the tempo, and rain, snow, fog and storms add their own sounds. The sky and the air play too: moonlight lifts the night, a moonrise rings a bell, auroras add a shimmering chord, meteor showers send shooting-star runs, hazy air crackles, strong sun shimmers, snow on the ground hushes the room, and frost, solstices and public holidays get their own bells. Music-theory rules keep it in tune: every note is in the scale, strong beats land on chord tones, and phrases resolve. The same place and day always gives the same song.

Every song comes with liner notes explaining why it sounds the way it does.

**Live at [mferet.com/WeatherTunes](https://mferet.com/WeatherTunes/).** Use your location or search for any city to hear today's forecast there, or try one of ten sample days. Next up: a full synth panel and a play-along keyboard. See [SPEC.md](SPEC.md) for the plan.

## Run it

It's a static site with no build step:

```bash
python3 -m http.server 8090
# open http://localhost:8090/
```

## Tests

The tests run in the browser, so there's nothing to install:

- `test/index.html`: tests for the composer (in-scale notes, chord tones on strong beats, cadences, ranges, determinism, missing-data handling), the weather code (rounding, caching, errors, search, extras) and the sky maths (checked against published moon phases, eclipses and solstices)
- `test/summary.html`: what every sample day turns into, for tuning by ear
- `test/render.html?fixture=london-drizzle`: renders a song offline and reports peak level, loudness and clipping (add `&solo=melody` to check one layer)
- `test/smoke.html`: drives the real page against the live weather service: featured city, search, units, samples, shared links, error fallback, and a song playing once and stopping. Run it in real time (not with `--virtual-time-budget`), since it waits on the audio clock; it posts its result to `/__result` like `render.html`.

Headless: `tools/headless.sh --virtual-time-budget=20000 --dump-dom http://localhost:8090/test/` (wraps `chromium --headless=new` and deletes its temp files afterwards, even if the run is killed)

## How it's built

- `src/compose.js`: forecast → score. Pure JavaScript with no audio or DOM code, so it's easy to test.
- `src/mapping.js`: every tunable number in the weather → music mapping.
- `src/engine.js`: plays a score with [Tone.js](https://tonejs.github.io/) (bundled in `vendor/`, MIT).
- `src/weather.js`: fetches today's [Open-Meteo](https://open-meteo.com/) forecast and city search, plus air quality, aurora activity ([NOAA SWPC](https://www.swpc.noaa.gov/)), public holidays ([Nager.Date](https://date.nager.at/)) and recent lows. Caches it for an hour and cleans it up (fills gaps, 24 hours, dew point and feels-like).
- `src/sky.js`: the moon's phase, rise and set, lunar eclipses, solstices and equinoxes, meteor showers and magnetic latitude, all worked out in the browser.
- `src/describe.js`: the forecast in plain words, like a forecaster would say it.
- `src/main.js`: the page. Picks a place, plays the song, draws the hour-by-hour chart (with tonight's moon and any aurora), lights up each weather factor as its part plays, and shows the liner notes.
- `src/cover.js`: draws the day's album cover from the forecast (sky colour by hour, sun at the hottest hour, rain, snow and lightning).
- `samples/`: real forecasts for ten contrasting days, fetched with `tools/fetch_fixtures.py`.

Weather and air-quality data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Aurora activity from NOAA's Space Weather Prediction Center (public domain); the sample days use GFZ Potsdam's Kp index (CC BY 4.0). Public holidays from [Nager.Date](https://date.nager.at/).

## History

Started in 2022 as a Python script that read the National Weather Service API and played tones with pyo. It was rebuilt for the browser in 2026 so anyone, anywhere, can hear their own day.
