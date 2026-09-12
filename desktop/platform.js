const path = require('node:path');

const DEFAULT_PORT = 47821;

function gatewayPath(resourcesPath) {
  return path.join(resourcesPath, 'bin', 'freebuff2api');
}

function initialConfig(userDataDir) {
  const dataDir = path.join(userDataDir, 'data');
  return {
    listen_addr: `127.0.0.1:${DEFAULT_PORT}`,
    upstream_base_url: 'https://www.codebuff.com',
    auth_tokens: [],
    api_keys: [],
    rotation_interval_sec: 21_600,
    request_timeout_sec: 900,
    http_proxy: '',
    session_keepalive_sec: 45,
    ad_providers: ['gravity'],
    fallback_models: [],
    token_saver: false,
    sqlite_path: path.join(dataDir, 'freebuff2api.sqlite'),
    tokens_path: path.join(dataDir, 'tokens.json'),
    telemetry_path: path.join(dataDir, 'telemetry.sqlite'),
    memory_path: path.join(dataDir, 'memory.sqlite'),
    threads_path: path.join(dataDir, 'threads.json'),
    cred_meta_path: path.join(dataDir, 'cred_meta.json'),
    account_history_path: path.join(dataDir, 'account_history.jsonl'),
    thread_cleanup_interval_sec: 3600,
    thread_max_age_hours: 24,
    web_threads_path: path.join(dataDir, 'web_threads.json'),
    memory_enabled: false,
    skills_dir: path.join(dataDir, 'skills'),
    skills_inject_mode: 'roster',
    max_roster_tokens: 2000,
    web_dir: '',
    skip_upstream_check: true,
  };
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function configuredPort(config, fallback = DEFAULT_PORT) {
  const safeFallback = validPort(fallback) || DEFAULT_PORT;
  const match = /^(?:127\.0\.0\.1|localhost):(\d+)$/.exec(String(config?.listen_addr || ''));
  return match ? validPort(match[1]) || safeFallback : safeFallback;
}

function isLoopbackDashboardUrl(rawUrl, port) {
  const safePort = validPort(port);
  if (!safePort) return false;

  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      && url.port === String(safePort);
  } catch {
    return false;
  }
}

function dataPathDescription(userDataDir) {
  return `Configuration and data: ${userDataDir}`;
}

module.exports = {
  configuredPort,
  dataPathDescription,
  gatewayPath,
  initialConfig,
  isLoopbackDashboardUrl,
};
