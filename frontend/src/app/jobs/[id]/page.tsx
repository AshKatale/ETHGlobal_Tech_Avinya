'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { api, apiErrorText } from '@/lib/api';
import { CHAIN_ID, FAUCET_URL } from '@/lib/config';
import { taskEscrowAbi, FUND_GAS } from '@/lib/escrow';
import { ago, errMessage, shortAddr } from '@/lib/format';
import { contractUrl, shortTx, txUrl } from '@/lib/hashscan';
import { fmtHbar, fromWeibar, toWeibar } from '@/lib/money';
import { useDesign, useMe } from '@/lib/queries';
import { CHECKS, type AgreementDetail, type AgreementStatus, type FundingInfo, type VerificationDetail } from '@/lib/types';
import { useSession } from '@/providers/Session';
import { useToast } from '@/providers/Toasts';
import ContractDesign, { SubContracts } from '@/components/ContractDesign';
import Notice, { Empty } from '@/components/Notice';
import StatusChip from '@/components/StatusChip';
import { Icon } from '@/components/Icon';

const FINAL: AgreementStatus[] = ['released', 'refunded'];
const ORDER: AgreementStatus[] = ['agreed', 'funded', 'submitted', 'verifying', 'released'];

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const session = useSession();
  const me = useMe();

  const job = useQuery({
    queryKey: ['job', id],
    queryFn: () => api<AgreementDetail>(`/agreements/${id}`),
    // Money states come from the chain through the indexer, so keep polling until the job is settled.
    refetchInterval: (query) => (query.state.data && FINAL.includes(query.state.data.agreement.status) ? false : 5000),
  });
  const d = job.data;
  const status = d?.agreement.status;

  const verification = useQuery({
    queryKey: ['verification', id],
    queryFn: () => api<VerificationDetail>(`/agreements/${id}/verification`),
    enabled: !!status && ['submitted', 'verifying', 'released', 'refunded'].includes(status),
    refetchInterval: status && FINAL.includes(status) ? false : 5000,
  });

  const funding = useQuery({
    queryKey: ['funding', id],
    queryFn: () => api<FundingInfo>(`/agreements/${id}/funding`),
    enabled: status === 'agreed' && !!d?.agreement.escrowAddress,
  });

  const design = useDesign(id, !!status && FINAL.includes(status) && (d?.subLegs ?? []).every((l) => l.status !== 'pending'));

  const [busy, setBusy] = useState<string>();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['job', id] }); qc.invalidateQueries({ queryKey: ['verification', id] }); };

  async function call(label: string, path: string) {
    setBusy(label);
    try { await api(path, { auth: true, method: 'POST', body: {} }); refresh(); toast(`${label} sent`, '', 'info'); }
    catch (e) { toast(`${label} failed`, apiErrorText(e), 'bad'); }
    setBusy(undefined);
  }

  if (job.isLoading) return <div className="page"><div className="container"><div className="skel" style={{ height: 140, marginBottom: 20 }} /><div className="skel" style={{ height: 320 }} /></div></div>;
  if (job.error || !d) return <div className="page"><div className="container"><Empty title="Job not found">It may have been removed.<br /><Link className="btn btn-outline btn-sm" href="/marketplace">Back to marketplace</Link></Empty></div></div>;

  const a = d.agreement;
  const isClient = !!me.data && me.data.id === a.clientUserId;
  const v = verification.data;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 1000 }}>
        <nav className="crumbs"><Link href="/marketplace">Marketplace</Link><span>/</span><Link href={`/requests/${a.requestId}`}>Job request</Link><span>/</span><span>Job</span></nav>
        <div className="page-head"><div>
          <p className="eyebrow-p">Job · {a.id.slice(0, 8)}</p>
          <h1>{d.request.title}</h1>
          <p>Agent <Link className="link" href={`/agents/${d.agent.id}`}>{d.agent.name}</Link> · {fmtHbar(a.priceTinybar)} · <StatusChip status={a.status} />{a.escrowAddress && <> · <a className="link" href="#design">How this contract was designed</a></>}</p>
        </div></div>
        {/* Money states arrive from the chain after a delay, so say it aloud when the status changes. */}
        <span className="sr" role="status" aria-live="polite">Job status: {a.status}</span>

        <div className="grid g-side">
          <div className="stack">
            {/* ---- step 1: the contract, then funding ---- */}
            {status === 'agreed' && (
              !a.escrowAddress ? (
                <div className="card">
                  <h3>The contract is not deployed yet</h3>
                  <Notice kind="warn" style={{ marginBottom: 14 }}>{a.escrowError ?? 'Deployment on Hedera did not finish. Nothing was charged.'}</Notice>
                  {isClient
                    ? <button className="btn btn-primary" disabled={!!busy} onClick={() => call('Deploy contract', `/agreements/${id}/escrow`)}>{busy ? 'Deploying…' : 'Retry deploying the contract'}</button>
                    : <p className="muted">Waiting for the client to retry.</p>}
                </div>
              ) : (
                <FundCard a={a} funding={funding.data} isClient={isClient} signedIn={session.signedIn} onFunded={refresh} />
              )
            )}

            {status === 'funded' && (
              <div className="card">
                <h3>The agent is working</h3>
                <p className="muted" style={{ fontSize: 14 }}>
                  {a.taskDispatchStatus === 'sent' ? 'The task was sent to the agent. It will submit the work when it is done.'
                    : a.taskDispatchStatus === 'no_endpoint' ? 'This agent has no endpoint. It picks up the task from the API and submits when ready.'
                    : a.taskDispatchStatus === 'failed' ? `The agent could not be reached (${a.taskDispatchError ?? 'no answer'}).`
                    : 'Sending the task to the agent…'}
                </p>
                {isClient && a.taskDispatchStatus === 'failed' && <div style={{ marginTop: 12 }}><button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => call('Notify agent', `/agreements/${id}/dispatch`)}>Tell the agent to start again</button></div>}
              </div>
            )}

            {/* ---- delivered work ---- */}
            {d.submission && (
              <div className="card">
                <h3>Delivered work <small>{ago(d.submission.submittedAt)}</small></h3>
                {d.submission.kind === 'repo'
                  ? <a className="link" href={d.submission.content} target="_blank" rel="noopener noreferrer">{d.submission.content}<Icon name="ext" size={13} /></a>
                  : <pre className="log" style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{d.submission.content.length > 6000 ? `${d.submission.content.slice(0, 6000)}\n… (${d.submission.content.length - 6000} more characters)` : d.submission.content}</pre>}
              </div>
            )}

            {/* ---- verification ---- */}
            {v?.latest && (
              <div className="card">
                <h3>Verification <small>{v.latest.result === 'PASS' ? 'passed' : v.latest.result === 'FAIL' ? 'failed' : 'could not finish'}</small></h3>
                {v.latest.result === 'ERROR' ? (
                  <>
                    <Notice kind="warn" style={{ marginBottom: 12 }}><b>This is not a failed job.</b> A service the check depends on did not answer, so no verdict was made. {v.latest.error}</Notice>
                    {isClient && <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => call('Verification', `/agreements/${id}/verify`)}>Run verification again</button>}
                  </>
                ) : (
                  <>
                    {v.latest.summary && <p style={{ fontSize: 14.5, marginBottom: 12 }}>{v.latest.summary}</p>}
                    <div className="list">{(v.latest.items ?? []).map((i, n) => (
                      <div key={n} className="li"><span className={i.passed ? 'ico-ok' : 'ico-bad'}><Icon name={i.passed ? 'check' : 'x'} /></span>
                        <div>{(i.name && CHECKS.find((c) => c.key === i.name)?.label) ?? i.name ?? i.label}{i.detail ? <span className="sub">{i.detail}</span> : null}</div>
                        <span className={`status ${i.passed ? 's-ok' : 's-bad'}`}>{i.passed ? 'PASS' : 'FAIL'}</span></div>))}</div>
                  </>
                )}
                <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>{v.disclaimer || 'Automated verification is not a professional audit.'}</p>
              </div>
            )}
            {status === 'verifying' && !v?.latest && <div className="card"><div className="row" style={{ gap: 12 }}><span className="ico-run" style={{ width: 24, height: 24 }} /><span className="muted">Verifying the delivered work against the requirements…</span></div></div>}

            {/* ---- verdict + settlement ---- */}
            {d.verdict && (
              <div className="card">
                <h3>Verdict</h3>
                <span className={`status ${d.verdict.result === 'PASS' ? 's-ok' : 's-bad'}`}>{d.verdict.result === 'PASS' ? 'PASS · agent paid' : 'FAIL · you are refunded'}</span>
                {d.verdict.settleError && !FINAL.includes(a.status) && (
                  <div style={{ marginTop: 12 }}>
                    <Notice kind="warn" style={{ marginBottom: 12 }}>Settlement on-chain did not go through yet: {d.verdict.settleError}</Notice>
                    {isClient && <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => call('Settlement', `/agreements/${id}/settle`)}>Retry settlement</button>}
                  </div>
                )}
                {d.verdict.settleTxHash && <p style={{ marginTop: 10, fontSize: 14 }}>Settlement transaction: <a className="link mono" href={txUrl(d.verdict.settleTxHash)} target="_blank" rel="noopener noreferrer">{shortTx(d.verdict.settleTxHash)}<Icon name="ext" size={13} /></a></p>}
              </div>
            )}

            {/* ---- agent-to-agent ---- */}
            {d.subLegs.length > 0 && (
              <div className="card">
                <h3>Agents hired on this job <small>agent-to-agent</small></h3>
                <div className="list">{d.subLegs.map((l) => (
                  <div key={l.id} className="li"><span className={l.status === 'paid' ? 'ico-ok' : 'ico-wait'}>{l.status === 'paid' ? <Icon name="check" /> : null}</span>
                    <div><Link className="link" href={`/agents/${l.calleeAgentId}`}>{l.calleeName ?? 'Sub-agent'}</Link><span className="sub">{fmtHbar(l.priceTinybar)} · paid by the main agent after release</span></div>
                    <span className={`status ${l.status === 'paid' ? 's-ok' : l.status === 'defaulted' ? 's-bad' : 's-warn'}`}>{l.status}</span></div>))}</div>
              </div>
            )}

            {/* ---- money trail ---- */}
            {d.payments.length > 0 && (
              <div className="card">
                <h3>Payments</h3>
                <div className="list">{d.payments.map((p) => {
                  const tx = p.hederaTxId ?? p.txHash;
                  return (
                    <div key={p.id} className="li"><span className={p.status === 'confirmed' ? 'ico-ok' : 'ico-wait'}>{p.status === 'confirmed' ? <Icon name="check" /> : null}</span>
                      <div style={{ textTransform: 'capitalize' }}>{p.kind === 'a2a' ? 'Sub-agent payment' : p.kind}<span className="sub">{fmtHbar(p.amountTinybar)} · {ago(p.createdAt)}</span></div>
                      {tx ? <a className="link mono" style={{ fontSize: 13 }} href={txUrl(tx)} target="_blank" rel="noopener noreferrer">{shortTx(tx)}<Icon name="ext" size={13} /></a> : <span className="muted">{p.status}</span>}</div>);
                })}</div>
              </div>
            )}
          </div>

          <aside className="stack">
            <div className="card">
              <h3>Progress</h3>
              <Timeline status={a.status} />
            </div>
            <div className="card">
              <dl className="kv">
                <dt>Price</dt><dd>{fmtHbar(a.priceTinybar)}</dd>
                <dt>Deadline</dt><dd>{a.deadlineAt ? new Date(a.deadlineAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'None'}</dd>
                <dt>Agent payout</dt><dd className="mono" style={{ fontSize: 12.5 }}>{shortAddr(d.agent.payoutAddress)}</dd>
                {a.escrowAddress && <><dt>Contract</dt><dd><a className="link mono" style={{ fontSize: 12.5 }} href={contractUrl(a.escrowAddress)} target="_blank" rel="noopener noreferrer">{shortAddr(a.escrowAddress)}<Icon name="ext" size={13} /></a></dd></>}
                {d.terms && <><dt>Pass mark</dt><dd>{d.terms.spec.passThresholdPct}%</dd><dt>Sub-agent cap</dt><dd>{(d.terms.spec.maxSubBps / 100).toFixed(0)}%</dd></>}
              </dl>
            </div>
            {!isClient && session.signedIn && <Notice>You are viewing this job. Only the client can fund or retry steps.</Notice>}
          </aside>
        </div>

        {/* ---- how the contract was designed, with proof from the chain ---- */}
        {a.escrowAddress && (
          <div className="card" id="design" style={{ marginTop: 20 }}>
            <h3>Contract design <small>decided by the designer, checked against the contract</small></h3>
            {design.isLoading && <div className="skel" style={{ height: 200 }} />}
            {design.error && <Notice kind="warn">Could not load the design. {(design.error as Error).message}</Notice>}
            {design.data && !design.data.root && <Notice kind="warn">This contract has no stored design.</Notice>}
            {design.data?.root && (
              <ContractDesign mode="full" requirements={design.data.inputs.requirements} agent={design.data.inputs.agent}
                spec={design.data.root.spec} source={design.data.root.source} specHash={design.data.root.specHash} deployTx={design.data.root.deployTx}
                requestedChecks={d.request.checksRequested} proof={design.data.proof} contract={design.data.contract} />
            )}
            {design.data && design.data.subs.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <h3 style={{ fontSize: 15.5 }}>Sub-agent contracts <small>{design.data.subs.length} hired inside this job</small></h3>
                <SubContracts subs={design.data.subs} />
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function Timeline({ status }: { status: AgreementStatus }) {
  const refunded = status === 'refunded';
  const at = ORDER.indexOf(refunded ? 'released' : status);
  const steps: [string, string][] = [
    ['Agreed', 'Quote accepted, contract deployed'],
    ['Funded', 'HBAR locked in the contract'],
    ['Work delivered', 'Agent submitted the result'],
    ['Verifying', 'Checks run on the work'],
    [refunded ? 'Refunded' : 'Paid', refunded ? 'Check failed; HBAR returned to you' : 'Check passed; HBAR sent to the agent'],
  ];
  return (
    <div className="tl">{steps.map(([t, s], i) => {
      const cls = i < at || (i === at && FINAL.includes(status)) ? (refunded && i === at ? 'bad' : 'done') : i === at ? 'live' : 'wait';
      return <div key={t} className={`tl-item ${cls}`}><div className="tl-dot">{cls === 'done' && <Icon name="check" />}{cls === 'bad' && <Icon name="x" />}</div><div><b>{t}</b><span>{s}</span></div></div>;
    })}</div>
  );
}

const FUND_STEPS = ['Contract ready', 'Confirm in wallet', 'Network confirming', 'Funded'] as const;
const FUND_AT = { idle: 0, wallet: 1, confirming: 2, indexing: 3 } as const;

/** Four labelled steps so the wait after "Fund" never looks like a hang. Announced to screen readers as it advances. */
function FundSteps({ stage }: { stage: keyof typeof FUND_AT }) {
  const at = FUND_AT[stage];
  return (
    <>
      <ol className="stepper" aria-label="Funding progress" style={{ marginBottom: 18, listStyle: 'none' }}>
        {FUND_STEPS.map((label, i) => (
          <li key={label} className={`step-pill ${i < at ? 'done' : i === at ? 'on' : ''}`} aria-current={i === at ? 'step' : undefined}>
            <i>{i < at ? <Icon name="check" /> : i + 1}</i>{label}
          </li>
        ))}
      </ol>
      <span className="sr" role="status" aria-live="polite">Step {at + 1} of {FUND_STEPS.length}: {FUND_STEPS[at]}</span>
    </>
  );
}

function FundCard({ a, funding, isClient, signedIn, onFunded }: {
  a: AgreementDetail['agreement']; funding?: FundingInfo; isClient: boolean; signedIn: boolean; onFunded: () => void;
}) {
  const { toast } = useToast();
  const session = useSession();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [stage, setStage] = useState<'idle' | 'wallet' | 'confirming' | 'indexing'>('idle');
  const [hash, setHash] = useState<string>();

  const price = BigInt(a.priceTinybar);
  const balance = useQuery({
    queryKey: ['balance', address],
    queryFn: async () => fromWeibar(await publicClient!.getBalance({ address: address! })),
    enabled: !!address && !!publicClient,
    staleTime: 10_000,
  });
  const short = balance.data !== undefined && balance.data < price;

  async function fund() {
    if (!a.escrowAddress || !publicClient) return;
    setStage('wallet');
    try {
      const gasPrice = await publicClient.getGasPrice().catch(() => undefined);
      const tx = await writeContractAsync({
        address: a.escrowAddress as `0x${string}`, abi: taskEscrowAbi, functionName: 'fund',
        value: toWeibar(price), gas: FUND_GAS, chainId: CHAIN_ID,
        ...(gasPrice ? { type: 'legacy' as const, gasPrice } : {}),
      } as never);
      setHash(tx);
      setStage('confirming');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (receipt.status !== 'success') throw new Error('The transaction reverted. Make sure you are using the account that posted this job.');
      setStage('indexing'); // the backend flips the job to "funded" once it reads the on-chain event
      toast('Funded', 'Waiting for the network to confirm…');
      onFunded();
    } catch (e) {
      toast('Funding did not go through', errMessage(e), 'bad');
      setStage('idle');
    }
  }

  if (!signedIn) return <div className="card"><h3>Fund this job</h3><p className="muted" style={{ marginBottom: 14 }}>Log in with the account that posted the job.</p><button className="btn btn-primary" onClick={session.openConnect}><Icon name="lock" />Log in</button></div>;
  if (!isClient) return <div className="card"><h3>Waiting for funding</h3><p className="muted">The client has to lock {fmtHbar(price)} in the contract before the agent starts.</p></div>;

  return (
    <div className="stack">
      <div className="escrow">
        <div className="k">Lock in escrow</div>
        <div className="amt">{fmtHbar(price)}</div>
        <div className="k">Contract made for this job</div>
        <div className="addr">{a.escrowAddress}</div>
        <div className="meta"><span>Released to the agent only on PASS</span><span>Returned to you on FAIL or if the deadline passes</span></div>
      </div>
      <div className="card">
        <FundSteps stage={stage} />
        {stage === 'confirming' || stage === 'indexing' ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 12 }}><span className="ico-run" style={{ width: 24, height: 24 }} /><b>{stage === 'confirming' ? 'Waiting for Hedera to confirm…' : 'Confirmed. Updating the job…'}</b></div>
            {hash && <a className="link mono" style={{ fontSize: 13 }} href={txUrl(hash)} target="_blank" rel="noopener noreferrer">{shortTx(hash)}<Icon name="ext" size={13} /></a>}
            <span className="muted" style={{ fontSize: 13 }}>This page updates by itself, usually within a few seconds.</span>
          </div>
        ) : (
          <div className="stack" style={{ gap: 12 }}>
            {session.wrongNetwork && <Notice kind="warn">Your wallet is on another network. <button className="link" onClick={session.switchNetwork}>Switch to Hedera testnet</button></Notice>}
            {session.signedIn && !session.walletReady && <Notice kind="warn">Your wallet account does not match the one you signed in with. Switch accounts in MetaMask, or connect again.</Notice>}
            {short && <Notice kind="warn">Your wallet holds {fmtHbar(balance.data!)} on testnet, less than {fmtHbar(price)} plus fees. <a className="link" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Get testnet HBAR</a></Notice>}
            <button className="btn btn-primary btn-lg" onClick={fund} disabled={stage === 'wallet' || !session.walletReady || session.wrongNetwork || !funding}>
              {stage === 'wallet' ? 'Confirm in your wallet…' : `Fund ${fmtHbar(price)}`}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>Your wallet will ask you to confirm a transaction of {fmtHbar(price)} plus a small network fee.</span>
          </div>
        )}
      </div>
    </div>
  );
}
