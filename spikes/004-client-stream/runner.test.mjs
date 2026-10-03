import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Local fixtures validate the runner, never stand in for Hermes evidence.
async function run(t, text) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(text);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./check_live.mjs', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => child.kill(), 15000);
  t.after(() => clearTimeout(timer));
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.resume();
  child.stdin.end(JSON.stringify({ base: `http://127.0.0.1:${server.address().port}`, runId: 'fixture-run', token: 'fixture-only' }));
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
  return { code, ...JSON.parse(output) };
}
test('runner does not call an empty stream completed', async t => {
  const result = await run(t, ': open\n\n');
  assert.equal(result.passed, false); assert.equal(result.code, 1);
});
test('runner does not call an interrupted stream completed', async t => {
  const result = await run(t, 'id: 0\ndata: {"seq":0,"run_id":"fixture-run","event":"message.delta"}\n\n');
  assert.equal(result.passed, false); assert.equal(result.code, 1);
});
test('runner recognizes the explicit completed event', async t => {
  const result = await run(t, 'id: 0\ndata: {"seq":0,"run_id":"fixture-run","event":"run.completed"}\n\n');
  assert.equal(result.passed, true); assert.equal(result.code, 0);
});
