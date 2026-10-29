from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .assessment_service import validate_blueprint, validate_paper
from .database import get_db
from .models import (
    AcademicClass, Assessment, AssessmentBlueprint, AssessmentVersion, Chapter,
    Question, Subject, User,
)
from .schemas import AssessmentCreate, BlueprintCreate, ChapterCreate, PaperEdit, QuestionCreate, ReviewDecision
from .security import current_user, require
from .workflow import link_task, record_audit, require_state

router = APIRouter(prefix="/api")


def snapshot(assessment: Assessment) -> dict:
    return {
        "title": assessment.title,
        "class_id": assessment.class_id,
        "subject_id": assessment.subject_id,
        "examination_type": assessment.examination_type,
        "chapters": assessment.chapters,
        "total_marks": assessment.total_marks,
        "duration_minutes": assessment.duration_minutes,
        "blueprint_id": assessment.blueprint_id,
        "status": assessment.status,
        "paper": assessment.paper,
        "validation": assessment.validation,
    }


def can_view(user: User) -> bool:
    return any(cap in user.capabilities for cap in ("assessments:write", "assessments:review"))


def require_assessment_read(user: User) -> User:
    if not can_view(user):
        raise HTTPException(status_code=403, detail="Missing capability: assessments:read")
    return user


def get_assessment(db: Session, assessment_id: int) -> Assessment:
    assessment = db.get(Assessment, assessment_id)
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    return assessment


@router.get("/academic-data")
def academic_data(_: User = Depends(require("school:read")), db: Session = Depends(get_db)):
    return {
        "classes": [{"id": row.id, "name": row.name, "grade": row.grade, "section": row.section} for row in db.query(AcademicClass).order_by(AcademicClass.id)],
        "subjects": [{"id": row.id, "name": row.name} for row in db.query(Subject).order_by(Subject.name)],
        "chapters": [{"id": row.id, "subject_id": row.subject_id, "name": row.name} for row in db.query(Chapter).order_by(Chapter.subject_id, Chapter.id)],
    }


@router.get("/assessment-blueprints")
def list_blueprints(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_assessment_read(user)
    return db.query(AssessmentBlueprint).order_by(AssessmentBlueprint.id).all()


@router.post("/assessment-blueprints")
def create_blueprint(payload: BlueprintCreate, actor: User = Depends(require("school:write")), db: Session = Depends(get_db)):
    if not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=422, detail="Subject not found.")
    chapter_ids = set(payload.required_chapters)
    for section in payload.sections:
        chapter_ids.update(section.chapter_ids)
    chapters = db.query(Chapter).filter(Chapter.id.in_(chapter_ids), Chapter.subject_id == payload.subject_id).all() if chapter_ids else []
    if len(chapters) != len(chapter_ids):
        raise HTTPException(status_code=422, detail="Blueprint chapter requirements must belong to its subject.")
    blueprint = AssessmentBlueprint(**payload.model_dump())
    expected = sum(int(row.get("count", 0)) * int(row.get("marks_each", 0)) for row in payload.sections)
    if expected != payload.total_marks:
        raise HTTPException(status_code=422, detail=f"Section totals equal {expected}; blueprint total is {payload.total_marks}.")
    db.add(blueprint)
    db.flush()
    record_audit(db, actor, "assessment_blueprint.created", "assessment_blueprint", blueprint.id)
    db.commit()
    db.refresh(blueprint)
    return blueprint


@router.post("/chapters")
def create_chapter(payload: ChapterCreate, actor: User = Depends(require("assessments:write")), db: Session = Depends(get_db)):
    if not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=404, detail="Subject not found.")
    chapter = Chapter(subject_id=payload.subject_id, name=payload.name)
    db.add(chapter); db.flush()
    record_audit(db, actor, "chapter.created", "chapter", chapter.id)
    db.commit(); db.refresh(chapter)
    return chapter


@router.get("/questions")
def list_questions(subject_id: int | None = None, chapter_id: int | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_assessment_read(user)
    rows = db.query(Question).filter(Question.approved.is_(True)).order_by(Question.id).all()
    if subject_id is not None:
        rows = [row for row in rows if row.subject_id == subject_id]
    if chapter_id is not None:
        rows = [row for row in rows if chapter_id in row.chapter_ids]
    return rows


@router.post("/questions")
def create_question(payload: QuestionCreate, actor: User = Depends(require("assessments:write")), db: Session = Depends(get_db)):
    if not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=422, detail="Subject not found.")
    chapters = db.query(Chapter).filter(Chapter.id.in_(payload.chapter_ids), Chapter.subject_id == payload.subject_id).all()
    if len(chapters) != len(set(payload.chapter_ids)):
        raise HTTPException(status_code=422, detail="Every chapter must belong to the selected subject.")
    question = Question(**payload.model_dump(), created_by=actor.id, approved=True)
    db.add(question)
    db.flush()
    record_audit(db, actor, "question.created", "question", question.id)
    db.commit()
    db.refresh(question)
    return question


