# Acadence
### Adaptive Academic Workflow Engine

Acadence is an academic operations platform designed to help educational institutions manage academic planning, assessment preparation, timetable generation, examination evaluation, and academic coordination through a unified system.

Instead of handling these activities across disconnected tools and manual processes, Acadence brings them into structured workflows with validation, review, approval, revision history, and auditability.

> **Project status:** Working prototype.

## Overview

Academic administration involves coordinating multiple interconnected activities, from preparing examination papers to scheduling classes and reviewing academic requirements. Managing these activities manually can create inconsistencies, scheduling conflicts, and fragmented records.

Acadence aims to make these processes more organized, transparent, and manageable by combining automated assistance with human review and control.

The platform is designed around a simple principle: **automate repetitive work, validate important decisions, and keep humans in control.**

## Key Features

### 1. Assessment Studio
- Configure assessment blueprints.
- Manage and organize questions.
- Generate question papers using defined requirements.
- Validate marks, question types, chapters, and difficulty levels.
- Edit and reorder generated questions.
- Support review decisions and version history.
- Export approved question papers as PDFs.

### 2. Intelligent Timetable Generation
- Configure scheduling requirements and teacher availability.
- Generate timetables using constraint-based optimization.
- Support structured scheduling constraints and supported natural-language instructions.
- Validate generated schedules independently.
- Make manual timetable corrections.
- Review revisions and publish approved timetables.

The timetable generation workflow uses Google OR-Tools CP-SAT for constraint-based scheduling.

### 3. Academic Planner
- Submit and review academic requirements.
- Connect supported planning instructions to timetable generation.
- Organize academic planning activities into a structured workflow.

### 4. Academic Coordination
- Manage coordination tasks linked to academic records.
- Track task status through controlled updates.
- Maintain relevant activity and audit records.
- Connect academic requirements with operational workflows.

### 5. Examination Evaluation
- Select an existing assessment and its answer reference.
- Enter examination answers in a typed-answer workflow.
- Generate question-wise mark suggestions for supported question types.
- Review suggested marks and their justifications.
- Allow teachers to edit and confirm final marks.
- Save evaluation records and relevant audit events.

Suggested marks remain distinct from teacher-confirmed marks. Long-answer marking remains under teacher control where automated suggestions are not supported.

### 6. Shared Platform
- Seeded demonstration school and accounts.
- User provisioning and capability management.
- School settings.
- Workflow status dashboard.
- Audit logs and activity tracking.

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React, TypeScript, Tailwind CSS |
| Backend | Python, FastAPI |
| Database and ORM | SQLite, SQLAlchemy |
| Timetable optimization | Google OR-Tools CP-SAT |
| Document output | PDF export for approved question papers |

## System Architecture

```text
┌────────────────────────────────────┐
│          React Frontend            │
│                                    │
│  Dashboard · Assessment Studio     │
│  Timetable · Planner · Evaluation  │
└─────────────────┬──────────────────┘
                  │
                  │ HTTP API requests
                  ▼
┌────────────────────────────────────┐
│           FastAPI Backend          │
│                                    │
│  Workflow Services                 │
│  Validation and Business Rules     │
│  Review and Approval               │
│  Audit Events                      │
└──────────┬─────────────────┬───────┘
           │                 │
           ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│ SQLite +         │  │ OR-Tools CP-SAT  │
│ SQLAlchemy       │  │ Timetable Solver │
└──────────────────┘  └──────────────────┘
```

The frontend provides the user interface, while the backend handles workflow operations, validation, persistence, and timetable generation.

## Design Principles

Acadence follows several core principles:

- **Human oversight:** Important academic decisions remain subject to review and approval.
- **Constraint-based scheduling:** Timetable generation respects the constraints supported by the implementation.
- **Validation first:** Inputs and generated outputs are checked against applicable rules.
- **Traceability:** Relevant workflow actions and revisions can be recorded.
- **Modularity:** Academic workflows are organized into distinct, connected modules.
- **Honest automation:** Automated suggestions are not presented as guaranteed academic judgments.

## Getting Started

### Prerequisites

Install the following before running the project:

- Node.js and npm
- Python 3.10 or a compatible version required by the project dependencies
- Git

### 1. Clone the repository

```bash
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_REPOSITORY_DIRECTORY>
```

Replace the placeholders with your Git repository URL and directory name.

### 2. Set up the backend

Navigate to the backend directory used in your repository:

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment.

**Windows:**

```powershell
.venv\Scripts\Activate.ps1
```

**Linux/macOS:**

```bash
source .venv/bin/activate
```

Install the project's backend dependencies using its dependency file. For example, if the repository contains `requirements.txt`:

```bash
pip install -r requirements.txt
```

Start the FastAPI application using the actual application module and startup instructions defined in your repository. The entry-point module may differ between projects.

### 3. Set up the frontend

Open a new terminal and navigate to the frontend directory:

```bash
cd frontend
npm install
npm run dev
```

Use the repository's existing directory structure and package scripts if the frontend is located elsewhere.

### 4. Configuration

Check the project's environment configuration and documentation before running the application.

Configure the frontend API base URL, backend settings, and database location as required by the existing implementation.

Do not commit credentials, secret keys, private configuration files, or production database contents to Git.

## Prototype Scope and Limitations

Acadence is a working prototype, and its capabilities are limited to the workflows and rules implemented in the project.

- Timetable generation supports the constraints handled by the current solver and validation logic.
- Examination evaluation uses typed answers in the current demonstration workflow.
- Rule-based mark suggestions may not recognize every correct answer or understand context and meaning.
- Long-answer evaluation requires teacher judgment where automated suggestions are not supported.
- Handwriting recognition and automatic grading of scanned examination scripts are not claimed as supported capabilities.
- The prototype should not be treated as a complete institutional management system without further development and testing.

## Testing

The project includes backend service tests and supports a frontend production build check.

Run the commands and test procedures defined in the repository to verify the current implementation. Record actual results rather than assuming that a build or workflow has passed.

Suggested areas for verification include:

- Assessment validation and approved-only PDF export.
- Timetable generation, constraint validation, and publication.
- Planner-to-timetable instruction flow.
- Task status updates and audit records.
- Examination mark validation, teacher confirmation, and persistence.
- Authentication and permission enforcement.

## Vercel deployment

The repository-root `vercel.json` configures a single Vercel project with a FastAPI backend service and a Vite frontend service. Requests under `/api/` route to the backend; all other paths route to the frontend. Leave `VITE_API_BASE_URL` unset in the Vercel project so the browser uses the same-origin `/api` routes. The Vercel Python runtime is documented as Beta.

The backend currently defaults to SQLite stored alongside its source. Vercel function filesystems are not persistent storage, so use a persistent database and configure the backend to connect to it before relying on deployed data. Do not deploy real student records using the demo-user selector, which is not production authentication.

## Future Development

Potential future improvements include:

- More comprehensive academic planning workflows.
- Expanded examination evaluation methods with clearly defined marking criteria.
- Additional accessibility and usability refinements.
- More extensive integration and end-to-end testing.
- Deployment configuration and production-readiness improvements.

These are possible directions for future development, not claims about currently implemented functionality.

## Contributing

Contributions and suggestions are welcome.

1. Fork the repository.
2. Create a branch for your changes.
3. Make focused, well-tested improvements.
4. Submit a pull request describing the changes.

Please preserve existing workflow behavior and document any new dependencies or configuration requirements.

## License

No license has been specified yet. Add a license before permitting others to reuse, modify, or distribute the project.

---

**Acadence — Making academic operations more structured, connected, and accountable.**
