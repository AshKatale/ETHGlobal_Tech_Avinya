import { parseAbi } from 'viem';

// TaskEscrow.State enum
export const EscrowState = { Created: 0, Funded: 1, Submitted: 2, Released: 3, Refunded: 4 } as const;

// ---------------- single-contract tasks (TaskFactory / TaskEscrow) ----------------
export const taskEscrowAbi = parseAbi([
  'function fund() payable',
  'function confirmFunding()',
  'function addSubLeg(address subAgent, uint256 subPrice, bytes32 subTermsHash, uint256 nonce, bytes sig) returns (uint256 legId)',
  'function submit(bytes32 deliverableHash)',
  'function release(uint256 nonce, bytes sig)',
  'function refund(uint256 nonce, bytes sig)',
  'function refundAfterDeadline()',
  'function recordPayout(uint256 legId, string hederaTxId)',
  'function markDefault(uint256 legId)',
  'function state() view returns (uint8)',
  'function legCount() view returns (uint256)',
  'function leg(uint256 legId) view returns (address payee, uint256 legPrice, bytes32 termsHash, uint8 status)',
  'function owed(uint256 legId) view returns (bool)',
  'function subTotal() view returns (uint256)',
  'function price() view returns (uint256)',
  'function maxSubBps() view returns (uint16)',
  'function maxSubLegs() view returns (uint8)',
  'function payoutGrace() view returns (uint32)',
  'function releasedAt() view returns (uint64)',
  'function deadline() view returns (uint64)',
  'event Funded(bytes32 indexed agreementId, address client, uint256 amount)',
  'event SubLegAdded(bytes32 indexed agreementId, uint256 legId, address subAgent, uint256 price, bytes32 termsHash)',
  'event Submitted(bytes32 indexed agreementId, bytes32 deliverableHash)',
  'event Released(bytes32 indexed agreementId, address agent, uint256 amount)',
  'event Refunded(bytes32 indexed agreementId, address client, uint256 amount)',
  'event PayoutRecorded(bytes32 indexed agreementId, uint256 legId, address payee, uint256 price, string hederaTxId)',
  'event PayoutDefaulted(bytes32 indexed agreementId, uint256 legId, address debtor, address payee, uint256 price)',
]);

// LegStatus enum
export const LegStatus = { Pending: 0, Paid: 1, Defaulted: 2 } as const;
