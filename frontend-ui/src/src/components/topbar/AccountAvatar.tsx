// Phase v3.0 AccountAvatar — top bar right cluster (rightmost, after gear).
// Local mode: greyscale initials chip. Account mode: indigo-tinted avatar.
// Click → /settings/account.

import { useNavigate } from 'react-router-dom';
import { useAccount } from '../../contexts/AccountContext';
import styles from './AccountAvatar.module.css';

function initials(input: string): string {
  const parts = input.split(/[\s.@_-]/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function AccountAvatar() {
  const navigate = useNavigate();
  const { account, status } = useAccount();

  const label = status === 'signedIn' && account
    ? initials(account.display_name || account.email)
    : '·';

  const title = status === 'signedIn' && account
    ? `Signed in as ${account.email}`
    : status === 'local'
      ? 'Local mode — click to sign in'
      : 'Loading…';

  return (
    <button
      className={`${styles.btn} ${status !== 'signedIn' ? styles.local : ''}`}
      onClick={() => navigate('/settings/account')}
      title={title}
      aria-label="Account"
    >
      {label}
    </button>
  );
}
