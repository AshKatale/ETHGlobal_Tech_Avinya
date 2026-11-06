import type { FastifyInstance } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import { isAddress, verifyMessage } from 'viem';
import { z } from 'zod';
import { db, schema } from '../db/index.js';
import { createSession, loginMessage, newToken, requireUser } from '../lib/auth.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/nonce', async (req, reply) => {
    const { address } = z.object({ address: z.string() }).parse(req.body);
    if (!isAddress(address)) return reply.code(400).send({ error: 'Invalid address' });
    const addr = address.toLowerCase();
    const nonce = newToken(16);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.insert(schema.authNonces).values({ address: addr, nonce, expiresAt });
    return { nonce, message: loginMessage(addr, nonce), expiresAt };
  });

  app.post('/auth/verify', async (req, reply) => {
    const body = z.object({ address: z.string(), nonce: z.string(), signature: z.string() }).parse(req.body);
    if (!isAddress(body.address)) return reply.code(400).send({ error: 'Invalid address' });
    const addr = body.address.toLowerCase();

    const rows = await db
      .select()
      .from(schema.authNonces)
      .where(
        and(
          eq(schema.authNonces.address, addr),
          eq(schema.authNonces.nonce, body.nonce),
          eq(schema.authNonces.used, false),
          gt(schema.authNonces.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!rows[0]) return reply.code(400).send({ error: 'Unknown, used or expired nonce' });

    const ok = await verifyMessage({
      address: addr as `0x${string}`,
      message: loginMessage(addr, body.nonce),
      signature: body.signature as `0x${string}`,
    });
    if (!ok) return reply.code(401).send({ error: 'Bad signature' });

    await db
      .update(schema.authNonces)
      .set({ used: true })
      .where(and(eq(schema.authNonces.address, addr), eq(schema.authNonces.nonce, body.nonce)));

    let [user] = await db.select().from(schema.users).where(eq(schema.users.address, addr)).limit(1);
    if (!user) [user] = await db.insert(schema.users).values({ address: addr }).returning();

    const session = await createSession(user.id);
    return { token: session.token, expiresAt: session.expiresAt, user: { id: user.id, address: user.address } };
  });

  app.get('/me', { preHandler: requireUser }, async (req) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, req.user!.id)).limit(1);
    return user;
  });
}
