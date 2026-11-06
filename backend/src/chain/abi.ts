import { parseAbi } from 'viem';

export const factoryAbi = parseAbi([
  'function createEscrow(bytes32 agreementId, address client, address agent, uint256 price, uint64 deadline) returns (address escrow)',
  'function escrowOf(bytes32) view returns (address)',
  'event EscrowCreated(bytes32 indexed agreementId, address escrow, address client, address agent, uint256 price)',
]);

export const escrowAbi = parseAbi([
  'function fund() payable',
  'function submit(bytes32 deliverableHash)',
  'function delegate(address subAgent, uint256 amount, uint256 nonce, bytes sig)',
  'function release(uint256 nonce, bytes sig)',
  'function refund(uint256 nonce, bytes sig)',
  'function refundAfterDeadline()',
  // V2 only (JobEscrowV2): exit from Submitted when no verdict arrives within the review window.
  'function refundIfNoVerdict()',
  'function submittedAt() view returns (uint64)',
  'function reviewWindow() view returns (uint64)',
  'function state() view returns (uint8)',
  'function price() view returns (uint256)',
  'function delegated() view returns (uint256)',
  'event Funded(bytes32 indexed agreementId, address client, uint256 amount)',
  'event Submitted(bytes32 indexed agreementId, bytes32 deliverableHash)',
  'event Released(bytes32 indexed agreementId, address agent, uint256 amount)',
  'event Refunded(bytes32 indexed agreementId, address client, uint256 amount)',
  'event Delegated(bytes32 indexed agreementId, address subAgent, uint256 amount)',
]);

// JobEscrow.State enum
export const EscrowState = { Created: 0, Funded: 1, Submitted: 2, Released: 3, Refunded: 4 } as const;
