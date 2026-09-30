import type { ProviderId } from './ProviderGlyph';

/** Map a backend connection kind / auth provider to a glyph id + human label. */
export function providerMeta(kind: string): { id: ProviderId; label: string } {
  switch (kind) {
    case 'google':         return { id: 'google',    label: 'Google' };
    case 'apple':          return { id: 'apple',     label: 'Apple' };
    case 'microsoft':      return { id: 'microsoft', label: 'Microsoft' };
    case 'caldav_icloud':  return { id: 'icloud',    label: 'iCloud' };
    case 'caldav_generic': return { id: 'caldav',    label: 'CalDAV' };
    case 'email':          return { id: 'email',     label: 'Email' };
    default:               return { id: 'caldav',    label: kind };
  }
}
