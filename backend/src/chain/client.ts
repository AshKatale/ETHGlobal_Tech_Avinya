import {
  createPublicClient, createWalletClient, defineChain, http, keccak256, parseEventLogs, toBytes,
  type Address, type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from '../env.js';
import { escrowAbi, factoryAbi } from './abi.js';
import { recordSignature } from '../lib/signatureAudit.js';

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
function factoryAddress(): Address {
  if (!env.FACTORY_ADDRESS) throw new ChainError('FACTORY_ADDRESS is not set');
  return env.FACTORY_ADDRESS as Address;
}

// Gas limits (Hedera needs them explicit; estimates through the relay can be unreliable).
// Paying an address that does not exist on Hedera yet auto-creates it, which costs ~600k gas on top of the call.
// So the payout calls get a generous limit; unused gas is not charged.
const GAS = { createEscrow: 2_500_000n, submit: 250_000n, release: 1_200_000n, refund: 1_200_000n, delegate: 1_200_000n } as const;

// One relayer wallet means one nonce stream: send transactions strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function send(args: {
  address: Address; abi: typeof factoryAbi | typeof escrowAbi; functionName: string; args: readonly unknown[]; gas: bigint;
}) {
  return serial(async () => {
    const account = relayerAccount();
    const wallet = createWalletClient({ account, chain: hederaTestnet, transport: http(env.HEDERA_RPC_URL, { retryCount: 3, retryDelay: 1500 }) });
    const gasPrice = await publicClient.getGasPrice();
    const hash = await wallet.writeContract({
      address: args.address, abi: args.abi as never, functionName: args.functionName as never,
      args: args.args as never, gas: args.gas, type: 'legacy', gasPrice,
    } as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 2_000 });
    if (receipt.status !== 'success') throw new ChainError(`Transaction reverted: ${hash}`);
    return { hash, receipt };
  });
}

/** bytes32 id used on-chain for an agreement uuid. */
export const agreementIdBytes = (uuid: string): Hex => keccak256(toBytes(uuid));

export async function createEscrowOnChain(a: {
  agreementId: string; client: Address; agent: Address; priceTinybar: bigint; deadlineUnix: bigint;
}) {
  const { hash, receipt } = await send({
    address: factoryAddress(), abi: factoryAbi, functionName: 'createEscrow',
    args: [agreementIdBytes(a.agreementId), a.client, a.agent, a.priceTinybar, a.deadlineUnix], gas: GAS.createEscrow,
  });
  const created = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: 'EscrowCreated' })[0];
  const escrow = created?.args.escrow ?? (await publicClient.readContract({
    address: factoryAddress(), abi: factoryAbi, functionName: 'escrowOf', args: [agreementIdBytes(a.agreementId)],
  }));
  return { escrow: (escrow as string).toLowerCase(), txHash: hash };
}

export async function readEscrowState(escrow: Address): Promise<number> {
  return Number(await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: 'state' }));
}

export const submitOnChain = (escrow: Address, deliverableHash: Hex) =>
  send({ address: escrow, abi: escrowAbi, functionName: 'submit', args: [deliverableHash], gas: GAS.submit });

export const releaseOnChain = (escrow: Address, nonce: bigint, sig: Hex) =>
  send({ address: escrow, abi: escrowAbi, functionName: 'release', args: [nonce, sig], gas: GAS.release });

export const refundOnChain = (escrow: Address, nonce: bigint, sig: Hex) =>
  send({ address: escrow, abi: escrowAbi, functionName: 'refund', args: [nonce, sig], gas: GAS.refund });

export const delegateOnChain = (escrow: Address, subAgent: Address, amount: bigint, nonce: bigint, sig: Hex) =>
  send({ address: escrow, abi: escrowAbi, functionName: 'delegate', args: [subAgent, amount, nonce, sig], gas: GAS.delegate });

// ---------- verifier signatures (EIP-712). Domain verifyingContract = the escrow, so signatures can't cross escrows. ----------
const domain = (escrow: Address) => ({ name: 'AgentForge', version: '1', chainId: env.HEDERA_CHAIN_ID, verifyingContract: escrow }) as const;

/** Unique across verdicts and delegations of one escrow (the contract shares one nonce set). Fits Postgres bigint. */
export const randomNonce = () => BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));

export async function signVerdict(escrow: Address, agreementUuid: string, pass: boolean) {
  const nonce = randomNonce();
  const account = verifierAccount();
  const sig = await account.signTypedData({
    domain: domain(escrow),
    types: { Verdict: [{ name: 'agreementId', type: 'bytes32' }, { name: 'result', type: 'uint8' }, { name: 'nonce', type: 'uint256' }] },
    primaryType: 'Verdict',
    message: { agreementId: agreementIdBytes(agreementUuid), result: pass ? 1 : 0, nonce },
  });
  // Audit before the signature leaves this module: if the log cannot be written, no signature is released.
  await recordSignature({ kind: 'verdict', agreementId: agreementUuid, escrow, signer: account.address, nonce, resultOrAmount: pass ? 'PASS' : 'FAIL', sig });
  return { sig, nonce };
}

export async function signDelegation(escrow: Address, agreementUuid: string, subAgent: Address, amount: bigint) {
  const nonce = randomNonce();
  const account = verifierAccount();
  const sig = await account.signTypedData({
    domain: domain(escrow),
    types: {
      Delegation: [
        { name: 'agreementId', type: 'bytes32' }, { name: 'subAgent', type: 'address' },
        { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'Delegation',
    message: { agreementId: agreementIdBytes(agreementUuid), subAgent, amount, nonce },
  });
  await recordSignature({ kind: 'delegation', agreementId: agreementUuid, escrow, signer: account.address, nonce, resultOrAmount: amount.toString(), sig });
  return { sig, nonce };
}
