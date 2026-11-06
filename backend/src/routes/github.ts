import type { FastifyInstance } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { newToken, requireUser } from '../lib/auth.js';

// GitHub OAuth web flow:
//   1. GET  /github/connect  (logged in) -> { url }; the browser goes to GitHub's authorize page
//   2. GitHub redirects the browser to GET /github/callback?code&state
//   3. We exchange the code for a token, store it, and redirect to the frontend.
// Scope "repo" is what GitHub requires to read private repos (we only ever read).
const STATE_TTL_MS = 10 * 60 * 1000;

const callbackUrl = () => env.GITHUB_CALLBACK_URL ?? `http://localhost:${env.PORT}/github/callback`;
const frontendUrl = () => env.FRONTEND_URL ?? env.CORS_ORIGIN.split(',')[0];

/** Token for a user's connected GitHub account, or null. Used by benchmark and verification. */
export async function getGithubToken(userId: string): Promise<string | null> {
  const [row] = await db.select().from(schema.githubConnections).where(eq(schema.githubConnections.userId, userId)).limit(1);
  return row?.accessToken ?? null;
}

const ghHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'agentforge' });

export async function githubRoutes(app: FastifyInstance) {
  app.get('/github/connect', { preHandler: requireUser }, async (req, reply) => {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
      return reply.code(503).send({ error: 'GitHub OAuth is not configured (set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET)' });
    }
    const state = newToken(16);
    await db.insert(schema.githubOauthStates).values({ state, userId: req.user!.id, expiresAt: new Date(Date.now() + STATE_TTL_MS) });
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', callbackUrl());
    url.searchParams.set('scope', 'repo read:user');
    url.searchParams.set('state', state);
    return { url: url.toString() };
  });

  app.get('/github/callback', async (req, reply) => {
    const fail = (reason: string) => reply.redirect(`${frontendUrl()}?github=error&reason=${encodeURIComponent(reason)}`);
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    if (q.error) return fail(q.error);
    if (!q.code || !q.state) return fail('missing_code_or_state');
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail('not_configured');

    // The state is single use: delete it and make sure it was still valid.
    const [st] = await db
      .delete(schema.githubOauthStates)
      .where(and(eq(schema.githubOauthStates.state, q.state), gt(schema.githubOauthStates.expiresAt, new Date())))
      .returning();
    if (!st) return fail('invalid_or_expired_state');

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'agentforge' },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: q.code, redirect_uri: callbackUrl() }),
      });
      const tok = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; scope?: string; error?: string };
      if (!tokenRes.ok || !tok.access_token) return fail(tok.error ?? `token_exchange_${tokenRes.status}`);

      const meRes = await fetch('https://api.github.com/user', { headers: ghHeaders(tok.access_token) });
      if (!meRes.ok) return fail(`github_user_${meRes.status}`);
      const me = (await meRes.json()) as { login: string; id: number };

      await db
        .insert(schema.githubConnections)
        .values({ userId: st.userId, githubLogin: me.login, githubId: String(me.id), accessToken: tok.access_token, scope: tok.scope ?? '' })
        .onConflictDoUpdate({
          target: schema.githubConnections.userId,
          set: { githubLogin: me.login, githubId: String(me.id), accessToken: tok.access_token, scope: tok.scope ?? '' },
        });
      return reply.redirect(`${frontendUrl()}?github=connected&login=${encodeURIComponent(me.login)}`);
    } catch (e) {
      req.log.error(e);
      return fail('github_unreachable');
    }
  });

  // Never returns the token itself.
  app.get('/github/status', { preHandler: requireUser }, async (req) => {
    const [row] = await db.select().from(schema.githubConnections).where(eq(schema.githubConnections.userId, req.user!.id)).limit(1);
    return { configured: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET), connected: !!row, login: row?.githubLogin ?? null };
  });

  // Repo picker: the user's most recently updated repos (public and private they can access).
  app.get('/github/repos', { preHandler: requireUser }, async (req, reply) => {
    const token = await getGithubToken(req.user!.id);
    if (!token) return reply.code(400).send({ error: 'GitHub is not connected' });
    const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=50', { headers: ghHeaders(token) });
    if (res.status === 401) {
      await db.delete(schema.githubConnections).where(eq(schema.githubConnections.userId, req.user!.id));
      return reply.code(401).send({ error: 'GitHub token was revoked; connect GitHub again' });
    }
    if (!res.ok) return reply.code(502).send({ error: `GitHub error ${res.status}` });
    const repos = (await res.json()) as { full_name: string; html_url: string; private: boolean; description: string | null; updated_at: string }[];
    return repos.map((r) => ({ fullName: r.full_name, url: r.html_url, private: r.private, description: r.description, updatedAt: r.updated_at }));
  });

  app.delete('/github/connection', { preHandler: requireUser }, async (req) => {
    await db.delete(schema.githubConnections).where(eq(schema.githubConnections.userId, req.user!.id));
    return { connected: false };
  });
}
