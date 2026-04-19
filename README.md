# TripSync

A collaborative travel itinerary planning app built for NUS CS5224 Cloud Computing.

## Live Demo

https://d122amyq22pv4d.cloudfront.net

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| Backend | FastAPI + Uvicorn (Python 3.12) |
| Database | PostgreSQL (asyncpg + SQLAlchemy) |
| AI Chat | DeepSeek API (OpenAI-compatible) |
| PDF Export | WeasyPrint + Jinja2 |
| Infrastructure | AWS (EC2, RDS, S3, CloudFront, ECR) |
| CI/CD | GitHub Actions |

## Features

- Collaborative itinerary editing with field-level conflict resolution
- Version history with snapshot/diff tracking and rollback
- AI travel assistant (DeepSeek)
- Interactive map with custom pins (Google Maps)
- PDF export and email sharing
- Folder organization for itineraries
- Invite link sharing with role-based access (owner / editor / viewer)
- Account management (register, login, delete account)
- Sample itinerary auto-created for new users

## Cloud Deployment

```
CloudFront (HTTPS)
  ├── /        ──>  S3 (React SPA)
  └── /v1/*    ──>  EC2 (FastAPI Docker container)
                      └── RDS PostgreSQL
```

- **Frontend**: Built with Vite, hosted on S3, served via CloudFront CDN
- **Backend**: Docker container (linux/amd64) on EC2, images stored in ECR
- **Database**: RDS PostgreSQL (db.t3.micro, ap-southeast-1)
- **CI/CD**: Every push to `main` triggers GitHub Actions to automatically build and deploy both frontend and backend


## Local Development

### Prerequisites

- Python 3.11+
- Node.js 18+
- PostgreSQL 14+

### 1. Database

```bash
psql -c "CREATE DATABASE tripsync;"
psql -c "CREATE DATABASE tripsync_test;"
```

### 2. Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# (Optional) Install WeasyPrint system deps for PDF export
# macOS: brew install pango
# Ubuntu: apt-get install libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 libcairo2

# Configure environment
cp .env.example .env
# Edit .env — update DATABASE_URL to match your local PostgreSQL credentials

# Run database migrations
alembic upgrade head

# Start server
uvicorn app.main:app --reload --port 8000
```

Backend API docs available at http://localhost:8000/docs

### 3. Frontend

```bash
cd frontend

npm install

# (Optional) Configure Google Maps
cp .env.example .env
# Edit .env — add VITE_GOOGLE_MAPS_KEY if you have one

