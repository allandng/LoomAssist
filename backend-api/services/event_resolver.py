"""
Phase 5 — event resolver for voice editing.
Fuzzy-matches a natural-language query to a calendar event.
"""
from __future__ import annotations
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from database import models


def _score(query: str, title: str) -> float:
    """Simple word-overlap score 0-1."""
    q_words = set(query.lower().split())
    t_words = set(title.lower().split())
    if not q_words or not t_words:
        return 0.0
    return len(q_words & t_words) / max(len(q_words), len(t_words))


def resolve_event_by_query(
    query: str,
    when_hint: str | None,
    db: Session,
    threshold: float = 0.3,
) -> tuple[models.Event | None, list[models.Event]]:
    """
    Returns (best_match, candidates).
    - best_match: single Event if unambiguous, else None
    - candidates: all events above threshold, sorted by score desc
    If multiple events tie for the top score, best_match is None (ambiguous).
    """
    # Date window: try to parse when_hint, default to ±7 days from now
    now = datetime.now()
    try:
        hint_dt = datetime.fromisoformat(when_hint) if when_hint else now
    except (ValueError, TypeError):
        hint_dt = now

    window_start = hint_dt - timedelta(days=7)
    window_end   = hint_dt + timedelta(days=30)

    events = db.query(models.Event).all()

    scored: list[tuple[float, models.Event]] = []
    for ev in events:
        try:
            ev_start = datetime.fromisoformat(ev.start_time)
        except ValueError:
            continue
        if not (window_start <= ev_start <= window_end):
            continue
        score = _score(query, ev.title)
        if score >= threshold:
            scored.append((score, ev))

    if not scored:
        return None, []

    scored.sort(key=lambda x: x[0], reverse=True)
    candidates = [ev for _, ev in scored]

    top_score = scored[0][0]
    top_events = [ev for s, ev in scored if s == top_score]
    if len(top_events) == 1:
        return top_events[0], candidates
    return None, candidates  # ambiguous — caller shows chooser
