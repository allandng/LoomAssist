"""
Demo seed script — populates LoomAssist with realistic sample data.

Usage:
    cd backend-api && source venv/bin/activate && python3 seed_demo.py

Run again to reset (drops all rows first, then re-inserts).
"""

from database.database import SessionLocal, engine, run_migrations
from database import models
from sqlmodel import SQLModel
from datetime import datetime, timedelta, date
import json

run_migrations()
SQLModel.metadata.create_all(engine)

db = SessionLocal()

# ── wipe existing demo data ──────────────────────────────────────────────────
for model in [
    models.Task, models.EventEmbedding, models.Event, models.Calendar,
    models.JournalEntry, models.InboxItem, models.Assignment, models.Course,
    models.EventTemplate,
]:
    db.query(model).delete()
db.commit()

# ── helpers ──────────────────────────────────────────────────────────────────
TODAY   = date(2026, 4, 25)          # Saturday
MONDAY  = TODAY - timedelta(days=5)  # Mon Apr 20
NOW     = datetime.now().isoformat()

def dt(d: date, h: int, m: int = 0) -> str:
    return datetime(d.year, d.month, d.day, h, m).isoformat()

def day(offset: int) -> date:
    return TODAY + timedelta(days=offset)

# ── Calendars ────────────────────────────────────────────────────────────────
work    = models.Calendar(name="Work",     color="#6366f1", description="Professional commitments")
personal = models.Calendar(name="Personal", color="#10b981", description="Life outside the office")
school  = models.Calendar(name="School",   color="#f59e0b", description="Courses and study sessions")
fitness = models.Calendar(name="Fitness",  color="#ef4444", description="Workouts and health")
for c in [work, personal, school, fitness]:
    db.add(c)
db.commit()
for c in [work, personal, school, fitness]:
    db.refresh(c)
W, P, S, F = work.id, personal.id, school.id, fitness.id

print(f"Calendars: Work={W}, Personal={P}, School={S}, Fitness={F}")

