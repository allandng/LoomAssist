import requests
from icalendar import Calendar as iCal
from datetime import datetime

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