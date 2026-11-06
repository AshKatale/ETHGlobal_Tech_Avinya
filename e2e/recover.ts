// Recovery helper for a run that was killed mid-verification: reset a [qa] agreement stuck in 'verifying' to 'submitted' (test setup only), then use the product's own retry route.
import { startBackend, q, http2, closeDb, evidence, checkTxs, waitFor, ok, record, escrowState } from './lib.ts';
const id = process.argv[2];
const be = await startBackend();
try {
  const [a] = await q('select client_user_id,status,escrow_address from agreements where id=$1', [id]);
  console.log('before', a.status, 'escrow state', await escrowState(a.escrow_address));
  if (a.status === 'verifying') await q("update agreements set status='submitted' where id=$1 and status='verifying'", [id]);
  const tok = 'qa' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  await q("insert into sessions (id,user_id,expires_at) values ($1,$2, now() + interval '1 hour')", [tok, a.client_user_id]);
  console.log('verify', (await http2('POST', `/agreements/${id}/verify`, { token: tok })).status);
  const fin: any = await waitFor('settled', async () => { const r = await ok('GET', `/agreements/${id}`); return ['released', 'refunded'].includes(r.agreement.status) ? r : null; }, 80, 4000);
  const ev = await evidence(id);
  console.log(JSON.stringify({ status: fin.agreement.status, verdict: ev.verdict, vers: ev.vers.map((v: any) => v.result + ':' + (v.error ?? '').slice(0, 60)), payments: ev.payments, txs: await checkTxs([ev.verdict?.settle_tx_hash, ...ev.payments.map((p: any) => p.tx_hash)]) }, null, 1));
  await q('delete from sessions where id=$1', [tok]);
} catch (e) { console.log('recover error', (e as Error).message.slice(0, 300)); }
finally { await be.stop(); await closeDb(); process.exit(0); }
