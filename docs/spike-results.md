# Spike results

Format: `[V] fact | source | checked` or `[U] fact | what would settle it`. Probe scripts are in `spikes/`.

## 1. NVIDIA (model nvidia/nemotron-3.5-super-vl-120b-a12b, base integrate.api.nvidia.com/v1)
[V] The openai package (v7.53.0 installed in backend) forwards an unknown body field: sending `chat_template_kwargs: {enable_thinking:false}` was accepted and took effect (reasoning_tokens 0, no reasoning field, 10 completion tokens vs 85 with 74 reasoning tokens without it) | source: spikes/nvidia-probe.mjs basic | checked: 2026-11-06
[V] Latency, tiny prompt: 380 ms with thinking off; 12.7 s with thinking on (first call, may include cold start); 1.06 s with response_format json_object (thinking still on) | source: spikes/nvidia-probe.mjs basic | checked: 2026-11-06
[V] `response_format: {type:"json_object"}` is accepted (HTTP 200, valid JSON returned). Whether it strictly enforces JSON on hard prompts is not tested; keep extractJson + Zod retry | source: spikes/nvidia-probe.mjs basic | checked: 2026-11-06
[V] A ~100 KB prompt (50,036 prompt tokens, because "x " tokenises to 1 token per char pair; real prose is about 25k tokens) with thinking off returned in 12.4 s, one sample | source: spikes/nvidia-probe.mjs big | checked: 2026-11-06
[U] Latency for a realistic 100 KB code prompt producing a long (several KB) JSON answer | what would settle it: run a benchmark-generation call with real repo text and max_tokens 4096, 3 samples
Note: json_mode alone does not disable thinking; backend/src/lib/nvidia.ts already sends enable_thinking:false, which is the faster path.

## 2. 0G Storage
[U] Upload and download round trip with tiny JSON | what would settle it: BACKEND_0G_PRIVATE_KEY in backend/.env is empty (checked 2026-11-06), so no signer and no gas for the flow contract. Fund a testnet-only key with Galileo 0G, set it, then run a script using MemData, merkleTree(), upload, check 'rootHash' in tx, download(root, path, true). No probe was written or faked.

## 3. Hedera: contract creates contract
[V] AgreementFactory 0.0.11337959 (0x34a34ad1feb783faf5b64249ef2699a4cf9ff39d) emitted 7 EscrowCreated logs; each escrow address resolves on the mirror node to its own contract id with bytecode (e.g. 0x91b0bb65f9979458be26385523f00f7f680bd9bd = 0.0.11337966; 0xdc47497c34a2eefe2b88e97b996cc116aa6a303f = 0.0.11338123). Example create tx 0xc611a71ceccb09ec9896b5ae02de1f3f91f19eeee2f5f8de4a2f2d89d319ffc4 | source: GET /api/v1/contracts/{factory}/results/logs and /contracts/{escrow}; spikes/hedera-mirror-evidence.mjs | checked: 2026-11-06

## 4. Hedera: EIP-712 ecrecover verification
[V] Escrow 0.0.11338123 release tx 0x4d11bbc05d8cc5d002a5a9a7893351060ae6de05daaa5d214f24153c96331309 (release(uint256,bytes), SUCCESS, gas_used 66,833) shows a depth-1 call to precompile 0x...01 (ecrecover, 3000 gas) whose result is the verifier 0x2d879491da59a0f5aa95ef719f3d3c679c08e37f, then a 0.8 HBAR (80000000 tinybar) value send and a Released log. Refund path: tx 0x2fd3e1989a95e2d504a4010db17e171f995f684078028641d5bfe5c54e5ad288 (Refunded, gas_used 66,902) | source: mirror /contracts/results/{hash} and /actions | checked: 2026-11-06

## 5. Hedera: extra gas to pay an address with no account
[U] Cost of a contract value-send to an EVM address that has no account | what would settle it: needs a real testnet tx (chain lock). Call a throwaway escrow release to a fresh random agent address and compare gas_used and charged fee with the 66,833 baseline. Evidence so far: in the release above the recipient account 0.0.11338127 already existed (created 16 s earlier), and the value-send sub-call cost 0 gas. The docs page for auto account creation covers only TransferTransaction to an alias (fees charged in tinybars to the payer) and says nothing on contract-initiated creation (docs.hedera.com/hedera/core-concepts/accounts/auto-account-creation, 2026-11-06). Safe default: backend pre-creates or pre-funds the agent account (a plain transfer to the agent EVM address from the relayer) before release. Handoff written.

## 6. x402 header names
[V] x402 v2 HTTP transport: PAYMENT-REQUIRED (server to client), PAYMENT-SIGNATURE (client request), PAYMENT-RESPONSE (settlement response); v1 spellings X-PAYMENT and X-PAYMENT-RESPONSE | source: github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md | checked: 2026-11-06
[U] Hedera HBAR payload fields and the payTo format (account id vs EVM address) | what would settle it: the official @x402/hedera scheme spec or package source; only third-party repos found so far (r402-hedera, altaga/h402)

## Web content notes
The Hedera auto-account-creation page carried an "Agent Instructions" block aimed at AI tools; ignored. The x402 spec page had none.

## Carried over from the agent definition (confirmed 2026-11-06, not re-checked)
HBAR units (tinybar vs weibar, 10^10), plain transfer does not run receive(), ECDSA accounts and ecrecover, mirror logs shape, 0G SDK call order.
