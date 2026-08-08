#!/bin/bash
# Start the git-status dashboard (if it is not already up) and open it in Chrome.
#
# Written for double-clicking: "Git Status.app" execs this, so it runs with a bare
# launchd PATH and with no terminal attached. Everything it needs is therefore
# looked up explicitly, and anything worth saying is said in a dialog, not on stdout.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-4173}"
HOST="${HOST:-127.0.0.1}"
URL="http://${HOST}:${PORT}"
LOG="${HOME}/Library/Logs/git-status-gui.log"

mkdir -p "$(dirname "$LOG")"

say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

die() {
  say "ERROR: $1"
  /usr/bin/osascript -e 'on run argv
    display dialog (item 1 of argv) & return & return & "Details: " & (item 2 of argv) ¬
      with title "Git Status" buttons {"OK"} default button "OK" with icon caution
  end run' "$1" "$LOG" >/dev/null 2>&1
  exit 1
}

# ── Is it already running? ────────────────────────────────────────────────────
# Only treat the port as "ours" if the health endpoint says so; something else
# listening on 4173 must not be mistaken for the dashboard.
health() { /usr/bin/curl -fsS --max-time 2 "${URL}/api/health" 2>/dev/null; }

if health | /usr/bin/grep -q 'git-status-gui'; then
  say "already running on $URL"
else
  [ -f "$REPO_DIR/package.json" ] || die "Cannot find the git-status repo. Keep Git Status.app inside the repo folder — put an alias in the Dock or in Applications rather than moving it."

  # ── Find node ───────────────────────────────────────────────────────────────
  # A double-clicked app inherits no shell profile, so PATH will not have nvm,
  # homebrew or volta on it. Look where they actually are.
  NODE=""
  for candidate in \
    "$(command -v node 2>/dev/null)" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME/.volta/bin/node" \
    /usr/bin/node \
    "$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then NODE="$candidate"; break; fi
  done
  [ -n "$NODE" ] || die "Could not find Node.js. Install it (brew install node) and try again."

  NODE_BIN="$(dirname "$NODE")"
  export PATH="$NODE_BIN:$PATH"
  NPM="$NODE_BIN/npm"
  [ -x "$NPM" ] || NPM="$(command -v npm 2>/dev/null)"
  [ -n "$NPM" ] && [ -x "$NPM" ] || die "Found Node at $NODE but no npm alongside it."

  cd "$REPO_DIR" || die "Cannot enter $REPO_DIR"

  # ── First run: install the dev dependencies ─────────────────────────────────
  if [ ! -d node_modules ]; then
    say "installing dependencies (first run)"
    /usr/bin/osascript -e 'display notification "Installing dependencies — this only happens once." with title "Git Status"' >/dev/null 2>&1
    "$NPM" install --no-audit --no-fund >>"$LOG" 2>&1 || die "npm install failed."
  fi

  # ── Start it, detached, and leave it running ────────────────────────────────
  say "starting server on $URL (node $("$NODE" -v))"
  PORT="$PORT" HOST="$HOST" nohup "$NPM" start >>"$LOG" 2>&1 &
  disown 2>/dev/null

  waited=0
  until health | /usr/bin/grep -q 'git-status-gui'; do
    sleep 0.25
    waited=$((waited + 1))
    if [ "$waited" -gt 120 ]; then
      if /usr/bin/curl -fsS --max-time 2 "$URL" >/dev/null 2>&1; then
        die "Port $PORT is already in use by something that is not this app."
      fi
      die "The server did not come up within 30 seconds."
    fi
  done
  say "up after $((waited / 4))s"
fi

# ── Open it ───────────────────────────────────────────────────────────────────
if [ -d "/Applications/Google Chrome.app" ]; then
  /usr/bin/open -a "Google Chrome" "$URL"
else
  say "Google Chrome not found; opening the default browser instead"
  /usr/bin/open "$URL"
fi
