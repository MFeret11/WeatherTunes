import { test, assert, equal } from "./harness.js";
import { forecastUrl, todayOnly, fetchForecast, fetchExtras, searchPlaces, featuredPlace, randomPlace, RANDOM_CITIES, roundCoord, FEATURED, normalizeForecast, dewPoint, feelsLike } from "../src/weather.js";

const sample = await (await fetch("../samples/kyoto-spring.json")).json();

/** A fake fetch that records calls and answers from a function. */
function fakeFetch(answer) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const { status = 200, body } = answer(url);
    return { ok: status < 400, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), size: () => m.size };
}

test("coordinates are rounded to 0.1° before they leave the browser", () => {
  const u = new URL(forecastUrl(39.95234, -75.16379));
  equal(u.searchParams.get("latitude"), "40.0");
  equal(u.searchParams.get("longitude"), "-75.2");
  equal(u.searchParams.get("timezone"), "auto");
  equal(u.searchParams.get("forecast_days"), "1");
  for (const v of ["temperature_2m", "precipitation_probability", "weather_code", "is_day"]) {
    assert(u.searchParams.get("hourly").includes(v), v);
  }
  equal(roundCoord(-0.04), -0);
});

test("fetchForecast normalizes, rounds and caches for an hour", async () => {
  const f1 = fakeFetch(() => ({ body: sample }));
  const storage = memoryStorage();
  const place = { name: "Kyoto, Japan", lat: 35.0116, lon: 135.7681 };
  const forecastCalls = () => f1.calls.filter((u) => u.includes("hourly=temperature_2m")).length;
  const a = await fetchForecast(place, { fetchFn: f1, storage, now: 1000 });
  equal(a.hours.length, 24);
  equal(a.name, "Kyoto, Japan");
  equal([a.lat, a.lon], [35, 135.8]);
  const b = await fetchForecast({ ...place, lat: 35.04 }, { fetchFn: f1, storage, now: 1000 + 59 * 60000 });
  equal(forecastCalls(), 1, "second call within the hour uses the cache");
  equal(b.hours, a.hours);
  await fetchForecast(place, { fetchFn: f1, storage, now: 1000 + 61 * 60000 });
  equal(forecastCalls(), 2, "stale cache refetches");
});

test("fetchForecast works with storage blocked", async () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const f = await fetchForecast({ name: "X", lat: 1, lon: 2 }, { fetchFn: fakeFetch(() => ({ body: sample })), storage: blocked });
  equal(f.hours.length, 24);
  const g = await fetchForecast({ name: "X", lat: 1, lon: 2 }, { fetchFn: fakeFetch(() => ({ body: sample })), storage: null });
  equal(g.hours.length, 24);
});

test("fetchForecast reports service errors and empty answers", async () => {
  let err = null;
  try { await fetchForecast({ name: "X", lat: 1, lon: 2 }, { fetchFn: fakeFetch(() => ({ status: 429, body: {} })), storage: null }); }
  catch (e) { err = e; }
  assert(err && /429/.test(err.message), "HTTP error surfaces");
  err = null;
  try { await fetchForecast({ name: "X", lat: 1, lon: 2 }, { fetchFn: fakeFetch(() => ({ body: { error: true } })), storage: null }); }
  catch (e) { err = e; }
  assert(err, "missing hourly data is an error");
});

test("searchPlaces builds readable labels and rounded coordinates", async () => {
  const body = { results: [
    { name: "Paris", admin1: "Île-de-France", country: "France", country_code: "FR", latitude: 48.85341, longitude: 2.3488 },
    { name: "Paris", admin1: "Texas", country: "United States", latitude: 33.66094, longitude: -95.55551 },
    { name: "Singapore", admin1: "Singapore", country: "Singapore", latitude: 1.28967, longitude: 103.85007 },
  ] };
  const f = fakeFetch(() => ({ body }));
  const r = await searchPlaces("  paris ", { fetchFn: f });
  equal(r.map((p) => p.label), ["Paris, Île-de-France, France", "Paris, Texas, United States", "Singapore"]);
  equal(r[0], { name: "Paris, France", label: "Paris, Île-de-France, France", lat: 48.9, lon: 2.3, cc: "FR" });
  equal(new URL(f.calls[0]).searchParams.get("name"), "paris");
  equal(await searchPlaces("p", { fetchFn: f }), [], "one letter doesn't search");
  equal(f.calls.length, 1);
  equal(await searchPlaces("zzzz", { fetchFn: fakeFetch(() => ({ body: {} })) }), [], "no results");
});

