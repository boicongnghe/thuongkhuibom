import { useState } from 'react';
import { api } from '../api';
import { formatCurrency, parseVnd } from '../utils';

const LOCKED = ['completed', 'cancelled'];

// Ô nhập tiền nhanh ngay trên đơn vừa chốt: gõ "189k", "1tr2", "250.000" rồi Enter
export default function QuickAmount({ order, onSaved, onError }) {
  const [editing, setEditing] = useState(!order.amount);
  const [text, setText]       = useState('');
  const [saving, setSaving]   = useState(false);

  const locked  = LOCKED.includes(order.status);
  const parsed  = parseVnd(text);
  const invalid = text.trim() !== '' && parsed === null;

  if (locked || (!editing && order.amount)) {
    return (
      <button
        type="button"
        className="qa-amount"
        disabled={locked}
        onClick={() => { setText(''); setEditing(true); }}
        title={locked ? 'Đơn đã hoàn thành / huỷ — khoá số tiền' : 'Sửa số tiền'}
      >
        {order.amount ? formatCurrency(order.amount) : '—'}
      </button>
    );
  }

  async function save() {
    if (saving || parsed === null) return;
    setSaving(true);
    try {
      const updated = await api.updateOrderAmount(order._id, { amount: parsed });
      setEditing(false);
      setText('');
      onSaved?.(updated);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSaving(false);
    }
  }

  const inputId = `qa-${order._id}`;
  return (
    <form className="qa-form" onSubmit={e => { e.preventDefault(); save(); }}>
      <label htmlFor={inputId} className="sr-only">Số tiền đơn {order.orderNumber}</label>
      <input
        id={inputId}
        className={`qa-input${invalid ? ' invalid' : ''}`}
        inputMode="decimal"
        placeholder="Nhập tiền: 189k, 1tr2"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape' && order.amount) setEditing(false); }}
        disabled={saving}
        aria-invalid={invalid || undefined}
        aria-describedby={`${inputId}-hint`}
      />
      <button type="submit" className="qa-save" disabled={saving || parsed === null}>
        {saving ? '...' : 'Lưu'}
      </button>
      <span id={`${inputId}-hint`} className={`qa-hint${invalid ? ' invalid' : ''}`}>
        {invalid ? 'Không hiểu số tiền' : parsed !== null ? `= ${formatCurrency(parsed)}` : ''}
      </span>
    </form>
  );
}
