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
# Config::apply_env in the pinned gateway overrides config file values. Use
# explicit launch values (not just the caller's environment) so LaunchServices
# cannot carry another profile's paths, credentials, listeners, or runtime flags.
/usr/bin/open --new -a "$temporary_app" \
  --stdout "$temporary_dir/app.stdout" --stderr "$temporary_dir/app.stderr" \
  --env LISTEN_ADDR=127.0.0.1:47821 --env UPSTREAM_BASE_URL=https://www.codebuff.com \
  --env AUTH_TOKENS= --env API_KEYS= --env ROTATION_INTERVAL=21600 --env REQUEST_TIMEOUT=900 \
  --env HTTP_PROXY= --env HTTPS_PROXY= --env ALL_PROXY= --env http_proxy= --env https_proxy= --env all_proxy= \
  --env NO_PROXY=127.0.0.1,localhost --env no_proxy=127.0.0.1,localhost \
  --env AD_PROVIDERS=gravity --env FALLBACK_MODELS= --env TOKEN_SAVER=false \
  --env "SQLITE_PATH=$user_data/data/freebuff2api.sqlite" --env "TOKENS_PATH=$user_data/data/tokens.json" \
  --env "TELEMETRY_PATH=$user_data/data/telemetry.sqlite" --env "MEMORY_PATH=$user_data/data/memory.sqlite" \
  --env "CRED_META_PATH=$user_data/data/cred_meta.json" --env "ACCOUNT_HISTORY_PATH=$user_data/data/account_history.jsonl" \
  --env "WEB_THREADS_PATH=$user_data/data/web_threads.json" --env "SKILLS_DIR=$user_data/data/skills" \
  --env THREAD_CLEANUP_INTERVAL=3600 --env THREAD_MAX_AGE_HOURS=24 --env MEMORY_ENABLED=false \
  --env SKILLS_INJECT_MODE=roster --env MAX_ROSTER_TOKENS=2000 --env WEB_DIR= --env GATEWAY_PORT=47821 \
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
node <<'NODE'
const assert = require('node:assert/strict');
(async () => {
  for (const endpoint of ['/api/doctor', '/api/usage/cost']) {
    const response = await fetch('http://127.0.0.1:47821' + endpoint, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.doesNotMatch(await response.text(), /\p{Script=Han}/u, endpoint + ' contains untranslated dashboard copy');
  }
  const response = await fetch('http://127.0.0.1:47821/api/skills/gate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: '' }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200);
  const gate = await response.json();
  assert.ok(gate.issues.length > 0);
  assert.doesNotMatch(JSON.stringify(gate), /\p{Script=Han}/u);
  console.log('Dashboard diagnostics, cost, and validation messages are English');
})().catch(error => { console.error(error); process.exitCode = 1; });
NODE
node - "$temporary_dir/dashboard.html" <<'NODE'
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync(process.argv[2], 'utf8');
assert.match(html, /<html lang="en">/);
assert.match(html, /<title>Freebuff2API Dashboard<\/title>/);
assert.doesNotMatch(html, /\p{Script=Han}/u);
console.log('Dashboard HTML is English (no Han-script characters)');
NODE

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
        && target.url === 'http://127.0.0.1:47821/ui' && target.title === 'Freebuff2API Dashboard'
        && !/\p{Script=Han}/u.test(target.title))) {
        console.log('Renderer dashboard loaded: Freebuff2API Dashboard');
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