test("featured city changes daily and cycles through the list", () => {
  const a = featuredPlace(new Date(2026, 9, 23));
  const b = featuredPlace(new Date(2026, 9, 24));
  assert(a !== b, "next day, next city");
  equal(featuredPlace(new Date(2026, 9, 23, 23, 59)), a, "same all day");
  const seen = new Set();
  for (let d = 0; d < FEATURED.length; d++) seen.add(featuredPlace(new Date(2026, 0, 1 + d)).name);
  equal(seen.size, FEATURED.length);
});

test("random city: well-formed list, never repeats the current city", () => {
  const names = new Set(RANDOM_CITIES.map((p) => p.name));
  equal(names.size, RANDOM_CITIES.length, "no duplicates");
  for (const p of RANDOM_CITIES) {
    assert(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && /^[A-Z]{2}$/.test(p.cc), p.name);
    equal(p.lat, roundCoord(p.lat), `${p.name} lat rounded`);
  }
  const first = RANDOM_CITIES[0].name;
  equal(randomPlace(null, () => 0).name, first);
  assert(randomPlace(first, () => 0).name !== first, "skips the current city");
  assert(randomPlace(first, () => 0.9999), "top of range is in bounds");
});

test("extras: air quality, Kp, holidays and recent lows come back in one shape", async () => {
  const f = fakeFetch((url) => {
    if (url.includes("air-quality")) return { body: { hourly: { us_aqi: Array(24).fill(80) } } };
    if (url.includes("swpc")) return { body: [{ time_tag: "2025-04-26T00:00:00", kp: 5.33 }] };
    if (url.includes("nager")) return { body: [{ date: "2025-04-29", name: "Shōwa Day", localName: "昭和の日", global: true, counties: null }] };
    return { status: 404, body: {} };
  });
  const x = await fetchExtras(35, 135.8, "JP", { fetchFn: f, now: Date.UTC(2025, 3, 26) });
  equal(x.aqi.length, 24);
  equal(x.kp, [{ time: "2025-04-26T00:00:00", kp: 5.33 }]);
  equal(x.holidays[0].name, "Shōwa Day");
  equal(f.calls.length, 3, "air, Kp and holidays only: the lows come with the forecast");
  for (const u of f.calls) {
    const q = new URL(u).searchParams;
    if (q.has("latitude")) assert(q.get("latitude") === "35.0" && q.get("longitude") === "135.8", `rounded: ${u}`);
  }
});

