# LoomAssist — v3.0 Architectural Roadmap

> Forward-looking roadmap for the multi-platform pivot. Documents architectural decisions, target stack, sync protocol, and phased delivery plan.
> **Status:** Planning. No code changes start until Stage 0 (active bug fixes) ships.

---

## ⚠️ Read this first, every time

**`CLAUDE.md` is the canonical source of truth for the project's current state.** This roadmap describes *where the project is going*; `CLAUDE.md` describes *where it is right now* — the actual schema, endpoints, file tree, and architectural rules in force.

**Before any work session — human or Claude Code — always:**

1. Read `CLAUDE.md` in full to ground in the current state.
2. Read this roadmap to find the stage being worked on.
3. Read `LoomAssist_UIUX_Guardrail.md` to check what's "ready to build" vs "ask first".
4. If this roadmap and `CLAUDE.md` disagree, **`CLAUDE.md` wins** — and the disagreement is a signal that this roadmap is stale and needs updating.

After every completed stage, **`CLAUDE.md` must be updated** to reflect the new canonical state (new endpoints, schema, rules, completed phases). The execution prompt in §11 enforces this loop.

---

## 1. Context

LoomAssist v2.x is a **single-platform, local-only macOS desktop app** built on Tauri + FastAPI. v2.2 added optional Supabase identity and direct device ↔ provider sync (Google Calendar, CalDAV), but Loom-controlled data sync was never built — the explicit rule was *"calendar/event data never traverses a LoomAssist server."*

v3.0 reopens that decision and adds two things:

1. **Native mobile clients** (iOS / Swift, Android / Kotlin) alongside the existing macOS desktop app.
2. **A Loom-controlled cloud sync layer**, but built so the server holds only opaque ciphertext — preserving the privacy story.

The core product positioning stays: privacy-first, AI inference runs on-device. What changes is that user data can now optionally sync between *the user's own devices* through Loom's infrastructure, with the server cryptographically unable to read it.

---

## 2. Architectural decisions

| Decision | Choice | Rationale |
|---|---|---|
| Mobile UI strategy | **Pure native** (SwiftUI for iOS, Jetpack Compose for Android) | Maximum learning value; best platform UX; intentional maintenance burden as portfolio investment |
| Sync model | **E2E encrypted blob sync** (Standard Notes / Bitwarden pattern) | Preserves "data never leaves device in cleartext" promise even with cloud sync |
| Sync scope | Multi-device for one user (collaboration deferred) | Manageable scope; LWW conflict resolution is sufficient |
| Mobile feature scope | **Read + light edits**, voice → event capture | Phone is companion; tablet expansion later inherits more desktop features |
| AI parity across platforms | **Not required** | Desktop runs full Ollama/Faster-Whisper; mobile runs platform-native small models; complex tasks compute on desktop and sync results down |
| Cloud provider | **AWS** (full stack) | Learning value; clean serverless E2E sync architecture; effectively free at student scale |
| Auth provider | **AWS Cognito** (replacing Supabase Auth) | Consistency within AWS. NOTE: Supabase Auth IS currently wired live (AccountContext, SignInPage, OnboardingPage, routers/auth.py). The Cognito migration carries real frontend cost: OAuth flows, AccountContext semantics, and the /auth/me local-mode contract all need updating. |
| Cloud APIs for AI | **No** by default; opt-in only | Sending plaintext content to third-party LLM APIs would undo the E2E sync privacy guarantee |

---

## 3. Target tech stack (v3.0)

### Desktop (existing — to be refactored, not rewritten)
| Layer | Technology |
|---|---|
| Shell | Tauri v2 (Rust) |
| UI | React 19 + TypeScript + CSS Modules |
| Local store | SQLite via SQLModel |
| AI: STT | Faster-Whisper (base.en, int8, CPU) |
| AI: LLM | Ollama + Llama 3.2 |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) |
| Crypto | `cryptography` (AES-256-GCM + scrypt) |

