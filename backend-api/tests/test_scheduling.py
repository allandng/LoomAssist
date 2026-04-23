"""
Unit tests for the free-slot scheduling algorithm used in POST /schedule/find-free.

The algorithm is replicated here as a pure function so tests have no FastAPI /
database dependencies. This tests the specification: given busy intervals and
working-hour constraints, the algorithm must return valid, non-overlapping free
slots of the requested duration.
"""
import pytest
from datetime import datetime, timedelta


# ---------------------------------------------------------------------------
# Replicated algorithm (mirrors main.py find_free_slots exactly)
# ---------------------------------------------------------------------------

def _find_free_slots(busy, search_start, search_end, duration_minutes,
                     work_start_h=9, work_end_h=18, max_slots=5):
    """Pure implementation of the spec algorithm for unit testing."""
    duration = timedelta(minutes=duration_minutes)
    busy_sorted = sorted(busy)
    free_slots = []

    cursor = search_start.replace(hour=work_start_h, minute=0, second=0, microsecond=0)
    if cursor < search_start:
        cursor = search_start

    while cursor + duration <= search_end and len(free_slots) < max_slots:
        slot_end = cursor + duration
        if cursor.hour < work_start_h or slot_end.hour > work_end_h:
            cursor += timedelta(minutes=15)
            continue
        overlaps = any(b_s < slot_end and b_e > cursor for b_s, b_e in busy_sorted)
        if not overlaps:
            free_slots.append({"start": cursor.isoformat(), "end": slot_end.isoformat()})
            cursor = slot_end
        else:
            cursor += timedelta(minutes=15)

    return free_slots


def dt(s):
    return datetime.fromisoformat(s)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestEmptyCalendar:
    def test_returns_up_to_five_slots(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T08:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        assert len(slots) == 5

    def test_first_slot_starts_at_work_start(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T06:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        assert slots[0]["start"] == "2024-04-25T09:00:00"
        assert slots[0]["end"] == "2024-04-25T10:00:00"

    def test_slot_duration_is_exact(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=90,
        )
        for slot in slots:
            s = datetime.fromisoformat(slot["start"])
            e = datetime.fromisoformat(slot["end"])
            assert e - s == timedelta(minutes=90)

    def test_slots_do_not_overlap_each_other(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        for i in range(len(slots) - 1):
            end_i = datetime.fromisoformat(slots[i]["end"])
            start_next = datetime.fromisoformat(slots[i + 1]["start"])
            assert start_next >= end_i


class TestWorkingHours:
    def test_no_slot_before_work_start(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T06:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        for slot in slots:
            assert datetime.fromisoformat(slot["start"]).hour >= 9

    def test_no_slot_ending_after_work_end(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T20:00:00"),
            duration_minutes=60,
            work_end_h=18,
        )
        for slot in slots:
            assert datetime.fromisoformat(slot["end"]).hour <= 18

    def test_custom_working_hours(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T22:00:00"),
            duration_minutes=60,
            work_start_h=10,
            work_end_h=14,
        )
        for slot in slots:
            assert datetime.fromisoformat(slot["start"]).hour >= 10
            assert datetime.fromisoformat(slot["end"]).hour <= 14


class TestBusyPeriods:
    def test_skips_single_busy_block(self):
        busy = [(dt("2024-04-25T09:00:00"), dt("2024-04-25T11:00:00"))]
        slots = _find_free_slots(
            busy=busy,
            search_start=dt("2024-04-25T08:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        for slot in slots:
            start = datetime.fromisoformat(slot["start"])
            end = datetime.fromisoformat(slot["end"])
            # No slot may overlap [09:00, 11:00)
            assert not (start < dt("2024-04-25T11:00:00") and end > dt("2024-04-25T09:00:00"))

    def test_fully_busy_day_returns_empty(self):
        busy = [(dt("2024-04-25T09:00:00"), dt("2024-04-25T18:00:00"))]
        slots = _find_free_slots(
            busy=busy,
            search_start=dt("2024-04-25T08:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        assert slots == []

    def test_multiple_busy_blocks(self):
        busy = [
            (dt("2024-04-25T09:00:00"), dt("2024-04-25T10:00:00")),
            (dt("2024-04-25T11:00:00"), dt("2024-04-25T12:00:00")),
            (dt("2024-04-25T13:00:00"), dt("2024-04-25T14:00:00")),
        ]
        slots = _find_free_slots(
            busy=busy,
            search_start=dt("2024-04-25T08:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        # Verify no returned slot overlaps any busy period
        for slot in slots:
            s = datetime.fromisoformat(slot["start"])
            e = datetime.fromisoformat(slot["end"])
            for b_s, b_e in busy:
                assert not (b_s < e and b_e > s), f"Slot {slot} overlaps busy {b_s}-{b_e}"

    def test_unsorted_busy_still_works(self):
        busy = [
            (dt("2024-04-25T13:00:00"), dt("2024-04-25T14:00:00")),
            (dt("2024-04-25T09:00:00"), dt("2024-04-25T10:00:00")),
        ]
        slots = _find_free_slots(
            busy=busy,
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        assert len(slots) > 0
        for slot in slots:
            s = datetime.fromisoformat(slot["start"])
            e = datetime.fromisoformat(slot["end"])
            for b_s, b_e in busy:
                assert not (b_s < e and b_e > s)


class TestEdgeCases:
    def test_duration_larger_than_window_returns_empty(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T10:00:00"),
            duration_minutes=120,
        )
        assert slots == []

    def test_duration_exactly_fills_remaining_work_day(self):
        # 2h left before work_end_h=18, duration=120 → exactly one slot
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T16:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=120,
        )
        assert len(slots) == 1
        assert slots[0]["start"] == "2024-04-25T16:00:00"
        assert slots[0]["end"] == "2024-04-25T18:00:00"

    def test_max_slots_respected(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-30T18:00:00"),
            duration_minutes=30,
            max_slots=3,
        )
        assert len(slots) == 3

    def test_search_start_after_work_start_uses_search_start(self):
        # cursor is clamped to search_start when it's past work_start
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T10:30:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        # First slot must not start before 10:30
        assert datetime.fromisoformat(slots[0]["start"]) >= dt("2024-04-25T10:30:00")

    def test_empty_window_returns_empty(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T18:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        assert slots == []