test("one forecast request brings today's hours and the recent lows", async () => {
  const u = new URL(forecastUrl(35, 135.8));
  equal(u.searchParams.get("past_days"), "60");
  assert(u.searchParams.get("daily").includes("temperature_2m_min"));
  // Three days of hours around now, 61 days of lows ending today.
  const times = Array.from({ length: 72 }, (_, i) => `2025-04-${25 + Math.floor((i + 10) / 24)}T${String((i + 10) % 24).padStart(2, "0")}:00`);
  const days = Array.from({ length: 61 }, (_, i) => new Date(Date.UTC(2025, 1, 25 + i)).toISOString().slice(0, 10));
  const combined = {
    ...sample,
    hourly: { ...sample.hourly, time: times, temperature_2m: times.map((_, i) => i) },
    daily: { time: days, sunrise: days.map((d) => `${d}T05:00`), sunset: days.map((d) => `${d}T18:30`), temperature_2m_min: days.map((_, i) => i % 2 ? 4 : 1) },
  };
  equal(days.at(-1), "2025-04-26");
  const t = todayOnly(combined);
  equal(t.hourly.time.length, 24);
  equal(t.hourly.time[0], "2025-04-26T00:00");
  equal(t.hourly.temperature_2m[0], 14, "the hour values follow their times");
  equal(t.daily.sunrise, ["2025-04-26T05:00"]);
  equal(t.minTemps.length, 60, "today's own low is left out");
  const f = fakeFetch((url) => (url.includes("api.open-meteo.com/v1/forecast") ? { body: combined } : { status: 503, body: {} }));
  const day = await fetchForecast({ name: "Kyoto", lat: 35, lon: 135.8, cc: "JP" }, { fetchFn: f, storage: null });
  equal(day.date, "2025-04-26");
  equal(day.hours.length, 24);
  equal(day.extras.minTemps.length, 60);
  equal(f.calls.filter((c) => c.includes("/v1/forecast")).length, 1, "no separate request for the lows");
});

test("extras: a failing service is simply left out", async () => {
  const f = fakeFetch((url) => (url.includes("hourly=temperature_2m") ? { body: sample } : { status: 503, body: {} }));
  const day = await fetchForecast({ name: "Kyoto", lat: 35, lon: 135.8, cc: "JP" }, { fetchFn: f, storage: null });
  equal(day.hours.length, 24);
  equal(day.extras, { aqi: null, kp: null, holidays: null, minTemps: null });
});

test("dew point and feels-like", () => {
  assert(Math.abs(dewPoint(30, 70) - 23.9) < 0.3, `dew ${dewPoint(30, 70)}`);
  assert(Math.abs(dewPoint(10, 100) - 10) < 0.05, "saturated air: dew point = temperature");
  assert(feelsLike(32, 80, 5) > 38, "humid heat feels hotter");
  assert(feelsLike(-5, 70, 40) < -12, "wind feels colder");
  const f = normalizeForecast(sample);
  assert(f.hours.every((h) => Number.isFinite(h.dew) && Number.isFinite(h.feels) && Number.isFinite(h.uv)), "every hour has them");
  equal(f.country, "JP");
});

test("the cache isn't used across the place's midnight", async () => {
  const storage = memoryStorage();
  const f1 = fakeFetch((url) => (url.includes("/v1/forecast") ? { body: { ...sample, utc_offset_seconds: 9 * 3600 } } : { status: 404, body: {} }));
  const calls = () => f1.calls.filter((u) => u.includes("/v1/forecast")).length;
  const place = { name: "Kyoto, Japan", lat: 35.0, lon: 135.8 };
  const lateEvening = Date.UTC(2025, 3, 26, 14, 40); // 11:40 pm in Kyoto
  await fetchForecast(place, { fetchFn: f1, storage, now: lateEvening });
  await fetchForecast(place, { fetchFn: f1, storage, now: lateEvening + 10 * 60000 });
  equal(calls(), 1, "ten minutes later, the same evening: cached");
  await fetchForecast(place, { fetchFn: f1, storage, now: lateEvening + 30 * 60000 });
  equal(calls(), 2, "past midnight there: fetched again");
});

test("holidays around New Year are asked for both years", async () => {
  for (const y of [2025, 2026]) try { localStorage.removeItem(`wt:holidays:AU:${y}`); } catch { /* blocked */ }
  const f = fakeFetch((url) => (url.includes("nager") ? { body: [{ date: `${url.match(/Holidays\/(\d+)/)[1]}-01-01`, name: "New Year's Day", global: true }] } : { status: 404, body: {} }));
  // 7 am on 1 January 2026 in Sydney, still 31 December in UTC.
  const x = await fetchExtras(-33.9, 151.2, "AU", { fetchFn: f, now: Date.UTC(2025, 11, 31, 20) });
  equal(x.holidays.map((h) => h.date), ["2025-01-01", "2026-01-01"]);
});
