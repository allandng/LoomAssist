"""Stage 0: set thread/parallelism env vars before any heavy import.

MUST be imported as the first line of main.py. Setting these *after* torch,
faster-whisper (CTranslate2), or transformers/tokenizers have already
initialized has no effect — the libraries snapshot env vars at import time.

The semaphore-leak symptom on uvicorn shutdown is partly driven by
multiprocessing workers spawned at default thread counts (CPU core count).
Capping these to a small fixed number reduces leak surface and makes shutdown
deterministic.
"""
import os

os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
# Do NOT set CT2_USE_MKL — auto-detect is correct on Apple Silicon.
