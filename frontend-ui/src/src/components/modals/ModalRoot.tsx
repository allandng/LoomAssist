/**
 * Reads ModalContext and renders the appropriate modal.
 * Mount this once at the app root (inside all providers).
 */
import { useState, useEffect } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { EventEditorModal } from './EventEditorModal';
import { AvailabilityModal } from './AvailabilityModal';
import { ICSImportModal } from './ICSImportModal';
import { SyllabusModal } from './SyllabusModal';
import { CounterProposalModal } from './CounterProposalModal';
import { WeeklyReviewModal } from './WeeklyReviewModal';
import { StudyBlockModal } from './StudyBlockModal';
import { TimeBlockTemplateModal } from './TimeBlockTemplateModal';
import { AutopilotReviewModal } from './AutopilotReviewModal';
import { listCalendars } from '../../api';
import type { Calendar, Event, TimeBlockDef, AutopilotProposal, AutopilotOverflow } from '../../types';

export function ModalRoot({ onSaved }: { onSaved: () => void }) {
  const { modal } = useModal();
  const [timelines, setTimelines] = useState<Calendar[]>([]);

  useEffect(() => {
    listCalendars().then(setTimelines).catch(() => {});
  }, []);

  if (!modal.name) return null;

  switch (modal.name) {
    case 'event-editor':
      return (
        <EventEditorModal
          event={(modal.props.event as Parameters<typeof EventEditorModal>[0]['event']) ?? null}
          date={modal.props.date as string | undefined}
          instanceDate={modal.props.instanceDate as string | undefined}
          startISO={modal.props.startISO as string | undefined}
          endISO={modal.props.endISO as string | undefined}
          timelines={timelines}
          onSaved={onSaved}
        />
      );
    case 'availability':
      return <AvailabilityModal />;
    case 'ics-import':
      return <ICSImportModal timelines={timelines} onSaved={onSaved} />;
    case 'syllabus':
      return <SyllabusModal onSaved={onSaved} />;
    case 'availability-response':
      return <CounterProposalModal token={modal.props.token as string} onSaved={onSaved} />;
    case 'weekly-review':
      return (
        <WeeklyReviewModal
          summary={modal.props.summary as string}
          weekStart={modal.props.weekStart as string}
        />
      );
    case 'study-block':
      return (
        <StudyBlockModal
          deadlineEvent={modal.props.deadlineEvent as Event}
          subject={modal.props.subject as string}
          onSaved={onSaved}
        />
      );
    case 'time-block-template':
      return (
        <TimeBlockTemplateModal
          prefillBlocks={(modal.props.prefillBlocks as TimeBlockDef[]) ?? []}
          timelines={timelines}
          onSaved={onSaved}
        />
      );
    case 'autopilot-review':
      return (
        <AutopilotReviewModal
          proposals={(modal.props.proposals as AutopilotProposal[]) ?? []}
          overflow={(modal.props.overflow as AutopilotOverflow[]) ?? []}
          timelines={(modal.props.timelines as Calendar[]) ?? timelines}
          onApplied={modal.props.onApplied as () => void}
        />
      );
    default:
      return null;
  }
}
