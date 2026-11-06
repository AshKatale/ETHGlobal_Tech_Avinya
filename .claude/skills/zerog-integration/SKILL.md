---
name: zerog-integration
description: Use when writing or debugging code that touches 0G: Galileo testnet contracts, 0G Storage uploads/downloads, or 0G Compute Router inference in AgentForge.
---

# 0G integration (AgentForge)

Facts below were read from docs.0g.ai on 2026-11-06. Re-check anything marked [VERIFY] against the live docs or the `0g-docs` MCP server before relying on it. Never fake an inference or storage result; show an error and queue it.

## Chain (Galileo testnet)
- Chain ID `16602`, RPC `https://evmrpc-testnet.0g.ai`, explorer `https://chainscan-galileo.0g.ai`, storage explorer `https://storagescan-galileo.0g.ai`.
- Faucet `https://faucet.0g.ai`: about 0.1 0G per wallet per day. Claim early.
- Foundry needs `evm_version = "cancun"`. "invalid opcode" usually means the wrong EVM version.
- Contract verification: `forge verify-contract --verifier custom --verifier-url https://chainscan-galileo.0g.ai/open/api`.

## Storage
- Package `@0gfoundation/0g-storage-ts-sdk` (ESM only, needs `ethers`). Do not use `@0gfoundation/0g-ts-sdk` (name from the PRD, wrong).
- Turbo indexer `https://indexer-storage-testnet-turbo.0g.ai`.
- Upload: `ZgFile.fromFilePath` → `file.merkleTree()` (required) → `indexer.upload(file, RPC_URL, signer)`. Keep `tree.rootHash()`; you need it to download.
- Download: `indexer.download(rootHash, outPath, true)` (the `true` verifies Merkle proofs). It does not decrypt and does not run in browsers.
- Storage is public. Never upload secrets or unencrypted confidential data.

## Inference (Compute Router)
- Base URL `https://router-api.0g.ai/v1`, OpenAI-compatible. Key (`sk-...`) from https://pc.0g.ai after depositing 0G.
- Send header `X-0G-Provider-Trust-Mode: verified` and body field `verify_tee: true`.
- Save `x_0g_trace.request_id` from every response in `inference_calls`, with prompt and output hashes. [VERIFY] There is no documented signed-receipt object; `ZG-Res-Key` plus `@0gfoundation/0g-compute-ts-sdk` `processResponse` gives independent verification.
- `503 no_provider_for_trust_mode` means no provider at that tier; it never falls back silently.
- [VERIFY] Whether the hackathon's "Private Computer" is the same product as the Compute Router.

## Rules
- All 0G writes go through `chain_outbox`; the relayer pays 0G gas.
- Money-related state changes only after the Hedera event is indexed. 0G being down must not block the money flow.
