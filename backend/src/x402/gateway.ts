// x402 gateway. Two payment-gated endpoints, settled in HBAR on Hedera through a facilitator:
//   GET /x402/fund/:agreementId           the client pays the task contract's account (locks the money)
//   GET /x402/settle/:agreementId/:legId  agent A pays sub-agent B after the whole task was released
// An x402 payment is a native account-to-account transfer signed by the payer, so it cannot come out of a contract.
// That is why A pays B itself, here, and why the contract only records the receipt.
import express, { type NextFunction, type Request, type Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { paymentMiddleware } from '@x402/express';
import { decodePaymentResponseHeader } from '@x402/fetch';
import { ExactHederaScheme } from '@x402/hedera/exact/server';
import type { Address } from 'viem';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { EscrowState, LegStatus } from '../chain/abi.js';
import { confirmFundingOnChain, readEscrowState, readLegStatus, recordPayoutOnChain, retryIdempotent } from '../chain/client.js';

const NETWORK = 'hedera:testnet' as const;
const uuid = /^[0-9a-f-]{36}$/i;

const getAgreement = async (id: string) => (await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1))[0];
const getLeg = async (agreementId: string, legId: number) =>
  (await db.select().from(schema.subLegs).where(and(eq(schema.subLegs.agreementId, agreementId), eq(schema.subLegs.legId, legId))).limit(1))[0];

const param = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? '';
const fundIdFromPath = (p: string) => p.split('/')[3];
const settleFromPath = (p: string) => { const s = p.split('/'); return { agreementId: s[3], legId: Number(s[4]) }; };

/** Read the facilitator's settlement result that @x402/express put on the response once the payment settled. */
function settlementOf(res: Response): { success: boolean; transaction: string; payer?: string } | null {
  if (res.statusCode >= 400) return null;
  const header = res.getHeader('payment-response') ?? res.getHeader('x-payment-response');
  if (typeof header !== 'string') return null;
  try { return decodePaymentResponseHeader(header) as { success: boolean; transaction: string; payer?: string }; } catch { return null; }
}

/** After x402 funding settled: confirm it on the contract (balance -> Funded). The indexer then flips the agreement. */
async function afterFund(agreementId: string, hederaTx: string, payer?: string) {
  const a = await getAgreement(agreementId);
  if (!a?.escrowAddress) return;
  // Record the x402 receipt first; the indexer completes this row when it sees the Funded event.
  await db.insert(schema.payments).values({ agreementId, kind: 'fund', amountTinybar: String(a.priceTinybar), hederaTxId: hederaTx, payerAccountId: payer ?? null, status: 'pending' });
  const task = a.escrowAddress as Address;
  try { await retryIdempotent(() => confirmFundingOnChain(task), async () => (await readEscrowState(task)) !== EscrowState.Created, 6); }
  catch (e) { console.error(`[gateway] confirmFunding failed for ${agreementId}: ${(e as Error).message}`); }
}

/** After A paid B over x402: record the receipt (Hedera tx id) on the contract and in the database. */
async function afterPayout(agreementId: string, legId: number, hederaTx: string, payer?: string) {
  const a = await getAgreement(agreementId);
  const leg = await getLeg(agreementId, legId);
  if (!a?.escrowAddress || !leg) return;
  await db.update(schema.subLegs).set({ status: 'paid', payoutTx: hederaTx }).where(and(eq(schema.subLegs.agreementId, agreementId), eq(schema.subLegs.legId, legId)));
  await db.insert(schema.payments).values({ agreementId, kind: 'a2a', amountTinybar: String(leg.priceTinybar), hederaTxId: hederaTx, payerAccountId: payer ?? null, status: 'confirmed' });
  const task = a.escrowAddress as Address;
  try { await retryIdempotent(() => recordPayoutOnChain(task, legId, hederaTx), async () => (await readLegStatus(task, legId)) !== LegStatus.Pending, 4); }
  catch (e) { console.error(`[gateway] recordPayout failed for ${agreementId}/${legId}: ${(e as Error).message}`); }
}

