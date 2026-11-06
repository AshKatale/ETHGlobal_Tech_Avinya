import {
  createPublicClient, createWalletClient, defineChain, http, keccak256, parseEventLogs, toBytes,
  type Abi, type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from '../env.js';
import { taskEscrowAbi } from './abi.js';

export class ChainError extends Error {}

// viem sees HBAR in weibar (18 decimals) through the JSON-RPC relay. Contracts see tinybar.
export const hederaTestnet = defineChain({
  id: env.HEDERA_CHAIN_ID,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [env.HEDERA_RPC_URL] } },
  blockExplorers: { default: { name: 'HashScan', url: 'https://hashscan.io/testnet' } },
});

export const publicClient = createPublicClient({
  chain: hederaTestnet,
  transport: http(env.HEDERA_RPC_URL, { retryCount: 4, retryDelay: 1500 }),
});

const asKey = (k: string) => (k.startsWith('0x') ? k : `0x${k}`) as Hex;

function relayerAccount() {
  if (!env.RELAYER_PRIVATE_KEY) throw new ChainError('RELAYER_PRIVATE_KEY is not set');
  return privateKeyToAccount(asKey(env.RELAYER_PRIVATE_KEY));
}
function verifierAccount() {
  if (!env.VERIFIER_PRIVATE_KEY) throw new ChainError('VERIFIER_PRIVATE_KEY is not set');
  return privateKeyToAccount(asKey(env.VERIFIER_PRIVATE_KEY));
}

// Hedera needs explicit gas limits. Payouts to addresses that do not exist yet cost ~600k extra (auto-creation).
const GAS = { confirmFunding: 300_000n, addSubLeg: 500_000n, submit: 300_000n, release: 1_200_000n, refund: 1_200_000n, recordPayout: 400_000n, markDefault: 300_000n } as const;

// One relayer wallet means one nonce stream: send transactions strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function send(args: { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; gas: bigint }) {
  return serial(async () => {
    const wallet = createWalletClient({ account: relayerAccount(), chain: hederaTestnet, transport: http(env.HEDERA_RPC_URL, { retryCount: 3, retryDelay: 1500 }) });
    const gasPrice = await publicClient.getGasPrice();
    const hash = await wallet.writeContract({
      address: args.address, abi: args.abi, functionName: args.functionName, args: args.args, gas: args.gas, type: 'legacy', gasPrice,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 2_000 });
    if (receipt.status !== 'success') throw new ChainError(`Transaction reverted: ${hash}`);
    return { hash, receipt };
  });
}

/** bytes32 id used on-chain for an agreement uuid (the same derivation the Solidity agent uses). */
export const agreementIdBytes = (uuid: string): Hex => keccak256(toBytes(uuid));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The public relay sometimes answers a read with a spurious 400/5xx. Reads are safe to repeat. */
async function retryRead<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await wait(1200 * (i + 1)); }
  }
  throw last;
}

export async function readEscrowState(task: Address): Promise<number> {
  return Number(await retryRead(() => publicClient.readContract({ address: task, abi: taskEscrowAbi, functionName: 'state' })));
}

/** On-chain terms and counters: the contract, not the database, is the source of truth for caps. */
export async function readTaskTerms(task: Address) {
  const read = <T>(functionName: string) => retryRead(() => publicClient.readContract({ address: task, abi: taskEscrowAbi, functionName } as never) as Promise<T>);
  // Sequential on purpose: seven parallel calls trip the public relay's rate limit.
  const price = await read<bigint>('price');
  const maxSubBps = await read<number>('maxSubBps');
  const maxSubLegs = await read<number>('maxSubLegs');
  const subTotal = await read<bigint>('subTotal');
  const legCount = await read<bigint>('legCount');
  const payoutGrace = await read<number>('payoutGrace');
  const releasedAt = await read<bigint>('releasedAt');
  return { price, maxSubBps: Number(maxSubBps), maxSubLegs: Number(maxSubLegs), subTotal, subLegCount: Number(legCount) - 1, payoutGrace: Number(payoutGrace), releasedAt: Number(releasedAt) };
}

export const confirmFundingOnChain = (task: Address) =>
  send({ address: task, abi: taskEscrowAbi, functionName: 'confirmFunding', args: [], gas: GAS.confirmFunding });

