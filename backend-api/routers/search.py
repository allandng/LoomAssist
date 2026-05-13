from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.deps import get_db
from database import models
from loom_logger import get_logger

router = APIRouter(prefix="/search")
logger = get_logger("main")


class SemanticSearchResult(BaseModel):
    event: dict
    score: float


@router.get("/semantic")
def semantic_search(q: str, k: int = 10, db: Session = Depends(get_db)):
    try:
        # Lazy import: keeps sentence-transformers out of app boot path.
        # See services/ai/embedder.py for the lazy-load contract.
        from services.ai.embedder import search as embedding_search
        hits = embedding_search(q, k, db)
    except Exception as e:
        logger.error(f"Semantic search error: {e}")
        return {"results": []}

    results = []
    for event_id, score in hits:
        ev = db.query(models.Event).filter(models.Event.id == event_id).first()
        if ev:
            results.append({"event": ev.model_dump(), "score": round(score, 4)})
    return {"results": results}


@router.post("/reindex")
def reindex_embeddings(db: Session = Depends(get_db)):
    try:
        # Lazy import: keeps sentence-transformers out of app boot path.
        # See services/ai/embedder.py for the lazy-load contract.
        from services.ai.embedder import upsert_event_embedding
        events = db.query(models.Event).all()
        count = 0
        for ev in events:
            try:
                upsert_event_embedding(ev.id, ev.title, ev.description, db)
                count += 1
            except Exception as e:
                logger.warning(f"Reindex failed for event {ev.id}: {e}")
        return {"reindexed": count}
    except Exception as e:
        logger.error(f"Reindex error: {e}")
        raise HTTPException(
            status_code=500,
            detail={"error": {"code": "reindex_failed", "detail": str(e)}},
        )
