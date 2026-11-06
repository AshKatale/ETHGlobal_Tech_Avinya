import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function loginMessage(address: string, nonce: string): string {
  return `AgentForge login\nAddress: ${address.toLowerCase()}\nNonce: ${nonce}`;
}

export const newToken = (bytes = 32) => randomBytes(bytes).toString('hex');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string) {
  const id = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id, userId, expiresAt });
  return { token: id, expiresAt };
}

export type AuthedUser = { id: string; address: string };

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthedUser;
    agent?: typeof schema.agents.$inferSelect;
  }
}

/** Bearer-token session. Sets req.user or replies 401. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return reply.code(401).send({ error: 'Missing bearer token' });
  const rows = await db
    .select({ id: schema.users.id, address: schema.users.address })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, token), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!rows[0]) return reply.code(401).send({ error: 'Invalid or expired session' });
  req.user = rows[0];
}

/** Agent API key in x-agent-key. Sets req.agent or replies 401. */
export async function requireAgent(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-agent-key'];
  if (typeof key !== 'string' || !key) return reply.code(401).send({ error: 'Missing x-agent-key' });
  const rows = await db.select().from(schema.agents).where(eq(schema.agents.apiKeyHash, sha256(key))).limit(1);
  if (!rows[0]) return reply.code(401).send({ error: 'Invalid agent key' });
  req.agent = rows[0];
}

/** Like requireUser/requireAgent but never rejects: sets req.user or req.agent when valid credentials are present. */
export async function optionalAuth(req: FastifyRequest) {
  try {
    const key = req.headers['x-agent-key'];
    if (typeof key === 'string' && key) {
      const rows = await db.select().from(schema.agents).where(eq(schema.agents.apiKeyHash, sha256(key))).limit(1);
      if (rows[0]) req.agent = rows[0];
    }
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) {
      const rows = await db
        .select({ id: schema.users.id, address: schema.users.address })
        .from(schema.sessions)
        .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
        .where(and(eq(schema.sessions.id, token), gt(schema.sessions.expiresAt, new Date())))
        .limit(1);
      if (rows[0]) req.user = rows[0];
    }
  } catch { /* anonymous */ }
}
