// Small helpers over the Hedera mirror node REST API.
import { env } from '../env.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(path: string): Promise<any | null> {
  const res = await fetch(env.HEDERA_MIRROR_URL + path, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror node ${res.status} for ${path}`);
  return res.json();
}

/** Resolve an entity with retries: a brand-new account or contract takes a few seconds to show up on the mirror node. */
async function resolve(path: string, pick: (j: any) => string | undefined, label: string, tries = 15): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try { const v = pick(await getJson(path)); if (v) return v; } catch { /* transient, retry */ }
    await sleep(2000);
  }
  throw new Error(`Could not resolve ${label} on the mirror node (does the account exist on Hedera yet?)`);
}

/** EVM address -> Hedera account id (0.0.x). The x402 payTo must be an account id. */
export const accountIdOf = (evm: string) => resolve(`/api/v1/accounts/${evm}`, (j) => j?.account, `account for ${evm}`);

/** EVM address of a contract -> its Hedera entity id (0.0.x), the payTo for funding it over x402. */
export const contractIdOf = (evm: string) => resolve(`/api/v1/contracts/${evm}`, (j) => j?.contract_id, `contract ${evm}`);

/** Native HBAR balance in tinybar, straight from the mirror node. */
export async function balanceTinybar(accountId: string): Promise<bigint> {
  const j = await getJson(`/api/v1/balances?account.id=${accountId}`);
  return BigInt(j?.balances?.[0]?.balance ?? 0);
}
