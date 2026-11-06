// Read-only mirror node evidence: factory-created escrows and Released/Refunded logs.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { keccak256, toHex } = require('viem');
const M = 'https://testnet.mirrornode.hedera.com/api/v1';
const F = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../contracts/deployments.json', import.meta.url))).hederaTestnet.AgreementFactory;
const sig = (s) => keccak256(toHex(s));
const T = { EscrowCreated: sig('EscrowCreated(bytes32,address,address,address,uint256)'), Funded: sig('Funded(bytes32,address,uint256)'),
  Submitted: sig('Submitted(bytes32,bytes32)'), Released: sig('Released(bytes32,address,uint256)'), Refunded: sig('Refunded(bytes32,address,uint256)') };
const j = (p) => fetch(M + p).then((r) => r.json());
const fl = await j(`/contracts/${F}/results/logs?order=asc&limit=25`);
const created = fl.logs.filter((l) => l.topics[0] === T.EscrowCreated);
console.log('factory logs', fl.logs.length, 'EscrowCreated', created.length);
for (const l of created) {
  const escrow = '0x' + l.data.slice(26, 66);
  const c = await j(`/contracts/${escrow}`);
  const el = await j(`/contracts/${escrow}/results/logs?order=asc&limit=25`);
  const names = el.logs.map((x) => Object.keys(T).find((k) => T[k] === x.topics[0]) ?? 'other');
  const rr = el.logs.filter((x) => [T.Released, T.Refunded].includes(x.topics[0])).map((x) => x.transaction_hash);
  console.log({ factoryCreateTx: l.transaction_hash, escrow, escrowContractId: c.contract_id, hasBytecode: !!c.bytecode && c.bytecode.length > 10, events: names, releasedRefundedTx: rr });
}
