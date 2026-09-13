const { EventEmitter } = require('node:events');
const path = require('node:path');
const YAML = require('yaml');
const { randomUUID } = require('node:crypto');
const { configuredPort, gatewayPath, initialConfig } = require('./platform');

const DEFAULT_PORT = 47821;

function writeConfigAtomically(fs, target, config, exclusive = false) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600, flush: true });
    if (exclusive) fs.linkSync(temporary, target);
    else fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

class RestartWindow {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.failures = [];
  }

  record() {
    const currentTime = this.now();
    this.failures = this.failures.filter((failureTime) => currentTime - failureTime <= this.windowMs);
    if (this.failures.length >= this.limit) return false;
    this.failures.push(currentTime);
    return true;
  }
}

class GatewayManager extends EventEmitter {
  constructor({ app, spawn, http, fs, resourcesPath, logger, defaultPort = DEFAULT_PORT }) {
    super();
    this.app = app;
    this.spawn = spawn;
    this.http = http;
    this.fs = fs;
    this.resourcesPath = resourcesPath;
    this.logger = logger;
    this.defaultPort = defaultPort;
    this.userDataDir = app.getPath('userData');
    this.configPath = path.join(this.userDataDir, 'config.yaml');
    this.logPath = path.join(this.userDataDir, 'logs', 'gateway.log');
    this.restartWindow = new RestartWindow({ limit: 3, windowMs: 60_000 });
    this.child = null;
    this.logCompletion = Promise.resolve();
    this.stopping = false;
    this.config = null;
  }

  ensureConfig() {
    this.fs.mkdirSync(path.join(this.userDataDir, 'data'), { recursive: true });
    this.fs.mkdirSync(path.dirname(this.logPath), { recursive: true });

    if (!this.fs.existsSync(this.configPath)) {
      const config = initialConfig(this.userDataDir);
      config.listen_addr = `127.0.0.1:${this.defaultPort}`;
      writeConfigAtomically(this.fs, this.configPath, config, true);
    }

    const source = this.fs.readFileSync(this.configPath, 'utf8');
    try {
      this.config = JSON.parse(source);
    } catch {
      // Keep the existing path/settings, but the pinned gateway accepts JSON only.
      this.config = YAML.parse(source);
      if (!this.config || typeof this.config !== 'object' || Array.isArray(this.config)) {
        throw new Error('The configuration must contain an object.');
      }
      // Preserve the original before normalization. A failed write/rename leaves
      // the source intact; the next launch can safely retry the migration.
      try {
        this.fs.writeFileSync(this.configPath + '.bak', source, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      writeConfigAtomically(this.fs, this.configPath, this.config);
    }
    return this.config;
  }

  currentApiKey() {
    try {
      const config = JSON.parse(this.fs.readFileSync(this.configPath, 'utf8'));
      const keys = config.api_keys ?? [];
      if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw new Error();
      return keys.find(key => key.length > 0);
    } catch {
      // JSON parser messages can contain credential-bearing source snippets.
      throw new Error('The current gateway configuration could not be read. Check the local configuration and retry.');
    }
  }

  start() {
    if (this.child) return this.child;
    this.stopping = false;
    this.ensureConfig();
    return this._spawnGateway();
  }

  _spawnGateway() {
    const child = this.spawn(
      gatewayPath(this.resourcesPath),
      ['--config', this.configPath],
      {
        cwd: this.userDataDir,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    const logStream = this.fs.createWriteStream(this.logPath, { flags: 'a' });
    let remainingOutputs = 2;
    const loggingDone = new Promise((resolve) => {
      const outputClosed = () => {
        remainingOutputs -= 1;
        if (remainingOutputs === 0) logStream.end();
      };
      child.stdout.once('close', outputClosed);
      child.stderr.once('close', outputClosed);
      logStream.once('finish', resolve);
      logStream.once('error', (error) => {
        this.logger.error('Gateway log stream failed', error);
        resolve();
      });
    });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    this.child = child;
    this.logCompletion = loggingDone;

    let handled = false;
    const handleFailure = (failure) => {
      if (handled) return;
      handled = true;
      if (this.child === child) this.child = null;
      if (this.stopping) return;

      if (this.restartWindow.record()) {
        this.logger.info('Gateway stopped unexpectedly; restarting');
        this._spawnGateway();
      } else {
        this.logger.error('Gateway restart limit exceeded', failure);
        this.emit('permanentFailure', failure);
      }
    };

    child.once('error', handleFailure);
    child.once('exit', (code, signal) => handleFailure({ code, signal }));
    return child;
  }

  async waitUntilHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this._isHealthy(deadline)) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
    }
    return false;
  }

  _isHealthy(deadline) {
    return new Promise((resolve) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        resolve(false);
        return;
      }
      let settled = false;
      let deadlineTimer;
      const finish = (healthy) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadlineTimer);
        resolve(healthy);
      };
      const request = this.http.get({
        host: '127.0.0.1',
        path: '/healthz',
        port: this.port(),
        timeout: Math.min(1_000, remaining),
      }, (response) => {
        response.resume();
        finish(response.statusCode === 200 && Date.now() <= deadline);
      });
      request.once('error', () => finish(false));
      request.once('timeout', () => {
        request.destroy();
        finish(false);
      });
      deadlineTimer = setTimeout(() => {
        request.destroy();
        finish(false);
      }, remaining);
    });
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    const loggingDone = this.logCompletion;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      await loggingDone;
      return;
    }

    await new Promise((resolve) => {
      let killTimer;
      const finish = () => {
        clearTimeout(killTimer);
        resolve();
      };
      child.once('exit', finish);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    });
    await loggingDone;
  }

  port() {
    return configuredPort(this.config || this.ensureConfig(), this.defaultPort);
  }
}

module.exports = { GatewayManager, RestartWindow };
