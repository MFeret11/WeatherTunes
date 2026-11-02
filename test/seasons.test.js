import { test, assert, equal } from "./harness.js";
import { seasonsFor, typicalDays, rainFromRecord, climateUrl, dayUrl, fetchSuite, CLIMATE_YEARS } from "../src/seasons.js";

const sample = await (await fetch("../samples/philadelphia-autumn.json")).json();

test("seasons play winter first, flip in the south and go by months near the equator", () => {
  equal(seasonsFor(40).map((s) => s.name), ["Winter", "Spring", "Summer", "Autumn"]);
  equal(seasonsFor(40)[0].months, [12, 1, 2]);
  equal(seasonsFor(-34).map((s) => s.name), ["Winter", "Spring", "Summer", "Autumn"]);
  equal(seasonsFor(-34)[0].months, [6, 7, 8]);
  equal(seasonsFor(1.3).map((s) => s.name), ["Dec–Feb", "Mar–May", "Jun–Aug", "Sep–Nov"]);
});

/** A daily archive: every day of the given years, its values from a function of (month, day index). */
function archive(years, f) {
  const d = { time: [], temperature_2m_mean: [], temperature_2m_max: [], temperature_2m_min: [], cloud_cover_mean: [], precipitation_sum: [], wind_speed_10m_mean: [] };
  let i = 0;
  for (const y of years) {
    for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86400000, i++) {
      const date = new Date(t).toISOString().slice(0, 10);
      const v = f(Number(date.slice(5, 7)), i, date);
      d.time.push(date);
      d.temperature_2m_mean.push(v.temp);
      d.temperature_2m_max.push(v.temp + 5);
      d.temperature_2m_min.push(v.temp - 5);
      d.cloud_cover_mean.push(v.cloud);
      d.precipitation_sum.push(v.rain);
      d.wind_speed_10m_mean.push(10);
    }
  }
  return d;
}

test("the typical day is the recent day nearest the season's middle", () => {
  // Summer swings around 25 °C and 40% cloud; one recent summer day sits right on the middle.
  const d = archive([2018, 2019, 2020, 2021, 2022, 2023], (m, i, date) => {
    const summer = [6, 7, 8].includes(m), winter = [12, 1, 2].includes(m);
    const base = summer ? 25 : winter ? 0 : 12;
    if (date === "2022-07-20") return { temp: base, cloud: 40, rain: 0 };
    return { temp: base + 4 * Math.sin(i * 1.3), cloud: 40 + 20 * Math.sin(i * 0.7), rain: i % 4 === 0 ? 5 : 0 };
  });
  const picks = typicalDays(d, 40, { since: "2022-01-01" });
  equal(picks.length, 4);
  equal(picks.map((p) => p.season.name), ["Winter", "Spring", "Summer", "Autumn"]);
  const at = d.time.indexOf(picks[2].date);
  assert(Math.abs(d.temperature_2m_mean[at] - 25) < 0.5 && Math.abs(d.cloud_cover_mean[at] - 40) < 5 && d.precipitation_sum[at] === 0,
    `summer pick ${picks[2].date} is near the middle`);
  assert(picks.every((p) => p.date >= "2022-01-01"), "picked from the recent years only");
  equal(picks[2].climate.years, 6);
  assert(Math.abs(picks[2].climate.wetShare - 0.25) < 0.02, `wet share ${picks[2].climate.wetShare}`);
});

test("a season without recent days is left out", () => {
  const d = archive([2018, 2019], () => ({ temp: 10, cloud: 50, rain: 0 }));
  equal(typicalDays(d, 40, { since: "2022-01-01" }).length, 0);
});

test("past days without a chance of rain use the rain that fell", () => {
  const raw = { hourly: { precipitation: [0, 0.05, 0.1, 2], precipitation_probability: [null, null, null, null] } };
  equal(rainFromRecord(raw), true);
  equal(raw.hourly.precipitation_probability, [0, 0, 100, 100]);
  const kept = { hourly: { precipitation: [1], precipitation_probability: [30] } };
  equal(rainFromRecord(kept), false);
  equal(kept.hourly.precipitation_probability, [30]);
});

test("archive requests round coordinates and cover thirty years", () => {
  const u = new URL(climateUrl(39.9526, -75.1652, Date.UTC(2026, 10, 1)));
  equal(u.searchParams.get("latitude"), "40.0");
  equal(u.searchParams.get("longitude"), "-75.2");
  equal(u.searchParams.get("end_date"), "2026-10-25");
  equal(u.searchParams.get("start_date"), `${2026 - CLIMATE_YEARS}-10-25`);
  const v = new URL(dayUrl(39.95, -75.17, "2024-07-14"));
  equal([v.searchParams.get("start_date"), v.searchParams.get("end_date")], ["2024-07-14", "2024-07-14"]);
  assert(v.searchParams.get("hourly").includes("precipitation_probability"));
});

test("fetchSuite builds four movements and keeps them for a month", async () => {
  const daily = archive([2019, 2020, 2021, 2022, 2023, 2024], (m, i) => ({ temp: m * 2, cloud: 50, rain: i % 3 ? 0 : 2 }));
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const body = url.includes("archive-api") ? { daily }
      : url.includes("air-quality") ? { hourly: { us_aqi: Array(24).fill(40) } }
        : url.includes("nager") ? []
          : { ...sample, hourly: { ...sample.hourly, precipitation_probability: Array(24).fill(null) } };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  const m = new Map();
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const place = { name: "Philadelphia, USA", lat: 39.95, lon: -75.17, cc: "US" };
  const a = await fetchSuite(place, { fetchFn, storage, now: Date.UTC(2025, 0, 15) });
  equal(a.length, 4);
  equal(a.map((x) => x.season.name), ["Winter", "Spring", "Summer", "Autumn"]);
  assert(a.every((x) => x.forecast.hours.length === 24 && x.forecast.observed), "ready to compose, rain from the record");
  equal(a[0].forecast.lat, 40);
  const before = calls.filter((u) => !u.includes("nager")).length;
  const b = await fetchSuite(place, { fetchFn, storage, now: Date.UTC(2025, 0, 20) });
  equal(calls.filter((u) => !u.includes("nager")).length, before, "second time from the browser's copy");
  equal(b.map((x) => x.date), a.map((x) => x.date));
});
