#!/usr/bin/env python3
"""Fetch sample days from Open-Meteo's historical forecast archive into samples/.

Each fixture is a real forecast for one day, picked from a month of data by a
rule (hottest clear day, a thunderstorm day, a snow day...). The saved JSON has
the same shape as a live /v1/forecast response, plus a "name" field.

Each fixture also carries "extras" in the same shape the page builds for a
live day (see normalizeExtras in src/weather.js): hourly US AQI, 3-hourly Kp
(GFZ Potsdam's definitive index), that day's public holidays (Nager.Date) and
the previous 60 days' lows (for "first frost").

Usage: python3 tools/fetch_fixtures.py [sample-name ...]   (no names: fetch all)
       python3 tools/fetch_fixtures.py --extras [sample-name ...]
           keep each saved day and only refresh its UV, snow depth and extras
"""
import datetime
import json
import sys
import pathlib
import urllib.parse
import urllib.request

HOURLY = ("temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,"
          "wind_direction_10m,precipitation_probability,precipitation,cloud_cover,weather_code,is_day,cape,"
          "uv_index,snow_depth")
LATE_HOURLY = ("uv_index", "snow_depth")  # added after the first fixtures; --extras fills them in
ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"
AIR_API = "https://air-quality-api.open-meteo.com/v1/air-quality"
KP_API = "https://kp.gfz.de/app/json/"
HOLIDAY_API = "https://date.nager.at/api/v3/PublicHolidays"
FROST_DAYS = 60
DAILY = "sunrise,sunset,temperature_2m_max,temperature_2m_min"
API = "https://historical-forecast-api.open-meteo.com/v1/forecast"
OUT = pathlib.Path(__file__).resolve().parent.parent / "samples"


def day_slices(d):
    """Yield (day_index, hourly dict for that day) from a multi-day response."""
    h = d["hourly"]
    for i in range(len(d["daily"]["time"])):
        yield i, {k: v[i * 24:(i + 1) * 24] for k, v in h.items()}


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0


# Rules score a day; the highest score wins.
RULES = {
    "clear": lambda h: -mean(h["cloud_cover"]) - mean(h["precipitation_probability"]),
    "hot_clear": lambda h: max(h["temperature_2m"]) - mean(h["cloud_cover"]) / 5,
    "rain": lambda h: sum(x or 0 for x in h["precipitation"]) + mean(h["cloud_cover"]) / 20,
    "storm": lambda h: sum(1 for c in h["weather_code"] if c and c >= 95) * 10 + sum(x or 0 for x in h["precipitation"]),
    "snow": lambda h: sum(1 for c in h["weather_code"] if c in (71, 73, 75, 77, 85, 86)),
    "cold": lambda h: -mean(h["temperature_2m"]),
    "flat": lambda h: -(max(h["temperature_2m"]) - min(h["temperature_2m"])) - mean(h["precipitation_probability"]) / 50,
    "windy": lambda h: mean(h["wind_gusts_10m"]),
    "drizzle": lambda h: sum(1 for c in h["weather_code"] if c in (51, 53, 55, 61)) + mean(h["cloud_cover"]) / 25,
}

# file name, display name, country code, lat, lon, month start, month end, rule
SAMPLES = [
    ("phoenix-heat", "Phoenix, USA", "US", 33.4, -112.1, "2025-07-01", "2025-07-31", "hot_clear"),
    ("kyoto-spring", "Kyoto, Japan", "JP", 35.0, 135.8, "2025-04-01", "2025-04-30", "clear"),
    ("london-drizzle", "London, UK", "GB", 51.5, -0.1, "2025-11-01", "2025-11-30", "drizzle"),
    ("mumbai-monsoon", "Mumbai, India", "IN", 19.1, 72.9, "2025-07-01", "2025-07-31", "rain"),
    ("houston-storms", "Houston, USA", "US", 29.8, -95.4, "2025-04-01", "2025-06-30", "storm"),
    ("oslo-snow", "Oslo, Norway", "NO", 59.9, 10.8, "2025-01-01", "2025-02-28", "snow"),
    ("mcmurdo-cold", "McMurdo Station, Antarctica", "AQ", -77.8, 166.7, "2025-07-01", "2025-07-31", "cold"),
    ("honolulu-flat", "Honolulu, USA", "US", 21.3, -157.9, "2025-09-01", "2025-09-30", "flat"),
    ("reykjavik-wind", "Reykjavik, Iceland", "IS", 64.1, -21.9, "2025-12-01", "2025-12-31", "windy"),
    ("philadelphia-autumn", "Philadelphia, USA", "US", 40.0, -75.2, "2025-10-01", "2025-10-31", "clear"),
]


def get(url, params=None):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "WeatherTunes fixture tool"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def fetch(lat, lon, start, end, hourly=HOURLY, daily=DAILY):
    return get(API, {"latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
                     "hourly": hourly, "daily": daily, "timezone": "auto"})


