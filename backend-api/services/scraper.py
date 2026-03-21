import requests
from icalendar import Calendar as iCal
from datetime import datetime, date


def fetch_and_parse_ics(ics_url: str):
    """
    Fetches an .ics calendar feed from Canvas/Classroom and parses it into Loom events.
    """
    response = requests.get(ics_url)
    if response.status_code != 200:
        raise Exception("Failed to download calendar feed. Check the URL.")

    cal = iCal.from_ical(response.content)
    parsed_events = []

    for component in cal.walk('vevent'):
        title = component.get('summary')
        start_dt_prop = component.get('dtstart')
        start = start_dt_prop.dt
        end_dt_prop = component.get('dtend')
        end = end_dt_prop.dt if end_dt_prop else start

        # Extract Timezone
        timezone_str = 'local'
        if hasattr(start_dt_prop, 'params') and 'TZID' in start_dt_prop.params:
            timezone_str = str(start_dt_prop.params['TZID'])

        parsed_events.append({
            "title": str(title) if title else 'Untitled Event',
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "timezone": timezone_str
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
        start_dt_prop = component.get('dtstart')
        start_dt = start_dt_prop.dt
        end_dt_prop = component.get('dtend')
        end_dt = end_dt_prop.dt if end_dt_prop else start_dt
        
        uid = component.get('uid')

        # Extract Timezone
        timezone_str = 'local'
        if hasattr(start_dt_prop, 'params') and 'TZID' in start_dt_prop.params:
            timezone_str = str(start_dt_prop.params['TZID'])

        if isinstance(start_dt, date) and not isinstance(start_dt, datetime):
            start_str = start_dt.isoformat() + "T00:00:00"
        else:
            start_str = start_dt.isoformat()
        
        if isinstance(end_dt, date) and not isinstance(end_dt, datetime):
            end_str = end_dt.isoformat() + "T23:59:59"
        else:
            end_str = end_dt.isoformat()

        parsed_events.append({
            "title": str(title) if title else 'Untitled Event',
            "start_time": start_str,
            "end_time": end_str,
            "external_uid": str(uid) if uid else None,
            "timezone": timezone_str
        })
        
    return parsed_events