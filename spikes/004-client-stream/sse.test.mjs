import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('./sse.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
async function* chunks(text) {
  const bytes = new TextEncoder().encode(text);
  // Every byte split stresses UTF-8 and line boundaries.
  for (const byte of bytes) yield Uint8Array.of(byte);
}
async function collect(text) {
  assert.equal(typeof module.readSSE, 'function', 'Streaming reader must exist');
  const result = [];
  for await (const frame of module.readSSE(chunks(text))) result.push(frame);
  return result;
}
test('preserves named events and cursor across byte and UTF-8 boundaries', async () => {
  assert.deepEqual(await collect(': open\r\n\r\nid: 0\r\nevent: message.delta\r\ndata: {"delta":"été"}\r\n\r\n'), [
    { event: 'message.delta', id: '0', data: '{"delta":"été"}' },
  ]);
});
test('bounds frames and aborts without exposing remote content', async () => {
  await assert.rejects(async () => {
    for await (const frame of module.readSSE(chunks('data: PRIVATE_REMOTE_CONTENT\n\n'), { maxFrameChars: 8 })) void frame;
  }, error => error.code === 'frame_too_large' && !error.message.includes('PRIVATE'));
});
test('multiline data, comment-only frame and unterminated EOF', async () => {
  assert.deepEqual(await collect('id: 3\n: keepalive\n\ndata: a\ndata:  b\n\nid: 4\ndata: partial\n'), [
    { event: 'message', id: '3', data: 'a\n b' },
  ]);
});
test('supports CR-only boundaries', async () => {
  assert.deepEqual(await collect('event: done\rdata: ok\r\r'), [{ event: 'done', id: '', data: 'ok' }]);
});
test('BOM, empty data and reset ids have stable semantics', async () => {
  assert.deepEqual(await collect('\uFEFFid: 3\ndata:\n\nid: bad\0value\ndata: x\n\nid:\ndata: y\n\n'), [
    { event: 'message', id: '3', data: '' },
    { event: 'message', id: '3', data: 'x' },
    { event: 'message', id: '', data: 'y' },
  ]);
});
test('closes the input iterator when consumer stops', async () => {
  let closed = false;
  async function* source() {
    try { yield new TextEncoder().encode('data: ok\n\n'); yield Uint8Array.of(10); }
    finally { closed = true; }
  }
  for await (const frame of module.readSSE(source())) { assert.equal(frame.data, 'ok'); break; }
  assert.equal(closed, true);
});
test('closes the input iterator on bound or UTF-8 failure', async () => {
  for (const bytes of [new TextEncoder().encode('data: too-large\n\n'), Uint8Array.of(255)]) {
    let closed = false;
    async function* source() { try { yield bytes; } finally { closed = true; } }
    await assert.rejects(async () => {
      for await (const frame of module.readSSE(source(), { maxFrameChars: 8 })) void frame;
    });
    assert.equal(closed, true);
  }
});
test('rejects malformed UTF-8', async () => {
  await assert.rejects(async () => {
    for await (const frame of module.readSSE([Uint8Array.of(195)])) void frame;
  }, TypeError);
});
test('rejects invalid limits before reading bytes', async () => {
  for (const maxFrameChars of [0, -1, NaN, Infinity, '4', 1048577]) {
    let consumed = false;
    async function* source() { consumed = true; yield Uint8Array.of(10); }
    await assert.rejects(async () => {
      for await (const frame of module.readSSE(source(), { maxFrameChars })) void frame;
    }, error => error.code === 'invalid_options');
    assert.equal(consumed, false);
  }
});