export function buildGateway() {
  const facilitator = new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL });
  const server = new x402ResourceServer(facilitator).register(NETWORK, new ExactHederaScheme());
  const app = express();

  // 1. Validate before any payment is asked for, so a client never pays for something that cannot be fulfilled.
  app.use('/x402/fund/:agreementId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!uuid.test(param(req.params.agreementId))) return res.status(400).json({ error: 'Bad agreement id' });
      const a = await getAgreement(param(req.params.agreementId));
      if (!a) return res.status(404).json({ error: 'Agreement not found' });
      if (!a.escrowAddress || !a.taskAccountId) return res.status(409).json({ error: 'Task contract not deployed yet' });
      if (a.status !== 'agreed') return res.status(409).json({ error: `Agreement is ${a.status}; nothing to fund` });
      if ((await readEscrowState(a.escrowAddress as Address)) !== EscrowState.Created) return res.status(409).json({ error: 'Task contract is already funded' });
      next();
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });
  app.use('/x402/settle/:agreementId/:legId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const legId = Number(param(req.params.legId));
      if (!uuid.test(param(req.params.agreementId)) || !Number.isInteger(legId)) return res.status(400).json({ error: 'Bad id' });
      const a = await getAgreement(param(req.params.agreementId));
      if (!a) return res.status(404).json({ error: 'Agreement not found' });
      if (a.status !== 'released') return res.status(409).json({ error: `Agreement is ${a.status}; sub-agents are paid only after the task is released` });
      const leg = await getLeg(a.id, legId);
      if (!leg) return res.status(404).json({ error: 'Leg not found' });
      if (leg.status !== 'pending') return res.status(409).json({ error: `Leg is already ${leg.status}` });
      next();
    } catch (e) { res.status(500).json({ error: (e as Error).message }); }
  });

  // 2. The payment gate. payTo and price come from the database per request (HBAR: asset 0.0.0, amount in tinybar).
  app.use(
    paymentMiddleware(
      {
        'GET /x402/fund/:agreementId': {
          accepts: {
            scheme: 'exact', network: NETWORK, maxTimeoutSeconds: 120,
            payTo: async (ctx) => (await getAgreement(fundIdFromPath(ctx.path)))!.taskAccountId!,
            price: async (ctx) => ({ amount: String((await getAgreement(fundIdFromPath(ctx.path)))!.priceTinybar), asset: '0.0.0' }),
          },
          description: 'Fund a task contract (locks the client payment)', mimeType: 'application/json',
        },
        'GET /x402/settle/:agreementId/:legId': {
          accepts: {
            scheme: 'exact', network: NETWORK, maxTimeoutSeconds: 120,
            payTo: async (ctx) => { const { agreementId, legId } = settleFromPath(ctx.path); return (await getLeg(agreementId, legId))!.payeeAccountId; },
            price: async (ctx) => { const { agreementId, legId } = settleFromPath(ctx.path); return { amount: String((await getLeg(agreementId, legId))!.priceTinybar), asset: '0.0.0' }; },
          },
          description: 'Agent A pays its sub-agent for one leg of a task', mimeType: 'application/json',
        },
      },
      server,
    ),
  );

  // 3. Handlers run once the payment verified; the follow-up work runs after the response (i.e. after settlement).
  app.get('/x402/fund/:agreementId', (req, res) => {
    const id = param(req.params.agreementId);
    res.on('finish', () => { const s = settlementOf(res); if (s?.success) void afterFund(id, s.transaction, s.payer).catch((e) => console.error('[gateway] afterFund', e)); });
    res.json({ ok: true, agreementId: id, message: 'Payment accepted; the task contract will show Funded once confirmed on-chain.' });
  });
  app.get('/x402/settle/:agreementId/:legId', (req, res) => {
    const { agreementId, legId } = { agreementId: param(req.params.agreementId), legId: Number(param(req.params.legId)) };
    res.on('finish', () => { const s = settlementOf(res); if (s?.success) void afterPayout(agreementId, legId, s.transaction, s.payer).catch((e) => console.error('[gateway] afterPayout', e)); });
    res.json({ ok: true, agreementId, legId, message: 'Payment accepted; the receipt is being recorded on the task contract.' });
  });

  app.get('/x402/health', (_req, res) => res.json({ ok: true, facilitator: env.X402_FACILITATOR_URL, network: NETWORK }));
  return app;
}

export function startGateway() {
  const app = buildGateway();
  return app.listen(env.GATEWAY_PORT, () => console.log(`[gateway] x402 gateway on :${env.GATEWAY_PORT} (facilitator ${env.X402_FACILITATOR_URL})`));
}
