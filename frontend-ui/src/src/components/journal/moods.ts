import type { ReactNode } from 'react';
import { Icons, type BadgeTone } from '../ui';
import type { JournalEntry } from '../../types';

export type Mood = NonNullable<JournalEntry['mood']>;

export interface MoodMeta {
  value: Mood;
  label: string;
  hint: string;
  icon: ReactNode;
  tone: BadgeTone;
  /** 1..3 — drives the mood timeline bar height. */
  level: 1 | 2 | 3;
}

export const MOODS: MoodMeta[] = [
  { value: 'great', label: 'Great', hint: 'Energised, on top of things', icon: Icons.smile, tone: 'success', level: 3 },
  { value: 'ok',    label: 'Okay',  hint: 'Steady, nothing special',    icon: Icons.meh,   tone: 'neutral', level: 2 },
  { value: 'rough', label: 'Rough', hint: 'Drained or stressed',        icon: Icons.frown, tone: 'warning', level: 1 },
];

export function moodMeta(mood: JournalEntry['mood']): MoodMeta | null {
  if (!mood) return null;
  return MOODS.find(m => m.value === mood) ?? null;
}