@router.get("/assessments")
def list_assessments(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not can_view(user):
        raise HTTPException(status_code=403, detail="Missing capability: assessments:read")
    rows = db.query(Assessment).order_by(Assessment.id.desc()).all()
    return [dict(**snapshot(row), id=row.id, created_by=row.created_by, current_version=row.current_version, reviewer_id=row.reviewer_id, review_comment=row.review_comment) for row in rows]


@router.post("/assessments")
def create_assessment(payload: AssessmentCreate, actor: User = Depends(require("assessments:write")), db: Session = Depends(get_db)):
    blueprint = db.get(AssessmentBlueprint, payload.blueprint_id)
    if not blueprint:
        raise HTTPException(status_code=404, detail="Assessment blueprint not found.")
    if not db.get(AcademicClass, payload.class_id) or not db.get(Subject, payload.subject_id):
        raise HTTPException(status_code=422, detail="Class or subject not found.")
    if blueprint.subject_id != payload.subject_id:
        raise HTTPException(status_code=422, detail="Blueprint subject does not match the assessment subject.")
    if payload.total_marks != blueprint.total_marks:
        raise HTTPException(status_code=422, detail=f"Assessment total must match blueprint total ({blueprint.total_marks}).")
    if not set(blueprint.required_chapters).issubset(payload.chapters):
        raise HTTPException(status_code=422, detail="Assessment chapters must include every chapter required by the selected blueprint.")
    valid_chapters = {row.id for row in db.query(Chapter).filter(Chapter.subject_id == payload.subject_id).all()}
    if not set(payload.chapters).issubset(valid_chapters):
        raise HTTPException(status_code=422, detail="Selected chapters must belong to the assessment subject.")
    assessment = Assessment(**payload.model_dump(), created_by=actor.id, status="draft", paper=[], validation={})
    db.add(assessment)
    db.flush()
    db.add(AssessmentVersion(assessment_id=assessment.id, version=1, actor_id=actor.id, action="created", snapshot=snapshot(assessment)))
    link_task(db, actor, f"Prepare {assessment.title}", "assessment", assessment.id, actor.id)
    record_audit(db, actor, "assessment.created", "assessment", assessment.id)
    db.commit()
    db.refresh(assessment)
    return dict(**snapshot(assessment), id=assessment.id, created_by=assessment.created_by, current_version=assessment.current_version)


@router.get("/assessments/{assessment_id}")
def get_assessment_detail(assessment_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_assessment_read(user)
    assessment = get_assessment(db, assessment_id)
    return dict(**snapshot(assessment), id=assessment.id, created_by=assessment.created_by, current_version=assessment.current_version, reviewer_id=assessment.reviewer_id, review_comment=assessment.review_comment)


@router.post("/assessments/{assessment_id}/generate")
def generate_paper(assessment_id: int, actor: User = Depends(require("assessments:write")), db: Session = Depends(get_db)):
    assessment = get_assessment(db, assessment_id)
    require_state(assessment.status, {"draft", "changes_requested"}, "generate a paper")
    blueprint = db.get(AssessmentBlueprint, assessment.blueprint_id)
    selected_chapters = set(assessment.chapters)
    questions = [q for q in db.query(Question).filter_by(subject_id=assessment.subject_id).order_by(Question.id).all() if set(q.chapter_ids).issubset(selected_chapters)]
    paper, errors = validate_blueprint(blueprint, questions)
    errors.extend(validate_paper(blueprint, paper, questions, assessment.chapters))
    assessment.paper = paper
    assessment.validation = {"valid": not errors, "errors": errors}
    assessment.current_version += 1
    db.add(AssessmentVersion(assessment_id=assessment.id, version=assessment.current_version, actor_id=actor.id, action="generated", snapshot=snapshot(assessment)))
    record_audit(db, actor, "assessment.paper_generated", "assessment", assessment.id, "valid" if not errors else "; ".join(errors))
    db.commit()
    db.refresh(assessment)
    return dict(**snapshot(assessment), id=assessment.id, current_version=assessment.current_version)


@router.put("/assessments/{assessment_id}/paper")
def edit_paper(assessment_id: int, payload: PaperEdit, actor: User = Depends(require("assessments:write")), db: Session = Depends(get_db)):
    assessment = get_assessment(db, assessment_id)
    require_state(assessment.status, {"draft", "changes_requested"}, "edit the paper")
    blueprint = db.get(AssessmentBlueprint, assessment.blueprint_id)
    bank = db.query(Question).filter(Question.id.in_(payload.question_ids)).all()
    by_id = {q.id: q for q in bank}
    if len(by_id) != len(set(payload.question_ids)):
        raise HTTPException(status_code=422, detail="A selected question does not exist.")
    if set(payload.edits) - set(payload.question_ids):
        raise HTTPException(status_code=422, detail="Question text edits must refer to a question selected in this paper.")
    sections = []
    for section in blueprint.sections:
        sections.extend([section] * int(section["count"]))
    if len(payload.question_ids) != len(sections):
        raise HTTPException(status_code=422, detail=f"Paper requires exactly {len(sections)} question(s).")
    paper = []
    for question_id, section in zip(payload.question_ids, sections):
        q = by_id[question_id]
        paper.append({"section": section["name"], "question_id": q.id, "prompt": payload.edits.get(q.id, q.prompt), "question_type": q.question_type, "marks": q.marks, "difficulty": q.difficulty, "chapter_ids": q.chapter_ids})
    errors = validate_paper(blueprint, paper, bank, assessment.chapters)
    assessment.paper = paper
    assessment.validation = {"valid": not errors, "errors": errors}
    assessment.status = "draft"
    assessment.current_version += 1
    db.add(AssessmentVersion(assessment_id=assessment.id, version=assessment.current_version, actor_id=actor.id, action="paper_edited", snapshot=snapshot(assessment)))
    record_audit(db, actor, "assessment.paper_edited", "assessment", assessment.id, "; ".join(errors))
    db.commit()
    db.refresh(assessment)
    return dict(**snapshot(assessment), id=assessment.id, current_version=assessment.current_version)


@router.post("/assessments/{assessment_id}/submit")
def submit_assessment(assessment_id: int, actor: User = Depends(require("assessments:write")), db: Session = Depends(get_db)):
    assessment = get_assessment(db, assessment_id)
    require_state(assessment.status, {"draft", "changes_requested"}, "submit the assessment")
    if not assessment.validation.get("valid"):
        raise HTTPException(status_code=422, detail={"message": "Paper validation must pass before submission.", "errors": assessment.validation.get("errors", [])})
    assessment.status = "submitted"
    link_task(db, actor, f"Review {assessment.title}", "assessment", assessment.id, status="awaiting_review")
    record_audit(db, actor, "assessment.submitted", "assessment", assessment.id)
    db.commit()
    return {"id": assessment.id, "status": assessment.status}


@router.post("/assessments/{assessment_id}/review")
def review_assessment(assessment_id: int, payload: ReviewDecision, reviewer: User = Depends(require("assessments:review")), db: Session = Depends(get_db)):
    assessment = get_assessment(db, assessment_id)
    require_state(assessment.status, {"submitted"}, "review the assessment")
    assessment.reviewer_id = reviewer.id
    assessment.review_comment = payload.comment
    assessment.status = {"approve": "approved", "reject": "rejected", "request_changes": "changes_requested"}[payload.action]
    assessment.current_version += 1
    db.add(AssessmentVersion(assessment_id=assessment.id, version=assessment.current_version, actor_id=reviewer.id, action=payload.action, snapshot=snapshot(assessment), comment=payload.comment))
    link_task(db, reviewer, assessment.title, "assessment", assessment.id, status="completed" if payload.action == "approve" else "changes_requested")
    record_audit(db, reviewer, f"assessment.{payload.action}", "assessment", assessment.id, payload.comment)
    db.commit()
    return {"id": assessment.id, "status": assessment.status, "review_comment": assessment.review_comment}


@router.get("/assessments/{assessment_id}/versions")
def assessment_versions(assessment_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_assessment_read(user)
    get_assessment(db, assessment_id)
    return db.query(AssessmentVersion).filter_by(assessment_id=assessment_id).order_by(AssessmentVersion.version).all()


@router.get("/assessments/{assessment_id}/pdf")
def assessment_pdf(assessment_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_assessment_read(user)
    assessment = get_assessment(db, assessment_id)
    if assessment.status != "approved":
        raise HTTPException(status_code=409, detail="Only an approved assessment can be exported.")
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="PDF generation dependency is unavailable.") from exc
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=letter)
    width, height = letter
    pdf.setTitle(assessment.title)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(54, height - 54, assessment.title)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(54, height - 75, f"Total marks: {assessment.total_marks}    Duration: {assessment.duration_minutes} minutes")
    y = height - 110
    for item in assessment.paper:
        text = f"{item['section']} | {item['question_id']}. {item['prompt']} ({item['marks']} marks)"
        words = text.split()
        lines, line = [], ""
        for word in words:
            if len(line) + len(word) > 88:
                lines.append(line); line = word
            else:
                line = f"{line} {word}".strip()
        if line: lines.append(line)
        if y < 70 + 12 * len(lines):
            pdf.showPage(); y = height - 54; pdf.setFont("Helvetica", 10)
        for line in lines:
            pdf.drawString(54, y, line); y -= 14
        y -= 6
    pdf.save()
    stream.seek(0)
    return StreamingResponse(stream, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="assessment-{assessment.id}.pdf"'})
