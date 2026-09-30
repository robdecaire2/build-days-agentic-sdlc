// Smoke test for a running incident handoff board: BASE_URL=http://127.0.0.1:3000 node scripts/smoke.mjs
const base = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const timeoutMs = Number(process.env.SMOKE_WAIT_SECONDS ?? 60) * 1000;

function fail(message) {
  console.error(`SMOKE FAILED: ${message}`);
  process.exit(1);
}

async function call(path, options) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON bodies are reported by the caller's status assertions.
  }
  return { status: response.status, json, text };
}

async function waitFor(path) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const result = await call(path);
      if (result.status === 200) return result;
      last = `HTTP ${result.status} ${result.text.slice(0, 200)}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return fail(`${path} was not 200 within ${timeoutMs / 1000}s (last: ${last})`);
}

await waitFor('/health');
const ready = await waitFor('/ready');
if (ready.json?.checks?.storage !== 'ok') fail(`/ready did not report storage ok: ${ready.text}`);
console.log('health and readiness ok');

const marker = `smoke-${Date.now()}`;
const created = await call('/api/handoffs', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ service: marker, summary: 'Smoke test handoff', nextAction: 'Acknowledge it' }),
});
if (created.status !== 201 || created.json?.state !== 'open') fail(`create returned ${created.status}: ${created.text}`);
const { id } = created.json;

const listed = await call('/api/handoffs');
if (!listed.json?.handoffs?.some((h) => h.id === id)) fail('created handoff missing from list');

const acknowledged = await call(`/api/handoffs/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
if (acknowledged.status !== 200 || acknowledged.json?.state !== 'acknowledged' || !acknowledged.json?.acknowledgedAt) {
  fail(`acknowledge returned ${acknowledged.status}: ${acknowledged.text}`);
}

const after = (await call('/api/handoffs')).json?.handoffs?.find((h) => h.id === id);
if (after?.state !== 'acknowledged') fail('acknowledged state not visible in list');

console.log(`create-to-acknowledge ok (handoff ${id}) against ${base}`);