# ── Events ───────────────────────────────────────────────────────────────────
events_data = [

    # ── This past week (Mon Apr 20 – Fri Apr 24) ──────────────────────────

    # Recurring standup Mon-Fri (stored as single recurring row)
    dict(title="Team Standup", start_time=dt(MONDAY, 9), end_time=dt(MONDAY, 9, 30),
         calendar_id=W, is_recurring=True, recurrence_days="1,2,3,4,5",
         recurrence_end="2026-12-31", description="Daily sync with engineering team",
         reminder_minutes=5, reminder_source="user"),

    # Mon
    dict(title="Sprint Planning", start_time=dt(day(-5), 10), end_time=dt(day(-5), 12),
         calendar_id=W, description="Plan Q2 sprint 8 — story point estimation and prioritisation",
         reminder_minutes=15, reminder_source="inferred",
         checklist=json.dumps([
             {"text": "Review backlog", "done": True},
             {"text": "Assign story points", "done": True},
             {"text": "Set sprint goal", "done": True},
         ])),

    # Tue
    dict(title="1:1 with Maya", start_time=dt(day(-4), 14), end_time=dt(day(-4), 15),
         calendar_id=W, description="Weekly check-in with engineering manager",
         reminder_minutes=10, reminder_source="inferred"),

    dict(title="Evening Run", start_time=dt(day(-4), 18), end_time=dt(day(-4), 19),
         calendar_id=F, description="5km easy pace around the park", reminder_minutes=30,
         reminder_source="inferred", location="Riverside Park", travel_time_minutes=10),

    # Wed
    dict(title="System Design Review", start_time=dt(day(-3), 11), end_time=dt(day(-3), 12, 30),
         calendar_id=W, description="Architecture review for the new notification service"),

    dict(title="CS 301 Lecture", start_time=dt(day(-3), 14), end_time=dt(day(-3), 15, 30),
         calendar_id=S, description="Distributed Systems — CAP theorem and consistency models",
         location="Engineering Hall Rm 204", travel_time_minutes=15),

    # Thu
    dict(title="Code Review Session", start_time=dt(day(-2), 10), end_time=dt(day(-2), 11),
         calendar_id=W, description="Review PRs for the auth refactor"),

    dict(title="Lunch with Alex", start_time=dt(day(-2), 12, 30), end_time=dt(day(-2), 13, 30),
         calendar_id=P, description="Catching up — try the new ramen place",
         location="Sakura Ramen, 42 Market St", travel_time_minutes=12),

    dict(title="MATH 401 Lecture", start_time=dt(day(-2), 16), end_time=dt(day(-2), 17, 30),
         calendar_id=S, description="Numerical Methods — LU decomposition",
         location="Science Building Rm 110", travel_time_minutes=10),

    # Fri
    dict(title="Sprint Demo", start_time=dt(day(-1), 10), end_time=dt(day(-1), 11),
         calendar_id=W, description="Showcase sprint 8 deliverables to stakeholders",
         checklist=json.dumps([
             {"text": "Prepare slide deck", "done": True},
             {"text": "Record demo video", "done": True},
             {"text": "Send invite to stakeholders", "done": True},
         ])),

    dict(title="Retrospective", start_time=dt(day(-1), 15), end_time=dt(day(-1), 16),
         calendar_id=W, description="Sprint 8 retro — what went well, what didn't"),

    # ── Today (Sat Apr 25) ─────────────────────────────────────────────────

    dict(title="Morning Yoga", start_time=dt(TODAY, 8), end_time=dt(TODAY, 9),
         calendar_id=F, description="Vinyasa flow — YouTube channel: Yoga with Adriene",
         reminder_minutes=10, reminder_source="user"),

    dict(title="Grocery Shopping", start_time=dt(TODAY, 11), end_time=dt(TODAY, 12),
         calendar_id=P, description="Weekly shop — don't forget the list!",
         location="Whole Foods, 5th Ave", travel_time_minutes=8,
         checklist=json.dumps([
             {"text": "Eggs x12", "done": False},
             {"text": "Spinach", "done": False},
             {"text": "Oat milk", "done": True},
             {"text": "Chicken breast", "done": False},
         ])),

    dict(title="Deep Work Block", start_time=dt(TODAY, 14), end_time=dt(TODAY, 17),
         calendar_id=W, description="Focus time — MATH 401 problem set due Monday"),

    # ── Next week (Mon Apr 27 – Fri May 1) ────────────────────────────────

    dict(title="Sprint 9 Kickoff", start_time=dt(day(2), 10), end_time=dt(day(2), 11),
         calendar_id=W, description="Begin Q2 sprint 9 — auth service migration",
         reminder_minutes=15, reminder_source="inferred"),

    dict(title="Dentist Appointment", start_time=dt(day(2), 15), end_time=dt(day(2), 16),
         calendar_id=P, description="6-month checkup — Dr. Kim",
         location="Bright Smiles Dental, 88 Oak Ave", travel_time_minutes=20,
         reminder_minutes=60, reminder_source="user"),

    dict(title="CS 301 — Assignment 3 Due", start_time=dt(day(3), 23, 59), end_time=dt(day(3), 23, 59),
         calendar_id=S, description="Implement Raft consensus algorithm in Go",
         is_all_day=True, reminder_minutes=1440, reminder_source="user"),

    dict(title="Team Lunch", start_time=dt(day(3), 12), end_time=dt(day(3), 13, 30),
         calendar_id=W, description="Q2 celebration lunch — new restaurant downtown",
         location="Osteria Marco, 1 Union Sq", travel_time_minutes=15),

    dict(title="Gym — Upper Body", start_time=dt(day(4), 7), end_time=dt(day(4), 8),
         calendar_id=F, description="Bench, OHP, rows, curls",
         location="Anytime Fitness", travel_time_minutes=8),

    dict(title="MATH 401 Problem Set Due", start_time=dt(day(5), 23, 59), end_time=dt(day(5), 23, 59),
         calendar_id=S, is_all_day=True, description="Problem set 7 — chapters 8–10",
         reminder_minutes=1440, reminder_source="user"),

    dict(title="Product Roadmap Review", start_time=dt(day(5), 14), end_time=dt(day(5), 15, 30),
         calendar_id=W, description="Q3 roadmap alignment meeting with product and design"),

    # ── Fortnight out ──────────────────────────────────────────────────────

    dict(title="Weekend Hike", start_time=dt(day(8), 8), end_time=dt(day(8), 14),
         calendar_id=F, description="Mt. Tam trail — 12km loop, bring layers",
         location="Mt. Tamalpais State Park", travel_time_minutes=45,
         reminder_minutes=1440, reminder_source="user"),

    dict(title="Flight to NYC", start_time=dt(day(10), 6, 45), end_time=dt(day(10), 9, 30),
         calendar_id=P, description="AA 342 — SFO → JFK. Gate B22. Check bag online.",
         location="SFO Terminal 2", travel_time_minutes=60,
         reminder_minutes=120, reminder_source="user"),

    dict(title="All-Hands Meeting", start_time=dt(day(11), 10), end_time=dt(day(11), 12),
         calendar_id=W, description="Company-wide Q2 review — New York office",
         location="NYC HQ, 100 W 57th St, 12F"),

    dict(title="Final Exams Begin", start_time=dt(day(14), 9), end_time=dt(day(14), 12),
         calendar_id=S, is_all_day=False, description="CS 301 final exam — open notes, no internet",
         location="Engineering Hall Rm 204", travel_time_minutes=15,
         reminder_minutes=1440, reminder_source="user"),
]

