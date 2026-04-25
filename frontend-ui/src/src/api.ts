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
  FreeSlot,
  DurationStat,
  WeeklyReviewResult,
  StudyBlockPreview,
  StudyBlockRequest,
  TimeBlockTemplate,
  TimeBlockDef,
  InboxItem,
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

export interface ConflictInfo { id: number; title: string }

export const listEvents = (): Promise<Event[]> =>
  req('GET', '/events/');

export const createEvent = (
  payload: EventCreate,
): Promise<{ event: Event; conflicts: ConflictInfo[] }> =>
  req('POST', '/events/', payload);

export const updateEvent = (
  id: number,
  payload: EventUpdate,
): Promise<{ event: Event; conflicts: ConflictInfo[]; dependents?: ConflictInfo[] }> =>
  req('PUT', `/events/${id}`, payload);

export const cascadeDependents = (id: number): Promise<{ updated: Event[] }> =>
  req('POST', `/events/${id}/cascade-dependents`);

export const deleteEvent = (id: number): Promise<void> =>
  req('DELETE', `/events/${id}`);

export const skipEventDate = (id: number, payload: SkipDatePayload): Promise<Event> =>
  req('POST', `/events/${id}/skip-date`, payload);

export const clockEvent = (id: number, action: 'in' | 'out'): Promise<Event> =>
  req('PATCH', `/events/${id}/clock`, { action });

export const getDurationStats = (): Promise<{ entries: DurationStat[] }> =>
  req('GET', '/stats/duration');

export const getWeeklyReview = (weekStart: string): Promise<WeeklyReviewResult> =>
  req('POST', '/ai/weekly-review', { week_start: weekStart });

export const inferReminder = (
  title: string,
  description: string | null,
): Promise<{ minutes: number; rationale: string }> =>
  req('POST', '/ai/infer-reminder', { title, description });

export const semanticSearch = (
  q: string,
  k = 10,
): Promise<{ results: import('./types').SemanticSearchResult[] }> =>
  req('GET', `/search/semantic?q=${encodeURIComponent(q)}&k=${k}`);

export const reindexSearch = (): Promise<{ reindexed: number }> =>
  req('POST', '/search/reindex');

export const resolveConflict = (payload: {
  event: { title: string; start_time: string; end_time: string; calendar_id: number };
  conflicts: Array<{ id: number; title: string }>;
  working_hours_start?: number;
  working_hours_end?: number;
}): Promise<{ suggestions: import('./types').ConflictSuggestion[] }> =>
  req('POST', '/schedule/resolve-conflict', payload);

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

// ---- Time Block Templates ----

export const listTimeBlockTemplates = (): Promise<TimeBlockTemplate[]> =>
  req('GET', '/templates/time-blocks');

export const createTimeBlockTemplate = (
  name: string,
  description: string,
  blocks: TimeBlockDef[],
): Promise<TimeBlockTemplate> =>
  req('POST', '/templates/time-blocks', { name, description, blocks });

export const deleteTimeBlockTemplate = (id: number): Promise<void> =>
  req('DELETE', `/templates/time-blocks/${id}`);

export const applyTimeBlockTemplate = (
  tplId: number,
  weekMondayDate: string,
): Promise<{ applied_count: number; events: Event[] }> =>
  req('POST', `/templates/time-blocks/${tplId}/apply`, { week_monday_date: weekMondayDate });

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
  course_id?: number,
): Promise<{ created: number; event_ids: number[] }> =>
  req('POST', '/documents/save-approved-events/', { events, course_id: course_id ?? null });

// ---- Smart Scheduling ----

export const findFreeSlots = (payload: {
  window_start: string;
  window_end: string;
  duration_minutes?: number;
  working_hours_start?: number;
  working_hours_end?: number;
}): Promise<{ slots: FreeSlot[]; duration_minutes: number }> =>
  req('POST', '/schedule/find-free', payload);

// ---- Natural Language Datetime Parser ----

export const parseDateTime = (
  input: string,
): Promise<{ iso: string; display: string }> =>
  req('POST', '/parse/datetime', { input });

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
): Promise<{ status: string; result: Record<string, unknown>; intent: Record<string, unknown> }> =>
  req('POST', '/intent', { text });

export const applyVoiceIntent = (payload: {
  action: string;
  event_id: number;
  proposed_change: Record<string, unknown>;
}): Promise<{ status: string; event?: Record<string, unknown> }> =>
  req('POST', '/intent/apply', payload);

// ---- Analytics ----

