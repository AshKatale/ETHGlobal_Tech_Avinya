/* Gigiverse prototype core: state, wallet, modals, job engine.
   Everything is simulated in the browser (localStorage). No network calls. */
(function () {
  'use strict';
  const GV = (window.GV = {});
  const KEY = 'gv.proto.v1';
  const TINY = 100000000n; // 1 HBAR = 10^8 tinybar

  /* ---------------- icons ---------------- */
  const I = {
    check: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path fill="none" stroke="currentColor" stroke-width="1.8" d="M8 10.5V7.8a4 4 0 018 0v2.7"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 11v5M12 7.5v.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 3.5l9.5 16.5h-19z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 10v4.5M12 17.2v.3"/></svg>',
    ext: '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
    fox: '<svg viewBox="0 0 32 32"><rect x="3" y="8" width="26" height="18" rx="4" fill="#f6851b"/><rect x="3" y="8" width="26" height="5" rx="2" fill="#e2761b"/><rect x="19" y="15" width="10" height="7" rx="2" fill="#fff" opacity=".9"/><circle cx="23" cy="18.5" r="1.6" fill="#e2761b"/></svg>',
    wc: '<svg viewBox="0 0 32 32"><path fill="#3b99fc" d="M9.6 11.4c3.5-3.4 9.2-3.4 12.7 0l.4.4a.4.4 0 010 .6l-1.5 1.4a.2.2 0 01-.3 0l-.6-.6a6.4 6.4 0 00-8.9 0l-.6.6a.2.2 0 01-.3 0L9 12.4a.4.4 0 010-.6zm15.7 2.9l1.3 1.3a.4.4 0 010 .6l-5.9 5.8a.5.5 0 01-.6 0l-4.2-4.1a.1.1 0 00-.2 0l-4.2 4.1a.5.5 0 01-.6 0l-5.9-5.8a.4.4 0 010-.6l1.3-1.3a.5.5 0 01.6 0l4.2 4.1a.1.1 0 00.2 0l4.2-4.1a.5.5 0 01.6 0l4.2 4.1a.1.1 0 00.2 0l4.2-4.1a.5.5 0 01.6 0z"/></svg>',
    hbar: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#222"/><path stroke="#fff" stroke-width="2.4" d="M11 9v14M21 9v14M11 13.5h10M11 18.5h10"/></svg>'
  };
  GV.icon = I;

  /* ---------------- helpers ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  GV.$ = $; GV.$$ = $$;
  const hexd = n => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  GV.hex = hexd;
  GV.addr = () => '0x' + hexd(40);
  GV.short = a => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
  GV.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  GV.qs = k => new URLSearchParams(location.search).get(k);
  GV.hashStr = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /* money: amounts are tinybar strings, math in BigInt */
  GV.tiny = hbar => (BigInt(hbar) * TINY).toString();
  GV.toTiny = str => { // parse user input "12.5" → tinybar string, or null
    const s = String(str).trim(); if (!/^\d+(\.\d{1,8})?$/.test(s)) return null;
    const [i, f = ''] = s.split('.'); return (BigInt(i) * TINY + BigInt((f + '00000000').slice(0, 8))).toString();
  };
  GV.fmt = (t, withUnit = true) => {
    const v = BigInt(t || 0), neg = v < 0n, a = neg ? -v : v, i = a / TINY, f = a % TINY;
    let s = i.toLocaleString('en-US');
    if (f) s += '.' + f.toString().padStart(8, '0').replace(/0+$/, '').slice(0, 2);
    return (neg ? '−' : '') + s + (withUnit ? ' ℏ' : '');
  };
  GV.add = (a, b) => (BigInt(a || 0) + BigInt(b || 0)).toString();
  GV.sub = (a, b) => (BigInt(a || 0) - BigInt(b || 0)).toString();
  GV.pct = (t, p) => ((BigInt(t) * BigInt(p)) / 100n).toString();
  GV.ago = ts => { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; };
  GV.date = ts => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  GV.hashscan = h => 'https://hashscan.io/testnet/transaction/' + h;

  /* ---------------- catalog ---------------- */
  GV.TAGS = ['Code review', 'Security', 'Backend', 'Frontend', 'Smart contracts', 'Data', 'Docs', 'Testing', 'DevOps'];
  GV.CHECKS = [
    { key: 'build_config', label: 'Build config valid', desc: 'Project builds; manifests and configs parse.', kind: 'Code' },
    { key: 'lint_rules', label: 'Lint rules', desc: 'No lint errors under the repo’s own config.', kind: 'Code' },
    { key: 'secrets_scan', label: 'Secrets scan', desc: 'No keys, tokens or .env files committed.', kind: 'Security' },
    { key: 'dependency_check', label: 'Dependency check', desc: 'Dependencies resolve; no known-bad versions.', kind: 'Security' },
    { key: 'security_review', label: 'AI security review', desc: 'NVIDIA model reviews for exploitable issues.', kind: 'Security' }
  ];
  const COLORS = ['#f29a4a', '#4fc9e0', '#a78bfa', '#f2d04a', '#f27aa8', '#6fdc8c', '#ff7a6a', '#7aa8ff'];
  GV.COLORS = COLORS;

  function mkAgent(o) {
    const custom = o.custom, ai = o.ai, score = Math.round(0.4 * custom + 0.6 * ai);
    return Object.assign({
      owner: GV.addr(), listed: true, createdAt: Date.now() - 86400000 * (5 + Math.floor(Math.random() * 40)),
      repo: 'https://github.com/' + o.gh, commit: hexd(7), endpoint: 'https://agents.example/' + o.id,
      jobsDone: 0, passes: 0, earned: '0', score, mine: false,
      checks: [
        { name: 'README present', passed: true, score: 100, detail: 'README.md found with setup and usage sections.' },
        { name: 'Repo structure', passed: custom > 70, score: Math.min(100, custom + 6), detail: custom > 70 ? 'src/, tests/ and config at the root.' : 'Source and tests mixed at the root.' },
        { name: 'Entry point exists', passed: true, score: 100, detail: 'Entry point resolves from package.json.' },
        { name: 'Dependencies parse', passed: true, score: 96, detail: 'package.json and lockfile parse cleanly.' },
        { name: 'Capabilities match code', passed: custom > 78, score: Math.max(55, custom - 4), detail: custom > 78 ? 'Declared capabilities found in the code.' : 'One declared capability has no matching code path.' }
      ]
    }, o, { custom, ai });
  }
  function seedAgents() {
    return [
      mkAgent({ id: 'repo-auditor', name: 'RepoAuditor', color: COLORS[0], tags: ['Code review', 'Security'], price: GV.tiny(120), custom: 94, ai: 91, gh: 'forge-labs/repo-auditor', jobsDone: 48, passes: 45,
        tagline: 'Reviews a repo for bugs and exploitable issues and writes a fix list.',
        review: { summary: 'Well-structured TypeScript service with a clear analysis pipeline. Findings are specific and reproducible.', strengths: ['Each finding links to file and line', 'Separate passes for logic bugs and security', 'Good test coverage on the parsers'], risks: ['Large monorepos are sampled, not read in full'] } }),
      mkAgent({ id: 'spec-to-api', name: 'SpecToAPI', color: COLORS[1], tags: ['Backend'], price: GV.tiny(250), custom: 90, ai: 87, gh: 'apismith/spec-to-api', jobsDone: 31, passes: 28,
        tagline: 'Turns a written spec into typed, validated REST endpoints.',
        review: { summary: 'Generates Fastify routes with Zod validation from plain-English specs. Output is consistent and typed end to end.', strengths: ['Validation on every input', 'Generated tests per endpoint', 'Clear error shapes'], risks: ['Auth flows need a human to confirm scopes'] } }),
      mkAgent({ id: 'chain-indexer', name: 'ChainIndexer', color: COLORS[2], tags: ['Data', 'Smart contracts'], price: GV.tiny(180), custom: 86, ai: 85, gh: 'hashlabs/chain-indexer', jobsDone: 22, passes: 19,
        tagline: 'Builds indexers that read contract logs from the Hedera mirror node.',
        review: { summary: 'Reliable log ingestion with cursor-based paging and idempotent writes.', strengths: ['Handles mirror-node paging and retries', 'Idempotent inserts keyed by tx + log index'], risks: ['No backfill UI; backfills run from the CLI'] } }),
      mkAgent({ id: 'doc-smith', name: 'DocSmith', color: COLORS[3], tags: ['Docs'], price: GV.tiny(60), custom: 82, ai: 80, gh: 'quill-ai/doc-smith', jobsDone: 64, passes: 57,
        tagline: 'Writes READMEs, setup guides and API references from your code.',
        review: { summary: 'Produces readable docs that match the code. Examples compile.', strengths: ['Examples are extracted from real code', 'Keeps existing docs’ tone'], risks: ['Diagrams are text-only'] } }),
      mkAgent({ id: 'test-pilot', name: 'TestPilot', color: COLORS[4], tags: ['Testing'], price: GV.tiny(90), custom: 88, ai: 84, gh: 'qa-crew/test-pilot', jobsDone: 27, passes: 24,
        tagline: 'Finds flaky tests, fixes them and adds missing coverage.',
        review: { summary: 'Detects flakiness by rerunning suites and isolates timing issues well.', strengths: ['Explains the root cause of each flaky test', 'Adds focused regression tests'], risks: ['Browser E2E suites are out of scope'] } }),
      mkAgent({ id: 'gas-guard', name: 'GasGuard', color: COLORS[5], tags: ['Smart contracts', 'Security'], price: GV.tiny(220), custom: 89, ai: 92, gh: 'evmsec/gas-guard', jobsDone: 15, passes: 14,
        tagline: 'Audits Solidity for reentrancy, access control and gas waste.',
        review: { summary: 'Strong static checks for common Solidity bugs plus AI review for business-logic issues.', strengths: ['Checks every external call path', 'Gas report per function'], risks: ['Not a substitute for a professional audit'] } }),
      mkAgent({ id: 'ui-forge', name: 'UIForge', color: COLORS[6], tags: ['Frontend'], price: GV.tiny(150), custom: 84, ai: 81, gh: 'pixelworks/ui-forge', jobsDone: 19, passes: 16,
        tagline: 'Builds responsive React screens from a written brief.',
        review: { summary: 'Accessible, responsive components with sensible defaults.', strengths: ['Keyboard and screen-reader support', 'Mobile-first layouts'], risks: ['Brand styling needs a design token file'] } }),
      mkAgent({ id: 'data-scout', name: 'DataScout', color: COLORS[7], tags: ['Data', 'Backend'], price: GV.tiny(110), custom: 83, ai: 82, gh: 'scoutai/data-scout', jobsDone: 12, passes: 10,
        tagline: 'Writes safe database migrations and data clean-up scripts.',
        review: { summary: 'Migrations are reversible and run in transactions.', strengths: ['Down migrations included', 'Dry-run mode by default'], risks: ['Very large tables need a manual batching plan'] } })
    ];
  }

  /* ---------------- state ---------------- */
  function seed() {
    const now = Date.now();
    const st = { v: 1, wallet: { connected: false, address: null, balance: GV.tiny(5000) }, agents: seedAgents(), jobs: [], activity: [], seq: 1043, seededAt: now };
    // a finished gig for history
    st.jobs.push(buildJob(st, {
      title: 'Audit the escrow contract', requirement: 'Review JobEscrow.sol for reentrancy and access-control issues.\nList each finding with a severity.\nSuggest a fix for every high finding.',
      checks: ['secrets_scan', 'security_review'], agentId: 'gas-guard', price: GV.tiny(220), owner: 'me', fundedAt: now - 3600 * 1000 * 26, fast: false, id: 'GIG-1038', a2aPaid: false
    }));
    // a gig in progress (will move on its own)
    st.jobs.push(buildJob(st, {
      title: 'REST API for orders', requirement: 'Add POST /orders and GET /orders/:id.\nValidate input with Zod.\nStore amounts as integers, never floats.\nReturn 404 for unknown ids.',
      checks: ['build_config', 'lint_rules', 'secrets_scan'], agentId: 'spec-to-api', price: GV.tiny(250), owner: 'me', fundedAt: now - 8000, id: 'GIG-1042'
    }));
    st.wallet.balance = GV.sub(st.wallet.balance, GV.add(GV.tiny(220), GV.tiny(250)));
    settleAll(st, true);
    st.activity = [
      { at: now - 8000, text: 'Funded escrow for GIG-1042', amount: '-' + GV.tiny(250), tx: '0x' + hexd(64) },
      { at: now - 3600 * 1000 * 25, text: 'GIG-1038 PASS · paid GasGuard from escrow', amount: '0', tx: '0x' + hexd(64) },
      { at: now - 3600 * 1000 * 26, text: 'Funded escrow for GIG-1038', amount: '-' + GV.tiny(220), tx: '0x' + hexd(64) },
      { at: now - 3600 * 1000 * 30, text: 'Received test HBAR from faucet', amount: GV.tiny(5000), tx: '0x' + hexd(64) }
    ];
    return st;
  }
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return s; } catch (e) { /* ignore */ }
    const s = seed(); save(s); return s;
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage blocked: stays in memory */ } }
  GV.save = () => save(GV.state);
  GV.reset = () => { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); };
  GV.agent = id => GV.state.agents.find(a => a.id === id);
  GV.job = id => GV.state.jobs.find(j => j.id === id);
  GV.nextId = () => 'GIG-' + (GV.state.seq++);
  GV.log = (text, amount = '0', tx) => { GV.state.activity.unshift({ at: Date.now(), text, amount, tx: tx || '0x' + hexd(64) }); GV.state.activity = GV.state.activity.slice(0, 60); };
  window.addEventListener('storage', e => { if (e.key === KEY) { GV.state = load(); emit(); } });

  /* ---------------- job engine ----------------
     A funded job carries a schedule of timestamps. Its stage is derived from
     Date.now(), so it keeps moving across pages and reloads. Money moves only in
     settle(), after the simulated "indexer" delay. */
  const STAGES = ['requested', 'quoted', 'agreed', 'funded', 'working', 'submitted', 'verifying', 'verdict', 'released', 'refunded'];
  GV.STAGES = STAGES;

  function criteria(text) {
    return String(text).split(/\n|(?<=\.)\s+/).map(s => s.trim().replace(/^[-*•\d.)\s]+/, '')).filter(s => s.length > 3).slice(0, 5);
  }
  GV.criteria = criteria;

  function buildJob(st, o) {
    const id = o.id || ('GIG-' + (st.seq++));
    const job = {
      id, title: o.title, requirement: o.requirement, checks: o.checks || [], budget: o.price, price: o.price,
      deadline: o.deadline || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      agentId: o.agentId, owner: o.owner || 'me', clientAddr: o.owner === 'me' ? null : GV.addr(),
      createdAt: (o.fundedAt || Date.now()) - 60000, quotes: o.quotes || [], status: 'requested', forceFail: !!o.forceFail,
      escrow: null, sched: null, outage: null, a2a: [], settled: false, verdict: null
    };
    if (o.fundedAt) fund(job, o.fundedAt, o.fast !== false, o.a2aPaid !== false);
    return job;
  }
  GV.buildJob = o => buildJob(GV.state, o);

  function fund(job, at, fast = true, withA2A = true) {
    const f = fast ? 1 : 1; // timings below are in ms from funding
    job.status = 'funded';
    job.escrow = job.escrow || { address: GV.addr(), createTx: '0x' + hexd(64) };
    job.escrow.fundTx = '0x' + hexd(64);
    job.sched = { fundedAt: at, indexedAt: at + 1500 * f, workAt: at + 3500 * f, a2aAt: at + 7000 * f, blockedAt: at + 9500 * f, submitAt: at + 14000 * f, verifyAt: at + 16000 * f, verdictAt: at + 22000 * f, settleAt: at + 24000 * f };
    job.submission = { root: '0x' + hexd(64), commit: hexd(7), files: 3 + Math.floor(Math.random() * 9) };
    job.verdictTx = '0x' + hexd(64);
    job.a2a = [];
    if (withA2A) {
      const helpers = GV.state ? GV.state.agents.filter(a => a.id !== job.agentId && a.listed) : seedAgents().filter(a => a.id !== job.agentId);
      const h = helpers[GV.hashStr(job.id) % helpers.length];
      const h2 = helpers[(GV.hashStr(job.id) + 3) % helpers.length];
      job.a2a.push({ at: job.sched.a2aAt, to: h.id, task: h.tags.includes('Docs') ? 'Write README section' : 'Review a sub-module', amount: GV.pct(job.price, 10), status: 'paid', tx: '0x' + hexd(64), hop: 1 });
      job.a2a.push({ at: job.sched.blockedAt, to: h2.id, task: 'Rewrite test suite', amount: GV.pct(job.price, 35), status: 'blocked', reason: 'Over the 30% A2A cap for this job', hop: 1 });
    }
  }
  GV.fund = (job, at) => fund(job, at || Date.now(), true, true);

  GV.view = function (job, now = Date.now()) {
    const s = job.sched, v = { stage: job.status, progress: 0, checks: [], a2a: [], outage: false };
    const reqs = criteria(job.requirement).map(c => ({ label: c, kind: 'Requirement' }));
    const ticks = job.checks.map(k => { const c = GV.CHECKS.find(x => x.key === k); return { label: c ? c.label : k, kind: c ? c.kind : 'Code' }; });
    const all = reqs.concat(ticks);
    if (!s) { v.all = all; return v; }
    v.a2a = job.a2a.filter(x => now >= x.at);
    let stage = 'funded';
    if (now >= s.indexedAt) stage = 'working';
    if (now >= s.submitAt) stage = 'submitted';
    if (now >= s.verifyAt) stage = 'verifying';
    if (job.outage && !job.outage.resolved && now >= s.verifyAt) { v.outage = true; stage = 'verifying'; }
    else if (now >= s.verdictAt) stage = 'verdict';
    if (job.settled) stage = job.verdict === 'PASS' ? 'released' : 'refunded';
    v.stage = stage;
    v.indexed = now >= s.indexedAt;
    const failIdx = job.forceFail ? 0 : -1;
    const span = s.verdictAt - s.verifyAt;
    v.checks = all.map((c, i) => {
      const doneAt = s.verifyAt + span * ((i + 1) / (all.length + 1));
      let st = 'wait';
      if (v.outage) st = now >= doneAt && i === 0 ? (i === failIdx ? 'bad' : 'ok') : 'wait';
      else if (now >= s.verdictAt || job.settled) st = i === failIdx ? 'bad' : 'ok';
      else if (now >= doneAt) st = i === failIdx ? 'bad' : 'ok';
      else if (now >= s.verifyAt && (i === 0 || now >= s.verifyAt + span * (i / (all.length + 1)))) st = 'run';
      return Object.assign({}, c, { st, detail: st === 'bad' ? 'Not met: no matching code path in the submission.' : st === 'ok' ? 'Met' : '' });
    });
    v.verdict = (now >= s.verdictAt && !v.outage) || job.settled ? (job.verdict || (job.forceFail ? 'FAIL' : 'PASS')) : null;
    const a2aPaid = job.a2a.filter(x => x.status === 'paid' && now >= x.at).reduce((t, x) => GV.add(t, x.amount), '0');
    v.a2aPaid = a2aPaid;
    v.payout = GV.sub(job.price, a2aPaid);
    v.passed = v.checks.filter(c => c.st === 'ok').length;
    v.all = all;
    return v;
  };

  function settle(st, job, silent) {
    if (job.settled || !job.sched) return false;
    const now = Date.now();
    if (job.outage && !job.outage.resolved) return false;
    if (now < job.sched.settleAt) return false;
    const pass = !job.forceFail, v = GV.view(job, now);
    job.verdict = pass ? 'PASS' : 'FAIL'; job.settled = true; job.status = pass ? 'released' : 'refunded'; job.settledAt = job.sched.settleAt;
    const agent = st.agents.find(a => a.id === job.agentId);
    if (agent) { agent.jobsDone++; if (pass) { agent.passes++; agent.earned = GV.add(agent.earned, v.payout); } }
    job.a2a.forEach(x => { if (x.status === 'paid') { const h = st.agents.find(a => a.id === x.to); if (h) { h.earned = GV.add(h.earned, x.amount); if (h.mine) { st.wallet.balance = GV.add(st.wallet.balance, x.amount); } } } });
    if (pass) {
      if (agent && agent.mine) { st.wallet.balance = GV.add(st.wallet.balance, v.payout); if (!silent) logTo(st, `${job.id} PASS · ${agent.name} earned`, v.payout); }
      else if (job.owner === 'me' && !silent) logTo(st, `${job.id} PASS · ${GV.fmt(v.payout)} released to ${agent ? agent.name : 'agent'}`, '0');
    } else {
      const refund = GV.sub(job.price, v.a2aPaid);
      if (job.owner === 'me') { st.wallet.balance = GV.add(st.wallet.balance, refund); if (!silent) logTo(st, `${job.id} FAIL · escrow refunded to you`, refund); }
      else if (agent && agent.mine && !silent) logTo(st, `${job.id} FAIL · client refunded, no payout`, '0');
    }
    return true;
  }
  function logTo(st, text, amount, tx) { st.activity.unshift({ at: Date.now(), text, amount, tx: tx || '0x' + hexd(64) }); }
  function settleAll(st, silent) { let ch = false; st.jobs.forEach(j => { if (settle(st, j, silent)) ch = true; }); return ch; }

  GV.escrowed = () => GV.state.jobs.filter(j => j.owner === 'me' && j.sched && !j.settled).reduce((t, j) => GV.add(t, GV.sub(j.price, '0')), '0');

  GV.state = load();

  /* ---------------- events / ticker ---------------- */
  const subs = [];
  GV.on = fn => subs.push(fn);
  function emit() { subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); updateWalletUI(); }
  GV.emit = emit;
  setInterval(() => { if (settleAll(GV.state)) GV.save(); emit(); }, 1000);
  if (settleAll(GV.state)) GV.save();

  /* ---------------- injected UI styles (modals, toasts) ---------------- */
  const css = `
  .gvm-back{position:fixed;inset:0;z-index:100;background:rgb(3 6 12 / .72);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;animation:gvmF .2s ease-out}
  @keyframes gvmF{from{opacity:0}}
  .gvm{width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;background:oklch(16% 0.03 250);border:1px solid rgb(255 255 255 / .12);border-radius:20px;padding:24px;color:#fff;font-family:"DM Sans",system-ui,sans-serif;box-shadow:0 40px 90px -30px #000;animation:gvmU .25s cubic-bezier(.2,.8,.2,1)}
  @keyframes gvmU{from{transform:translateY(14px);opacity:0}}
  .gvm h2{font-size:20px;font-weight:600;margin:0 0 6px;display:flex;justify-content:space-between;align-items:center}
  .gvm h2 button{font-size:26px;line-height:1;color:rgb(255 255 255 / .5);background:none;border:0;cursor:pointer}
  .gvm p.sub{color:oklch(88.911% 0.00329 198.79 / .6);font-size:14px;margin:0 0 18px}
  .gvm-opt{display:flex;align-items:center;gap:14px;width:100%;padding:14px;border-radius:14px;border:1px solid rgb(255 255 255 / .12);background:rgb(255 255 255 / .03);color:#fff;font:inherit;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:10px;text-align:left;transition:border-color .15s}
  .gvm-opt:hover:not([disabled]){border-color:oklch(84.972% 0.12016 146.073)}
  .gvm-opt[disabled]{opacity:.45;cursor:not-allowed}
  .gvm-opt svg{width:32px;height:32px}
  .gvm-opt small{display:block;font-size:12.5px;font-weight:400;color:oklch(88.911% 0.00329 198.79 / .6)}
  .gvm-opt em{margin-left:auto;font-style:normal;font-size:11.5px;font-weight:500;border:1px solid rgb(255 255 255 / .15);border-radius:999px;padding:2px 8px;color:oklch(88.911% 0.00329 198.79 / .7)}
  .gvm-box{background:#070b12;border:1px solid rgb(255 255 255 / .1);border-radius:12px;padding:14px;font-family:"JetBrains Mono",monospace;font-size:12.5px;line-height:1.7;color:rgb(255 255 255 / .8);white-space:pre-wrap;word-break:break-all;margin-bottom:16px}
  .gvm-rows{display:grid;grid-template-columns:auto 1fr;gap:10px 16px;font-size:14px;margin-bottom:18px}
  .gvm-rows dt{color:oklch(88.911% 0.00329 198.79 / .6)} .gvm-rows dd{margin:0;text-align:right;word-break:break-all}
  .gvm-amt{text-align:center;margin:6px 0 18px}.gvm-amt b{display:block;font-size:38px;font-weight:600}.gvm-amt span{font-size:13px;color:oklch(88.911% 0.00329 198.79 / .6)}
  .gvm-acts{display:flex;gap:10px}.gvm-acts>*{flex:1}
  .gvm-btn{height:46px;border-radius:10px;font:inherit;font-weight:600;font-size:15px;cursor:pointer;border:1px solid rgb(255 255 255 / .16);background:none;color:#fff}
  .gvm-btn.p{background:oklch(84.972% 0.12016 146.073);border-color:oklch(84.972% 0.12016 146.073);color:oklch(11.359% 0.03282 250.77)}
  .gvm-btn[disabled]{opacity:.5;cursor:wait}
  .gvm-steps{display:flex;flex-direction:column;gap:12px;margin:4px 0 20px}
  .gvm-step{display:flex;gap:12px;align-items:center;font-size:14.5px;color:oklch(88.911% 0.00329 198.79 / .55)}
  .gvm-step i{width:24px;height:24px;border-radius:50%;border:2px solid rgb(255 255 255 / .18);flex:none;display:grid;place-items:center}
  .gvm-step.run{color:#fff}.gvm-step.run i{border-top-color:oklch(84.972% 0.12016 146.073);animation:gvmS 1s linear infinite}
  .gvm-step.ok{color:#fff}.gvm-step.ok i{background:oklch(84.972% 0.12016 146.073 / .25);border-color:transparent;color:oklch(84.972% 0.12016 146.073)}
  .gvm-step.bad{color:#fff}.gvm-step.bad i{background:oklch(70% 0.17 25 / .2);border-color:transparent;color:oklch(70% 0.17 25)}
  .gvm-step i svg{width:12px;height:12px}
  @keyframes gvmS{to{transform:rotate(360deg)}}
  .gvm-head{display:flex;align-items:center;gap:10px;font-size:13px;color:oklch(88.911% 0.00329 198.79 / .7);margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid rgb(255 255 255 / .08)}
  .gvm-head svg{width:22px;height:22px}.gvm-head b{color:#fff;font-weight:600}
  .gvm-net{margin-left:auto;display:flex;align-items:center;gap:6px;border:1px solid rgb(255 255 255 / .12);border-radius:999px;padding:3px 10px;font-size:12px}
  .gvm-net i{width:7px;height:7px;border-radius:50%;background:oklch(84.972% 0.12016 146.073)}
  .gvm-err{background:oklch(70% 0.17 25 / .12);border:1px solid oklch(70% 0.17 25 / .35);border-radius:10px;padding:10px 12px;font-size:13.5px;margin-bottom:14px}
  .gvm-note{font-size:12.5px;color:oklch(88.911% 0.00329 198.79 / .55);text-align:center;margin-top:12px}
  .gv-toasts{position:fixed;z-index:120;right:16px;bottom:16px;display:flex;flex-direction:column;gap:10px;max-width:min(380px,calc(100vw - 32px))}
  .gv-toast{display:flex;gap:10px;align-items:flex-start;background:oklch(19% 0.03 250);border:1px solid rgb(255 255 255 / .14);border-left:3px solid oklch(84.972% 0.12016 146.073);border-radius:12px;padding:12px 14px;font-family:"DM Sans",system-ui,sans-serif;font-size:14px;color:#fff;box-shadow:0 20px 40px -16px #000;animation:gvmU .25s ease-out}
  .gv-toast.bad{border-left-color:oklch(70% 0.17 25)}
  .gv-toast.info{border-left-color:oklch(75.768% 0.125 198.173)}
  .gv-toast small{display:block;color:oklch(88.911% 0.00329 198.79 / .6);font-size:12.5px;margin-top:2px}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  /* ---------------- modal + toast ---------------- */
  GV.modal = function (html, { onClose } = {}) {
    const back = document.createElement('div'); back.className = 'gvm-back';
    back.innerHTML = `<div class="gvm" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener('keydown', key); onClose && onClose(); };
    const key = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
    return { el: back.firstElementChild, close, closeSilently: () => { back.remove(); document.removeEventListener('keydown', key); } };
  };
  let toasts;
  GV.toast = function (msg, sub = '', kind = '') {
    if (!toasts) { toasts = document.createElement('div'); toasts.className = 'gv-toasts'; document.body.appendChild(toasts); }
    const t = document.createElement('div'); t.className = 'gv-toast ' + kind; t.innerHTML = `<div>${msg}${sub ? `<small>${sub}</small>` : ''}</div>`;
    toasts.appendChild(t); setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4200);
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  GV.wait = wait;
  function setStep(el, i, cls) { const s = el.querySelectorAll('.gvm-step')[i]; if (!s) return; s.className = 'gvm-step ' + cls; s.querySelector('i').innerHTML = cls === 'ok' ? I.check : cls === 'bad' ? I.x : ''; }

  /* ---------------- wallet ---------------- */
  GV.connected = () => GV.state.wallet.connected;
  GV.connect = function () {
    return new Promise((resolve, reject) => {
      let done = false;
      const m = GV.modal(`
        <h2>Connect a wallet <button data-close aria-label="Close">&times;</button></h2>
        <p class="sub">Gigiverse runs on Hedera testnet. Use an EVM wallet with an ECDSA account.</p>
        <button class="gvm-opt" data-w="mm">${I.fox}<span>MetaMask<small>Via Hedera JSON-RPC relay</small></span><em>Recommended</em></button>
        <button class="gvm-opt" disabled>${I.wc}<span>WalletConnect<small>Coming later</small></span><em>Soon</em></button>
        <button class="gvm-opt" disabled>${I.hbar}<span>HashPack<small>Coming later</small></span><em>Soon</em></button>
        <p class="gvm-note">Prototype: no real wallet is opened and nothing is signed.</p>`, { onClose: () => { if (!done) reject(new Error('cancelled')); } });
      m.el.querySelector('[data-w=mm]').onclick = async () => {
        const address = GV.state.wallet.address || GV.addr(), nonce = hexd(16);
        m.el.innerHTML = `
          <h2>Connecting MetaMask <button data-close aria-label="Close">&times;</button></h2>
          <p class="sub">Approve each step in your wallet.</p>
          <div class="gvm-steps">
            <div class="gvm-step run"><i></i>Add Hedera Testnet (chain 296)</div>
            <div class="gvm-step"><i></i>Share your account address</div>
            <div class="gvm-step"><i></i>Sign in with a one-time message</div>
          </div>
          <div class="gvm-box">Sign in to Gigiverse
Address: ${address}
Chain ID: 296
Nonce: ${nonce}
This request will not trigger a transaction.</div>
          <div class="gvm-acts"><button class="gvm-btn" data-close>Cancel</button><button class="gvm-btn p" disabled data-sign>Sign message</button></div>`;
        await wait(900); setStep(m.el, 0, 'ok'); setStep(m.el, 1, 'run');
        await wait(700); setStep(m.el, 1, 'ok'); setStep(m.el, 2, 'run');
        const btn = m.el.querySelector('[data-sign]'); if (!btn) return; btn.disabled = false;
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = 'Verifying signature…';
          await wait(800); setStep(m.el, 2, 'ok'); await wait(300);
          GV.state.wallet.connected = true; GV.state.wallet.address = address; GV.save();
          done = true; m.closeSilently(); emit();
          GV.toast('Wallet connected', GV.short(address) + ' · Hedera testnet');
          resolve(address);
        };
      };
    });
  };
  GV.ensureWallet = () => GV.connected() ? Promise.resolve(GV.state.wallet.address) : GV.connect();
  GV.disconnect = () => { GV.state.wallet.connected = false; GV.save(); emit(); GV.toast('Wallet disconnected', '', 'info'); };

  /* simulated wallet transaction popup. resolves {hash} or rejects */
  GV.sendTx = function ({ title, method, to, amount = '0', note }) {
    return new Promise((resolve, reject) => {
      let done = false;
      const bal = GV.state.wallet.balance, short = BigInt(amount) > BigInt(bal);
      const m = GV.modal(`
        <div class="gvm-head">${I.fox}<b>MetaMask</b><span class="gvm-net"><i></i>Hedera Testnet</span></div>
        <h2>${GV.esc(title)} <button data-close aria-label="Close">&times;</button></h2>
        <div class="gvm-amt"><b>${GV.fmt(amount)}</b><span>${BigInt(amount) > 0n ? 'sent with this transaction' : 'no HBAR sent'}</span></div>
        <dl class="gvm-rows">
          <dt>Contract</dt><dd class="mono" style="font-family:'JetBrains Mono',monospace;font-size:12.5px">${GV.short(to)}</dd>
          <dt>Function</dt><dd style="font-family:'JetBrains Mono',monospace;font-size:12.5px">${GV.esc(method)}</dd>
          <dt>Your balance</dt><dd>${GV.fmt(bal)}</dd>
          <dt>Network fee</dt><dd>shown by your wallet</dd>
        </dl>
        ${short ? `<div class="gvm-err">Not enough HBAR. You need ${GV.fmt(GV.sub(amount, bal))} more.</div>` : ''}
        ${note ? `<p class="gvm-note" style="margin:-6px 0 14px">${note}</p>` : ''}
        <div class="gvm-acts"><button class="gvm-btn" data-close>Reject</button><button class="gvm-btn p" data-ok ${short ? 'disabled' : ''}>Confirm</button></div>`,
        { onClose: () => { if (!done) reject(new Error('rejected')); } });
      m.el.querySelector('[data-ok]').onclick = async e => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Submitting…';
        await wait(1100);
        done = true; m.closeSilently(); resolve({ hash: '0x' + hexd(64) });
      };
    });
  };

  /* ---------------- shell (header / footer) ---------------- */
  const NAV = [['marketplace.html', 'Marketplace', 'market'], ['post-gig.html', 'Post a gig', 'post'], ['list-agent.html', 'List an agent', 'list'], ['dashboard.html', 'Dashboard', 'dash']];
  function walletHTML() {
    const w = GV.state.wallet;
    if (!w.connected) return `<button class="btn btn-primary btn-sm" data-connect>${I.lock}Connect wallet</button>`;
    return `<button class="wallet-chip" data-wallet-menu title="Wallet"><span class="bal"><b>${GV.fmt(w.balance)}</b></span><span class="addr">${GV.short(w.address)}</span></button>`;
  }
  function updateWalletUI() {
    $$('[data-wallet-slot]').forEach(s => { s.innerHTML = walletHTML(); });
    $$('[data-connect-label]').forEach(b => { b.lastChild.textContent = GV.connected() ? GV.short(GV.state.wallet.address) : 'Connect wallet'; });
  }
  GV.shell = function (active) {
    const h = $('[data-shell]');
    if (h) {
      h.className = 'gv-header';
      h.innerHTML = `<div class="container gv-nav">
        <a class="gv-logo" href="gigiverse-landing.html" aria-label="Gigiverse home"><img src="assets/gigiverse-logo.png" alt="Gigiverse" width="157" height="32"></a>
        <nav class="gv-links" aria-label="App">${NAV.map(([href, t, k]) => `<a href="${href}" class="${k === active ? 'active' : ''}">${t}</a>`).join('')}</nav>
        <div class="gv-right"><span class="net-pill"><i></i>Hedera testnet</span><span data-wallet-slot></span>
        <button class="burger" aria-label="Menu" data-burger><span></span><span></span><span></span></button></div></div>
        <nav class="mnav" data-mnav>${NAV.map(([href, t, k]) => `<a href="${href}" class="${k === active ? 'active' : ''}">${t}</a>`).join('')}</nav>`;
      h.querySelector('[data-burger]').onclick = () => h.querySelector('[data-mnav]').classList.toggle('open');
    }
    const f = $('[data-footer]');
    if (f) {
      f.className = 'gv-footer';
      f.innerHTML = `<div class="container"><span>© 2026 Gigiverse · prototype on Hedera testnet · all activity is simulated</span>
        <span class="row" style="gap:18px"><a href="gigiverse-landing.html">Home</a><a href="marketplace.html">Marketplace</a><button class="link" data-reset style="color:var(--muted-60)">Reset demo data</button></span></div>`;
    }
    if (!$('.page-glow')) { const g = document.createElement('div'); g.className = 'page-glow'; document.body.prepend(g); }
    updateWalletUI();
  };
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-connect]');
    if (c) { e.preventDefault(); if (GV.connected()) location.href = 'dashboard.html'; else GV.connect().catch(() => {}); return; }
    const w = e.target.closest('[data-wallet-menu]');
    if (w) {
      const a = GV.state.wallet;
      const m = GV.modal(`<h2>Your wallet <button data-close aria-label="Close">&times;</button></h2>
        <p class="sub">MetaMask · Hedera testnet (chain 296)</p>
        <dl class="gvm-rows"><dt>Address</dt><dd style="font-family:'JetBrains Mono',monospace;font-size:12.5px">${a.address}</dd><dt>Balance</dt><dd>${GV.fmt(a.balance)}</dd><dt>In escrow</dt><dd>${GV.fmt(GV.escrowed())}</dd></dl>
        <div class="gvm-acts"><a class="gvm-btn" style="display:grid;place-items:center;text-decoration:none" href="dashboard.html">Dashboard</a><button class="gvm-btn" data-disc>Disconnect</button></div>
        <button class="gvm-btn" data-faucet style="width:100%;margin-top:10px">Get 1,000 test ℏ (faucet)</button>`);
      m.el.querySelector('[data-disc]').onclick = () => { m.close(); GV.disconnect(); };
      m.el.querySelector('[data-faucet]').onclick = () => { GV.state.wallet.balance = GV.add(GV.state.wallet.balance, GV.tiny(1000)); GV.log('Received test HBAR from faucet', GV.tiny(1000)); GV.save(); m.close(); emit(); GV.toast('+1,000 ℏ test HBAR', 'Simulated faucet drip'); };
      return;
    }
    if (e.target.closest('[data-reset]')) { if (confirm('Reset all demo data (jobs, agents, wallet)?')) GV.reset(); }
  });
  document.addEventListener('DOMContentLoaded', updateWalletUI);

  /* ---------------- small render helpers ---------------- */
  GV.ring = (score, size = 120, stroke = 10) => {
    const r = 50 - stroke / 2, c = 2 * Math.PI * r, off = c * (1 - score / 100);
    const col = score >= 80 ? 'url(#gvRing)' : 'oklch(70% 0.17 25)';
    return `<svg viewBox="0 0 100 100"><defs><linearGradient id="gvRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="oklch(75.768% 0.125 198.173)"/><stop offset="1" stop-color="oklch(84.972% 0.12016 146.073)"/></linearGradient></defs>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="rgb(255 255 255 / .1)" stroke-width="${stroke}"/>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>`;
  };
  GV.avatar = (a, cls = '') => `<div class="av ${cls}" style="background:linear-gradient(135deg,${a.color},${a.color}cc)">${GV.esc(a.name.replace(/[^A-Z]/g, '').slice(0, 2) || a.name.slice(0, 2).toUpperCase())}</div>`;
  GV.passRate = a => a.jobsDone ? Math.round((a.passes / a.jobsDone) * 100) : null;
  GV.stageInfo = {
    requested: ['Requested', 's-idle'], quoted: ['Quotes in', 's-info'], agreed: ['Awaiting funding', 's-warn'], funded: ['Funding…', 's-info s-live'],
    working: ['In progress', 's-info s-live'], submitted: ['Submitted', 's-info s-live'], verifying: ['Verifying', 's-warn s-live'],
    verdict: ['Settling', 's-warn s-live'], released: ['Paid · PASS', 's-ok'], refunded: ['Refunded · FAIL', 's-bad']
  };
  GV.statusChip = (stage, outage) => { if (outage) return '<span class="status s-bad s-live">Verifier offline</span>'; const [t, c] = GV.stageInfo[stage] || [stage, 's-idle']; return `<span class="status ${c}">${t}</span>`; };
})();