event_objects = []
for d in events_data:
    e = models.Event(last_modified=NOW, **d)
    db.add(e)
    event_objects.append(e)
db.commit()
for e in event_objects:
    db.refresh(e)
print(f"Events: {len(event_objects)} inserted")

# Map events by title for task linking
ev_by_title = {e.title: e.id for e in event_objects}

# ── Tasks ────────────────────────────────────────────────────────────────────
tasks_data = [
    # Backlog
    dict(event_id=ev_by_title.get("Sprint 9 Kickoff", 0), note="Write unit tests for the new auth middleware",
         status="backlog", priority="high", is_complete=False,
         due_date=str(day(4)), estimated_minutes=120, deadline=str(day(4))),

    dict(event_id=0, note="Update API documentation for v2 endpoints",
         status="backlog", priority="med", is_complete=False,
         due_date=str(day(7)), estimated_minutes=90, deadline=str(day(7))),

    dict(event_id=0, note="Research rate-limiting libraries for FastAPI",
         status="backlog", priority="low", is_complete=False, estimated_minutes=45),

    dict(event_id=0, note="Clean up dead code in the calendar service module",
         status="backlog", priority="low", is_complete=False, estimated_minutes=60),

    dict(event_id=ev_by_title.get("CS 301 — Assignment 3 Due", 0),
         note="Implement Raft consensus — finish log replication section",
         status="backlog", priority="high", is_complete=False,
         due_date=str(day(3)), estimated_minutes=240, deadline=str(day(3))),

    dict(event_id=0, note="Reply to Maya re: performance review timeline",
         status="backlog", priority="med", is_complete=False, estimated_minutes=15),

    # Doing
    dict(event_id=0, note="Refactor calendar event expansion logic",
         status="doing", priority="high", is_complete=False,
         due_date=str(day(2)), estimated_minutes=180),

    dict(event_id=0, note="Fix timezone bug in recurring event display",
         status="doing", priority="high", is_complete=False,
         due_date=str(day(1)), estimated_minutes=90),

    dict(event_id=ev_by_title.get("MATH 401 Problem Set Due", 0),
         note="Complete MATH 401 problems 8.3 through 9.1",
         status="doing", priority="med", is_complete=False,
         due_date=str(day(5)), estimated_minutes=150, deadline=str(day(5))),

    # Done
    dict(event_id=0, note="Set up GitHub Actions CI pipeline",
         status="done", priority="high", is_complete=True,
         due_date=str(day(-5))),

    dict(event_id=ev_by_title.get("Sprint Demo", 0),
         note="Prepare sprint 8 demo slide deck",
         status="done", priority="high", is_complete=True,
         due_date=str(day(-1))),

    dict(event_id=0, note="Deploy auth service to staging",
         status="done", priority="high", is_complete=True,
         due_date=str(day(-3))),

    dict(event_id=0, note="Write integration tests for inbox API",
         status="done", priority="med", is_complete=True,
         due_date=str(day(-2))),
]

