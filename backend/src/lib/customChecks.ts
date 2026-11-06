// Plain-TypeScript checks. No AI, no network. Each returns { name, passed, detail }.
export type CheckItem = { name: string; passed: boolean; detail: string };
export type Files = Record<string, string>;

const has = (files: Files, re: RegExp) => Object.keys(files).some((p) => re.test(p));
const allText = (files: Files) => Object.values(files).join('\n');

// ---- benchmark checks (repo quality) ----
export function benchmarkChecks(files: Files, capabilities: string[]): CheckItem[] {
  const out: CheckItem[] = [];

  const readmeKey = Object.keys(files).find((p) => /^readme/i.test(p));
  const readme = readmeKey ? files[readmeKey] : '';
  out.push({
    name: 'readme_present',
    passed: readme.trim().length >= 200,
    detail: readme ? `README has ${readme.trim().length} characters` : 'No README found',
  });

  const hasEntry =
    has(files, /(^|\/)(index|main|app|server|agent)\.(ts|js|mjs|py)$/i) ||
    has(files, /\.sol$/i) ||
    has(files, /^src\//i);
  out.push({ name: 'entry_point_exists', passed: hasEntry, detail: hasEntry ? 'Found source/entry files' : 'No entry point or src/ directory' });

  let manifestOk = false;
  let manifestDetail = 'No manifest (package.json, foundry.toml, pyproject.toml, requirements.txt, Cargo.toml)';
  if (files['package.json'] !== undefined) {
    try { JSON.parse(files['package.json']); manifestOk = true; manifestDetail = 'package.json parses'; }
    catch { manifestDetail = 'package.json is not valid JSON'; }
  } else if (has(files, /(^|\/)(foundry\.toml|pyproject\.toml|requirements\.txt|cargo\.toml)$/i)) {
    manifestOk = true; manifestDetail = 'Found a project manifest';
  }
  out.push({ name: 'manifest_valid', passed: manifestOk, detail: manifestDetail });

  const corpus = (readme + '\n' + allText(files)).toLowerCase();
  const words = capabilities.flatMap((c) => c.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3);
  const matched = words.filter((w) => corpus.includes(w));
  out.push({
    name: 'capabilities_match_code',
    passed: words.length > 0 && matched.length / words.length >= 0.5,
    detail: `${matched.length}/${words.length} capability keywords found in README/code`,
  });

  return out;
}

// ---- verification checks (client-ticked) ----
const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['64-hex private key', /(?:private_?key|secret|mnemonic)\s*[:=]\s*["']?(?:0x)?[0-9a-fA-F]{64}["']?/i],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['generic API key', /\b(?:api[_-]?key|token|secret)\s*[:=]\s*["'][A-Za-z0-9_\-]{24,}["']/i],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
];

export function secretsScan(files: Files): CheckItem {
  const hits: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    for (const [label, re] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${label} in ${path}`);
  }
  return { name: 'secrets_scan', passed: hits.length === 0, detail: hits.length ? hits.slice(0, 5).join('; ') : 'No obvious secrets found' };
}

export function dependencyCheck(files: Files): CheckItem {
  const raw = files['package.json'];
  if (raw === undefined) return { name: 'dependency_check', passed: true, detail: 'No package.json to check' };
  try {
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const bad = Object.entries(all).filter(([, v]) => v === '*' || v === 'latest' || v.startsWith('git+') || v.startsWith('http'));
    return { name: 'dependency_check', passed: bad.length === 0, detail: bad.length ? `Unpinned/remote: ${bad.map(([k, v]) => `${k}@${v}`).join(', ')}` : `${Object.keys(all).length} dependencies, none unpinned` };
  } catch {
    return { name: 'dependency_check', passed: false, detail: 'package.json is not valid JSON' };
  }
}

export function buildConfig(files: Files): CheckItem {
  let ok = false; let detail = 'No build configuration found';
  if (files['package.json'] !== undefined) {
    try { ok = Boolean((JSON.parse(files['package.json']) as { scripts?: Record<string, string> }).scripts?.build); detail = ok ? 'package.json has a build script' : 'package.json has no build script'; }
    catch { detail = 'package.json is not valid JSON'; }
  }
  if (!ok && has(files, /(^|\/)foundry\.toml$/)) { ok = true; detail = 'foundry.toml present'; }
  if (!ok && has(files, /\.sol$/) && !has(files, /(^|\/)(package\.json|foundry\.toml|hardhat\.config\.\w+)$/)) detail = 'Solidity files but no foundry.toml/hardhat config';
  return { name: 'build_config', passed: ok, detail };
}

export function lintRules(files: Files): CheckItem {
  const ok = has(files, /(^|\/)(\.eslintrc[\w.]*|eslint\.config\.\w+|\.prettierrc[\w.]*|\.solhint\.json|ruff\.toml|\.flake8)$/);
  return { name: 'lint_rules', passed: ok, detail: ok ? 'Lint/format config found' : 'No lint/format config found' };
}

export function runMechanicalChecks(requested: string[], files: Files): CheckItem[] {
  const out: CheckItem[] = [];
  if (requested.includes('secrets_scan')) out.push(secretsScan(files));
  if (requested.includes('dependency_check')) out.push(dependencyCheck(files));
  if (requested.includes('build_config')) out.push(buildConfig(files));
  if (requested.includes('lint_rules')) out.push(lintRules(files));
  return out;
}
