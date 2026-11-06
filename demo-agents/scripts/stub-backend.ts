// Local stub of the backend routes the demo agents use (docs/contracts/api.md). For testing only; no chain, no DB.
// Mirrors the A2A budget rule: paid calls may not exceed A2A_MAX_PERCENT of the job price.
import { createServer } from 'node:http';

const PORT = Number(process.env.STUB_PORT ?? 4000);
const MAX_PCT = BigInt(process.env.A2A_MAX_PERCENT ?? 30);
const JOB_PRICE = BigInt(process.env.STUB_JOB_PRICE ?? '1000000000');
const AUDITOR_URL = process.env.STATIC_AUDITOR_URL ?? 'http://localhost:4102';
const AUDITOR_PRICE = process.env.STATIC_AUDITOR_PRICE_TINYBAR ?? '200000000';
const AUDITOR_ID = '11111111-1111-4111-8111-111111111111';

type Call = { id: string; agreementId: string; priceTinybar: string; status: string; blockedReason: string | null };
const calls: Call[] = [];
const submissions: { agreementId: string; content: string }[] = [];
let n = 0;

const send = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let body: any = {};
  if (req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* ignore */ }
  }
  if (req.method === 'POST' && url.pathname === '/auth/nonce') return send(res, 200, { nonce: 'n1', message: `AgentForge login\nAddress: ${String(body.address).toLowerCase()}\nNonce: n1` });
  if (req.method === 'POST' && url.pathname === '/auth/verify') return body.signature ? send(res, 200, { token: 'stub-token', user: { id: 'u1' } }) : send(res, 401, { error: 'Bad signature' });
  if (req.method === 'POST' && url.pathname === '/agents') return req.headers.authorization === 'Bearer stub-token' ? send(res, 201, { agent: { id: crypto.randomUUID(), status: 'draft', ...body }, apiKey: 'afk_stub' }) : send(res, 401, { error: 'Missing bearer token' });
  if (req.method === 'POST' && !req.headers['x-agent-key']) return send(res, 401, { error: 'Missing x-agent-key' });

  if (req.method === 'GET' && url.pathname === '/agents') return send(res, 200, [{ id: AUDITOR_ID, name: 'Static Auditor', capabilities: ['static-audit'], priceTinybar: AUDITOR_PRICE }]);
  if (req.method === 'GET' && url.pathname === '/_state') return send(res, 200, { calls, submissions });

  if (req.method === 'POST' && url.pathname === '/a2a/quote') {
    const spent = calls.filter((c) => c.status === 'paid' || c.status === 'done').reduce((s, c) => s + BigInt(c.priceTinybar), 0n);
    const over = (spent + BigInt(AUDITOR_PRICE)) * 100n > JOB_PRICE * MAX_PCT;
    const call: Call = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, agreementId: body.agreementId, priceTinybar: AUDITOR_PRICE, status: over ? 'blocked' : 'quoted', blockedReason: over ? `Would exceed the ${MAX_PCT}% A2A budget for this job` : null };
    calls.push(call);
    return over ? send(res, 403, { allowed: false, reason: call.blockedReason, callId: call.id }) : send(res, 200, { allowed: true, callId: call.id, priceTinybar: AUDITOR_PRICE, remainingBudgetTinybar: '0' });
  }
  if (req.method === 'POST' && url.pathname === '/a2a/call') {
    const call = calls.find((c) => c.id === body.callId);
    if (!call || call.status !== 'quoted') return send(res, 409, { error: 'Call not quoted' });
    call.status = 'paid';
    const r = await fetch(`${AUDITOR_URL}/a2a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agreementId: call.agreementId, callId: call.id, input: body.input }) });
    const text = await r.text();
    if (!r.ok) { call.status = 'failed'; return send(res, 502, { error: `Callee failed: ${text.slice(0, 200)}` }); }
    call.status = 'done';
    return send(res, 200, { status: 'done', output: JSON.parse(text) });
  }
  const m = url.pathname.match(/^\/agreements\/([^/]+)\/submit$/);
  if (req.method === 'POST' && m) {
    submissions.push({ agreementId: m[1], content: body.content });
    return send(res, 202, { status: 'submitted', verification: 'started' });
  }
  send(res, 404, { error: 'Not found' });
}).listen(PORT, () => console.log(`stub backend on ${PORT}`));
