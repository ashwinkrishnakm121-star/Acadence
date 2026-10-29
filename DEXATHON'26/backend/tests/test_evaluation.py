from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.evaluation_service import suggest_marks
from app.main import app
from app.models import AcademicClass, Assessment, AssessmentBlueprint, AuditEvent, Question
from app.seed import seed_database


def _question(question_type, answer_reference="", expected_points=None, accepted_variants=None, marking_notes="", max_marks=4):
    return {
        "question_type": question_type,
        "max_marks": max_marks,
        "answer_key_snapshot": {
            "answer_reference": answer_reference,
            "expected_points": expected_points or [],
            "accepted_variants": accepted_variants or {},
            "marking_notes": marking_notes,
        },
    }


def test_multiple_choice_requires_unambiguous_option_key_and_scores_exact_options():
    question = _question("multiple_choice", answer_reference="Option B", max_marks=2)
    assert suggest_marks(question, "b")["suggested_marks"] == 2
    assert suggest_marks(question, "A")["suggested_marks"] == 0
    assert suggest_marks(question, "")["suggested_marks"] == 0
    unsupported = suggest_marks(_question("multiple_choice", answer_reference="A correct answer is B"), "B")
    assert unsupported["suggested_marks"] is None
    assert unsupported["suggestion_method"] == "manual_review_required"


def test_short_answer_normalizes_matches_variants_proportionally_and_flags_review():
    question = _question(
        "short_answer",
        expected_points=["isolate x", "state the result"],
        accepted_variants={"isolate x": ["get x alone"]},
        max_marks=5,
    )
    result = suggest_marks(question, "  GET X ALONE!!!  ")
    assert result["suggested_marks"] == 2.5
    assert result["suggestion_justification"]["matched_points"] == ["isolate x"]
    assert result["suggestion_justification"]["missing_points"] == ["state the result"]
    assert result["requires_teacher_review"] is True
    no_criteria = suggest_marks(_question("short_answer", answer_reference="x = 2"), "x equals 2")
    assert no_criteria["suggested_marks"] is None


def test_overlapping_variants_and_long_answers_do_not_get_algorithmic_marks():
    ambiguous = _question("short_answer", expected_points=["point one", "point two"], accepted_variants={"point one": ["same phrase"], "point two": ["same phrase"]})
    assert suggest_marks(ambiguous, "same phrase")["suggested_marks"] is None
    long_answer = suggest_marks(_question("long_answer", answer_reference="Reference", marking_notes="Award for evidence."), "Answer")
    assert long_answer["suggested_marks"] is None
    assert long_answer["suggestion_method"] == "teacher_entry_required"
    assert long_answer["suggestion_justification"]["answer_reference"] == "Reference"


