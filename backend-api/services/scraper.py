import requests
from icalendar import Calendar as iCal
from datetime import datetime, date


def fetch_and_parse_ics(ics_url: str):
    """
    Fetches an .ics calendar feed from Canvas/Classroom and parses it into Loom events.
    """
    # 1. Download the calendar feed
    response = requests.get(ics_url)
    if response.status_code != 200:
        raise Exception("Failed to download calendar feed. Check the URL.")

    # 2. Parse the file
    cal = iCal.from_ical(response.content)
    parsed_events = []

    # 3. Loop through every event in the feed
    for component in cal.walk('vevent'):
        # Extract title and dates
        title = component.get('summary')
        start = component.get('dtstart').dt
        end = component.get('dtend')

        # If there's an end time, grab it; otherwise, just use the start time
        end_time = end.dt if end else start

        # Format everything into a clean dictionary
        parsed_events.append({
            "title": str(title),
            "start_time": start.isoformat(),
            "end_time": end_time.isoformat()
        })
        
    return parsed_events

def parse_ics_bytes(file_bytes: bytes):
    """
    Parses raw .ics file bytes into Loom events.
    """
    cal = iCal.from_ical(file_bytes)
    parsed_events = []

    for component in cal.walk('vevent'):
        title = component.get('summary')
        start_dt = component.get('dtstart').dt
        end_dt_prop = component.get('dtend')
        end_dt = end_dt_prop.dt if end_dt_prop else start_dt

        # Guardrail: Handle all-day events (date objects instead of datetime)
        if isinstance(start_dt, date) and not isinstance(start_dt, datetime):
            start_str = start_dt.isoformat() + "T00:00:00"
        else:
            start_str = start_dt.isoformat()
        
        if isinstance(end_dt, date) and not isinstance(end_dt, datetime):
            end_str = end_dt.isoformat() + "T23:59:59"
        else:
            end_str = end_dt.isoformat()

        parsed_events.append({
            "title": str(title) if title else "Untitled Event",
            "start_time": start_str,
            "end_time": end_str
        })
        
    return parsed_events