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
└── docs/                  # Deployment guide
```