def test_evaluation_api_end_to_end_persists_answers_suggestions_edits_confirmation_and_audit():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSession = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestingSession() as db:
            seed_database(db)
            bank = db.query(Question).order_by(Question.id).all()
            multiple_choice = next(q for q in bank if q.question_type == "multiple_choice")
            short_answer = next(q for q in bank if q.question_type == "short_answer")
            long_answer = next(q for q in bank if q.question_type == "long_answer")
            multiple_choice.answer_reference = "B"
            short_answer.expected_points = ["isolate x", "state the result"]
            short_answer.accepted_variants = {"isolate x": ["get x alone"]}
            long_answer.marking_notes = "Award marks for a correct method."
            blueprint = db.query(AssessmentBlueprint).first()
            class_id = db.query(AcademicClass).first().id
            assessment = Assessment(
                title="Evaluation workflow test", class_id=class_id, subject_id=multiple_choice.subject_id,
                examination_type="Unit test", chapters=multiple_choice.chapter_ids + short_answer.chapter_ids + long_answer.chapter_ids,
                total_marks=sum(q.marks for q in [multiple_choice, short_answer, long_answer]),
                duration_minutes=60, blueprint_id=blueprint.id, status="approved", created_by=1,
                paper=[
                    {"question_id": multiple_choice.id, "prompt": multiple_choice.prompt, "marks": multiple_choice.marks},
                    {"question_id": short_answer.id, "prompt": short_answer.prompt, "marks": short_answer.marks},
                    {"question_id": long_answer.id, "prompt": long_answer.prompt, "marks": long_answer.marks},
                ], validation={"valid": True},
            )
            db.add(assessment); db.commit(); db.refresh(assessment)
            assessment_id = assessment.id
            question_ids = [multiple_choice.id, short_answer.id, long_answer.id]
            answer_ids = {"mc": multiple_choice.id, "short": short_answer.id, "long": long_answer.id}

        client = TestClient(app)
        headers = {"X-Demo-User": "teacher"}
        criteria_update = client.put(
            f"/api/questions/{answer_ids['short']}/marking-criteria", headers=headers,
            json={"expected_points": ["isolate x", "state the result"], "accepted_variants": {"isolate x": ["get x alone"]}, "marking_notes": "Check the final expression too."},
        )
        assert criteria_update.status_code == 200, criteria_update.text
        invalid = client.post("/api/evaluations", headers=headers, json={"assessment_id": assessment_id, "answers": [{"question_id": 99999, "answer": "x"}]})
        assert invalid.status_code == 422
        created = client.post("/api/evaluations", headers=headers, json={
            "assessment_id": assessment_id,
            "answers": [
                {"question_id": answer_ids["mc"], "answer": "B"},
                    {"question_id": answer_ids["short"], "answer": "I can get x alone."},
                {"question_id": answer_ids["long"], "answer": "A worked solution."},
            ],
        })
        assert created.status_code == 200, created.text
        evaluation_id = created.json()["id"]
        assert created.json()["status"] == "answers_review"
        assert [row["question_id"] for row in created.json()["questions"]] == question_ids

        not_reviewed = client.post(f"/api/evaluations/{evaluation_id}/suggestions", headers=headers)
        assert not_reviewed.status_code == 409
        answer_review = client.post(f"/api/evaluations/{evaluation_id}/review-answers", headers=headers)
        assert answer_review.status_code == 200
        suggestions = client.post(f"/api/evaluations/{evaluation_id}/suggestions", headers=headers)
        assert suggestions.status_code == 200, suggestions.text
        by_question = {row["question_id"]: row for row in suggestions.json()["questions"]}
        assert by_question[answer_ids["mc"]]["suggested_marks"] == 2
        assert by_question[answer_ids["short"]]["suggested_marks"] == 1.5
        assert by_question[answer_ids["long"]]["suggested_marks"] is None

        long_suggestion = client.put(
            f"/api/evaluations/{evaluation_id}/questions/{answer_ids['long']}/suggestion",
            headers=headers,
            json={"question_id": answer_ids["long"], "marks": 4},
        )
        assert long_suggestion.status_code == 200
        assert next(row for row in long_suggestion.json()["questions"] if row["question_id"] == answer_ids["long"])["suggestion_method"] == "teacher_entered"
        invalid_range = client.put(
            f"/api/evaluations/{evaluation_id}/teacher-marks", headers=headers,
            json={"marks": [{"question_id": qid, "marks": 999} for qid in question_ids]},
        )
        assert invalid_range.status_code == 422

        teacher_marks = [
            {"question_id": answer_ids["mc"], "marks": 1.5},
            {"question_id": answer_ids["short"], "marks": 2},
            {"question_id": answer_ids["long"], "marks": 4},
        ]
        saved = client.put(f"/api/evaluations/{evaluation_id}/teacher-marks", headers=headers, json={"marks": teacher_marks})
        assert saved.status_code == 200, saved.text
        assert next(row for row in saved.json()["questions"] if row["question_id"] == answer_ids["mc"])["suggested_marks"] == 2
        assert next(row for row in saved.json()["questions"] if row["question_id"] == answer_ids["mc"])["teacher_edited_marks"] == 1.5
        confirmed = client.post(f"/api/evaluations/{evaluation_id}/confirm", headers=headers, json={"marks": teacher_marks})
        assert confirmed.status_code == 200, confirmed.text
        result = confirmed.json()
        assert result["status"] == "confirmed"
        assert result["final_total"] == 7.5
        persisted = client.get(f"/api/evaluations/{evaluation_id}", headers=headers)
        assert persisted.status_code == 200
        assert persisted.json()["questions"][0]["final_marks"] == 1.5
        with TestingSession() as db:
            actions = {row.action for row in db.query(AuditEvent).all() if row.record_type == "evaluation"}
            assert {"evaluation.answers_saved", "evaluation.answers_reviewed", "evaluation.suggestions_generated", "evaluation.teacher_suggestion_entered", "evaluation.teacher_marks_edited", "evaluation.confirmed"}.issubset(actions)
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()
