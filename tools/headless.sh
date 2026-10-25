#!/usr/bin/env bash
# Run headless Chromium and always remove its temp files afterwards.
# Usage: tools/headless.sh [chromium flags...] URL
# e.g.   tools/headless.sh --virtual-time-budget=20000 --dump-dom http://localhost:8090/test/
#
# Chromium leaves ~130 MB "scoped_dir" folders in $TMPDIR when it is killed
# instead of closing cleanly. On a machine where /tmp lives in RAM those
# pile up fast, so give each run its own folder and delete it on exit.
set -u

work=$(mktemp -d "${TMPDIR:-/tmp}/weathertunes-chromium.XXXXXX")
pid=""

cleanup() {
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
  fi
  rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

TMPDIR="$work" chromium --headless=new --no-first-run --disable-gpu \
  --user-data-dir="$work/profile" "$@" &
pid=$!
wait "$pid"
status=$?
pid=""
exit "$status"
