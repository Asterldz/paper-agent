import { spawn } from 'node:child_process';
import runtime from './runtime.cjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = '127.0.0.1';
const port = await runtime.findOpenPort(host);
const url = `http://${host}:${port}`;
const web = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'dev', '--hostname', host, '--port', String(port)], {
  cwd: root,
  env: { ...process.env, VINEXT_NO_DEV_LOCK: '1' },
  stdio: 'inherit',
});

let desktop;
let startupError;
let stopped = false;
const stop = () => {
  stopped = true;
  if (desktop && !desktop.killed) desktop.kill();
  if (!web.killed) web.kill();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
web.once('error', (error) => { startupError = error; });

try {
  await runtime.waitForHttp(url, 30_000, (...args) => {
    if (startupError) throw startupError;
    if (stopped || web.exitCode !== null) throw new Error('Development server stopped.');
    return fetch(...args);
  });
  if (stopped) throw new Error('Startup cancelled.');
  desktop = spawn(process.execPath, ['node_modules/electron/cli.js', '.'], {
  cwd: root,
  env: { ...process.env, PAPER_AGENT_DEV_URL: url },
  stdio: 'inherit',
  });
  process.exitCode = await new Promise((resolve, reject) => {
    desktop.once('error', reject);
    desktop.once('exit', (code) => resolve(code ?? 0));
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stop();
}