export const submitOnChain = (task: Address, deliverableHash: Hex) =>
  send({ address: task, abi: taskEscrowAbi, functionName: 'submit', args: [deliverableHash], gas: GAS.submit });

export const releaseOnChain = (task: Address, nonce: bigint, sig: Hex) =>
  send({ address: task, abi: taskEscrowAbi, functionName: 'release', args: [nonce, sig], gas: GAS.release });

export const refundOnChain = (task: Address, nonce: bigint, sig: Hex) =>
  send({ address: task, abi: taskEscrowAbi, functionName: 'refund', args: [nonce, sig], gas: GAS.refund });

export const recordPayoutOnChain = (task: Address, legId: number, hederaTxId: string) =>
  send({ address: task, abi: taskEscrowAbi, functionName: 'recordPayout', args: [BigInt(legId), hederaTxId], gas: GAS.recordPayout });

export const markDefaultOnChain = (task: Address, legId: number) =>
  send({ address: task, abi: taskEscrowAbi, functionName: 'markDefault', args: [BigInt(legId)], gas: GAS.markDefault });

export async function addSubLegOnChain(a: { task: Address; subAgent: Address; priceTinybar: bigint; termsHash: Hex; nonce: bigint; sig: Hex }) {
  const { hash, receipt } = await send({
    address: a.task, abi: taskEscrowAbi, functionName: 'addSubLeg', args: [a.subAgent, a.priceTinybar, a.termsHash, a.nonce, a.sig], gas: GAS.addSubLeg,
  });
  const ev = parseEventLogs({ abi: taskEscrowAbi, logs: receipt.logs, eventName: 'SubLegAdded' })[0];
  if (!ev) throw new ChainError(`SubLegAdded event not found in ${hash}`);
  return { txHash: hash, legId: Number(ev.args.legId) };
}

// ---------- verifier signatures (EIP-712). Domain verifyingContract = the task, so signatures can't cross tasks. ----------
const domain = (task: Address) => ({ name: 'AgentForge', version: '1', chainId: env.HEDERA_CHAIN_ID, verifyingContract: task }) as const;

/** Unique within a task (verdicts and sub-legs share one nonce set). Fits a Postgres bigint. */
export const randomNonce = () => BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));

export async function signVerdict(task: Address, agreementUuid: string, pass: boolean) {
  const nonce = randomNonce();
  const sig = await verifierAccount().signTypedData({
    domain: domain(task),
    types: { Verdict: [{ name: 'agreementId', type: 'bytes32' }, { name: 'result', type: 'uint8' }, { name: 'nonce', type: 'uint256' }] },
    primaryType: 'Verdict',
    message: { agreementId: agreementIdBytes(agreementUuid), result: pass ? 1 : 0, nonce },
  });
  return { sig, nonce };
}

export async function signSubLeg(task: Address, agreementUuid: string, subAgent: Address, priceTinybar: bigint, termsHash: Hex) {
  const nonce = randomNonce();
  const sig = await verifierAccount().signTypedData({
    domain: domain(task),
    types: {
      SubLeg: [
        { name: 'agreementId', type: 'bytes32' }, { name: 'subAgent', type: 'address' }, { name: 'price', type: 'uint256' },
        { name: 'termsHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SubLeg',
    message: { agreementId: agreementIdBytes(agreementUuid), subAgent, price: priceTinybar, termsHash, nonce },
  });
  return { sig, nonce };
}

const sleep = wait;

/**
 * Retry an on-chain operation that may have failed ONLY at the relay (timeout, 5xx) while the transaction actually
 * went through. After each failure we ask the contract whether the effect already happened, so nothing is sent twice.
 */
export async function retryIdempotent<T>(op: () => Promise<T>, alreadyDone: () => Promise<boolean>, tries = 3): Promise<T | 'already'> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await op(); } catch (e) {
      last = e;
      try { if (await alreadyDone()) return 'already'; } catch { /* could not check; retry */ }
      await sleep(3000);
    }
  }
  throw last;
}

export async function readLegStatus(task: Address, legId: number): Promise<number> {
  const r = (await retryRead(() => publicClient.readContract({ address: task, abi: taskEscrowAbi, functionName: 'leg', args: [BigInt(legId)] }))) as readonly [Address, bigint, Hex, number];
  return Number(r[3]);
}
