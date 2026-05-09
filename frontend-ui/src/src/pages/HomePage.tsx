import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './HomePage.module.css';
import { listEvents, listCalendars } from '../api';
import type { Event, Calendar } from '../types';
import { UpNextWidget } from '../components/home/UpNextWidget';
import { EnergyMappingWidget } from '../components/home/EnergyMappingWidget';
import { WeeklyReviewWidget } from '../components/home/WeeklyReviewWidget';
import { GradeWidget } from '../components/home/GradeWidget';
import { DensityHeatmap } from '../components/shared/DensityHeatmap';

const ORDINAL_SUFFIX = (n: number): string => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const navigate = useNavigate();
  const [events, setEvents]       = useState<Event[]>([]);
  const [timelines, setTimelines] = useState<Calendar[]>([]);

  useEffect(() => {
    listEvents().then(setEvents).catch(() => {});
    listCalendars().then(setTimelines).catch(() => {});
  }, []);

  const now = new Date();
  const name = (typeof localStorage !== 'undefined' && localStorage.getItem('loom_user_name')?.trim()) || 'there';
  const dayN = now.getDate();
  const dateLabel = `${now.toLocaleDateString([], { weekday: 'long' })} ${dayN}${ORDINAL_SUFFIX(dayN)} ${now.toLocaleDateString([], { month: 'long' })}`;

  function handleHeatmapDay(date: Date) {
    sessionStorage.setItem('loom_pending_date', date.toISOString());
    sessionStorage.setItem('loom_pending_view', 'Day');
    navigate('/calendar');
  }

  return (
    <div className={styles.page}>
      <header className={styles.greetBand}>
        <h1 className={styles.greeting}>{greetingFor(now)}, {name}.</h1>
        <span className={styles.date}>{dateLabel}</span>
      </header>

      <UpNextWidget events={events} timelines={timelines} />

      <EnergyMappingWidget />

      <section className={styles.widget}>
        <h2 className={styles.heading}>Activity</h2>
        <DensityHeatmap events={events} onDayClick={handleHeatmapDay} range="trailing12w" />
      </section>

      <WeeklyReviewWidget />

      <GradeWidget timelines={timelines} events={events} />
    </div>
  );
}
