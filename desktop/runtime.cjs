'use strict';

const net = require('node:net');
const path = require('node:path');

function isSafeExternalUrl(value) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

function isSameOrigin(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}

function findOpenPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 30_000, fetcher = globalThis.fetch) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now()))) });
      await response.body?.cancel();
      if (response.status === 200) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Paper Agent local server did not start in ${timeoutMs}ms.`, { cause: lastError });
}

function serverRoot(app) {
  return app.isPackaged ? path.join(process.resourcesPath, 'app-server') : path.join(__dirname, '..', 'dist', 'standalone');
}

function waitForServerProcess(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const finish = (error) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr?.off('data', onStderr);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error); else resolve();
    };
    const onData = (chunk) => {
      output = (output + chunk.toString()).slice(-4096);
      // Vinext emits this only after its listening callback.
      if (output.includes('[vinext] Production server running at ')) finish();
    };
    const onError = (error) => finish(error);
    const onStderr = (chunk) => { errors = (errors + chunk.toString()).slice(-6000); };
    const onExit = () => finish(new Error(errors.includes('EADDRINUSE')
      ? '本地端口 43187 已被占用，请退出旧的本地服务后重试。'
      : `本地服务启动失败。${errors ? `\n${errors}` : '请检查应用运行文件是否完整。'}`));
    const timer = setTimeout(() => finish(new Error('本地服务启动超时。')), timeoutMs);
    child.stdout.on('data', onData);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

module.exports = { findOpenPort, isSafeExternalUrl, isSameOrigin, serverRoot, waitForHttp, waitForServerProcess };