### iOS (new)
| Layer | Technology |
|---|---|
| UI | SwiftUI |
| Local store | SQLite via GRDB.swift or Core Data |
| AI: STT | WhisperKit |
| AI: LLM | Apple Intelligence Foundation Models (iOS 18.1+); fall back to llama.cpp + Llama 3.2 3B for older devices |
| Crypto | CryptoKit |
| Sync client | URLSession + custom delta engine |

### Android (new)
| Layer | Technology |
|---|---|
| UI | Jetpack Compose |
| Local store | Room (SQLite) |
| AI: STT | whisper.cpp via JNI |
| AI: LLM | MediaPipe LLM Inference (Gemma 3 4B on flagships, Gemma 3 1B / Phi-4 Mini on mid-range) |
| Crypto | Tink |
| Sync client | OkHttp + custom delta engine |

### Cloud (new — AWS)
| Concern | Service |
|---|---|
| Identity | Cognito User Pools (Lite tier; 10K MAU free) |
| Sync API | API Gateway (HTTP API) + Lambda |
| Sync metadata | DynamoDB (single table, GSI on `last_modified`) |
| Encrypted blob storage | (DynamoDB for v1; S3 only when attachments ship) |
| Monitoring | CloudWatch (7-day log retention default) |
| IaC | AWS CDK (TypeScript) — keeps language consistent with frontend |

---

## 4. Cloud sync architecture

### Key model

Two-layer key derivation, standard E2E pattern:

- **KEK** (key-encryption key): derived from user password via scrypt with per-user salt. Only ever exists in device memory.
- **DEK** (data-encryption key): random 32-byte key, generated once on vault creation. Encrypts each record with AES-256-GCM. Stored on the server *wrapped by the KEK*.

Password change rewraps the DEK rather than re-encrypting every record.

The user has one password. It does double duty:
- Cognito authenticates with it via SRP (password never goes over the wire)
- Locally, the app runs scrypt on it to derive the KEK

The Cognito-stored hash cannot decrypt the vault. The KEK never leaves the device.

### Record format

Plaintext shape (encrypted before transmission):

```json
{
  "type": "event" | "task" | "journal" | "course" | "assignment" | ...,
  "data": { /* full record body */ },
  "schema_version": 1
}
```

DynamoDB item:

```
{
  "user_id":       "us-east-1:abc123",         // PK
  "record_id":     "evt_01HX7M...",            // SK component
  "record_type":   "event",                    // plaintext, for filtered queries
  "version":       14,                         // monotonic, optimistic concurrency
  "last_modified": 1746902400000,              // server-assigned ms epoch
  "device_id":     "mac_AllanBook",            // last writer
  "tombstone":     false,
  "ciphertext":    "<base64>",                 // AES-256-GCM(plaintext, DEK, nonce)
  "nonce":         "<base64>",                 // 12 bytes, fresh per write
  "size_bytes":    412
}
```

`record_type` stays plaintext to enable type-filtered delta queries server-side. Trade-off: server learns *which kinds* of records a user has, but not their content. Acceptable for v1.

### Endpoints

All endpoints require Cognito JWT in `Authorization`. API Gateway → Lambda. Eight endpoints total:

**Vault setup (rare)**

| Method | Path | Purpose |
|---|---|---|
| POST | `/vault/init` | First-time vault setup. Body: `{ wrapped_dek, salt, kdf_params }` |
| GET | `/vault/info` | New device fetches wrapping params. Returns `{ wrapped_dek, salt, kdf_params }` |
| POST | `/vault/rotate-password` | Rewrap DEK with new KEK. Body: `{ new_wrapped_dek, new_salt, new_kdf_params }` |

**Records (constant)**

| Method | Path | Purpose |
|---|---|---|
| GET | `/records?since={ms}&type={t}` | Delta query, cursor-based pagination |
| GET | `/records/{id}` | Single record fetch |
| PUT | `/records/{id}` | Upsert. Body: `{ ciphertext, nonce, expected_version, type }`. Optimistic concurrency. |
| DELETE | `/records/{id}` | Sets tombstone (soft delete; TTL purges after 90 days) |
| POST | `/records/batch` | Batched puts/deletes. Body: `{ puts: [...], deletes: [...] }` |

