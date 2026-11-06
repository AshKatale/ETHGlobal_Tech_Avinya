// Fetch a GitHub repo (public without auth, private with the lister's OAuth token), using the GitHub REST API + raw.githubusercontent.com.
// Endpoints used: GET /repos/{o}/{r}, GET /repos/{o}/{r}/commits/{ref}, GET /repos/{o}/{r}/git/trees/{sha}?recursive=1.
// Unauthenticated limit is 60 req/hour (already hit during testing). OAuth tokens get 5000/hour.

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

function headers(token?: string | null, accept = 'application/vnd.github+json'): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, 'User-Agent': 'agentforge', 'X-GitHub-Api-Version': '2022-11-28' };
  const t = token ?? process.env.GITHUB_TOKEN;
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

/** Map a GitHub failure to a clear message. Exported so it can be unit tested. */
export function githubErrorMessage(status: number, hasToken: boolean, rateRemaining?: string | null): string {
  if (status === 401) return 'GitHub token is invalid or revoked; reconnect GitHub';
  if (status === 429 || (status === 403 && rateRemaining === '0')) return 'GitHub rate limit hit; connect GitHub or retry later';
  if (status === 404 || status === 403) {
    return hasToken
      ? 'Repo not found, or your connected GitHub account cannot access it'
      : 'Repo not found or private; connect GitHub to use a private repo';
  }
  return `GitHub error ${status}`;
}

async function gh<T>(path: string, token?: string | null): Promise<T> {
  const hasToken = !!(token ?? process.env.GITHUB_TOKEN);
  // GitHub occasionally answers 5xx or times out; a short retry avoids failing a whole benchmark for that.
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://api.github.com${path}`, { headers: headers(token), signal: AbortSignal.timeout(20_000) });
      if (res.status >= 500) { lastError = `GitHub error ${res.status}`; }
      else if (!res.ok) throw new RepoError(githubErrorMessage(res.status, hasToken, res.headers.get('x-ratelimit-remaining')));
      else return (await res.json()) as T;
    } catch (e) {
      if (e instanceof RepoError) throw e; // not found / rate limited / bad token: retrying will not help
      lastError = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new RepoError(lastError);
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

/** `token` is the lister's OAuth token (private repos). Without one, only public repos work. */
export async function fetchRepo(url: string, token?: string | null): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(url);
  const meta = await gh<{ default_branch: string }>(`/repos/${owner}/${repo}`, token);
  const head = await gh<{ sha: string }>(`/repos/${owner}/${repo}/commits/${meta.default_branch}`, token);
  const tree = await gh<{ tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean }>(
    `/repos/${owner}/${repo}/git/trees/${head.sha}?recursive=1`,
    token,
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
    // Authenticated: raw blob via the API (works for private repos). Public: raw.githubusercontent.com (no API quota).
    const res = token
      ? await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs/${f.sha}`, { headers: headers(token, 'application/vnd.github.raw+json') })
      : await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${head.sha}/${f.path}`, { headers: { 'User-Agent': 'agentforge' } });
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
