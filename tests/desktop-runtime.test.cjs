'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { isSafeExternalUrl, isSameOrigin, waitForHttp, waitForServerProcess } = require('../desktop/runtime.cjs');

test('desktop navigation keeps app pages internal and restricts external protocols', () => {
  assert.equal(isSameOrigin('http://127.0.0.1:3210/library', 'http://127.0.0.1:3210'), true);
  assert.equal(isSameOrigin('https://example.com', 'http://127.0.0.1:3210'), false);
  assert.equal(isSafeExternalUrl('https://doi.org/10.1/test'), true);
  assert.equal(isSafeExternalUrl('mailto:author@example.com'), true);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
});

test('server readiness accepts a healthy local response', async () => {
  await waitForHttp('http://127.0.0.1:3210', 50, async () => ({ status: 200 }));
});

test('readiness rejects redirects and failed responses', async () => {
  for (const status of [302, 404, 500]) {
    await assert.rejects(waitForHttp('http://127.0.0.1:3210', 5, async () => ({ status })));
  }
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('startup waits for an owned child with a split readiness marker', async () => {
  const child = fakeChild();
  const ready = waitForServerProcess(child, 100);
  child.stdout.emit('data', '[vinext] Production server ');
  child.stdout.emit('data', 'running at http://127.0.0.1:43187');
  await ready;
  assert.equal(child.listenerCount('exit'), 0);
  assert.equal(child.stdout.listenerCount('data'), 0);
});

test('startup rejects a child exiting on a port collision', async () => {
  const child = fakeChild();
  const ready = waitForServerProcess(child, 100);
  child.stderr.emit('data', 'Error: listen EADDRINUSE');
  child.emit('exit', 1);
  await assert.rejects(ready, /43187/);
});

test('missing runtime dependency is not misreported as a port collision', async () => {
  const child = fakeChild();
  const ready = waitForServerProcess(child, 100);
  child.stderr.emit('data', "ERR_MODULE_NOT_FOUND: Cannot find package 'vinext'");
  child.emit('exit', 1);
  await assert.rejects(ready, /ERR_MODULE_NOT_FOUND/);
});

test('startup times out and cleans listeners', async () => {
  const child = fakeChild();
  await assert.rejects(waitForServerProcess(child, 5), /超时/);
  assert.equal(child.stdout.listenerCount('data'), 0);
});