**Devices (occasional)**

| Method | Path | Purpose |
|---|---|---|
| GET | `/devices` | List registered devices |
| DELETE | `/devices/{id}` | Revoke device; forces re-auth on that device |

### Concurrency control

`PUT /records/{id}` uses DynamoDB `ConditionExpression`:

```
UpdateExpression: SET version = :new_version, ciphertext = :ct, ...
ConditionExpression: version = :expected_version
```

On mismatch: 409 with current version. Client refetches, re-applies its change to the new version, retries. Handles "two devices edited simultaneously" cleanly.

### Conflict resolution

**Whole-record last-write-wins by `last_modified`.** Matches existing LAN sync semantics; mental model carries across.

- Conflicts log to local `SyncReview` table (already exists from v2.2 cloud connectors)
- User sees "phone and laptop both edited — laptop won; tap to see phone's version"
- Field-level merge intentionally deferred — not worth complexity for v1
- For sharing/collaboration later, swap to CRDT (Yjs or Automerge). Defer until needs are felt.

### Storage layout

Single DynamoDB table:
- **PK**: `user_id`
- **SK**: `RECORD#{record_id}`
- **GSI**: `user_id` + `last_modified` for delta queries
- **TTL**: on tombstones, set to `last_modified + 90 days`

S3 stays out of v1. Records fit comfortably in DynamoDB's 400KB item limit. Add S3 only when attachments ship (voice memos, photos).

### Crypto specifics

- **KDF**: scrypt, `n=2^17, r=8, p=1` (~1s on phone, prohibitive to brute force). Same params as existing backup feature.
- **Cipher**: AES-256-GCM, 12-byte random nonce per write, 16-byte auth tag.
- **DEK wrap**: AES-256-GCM under KEK.
- **Per-platform libs**: `cryptography` (desktop), CryptoKit (iOS), Tink (Android).

**Threat model coverage**: AWS compromise, insider snooping, subpoena. In all three the attacker holds ciphertext + salt with no password. With sane scrypt params that's a year-of-cluster-time problem, not a real attack.

---

## 5. Phased roadmap

Stages compound. Each stage leaves the project in a shippable state.

| Stage | Goal | Effort | Depends on |
|---|---|---|---|
| **0. Stabilize current desktop** | ✅ SHIPPED (v2.4) — Resolve frontend tab-out crash + CTranslate2 semaphore leak. Ship as v2.4. | 1–2 weekends | — |
| **1. Backend refactor** | 🔄 IN FLIGHT — Split `main.py` (215 lines) into AI-engine vs. data-store concerns (router extraction already underway; see backend-api/routers/). Formalize canonical schema. Audit existing crypto for reuse. | 2–3 weekends | 0 |
| **2. AWS sync v0 (desktop only)** | AWS account + budgets + CDK setup. Build the eight endpoints. Vault init + record sync wired into desktop client. Ship alongside existing LAN sync. | 4–6 weeks | 1 |
| **3. iOS app — read + light edits** | New SwiftUI project. CryptoKit-based vault layer. Sync client. Calendar/task viewing. Voice → event via Apple Intelligence Foundation Models. | 8–12 weeks | 2 |
| **4. Android app — read + light edits** | Compose project. Tink-based vault layer. Sync client. Voice → event via MediaPipe + Gemma 3. | 6–10 weeks | 2, 3 |
| **5. Queued audits** | Performance optimization audit + security audit, now scoped across all three platforms. | 2–3 weeks | 4 |
| **6. Tablet expansion + polish** | iPad and Android tablet layouts (closer to desktop given screen size). Push notifications. Cross-device key rotation flow. | 4–6 weeks | 5 |
| **7. (Optional) Cloud-boost mode** | Settings toggle for Gemini Flash / Claude Haiku on the "smart" features. Default off, explicit consent banner naming the provider. | 1–2 weeks | 6 |
| **8. Original future-feature spec** | Home page (Up Next, density heatmap, weekly review). Weekly review LLM gen. Spoken daily briefing via macOS `say`. Habit tracker. Command palette. Accessibility. | Ongoing | 6 |
| **9. Sharing / collaboration** | Shared vaults with per-recipient key wrapping. Likely requires CRDT migration. v3.x or v4.0 concern. | TBD | All above |

