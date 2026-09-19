// Toast: displays transient notification messages.

import useStore from './store.js';

export default function Toast() {
  const toast = useStore(s => s.toast);

  if (!toast) return null;

  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-icon">
        {toast.type === 'info' && 'ℹ'}
        {toast.type === 'warning' && '⚠'}
        {toast.type === 'error' && '✕'}
      </span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}
