const fs = require('node:fs');
const path = require('node:path');
const { execFileSync: runFile } = require('node:child_process');

function inspectBundle({ appPath, expectedArch, execFileSync = runFile } = {}) {
  if (!appPath || !expectedArch) throw new Error('APP_PATH and EXPECTED_ARCH are required');
  if (expectedArch !== 'arm64' && expectedArch !== 'x64') {
    throw new Error(`unsupported expected architecture: ${expectedArch}`);
  }

  const gatewayPath = path.join(appPath, 'Contents', 'Resources', 'bin', 'freebuff2api');
  try {
    if (!fs.statSync(gatewayPath).isFile()) throw new Error('not a file');
    fs.accessSync(gatewayPath, fs.constants.X_OK);
  } catch (cause) {
    throw new Error(`gateway must be an executable file: ${gatewayPath}`, { cause });
  }

  const output = String(execFileSync('file', [gatewayPath])).trim();
  const match = output.match(/^(?:.*: )?Mach-O 64-bit executable (arm64|x86_64)\b/);
  const architecture = match && (match[1] === 'x86_64' ? 'x64' : 'arm64');
  if (architecture !== expectedArch) {
    throw new Error(`gateway architecture must be ${expectedArch}: ${output}`);
  }
  return { gatewayPath, architecture };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(inspectBundle({
      appPath: process.env.APP_PATH,
      expectedArch: process.env.EXPECTED_ARCH,
    })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { inspectBundle };