---

## 6. Sequencing notes

**Why Stage 1 before Stage 2.** The current `main.py` mixes AI orchestration with data ops. Building cloud sync against that structure means rewriting it again when the mobile clients arrive. Refactor first — the sync layer is much smaller against a clean data layer.

**Why desktop sync before any mobile.** *"Can a Mac sync to itself across two clones via the AWS server"* is the protocol-correctness test, runnable without a second physical machine. If it works, mobile becomes "implement the same wire protocol in Swift / Kotlin" — known territory. Skipping this and starting on iOS means debugging native-iOS issues *and* sync-protocol issues simultaneously, which compounds badly.

**Why iOS before Android.** Apple Intelligence Foundation Models give a free, capable, OS-level on-device LLM with a Swift-native API. The hardest mobile problem (voice → event without bundling a model) is solved by the OS. Android requires shipping a model file in the APK and tier-checking devices at runtime. iOS proves the architecture cheaply; Android is the "now do it the harder way" version.

**Stage 8 is parallel-safe.** Most of the original future-feature spec is desktop-only and doesn't touch sync or mobile. Slot these into rest weeks between heavier stages.

**Resist:**
- Doing iOS and Android in parallel
- Starting Stage 7 (cloud-boost) before Stage 6 ships
- Skipping Stage 1 because "the refactor isn't shipping anything visible" — Stage 1 is what makes Stage 2 not painful

---

## 7. Reassessment checkpoints

Hard pause and review at these points before proceeding.

**After Stage 2 ships.** How did the sync protocol feel in actual use? Anything to redesign before duplicating the client code to two mobile platforms? Cheaper to find protocol weaknesses with one client than three.

**After Stage 3 ships.** Is the iOS UX what was wanted, or did read + light-edits feel too thin? If too thin: expand iOS feature set before starting Android. Better to have one polished platform than two half-polished ones.

**After Stage 5.** Five months in, having built three apps + a cloud service — is this still where I want to invest? If yes, push to Stage 6+. If not, what exists is already a complete portfolio piece. That's a fine place to land.

---

## 8. AWS cost expectations

For a single-developer student project on a serverless stack, expected monthly cost rounds to **$0** for the first ~12 months.

| Service | Free-tier coverage | Headroom for project scale |
|---|---|---|
| Cognito | 10,000 MAU/month, no expiration | You + testers: <10 |
| Lambda | 1M requests + 400K GB-sec/month, always free | ~50–200 calls/user/day |
| DynamoDB | 25 GB storage + 200M requests/month, always free | KB-scale records |
| S3 | 5 GB + 20K GET + 2K PUT (when added) | Encrypted blobs are tiny |
| Data transfer out | 100 GB/month, always free | Sync payloads negligible |
| API Gateway (HTTP) | 1M requests/month for 12 months, then ~$1/M | ~$0–3/month after year 1 |

**New-account credits**: $100 at signup + up to $100 from onboarding activities. Use Paid Plan (not Free Plan) so credits remain valid for 12 months without auto-close.

**Stack additionally**: AWS Educate credits, GitHub Student Developer Pack ($100+ via AWS Activate).

### Cost-safety setup (do BEFORE provisioning the first resource)

1. **AWS Budgets** — alerts at $1, $5, $10 monthly spend
2. **Cost Anomaly Detection** — enable
3. **Tag everything** with `project=loomassist`
4. **Default Lambda log retention to 7 days** in IaC

