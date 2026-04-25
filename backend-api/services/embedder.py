"""
Phase 6 — on-device semantic search via sentence-transformers.
Model loads lazily on first call; never fetches from the network at runtime
once the model is cached (set TRANSFORMERS_OFFLINE=1 to verify).
"""
from __future__ import annotations
import numpy as np
from datetime import datetime
from sqlalchemy.orm import Session
from database import models

_MODEL_NAME = "all-MiniLM-L6-v2"
_model = None  # lazy singleton


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(_MODEL_NAME)
    return _model


def embed(text: str) -> np.ndarray:
    """Return a float32 embedding vector for the given text."""
    model = _get_model()
    vec = model.encode(text, convert_to_numpy=True).astype(np.float32)
    return vec


def upsert_event_embedding(event_id: int, title: str, description: str | None, db: Session) -> None:
    combined = title
    if description:
        combined = f"{title}. {description}"
    vec = embed(combined)
    blob = vec.tobytes()
    now  = datetime.now().isoformat()

    existing = db.query(models.EventEmbedding).filter(
        models.EventEmbedding.event_id == event_id
    ).first()
    if existing:
        existing.vector     = blob
        existing.model      = _MODEL_NAME
        existing.updated_at = now
    else:
        db.add(models.EventEmbedding(
            event_id=event_id, vector=blob, model=_MODEL_NAME, updated_at=now,
        ))
    db.commit()


def delete_event_embedding(event_id: int, db: Session) -> None:
    row = db.query(models.EventEmbedding).filter(
        models.EventEmbedding.event_id == event_id
    ).first()
    if row:
        db.delete(row)
        db.commit()


def search(query: str, k: int, db: Session) -> list[tuple[int, float]]:
    """Return [(event_id, cosine_similarity)] sorted descending."""
    rows = db.query(models.EventEmbedding).all()
    if not rows:
        return []

    q_vec = embed(query)
    q_norm = np.linalg.norm(q_vec)
    if q_norm == 0:
        return []

    scores: list[tuple[int, float]] = []
    for row in rows:
        v = np.frombuffer(row.vector, dtype=np.float32)
        v_norm = np.linalg.norm(v)
        if v_norm == 0:
            continue
        sim = float(np.dot(q_vec, v) / (q_norm * v_norm))
        scores.append((row.event_id, sim))

    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:k]
