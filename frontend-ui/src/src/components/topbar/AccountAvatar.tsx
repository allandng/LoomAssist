// AccountAvatar — top bar right cluster (rightmost). Local mode is a
// first-class state: a neutral initials chip. Signed in: accent-tinted avatar
// with the user's initials. Click → /settings/account.

import { useNavigate } from 'react-router-dom';
import { Avatar } from '../ui';
import { useAccount } from '../../contexts/AccountContext';
import styles from './AccountAvatar.module.css';

export function AccountAvatar() {
  const navigate = useNavigate();
  const { account, status } = useAccount();

  const signedIn = status === 'signedIn' && !!account;
  const name = signedIn ? (account!.display_name || account!.email) : null;

  const title = signedIn
    ? `Signed in as ${account!.email}`
    : status === 'local'
      ? 'Local mode — open account settings'
      : status === 'loading'
        ? 'Loading account…'
        : 'Account';

  return (
    <button
      type="button"
      className={styles.btn}
      onClick={() => navigate('/settings/account')}
      title={title}
      aria-label={title}
    >
      <Avatar name={name} size={26} className={signedIn ? undefined : styles.local} />
    </button>
  );
}
