// Structured JSON logs, one per line. Never log keys or full model output.
export function log(level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, agent: process.env.AGENT_NAME ?? 'agent', msg, ...extra }));
}
