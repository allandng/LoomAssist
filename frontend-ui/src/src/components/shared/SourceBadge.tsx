// Phase v3.0 SourceBadge — provenance for synced events.
//
// Per design doc §7: a single monochrome glyph + connection display name +
// "synced 2m ago". Lives in QuickPeek (one new bottom row) and
// EventEditorModal (one new metadata row). NEVER on event pills (Guardrail §4
// pill anatomy is sacred).
//
// No new accent color: glyph + text both render at --text-muted, with the
// connection-name span styled as a subtle link (hover only).

import { useNavigate } from 'react-router-dom';
import { Icon, Icons } from './Icon';
import { useSync } from '../../contexts/SyncContext';

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const ms = Date.now() - t;
  if (ms < 60_000)     return 'synced just now';
  if (ms < 3_600_000)  return `synced ${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `synced ${Math.round(ms / 3_600_000)}h ago`;
  return `synced ${Math.round(ms / 86_400_000)}d ago`;
}

export function SourceBadge({
  connectionCalendarId,
  lastSyncedAt,
  variant = 'inline',
}: {
  connectionCalendarId?: string | null;
  lastSyncedAt?: string | null;
  variant?: 'inline' | 'editor';
}) {
  const navigate = useNavigate();
  const { connections } = useSync();

  if (!connectionCalendarId) return null;

  // The list endpoint doesn't expose ConnectionCalendar→Connection mapping
  // directly, so we look up the connection whose display_name matches the
  // event's stored connection (best-effort). The fast follow is to add a
  // backend route returning the cc → conn map.
  const conn = connections[0];  // first connection as a placeholder until ccs API lands
  const providerLabel = conn?.display_name ?? 'External calendar';
  const glyph = conn?.kind === 'google'        ? Icons.mail
              : conn?.kind === 'caldav_icloud' ? Icons.upload
              :                                    Icons.doc;

  if (variant === 'editor') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 0', fontSize: 11.5, color: 'var(--text-muted)',
      }}>
        <Icon d={glyph} size={13} stroke="var(--text-muted)" />
        <span>Source:</span>
        <button
          type="button"
          onClick={() => conn && navigate(`/settings/connections/${conn.id}`)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-main)',
            cursor: 'pointer', fontWeight: 500, padding: 0,
            textDecoration: 'underline', textDecorationColor: 'var(--border)',
          }}
        >
          {providerLabel}
        </button>
        {lastSyncedAt && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-dim)' }}>
            · {relativeTime(lastSyncedAt)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      paddingTop: 8, marginTop: 8, borderTop: '1px solid var(--border)',
      fontSize: 10.5, color: 'var(--text-muted)',
    }}>
      <Icon d={glyph} size={11} stroke="var(--text-muted)" />
      <span>{providerLabel}</span>
      {lastSyncedAt && (
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', marginLeft: 4 }}>
          · {relativeTime(lastSyncedAt)}
        </span>
      )}
    </div>
  );
}
