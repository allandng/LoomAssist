"""Phase v3.0 ics_normalize tests — iCalendar ↔ event payload roundtrip.

Pure-function module; no DB needed.
"""
from services.sync.ics_normalize import parse_ics, to_ics


SAMPLE_ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:abc-123@test
DTSTART:20260423T140000
DTEND:20260423T153000
SUMMARY:OS Lecture
DESCRIPTION:Topic: B-trees
LOCATION:Soda 306
DTSTAMP:20260423T100000
END:VEVENT
END:VCALENDAR
"""


def test_parse_ics_basic_vevent():
    events = parse_ics(SAMPLE_ICS)
    assert len(events) == 1
    e = events[0]
    assert e["title"] == "OS Lecture"
    assert "2026-04-23" in e["start_time"]
    assert "2026-04-23" in e["end_time"]
    assert e["description"] == "Topic: B-trees"
    assert e["location"] == "Soda 306"
    assert e["external_uid"] == "abc-123@test"
    assert e["is_all_day"] is False


def test_parse_ics_skips_components_without_summary_or_dtstart():
    bad = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:no-summary@test
DTSTART:20260423T140000
END:VEVENT
END:VCALENDAR
"""
    assert parse_ics(bad) == []


def test_parse_ics_all_day_event():
    ics = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:all-day@test
SUMMARY:Spring Break
DTSTART;VALUE=DATE:20260413
DTEND;VALUE=DATE:20260418
END:VEVENT
END:VCALENDAR
"""
    events = parse_ics(ics)
    assert len(events) == 1
    e = events[0]
    assert e["is_all_day"] is True
    assert e["start_time"].startswith("2026-04-13")
    assert e["title"] == "Spring Break"


def test_to_ics_then_parse_roundtrip():
    """Serialize a LoomAssist event dict to .ics, then parse it back. The
    fields we care about (title, start, end, description, location, uid)
    survive the roundtrip."""
    ev = {
        "title":         "Standup",
        "start_time":    "2026-04-23T09:00:00",
        "end_time":      "2026-04-23T09:30:00",
        "description":   "Daily check-in",
        "location":      "Zoom",
        "external_uid":  "loom-event-42@test",
        "is_all_day":    False,
    }
    blob = to_ics(ev)
    assert "BEGIN:VEVENT" in blob
    assert "Standup" in blob
    assert "Daily check-in" in blob
    assert "Zoom" in blob
    parsed = parse_ics(blob)
    assert len(parsed) == 1
    p = parsed[0]
    assert p["title"]        == "Standup"
    assert p["description"]  == "Daily check-in"
    assert p["location"]     == "Zoom"
    assert p["external_uid"] == "loom-event-42@test"


def test_to_ics_synthesizes_uid_when_missing():
    """CalDAV servers reject VEVENTs without a UID; to_ics() must synthesize
    one if the caller didn't provide external_uid."""
    ev = {
        "title":      "No UID",
        "start_time": "2026-04-23T09:00:00",
        "end_time":   "2026-04-23T10:00:00",
    }
    blob = to_ics(ev)
    parsed = parse_ics(blob)
    assert len(parsed) == 1
    assert parsed[0]["external_uid"]  # non-empty
    assert "@" in parsed[0]["external_uid"]


def test_to_ics_all_day_event():
    ev = {
        "title":      "Vacation",
        "start_time": "2026-07-01T00:00:00",
        "end_time":   "2026-07-08T00:00:00",
        "is_all_day": True,
    }
    blob = to_ics(ev)
    parsed = parse_ics(blob)
    assert len(parsed) == 1
    assert parsed[0]["is_all_day"] is True
    assert parsed[0]["title"] == "Vacation"