export const analyzeSchedule = (
  events: Array<{ title: string; start_time: string; end_time: string }>
): Promise<WellnessAnalysis> =>
  req('POST', '/schedule/analyze', { events });

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

// ---- Study Block Auto-Generator ----

export const getStudyBlockPreview = (body: StudyBlockRequest): Promise<StudyBlockPreview[]> =>
  req('POST', '/study/generate-preview', body);

export const confirmStudyBlocks = (blocks: StudyBlockPreview[]): Promise<{ created_count: number }> =>
  req('POST', '/study/confirm-blocks', blocks);

// ---- Inbox (Phase 4) ----

export const listInbox = (): Promise<InboxItem[]> =>
  req('GET', '/inbox');

export const createInboxItem = (text: string): Promise<InboxItem> =>
  req('POST', '/inbox', { text });

export const proposeInboxItem = (
  id: number,
): Promise<{ proposed_start: string | null; proposed_duration: number | null; rationale: string }> =>
  req('POST', `/inbox/${id}/propose`);

export const scheduleInboxItem = (
  id: number,
  start: string,
  end: string,
  calendar_id: number,
): Promise<InboxItem> =>
  req('POST', `/inbox/${id}/schedule`, { start, end, calendar_id });

export const deleteInboxItem = (id: number): Promise<InboxItem> =>
  req('DELETE', `/inbox/${id}`);

// ---- Autopilot (Phase 7) ----

// ---- Journal (Phase 12) ----

export async function createJournalEntry(
  audioBlob: Blob | null,
  date?: string,
  mood?: string | null,
  saveAudio?: boolean,
): Promise<import('./types').JournalEntry> {
  const form = new FormData();
  if (audioBlob) form.append('audio', audioBlob, 'journal.webm');
  if (date) form.append('date', date);
  if (mood) form.append('mood', mood);
  form.append('save_audio', saveAudio ? 'true' : 'false');
  const res = await fetch(`${BASE}/journal`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`journal → ${res.status}`);
  return res.json();
}

export const listJournal = (from?: string, to?: string): Promise<import('./types').JournalEntry[]> => {
  const params = new URLSearchParams();
  if (from) params.set('from_date', from);
  if (to)   params.set('to_date', to);
  const qs = params.toString();
  return req('GET', `/journal${qs ? '?' + qs : ''}`);
};

export const deleteJournalEntry = (id: number): Promise<void> =>
  req('DELETE', `/journal/${id}`);

// ---- Subscriptions (Phase 9) ----

export const listSubscriptions = (): Promise<import('./types').Subscription[]> =>
  req('GET', '/subscriptions');

export const createSubscription = (payload: Omit<import('./types').Subscription, 'id' | 'last_synced' | 'last_error'>): Promise<import('./types').Subscription> =>
  req('POST', '/subscriptions', payload);

export const updateSubscription = (id: number, payload: Omit<import('./types').Subscription, 'id' | 'last_synced' | 'last_error'>): Promise<import('./types').Subscription> =>
  req('PUT', `/subscriptions/${id}`, payload);

export const deleteSubscription = (id: number): Promise<void> =>
  req('DELETE', `/subscriptions/${id}`);

export const refreshSubscription = (id: number): Promise<import('./types').Subscription> =>
  req('POST', `/subscriptions/${id}/refresh`);

// ---- Courses + Assignments (Phase 8) ----

export const listCourses = (): Promise<import('./types').Course[]> =>
  req('GET', '/courses');

export const createCourse = (payload: Omit<import('./types').Course, 'id'>): Promise<import('./types').Course> =>
  req('POST', '/courses', payload);

export const updateCourse = (id: number, payload: Omit<import('./types').Course, 'id'>): Promise<import('./types').Course> =>
  req('PUT', `/courses/${id}`, payload);

export const deleteCourse = (id: number): Promise<void> =>
  req('DELETE', `/courses/${id}`);

export const listAssignments = (courseId?: number): Promise<import('./types').Assignment[]> =>
  req('GET', courseId ? `/assignments?course_id=${courseId}` : '/assignments');

export const createAssignment = (payload: Omit<import('./types').Assignment, 'id'>): Promise<import('./types').Assignment> =>
  req('POST', '/assignments', payload);

export const updateAssignment = (id: number, payload: Partial<import('./types').Assignment>): Promise<import('./types').Assignment> =>
  req('PUT', `/assignments/${id}`, payload);

export const deleteAssignment = (id: number): Promise<void> =>
  req('DELETE', `/assignments/${id}`);

export const getCourseGrade = (courseId: number): Promise<{ grade: number | null; breakdown: Record<string, number | null> }> =>
  req('GET', `/courses/${courseId}/grade`);

