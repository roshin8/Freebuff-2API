#!/bin/bash
set -euo pipefail

fail() { echo "smoke-app: $*" >&2; exit 1; }
[[ $# == 1 && "$1" == /*.app ]] || fail 'usage: smoke-app.sh /absolute/path/Freebuff2API.app'
[[ -d "$1" ]] || fail 'app bundle not found'
[[ "$(uname -s)" == Darwin ]] || fail 'macOS is required'
[[ -x "$1/Contents/MacOS/Freebuff2API" ]] || fail 'app executable not found'
command -v node >/dev/null || fail 'Node.js is required to validate health JSON'
if /usr/sbin/lsof -nP -iTCP:47821 -sTCP:LISTEN >/dev/null 2>&1; then
  fail 'port 47821 is occupied; quit the existing gateway before this test'
fi

temporary_dir="$(mktemp -d /tmp/freebuff-app-smoke.XXXXXX)"
temporary_dir="$(cd "$temporary_dir" && pwd -P)"
temporary_app="$temporary_dir/Freebuff2API.app"
user_data="$temporary_dir/user-data"
launched=false

# Match only commands launched from this unique copied bundle, including helpers.
bundle_pids() {
  ps -axo pid=,command= | awk -v prefix="$temporary_app/" '
    { command=$0; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", command) }
    index(command, prefix) == 1 { print $1 }'
}

executable_pid() {
  ps -axo pid=,command= | awk -v executable="$1" '
    { command=$0; sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", command) }
    command == executable || index(command, executable " ") == 1 { print $1 }'
}

quit_app() {
  /usr/bin/osascript - "$temporary_app" <<'APPLESCRIPT'
on run argv
  with timeout of 5 seconds
    tell application (item 1 of argv) to quit
  end timeout
end run
APPLESCRIPT
}

cleanup() {
  result=$?
  trap - EXIT
  if $launched && [[ -n "$(bundle_pids)" ]]; then quit_app >/dev/null 2>&1 || true; fi
  for ((i=0; i<60; i++)); do
    [[ -z "$(bundle_pids)" ]] && break
    sleep 0.1
  done
  remaining="$(bundle_pids)"
  if [[ -n "$remaining" ]]; then
    echo "smoke-app: forced cleanup of temporary bundle processes: $remaining" >&2
    while read -r pid; do kill -KILL "$pid" 2>/dev/null || true; done <<< "$remaining"
    result=1
  fi
  if [[ $result != 0 && -f "$user_data/logs/gateway.log" ]]; then tail -n 40 "$user_data/logs/gateway.log" >&2; fi
  if [[ -n "${SMOKE_LOG_DIR:-}" ]]; then
    mkdir -p "$SMOKE_LOG_DIR" || result=1
    for log in "$temporary_dir/app.stdout" "$temporary_dir/app.stderr" "$user_data/logs/gateway.log"; do
      [[ ! -f "$log" ]] || cp "$log" "$SMOKE_LOG_DIR/" || result=1
    done
  fi
  # This is the exact mktemp directory owned by this invocation.
  rm -r -- "$temporary_dir" || result=1
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

/usr/bin/ditto "$1" "$temporary_app"
mkdir -p "$user_data"
launched=true
/usr/bin/open --new -a "$temporary_app" \
  --stdout "$temporary_dir/app.stdout" --stderr "$temporary_dir/app.stderr" \
  --env AUTH_TOKENS= --env API_KEYS= --env HTTP_PROXY= \
  --args "--user-data-dir=$user_data" --remote-debugging-address=127.0.0.1 --remote-debugging-port=0

wait_for_health() {
  local deadline=$((SECONDS + 20))
  while (( SECONDS < deadline )); do
    if curl --fail --silent --max-time 1 http://127.0.0.1:47821/healthz > "$temporary_dir/health.json"; then
      if node -e 'const fs=require("node:fs"); process.exit(JSON.parse(fs.readFileSync(process.argv[1])).ok === true ? 0 : 1)' "$temporary_dir/health.json"; then return; fi
    fi
    sleep 0.25
  done
  fail 'gateway health did not become ready within 20 seconds'
}

wait_for_health
[[ -f "$user_data/config.yaml" ]] || fail 'app did not use the isolated user-data directory'
app_pid="$(executable_pid "$temporary_app/Contents/MacOS/Freebuff2API")"
gateway_pid="$(executable_pid "$temporary_app/Contents/Resources/bin/freebuff2api")"
[[ "$app_pid" =~ ^[0-9]+$ && "$gateway_pid" =~ ^[0-9]+$ ]] || fail 'expected exactly one app and bundled gateway process'
[[ "$(ps -o ppid= -p "$gateway_pid" | tr -d ' ')" == "$app_pid" ]] || fail 'gateway is not a child of the copied app'
echo "Health OK; app PID $app_pid, bundled gateway PID $gateway_pid"
status="$(curl --silent --output "$temporary_dir/dashboard.html" --write-out '%{http_code}' --max-time 5 http://127.0.0.1:47821/ui)"
[[ "$status" == 200 ]] || fail "dashboard returned HTTP $status"
echo 'Dashboard HTTP 200'

# Observe the real renderer before interrupting its server. An independent
# HTTP probe can succeed before Electron has begun its initial navigation.
# This disposable profile exposes DevTools on an ephemeral loopback port only.
node - "$user_data/DevToolsActivePort" <<'NODE'
const fs = require('node:fs');
(async () => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const port = Number(fs.readFileSync(process.argv[2], 'utf8').split('\n')[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid debugger port');
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      const targets = await response.json();
      if (targets.some(target => target.type === 'page'
        && target.url === 'http://127.0.0.1:47821/ui' && target.title === 'Freebuff2API 控制台')) {
        console.log('Renderer dashboard loaded: Freebuff2API 控制台');
        return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('renderer dashboard did not load within 20 seconds');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE

# Kill only the identified test child; the packaged app must recover itself.
kill -TERM "$gateway_pid"
deadline=$((SECONDS + 20))
replacement_pid=''
while (( SECONDS < deadline )); do
  replacement_pid="$(executable_pid "$temporary_app/Contents/Resources/bin/freebuff2api")"
  [[ -n "$replacement_pid" && "$replacement_pid" != "$gateway_pid" ]] && break
  sleep 0.1
done
[[ "$replacement_pid" =~ ^[0-9]+$ && "$replacement_pid" != "$gateway_pid" ]] || fail 'gateway was not restarted'
wait_for_health
[[ "$(ps -o ppid= -p "$replacement_pid" | tr -d ' ')" == "$app_pid" ]] || fail 'replacement gateway has the wrong parent'
status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 http://127.0.0.1:47821/ui)"
[[ "$status" == 200 ]] || fail "dashboard after restart returned HTTP $status"
echo "Recovery OK; replacement gateway PID $replacement_pid; dashboard HTTP 200"

quit_app
for ((i=0; i<60; i++)); do
  [[ -z "$(bundle_pids)" ]] && break
  sleep 0.1
done
[[ -z "$(bundle_pids)" ]] || fail 'app or bundled gateway remained running after quit'
if curl --fail --silent --max-time 1 http://127.0.0.1:47821/healthz >/dev/null 2>&1; then fail 'health endpoint remained available after quit'; fi
echo 'Clean shutdown; app, helpers, and gateway exited; health endpoint closed'
