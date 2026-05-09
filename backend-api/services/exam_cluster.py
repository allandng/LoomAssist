"""
Deterministic detection of "exam clusters" — N+ exam-like events within a
short window. Used by /schedule/detect-clusters and folded into the wellness
analysis pipeline.

Pure functions only. No DB session, no Ollama, no FastAPI imports.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

_logger = logging.getLogger(__name__)


# Keep in sync with frontend-ui/src/src/lib/eventClassification.ts::isExamLike
# If you change the regex, update both files in the same commit.
# Tested by: backend-api/tests/test_exam_cluster.py and
#            frontend-ui/src/src/test/eventClassification.test.ts
_EXAM_LIKE_PATTERN = re.compile(
    r"\b(exam|midterm|final|quiz|test|due|deadline|pset|paper|assignment)\b",
    re.IGNORECASE,
)


def is_exam_like(title: str) -> bool:
    return bool(_EXAM_LIKE_PATTERN.search(title or ""))


class ClusterCandidate(Protocol):
    """Duck-typed input — anything with these three attributes works."""
    id: int | None
    title: str
    start_time: str  # ISO datetime string


@dataclass
class ClusterDetection:
    event_ids: list[int]      # IDs that were available; may be shorter than titles
    titles: list[str]
    window_start: str         # YYYY-MM-DD of earliest event in cluster
    window_end: str           # YYYY-MM-DD of latest event in cluster


def _parse_date(iso: str) -> datetime:
    # Accept "2026-05-08T09:00" or "2026-05-08T09:00:00" or "...Z"
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        _logger.warning("exam_cluster: unparseable ISO datetime %r", iso)
        raise


def detect_exam_clusters(
    events: list[ClusterCandidate],
    threshold: int = 3,
    window_days: int = 5,
) -> list[ClusterDetection]:
    """
    Returns one ClusterDetection per non-overlapping cluster of >= threshold
    exam-like events whose start dates span strictly less than window_days.

    Window semantics: events at day 0 and day (window_days - 1) are IN window;
    events at day 0 and day window_days are OUT of window. Implemented as
    (last.date - first.date).days < window_days.

    Greedy non-overlap: when a cluster is emitted, the scan resumes after the
    last event in that cluster. Avoids double-counting overlapping windows.
    """
    candidates = [e for e in events if is_exam_like(e.title)]
    candidates.sort(key=lambda e: e.start_time)

    detections: list[ClusterDetection] = []
    i = 0
    n = len(candidates)
    while i < n:
        start_date = _parse_date(candidates[i].start_time).date()
        j = i
        while j + 1 < n:
            next_date = _parse_date(candidates[j + 1].start_time).date()
            if (next_date - start_date).days < window_days:
                j += 1
            else:
                break

        cluster_size = j - i + 1
        if cluster_size >= threshold:
            members = candidates[i : j + 1]
            detections.append(
                ClusterDetection(
                    event_ids=[m.id for m in members if m.id is not None],
                    titles=[m.title for m in members],
                    window_start=str(_parse_date(members[0].start_time).date()),
                    window_end=str(_parse_date(members[-1].start_time).date()),
                )
            )
            i = j + 1
        else:
            i += 1

    return detections
