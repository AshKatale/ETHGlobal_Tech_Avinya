# AI tooling setup: Hedera MCP, Chrome DevTools MCP, 0G docs MCP, and skills

## What gets installed
| Tool | Type | Source | Status |
|---|---|---|---|
| Hedera Docs MCP | Remote HTTP, no key | https://docs.hedera.com/mcp | Official (Hedera) |
| Hedera Hosted (Agent Kit) MCP | Remote HTTP, wallet sign-in | https://agentic-testnet-mcp.hedera.com/mcp | Official (Hedera); testnet only; no spend caps |
| Hedera skills | Claude Code plugins | github.com/hedera-dev/hedera-skills | Official (Hedera) |
| Chrome DevTools MCP + skills | Local stdio (npx) / plugin | npm `chrome-devtools-mcp`, github.com/ChromeDevTools/chrome-devtools-mcp | Official (Chrome DevTools team) |
| 0G docs MCP | Local stdio via `mcpdoc` serving 0G llms.txt | docs.0g.ai/llms.txt, build.0g.ai/llms.txt | 0G has **no official MCP**; mcpdoc is LangChain's llms.txt server |
| 0G project skill | Repo skill | `.claude/skills/zerog-integration` | Written for this repo |

## Prerequisites
- Node.js 22 LTS (Chrome DevTools MCP needs Node LTS; 0G's `0gpc` CLI needs 22+)
- Google Chrome stable
- `uv` (for `uvx mcpdoc`): `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Claude Code

## Steps
1. Copy these files into the repo root (keep paths): `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `CLAUDE.md`, `.claude/skills/zerog-integration/SKILL.md`, `scripts/setup-ai-tooling.sh`, `docs/AI_TOOLING_SETUP.md`.
2. Run `./scripts/setup-ai-tooling.sh`.
3. Start `claude` in the repo; approve the project MCP servers when asked.
4. In Claude Code run the `/plugin` commands the script prints.
5. `/mcp` → `hedera-testnet` → Authenticate with a **testnet-only** HashPack/Kabila account.
6. `claude mcp list` → four servers Connected.

## Equivalent one-off CLI commands (if you prefer not to commit .mcp.json)
```bash
claude mcp add --transport http hedera-docs https://docs.hedera.com/mcp
claude mcp add --transport http hedera-testnet https://agentic-testnet-mcp.hedera.com/mcp
claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --isolated --no-usage-statistics --no-performance-crux
claude mcp add 0g-docs -- uvx --from mcpdoc mcpdoc --urls "0GDocs:https://docs.0g.ai/llms.txt" "0GBuild:https://build.0g.ai/llms.txt" --allowed-domains docs.0g.ai build.0g.ai 0g.ai --transport stdio
```
Add `--scope project` to write them into `.mcp.json`.

## Optional extras
- 0G Compute Router for inference (and optionally to run Claude Code on 0G models): base URL `https://router-api.0g.ai`, key from pc.0g.ai → Dashboard → API Keys. Setup helper: `npx @0gfoundation/0gpc@latest`. Do not set it as your main Claude Code backend unless you mean to.
- Community 0G MCP servers exist (e.g. Econyx-ai/0g-mcp-server: docs + Storage upload + Compute service listing, run with Bun). They are not official and not reviewed; read the code before running one with a funded key.
- 0G "Agents That Pay for Themselves" track uses the comfy Claude Code plugin (github.com/0g-axion/comfy-plugin) — only if you enter that track.

## Safety notes
- `hedera-testnet` has no per-transaction or daily caps; your wallet approval is the only control. Testnet account only.
- Chrome DevTools MCP exposes browser content to the agent. `--isolated` uses a throwaway profile; don't log into personal accounts in it. Usage stats and CrUX trace upload are disabled by the flags above.
- Verify flags with `npx chrome-devtools-mcp@latest --help` and `uvx --from mcpdoc mcpdoc --help`; versions change.

## Notes for this repo (Windows)
- `.mcp.json` wraps `npx` as `cmd /c npx ...` because Windows cannot spawn `npx` directly.
- `.cursor/mcp.json`, `.vscode/mcp.json` and `scripts/setup-ai-tooling.sh` were not created (Claude Code only).
- `0g-docs` needs `--with "mcp<2"`: plain `uvx --from mcpdoc mcpdoc` crashes on mcp 2.x (`No module named 'mcp.server.fastmcp'`). `.mcp.json` already includes the pin; use it in the one-off CLI command too.
- The Hedera and Chrome DevTools plugins are installed with `/plugin` inside Claude Code (see Steps 4).
