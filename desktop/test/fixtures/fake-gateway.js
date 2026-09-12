const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const gatewaySource = `#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');

const configIndex = process.argv.indexOf('--config');
const config = fs.readFileSync(process.argv[configIndex + 1], 'utf8');
const match = /^listen_addr:\\s*["']?127\\.0\\.0\\.1:(\\d+)["']?\\s*$/m.exec(config);
const delayPath = require('node:path').join(process.cwd(), 'health-delay-ms');
const tricklePath = require('node:path').join(process.cwd(), 'health-trickle-ms');
const shutdownOutputPath = require('node:path').join(process.cwd(), 'shutdown-output-bytes');

if (!match) throw new Error('missing loopback listen_addr');

const server = http.createServer((request, response) => {
  if (fs.existsSync(tricklePath)) {
    const trickleMs = Number(fs.readFileSync(tricklePath, 'utf8'));
    response.socket.write('HTTP/1.1 200 OK\\r\\nX-Trickle: ');
    const trickle = setInterval(() => response.socket.write('x'), 25);
    setTimeout(() => {
      clearInterval(trickle);
      response.socket.end('\\r\\nContent-Length: 0\\r\\n\\r\\n');
    }, trickleMs);
    return;
  }
  const healthDelayMs = fs.existsSync(delayPath) ? Number(fs.readFileSync(delayPath, 'utf8')) : 0;
  setTimeout(() => {
    response.writeHead(request.url === '/healthz' ? 200 : 404);
    response.end();
  }, healthDelayMs);
});

server.listen(Number(match[1]), '127.0.0.1');
process.on('SIGTERM', () => server.close(() => {
  if (!fs.existsSync(shutdownOutputPath)) process.exit(0);
  const bytes = Number(fs.readFileSync(shutdownOutputPath, 'utf8'));
  const writerSource = "setTimeout(() => { process.stdout.write(Buffer.alloc(" + bytes + ", 'x')); process.stdout.write('GATEWAY_LOG_DRAINED\\\\n', () => process.exit(0)); }, 100)";
  require('node:child_process').spawn(process.execPath, ['-e', writerSource], {
    stdio: ['ignore', process.stdout, process.stderr],
  });
  process.exit(0);
}));
`;

async function availablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function createGatewayFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'freebuff-lifecycle-'));
  const resourcesPath = path.join(directory, 'resources');
  const executable = path.join(resourcesPath, 'bin', 'freebuff2api');
  const userDataDir = path.join(directory, 'user-data');
  const port = await availablePort();
  const children = new Set();

  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, gatewaySource, { mode: 0o755 });

  function trackedSpawn(...args) {
    const child = spawn(...args);
    children.add(child);
    child.once('exit', () => children.delete(child));
    return child;
  }

  async function cleanup() {
    const exits = [...children].map((child) => new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGKILL');
    }));
    await Promise.all(exits);
    fs.rmSync(directory, { force: true, recursive: true });
  }

  async function isListening() {
    return new Promise((resolve) => {
      const request = http.get({
        host: '127.0.0.1',
        path: '/healthz',
        port,
        timeout: 250,
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

  function delayHealth(delayMs) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'health-delay-ms'), String(delayMs));
  }

  function trickleHealth(trickleMs) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'health-trickle-ms'), String(trickleMs));
  }

  function bufferOutputOnShutdown(bytes) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'shutdown-output-bytes'), String(bytes));
  }

  function readGatewayLog() {
    return fs.readFileSync(path.join(userDataDir, 'logs', 'gateway.log'));
  }

  return {
    bufferOutputOnShutdown,
    cleanup,
    delayHealth,
    isListening,
    options: {
      app: { getPath: (name) => name === 'userData' ? userDataDir : undefined },
      defaultPort: port,
      fs,
      http,
      logger: { error() {}, info() {} },
      resourcesPath,
      spawn: trackedSpawn,
    },
    port,
    readGatewayLog,
    trickleHealth,
  };
}

module.exports = { createGatewayFixture };
