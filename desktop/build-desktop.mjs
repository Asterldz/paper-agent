import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, ['node_modules/vinext/dist/cli.js', 'build'], {
  cwd: root,
  env: { ...process.env, PAPER_AGENT_DESKTOP_BUILD: '1' },
  stdio: 'inherit',
});
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
if (code !== 0) process.exit(code ?? 1);
await access(path.join(root, 'dist', 'standalone', 'server.js'));
console.log('Desktop web runtime is ready in dist/standalone.');
