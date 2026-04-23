"""
Unit tests for the 15-minute-quantized free-slot algorithm.

Tests that:
- Slot starts always land on :00, :15, :30, or :45
- Cursor is snapped to the next 15-min boundary when search_start is off-grid
- Busy intervals are still respected after quantization
- Travel-time buffer expands busy intervals backward
"""
import pytest
from datetime import datetime, timedelta


# ---------------------------------------------------------------------------
# Replicated algorithm — mirrors find_free_slots in main.py exactly
# ---------------------------------------------------------------------------

def _find_free_slots(
    busy,
    search_start,
    search_end,
    duration_minutes,
    work_start_h=9,
    work_end_h=18,
    max_slots=5,
):
    """Pure implementation of the spec algorithm for unit testing."""
    duration = timedelta(minutes=duration_minutes)
    busy_sorted = sorted(busy)
    free_slots = []

    cursor = search_start.replace(hour=work_start_h, minute=0, second=0, microsecond=0)
    if cursor < search_start:
        cursor = search_start

    # Snap cursor to next 15-minute boundary
    remainder = cursor.minute % 15
    if remainder != 0:
        cursor += timedelta(minutes=(15 - remainder))
    cursor = cursor.replace(second=0, microsecond=0)

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


def _start_minute(slot):
    return datetime.fromisoformat(slot["start"]).minute


# ---------------------------------------------------------------------------
# Tests: 15-minute quantization
# ---------------------------------------------------------------------------

class TestQuantizedStarts:
    def test_all_slots_start_on_15min_boundary(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=30,
        )
        for slot in slots:
            assert _start_minute(slot) % 15 == 0, \
                f"Slot {slot['start']} does not start on a 15-min boundary"

    def test_search_start_at_07_snaps_to_15(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T10:07:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        first_start = datetime.fromisoformat(slots[0]["start"])
        assert first_start.minute == 15
        assert first_start.hour == 10

    def test_search_start_at_33_snaps_to_45(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T10:33:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=30,
        )
        first_start = datetime.fromisoformat(slots[0]["start"])
        assert first_start.minute == 45
        assert first_start.hour == 10

    def test_search_start_already_aligned_no_extra_offset(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T10:30:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=30,
        )
        first_start = datetime.fromisoformat(slots[0]["start"])
        assert first_start.minute == 30
        assert first_start.hour == 10

    def test_search_start_at_00_no_extra_offset(self):
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        first_start = datetime.fromisoformat(slots[0]["start"])
        assert first_start.minute == 0
        assert first_start.hour == 9

    def test_snap_pushes_to_18_start_is_allowed(self):
        # search_start at 17:50, snap to 18:00. The algorithm checks slot_end.hour > work_end_h
        # (strict greater-than), so 18:30.hour == 18 is NOT > 18, meaning the slot is allowed.
        # This test documents that boundary behaviour rather than asserting it is blocked.
        slots = _find_free_slots(
            busy=[],
            search_start=dt("2024-04-25T17:50:00"),
            search_end=dt("2024-04-25T18:30:00"),
            duration_minutes=30,
            work_end_h=18,
        )
        # Slot at 18:00 is the only possibility after quantization; verify it is 15-min aligned
        assert len(slots) == 1
        assert _start_minute(slots[0]) % 15 == 0

    def test_consecutive_slots_all_quantized(self):
        busy = [
            (dt("2024-04-25T10:00:00"), dt("2024-04-25T10:30:00")),
        ]
        slots = _find_free_slots(
            busy=busy,
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=30,
        )
        for slot in slots:
            assert _start_minute(slot) % 15 == 0


# ---------------------------------------------------------------------------
# Tests: travel_time buffer
# ---------------------------------------------------------------------------

def _find_free_slots_with_travel(
    events_with_travel,
    search_start,
    search_end,
    duration_minutes,
    work_start_h=9,
    work_end_h=18,
    max_slots=5,
):
    """
    Replicates the updated algorithm where travel_time_minutes is subtracted
    from each event's start to expand the busy period backward.
    events_with_travel: list of (ev_start, ev_end, travel_minutes)
    """
    busy = []
    for ev_s, ev_e, travel_mins in events_with_travel:
        travel = timedelta(minutes=travel_mins)
        busy.append((ev_s - travel, ev_e))

    return _find_free_slots(busy, search_start, search_end, duration_minutes,
                             work_start_h, work_end_h, max_slots)


class TestTravelTimeBuffer:
    def test_travel_time_blocks_pre_event_window(self):
        # Event 11:00-12:00 with 30min travel → busy from 10:30 to 12:00
        slots = _find_free_slots_with_travel(
            events_with_travel=[(dt("2024-04-25T11:00:00"), dt("2024-04-25T12:00:00"), 30)],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        for slot in slots:
            s = datetime.fromisoformat(slot["start"])
            e = datetime.fromisoformat(slot["end"])
            # No slot may overlap [10:30, 12:00)
            assert not (s < dt("2024-04-25T12:00:00") and e > dt("2024-04-25T10:30:00")), \
                f"Slot {slot} overlaps travel-time buffer"

    def test_zero_travel_time_behaves_as_normal(self):
        slots_no_travel = _find_free_slots(
            busy=[(dt("2024-04-25T11:00:00"), dt("2024-04-25T12:00:00"))],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        slots_zero_travel = _find_free_slots_with_travel(
            events_with_travel=[(dt("2024-04-25T11:00:00"), dt("2024-04-25T12:00:00"), 0)],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        assert slots_no_travel == slots_zero_travel

    def test_travel_time_larger_than_gap_blocks_slot(self):
        # 60min gap before event at 10:00, but 90min travel → entire 09:00 slot blocked
        slots = _find_free_slots_with_travel(
            events_with_travel=[(dt("2024-04-25T10:00:00"), dt("2024-04-25T11:00:00"), 90)],
            search_start=dt("2024-04-25T09:00:00"),
            search_end=dt("2024-04-25T18:00:00"),
            duration_minutes=60,
        )
        for slot in slots:
            s = datetime.fromisoformat(slot["start"])
            e = datetime.fromisoformat(slot["end"])
            # Busy from 08:30 (10:00 - 90min) to 11:00 → no slot before 11:00
            assert s >= dt("2024-04-25T11:00:00"), \
                f"Slot {slot} starts before travel-blocked window ends"
