/**
 * Reads ModalContext and renders the appropriate modal.
 * Mount this once at the app root (inside all providers).
 */
import { useState, useEffect } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { EventEditorModal } from './EventEditorModal';
import { AvailabilityModal } from './AvailabilityModal';
import { listCalendars } from '../../api';
import type { Calendar } from '../../types';

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
          timelines={timelines}
          onSaved={onSaved}
        />
      );
    case 'availability':
      return <AvailabilityModal />;
    default:
      return null;
  }
}
