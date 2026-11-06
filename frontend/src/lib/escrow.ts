import { parseAbi } from 'viem';

// The one function the browser calls on the task contract (contracts/src/TaskEscrow.sol).
// msg.sender must be the client and msg.value must equal the price exactly (tinybar inside the contract,
// so the wallet sends price x 10^10 weibar; see toWeibar in money.ts).
export const taskEscrowAbi = parseAbi(['function fund() payable']);

// Hedera's JSON-RPC relay estimates gas poorly, so set a limit explicitly. Unused gas is not charged.
export const FUND_GAS = 400_000n;
