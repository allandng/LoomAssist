import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './ModalShell.module.css';
import { Icon, Icons } from '../shared/Icon';

interface ModalShellProps {
  title: string;
  width?: number;
  children: ReactNode;
  onClose: () => void;
}

export function ModalShell({ title, width = 520, children, onClose }: ModalShellProps) {
  // Escape key closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className={styles.backdrop} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel} style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <Icon d={Icons.x} size={14} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className={styles.fieldLabel}>{children}</div>;
}
