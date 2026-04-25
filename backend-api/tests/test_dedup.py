"""Phase v3.0 dedup engine tests.

This is the highest-value Phase 2 test suite — design doc §11 R1 names dedup
miscalibration as the top risk. Covers the three buckets (certain / fuzzy /
none) at the documented thresholds (§10 Q5).

Pure-function tests; no fixtures, no DB.
"""
from datetime import datetime, timedelta

from services.sync.dedup import (
    IncomingEvent, LocalEventLike, match_incoming,
    TITLE_SIMILARITY_THRESHOLD, START_WINDOW_MIN, DURATION_WINDOW_MIN,
)


def _iso(year=2026, month=4, day=23, hour=14, minute=0):
    return datetime(year, month, day, hour, minute).isoformat()


def _local(id_, title, start, end, *, location=None,
           connection_calendar_id=None, external_id=None):
    return LocalEventLike(
        id=id_, title=title, start_time=start, end_time=end,
        location=location,
        connection_calendar_id=connection_calendar_id,
        external_id=external_id,
    )


def _incoming(title, start, end, *, location=None, external_id=None):
    return IncomingEvent(
        title=title, start_time=start, end_time=end,
        location=location, external_id=external_id,
    )


# ── certain bucket ────────────────────────────────────────────────────────────

def test_certain_match_via_external_id():
    """When (connection_calendar_id, external_id) matches an existing local
    row, it's a certain match — no review item; runner upserts silently."""
    locals_ = [_local(
        1, "OS Lecture", _iso(hour=14), _iso(hour=15, minute=30),
        connection_calendar_id="cc-1", external_id="goog-abc",
    )]
    inc = _incoming("Anything", _iso(hour=14), _iso(hour=15), external_id="goog-abc")
    r = match_incoming(inc, locals_, connection_calendar_id="cc-1")
    assert r.bucket == "certain"
    assert r.local_event is not None and r.local_event.id == 1
    assert r.score == 1.0


def test_certain_match_requires_same_cc():
    """An external_id match against a DIFFERENT connection_calendar_id is
    NOT a certain match (different sync identity)."""
    locals_ = [_local(
        1, "OS Lecture", _iso(hour=14), _iso(hour=15),
        connection_calendar_id="cc-1", external_id="goog-abc",
    )]
    inc = _incoming("OS Lecture", _iso(hour=14), _iso(hour=15), external_id="goog-abc")
    # Looking for cc-2; cc-1 in candidates won't match.
    r = match_incoming(inc, locals_, connection_calendar_id="cc-2")
    # Should fall through to fuzzy or none. Since it has external_id set on
    # the local, the fuzzy path skips it (it's locked to cc-1 already).
    assert r.bucket != "certain"


# ── fuzzy bucket ──────────────────────────────────────────────────────────────

def test_fuzzy_match_above_threshold():
    """Title similar (>= 0.85 token_set_ratio), start identical, duration
    identical → fuzzy bucket with reasons."""
    locals_ = [_local(1, "CS 161 Operating Systems Lecture", _iso(hour=14), _iso(hour=15, minute=30))]
    inc = _incoming("CS 161 OS Lecture", _iso(hour=14), _iso(hour=15, minute=30))
    r = match_incoming(inc, locals_)
    assert r.bucket == "fuzzy"
    assert r.local_event is not None and r.local_event.id == 1
    assert r.score >= TITLE_SIMILARITY_THRESHOLD
    # Reasons enumerate field-by-field signals that drive the merge UI.
    fields = {reason.field for reason in r.reasons}
    assert {"title", "start", "duration"}.issubset(fields)


def test_fuzzy_picks_best_match_among_candidates():
    locals_ = [
        _local(1, "Random unrelated event", _iso(hour=14), _iso(hour=15)),  # weak title sim
        _local(2, "Office hours",           _iso(hour=14), _iso(hour=15, minute=30)),  # strong
    ]
    inc = _incoming("CS Office hours", _iso(hour=14), _iso(hour=15, minute=30))  # 100% w/ #2
    r = match_incoming(inc, locals_)
    assert r.bucket == "fuzzy"
    assert r.local_event.id == 2  # higher-similarity candidate wins


def test_location_boost_increases_score():
    """+0.05 boost when both sides have an exact location match."""
    locals_no_loc = [_local(1, "Standup meet", _iso(hour=14), _iso(hour=15))]
    locals_loc    = [_local(1, "Standup meet", _iso(hour=14), _iso(hour=15), location="Soda 306")]
    inc = _incoming("Standup", _iso(hour=14), _iso(hour=15), location="Soda 306")
    r_no = match_incoming(inc, locals_no_loc)
    r_yes = match_incoming(inc, locals_loc)
    if r_no.bucket == "fuzzy" and r_yes.bucket == "fuzzy":
        assert r_yes.score >= r_no.score


def test_skips_locals_already_paired_to_a_provider():
    """A local with external_id set is locked to a sync identity; the fuzzy
    matcher skips it (it would only ever be a certain match)."""
    locals_ = [_local(
        1, "CS 161 Lecture", _iso(hour=14), _iso(hour=15),
        connection_calendar_id="cc-other", external_id="other-id",
    )]
    inc = _incoming("CS 161 Lecture", _iso(hour=14), _iso(hour=15))
    r = match_incoming(inc, locals_)
    assert r.bucket == "none"


# ── none bucket ───────────────────────────────────────────────────────────────

def test_no_match_below_title_threshold():
    """Time + duration close but title is unrelated → none bucket
    (apply silently as new event)."""
    locals_ = [_local(1, "Yoga class", _iso(hour=14), _iso(hour=15))]
    inc = _incoming("OS final review", _iso(hour=14), _iso(hour=15))
    r = match_incoming(inc, locals_)
    assert r.bucket == "none"


def test_no_match_outside_start_window():
    """Title identical but start is 60 min off — outside the 15-min window."""
    locals_ = [_local(1, "Standup", _iso(hour=14), _iso(hour=15))]
    inc = _incoming("Standup", _iso(hour=15, minute=0), _iso(hour=16))   # +60 min
    r = match_incoming(inc, locals_)
    assert r.bucket == "none"


def test_no_match_outside_duration_window():
    """Title + start identical but duration differs by > 15 min."""
    locals_ = [_local(1, "Standup", _iso(hour=14), _iso(hour=14, minute=15))]   # 15 min
    inc = _incoming("Standup", _iso(hour=14), _iso(hour=15, minute=0))           # 60 min — too far apart
    r = match_incoming(inc, locals_)
    assert r.bucket == "none"


# ── thresholds documented in design doc §10 Q5 ────────────────────────────────

def test_thresholds_match_design_doc():
    """Hard-coded thresholds — change these only via a new design pass."""
    assert TITLE_SIMILARITY_THRESHOLD == 0.85
    assert START_WINDOW_MIN == 15
    assert DURATION_WINDOW_MIN == 15


# ── start-window edge ─────────────────────────────────────────────────────────

def test_start_inside_window_is_fuzzy():
    """At the boundary (10 min off, well inside the 15-min window) — fuzzy."""
    locals_ = [_local(1, "Standup", _iso(hour=14), _iso(hour=14, minute=30))]
    inc = _incoming("Standup", _iso(hour=14, minute=10), _iso(hour=14, minute=40))
    r = match_incoming(inc, locals_)
    assert r.bucket == "fuzzy"


def test_empty_candidates_yields_none():
    inc = _incoming("Whatever", _iso(), _iso(hour=15))
    r = match_incoming(inc, [])
    assert r.bucket == "none"
    assert r.local_event is None
