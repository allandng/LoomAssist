"""Phase v3.0 dedup engine — pure functions; the only place fuzzy thresholds live.

For every incoming event from a connected provider, classify into one of:

  - **certain** : exact (connection_calendar_id, external_id) match — upsert silently
  - **fuzzy**   : title-similar AND start-close AND duration-close — write a
                  SyncReviewItem; never silently merge
  - **none**    : no plausible local match — apply silently as a new event

Per design doc §10 Q5 (the answer to "what's the dedup match threshold"):
  - Title similarity ≥ 0.85 (token-set ratio)
  - Start within 15 min
  - Duration within 15 min
  - Optional location boost (+0.05 to score on match)

Thresholds are module-level constants; not user-configurable in v3.0 per Q5.

This module is pure — no DB access, no network. The runner reads candidate
local events into memory, calls match_incoming(), and acts on the results.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional

# rapidfuzz is small (no C++ build) and well-maintained.
try:
    from rapidfuzz.fuzz import token_set_ratio
except ImportError:
    # Fallback so unit tests outside a full venv still load. Real runner needs rapidfuzz.
    def token_set_ratio(a: str, b: str) -> float:
        a_set = set(a.lower().split())
        b_set = set(b.lower().split())
        if not a_set or not b_set:
            return 0.0
        return 100.0 * len(a_set & b_set) / len(a_set | b_set)


# ── Thresholds (do not change without a new design pass — §11 R1) ────────────
TITLE_SIMILARITY_THRESHOLD = 0.85   # token_set_ratio >= 85
START_WINDOW_MIN = 15
DURATION_WINDOW_MIN = 15
LOCATION_BOOST = 0.05


@dataclass
class IncomingEvent:
    """Provider event normalized to LoomAssist's event shape (subset). The
    runner constructs these from google.py / caldav.py output via
    ics_normalize.py."""
    title: str
    start_time: str          # ISO datetime
    end_time: str            # ISO datetime
    location: Optional[str] = None
    description: Optional[str] = None
    external_id: Optional[str] = None
    external_etag: Optional[str] = None


@dataclass
class LocalEventLike:
    """Subset of `Event` columns we need for matching. Keeps this module pure
    of SQLModel imports for unit testing."""
    id: int
    title: str
    start_time: str
    end_time: str
    location: Optional[str] = None
    connection_calendar_id: Optional[str] = None
    external_id: Optional[str] = None


@dataclass
class MatchReason:
    field: str
    similarity: float
    value_local: str
    value_incoming: str


@dataclass
class MatchResult:
    """Bucket label + the score and reasons. The runner switches on `bucket`:

      - `certain` → upsert into local_event by id (no review).
      - `fuzzy`   → write SyncReviewItem with these reasons.
      - `none`    → insert as new local event.
    """
    bucket: str                              # "certain" | "fuzzy" | "none"
    local_event: Optional[LocalEventLike] = None
    score: float = 0.0
    reasons: List[MatchReason] = field(default_factory=list)


def _parse(iso: str) -> Optional[datetime]:
    try:
        # Tolerate trailing Z and offset-naive strings.
        s = iso.rstrip("Z")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _duration_minutes(start_iso: str, end_iso: str) -> Optional[float]:
    s = _parse(start_iso)
    e = _parse(end_iso)
    if s is None or e is None:
        return None
    return (e - s).total_seconds() / 60.0


def match_incoming(
    incoming: IncomingEvent,
    local_candidates: List[LocalEventLike],
    *,
    connection_calendar_id: Optional[str] = None,
) -> MatchResult:
    """Classify a single incoming event against a candidate set of local events.

    Caller is responsible for narrowing `local_candidates` to events plausibly
    in the same time window (e.g. ±1h around incoming.start_time) for
    performance — but matching itself is independent of that narrowing.
    """

    # 1) Certain match: exact (connection_calendar_id, external_id) pair.
    if incoming.external_id and connection_calendar_id:
        for cand in local_candidates:
            if (cand.connection_calendar_id == connection_calendar_id
                    and cand.external_id == incoming.external_id):
                return MatchResult(bucket="certain", local_event=cand, score=1.0)

    # 2) Fuzzy match. Compare against every local candidate; pick the highest
    #    score that crosses the threshold.
    incoming_start = _parse(incoming.start_time)
    incoming_dur   = _duration_minutes(incoming.start_time, incoming.end_time)

    best: Optional[MatchResult] = None

    for cand in local_candidates:
        # Skip events already locked to a different sync identity (those would
        # be `certain` matches via a different connection_calendar_id, not
        # candidates for this incoming event).
        if cand.connection_calendar_id and cand.external_id:
            continue

        cand_start = _parse(cand.start_time)
        cand_dur   = _duration_minutes(cand.start_time, cand.end_time)
        if not (incoming_start and cand_start and incoming_dur and cand_dur):
            continue

        # Time + duration windows.
        start_delta_min = abs((cand_start - incoming_start).total_seconds() / 60.0)
        dur_delta_min   = abs(cand_dur - incoming_dur)
        if start_delta_min > START_WINDOW_MIN:
            continue
        if dur_delta_min > DURATION_WINDOW_MIN:
            continue

        # Title similarity (token_set_ratio returns 0..100 in rapidfuzz).
        title_sim = token_set_ratio(incoming.title or "", cand.title or "") / 100.0

        # Score starts at title similarity.
        score = title_sim
        reasons: List[MatchReason] = [
            MatchReason("title", title_sim, cand.title, incoming.title),
            MatchReason("start", 1.0 - (start_delta_min / max(START_WINDOW_MIN, 1)),
                        cand.start_time, incoming.start_time),
            MatchReason("duration", 1.0 - (dur_delta_min / max(DURATION_WINDOW_MIN, 1)),
                        f"{cand_dur:.0f}m", f"{incoming_dur:.0f}m"),
        ]

        # Location boost (cheap signal — only applies when both sides have a
        # value and they're equal-ish, since we don't fuzz-match locations).
        if incoming.location and cand.location and incoming.location.strip().lower() == cand.location.strip().lower():
            score = min(1.0, score + LOCATION_BOOST)
            reasons.append(MatchReason("location", 1.0, cand.location, incoming.location))

        if title_sim < TITLE_SIMILARITY_THRESHOLD:
            continue

        if best is None or score > best.score:
            best = MatchResult(bucket="fuzzy", local_event=cand, score=score, reasons=reasons)

    if best is not None:
        return best

    return MatchResult(bucket="none")
