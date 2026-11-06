# AgentForge contracts (Hedera EVM)

Solidity 0.8.24, Foundry. V1 (`AgreementFactory`/`JobEscrow`) is deployed and unchanged. V2 (`AgreementFactoryV2`/`JobEscrowV2`) is deployed side by side (see `deployments.json` key `hederaTestnetV2`) and has the same external signatures, events and EIP-712 typed data, plus:
on-chain A2A cap (`maxDelegatedBps`, default 3000, cumulative vs price, `CapExceeded`); `delegate` only in `Funded`; `submittedAt` and `refundIfNoVerdict()` after `reviewWindow` (default 72 h); factory rejects `price == 0`, deadlines under `minDeadline` (default 900 s) and a zero verifier; owner setters (`setMaxDelegatedBps`, `setReviewWindow`, `setMinDeadline`, `setVerifier`) affect future escrows only and are bounded.
Tests: `forge test` runs `test/JobEscrow.t.sol` (V1, 13) and `test/JobEscrowV2.t.sol` (V2, 41).

V1 contracts:

- `AgreementFactory`: owned by the backend relayer; creates one `JobEscrow` per agreement.
- `JobEscrow`: holds one job's HBAR. Flow: `fund` -> `submit` -> `release` (PASS) / `refund` (FAIL), with
  `refundAfterDeadline` as an escape hatch and `delegate` for agent-to-agent payments.

All amounts are **tinybar** (1 HBAR = 1e8). On Hedera `msg.value` inside Solidity is tinybar, while wallets and
JSON-RPC send weibar (1e18 per HBAR). Never use `1 ether` here.

Verdicts and delegations are EIP-712 messages signed by the platform verifier key; the domain's
`verifyingContract` is the escrow, so a signature cannot be replayed on another escrow.

## Commands
```
forge install foundry-rs/forge-std --no-git   # first time only
forge build
forge test
# deploy the factory to Hedera testnet (relayer key = owner, constructor arg = verifier address)
forge create src/AgreementFactory.sol:AgreementFactory --rpc-url https://testnet.hashio.io/api \
  --private-key $RELAYER_PRIVATE_KEY --legacy --gas-limit 4000000 --broadcast --constructor-args <VERIFIER_ADDRESS>
```

Notes: `evm_version = "paris"` keeps the bytecode free of newer opcodes. Paying an address that does not exist on
Hedera yet auto-creates it and costs ~600k extra gas, so payout calls need a high gas limit.

V2 deploy: same command with `src/AgreementFactoryV2.sol:AgreementFactoryV2` (constructor arg = verifier address).

Deployed addresses live in `deployments.json`.
