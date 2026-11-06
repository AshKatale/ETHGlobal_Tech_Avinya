import type { AgreementStatus } from '@/lib/types';

const INFO: Record<AgreementStatus, [string, string]> = {
  agreed: ['Awaiting funding', 's-warn'],
  funded: ['In progress', 's-info s-live'],
  submitted: ['Submitted', 's-info s-live'],
  verifying: ['Verifying', 's-warn s-live'],
  released: ['Paid · PASS', 's-ok'],
  refunded: ['Refunded · FAIL', 's-bad'],
};

export default function StatusChip({ status, label }: { status: AgreementStatus; label?: string }) {
  const [text, cls] = INFO[status] ?? [status, 's-idle'];
  return <span className={`status ${cls}`}>{label ?? text}</span>;
}
