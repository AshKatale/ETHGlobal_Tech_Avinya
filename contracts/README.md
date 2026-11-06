# AgentForge contracts (Hedera EVM)

Solidity 0.8.24, Foundry. One contract per task covers the whole chain: client -> agent A -> sub-agent B (max 2 hops).

- `TaskFactory`: only the designer (the Solidity agent's wallet) can deploy; it enforces hard bounds on the dynamic terms.
- `TaskEscrow`: locks the client's HBAR. Funding is `fund()` from a wallet, or a native x402 transfer into the contract's
  account followed by `confirmFunding()`. After a verified PASS it pays A (`release`); FAIL or a missed deadline refunds the
  client. A -> B legs (`addSubLeg`) are paid by A over x402 after release; the operator records the Hedera transaction id
  (`recordPayout`) and an unpaid debt is marked defaulted after the grace period (`markDefault`).

Amounts are **tinybar** (1 HBAR = 1e8). On Hedera `msg.value` inside Solidity is tinybar, while wallets and JSON-RPC send
weibar (1e18 per HBAR). Never use `1 ether` here.

Verdicts and sub-leg approvals are EIP-712 messages signed by the platform verifier key; the domain's `verifyingContract`
is the task contract, so a signature cannot be replayed on another task.

## Commands
```
forge install foundry-rs/forge-std --no-git   # first time only
forge build
forge test
# deploy the factory to Hedera testnet (args: designer, operator, verifier addresses)
forge create src/TaskFactory.sol:TaskFactory --rpc-url https://testnet.hashio.io/api \
  --private-key $RELAYER_PRIVATE_KEY --legacy --gas-limit 5000000 --broadcast --constructor-args <DESIGNER> <OPERATOR> <VERIFIER>
```

Notes: `evm_version = "paris"` keeps the bytecode free of newer opcodes. Paying an address that does not exist on Hedera
yet auto-creates it and costs ~600k extra gas, so payout calls need a high gas limit.

Deployed addresses live in `deployments.json`.
