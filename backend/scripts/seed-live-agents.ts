// Lists the live demo agents (live-agents/) on the platform directly: no GitHub, no wallet signature.
//   npm run seed:agents            create what is missing (safe to re-run)
// What it does, per agent in live-agents/roster.json:
//   1. a fresh Hedera testnet payout account created and funded by RELAYER_PRIVATE_KEY's account (the Developer gets more: it pays its sub-agents)
//   2. an agent row: status 'listed', is_seeded = true, endpoint http://localhost:<port>, NO benchmark run (shown as not benchmarked)
//   3. live-agents/agents.json with each agent's API key and payout key (gitignored)
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { AccountCreateTransaction, Client, Hbar, PrivateKey } from '@hiero-ledger/sdk';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { db, schema } from '../src/db/index.js';
import { newToken, sha256 } from '../src/lib/auth.js';
import { accountIdOf, balanceTinybar } from '../src/chain/mirror.js';

type Meta = { slug: string; port: number; name: string; priceTinybar: string; capabilities: string[]; description: string };
const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const roster: Meta[] = JSON.parse(readFileSync(path('../../live-agents/roster.json'), 'utf8'));
const STATE = path('../../live-agents/agents.json');
type Saved = { agentId: string; apiKey: string; accountId: string; payoutKey: string };
const state: Record<string, Saved> = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};

const funderKey = process.env.RELAYER_PRIVATE_KEY;
if (!funderKey) throw new Error('RELAYER_PRIVATE_KEY missing in backend/.env (a testnet-only account that funds the agents)');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Testnet nodes time out now and then: retry the whole step. */
async function retry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 5) throw e;
      console.log(`  ${label}: ${(e as Error).message.split('\n')[0]} (retry ${i}/4)`);
      await sleep(3000 * i);
    }
  }
}

// The funding account pays for account creation. Its Hedera id is looked up from its EVM address on the mirror node.
const funderEvm = privateKeyToAccount(`0x${funderKey.replace(/^0x/, '')}`).address;
const client = Client.forTestnet().setOperator(await accountIdOf(funderEvm), PrivateKey.fromStringECDSA(funderKey.replace(/^0x/, '')));

/** A real Hedera account whose alias is the key's EVM address (so payoutAddress and the account id match), funded with `hbar`. */
const createAccount = (key: PrivateKey, hbar: number) => retry('creating account', async () => {
  const tx = await new AccountCreateTransaction().setECDSAKeyWithAlias(key).setInitialBalance(new Hbar(hbar)).execute(client);
  return (await tx.getReceipt(client)).accountId!.toString();
});

// The platform-owned user that "owns" these agents.
const OWNER_NAME = 'Gigiverse live agents';
let ownerId = (await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.displayName, OWNER_NAME)).limit(1))[0]?.id;
if (!ownerId) {
  const addr = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
  [{ id: ownerId }] = await db.insert(schema.users).values({ address: addr, displayName: OWNER_NAME }).returning({ id: schema.users.id });
  console.log(`created owner user ${addr}`);
}

for (const m of roster) {
  const existing = state[m.slug];
  if (existing) {
    const [row] = await db.select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.id, existing.agentId)).limit(1);
    if (row) {
      await db.update(schema.agents).set({ status: 'listed', endpointUrl: `http://localhost:${m.port}`, priceTinybar: m.priceTinybar, name: m.name, description: m.description, capabilities: m.capabilities }).where(eq(schema.agents.id, row.id));
      console.log(`  ${m.slug}: already created, refreshed and listed`);
      continue;
    }
  }
  const payoutKey = generatePrivateKey();
  const wallet = privateKeyToAccount(payoutKey);
  // The Developer gets more HBAR because it pays its sub-agents; the others only receive.
  const accountId = await createAccount(PrivateKey.fromStringECDSA(payoutKey.slice(2)), m.slug === 'solidity-dev' ? 5 : 1);
  const apiKey = `afk_${newToken(24)}`;
  const [agent] = await db.insert(schema.agents).values({
    ownerUserId: ownerId!, name: m.name, description: m.description, capabilities: m.capabilities,
    endpointUrl: `http://localhost:${m.port}`, payoutAddress: wallet.address.toLowerCase(), hederaAccountId: accountId,
    priceTinybar: m.priceTinybar, apiKeyHash: sha256(apiKey), status: 'listed', isSeeded: true,
  }).returning({ id: schema.agents.id });
  state[m.slug] = { agentId: agent.id, apiKey, accountId, payoutKey };
  writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 }); // write after each agent so a failure never loses a key
  console.log(`  ${m.slug}: listed as ${agent.id}, payout ${accountId} (${(Number(await balanceTinybar(accountId)) / 1e8).toFixed(2)} HBAR)`);
}
console.log(`\nDone. Keys saved to live-agents/agents.json. Start the agents: cd live-agents && npm run all`);
client.close();
process.exit(0);
