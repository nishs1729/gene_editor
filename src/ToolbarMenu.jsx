// A toolbar dropdown: one button that opens a panel of items beneath it.
// The toolbar has more actions than fit as buttons, and grouping them keeps the
// bar readable at the narrow widths the canvas wants to leave for itself.

import { useEffect, useRef, useState } from 'react';

/**
 * @param {object} props
 * @param {string} props.label - button text
 * @param {string} [props.title] - tooltip
 * @param {boolean} [props.disabled]
 * @param {'left'|'right'} [props.align] - which edge the panel hangs from
 * @param {'down'|'up'} [props.drop] - 'up' for a menu in the status bar, which has
 *   no room beneath it
 * @param {string} [props.className] - extra classes for the button
 * @param {function} props.children - render prop, called with `close`
 */
export default function ToolbarMenu({
  label, title, disabled = false, align = 'left', drop = 'down', className = '', children,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't also leave fullscreen
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  // A disabled menu that is already open would strand its panel on screen.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="toolbar-menu" ref={ref}>
      <button
        className={`toolbar-btn ${className} ${open ? 'toolbar-btn-active' : ''}`}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
        <span className="toolbar-menu-caret" aria-hidden="true">{drop === 'up' ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div
          className={`toolbar-menu-panel ${align === 'right' ? 'align-right' : ''} ${drop === 'up' ? 'drop-up' : ''}`}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** One action row inside a menu panel. */
export function MenuItem({ onClick, disabled = false, title, children }) {
  return (
    <button className="menu-item" role="menuitem" onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/** A menu row that reads as on or off. */
export function MenuToggle({ checked, onClick, disabled = false, title, children }) {
  return (
    <button
      className={`menu-item ${checked ? 'menu-item-checked' : ''}`}
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <span className="menu-check" aria-hidden="true">{checked ? '✓' : ''}</span>
      {children}
    </button>
  );
}

/** A labelled divider between groups of items. */
export function MenuSection({ children }) {
  return <div className="menu-section">{children}</div>;
}
