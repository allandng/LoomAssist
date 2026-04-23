import type {
  Event, EventCreate, EventUpdate,
  Calendar, CalendarCreate, CalendarUpdate,
  Task, TaskCreate, TaskUpdate,
  EventTemplate, TemplateCreate,
  AvailabilityRequest, AvailabilityCreate, AmendmentResponse,
  SkipDatePayload,
  LogEntry, CrashFlag,
  ImportResult, SyllabusEvent,
  WellnessAnalysis,
} from './types';

const BASE = 'http://localhost:8000';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} → ${res.status}`), { status: res.status });
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---- Events ----

export const listEvents = (): Promise<Event[]> =>
  req('GET', '/events/');

export const createEvent = (payload: EventCreate): Promise<Event> =>
  req('POST', '/events/', payload);

export const updateEvent = (id: number, payload: EventUpdate): Promise<Event> =>
  req('PUT', `/events/${id}`, payload);

export const deleteEvent = (id: number): Promise<void> =>
  req('DELETE', `/events/${id}`);

export const skipEventDate = (id: number, payload: SkipDatePayload): Promise<Event> =>
  req('POST', `/events/${id}/skip-date`, payload);

// ---- Calendars (Timelines) ----

export const listCalendars = (): Promise<Calendar[]> =>
  req('GET', '/calendars/');

export const createCalendar = (payload: CalendarCreate): Promise<Calendar> =>
  req('POST', '/calendars/', payload);

export const updateCalendar = (id: number, payload: CalendarUpdate): Promise<Calendar> =>
  req('PUT', `/calendars/${id}`, payload);

export const deleteCalendar = (id: number): Promise<void> =>
  req('DELETE', `/calendars/${id}`);

// ---- Tasks ----

export const listTasks = (): Promise<Task[]> =>
  req('GET', '/tasks/');

export const createTask = (payload: TaskCreate): Promise<Task> =>
  req('POST', '/tasks/', payload);

export const updateTask = (id: number, payload: TaskUpdate): Promise<Task> =>
  req('PUT', `/tasks/${id}`, payload);

export const deleteTask = (id: number): Promise<void> =>
  req('DELETE', `/tasks/${id}`);

// ---- Templates ----

export const listTemplates = (): Promise<EventTemplate[]> =>
  req('GET', '/templates/');

export const createTemplate = (payload: TemplateCreate): Promise<EventTemplate> =>
  req('POST', '/templates/', payload);

export const deleteTemplate = (id: number): Promise<void> =>
  req('DELETE', `/templates/${id}`);

// ---- Availability ----

export const createAvailability = (
  payload: AvailabilityCreate,
): Promise<{ token: string; share_url: string }> =>
  req('POST', '/availability', payload);

export const getAvailability = (token: string): Promise<AvailabilityRequest> =>
  req('GET', `/availability/${token}`);

export const confirmAvailability = (
  token: string,
  payload: { slot: { date: string; start: string; end: string } },
): Promise<AvailabilityRequest> =>
  req('POST', `/availability/${token}/confirm`, payload);

export const amendAvailability = (
  token: string,
  payload: { slot: { date: string; start: string; end: string } },
): Promise<AvailabilityRequest> =>
  req('POST', `/availability/${token}/amend`, payload);

export const respondAmendment = (
  token: string,
  payload: AmendmentResponse,
): Promise<AvailabilityRequest> =>
  req('POST', `/availability/${token}/respond-amendment`, payload);

// ---- Import / Export ----

export async function importICS(
  file: File,
  calendarId: number,
): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('calendar_id', String(calendarId));
  const res = await fetch(`${BASE}/integrations/import-ics-file/`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`import-ics → ${res.status}`);
  return res.json();
}

export const exportTimelines = (): Promise<Blob> =>
  fetch(`${BASE}/export/timelines/`).then(r => r.blob());

export async function extractSyllabus(file: File): Promise<SyllabusEvent[]> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/documents/extract-syllabus/`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`extract-syllabus → ${res.status}`);
  const data = await res.json();
  return data.events ?? data;
}

export const saveApprovedEvents = (
  events: SyllabusEvent[],
): Promise<{ created: number; event_ids: number[] }> =>
  req('POST', '/documents/save-approved-events/', { events });

// ---- AI / Voice ----

export async function transcribeAudio(blob: Blob): Promise<{ text: string; event?: Partial<EventCreate> }> {
  const form = new FormData();
  form.append('audio', blob, 'recording.webm');
  const res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`transcribe → ${res.status}`);
  return res.json();
}

export const parseIntent = (
  text: string,
): Promise<{ event?: Partial<EventCreate>; action?: string }> =>
  req('POST', '/intent', { text });

// ---- Analytics ----

export const analyzeSchedule = (): Promise<WellnessAnalysis> =>
  req('POST', '/schedule/analyze', {});

// ---- Logging ----

export const sendLog = (entry: LogEntry): Promise<void> =>
  req('POST', '/api/logs', entry);

export const getCrashFlag = (): Promise<CrashFlag> =>
  req('GET', '/api/logs/crash-flag');

export const exportLogs = (): Promise<string> =>
  fetch(`${BASE}/api/logs/export`).then(r => r.text());

export const clearLogs = (): Promise<void> =>
  req('DELETE', '/api/logs');

// ---- Admin ----

export const backupDatabase = (): Promise<{ path: string }> =>
  req('POST', '/admin/backup', {});

export const restoreDatabase = (backupPath: string): Promise<void> =>
  req('POST', '/admin/restore', { path: backupPath });
