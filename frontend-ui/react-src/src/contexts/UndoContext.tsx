import { createContext, useContext, useReducer, useCallback, useMemo, type ReactNode } from 'react';
import { useShortcuts } from '../hooks/useShortcuts';

export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface UndoState {
  stack: UndoEntry[];
  cursor: number; // points at last applied action; -1 = nothing done
}

type UndoAction =
  | { type: 'push'; entry: UndoEntry }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX = 50;

function reducer(state: UndoState, action: UndoAction): UndoState {
  switch (action.type) {
    case 'push': {
      // drop any redoable entries beyond cursor
      const trimmed = state.stack.slice(0, state.cursor + 1);
      const next = [...trimmed, action.entry].slice(-MAX);
      return { stack: next, cursor: next.length - 1 };
    }
    case 'undo':
      return state.cursor < 0 ? state : { ...state, cursor: state.cursor - 1 };
    case 'redo':
      return state.cursor >= state.stack.length - 1 ? state : { ...state, cursor: state.cursor + 1 };
    default:
      return state;
  }
}

interface UndoContextValue {
  push: (entry: UndoEntry) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: boolean;
  canRedo: boolean;
}

const UndoContext = createContext<UndoContextValue | null>(null);

export function UndoProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { stack: [], cursor: -1 });

  const push = useCallback((entry: UndoEntry) => dispatch({ type: 'push', entry }), []);

  const undo = useCallback(async () => {
    if (state.cursor < 0) return;
    await state.stack[state.cursor].undo();
    dispatch({ type: 'undo' });
  }, [state]);

  const redo = useCallback(async () => {
    if (state.cursor >= state.stack.length - 1) return;
    await state.stack[state.cursor + 1].redo();
    dispatch({ type: 'redo' });
  }, [state]);

  const canUndo = state.cursor >= 0;
  const canRedo = state.cursor < state.stack.length - 1;

  // Ctrl+Z / Shift+Z — force:true bypasses the typing guard
  useShortcuts(useMemo(() => [
    { key: 'z', ctrl: true,  force: true, handler: (e) => { e.preventDefault(); undo(); } },
    { key: 'Z', ctrl: true, shift: true, force: true, handler: (e) => { e.preventDefault(); redo(); } },
    // macOS Cmd+Z
    { key: 'z', meta: true,  force: true, handler: (e) => { e.preventDefault(); undo(); } },
    { key: 'Z', meta: true, shift: true,  force: true, handler: (e) => { e.preventDefault(); redo(); } },
  ], [undo, redo]));

  const value = useMemo(() => ({ push, undo, redo, canUndo, canRedo }), [push, undo, redo, canUndo, canRedo]);

  return <UndoContext value={value}>{children}</UndoContext>;
}

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext);
  if (!ctx) throw new Error('useUndo must be used inside UndoProvider');
  return ctx;
}
