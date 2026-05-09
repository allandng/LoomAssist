const PROMPTED_KEY = 'loom-takeaway-prompted';
const MUTED_KEY = 'loom-takeaway-muted';

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // ignore quota / unavailable storage
  }
}

function occurrenceKey(eventId: number, occurrenceDate: string): string {
  return `${eventId}:${occurrenceDate}`;
}

export function wasPrompted(eventId: number, occurrenceDate: string): boolean {
  return readSet(PROMPTED_KEY).has(occurrenceKey(eventId, occurrenceDate));
}

export function markPrompted(eventId: number, occurrenceDate: string): void {
  const set = readSet(PROMPTED_KEY);
  set.add(occurrenceKey(eventId, occurrenceDate));
  writeSet(PROMPTED_KEY, set);
}

export function isMuted(eventId: number): boolean {
  return readSet(MUTED_KEY).has(String(eventId));
}

export function muteEvent(eventId: number): void {
  const set = readSet(MUTED_KEY);
  set.add(String(eventId));
  writeSet(MUTED_KEY, set);
}
