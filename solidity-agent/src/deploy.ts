// Deploys a TaskEscrow through the TaskFactory using the agent's OWN wallet (the factory only accepts the designer).
import { createPublicClient, createWalletClient, defineChain, http, keccak256, parseAbi, parseEventLogs, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { env } from './env.js';
import { specHash, type ContractSpec } from './spec.js';

export class DeployError extends Error {}

const factoryAbi = parseAbi([
  'function createTask(bytes32 agreementId, address client, address agent, uint256 price, uint64 deadline, uint16 maxSubBps, uint8 maxSubLegs, uint32 payoutGrace, bytes32 termsHash) returns (address task)',
  'function taskOf(bytes32) view returns (address)',
  'function designer() view returns (address)',
  'event TaskCreated(bytes32 indexed agreementId, address task, address client, address agent, uint256 price, uint64 deadline, uint16 maxSubBps, uint8 maxSubLegs, uint32 payoutGrace, bytes32 termsHash, address designer)',
]);

const chain = defineChain({
  id: env.HEDERA_CHAIN_ID, name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [env.HEDERA_RPC_URL] } },
});
const pub = createPublicClient({ chain, transport: http(env.HEDERA_RPC_URL, { retryCount: 4, retryDelay: 1500 }) });

/** Same id the backend uses on-chain for an agreement uuid. */
export const agreementIdBytes = (uuid: string): Hex => keccak256(toBytes(uuid));

// One wallet = one nonce stream: deploy strictly one at a time.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const run = queue.then(fn, fn); queue = run.catch(() => undefined); return run; };

export function designerAddress(): Address {
  if (!env.DESIGNER_PRIVATE_KEY) throw new DeployError('DESIGNER_PRIVATE_KEY is not set');
  return privateKeyToAccount((env.DESIGNER_PRIVATE_KEY.startsWith('0x') ? env.DESIGNER_PRIVATE_KEY : `0x${env.DESIGNER_PRIVATE_KEY}`) as Hex).address;
}

export type Deployed = { task: Address; txHash: Hex | null; specHash: Hex; deadlineUnix: string; alreadyExisted: boolean };

export async function deployTask(input: { agreementId: string; client: Address; agent: Address; spec: ContractSpec }): Promise<Deployed> {
  if (!env.DESIGNER_PRIVATE_KEY) throw new DeployError('DESIGNER_PRIVATE_KEY is not set');
  if (!env.TASK_FACTORY_ADDRESS) throw new DeployError('TASK_FACTORY_ADDRESS is not set');
  const factory = env.TASK_FACTORY_ADDRESS as Address;
  const id = agreementIdBytes(input.agreementId);
  const hash = specHash(input.spec);

  return serial(async () => {
    // Idempotent: a retry after a timeout must not try to deploy twice.
    const existing = (await pub.readContract({ address: factory, abi: factoryAbi, functionName: 'taskOf', args: [id] })) as Address;
    if (existing !== '0x0000000000000000000000000000000000000000') {
      return { task: existing, txHash: null, specHash: hash, deadlineUnix: '0', alreadyExisted: true };
    }
    const account = privateKeyToAccount((env.DESIGNER_PRIVATE_KEY!.startsWith('0x') ? env.DESIGNER_PRIVATE_KEY! : `0x${env.DESIGNER_PRIVATE_KEY}`) as Hex);
    const wallet = createWalletClient({ account, chain, transport: http(env.HEDERA_RPC_URL, { retryCount: 3, retryDelay: 1500 }) });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + input.spec.deadlineHours * 3600);
    const txHash = await wallet.writeContract({
      address: factory, abi: factoryAbi, functionName: 'createTask',
      args: [id, input.client, input.agent, BigInt(input.spec.priceTinybar), deadline, input.spec.maxSubBps, input.spec.maxSubLegs, input.spec.payoutGraceSecs, hash],
      gas: 4_000_000n, type: 'legacy', gasPrice: await pub.getGasPrice(),
    } as never);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 90_000, pollingInterval: 2000 });
    if (receipt.status !== 'success') throw new DeployError(`createTask reverted: ${txHash}`);
    const created = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName: 'TaskCreated' })[0];
    if (!created) throw new DeployError(`TaskCreated event not found in ${txHash}`);
    return { task: created.args.task, txHash, specHash: hash, deadlineUnix: deadline.toString(), alreadyExisted: false };
  });
}
