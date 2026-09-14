import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import runtime from '../desktop/runtime.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:43187';
let child;
let stopping = false;
function stop() {
  stopping = true;
  if (child && !child.killed) child.kill();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.once('exit', stop);

async function build() {
  child = spawn(process.execPath, ['desktop/build-desktop.mjs'], { cwd: root, stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0 || stopping) throw new Error('本地构建未完成。');
}

try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('请先安装 Node.js 22.13 或更新版本。');
  if (!existsSync(path.join(root, 'dist/standalone/server.js'))) await build();
  if (stopping) throw new Error('启动已取消。');
  const serverDir = path.join(root, 'dist/standalone');
  child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '43187' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const server = child;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  await runtime.waitForServerProcess(server);
  server.stdout.resume();
  await runtime.waitForHttp(url);
  if (stopping || server.exitCode !== null) throw new Error('本地服务已退出。');
  console.log(`\nPaper Agent 已启动：${url}\n请保留此窗口，按 Ctrl+C 停止服务。\n`);
  if (!process.argv.includes('--no-open')) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const browser = spawn(command, args, { stdio: 'ignore' });
    browser.once('error', () => console.log(`请手动在浏览器打开 ${url}`));
  }
  const code = await exited;
  if (!stopping && code !== 0) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  stop();
  process.exitCode = 1;
}
