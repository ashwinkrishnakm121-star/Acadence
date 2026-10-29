# Acadence

Acadence is a configurable academic workflow prototype for school academic planning, assessment preparation, timetable generation, and coordination.

## Requirements

- Python 3.11 or newer
- Node.js 20 or newer

## Run the backend

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8010
```

The API is available at `http://127.0.0.1:8010`; interactive API documentation is at `/docs`. The SQLite database is created at `backend/acadence.db` and seeded on startup.

## Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

The Vite development server proxies `/api` requests to the backend at `http://127.0.0.1:8010`.

## Vercel demo deployment

Deploy this repository as one Vercel project. The root `vercel.json` defines a `backend` FastAPI service and a `frontend` Vite service. Requests under `/api/` go to the backend; all other paths go to the frontend. The frontend uses same-origin `/api` requests, so the Vercel rewrite connects it to the backend without a cross-origin URL or service binding.

Set `ACADENCE_DATABASE_URL` to a persistent PostgreSQL connection string (for example, from Neon) in the Vercel project environment. The backend refuses to start on Vercel if only its local SQLite default is configured. `ACADENCE_DATABASE_URL` accepts PostgreSQL URLs beginning with `postgres://` or `postgresql://`. The API's demo-user selector is not production authentication: use demo data only and do not expose real student records.

## Demo accounts

Select one of the seeded demo users in the interface. The selected username is sent as `X-Demo-User` and resolved against the database for each protected request. This is a prototype capability mechanism, not production authentication.

| Username | Display name | Initial capabilities |
| --- | --- | --- |
| `admin` | Super Admin | School/user administration, assessment and timetable review, timetable publication, planner review, task management, audit access |
| `teacher` | Teacher | Assessment preparation, question entry, typed examination evaluation, timetable generation/correction, requirement submission, task updates |
| `reviewer` | Academic Reviewer | Assessment/timetable/planner review, shared task updates, audit access |

## Implemented workflows

- Shared school configuration, demo-user provisioning, backend-enforced capabilities, audit events and status dashboard.
- Assessment Studio: blueprints, question bank, deterministic paper selection, validation, manual replacement/reordering, review, version records and approved-only PDF export.
- Timetables: configurable class/subject/teacher assignments and availability, structured hard rules and a limited natural-language parser, OR-Tools CP-SAT generation, independent validation, manual correction, review, revision history and publication.
- Academic Planner: documented requirement collection/review and supported timetable-instruction conversion.
- Academic Coordination: tasks linked to assessment, timetable or planner records, legal status updates and audit history.
- Examination Evaluation: typed answer entry for an existing assessment, pre-suggestion answer review, exact-option multiple-choice suggestions only when the answer reference is an unambiguous option label, deterministic short-answer point matching, teacher-only long-answer suggestions, editable teacher marks, explicit final confirmation, persistence and audit events. Text matching is a review aid and never claims academic correctness.

Evaluation is limited to typed answers. Existing questions continue to use `answer_reference` as the reference and `marks` as the maximum. For exact multiple-choice matching, `answer_reference` must be a single option label such as `B` or `Option B`; other forms require teacher review. Optional short-answer criteria are configured per question: each `expected_points` entry may have `accepted_variants` listed under that exact point, and `marking_notes` are displayed for the teacher. Questions without enough structured information remain usable but require teacher marks. Long answers are never automatically scored.

## Test

From `backend`, install development dependencies with `pip install -r requirements-dev.txt` and run `python -m pytest -q`. The tests cover assessment and timetable behavior, evaluation mark suggestions, additive schema migration, and the complete evaluation API workflow including persistence and audit.
