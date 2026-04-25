import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { Event, TimeBlockDef, AutopilotProposal, AutopilotOverflow, Calendar } from '../types';

type ModalName =
  | 'event-editor'
  | 'availability'
  | 'availability-response'
  | 'ics-import'
  | 'syllabus'
  | 'settings'
  | 'timeline-editor'
  | 'template-editor'
  | 'weekly-review'
  | 'study-block'
  | 'time-block-template'
  | 'autopilot-review'
  | 'sync-merge'
  | 'provider-picker'
  | 'caldav-credentials'
  | 'subscribe-drawer'
  | null;

interface ModalState {
  name: ModalName;
  props: Record<string, unknown>;
}

interface ModalContextValue {
  modal: ModalState;
  openEventEditor: (event?: Event | null, date?: string, instanceDate?: string, startISO?: string, endISO?: string) => void;
  openAvailability: () => void;
  openAvailabilityResponse: (token: string) => void;
  openICSImport: () => void;
  openSyllabus: () => void;
  openSettings: () => void;
  openTimelineEditor: (timelineId?: number) => void;
  openTemplateEditor: (templateId?: number) => void;
  openWeeklyReview: (summary: string, weekStart: string) => void;
  openStudyBlock: (deadlineEvent: Event, subject: string) => void;
  openTimeBlockTemplate: (prefillBlocks?: TimeBlockDef[]) => void;
  openAutopilotReview: (proposals: AutopilotProposal[], overflow: AutopilotOverflow[], timelines: Calendar[], onApplied: () => void) => void;
  openSyncMerge:        (itemId: string) => void;
  openProviderPicker:   (onPicked?: (kind: 'google' | 'caldav_icloud' | 'caldav_generic') => void) => void;
  openCalDAVCredentials:(kind: 'caldav_icloud' | 'caldav_generic', onCreated?: (connectionId: string) => void) => void;
  openSubscribeDrawer:  (connectionId: string) => void;
  close: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState>({ name: null, props: {} });

  const open = useCallback((name: ModalName, props: Record<string, unknown> = {}) => {
    setModal({ name, props });
  }, []);

  const close = useCallback(() => setModal({ name: null, props: {} }), []);

  const value = useMemo<ModalContextValue>(() => ({
    modal,
    openEventEditor:          (event, date, instanceDate, startISO, endISO) => open('event-editor', { event, date, instanceDate, startISO, endISO }),
    openAvailability:         () => open('availability'),
    openAvailabilityResponse: (token) => open('availability-response', { token }),
    openICSImport:            () => open('ics-import'),
    openSyllabus:             () => open('syllabus'),
    openSettings:             () => open('settings'),
    openTimelineEditor:       (timelineId) => open('timeline-editor', { timelineId }),
    openTemplateEditor:       (templateId) => open('template-editor', { templateId }),
    openWeeklyReview:         (summary, weekStart) => open('weekly-review', { summary, weekStart }),
    openStudyBlock:           (deadlineEvent, subject) => open('study-block', { deadlineEvent, subject }),
    openTimeBlockTemplate:    (prefillBlocks) => open('time-block-template', { prefillBlocks: prefillBlocks ?? [] }),
    openAutopilotReview:      (proposals, overflow, timelines, onApplied) => open('autopilot-review', { proposals, overflow, timelines, onApplied }),
    openSyncMerge:            (itemId) => open('sync-merge', { itemId }),
    openProviderPicker:       (onPicked) => open('provider-picker', { onPicked }),
    openCalDAVCredentials:    (kind, onCreated) => open('caldav-credentials', { kind, onCreated }),
    openSubscribeDrawer:      (connectionId) => open('subscribe-drawer', { connectionId }),
    close,
  }), [modal, open, close]);

  return <ModalContext value={value}>{children}</ModalContext>;
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used inside ModalProvider');
  return ctx;
}