### Services to avoid (surprise-bill traps)

- NAT Gateway (~$32/mo even idle) — not needed for serverless
- Unattached Elastic IPs (~$3.60/mo each) — not needed
- EBS volumes orphaned after EC2 termination — no EC2 in stack
- RDS instances (~$15/mo minimum) — DynamoDB instead
- CloudWatch Logs accumulating from chatty Lambdas

---

## 9. Open questions / future considerations

- **Custom domain for the API?** Optional ~$12/year (Route 53 or Cloudflare). Better than `*.execute-api.us-east-1.amazonaws.com` for portfolio polish.
- **Push notifications cross-platform.** APNs (iOS) + FCM (Android). Stage 6 territory. Need a notification fan-out Lambda triggered by sync writes.
- **Account deletion / GDPR.** Hard delete from DynamoDB + Cognito. Implement before any non-tester users.
- **Key recovery.** Currently: lose password = lose vault (correct E2E behavior). Worth a recovery-key option (printable PDF at signup, encrypts a copy of the DEK). Stage 6 polish.
- **Schema migrations across versions.** `schema_version` is in the plaintext envelope; clients on older app versions need to handle forward-compat or refuse-and-prompt-upgrade.
- **Cognito DX caveat.** Reputation for clunky developer experience. Budget extra time for the first auth integration.

---

## 10. References to existing project docs

- `CLAUDE.md` — current backend architecture, schema, endpoint inventory **(authoritative — always read first)**
- `LoomAssist_FutureFeatures.md` — feature spec referenced in Stage 8 (NOT FOUND ON DISK — link is broken; create this file or update the reference before following §11)
- `LoomAssist_UIUX_Guardrail.md` — guardrail tags for what Claude Code can act on autonomously (NOT FOUND ON DISK — link is broken; create this file or update the reference before following §11)
- `docs/v2-migration-notes.md` — v2.0 regression checklist (precedent for v3.0 migration doc)

---

## 11. Stage execution prompt (Claude Code template)

> ⚠️ BEFORE FOLLOWING THIS PROMPT: verify that all documents referenced in §10 exist on disk. Any missing file (marked NOT FOUND) must be created or the relevant step must be skipped.

Paste the block below into a fresh Claude Code session at the start of any stage. Fill in the two `[FILL IN]` lines at the bottom. Do not edit the body.