for td in tasks_data:
    t = models.Task(added_at=NOW, last_modified=NOW, **td)
    db.add(t)
db.commit()
print(f"Tasks: {len(tasks_data)} inserted")

# ── Journal Entries ──────────────────────────────────────────────────────────
journal_data = [
    dict(date=str(day(-5)), mood="ok",
         transcript="Monday again. Sprint planning went longer than expected but we landed on a solid goal. Feeling a bit overwhelmed with the Raft assignment piling up on top of work. Need to carve out proper study time this week.",
         created_at=dt(day(-5), 21)),

    dict(date=str(day(-4)), mood="great",
         transcript="Really good 1:1 with Maya today. She mentioned I'm being considered for a senior role which is exciting and terrifying in equal measure. Evening run helped clear my head. Five kilometres felt easy for once.",
         created_at=dt(day(-4), 22)),

    dict(date=str(day(-3)), mood="ok",
         transcript="System design review was productive but exhausting — three hours of whiteboarding. CS 301 lecture on CAP theorem was genuinely interesting. Still haven't started the Raft implementation though. Tomorrow.",
         created_at=dt(day(-3), 23)),

    dict(date=str(day(-2)), mood="rough",
         transcript="Code review session surfaced a bunch of issues I missed. Felt embarrassed. Lunch with Alex helped put things in perspective — everyone has weeks like this. MATH lecture ran over and I missed the last bus home.",
         created_at=dt(day(-2), 22, 30)),

    dict(date=str(day(-1)), mood="great",
         transcript="Sprint demo went really well. Stakeholders were genuinely impressed with the drag-and-drop scheduling feature. Retrospective was healthy — the team is communicating better than ever. Celebrated with the team after.",
         created_at=dt(day(-1), 20)),

    dict(date=str(TODAY), mood="great",
         transcript="Slow Saturday. Morning yoga actually stuck this time — twenty minutes in and I didn't want to stop. Got groceries done early. Spent the afternoon on the MATH problem set. Feels good to be ahead for once.",
         created_at=dt(TODAY, 18)),
]

for jd in journal_data:
    j = models.JournalEntry(**jd)
    db.add(j)
db.commit()
print(f"Journal entries: {len(journal_data)} inserted")

# ── Inbox Items ──────────────────────────────────────────────────────────────
inbox_data = [
    dict(text="Schedule dentist appointment for next month",
         created_at=dt(TODAY, 9), archived=False),

    dict(text="Look into travel insurance for NYC trip",
         created_at=dt(TODAY, 10, 30), archived=False),

    dict(text="Send thank-you email to sprint demo attendees",
         created_at=dt(day(-1), 17), archived=False),

    dict(text="Buy a new charger cable — MacBook one is fraying",
         created_at=dt(day(-2), 14), archived=False),

    dict(text="Review PR #214 from Jordan before Monday",
         created_at=dt(day(-1), 11), archived=False),

    dict(text="Book hotel for NYC — check Marriott points balance",
         created_at=dt(day(-3), 16), archived=False),

    dict(text="Pick up prescription from pharmacy",
         created_at=dt(day(-4), 9), archived=False),
]

for id_ in inbox_data:
    db.add(models.InboxItem(**id_))
db.commit()
print(f"Inbox items: {len(inbox_data)} inserted")

# ── Courses ──────────────────────────────────────────────────────────────────
cs301 = models.Course(
    name="Distributed Systems",
    code="CS 301",
    instructor="Prof. Sarah Chen",
    timeline_id=S,
    color="#6366f1",
    grade_weights=json.dumps([
        {"name": "Assignments", "weight": 40},
        {"name": "Midterm",     "weight": 25},
        {"name": "Final",       "weight": 30},
        {"name": "Participation","weight": 5},
    ]),
)
math401 = models.Course(
    name="Numerical Methods",
    code="MATH 401",
    instructor="Prof. James Park",
    timeline_id=S,
    color="#f59e0b",
    grade_weights=json.dumps([
        {"name": "Problem Sets", "weight": 50},
        {"name": "Midterm",      "weight": 20},
        {"name": "Final",        "weight": 30},
    ]),
)
for course in [cs301, math401]:
    db.add(course)
