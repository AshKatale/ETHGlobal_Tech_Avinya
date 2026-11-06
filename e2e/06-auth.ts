// Test 6: auth. Each protected route rejects missing/wrong session and wrong agent key; settle rejects a stranger. No chain tx.
import { startBackend, login, makeListedAgent, sqlAgreement, http2, record, q, closeDb, log, ok } from './lib.ts';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const be = await startBackend();
const fails: string[] = []; let n = 0;
const expect = async (label: string, p: Promise<{ status: number; json: any }>, want: number) => {
  const r = await p; n++;
  const good = r.status === want; if (!good) fails.push(`${label}: got ${r.status} want ${want} ${JSON.stringify(r.json).slice(0, 100)}`);
  log(`${good ? 'ok  ' : 'BAD '} ${label} -> ${r.status} (want ${want})`);
};
try {
  const client = await login(); const stranger = await login(); const lister = await login();
  const A = await makeListedAgent(lister.token, 'auth agent A', 100n, null, ['qa']);
  const B = await makeListedAgent(stranger.token, 'auth agent B', 100n, null, ['qa']);
  const ag = await sqlAgreement(client.userId, A.agent.id, 'funded');
  const id = ag.agreementId; const uuid = '00000000-0000-4000-8000-000000000000';
  const bearer = (t?: string) => ({ token: t });
  // 401: no / bad session on every user route
  const userRoutes: [string, string, unknown?][] = [
    ['GET', '/me'], ['GET', '/agents/mine'], ['GET', '/agreements'], ['POST', '/agents', {}], ['POST', '/requests', {}],
    ['POST', `/agents/${A.agent.id}/benchmark`, {}], ['POST', `/quotes/${ag.quoteId}/accept`], ['POST', `/agreements/${id}/escrow`],
    ['POST', `/agreements/${id}/verify`], ['POST', `/agreements/${id}/settle`], ['POST', `/agreements/${id}/dispatch`],
  ];
  for (const [m, p, b] of userRoutes) {
    await expect(`${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')} no session`, http2(m, p, { body: b }), 401);
    await expect(`${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')} bad session`, http2(m, p, { ...bearer('deadbeef'), body: b }), 401);
  }
  // 401: agent routes with missing / wrong key / user token instead of key
  const agentRoutes: [string, unknown][] = [
    [`/agreements/${id}/submit`, { content: 'x' }], ['/a2a/quote', { agreementId: id, calleeAgentId: B.agent.id }], ['/a2a/call', { callId: uuid, input: {} }],
  ];
  for (const [p, b] of agentRoutes) {
    const name = p.replace(/[0-9a-f-]{36}/g, ':id');
    await expect(`POST ${name} no key`, http2('POST', p, { body: b }), 401);
    await expect(`POST ${name} wrong key`, http2('POST', p, { agentKey: 'afk_wrong', body: b }), 401);
    await expect(`POST ${name} user bearer only`, http2('POST', p, { token: client.token, body: b }), 401);
  }
  await expect('POST /requests/:id/quotes no auth', http2('POST', `/requests/${ag.requestId}/quotes`, { body: { priceTinybar: '1' } }), 401);
  // 403 / 404: authenticated as the wrong party
  await expect('submit by other agent (B) -> 403', http2('POST', `/agreements/${id}/submit`, { agentKey: B.apiKey, body: { content: 'x' } }), 403);
  await expect('a2a/quote by non-agreement agent (B) -> 400', http2('POST', '/a2a/quote', { agentKey: B.apiKey, body: { agreementId: id, calleeAgentId: A.agent.id } }), 400);
  await expect('a2a/call unknown callId -> 404', http2('POST', '/a2a/call', { agentKey: B.apiKey, body: { callId: uuid, input: {} } }), 404);
  await expect('stranger accept quote -> 403', http2('POST', `/quotes/${ag.quoteId}/accept`, { token: stranger.token }), 403);
  await expect('stranger escrow -> 403', http2('POST', `/agreements/${id}/escrow`, { token: stranger.token }), 403);
  await expect('stranger verify -> 403', http2('POST', `/agreements/${id}/verify`, { token: stranger.token }), 403);
  await expect('stranger settle -> 403', http2('POST', `/agreements/${id}/settle`, { token: stranger.token }), 403);
  await expect('stranger dispatch -> 403', http2('POST', `/agreements/${id}/dispatch`, { token: stranger.token }), 403);
  await expect('stranger benchmark of A -> 403', http2('POST', `/agents/${A.agent.id}/benchmark`, { token: stranger.token, body: { repoUrl: 'https://github.com/a/b' } }), 403);
  await expect('stranger quote as lister A via bearer -> 403', http2('POST', `/requests/${ag.requestId}/quotes`, { token: stranger.token, body: { agentId: A.agent.id, priceTinybar: '1' } }), 403);
  // quote on a non-open request is 409, but auth precedes: just check owner passes auth on settle (reaches chain layer -> 502 no escrow)
  await expect('agent owner settle -> passes auth (502 no escrow)', http2('POST', `/agreements/${id}/settle`, { token: lister.token }), 502);
  await expect('client settle -> passes auth (502 no escrow)', http2('POST', `/agreements/${id}/settle`, { token: client.token }), 502);
  // login: bad signature + nonce replay
  const acct = privateKeyToAccount(generatePrivateKey());
  const nn = await ok('POST', '/auth/nonce', { body: { address: acct.address } });
  const other = privateKeyToAccount(generatePrivateKey());
  await expect('verify with signature from another key -> 401', http2('POST', '/auth/verify', { body: { address: acct.address, nonce: nn.nonce, signature: await other.signMessage({ message: nn.message }) } }), 401);
  const good = await acct.signMessage({ message: nn.message });
  await expect('verify good signature -> 200', http2('POST', '/auth/verify', { body: { address: acct.address, nonce: nn.nonce, signature: good } }), 200);
  await expect('replay same nonce -> 400', http2('POST', '/auth/verify', { body: { address: acct.address, nonce: nn.nonce, signature: good } }), 400);
  record('Auth: protected routes reject missing/wrong session, wrong agent key; settle rejects stranger', fails.length ? 'FAIL' : 'PASS', `${n - fails.length}/${n} assertions as expected; agreement ${id}; ${fails.join(' | ')}`);
  await q("update agents set status='draft' where name like '[qa] auth agent%'"); // keep test agents out of public listing
} catch (e) { record('Auth', 'FAIL', `script error: ${(e as Error).message}`); }
finally { await be.stop(); await closeDb(); process.exit(0); }
