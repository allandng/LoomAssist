const STORAGE_KEY = 'loom-radar-dismissed';

type Dismissals = Record<number, string>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function read(): Dismissals {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(d: Dismissals): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // ignore quota / unavailable storage
  }
}

export function getDismissed(): Dismissals {
  const raw = read();
  const today = todayIso();
  let mutated = false;
  const out: Dismissals = {};
  for (const [k, dueDate] of Object.entries(raw)) {
    if (typeof dueDate === 'string' && dueDate >= today) {
      out[Number(k)] = dueDate;
    } else {
      mutated = true;
    }
  }
  if (mutated) write(out);
  return out;
}

export function dismiss(assignmentId: number, dueDate: string): void {
  const current = read();
  current[assignmentId] = dueDate;
  write(current);
}
