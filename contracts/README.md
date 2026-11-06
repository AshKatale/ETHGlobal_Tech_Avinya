# AgentForge contracts (Hedera EVM)

Solidity 0.8.24, Foundry. Two contracts:

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

Deployed addresses live in `deployments.json`.
