const { EventEmitter } = require('node:events');
const path = require('node:path');
const YAML = require('yaml');
const { configuredPort, gatewayPath, initialConfig } = require('./platform');

const DEFAULT_PORT = 47821;

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
    this.stopping = false;
    this.config = null;
  }

  ensureConfig() {
    this.fs.mkdirSync(path.join(this.userDataDir, 'data'), { recursive: true });
    this.fs.mkdirSync(path.dirname(this.logPath), { recursive: true });

    if (!this.fs.existsSync(this.configPath)) {
      const config = initialConfig(this.userDataDir);
      config.listen_addr = `127.0.0.1:${this.defaultPort}`;
      this.fs.writeFileSync(this.configPath, YAML.stringify(config), { flag: 'wx', mode: 0o600 });
    }

    this.config = YAML.parse(this.fs.readFileSync(this.configPath, 'utf8'));
    return this.config;
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
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    this.child = child;

    let handled = false;
    const handleFailure = (failure) => {
      if (handled) return;
      handled = true;
      logStream.end();
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
    do {
      if (await this._isHealthy()) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, remaining)));
    } while (Date.now() <= deadline);
    return false;
  }

  _isHealthy() {
    return new Promise((resolve) => {
      const request = this.http.get({
        host: '127.0.0.1',
        path: '/healthz',
        port: this.port(),
        timeout: 1_000,
      }, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.once('error', () => resolve(false));
      request.once('timeout', () => {
        request.destroy();
        resolve(false);
      });
    });
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

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
  }

  port() {
    return configuredPort(this.config || this.ensureConfig(), this.defaultPort);
  }
}

module.exports = { GatewayManager, RestartWindow };
