// Fetch a PUBLIC GitHub repo without auth, using the GitHub REST API + raw.githubusercontent.com.
// Endpoints used: GET /repos/{o}/{r}, GET /repos/{o}/{r}/commits/{ref}, GET /repos/{o}/{r}/git/trees/{sha}?recursive=1.
// Unverified against GitHub's docs in this session; if one 404s, check the docs. Unauthenticated limit is 60 req/hour.
// Set GITHUB_TOKEN in .env to raise it.

import { gunzipSync } from 'node:zlib';

export class RepoError extends Error {}

export type RepoSnapshot = {
  url: string;
  owner: string;
  repo: string;
  commit: string;
  tree: string[];
  files: Record<string, string>;
  truncated: boolean;
};

const MAX_TOTAL_CHARS = 100_000;
const MAX_FILE_CHARS = 12_000;
const MAX_FILES = 60;
const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|out|coverage|\.next|vendor|lib\/forge-std|target|__pycache__)(\/|$)/;
const TEXT_EXT = /\.(md|txt|json|toml|ts|tsx|js|jsx|mjs|cjs|sol|py|rs|go|java|yml|yaml|sh|html|css|env\.example)$/i;
const LOCKFILES = /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock)$/;

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[#?].*|\/tree\/.*)?$/.exec(url.trim());
  if (!m) throw new RepoError('Use a GitHub URL like https://github.com/owner/repo');
  return { owner: m[1], repo: m[2] };
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'agentforge' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, { headers: headers() });
  if (res.status === 404) throw new RepoError('Repo not found or not public');
  if (res.status === 403 || res.status === 429) throw new RateLimitError('GitHub rate limit hit; set GITHUB_TOKEN or retry later');
  if (!res.ok) throw new RepoError(`GitHub error ${res.status}`);
  return (await res.json()) as T;
}

/** Higher number = read first. README and manifests matter most for review. */
function priority(path: string): number {
  const p = path.toLowerCase();
  if (/^readme/.test(p)) return 100;
  if (/(^|\/)(package\.json|foundry\.toml|pyproject\.toml|requirements\.txt|cargo\.toml)$/.test(p)) return 90;
  if (/\.sol$/.test(p)) return 80;
  if (/(^|\/)(index|main|app|server|agent)\.(ts|js|py|mjs)$/.test(p)) return 75;
  if (/^src\//.test(p)) return 60;
  if (/\.(ts|js|py|rs|go)$/.test(p)) return 50;
  return 10;
}

class RateLimitError extends RepoError {}

/**
 * Fallback when the unauthenticated REST API is rate limited: download codeload.github.com/{o}/{r}/tar.gz/HEAD
 * (not counted against the REST limit; verified by running it) and read the commit sha from the tar's pax global header.
 */
async function fetchRepoTarball(url: string, owner: string, repo: string): Promise<RepoSnapshot> {
  const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`, { headers: { 'User-Agent': 'agentforge' }, redirect: 'follow' });
  if (res.status === 404) throw new RepoError('Repo not found or not public');
  if (!res.ok) throw new RepoError(`GitHub tarball error ${res.status}`);
  const tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
  if (tar.length > 80_000_000) throw new RepoError('Repo is too large');
  let commit = '';
  const entries: { path: string; size: number; body: Buffer }[] = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const size = parseInt(h.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    const body = tar.subarray(off + 512, off + 512 + size);
    if (type === 'g') {
      const m = /comment=([0-9a-f]{40})/.exec(body.toString('utf8'));
      if (m) commit = m[1];
    } else if (type === '0' || type === '\0') {
      const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
      const full = prefix ? `${prefix}/${name}` : name;
      entries.push({ path: full.split('/').slice(1).join('/'), size, body });
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  const blobs = entries.filter((e) => e.path && !SKIP_DIRS.test(e.path));
  const treePaths = blobs.map((b) => b.path).slice(0, 400);
  const candidates = blobs
    .filter((b) => TEXT_EXT.test(b.path) && !LOCKFILES.test(b.path) && b.size < 200_000)
    .sort((a, b) => priority(b.path) - priority(a.path))
    .slice(0, MAX_FILES);
  const files: Record<string, string> = {};
  let total = 0;
  let truncated = blobs.length > treePaths.length;
  for (const f of candidates) {
    if (total >= MAX_TOTAL_CHARS) { truncated = true; break; }
    let text = f.body.toString('utf8');
    if (text.length > MAX_FILE_CHARS) { text = text.slice(0, MAX_FILE_CHARS); truncated = true; }
    if (total + text.length > MAX_TOTAL_CHARS) { text = text.slice(0, MAX_TOTAL_CHARS - total); truncated = true; }
    files[f.path] = text;
    total += text.length;
  }
  if (Object.keys(files).length === 0) throw new RepoError('No readable source files found in this repo');
  return { url, owner, repo, commit: commit || 'HEAD', tree: treePaths, files, truncated };
}

export async function fetchRepo(url: string): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(url);
  try {
    return await fetchRepoApi(url, owner, repo);
  } catch (e) {
    if (e instanceof RateLimitError) return fetchRepoTarball(url, owner, repo);
    throw e;
  }
}

async function fetchRepoApi(url: string, owner: string, repo: string): Promise<RepoSnapshot> {
  const meta = await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  const head = await gh<{ sha: string }>(`/repos/${owner}/${repo}/commits/${meta.default_branch}`);
  const tree = await gh<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${head.sha}?recursive=1`,
  );

  const blobs = tree.tree.filter((n) => n.type === 'blob' && !SKIP_DIRS.test(n.path));
  const treePaths = blobs.map((b) => b.path).slice(0, 400);

  const candidates = blobs
    .filter((b) => TEXT_EXT.test(b.path) && !LOCKFILES.test(b.path) && (b.size ?? 0) < 200_000)
    .sort((a, b) => priority(b.path) - priority(a.path))
    .slice(0, MAX_FILES);

  const files: Record<string, string> = {};
  let total = 0;
  let truncated = tree.truncated || blobs.length > treePaths.length;
  for (const f of candidates) {
    if (total >= MAX_TOTAL_CHARS) { truncated = true; break; }
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${head.sha}/${f.path}`, {
      headers: { 'User-Agent': 'agentforge' },
    });
    if (!res.ok) continue;
    let text = await res.text();
    if (text.length > MAX_FILE_CHARS) { text = text.slice(0, MAX_FILE_CHARS); truncated = true; }
    if (total + text.length > MAX_TOTAL_CHARS) { text = text.slice(0, MAX_TOTAL_CHARS - total); truncated = true; }
    files[f.path] = text;
    total += text.length;
  }
  if (Object.keys(files).length === 0) throw new RepoError('No readable source files found in this repo');
  return { url, owner, repo, commit: head.sha, tree: treePaths, files, truncated };
}
