# WeatherTunes

Turns a day's weather forecast into a short piece of music you can play in the browser.

Each hour of the day gets two beats (half a bar), so a song lasts about 20 seconds. The temperature curve shapes the melody, cloud and rain pick the scale (bright Lydian on sunny days down to dark Phrygian in storms), air pressure picks the key, wind sets the tempo, and rain, snow, fog and storms add their own sounds. Music-theory rules keep it in tune: every note is in the scale, strong beats land on chord tones, and phrases resolve. The same place and day always gives the same song.

Every song comes with liner notes explaining why it sounds the way it does.

**Live at [mferet.com/WeatherTunes](https://mferet.com/WeatherTunes/).** Use your location or search for any city to hear today's forecast there, or try one of nine sample days. Next up: a full synth panel and a play-along keyboard. See [SPEC.md](SPEC.md) for the plan.

## Run it

It's a static site with no build step:

```bash
python3 -m http.server 8090
# open http://localhost:8090/
```

## Tests

The tests run in the browser, so there's nothing to install:

- `test/index.html`: tests for the composer (in-scale notes, chord tones on strong beats, cadences, ranges, determinism, missing-data handling) and the weather code (rounding, caching, errors, search)
- `test/summary.html`: what every sample day turns into, for tuning by ear
- `test/render.html?fixture=london-drizzle`: renders a song offline and reports peak level, loudness and clipping (add `&solo=melody` to check one layer)
- `test/smoke.html`: drives the real page against the live weather service: featured city, search, units, samples, shared links, error fallback

Headless: `chromium --headless=new --virtual-time-budget=20000 --dump-dom http://localhost:8090/test/`

## How it's built

- `src/compose.js`: forecast → score. Pure JavaScript with no audio or DOM code, so it's easy to test.
- `src/mapping.js`: every tunable number in the weather → music mapping.
- `src/engine.js`: plays a score with [Tone.js](https://tonejs.github.io/) (bundled in `vendor/`, MIT).
- `src/weather.js`: fetches today's [Open-Meteo](https://open-meteo.com/) forecast and city search, caches it for an hour, and cleans it up (fills gaps, 24 hours).
- `src/main.js`: the page. Picks a place, plays the song, shows the liner notes.
- `samples/`: real forecasts for nine contrasting days, fetched with `tools/fetch_fixtures.py`.

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).

## History

Started in 2022 as a Python script that read the National Weather Service API and played tones with pyo. It was rebuilt for the browser in 2026 so anyone, anywhere, can hear their own day.