```
You are Claude Code working on LoomAssist v3.0. Follow these steps in order.
Do not skip steps. Do not collapse them. Stop where instructed and wait for me.

═══════════════════════════════════════════════════════════════
STEP 1 — ORIENT (do this before touching anything)
═══════════════════════════════════════════════════════════════
1. Read CLAUDE.md in full. This is the canonical state of the project.
2. Read LoomAssist_Roadmap.md and locate the stage I named below.
3. Read LoomAssist_UIUX_Guardrail.md and note what's "ready to build"
   vs. "schema change required" vs. "ask-first".
4. List the actual files in the relevant directories (backend-api/,
   frontend-ui/src/, etc.) — do not assume the roadmap is current.

DO NOT modify any code yet.

═══════════════════════════════════════════════════════════════
STEP 2 — RESTATE (in your own words)
═══════════════════════════════════════════════════════════════
Before any planning or code, write out:
- The current state of the project as you understand it from CLAUDE.md
- The goal of this stage in one sentence
- The dependencies that should already be satisfied for this stage
- Anything in the roadmap that contradicts the actual codebase
- Anything ambiguous or under-specified for this stage

If anything in the roadmap conflicts with what's actually in the code,
STOP HERE and ask. CLAUDE.md and the codebase win over the roadmap.

═══════════════════════════════════════════════════════════════
STEP 3 — PLAN
═══════════════════════════════════════════════════════════════
Break the stage into small testable substeps. For each substep, list:
- Files that will change (edits)
- Files that will be created
- Tests/verifications that will prove the substep is done
- Any schema changes (these are ASK-FIRST per the guardrail doc)
- Any new architectural rules introduced

Present the plan as a numbered list.
STOP HERE. Wait for my explicit approval before implementing.

═══════════════════════════════════════════════════════════════
STEP 4 — IMPLEMENT (one substep at a time)
═══════════════════════════════════════════════════════════════
After my approval, work one substep at a time. For each substep:
1. Make the change.
2. Run the tests/verifications you named for that substep.
3. Show a diff summary (files changed, lines added/removed, key edits).
4. Note any regressions, unexpected changes, or things that look risky.
5. STOP. Wait before starting the next substep.

If a verification fails, do not "fix forward." Stop and report.

═══════════════════════════════════════════════════════════════
STEP 5 — FULL VERIFICATION
═══════════════════════════════════════════════════════════════
Once all substeps are done, run the full suite:

Backend (one file at a time, per CLAUDE.md):
  cd backend-api && pytest tests/test_<file>.py -v
  (Run each affected test file. Never run pytest tests/ together.)

Frontend:
  cd frontend-ui/src && npm run lint
  cd frontend-ui/src && npm run build
  cd frontend-ui/src && npm run test

Stage-specific verifications:
  Whatever the stage requires (e.g. for Stage 2: round-trip an encrypted
  record from one client to another via the AWS sync API).

Report results. If anything fails, STOP — do not patch in this session.

═══════════════════════════════════════════════════════════════
STEP 6 — UPDATE CLAUDE.md
═══════════════════════════════════════════════════════════════
Once verifications pass, update CLAUDE.md to reflect the new canonical state:
- New endpoints under the appropriate section
- New tables / columns under "Schema"
- New test commands under "Testing & Linting"
- Mark the stage complete in the version log
- Add any new architectural rules (e.g. v3.0 sync rules block, parallel
  in style to the v2.2 cloud-sync rules block)
- If anything in LoomAssist_Roadmap.md is now stale, note what needs
  revising (do NOT edit the roadmap yourself — that's a human review step)

Show the diff to CLAUDE.md.
STOP HERE for review.

═══════════════════════════════════════════════════════════════
STEP 7 — STOP
═══════════════════════════════════════════════════════════════
Do not start the next stage. Do not "while we're here" any other work.
Fresh session for the next stage.

═══════════════════════════════════════════════════════════════
STAGE TO EXECUTE NOW
═══════════════════════════════════════════════════════════════
Stage:                [FILL IN — e.g. "Stage 1: Backend refactor"]
Specific scope:       [FILL IN — narrow it if you want, or "full stage"]
```

### Why this prompt is shaped the way it is

- **Read CLAUDE.md first.** This is the project's actual state. The roadmap is a plan; plans go stale.
- **Restate before planning.** Forces Claude Code to surface contradictions between roadmap and reality before any code changes.
- **Plan, then stop.** Matches the existing guardrail pattern (no autonomous action until reviewed).
- **One substep at a time.** Catches regressions early, when the diff is still small enough to read.
- **Stage-specific verifications.** Generic test commands aren't enough — each stage has a "did this actually work?" check (e.g. record round-trip for sync, model-load smoke test for mobile AI).
- **Update CLAUDE.md, not the roadmap.** CLAUDE.md is the canonical state and gets updated automatically by every stage. The roadmap is updated by humans at reassessment checkpoints, not mid-stage.
- **Stop, fresh session.** Matches the established session-management pattern. Long sessions accrue context drift.

### When to deviate from this prompt

- **Pure investigation** ("read the code and tell me how X works"): skip steps 3–6, just do steps 1–2 and report.
- **Single-file bug fix not on the roadmap**: still do steps 1, 2, 4, 5; can compress steps 3 and 6.
- **Schema changes**: never autonomous. Always ask, regardless of stage.

---

*Last updated: May 2026. Living document — revise after each reassessment checkpoint. **`CLAUDE.md` is updated continuously by Stage 6 of the execution prompt; this roadmap is updated only by human review.***