db.commit()
db.refresh(cs301)
db.refresh(math401)
print(f"Courses: CS301={cs301.id}, MATH401={math401.id}")

# ── Assignments ───────────────────────────────────────────────────────────────
assignments_data = [
    # CS 301
    dict(course_id=cs301.id, title="Assignment 1 — Lamport Clocks",
         due_date=str(day(-21)), weight_category="Assignments",
         score=92.0, max_score=100.0),
    dict(course_id=cs301.id, title="Assignment 2 — Paxos Implementation",
         due_date=str(day(-7)), weight_category="Assignments",
         score=85.0, max_score=100.0),
    dict(course_id=cs301.id, title="Assignment 3 — Raft Consensus",
         due_date=str(day(3)), weight_category="Assignments",
         score=None, max_score=100.0),
    dict(course_id=cs301.id, title="Midterm Exam",
         due_date=str(day(-14)), weight_category="Midterm",
         score=88.0, max_score=100.0),
    dict(course_id=cs301.id, title="Final Exam",
         due_date=str(day(14)), weight_category="Final",
         score=None, max_score=100.0),

    # MATH 401
    dict(course_id=math401.id, title="Problem Set 1",
         due_date=str(day(-28)), weight_category="Problem Sets",
         score=95.0, max_score=100.0),
    dict(course_id=math401.id, title="Problem Set 2",
         due_date=str(day(-21)), weight_category="Problem Sets",
         score=90.0, max_score=100.0),
    dict(course_id=math401.id, title="Problem Set 3",
         due_date=str(day(-14)), weight_category="Problem Sets",
         score=78.0, max_score=100.0),
    dict(course_id=math401.id, title="Problem Set 4",
         due_date=str(day(-7)), weight_category="Problem Sets",
         score=88.0, max_score=100.0),
    dict(course_id=math401.id, title="Problem Set 5",
         due_date=str(day(-3)), weight_category="Problem Sets",
         score=82.0, max_score=100.0),
    dict(course_id=math401.id, title="Problem Set 6",
         due_date=str(day(1)), weight_category="Problem Sets",
         score=None, max_score=100.0),
    dict(course_id=math401.id, title="Problem Set 7",
         due_date=str(day(5)), weight_category="Problem Sets",
         score=None, max_score=100.0),
    dict(course_id=math401.id, title="Midterm",
         due_date=str(day(-10)), weight_category="Midterm",
         score=84.0, max_score=100.0),
    dict(course_id=math401.id, title="Final",
         due_date=str(day(17)), weight_category="Final",
         score=None, max_score=100.0),
]

for ad in assignments_data:
    db.add(models.Assignment(**ad))
db.commit()
print(f"Assignments: {len(assignments_data)} inserted")

# ── Event Templates ───────────────────────────────────────────────────────────
templates = [
    models.EventTemplate(name="Daily Standup", title="Team Standup",
                          duration_minutes=30, is_recurring=True,
                          recurrence_days="1,2,3,4,5", calendar_id=W),
    models.EventTemplate(name="Deep Work Block", title="Deep Work",
                          duration_minutes=120, calendar_id=W,
                          description="Distraction-free focus time"),
    models.EventTemplate(name="Gym Session", title="Gym",
                          duration_minutes=60, calendar_id=F,
                          description="Workout"),
    models.EventTemplate(name="Study Session", title="Study —",
                          duration_minutes=90, calendar_id=S),
    models.EventTemplate(name="1:1 Meeting", title="1:1 with",
                          duration_minutes=60, calendar_id=W),
]
for t in templates:
    db.add(t)
db.commit()
print(f"Templates: {len(templates)} inserted")

db.close()
print("\n✓ Demo data loaded successfully.")
print("  Restart the backend to see all data in the app.")
