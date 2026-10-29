import math
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .assessment_routes import can_view
from .database import get_db
from .evaluation_service import suggest_marks
from .models import Assessment, Evaluation, EvaluationQuestion, Question, User
from .schemas import EvaluationCreate, EvaluationMarkInput, EvaluationMarksUpdate, QuestionCriteriaUpdate
from .security import current_user, require
from .workflow import record_audit, require_state

router = APIRouter(prefix="/api")


def get_evaluation(db: Session, evaluation_id: int) -> Evaluation:
    row = db.get(Evaluation, evaluation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Evaluation not found.")
    return row


def require_evaluation_read(row: Evaluation, user: User) -> None:
    if not can_view(user):
        raise HTTPException(status_code=403, detail="Missing capability: assessments:read")
    if row.created_by != user.id and "assessments:review" not in user.capabilities:
        raise HTTPException(status_code=403, detail="This evaluation belongs to another teacher.")


def evaluation_read(db: Session, row: Evaluation) -> dict:
    assessment = db.get(Assessment, row.assessment_id)
    questions = db.query(EvaluationQuestion).filter_by(evaluation_id=row.id).order_by(EvaluationQuestion.question_number).all()
    return {
        "id": row.id,
        "assessment_id": row.assessment_id,
        "assessment_title": assessment.title if assessment else "",
        "status": row.status,
        "created_by": row.created_by,
        "answers_reviewed_at": row.answers_reviewed_at.isoformat() if row.answers_reviewed_at else None,
        "confirmed_by": row.confirmed_by,
        "created_at": row.created_at.isoformat(),
        "confirmed_at": row.confirmed_at.isoformat() if row.confirmed_at else None,
        "final_total": row.final_total,
        "questions": [
            {
                "question_id": question.question_id,
                "question_number": question.question_number,
                "question_text": question.question_text,
                "question_type": question.question_type,
                "max_marks": question.max_marks,
                "answer": question.answer,
                "answer_key": question.answer_key_snapshot,
                "suggested_marks": question.suggested_marks,
                "suggestion_method": question.suggestion_method,
                "suggestion_justification": question.suggestion_justification,
                "requires_teacher_review": question.requires_teacher_review,
                "teacher_edited_marks": question.teacher_edited_marks,
                "final_marks": question.final_marks,
            }
            for question in questions
        ],
    }


def validate_mark(mark: float, maximum: int) -> None:
    if not math.isfinite(mark) or mark < 0 or mark > maximum:
        raise HTTPException(status_code=422, detail=f"Marks must be between 0 and {maximum}.")


@router.put("/questions/{question_id}/marking-criteria")
def update_marking_criteria(
    question_id: int,
    payload: QuestionCriteriaUpdate,
    actor: User = Depends(require("assessments:write")),
    db: Session = Depends(get_db),
):
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found.")
    question.expected_points = payload.expected_points
    question.accepted_variants = payload.accepted_variants
    question.marking_notes = payload.marking_notes
    record_audit(db, actor, "question.marking_criteria_updated", "question", question.id)
    db.commit()
    db.refresh(question)
    return question


@router.get("/evaluations")
def list_evaluations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not can_view(user):
        raise HTTPException(status_code=403, detail="Missing capability: assessments:read")
    query = db.query(Evaluation)
    if "assessments:review" not in user.capabilities:
        query = query.filter_by(created_by=user.id)
    rows = query.order_by(Evaluation.id.desc()).all()
    return [
        {
            "id": row.id,
            "assessment_id": row.assessment_id,
            "assessment_title": db.get(Assessment, row.assessment_id).title,
            "status": row.status,
            "final_total": row.final_total,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.post("/evaluations")
def create_evaluation(
    payload: EvaluationCreate,
    actor: User = Depends(require("assessments:write")),
    db: Session = Depends(get_db),
):
    assessment = db.get(Assessment, payload.assessment_id)
    if assessment is None:
        raise HTTPException(status_code=404, detail="Assessment not found.")
    if not assessment.paper:
        raise HTTPException(status_code=409, detail="The selected assessment has no generated paper to evaluate.")

    paper_ids = [int(item["question_id"]) for item in assessment.paper]
    if len(paper_ids) != len(set(paper_ids)):
        raise HTTPException(status_code=409, detail="The selected assessment contains duplicate question references.")
    submitted_ids = [item.question_id for item in payload.answers]
    if set(submitted_ids) != set(paper_ids):
        raise HTTPException(status_code=422, detail="Provide exactly one answer entry for every question in the selected assessment.")

    questions = {question.id: question for question in db.query(Question).filter(Question.id.in_(paper_ids)).all()}
    if set(questions) != set(paper_ids):
        raise HTTPException(status_code=409, detail="A question from the selected assessment is missing from the question bank.")
    if sum(questions[question_id].marks for question_id in paper_ids) != assessment.total_marks:
        raise HTTPException(status_code=409, detail="The selected paper's current question maximums do not match its assessment total.")
    answers = {item.question_id: item.answer for item in payload.answers}

    evaluation = Evaluation(assessment_id=assessment.id, status="answers_review", created_by=actor.id)
    db.add(evaluation)
    db.flush()
    for number, item in enumerate(assessment.paper, start=1):
        question_id = int(item["question_id"])
        question = questions[question_id]
        db.add(
            EvaluationQuestion(
                evaluation_id=evaluation.id,
                question_id=question_id,
                question_number=number,
                question_text=item.get("prompt", question.prompt),
                question_type=question.question_type,
                max_marks=question.marks,
                answer=answers[question_id],
                answer_key_snapshot={
                    "answer_reference": question.answer_reference,
                    "expected_points": question.expected_points or [],
                    "accepted_variants": question.accepted_variants or {},
                    "marking_notes": question.marking_notes or "",
                },
            )
        )
    record_audit(db, actor, "evaluation.answers_saved", "evaluation", evaluation.id, f"assessment={assessment.id}; questions={len(paper_ids)}")
    db.commit()
    db.refresh(evaluation)
    return evaluation_read(db, evaluation)


@router.get("/evaluations/{evaluation_id}")
def get_evaluation_detail(
    evaluation_id: int,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    row = get_evaluation(db, evaluation_id)
    require_evaluation_read(row, user)
    return evaluation_read(db, row)


@router.post("/evaluations/{evaluation_id}/suggestions")
def generate_suggestions(
    evaluation_id: int,
    actor: User = Depends(require("assessments:write")),
    db: Session = Depends(get_db),
):
    row = get_evaluation(db, evaluation_id)
    if row.created_by != actor.id:
        raise HTTPException(status_code=403, detail="Only the creating teacher may evaluate these answers.")
    require_state(row.status, {"answers_review"}, "generate mark suggestions")
    if row.answers_reviewed_at is None:
        raise HTTPException(status_code=409, detail="Review and acknowledge the entered answers before generating suggestions.")
    questions = db.query(EvaluationQuestion).filter_by(evaluation_id=row.id).order_by(EvaluationQuestion.question_number).all()
    for question in questions:
        result = suggest_marks(
            {
                "max_marks": question.max_marks,
                "question_type": question.question_type,
                "answer_key_snapshot": question.answer_key_snapshot,
            },
            question.answer,
        )
        question.suggested_marks = result["suggested_marks"]
        question.suggestion_method = result["suggestion_method"]
        question.suggestion_justification = result["suggestion_justification"]
        question.requires_teacher_review = result["requires_teacher_review"]
    row.status = "suggestions_ready"
    record_audit(db, actor, "evaluation.suggestions_generated", "evaluation", row.id, f"questions={len(questions)}")
    db.commit()
    db.refresh(row)
    return evaluation_read(db, row)


@router.post("/evaluations/{evaluation_id}/review-answers")
def review_evaluation_answers(
    evaluation_id: int,
    actor: User = Depends(require("assessments:write")),
    db: Session = Depends(get_db),
):
    row = get_evaluation(db, evaluation_id)
    if row.created_by != actor.id:
        raise HTTPException(status_code=403, detail="Only the creating teacher may review these answers.")
    require_state(row.status, {"answers_review"}, "review entered answers")
    if row.answers_reviewed_at is None:
        row.answers_reviewed_at = datetime.now(timezone.utc)
        record_audit(db, actor, "evaluation.answers_reviewed", "evaluation", row.id)
        db.commit()
    return evaluation_read(db, row)


@router.put("/evaluations/{evaluation_id}/questions/{question_id}/suggestion")
def enter_teacher_suggestion(
    evaluation_id: int,
    question_id: int,
    payload: EvaluationMarkInput,
    actor: User = Depends(require("assessments:write")),
    db: Session = Depends(get_db),
):
    if payload.question_id != question_id:
        raise HTTPException(status_code=422, detail="The question ID in the path and request must match.")
    row = get_evaluation(db, evaluation_id)
    if row.created_by != actor.id:
        raise HTTPException(status_code=403, detail="Only the creating teacher may edit this evaluation.")
    require_state(row.status, {"suggestions_ready"}, "enter a teacher suggestion")
    question = db.query(EvaluationQuestion).filter_by(evaluation_id=row.id, question_id=question_id).first()
    if question is None:
        raise HTTPException(status_code=404, detail="Question is not part of this evaluation.")
    if question.question_type != "long_answer":
        raise HTTPException(status_code=422, detail="Teacher-entered suggestions are reserved for long-answer questions.")
    validate_mark(payload.marks, question.max_marks)
    question.suggested_marks = payload.marks
    question.suggestion_method = "teacher_entered"
    question.suggestion_justification = {"message": "Suggested marks entered by the teacher after reviewing the answer reference and criteria."}
    question.requires_teacher_review = True
    record_audit(db, actor, "evaluation.teacher_suggestion_entered", "evaluation", row.id, f"question={question_id}; marks={payload.marks}")
    db.commit()
    return evaluation_read(db, row)


@router.put("/evaluations/{evaluation_id}/teacher-marks")
def save_teacher_marks(
    evaluation_id: int,
    payload: EvaluationMarksUpdate,
    actor: User = Depends(require("assessments:write")),
    db: Session = Depends(get_db),
):
    row = get_evaluation(db, evaluation_id)
    if row.created_by != actor.id:
        raise HTTPException(status_code=403, detail="Only the creating teacher may edit this evaluation.")
    require_state(row.status, {"suggestions_ready"}, "edit teacher marks")
    questions = db.query(EvaluationQuestion).filter_by(evaluation_id=row.id).all()
    by_id = {question.question_id: question for question in questions}
    supplied = {entry.question_id: entry.marks for entry in payload.marks}
    if set(supplied) != set(by_id):
        raise HTTPException(status_code=422, detail="Provide one teacher mark for every question in the evaluation.")
    for question_id, marks in supplied.items():
        question = by_id[question_id]
        validate_mark(marks, question.max_marks)
        question.teacher_edited_marks = marks
    record_audit(db, actor, "evaluation.teacher_marks_edited", "evaluation", row.id, f"questions={len(supplied)}")
    db.commit()
    return evaluation_read(db, row)


@router.post("/evaluations/{evaluation_id}/confirm")
def confirm_evaluation(
    evaluation_id: int,
    payload: EvaluationMarksUpdate,
    actor: User = Depends(require("assessments:write")),
    db: Session = Depends(get_db),
):
    row = get_evaluation(db, evaluation_id)
    if row.created_by != actor.id:
        raise HTTPException(status_code=403, detail="Only the creating teacher may confirm this evaluation.")
    require_state(row.status, {"suggestions_ready"}, "confirm this evaluation")
    questions = db.query(EvaluationQuestion).filter_by(evaluation_id=row.id).all()
    by_id = {question.question_id: question for question in questions}
    final_marks = {entry.question_id: entry.marks for entry in payload.marks}
    if set(final_marks) != set(by_id):
        raise HTTPException(status_code=422, detail="Provide one final confirmed mark for every question in the evaluation.")
    for question_id, marks in final_marks.items():
        question = by_id[question_id]
        validate_mark(marks, question.max_marks)
        if question.teacher_edited_marks is None or not math.isclose(marks, question.teacher_edited_marks, abs_tol=1e-9):
            raise HTTPException(status_code=409, detail="Save teacher-reviewed marks before confirming, and confirm those exact values.")
        question.final_marks = marks
    maximum_total = sum(question.max_marks for question in questions)
    calculated_total = round(sum(final_marks.values()), 2)
    if not 0 <= calculated_total <= maximum_total:
        raise HTTPException(status_code=422, detail=f"The final total must be between 0 and {maximum_total}.")
    row.status = "confirmed"
    row.confirmed_by = actor.id
    row.confirmed_at = datetime.now(timezone.utc)
    row.final_total = calculated_total
    record_audit(db, actor, "evaluation.confirmed", "evaluation", row.id, f"assessment={row.assessment_id}; total={row.final_total}")
    db.commit()
    db.refresh(row)
    return evaluation_read(db, row)
