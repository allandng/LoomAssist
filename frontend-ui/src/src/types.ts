// TypeScript interfaces matching the SQLModel tables in backend-api/database/models.py

export interface Calendar {
  id: number;
  name: string;
  description: string;
  color: string; // hex, default '#6366f1'
}

export interface Event {
  id: number;
  title: string;
  start_time: string;       // ISO datetime
  end_time: string;         // ISO datetime
  calendar_id: number;
  is_recurring: boolean;
  recurrence_days: string;  // comma-sep day nums e.g. "1,3"
  recurrence_end: string;   // ISO date
  description: string;
  unique_description: string; // per-occurrence override
  reminder_minutes: number;
  external_uid: string;     // duplicate prevention (ICS imports)
  timezone: string;         // default 'local'
  is_all_day: boolean;
  skipped_dates: string;    // comma-sep YYYY-MM-DD exceptions
  per_day_times: string;    // JSON {"1":{"start":"09:00","end":"17:00"}, ...}
  checklist: string;        // JSON [{"text":"...","done":false}, ...]
  actual_start?: string | null;
  actual_end?:   string | null;
  location?: string | null;
  travel_time_minutes?: number | null;
  reminder_source?: 'user' | 'inferred' | 'none' | null;
}

export interface EventTemplate {
  id: number;
  name: string;
  title: string;
  description: string;
  duration_minutes: number; // default 60
  is_recurring: boolean;
  recurrence_days: string;
  calendar_id: number;
}

export interface Task {
  id: number;
  event_id: number;   // no FK (avoids cascade on event delete)
  is_complete: boolean;
  note: string;
  added_at: string;   // ISO datetime
  status: 'backlog' | 'doing' | 'done';
  priority: 'high' | 'med' | 'low';
  due_date: string;   // ISO date, nullable
  estimated_minutes?: number | null;
  deadline?: string | null;
}

export interface AutopilotProposal {
  task_id: number;
  task_title: string;
  start: string;
  end: string;
  rationale: string;
}

export interface AutopilotOverflow {
  task_id: number;
  task_title: string;
  reason: string;
}

export interface DurationStat {
  id: number;
  title: string;
  calendar_id: number;
  planned_minutes: number;
  actual_minutes: number;
  delta_minutes: number;
}

export interface WeeklyReviewResult {
  summary: string;
  past_count: number;
  upcoming_count: number;
}

export interface StudyBlockPreview {
  title: string;
  start_time: string;
  end_time: string;
  description: string;
  calendar_id: number;
}

export interface StudyBlockRequest {
  subject: string;
  deadline_date: string;
  calendar_id: number;
  num_sessions?: number;
  session_duration_minutes?: number;
  preferred_hour?: number;
  skip_weekends?: boolean;
}

export interface AvailabilityRequest {
  id: number;
  token: string;
  sender_name: string;
  duration_minutes: number; // default 60
  slots: string;           // JSON [{"date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM"}, ...]
  status: 'pending' | 'confirmed' | 'amended' | 'declined';
  confirmed_slot: string;  // JSON object, null until confirmed
  amendment_slot: string;  // JSON object, null until proposed
  receiver_name: string;
  created_at: string;      // ISO datetime
  expires_at: string;      // ISO datetime
}

// ---- Payload types for create/update calls ----

export type EventCreate = Omit<Event, 'id'>;
export type EventUpdate = Partial<EventCreate>;

export type CalendarCreate = Omit<Calendar, 'id'>;
export type CalendarUpdate = Partial<CalendarCreate>;

export type TaskCreate = Omit<Task, 'id' | 'added_at'>;
export type TaskUpdate = Partial<TaskCreate>;

export type TemplateCreate = Omit<EventTemplate, 'id'>;

export interface AvailabilityCreate {
  sender_name: string;
  duration_minutes: number;
  slots: Array<{ date: string; start: string; end: string }>;
}

export interface SkipDatePayload {
  date: string; // YYYY-MM-DD
}

export interface AmendmentResponse {
  action: 'accept' | 'decline' | 'counter';
  counter_slot?: { date: string; start: string; end: string };
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface PerDayTime {
  start: string; // HH:MM
  end: string;   // HH:MM
}

export interface WellnessAnalysis {
  warnings: string[];
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface CrashFlag {
  crashed: boolean;
  crash_file?: string;
}

export interface ImportResult {
  events_added: number;
  events_skipped: number;
  event_ids: number[];
}

export interface FreeSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
}

export interface SyllabusEvent {
  title: string;
  date: string;      // YYYY-MM-DD
  start_time?: string;
  end_time?: string;
  calendar_id?: number;
}

export interface TimeBlockDef {
  title: string;
  day_of_week: number;  // 1=Mon … 7=Sun
  start_time: string;   // "HH:MM"
  end_time: string;
  calendar_id: number;
}

export interface TimeBlockTemplate {
  id: number;
  name: string;
  description: string;
  created_at: string;
  blocks_json: string;  // JSON string — parse to TimeBlockDef[]
}

export interface SemanticSearchResult {
  event: Event;
  score: number;
}

export interface ConflictSuggestion {
  start: string;
  end: string;
  rationale: string;
}

export interface InboxItem {
  id: number;
  text: string;
  created_at: string;
  proposed_start: string | null;
  proposed_duration: number | null;
  scheduled_event_id: number | null;
  archived: boolean;
}