def quietly(fn, what=""):
    try:
        return fn()
    except Exception as e:  # a missing extra just leaves that part out of the song
        print(f"    (skipped {what}: {e})")
        return None


def extras(fixture, cc):
    """Air quality, Kp, holidays and earlier lows for the fixture's day."""
    lat, lon, tz = fixture["latitude"], fixture["longitude"], fixture["timezone"]
    day = datetime.date.fromisoformat(fixture["daily"]["time"][0])
    aqi = quietly(lambda: get(AIR_API, {"latitude": lat, "longitude": lon, "start_date": str(day),
                                        "end_date": str(day), "hourly": "us_aqi", "timezone": tz})["hourly"]["us_aqi"])
    # Kp is in UTC; take a day either side so every local hour is covered.
    kp = quietly(lambda: get(KP_API, {"start": f"{day - datetime.timedelta(days=1)}T00:00:00Z",
                                      "end": f"{day + datetime.timedelta(days=1)}T21:00:00Z", "index": "Kp"}))
    kp = [{"time": t, "kp": k} for t, k in zip(kp["datetime"], kp["Kp"])] if kp else None
    hol = quietly(lambda: get(f"{HOLIDAY_API}/{day.year}/{cc}"))
    hol = [{k: h[k] for k in ("date", "name", "localName", "global")} for h in hol if h["date"] == str(day)] if hol else None
    first = day - datetime.timedelta(days=FROST_DAYS)
    mins = quietly(lambda: fetch(lat, lon, str(first), str(day - datetime.timedelta(days=1)),
                                 hourly="", daily="temperature_2m_min")["daily"]["temperature_2m_min"])
    return {"aqi": aqi, "kp": kp, "holidays": hol, "minTemps": mins}


def add_extras(fname, cc, lat, lon):
    """Refresh UV, snow depth and extras on a saved fixture, keeping its day."""
    path = OUT / f"{fname}.json"
    fixture = json.loads(path.read_text())
    day = fixture["daily"]["time"][0]
    late = fetch(lat, lon, day, day, hourly=",".join(LATE_HOURLY), daily="sunrise")
    for k in LATE_HOURLY:
        fixture["hourly"][k] = late["hourly"][k][:24]
        fixture["hourly_units"][k] = late["hourly_units"][k]
    if all(v is None for v in fixture["hourly"]["snow_depth"]):
        # The forecast archive lacks snow depth in some places; the reanalysis has it.
        era = quietly(lambda: get(ARCHIVE_API, {"latitude": lat, "longitude": lon, "start_date": day, "end_date": day,
                                                "hourly": "snow_depth", "timezone": "auto"})["hourly"]["snow_depth"][:24])
        if era:
            fixture["hourly"]["snow_depth"] = era
    fixture["country_code"] = cc
    fixture["extras"] = extras(fixture, cc)
    path.write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
    e = fixture["extras"]
    print(f"{fname:20} {day}  AQI max {max(e['aqi'] or [0])}  Kp max {max([k['kp'] for k in e['kp'] or []] or [0])}  "
          f"holidays {[h['name'] for h in e['holidays'] or []]}  UV max {max([v for v in fixture['hourly']['uv_index'] if v is not None] or [0])}  "
          f"snow {max([v for v in fixture['hourly']['snow_depth'] if v is not None] or [0])} m")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    args = sys.argv[1:]
    extras_only = "--extras" in args
    only = set(a for a in args if not a.startswith("--"))
    for fname, name, cc, lat, lon, start, end, rule in SAMPLES:
        if only and fname not in only:
            continue
        if extras_only:
            add_extras(fname, cc, lat, lon)
            continue
        d = fetch(lat, lon, start, end)
        best_i, best_h = max(
            ((i, h) for i, h in day_slices(d) if None not in h["temperature_2m"]),
            key=lambda ih: RULES[rule](ih[1]),
        )
        fixture = {
            "name": name,
            "latitude": lat,
            "longitude": lon,
            "timezone": d["timezone"],
            "utc_offset_seconds": d["utc_offset_seconds"],
            "hourly_units": d["hourly_units"],
            "hourly": best_h,
            "daily": {k: [v[best_i]] for k, v in d["daily"].items()},
            "country_code": cc,
        }
        fixture["extras"] = extras(fixture, cc)
        path = OUT / f"{fname}.json"
        path.write_text(json.dumps(fixture, separators=(",", ":")) + "\n")
        h = best_h
        print(f"{fname:16} {fixture['daily']['time'][0]}  "
              f"T {min(h['temperature_2m']):6.1f}..{max(h['temperature_2m']):5.1f}  "
              f"cloud {mean(h['cloud_cover']):3.0f}%  pop {mean(h['precipitation_probability']):3.0f}%  "
              f"rain {sum(x or 0 for x in h['precipitation']):5.1f}mm  "
              f"wind {mean(h['wind_speed_10m']):4.1f}  P {mean(h['pressure_msl']):6.1f}  "
              f"codes {sorted(set(h['weather_code']))}")


if __name__ == "__main__":
    main()
