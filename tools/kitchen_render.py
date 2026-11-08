#!/usr/bin/env python3
"""Make today's song for a kitchen display ahead of time, so it plays the moment it's tapped.

Renders today's forecast for one place in headless Chromium (tools/kitchen-render.html),
compresses the song with ffmpeg, and publishes a copy of the app with the result:

    OUT/kitchen.html          the entry page (tools/kitchen.html): opens the current version
    OUT/version.json          which version that is
    OUT/v/<version>/          the app (index.html, styles.css, src/, vendor/) from the git ref
    OUT/cache/day.json        today's forecast and place
    OUT/cache/song.ogg        today's song (Opus)

Open OUT/kitchen.html?kitchen (&widget, &autoplay, &return=<seconds>: see src/main.js).
Each version of the app gets its own folder and is never changed afterwards, because
some servers (Home Assistant's /local/) let browsers keep files for a month.
The place comes from a JSON file kept outside the repo, so it never gets committed:
    {"name": "Home", "lat": 40.0, "lon": -75.0, "cc": "US"}
Coordinates are rounded to 0.1 degrees before they're used, as on the site.

Usage: tools/kitchen_render.py --out DIR [--place FILE] [--ref main | --worktree]
Prints nothing on success (for cron); errors go to stderr with a non-zero exit.
"""

import argparse
import hashlib
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP = ["index.html", "styles.css", "src", "vendor"]
RENDER_PAGE = "tools/kitchen-render.html"
ENTRY_PAGE = "tools/kitchen.html"
TIMEOUT_S = 900  # a Pi 4 takes a few minutes for a long song


def export(ref, worktree, dest):
    """The app as of `ref` (or the working tree), plus the render page, into dest."""
    paths = APP + [RENDER_PAGE, ENTRY_PAGE]
    if worktree:
        for p in paths:
            src = REPO / p
            if src.is_dir():
                shutil.copytree(src, dest / p)
            else:
                (dest / p).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest / p)
        return
    archive = subprocess.run(["git", "-C", str(REPO), "archive", ref, *paths], check=True, capture_output=True).stdout
    subprocess.run(["tar", "-x", "-C", str(dest)], input=archive, check=True)


def render(app_dir, place):
    """Serve app_dir, run the render page, and return (day dict, wav bytes)."""
    got = {}
    finished = threading.Event()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(app_dir), **kw)

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            got[self.path] = body
            self.send_response(204)
            self.end_headers()
            if self.path in ("/__song", "/__error"):
                finished.set()

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    query = urllib.parse.urlencode({k: place[k] for k in ("name", "lat", "lon", "cc") if place.get(k) is not None})
    url = f"http://127.0.0.1:{server.server_address[1]}/{RENDER_PAGE}?{query}"
    browser = subprocess.Popen(
        [str(REPO / "tools/headless.sh"), "--autoplay-policy=no-user-gesture-required", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        if not finished.wait(TIMEOUT_S):
            raise RuntimeError(f"no song after {TIMEOUT_S} s")
    finally:
        browser.terminate()  # headless.sh stops Chromium and removes its temp files
        try:
            browser.wait(30)
        except subprocess.TimeoutExpired:
            browser.kill()
        server.shutdown()
    if "/__error" in got:
        raise RuntimeError("render page: " + got["/__error"].decode(errors="replace"))
    return json.loads(got["/__day"]), got["/__song"]


def write_atomic(path, data):
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    os.replace(tmp, path)


def app_version(app_dir):
    """A short hash of the app's files, so a new version gets a new folder."""
    h = hashlib.sha256()
    for p in sorted(f for name in APP for f in ([app_dir / name] if (app_dir / name).is_file() else (app_dir / name).rglob("*")) if f.is_file()):
        h.update(str(p.relative_to(app_dir)).encode() + b"\0" + p.read_bytes() + b"\0")
    return h.hexdigest()[:12]


def publish(app_dir, day, ogg, out):
    """The app's version folder (only when it's new), the entry page, then the song and
    the day that points at it. Version folders older than the previous one are removed."""
    out.mkdir(parents=True, exist_ok=True)
    version = app_version(app_dir)
    versions = out / "v"
    versions.mkdir(exist_ok=True)
    target = versions / version
    if not target.exists():
        staging = versions / f".{version}.tmp"
        shutil.rmtree(staging, ignore_errors=True)
        staging.mkdir()
        subprocess.run(["rsync", "-r", *[str(app_dir / p) for p in APP], str(staging) + "/"], check=True)
        os.replace(staging, target)
    entry = (app_dir / ENTRY_PAGE).read_bytes()
    if not (out / "kitchen.html").exists() or (out / "kitchen.html").read_bytes() != entry:
        write_atomic(out / "kitchen.html", entry)

    cache = out / "cache"
    cache.mkdir(exist_ok=True)
    day["audio"] = "song.ogg"
    write_atomic(cache / "song.ogg", ogg)
    write_atomic(cache / "day.json", json.dumps(day, separators=(",", ":")).encode())

    # Point at the new version last, so the entry page never opens a half-copied one.
    old = None
    try:
        old = json.loads((out / "version.json").read_text()).get("version")
    except (OSError, ValueError):
        pass
    if old != version:
        write_atomic(out / "version.json", json.dumps({"version": version}).encode())
    # Keep this version and the one before it (a page may still be open on it).
    for d in versions.iterdir():
        if d.is_dir() and d.name not in (version, old):
            shutil.rmtree(d)
    # The app used to be published straight into OUT; those copies are no longer used.
    for name in ("index.html", "styles.css", "src", "vendor"):
        p = out / name
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path, help="folder to publish to")
    ap.add_argument("--place", type=Path, default=Path.home() / ".config/weathertunes/kitchen.json")
    ap.add_argument("--ref", default="main", help="git ref to publish (default: main)")
    ap.add_argument("--worktree", action="store_true", help="publish the working tree instead (testing)")
    args = ap.parse_args()

    place = json.loads(args.place.read_text())
    with tempfile.TemporaryDirectory(prefix="weathertunes-kitchen-") as tmp:
        tmp = Path(tmp)
        app_dir = tmp / "app"
        app_dir.mkdir()
        export(args.ref, args.worktree, app_dir)
        day, wav = render(app_dir, place)
        (tmp / "song.wav").write_bytes(wav)
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(tmp / "song.wav"), "-c:a", "libopus", "-b:a", "128k", str(tmp / "song.ogg")],
            check=True,
        )
        publish(app_dir, day, (tmp / "song.ogg").read_bytes(), args.out.expanduser())


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # one line for cron mail / the log, not a traceback
        print(f"kitchen_render: {e}", file=sys.stderr)
        sys.exit(1)