npm run dev
```

Frontend runs at http://localhost:3000. Vite automatically proxies `/v1/*` requests to the backend.

### 4. Verify

1. Open http://localhost:3000
2. Register an account (a sample itinerary will be created automatically)
3. Try editing, collaborating, AI chat, and PDF export

### Optional API Keys

Not required to run the app — corresponding features will be unavailable without them:

| Feature | Env Variable | Location | How to Get |
|---------|-------------|----------|-----------|
| AI Chat | `DEEPSEEK_API_KEY` | `backend/.env` | [DeepSeek Platform](https://platform.deepseek.com/api_keys) |
| Map | `VITE_GOOGLE_MAPS_KEY` | `frontend/.env` | [Google Cloud Console](https://console.cloud.google.com/) |

### Running Tests

```bash
# Backend
cd backend && python -m pytest -v

# Frontend
cd frontend && npm test
```

## Project Structure

```
TripSync-Cloud/
├── backend/
│   ├── app/
│   │   ├── core/          # Config, database connection
│   │   ├── models/        # SQLAlchemy models
│   │   ├── routers/       # API endpoints
│   │   ├── schemas/       # Pydantic schemas
│   │   ├── services/      # Business logic
│   │   └── templates/     # PDF HTML templates
│   ├── alembic/           # Database migrations
│   ├── tests/
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/           # API client
│   │   ├── components/    # React components
│   │   ├── pages/         # Page-level components
│   │   └── stores/        # Zustand state management
│   └── vite.config.ts
├── .github/workflows/     # CI/CD pipeline
└── docs/                  # Deployment guide & architecture diagrams
```

## Code Explanation

This section walks through how the TripSync codebase is organised, how the major
components interact on AWS, and why the key algorithms are implemented the way
they are. It is intentionally aligned with Section 4 (*Architecture &
Implementation*) of the CS5224 Group 19 final report, so that the code and the
report tell the same story.

### Assumptions

The design and the following explanation are grounded in a set of explicit
assumptions. They are listed up front so that the reader can judge the trade-offs
in context.

- **Workload shape.** Group trip planning is *intermittent and low-frequency*
  collaboration (seconds–minutes between saves), not real-time co-editing like
  Google Docs. A save-on-click model with optimistic locking is therefore
  sufficient; we deliberately avoid WebSockets / OT / CRDT.
- **Conflicts carry product meaning.** When two collaborators edit the same
  field, the conflict is usually a *preference disagreement* (e.g. two
  restaurants), not a technical race. The system preserves the loser's value as
  a *starred alternative* instead of discarding it.
- **Scale target.** The deployment is sized for ~1,000 MAU on a single
  `ap-southeast-1` region. Multi-region active-active is out of scope; AWS
  managed services (CloudFront, RDS Multi-AZ) provide infrastructure-level
  redundancy.
- **Trust boundary.** All clients are untrusted browsers. The only trusted
  server-side components are the FastAPI container on EC2 and the RDS instance
  in a private subnet. DeepSeek and Google Maps are treated as external
  third-party services.
- **Auth model.** Short-lived JWTs (60 min access / 7 day refresh) are
  acceptable; we do not need server-side session invalidation beyond token
  expiry. Axios refreshes transparently on HTTP 401.
- **Consistency model.** A single RDS primary is the source of truth. CloudFront
  caches only the React SPA bundle (`/`), never API responses (`/v1/*`), so
  itinerary reads are always strongly consistent from the DB.
- **Evaluation.** Performance numbers in §5 of the report were measured on
  `t2.micro` / `t3.micro` instances in `ap-southeast-1`; absolute latencies will
  shift on other instance classes, but the *ratio* between local and cloud
  deployments (tail latency, headroom) should hold.

### 1. System Architecture

All client traffic enters through a single CloudFront distribution with two
origins: an S3 bucket hosting the compiled React SPA (path `/`) and an EC2
instance running the FastAPI backend in a Docker container (path `/v1/*`). The
RDS PostgreSQL instance is placed in a private subnet and is reachable only from
the application server's security group. External calls to the DeepSeek API
leave from the backend, whereas the Google Maps JavaScript SDK is loaded
client-side directly from the browser.

![Overall system architecture](docs/images/system-architecture.png)

*Figure 1 — Overall cloud architecture (CloudFront → S3 + EC2/FastAPI → RDS).*

For quick reference, the same topology in text form:

```
            ┌──────────────────────────────┐
  Browser ──▶│  CloudFront (HTTPS, global)  │
            └──────────────┬───────────────┘
                   /       │       /v1/*
                   ▼                 ▼
              ┌────────┐      ┌──────────────┐
              │  S3    │      │ EC2 (Docker) │──▶ DeepSeek API
              │ (SPA)  │      │   FastAPI    │
              └────────┘      └──────┬───────┘
                                     │ (private subnet)
                                     ▼
                               ┌──────────┐
                               │   RDS    │
                               │ Postgres │
                               └──────────┘
```

### 2. User Journey

Three entry paths converge on the itinerary editor: new-user registration,
returning-user login, and external share-link join (which verifies the role –
Editor or Viewer – before granting access). Viewers land on a read-only view;
editors reach the full editor where they can add days / activities, edit cells
inline (unsaved cells are highlighted yellow), drag-and-drop activities across
days, place map pins, and chat with the AI assistant. A single **Save** click
triggers the conflict-resolution algorithm in §3.1; version history and
one-click rollback are available at any time.

![User journey map](docs/images/user-journey.png)

*Figure 2 — End-to-end user journey, from entry paths through the collaborative
editor to save, conflict resolution, rollback and PDF export.*

### 3. Core Algorithms & Design

#### 3.1 Field-Level Optimistic Locking (`backend/app/services/collaboration.py`)

The central technical contribution of TripSync is its conflict-resolution
strategy. We deliberately avoid both *last-writer-wins* (which loses data) and
real-time OT/CRDT (which requires persistent WebSockets and significant
complexity). Instead, every editable field carries a `field_updated_at`
timestamp, and a save request carries the timestamps the client *saw* when it
started editing.

On save, the server compares, **per field**:

- If `client_base_ts == server_ts` → accept the new value, bump `server_ts`.
- Otherwise → reject *that field only*, return the server's current value plus
  the client's rejected value as a **starred alternative**.

Because the comparison is field-granular, two users editing *different* cells of
the same row never conflict. The frontend renders a star icon on affected
cells; the user may **adopt** the alternative (which re-saves with the now-
current timestamp and is guaranteed to succeed) or **dismiss** it. No
collaborative input is ever silently lost.


#### 3.2 Hybrid Snapshot + Diff Version Control (`backend/app/services/version.py`)

TripSync keeps a complete audit trail of every save, but storing a full snapshot
each time would be storage-inefficient, and storing only diffs would make
rollbacks expensive. The implementation uses a **hybrid** scheme:

- Version **1** and every **50th** version after that store a full JSONB
  snapshot of the itinerary.
- All intermediate versions store only a field-level diff array.

This bounds rollback reconstruction to **at most 49 diff applications** from the
nearest snapshot. Rollbacks are append-only: restoring version *N* creates a new
entry with `entry_type = 'rollback'`, so the history itself is never rewritten.
During rollback, every field's `field_updated_at` is advanced to *now*, which
prevents false conflicts against clients that were still holding stale
timestamps.

#### 3.3 AI Context Injection (`backend/app/services/ai.py`)

The AI assistant calls the DeepSeek API through an OpenAI-compatible SDK.
Instead of a vector database or RAG pipeline, the backend simply serialises the
current itinerary into a structured plain-text block and prepends it to the
system prompt on every request. Responses are streamed back to the client via
Server-Sent Events (SSE), and the frontend renders each token incrementally.
Model output is sanitised with DOMPurify before DOM injection to prevent XSS
via model-generated content.

### 4. Application Architecture

#### Backend (`backend/app/`)

Written in Python 3.12 with **FastAPI** on **Uvicorn**, using a layered
architecture:

| Layer | Location | Responsibility |
|-------|----------|----------------|
| HTTP routers (9) | `app/routers/` | `auth`, `itineraries`, `collaboration`, `sharing`, `versions`, `folders`, `map_pins`, `export`, `ai` |
| Services | `app/services/` | Business logic: conflict resolution, version snapshot/diff, AI context, PDF, email |
| Models | `app/models/` | SQLAlchemy 2.0 async ORM |
| Schemas | `app/schemas/` | Pydantic request/response validation |
| Templates | `app/templates/` | Jinja2 HTML for WeasyPrint PDF rendering |
| Core | `app/core/` | Config and async DB engine (asyncpg) |

All DB I/O is non-blocking (`asyncpg` + SQLAlchemy async), allowing a single
Uvicorn worker to serve many concurrent requests. Authentication and role
checks are enforced at the router boundary via FastAPI's `Depends` mechanism
(see `app/deps.py`), so authorisation logic is never duplicated inside handlers.

#### Frontend (`frontend/src/`)

React 18 + TypeScript, compiled by Vite. State is split across **five Zustand
stores**, each with a single concern:

1. `authStore` — user / JWT / refresh
2. `itineraryStore` — canonical server state
3. `editsStore` — unsaved changes + undo stack
4. `conflictsStore` — active starred alternatives
5. `uiStore` — modals, toasts, drag state

An Axios interceptor proactively refreshes the JWT on HTTP 401, so users never
see mid-session re-authentication prompts.

### 5. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Collaboration model | Save-on-click + field-level optimistic lock | No WebSocket dependency; fits async, low-frequency editing |
| Version storage | Snapshot every 50 + intermediate diffs | Bounded rollback cost, compact on-disk footprint |
| PDF generation | Server-side WeasyPrint → bytes | Consistent output across devices; no client deps |
| Frontend state | 5 Zustand stores | Separation of concerns; lightweight vs Redux |
| DB driver | `asyncpg` (async PostgreSQL) | Non-blocking I/O; matches FastAPI async model |
| Email delivery | SES + FastAPI `BackgroundTasks` (HTTP 202) | Request returns immediately; SES latency hidden from user |

### 6. Security

- **Transport.** CloudFront enforces HTTPS and redirects all HTTP requests, so
  no TLS certificate needs to be managed on EC2.
- **Authentication.** HS256-signed JWTs issued by `python-jose`; 60 min access
  / 7 day refresh; transparent refresh on 401 via Axios interceptor.
- **Database isolation.** The RDS security group accepts TCP 5432 *only* from
  the application server's security group. The DB is never reachable from the
  public internet.
- **Content safety.** AI responses pass through DOMPurify before DOM injection
  to prevent XSS through model-generated content.

### 7. CI/CD and Deployment Automation (`.github/workflows/`)

Every push to `main` runs a GitHub Actions pipeline that fully automates
deployment, with *zero* manual SSH steps in the happy path:

1. **Backend job** — Build the Docker image (`linux/amd64`), push to Amazon
   ECR, then SSH into EC2 to stop the running container, pull the new image,
   start a fresh container with secrets injected from GitHub Secrets, and
   run `alembic upgrade head`.
2. **Frontend job** — `npm run build`, sync the `dist/` output to S3, and
   create a CloudFront invalidation so clients pick up the new SPA bundle.
3. **Pull-request CI** — Each PR spins up a fresh PostgreSQL container, runs
   Alembic migrations against it, and executes the full `pytest` suite.
