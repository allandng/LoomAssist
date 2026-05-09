"""
Unit tests for the deterministic exam-cluster detector.

Pure: no DB, no HTTP, no app import. Tests the algorithm directly against
the spec from the Step 2 plan.
"""
from dataclasses import dataclass

from services.exam_cluster import detect_exam_clusters, is_exam_like


@dataclass
class _Ev:
    id: int
    title: str
    start_time: str  # ISO datetime


def _at_day(idx: int, day_offset: int, title: str = "Final exam") -> _Ev:
    """Helper: event at 2026-01-{01 + day_offset} 09:00."""
    day = 1 + day_offset
    return _Ev(id=idx, title=title, start_time=f"2026-01-{day:02d}T09:00")


# ── is_exam_like sanity (the regex is also tested on the TS side) ──────────

def test_is_exam_like_matches_union_terms():
    for title in ["CS107 final exam", "Math midterm", "Pop quiz",
                  "PS3 due Friday", "Project deadline", "Term paper",
                  "Assignment 2", "PSet 4", "Unit test 3"]:
        assert is_exam_like(title), title


def test_is_exam_like_rejects_unrelated():
    for title in ["Lunch with Sam", "Standup", "Coffee break", ""]:
        assert not is_exam_like(title), title


def test_is_exam_like_word_boundaries():
    assert not is_exam_like("Examine the data")
    assert not is_exam_like("Finalize report")


# ── detect_exam_clusters: spec-driven cases ────────────────────────────────

def test_empty_input_returns_empty():
    assert detect_exam_clusters([]) == []


def test_three_within_five_days_emits_one_warning():
    events = [_at_day(1, 0), _at_day(2, 2), _at_day(3, 4)]
    result = detect_exam_clusters(events)
    assert len(result) == 1
    assert result[0].event_ids == [1, 2, 3]


def test_two_within_five_days_emits_no_warning():
    events = [_at_day(1, 0), _at_day(2, 2)]
    assert detect_exam_clusters(events) == []


def test_three_spread_across_six_days_emits_no_warning():
    # day 0, 3, 6 — pairwise gaps within 5 but full span (0..6) is 6 days, not < 5.
    events = [_at_day(1, 0), _at_day(2, 3), _at_day(3, 6)]
    assert detect_exam_clusters(events) == []


def test_four_within_five_days_emits_exactly_one_warning():
    # 4 events at days 0, 1, 2, 3 — all within a 5-day window.
    events = [_at_day(1, 0), _at_day(2, 1), _at_day(3, 2), _at_day(4, 3)]
    result = detect_exam_clusters(events)
    assert len(result) == 1, "clusters must not double-count overlapping windows"
    assert result[0].event_ids == [1, 2, 3, 4]


def test_window_boundary_day_zero_to_day_four_is_in():
    events = [_at_day(1, 0), _at_day(2, 2), _at_day(3, 4)]
    assert len(detect_exam_clusters(events)) == 1


def test_window_boundary_day_zero_to_day_five_is_out():
    events = [_at_day(1, 0), _at_day(2, 2), _at_day(3, 5)]
    assert detect_exam_clusters(events) == []


def test_mixed_only_exam_like_count_three_emits_one_warning():
    events = [
        _at_day(1, 0, "CS final exam"),
        _at_day(2, 1, "Lunch with Sam"),     # not exam-like
        _at_day(3, 2, "Math midterm"),
        _at_day(4, 3, "Standup"),            # not exam-like
        _at_day(5, 4, "Physics quiz"),
    ]
    result = detect_exam_clusters(events)
    assert len(result) == 1
    assert result[0].event_ids == [1, 3, 5]


def test_disjoint_clusters_emit_separate_warnings():
    # Two clusters, well separated: days 0,1,2 and days 20,21,22.
    events = [
        _at_day(1, 0), _at_day(2, 1), _at_day(3, 2),
        _at_day(4, 20), _at_day(5, 21), _at_day(6, 22),
    ]
    result = detect_exam_clusters(events)
    assert len(result) == 2
    assert result[0].event_ids == [1, 2, 3]
    assert result[1].event_ids == [4, 5, 6]


def test_threshold_and_window_are_configurable():
    # 2 events within 3 days at threshold=2, window_days=3 → 1 warning.
    events = [_at_day(1, 0), _at_day(2, 2)]
    result = detect_exam_clusters(events, threshold=2, window_days=3)
    assert len(result) == 1


def test_cluster_carries_window_dates_and_titles():
    events = [
        _at_day(1, 0, "CS final exam"),
        _at_day(2, 2, "Math midterm"),
        _at_day(3, 4, "Physics quiz"),
    ]
    result = detect_exam_clusters(events)
    assert result[0].window_start == "2026-01-01"
    assert result[0].window_end == "2026-01-05"
    assert result[0].titles == ["CS final exam", "Math midterm", "Physics quiz"]


def test_unsorted_input_is_handled():
    events = [_at_day(3, 4), _at_day(1, 0), _at_day(2, 2)]
    result = detect_exam_clusters(events)
    assert len(result) == 1
    assert result[0].event_ids == [1, 2, 3]


def test_events_without_id_are_dropped_from_event_ids():
    events = [
        _Ev(id=None, title="CS final exam", start_time="2026-01-01T09:00"),
        _Ev(id=2, title="Math midterm", start_time="2026-01-02T09:00"),
        _Ev(id=3, title="Quiz", start_time="2026-01-03T09:00"),
    ]
    result = detect_exam_clusters(events)
    assert len(result) == 1
    assert result[0].event_ids == [2, 3]
    assert len(result[0].titles) == 3
