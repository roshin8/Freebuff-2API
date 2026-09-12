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

if (!match) throw new Error('missing loopback listen_addr');

const server = http.createServer((request, response) => {
  response.writeHead(request.url === '/healthz' ? 200 : 404);
  response.end();
});

server.listen(Number(match[1]), '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
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

  return {
    cleanup,
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
  };
}

module.exports = { createGatewayFixture };
