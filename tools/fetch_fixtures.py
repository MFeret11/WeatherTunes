#!/usr/bin/env python3
"""Fetch sample days from Open-Meteo's historical forecast archive into samples/.

Each fixture is a real forecast for one day, picked from a month of data by a
rule (hottest clear day, a thunderstorm day, a snow day...). The saved JSON has
the same shape as a live /v1/forecast response, plus a "name" field.

Usage: python3 tools/fetch_fixtures.py [sample-name ...]   (no names: fetch all)
"""
import json
import sys
import pathlib
import urllib.parse
import urllib.request

HOURLY = ("temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,"
          "wind_direction_10m,precipitation_probability,precipitation,cloud_cover,weather_code,is_day")
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

# file name, display name, lat, lon, month start, month end, rule
SAMPLES = [
    ("phoenix-heat", "Phoenix, USA", 33.4, -112.1, "2025-07-01", "2025-07-31", "hot_clear"),
    ("kyoto-spring", "Kyoto, Japan", 35.0, 135.8, "2025-04-01", "2025-04-30", "clear"),
    ("london-drizzle", "London, UK", 51.5, -0.1, "2025-11-01", "2025-11-30", "drizzle"),
    ("mumbai-monsoon", "Mumbai, India", 19.1, 72.9, "2025-07-01", "2025-07-31", "rain"),
    ("houston-storms", "Houston, USA", 29.8, -95.4, "2025-04-01", "2025-06-30", "storm"),
    ("oslo-snow", "Oslo, Norway", 59.9, 10.8, "2025-01-01", "2025-02-28", "snow"),
    ("mcmurdo-cold", "McMurdo Station, Antarctica", -77.8, 166.7, "2025-07-01", "2025-07-31", "cold"),
    ("honolulu-flat", "Honolulu, USA", 21.3, -157.9, "2025-09-01", "2025-09-30", "flat"),
    ("reykjavik-wind", "Reykjavik, Iceland", 64.1, -21.9, "2025-12-01", "2025-12-31", "windy"),
    ("philadelphia-autumn", "Philadelphia, USA", 40.0, -75.2, "2025-10-01", "2025-10-31", "clear"),
]


def fetch(lat, lon, start, end):
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "start_date": start, "end_date": end,
        "hourly": HOURLY, "daily": DAILY, "timezone": "auto",
    })
    with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
        return json.load(r)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for fname, name, lat, lon, start, end, rule in SAMPLES:
        if only and fname not in only:
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
        }
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