export const runAutopilot = (payload: {
  window_start: string;
  window_end: string;
  working_hours_start?: number;
  working_hours_end?: number;
}): Promise<{
  proposals: import('./types').AutopilotProposal[];
  overflow: import('./types').AutopilotOverflow[];
}> =>
  req('POST', '/schedule/autopilot', payload);

// ── Phase 13: Encrypted Local Backup ──────────────────────────────────────

export async function exportBackup(passphrase: string, includeAudio = false): Promise<Blob> {
  const resp = await fetch('http://localhost:8000/backup/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase, include_audio: includeAudio }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.detail ?? 'Export failed');
  }
  return resp.blob();
}

export async function importBackup(file: File, passphrase: string): Promise<{ success: boolean; message: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('passphrase', passphrase);
  const resp = await fetch('http://localhost:8000/backup/import', { method: 'POST', body: form });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.detail ?? 'Import failed');
  }
  return resp.json();
}

// ── Phase 14: LAN Sync ────────────────────────────────────────────────────

export const pairStart = (): Promise<import('./types').PairStartResult> =>
  req('POST', '/pair/start');

export const pairComplete = (code: string, peerName: string, peerCertFingerprint: string): Promise<import('./types').Peer> =>
  req('POST', '/pair/complete', { code, peer_name: peerName, peer_cert_fingerprint: peerCertFingerprint });

export const listPeers = (): Promise<import('./types').Peer[]> =>
  req('GET', '/pair/peers');

export const deletePeer = (id: number): Promise<void> =>
  req('DELETE', `/pair/peers/${id}`);

export const getDiscoveredPeers = (): Promise<{ peers: import('./types').DiscoveredPeer[] }> =>
  req('GET', '/discovery/peers');

export const syncNow = (peerId: number): Promise<{ ok: boolean; peer_id: number }> =>
  req('POST', `/sync/now/${peerId}`);

// ── Phase v3.0: Cloud Identity (Supabase Auth, identity-only) ─────────────

export interface Account {
  id: string;
  supabase_user_id: string;
  email: string;
  display_name: string | null;
  auth_provider: string;
  created_at: string;
  last_login_at: string | null;
}

export const getMe = async (): Promise<Account | null> => {
  const res = await fetch(`${BASE}/auth/me`);
  if (res.status === 204) return null;
  if (!res.ok) throw Object.assign(new Error(`GET /auth/me → ${res.status}`), { status: res.status });
  return res.json();
};

export const startOAuth = (provider: 'google' | 'apple' | 'microsoft'): Promise<{ auth_url: string }> =>
  req('POST', `/auth/oauth/${provider}/start`);

export const completeOAuth = (
  access_token: string,
  refresh_token: string | null,
  provider: string,
): Promise<Account> =>
  req('POST', '/auth/oauth/complete', { access_token, refresh_token, provider });

export const emailSignup = (email: string, password: string): Promise<Account> =>
  req('POST', '/auth/email/signup', { email, password });

export const emailLogin = (email: string, password: string): Promise<Account> =>
  req('POST', '/auth/email/login', { email, password });

export const emailReset = (email: string): Promise<{ ok: boolean }> =>
  req('POST', '/auth/email/reset', { email });

export const updateMe = (display_name: string): Promise<Account> =>
  req('PATCH', '/auth/me', { display_name });

export const logout = (): Promise<{ ok: boolean }> =>
  req('POST', '/auth/logout');

// ── Phase v3.0: Cloud Sync — Connections + Sync + Sync Review ─────────────

export type ConnectionKind = 'google' | 'caldav_icloud' | 'caldav_generic';
export type ConnectionStatus = 'connected' | 'paused' | 'auth_expired' | 'error';

