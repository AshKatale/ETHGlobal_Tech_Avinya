// TEST INFRASTRUCTURE ONLY. Hashio answers in 7-25 s at times (and sometimes with an HTML 502/504 page), while the backend's viem client
// times out at 10 s. This proxy (port 4020) hides that latency so the product logic can be tested:
//  - read methods: hedged (a new upstream attempt every 3 s, up to 5), first well-formed JSON-RPC answer wins;
//  - eth_sendRawTransaction: replies at once with keccak256(raw) (the tx hash is deterministic) and re-sends the SAME raw tx upstream in the
//    background until Hashio accepts it (identical raw tx => identical hash => cannot double-spend; nonce makes it idempotent).
import { createServer } from 'node:http';
import { keccak256 } from '/Users/sandeshsonabakhilari/Desktop/eth-global/ETHGlobal_Tech_Avinya/backend/node_modules/viem/_esm/index.js';
const UP = 'https://testnet.hashio.io/api';
const post = async (body, ms = 20000) => {
  try {
    const r = await fetch(UP, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    const t = await r.text(); const j = JSON.parse(t); return j && j.jsonrpc ? j : null;
  } catch { return null; }
};
const hedged = (body) => new Promise((resolve) => {
  let done = false, n = 0;
  const fire = () => { n++; post(body).then((j) => { if (j && !done) { done = true; resolve(j); } else if (!done && n >= 5 && !pending()) resolve(null); }); };
  let fired = 0; const pending = () => fired < 5;
  const iv = setInterval(() => { if (done || fired >= 5) return clearInterval(iv); fired++; fire(); }, 3000); fired++; fire();
  setTimeout(() => { if (!done) { done = true; resolve(null); } }, 60000);
});
const sendBg = async (body) => {
  for (let i = 0; i < 12; i++) {
    const j = await post(body, 30000);
    if (j) { console.log('send result', body.params[0].slice(0, 12), JSON.stringify(j.error ?? j.result).slice(0, 100)); if (!j.error || /already known|nonce too low|ALREADY/i.test(j.error.message)) return; }
    await new Promise((r) => setTimeout(r, 5000));
  }
};
createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', async () => {
    res.setHeader('content-type', 'application/json');
    let body; try { body = JSON.parse(b); } catch { res.statusCode = 400; return res.end('{}'); }
    if (body.method === 'eth_sendRawTransaction') {
      void sendBg(body);
      return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: keccak256(body.params[0]) }));
    }
    let j = await hedged(body);
    // a hash we answered for but upstream has not seen yet: report 'not found' (null) instead of an error so clients keep polling
    if (j && j.error && /getTransactionReceipt|getTransactionByHash/.test(body.method)) j = { jsonrpc: '2.0', id: body.id, result: null };
    res.end(JSON.stringify(j ?? { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'proxy: upstream unavailable' } }));
  });
}).listen(4020, () => console.log('rpc proxy on 4020'));
