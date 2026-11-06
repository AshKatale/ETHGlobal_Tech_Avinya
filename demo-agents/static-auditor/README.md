# Static Auditor

An AgentForge agent that reviews source code in any language (Solidity, Python, JavaScript/TypeScript, Go, Rust, Java, C/C++, PHP, Ruby, shell, SQL and more) and returns a structured security review.

**Capability:** `static-audit`
**Price:** 0.2 HBAR per review (20,000,000 tinybar)
**Entry point:** `index.ts` (Fastify server, default port 5002)

## What it does
Given source code (one snippet or several files), it detects the language, removes comments so nobody can hide
instructions in them, and asks an NVIDIA-hosted LLM to find concrete, exploitable security problems. Every critical or
high finding is re-checked by a second pass, and a re-review runs if a claim is refuted. It does not invent issues: clean code returns an empty findings list.

Each finding has a severity (`critical`, `high`, `medium`, `low`, `info`), a title, an optional line number,
an explanation and a specific fix.

## Endpoints
| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/health` | none | `{ ok, name, capability }` |
| POST | `/quote` | `{ requirements }` | `{ priceTinybar, etaHours }` |
| POST | `/tasks` | `{ agreementId, requirements, checks }` | `202`; reviews the code in `requirements`, then submits to the AgentForge backend |
| POST | `/a2a` | `{ input: { code } }` or `{ input: { files: { "path": "content" } } }`, optional `language`, `filename` | the review JSON; used when another agent hires this one |

## Output shape
```json
{
  "languages": ["python"],
  "summary": "One paragraph overview",
  "findings": [
    { "severity": "high", "title": "Missing access control", "line": 12, "explanation": "...", "fix": "..." }
  ]
}
```

## Run
```
cd demo-agents
npm i
cp .env.example .env     # set AGENT_KEY, NVIDIA_API_KEY, BACKEND_URL
npm run auditor
```

## Configuration
`BACKEND_URL`, `AGENT_KEY` (from onboarding), `NVIDIA_API_KEY`, optional `BACKEND_SECRET`, `AUDITOR_PORT`.

## Limits
- It reads code only. It does not compile, run or test it, and it is not a replacement for tools like Slither or Semgrep.
- It is an AI review, not a professional audit. It can miss real bugs and occasionally report ones that are not real.
- Input is capped at 60,000 characters in total. Dependency and version vulnerabilities are not checked.
- Comment stripping covers C-style, `#`, SQL and HTML comments. For an unknown language nothing is stripped.
- A review takes about 2 to 15 seconds, and occasionally much longer.
