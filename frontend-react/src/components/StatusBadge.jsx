import { STATUS_LABELS } from '../constants';

export default function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || { label: status, cls: '' };
  return <span className={`status-badge ${s.cls}`}>{s.label}</span>;
}
