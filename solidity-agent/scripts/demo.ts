// Same job, two providers -> two different contracts. With --deploy, also deploys one TaskEscrow on Hedera testnet.
// Run: npm run demo            (design only)
//      npm run demo -- --deploy (also deploys; spends a little testnet HBAR from the designer wallet)
import { randomUUID } from 'node:crypto';
import { design, type DesignRequest } from '../src/design.js';
import { deployTask } from '../src/deploy.js';

const ONE_HBAR = 100_000_000n;
const requirements =
  'Build a Solidity vesting contract: tokens for 3 beneficiaries unlock linearly over 12 months with a 3-month cliff. ' +
  'The owner can revoke unvested tokens. Include events, access control and a full test suite.';

const base = {
  request: { requirements, budgetTinybar: (20n * ONE_HBAR).toString(), checksRequested: ['secrets_scan'] },
  quotePriceTinybar: (10n * ONE_HBAR).toString(),
};
const providers: Record<string, DesignRequest['agent']> = {
  'NewcomerBot (benchmark 85, no jobs yet)': {
    name: 'NewcomerBot', description: 'Solidity developer agent', capabilities: ['solidity'],
    stats: { benchmarkScore: 85, jobsCompleted: 0, jobsFailed: 0, payoutDefaults: 0, avgDeliveryRatio: null },
  },
  'VeteranBot (benchmark 92, 30 jobs, fast)': {
    name: 'VeteranBot', description: 'Solidity developer agent', capabilities: ['solidity'],
    stats: { benchmarkScore: 92, jobsCompleted: 30, jobsFailed: 1, payoutDefaults: 0, avgDeliveryRatio: 0.8 },
  },
  'FlakyBot (benchmark 92, 30 jobs, skips sub-agent payments)': {
    name: 'FlakyBot', description: 'Solidity developer agent', capabilities: ['solidity'],
    stats: { benchmarkScore: 92, jobsCompleted: 30, jobsFailed: 1, payoutDefaults: 3, avgDeliveryRatio: 1.6 },
  },
};

let last: Awaited<ReturnType<typeof design>> | undefined;
for (const [label, agent] of Object.entries(providers)) {
  const d = await design({ ...base, agent });
  last = d;
  const s = d.spec;
  console.log(`\n### ${label}   [analysis: ${d.source}]`);
  console.log(`trust ${s.trustScore} (${s.trustTier}) | deadline ${s.deadlineHours}h | sub-agent cap ${s.maxSubBps / 100}% | max sub-agents ${s.maxSubLegs} | payout grace ${s.payoutGraceSecs / 3600}h | pass ${s.passThresholdPct}% | checks ${s.checks.join(', ')}`);
}
console.log('\n--- rationale for the last design ---');
last!.spec.rationale.forEach((r) => console.log(' -', r));
if (last!.spec.warnings.length) console.log('warnings:', last!.spec.warnings.join('; '));

if (process.argv.includes('--deploy')) {
  console.log('\n=== deploying the VeteranBot contract to Hedera testnet ===');
  const veteran = await design({ ...base, agent: providers['VeteranBot (benchmark 92, 30 jobs, fast)'] });
  const agreementId = randomUUID();
  const out = await deployTask({
    agreementId,
    client: '0x875fc8473b5507E78d60B52b171124a55e3129FC', // demo client (relayer account)
    agent: '0x2d879491dA59A0F5AA95ef719f3d3c679c08E37F',  // demo agent A (verifier account)
    spec: veteran.spec,
  });
  console.log('agreementId   :', agreementId);
  console.log('task contract :', out.task, out.alreadyExisted ? '(already existed)' : '');
  console.log('deploy tx     :', out.txHash);
  console.log('terms hash    :', out.specHash);
  const again = await deployTask({ agreementId, client: '0x875fc8473b5507E78d60B52b171124a55e3129FC', agent: '0x2d879491dA59A0F5AA95ef719f3d3c679c08E37F', spec: veteran.spec });
  console.log('redeploy is idempotent:', again.alreadyExisted && again.task === out.task);
}
process.exit(0);
