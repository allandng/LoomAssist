import type { ConnectionStatus } from '../../api';
import type { BadgeTone } from '../ui';

/** Human label + tone for a provider connection status. Never show the raw enum. */
export function statusMeta(s: ConnectionStatus): { label: string; tone: BadgeTone } {
  switch (s) {
    case 'connected':    return { label: 'Connected',               tone: 'success' };
    case 'paused':       return { label: 'Paused',                  tone: 'neutral' };
    case 'auth_expired': return { label: 'Needs re-authentication', tone: 'warning' };
    case 'error':        return { label: 'Sync error',              tone: 'error' };
    default:             return { label: String(s),                 tone: 'neutral' };
  }
}

export const DIRECTION_LABEL: Record<'both' | 'pull' | 'push', string> = {
  both: 'Both ways',
  pull: 'Provider → this device',
  push: 'This device → provider',
};
