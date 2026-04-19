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
| Infrastructure | AWS (CloudFront, S3, ALB, ASG, EC2, RDS, ECR) |
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
  └── /v1/*    ──>  ALB (cross-AZ)
                      └── Auto Scaling Group (EC2 t2.micro × N, Docker)
                             └── RDS PostgreSQL (private subnet)
```

- **Frontend**: Built with Vite, hosted on S3, served via CloudFront CDN
- **Backend**: Docker containers on an Auto Scaling Group of EC2 t2.micro instances, fronted by an Application Load Balancer across two Availability Zones; container images stored in Amazon ECR
- **Database**: RDS PostgreSQL (db.t3.micro, ap-southeast-1) in a private subnet
- **CI/CD**: Every push to `main` triggers GitHub Actions to automatically build and deploy both frontend and backend


## Local Development

### Prerequisites

- Python 3.12+
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

### 1. System Architecture

All client traffic enters through a single CloudFront distribution with two
origins: an S3 bucket hosting the compiled React SPA (path `/`) and an
Application Load Balancer fronting an Auto Scaling Group of EC2 instances
running the FastAPI backend in Docker containers (path `/v1/*`). The RDS
PostgreSQL instance is placed in a private subnet and is reachable only from
the application tier's security group. External calls to the DeepSeek API
leave from the backend, whereas the Google Maps JavaScript SDK is loaded
client-side directly from the browser.


```
            ┌──────────────────────────────┐
  Browser ──▶│  CloudFront (HTTPS, global)  │
            └──────────────┬───────────────┘
                   /       │       /v1/*
                   ▼                 ▼
              ┌────────┐      ┌──────────────┐
              │  S3    │      │     ALB      │──▶ DeepSeek API
              │ (SPA)  │      │  (cross-AZ)  │
              └────────┘      └──────┬───────┘
                                     │
                              ┌──────┴──────┐
                              ▼             ▼
                     ┌──────────────┐ ┌──────────────┐
                     │ EC2 (Docker) │ │ EC2 (Docker) │
                     │   FastAPI    │ │   FastAPI    │
                     └──────┬───────┘ └──────┬───────┘
                            └───────┬────────┘
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
3. `dirtyStore` — unsaved changes + undo stack
4. `alternativeStore` — active starred alternatives
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
  no TLS certificate needs to be managed on the application tier.
- **Authentication.** HS256-signed JWTs issued by `python-jose`; 60 min access
  / 7 day refresh; transparent refresh on 401 via Axios interceptor.
- **Database isolation.** The RDS security group accepts TCP 5432 *only* from
  the application tier's security group. The DB is never reachable from the
  public internet.
- **Content safety.** AI responses pass through DOMPurify before DOM injection
  to prevent XSS through model-generated content.

### 7. CI/CD and Deployment Automation (`.github/workflows/`)

Every push to `main` runs a GitHub Actions pipeline that fully automates
deployment, with *zero* manual SSH steps in the happy path:

1. **Backend job** — Build the Docker image (`linux/amd64`), tag it with both
   the commit SHA and `:latest`, and push to Amazon ECR. Propagate the new
   image across the Auto Scaling Group via an instance refresh
   (`aws autoscaling start-instance-refresh`), which replaces ASG members one
   at a time with zero downtime: each newly-launched instance pulls `:latest`
   via its user-data script, starts the container with secrets injected from
   GitHub Secrets, and joins the ALB target group once its health check
   returns 200. Alembic migrations run as a one-off `docker exec` task against
   RDS prior to the refresh, ensuring schema compatibility throughout the
   rolling deployment.
2. **Frontend job** — `npm run build`, sync the `dist/` output to S3 (hashed
   assets with a one-year `Cache-Control`, `index.html` with `no-cache`), and
   create a CloudFront invalidation so clients pick up the new SPA bundle.

A comprehensive backend test suite lives under `backend/tests/` (12 modules
covering auth, security, itineraries, collaboration, sharing, versions,
folders, map pins, and export), executed locally against a real PostgreSQL
instance during development. End-to-end correctness is validated via a
Playwright scenario suite (see the project report for the full 12/12 result
breakdown).
