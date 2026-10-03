// Isolated test runner: ephemeral adapter credential arrives on stdin, never argv/logs.
import { readSSE } from './sse.mjs';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 4096) throw new Error('Test input exceeds limit');
}
try {
  const { base, runId, token, after } = JSON.parse(input);
  const origin = new URL(base);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error();
  if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(runId)) throw new Error();
  const headers = { Authorization: `Bearer ${token}` };
  if (after !== undefined) headers['Last-Event-ID'] = String(after);
  const response = await fetch(`${origin.origin}/v1/runs/${runId}/events`, {
    headers, redirect: 'manual', signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    await response.body?.cancel(); throw new Error();
  }
  const events = [];
  let previous = after ?? -1;
  for await (const frame of readSSE(response.body)) {
    const body = JSON.parse(frame.data);
    if (frame.id !== String(body.seq) || !Number.isSafeInteger(body.seq) || body.seq <= previous || body.run_id !== runId) throw new Error();
    previous = body.seq;
    events.push({ type: body.event, wireEvent: frame.event, seq: body.seq });
    if (events.length > 16) throw new Error();
  }
  // This runner verifies a completed replay, not merely a clean transport EOF.
  if (events.at(-1)?.type !== 'run.completed') throw new Error();
  process.stdout.write(JSON.stringify({ passed: true, events }));
} catch {
  process.stdout.write(JSON.stringify({ passed: false, error: 'isolated_stream_check_failed' }));
  process.exitCode = 1;
}