export interface Connection {
  id: string;
  kind: ConnectionKind;
  display_name: string;
  account_email: string;
  caldav_base_url: string | null;
  status: ConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface RemoteCalendar {
  id: string;
  display_name: string;
  color: string | null;
}

export interface ConnectionCalendar {
  id: string;
  connection_id: string;
  local_calendar_id: number;
  remote_calendar_id: string;
  remote_display_name: string;
  sync_direction: 'both' | 'pull' | 'push';
  sync_token: string | null;
  caldav_ctag: string | null;
  last_full_sync_at: string | null;
  created_at: string;
}

export interface SyncStatus {
  connection_id: string;
  status: ConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  pending_review_count: number;
}

export interface ReviewMatchReason {
  field: string;
  similarity: number;
  value_local: string;
  value_incoming: string;
}

export interface SyncReviewItem {
  id: string;
  connection_calendar_id: string;
  connection_display_name: string;
  kind: 'incoming_duplicate' | 'bidirectional_conflict' | 'push_rejected';
  local_event_id: number | null;
  incoming_payload: Record<string, unknown>;
  match_score: number | null;
  match_reasons: ReviewMatchReason[] | null;
  created_at: string;
}

export const listConnections = (): Promise<Connection[]> =>
  req('GET', '/connections');

export const startGoogleConnection = (): Promise<{ auth_url: string }> =>
  req('POST', '/connections/google/start');

export const completeGoogleConnection = (code: string): Promise<Connection> =>
  req('POST', '/connections/google/complete', { code });

export const testCalDAV = (
  base_url: string, username: string, password: string,
): Promise<{ ok: boolean; principal_url?: string; error?: string }> =>
  req('POST', '/connections/caldav/test', { base_url, username, password });

export const createCalDAVConnection = (payload: {
  kind: ConnectionKind;
  base_url: string;
  username: string;
  password: string;
  display_name?: string;
}): Promise<Connection> =>
  req('POST', '/connections/caldav', payload);

export const pushConnectionToken = (connection_id: string, token: string): Promise<{ ok: boolean }> =>
  req('POST', `/connections/${connection_id}/token`, { token });

export const listRemoteCalendars = (connection_id: string): Promise<RemoteCalendar[]> =>
  req('GET', `/connections/${connection_id}/calendars`);

export const subscribeCalendar = (connection_id: string, payload: {
  remote_calendar_id: string;
  remote_display_name: string;
  remote_color?: string | null;
  local_calendar_id?: number | null;
  sync_direction?: 'both' | 'pull' | 'push';
}): Promise<ConnectionCalendar> =>
  req('POST', `/connections/${connection_id}/subscribe`, payload);

export const unsubscribeCalendar = (connection_id: string, cc_id: string): Promise<{ ok: boolean }> =>
  req('DELETE', `/connections/${connection_id}/calendars/${cc_id}`);

export const patchConnectionCalendar = (
  connection_id: string, cc_id: string,
  payload: { sync_direction?: 'both' | 'pull' | 'push'; local_calendar_id?: number },
): Promise<ConnectionCalendar> =>
  req('PATCH', `/connections/${connection_id}/calendars/${cc_id}`, payload);

export const pauseConnection = (connection_id: string): Promise<Connection> =>
  req('POST', `/connections/${connection_id}/pause`);

export const resumeConnection = (connection_id: string): Promise<Connection> =>
  req('POST', `/connections/${connection_id}/resume`);

export interface DisconnectTimelineDecision {
  local_calendar_id: number;
  strategy: 'keep' | 'move' | 'delete';
  move_target_id?: number;
}

export const disconnectConnection = (
  connection_id: string,
  timelines: DisconnectTimelineDecision[] = [],
): Promise<{ ok: boolean }> =>
  req('DELETE', `/connections/${connection_id}`, { timelines });

export const runAllSync = (): Promise<{ started: string[] }> =>
  req('POST', '/sync/run');

export const runOneSync = (connection_id: string): Promise<{ started: string }> =>
  req('POST', `/sync/run/${connection_id}`);

export const getSyncStatus = (): Promise<SyncStatus[]> =>
  req('GET', '/sync/status');

export const listReview = (params?: { connection_id?: string; kind?: string; limit?: number }): Promise<SyncReviewItem[]> => {
  const qs = new URLSearchParams();
  if (params?.connection_id) qs.set('connection_id', params.connection_id);
  if (params?.kind)          qs.set('kind', params.kind);
  if (params?.limit)         qs.set('limit', String(params.limit));
  const s = qs.toString();
  return req('GET', `/sync/review${s ? '?' + s : ''}`);
};

export const getReviewItem = (id: string): Promise<SyncReviewItem> =>
  req('GET', `/sync/review/${id}`);

export const approveReview = (id: string): Promise<{ event_id: number }> =>
  req('POST', `/sync/review/${id}/approve`);

export const mergeReview = (id: string, merged_payload: Record<string, unknown>): Promise<{ event_id: number }> =>
  req('POST', `/sync/review/${id}/merge`, { merged_payload });

export const replaceLocalReview = (id: string): Promise<{ event_id: number }> =>
  req('POST', `/sync/review/${id}/replace-local`);

export const rejectReview = (id: string, remember = false): Promise<{ ok: boolean }> =>
  req('POST', `/sync/review/${id}/reject`, { remember });

export const SYNC_EVENTS_URL = `${BASE}/sync/events`;
