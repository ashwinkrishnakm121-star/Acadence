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

```
