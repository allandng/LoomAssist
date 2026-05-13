import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models

router = APIRouter()


class CourseCreate(BaseModel):
    name: str
    code: Optional[str] = None
    instructor: Optional[str] = None
    syllabus_path: Optional[str] = None
    timeline_id: Optional[int] = None
    grade_weights: str = "[]"
    color: str = "#6366f1"


class AssignmentCreate(BaseModel):
    course_id: int
    title: str
    due_date: str
    weight_category: Optional[str] = None
    score: Optional[float] = None
    max_score: Optional[float] = None
    event_id: Optional[int] = None


class AssignmentUpdate(BaseModel):
    title: Optional[str] = None
    due_date: Optional[str] = None
    weight_category: Optional[str] = None
    score: Optional[float] = None
    max_score: Optional[float] = None
    event_id: Optional[int] = None


# -- Courses CRUD --

@router.get("/courses", response_model=list[models.CourseRead])
def list_courses(db: Session = Depends(get_db)):
    return db.query(models.Course).all()


@router.post("/courses", response_model=models.CourseRead)
def create_course(body: CourseCreate, db: Session = Depends(get_db)):
    course = models.Course(**body.model_dump())
    db.add(course)
    db.commit()
    db.refresh(course)
    return course


@router.put("/courses/{course_id}", response_model=models.CourseRead)
def update_course(course_id: int, body: CourseCreate, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    for k, v in body.model_dump().items():
        setattr(course, k, v)
    db.commit()
    db.refresh(course)
    return course


@router.delete("/courses/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(course)
    db.commit()
    return {"status": "deleted"}


# -- Assignments CRUD --

@router.get("/assignments", response_model=list[models.AssignmentRead])
def list_assignments(
    course_id: Optional[int] = None,
    event_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.Assignment)
    if course_id:
        q = q.filter(models.Assignment.course_id == course_id)
    if event_id is not None:
        q = q.filter(models.Assignment.event_id == event_id)
    return q.order_by(models.Assignment.due_date).all()


@router.post("/assignments", response_model=models.AssignmentRead)
def create_assignment(body: AssignmentCreate, db: Session = Depends(get_db)):
    a = models.Assignment(**body.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@router.put("/assignments/{assignment_id}", response_model=models.AssignmentRead)
def update_assignment(assignment_id: int, body: AssignmentUpdate, db: Session = Depends(get_db)):
    a = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(a, k, v)
    db.commit()
    db.refresh(a)
    return a


@router.delete("/assignments/{assignment_id}")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):
    a = db.query(models.Assignment).filter(models.Assignment.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})
    db.delete(a)
    db.commit()
    return {"status": "deleted"}


# -- Grade calculation --

@router.get("/courses/{course_id}/grade")
def get_course_grade(course_id: int, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail={"error": {"code": "not_found"}})

    try:
        weights: list[dict] = json.loads(course.grade_weights or "[]")
    except (json.JSONDecodeError, TypeError):
        weights = []

    assignments = db.query(models.Assignment).filter(
        models.Assignment.course_id == course_id
    ).all()

    # Map category → weight
    weight_map = {w["name"]: float(w["weight"]) for w in weights if "name" in w and "weight" in w}

    # Per-category: weighted average of scored assignments
    category_scores: dict[str, list[float]] = {}
    for a in assignments:
        if a.score is None or a.max_score is None or a.max_score == 0:
            continue
        cat = a.weight_category or "Unweighted"
        pct = (a.score / a.max_score) * 100
        category_scores.setdefault(cat, []).append(pct)

    if not weight_map:
        # No weights — simple average
        all_pcts = [p for ps in category_scores.values() for p in ps]
        grade = round(sum(all_pcts) / len(all_pcts), 2) if all_pcts else None
        return {"grade": grade, "breakdown": {}}

    total_weight = 0.0
    weighted_sum = 0.0
    breakdown:  dict[str, Optional[float]] = {}
    for cat, w in weight_map.items():
        scores = category_scores.get(cat, [])
        avg = round(sum(scores) / len(scores), 2) if scores else None
        breakdown[cat] = avg
        if avg is not None:
            weighted_sum += avg * w
            total_weight += w

    grade = round(weighted_sum / total_weight, 2) if total_weight else None
    return {"grade": grade, "breakdown": breakdown}
