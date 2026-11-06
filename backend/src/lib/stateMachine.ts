// agreed -> funded -> submitted -> verifying -> released | refunded
// 'funded', 'released' and 'refunded' are set only from indexed on-chain events.
export type AgreementStatus = 'agreed' | 'funded' | 'submitted' | 'verifying' | 'released' | 'refunded';

const allowed: Record<AgreementStatus, AgreementStatus[]> = {
  agreed: ['funded'],
  funded: ['submitted', 'refunded'], // refunded here = deadline refund
  submitted: ['verifying'],
  verifying: ['released', 'refunded', 'submitted'], // back to submitted allows a retry after an ERROR
  released: [],
  refunded: [],
};

export function canTransition(from: AgreementStatus, to: AgreementStatus): boolean {
  return allowed[from]?.includes(to) ?? false;
}

