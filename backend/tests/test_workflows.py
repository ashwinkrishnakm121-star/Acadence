from app.assessment_service import validate_blueprint, validate_paper
from app.models import AcademicClass, AssessmentBlueprint, Question, School, Subject, TeacherAssignment
from app.timetable_service import parse_instruction, solve_timetable, validate_assignments


def test_assessment_blueprint_selects_deterministically_and_validates_marks():
    blueprint = AssessmentBlueprint(
        subject_id=1, total_marks=5, required_chapters=[1, 2], internal_choice_rules={"mode": "none"},
        sections=[
            {"name": "A", "question_type": "multiple_choice", "count": 1, "marks_each": 2},
            {"name": "B", "question_type": "short_answer", "count": 1, "marks_each": 3},
        ],
    )
    questions = [
        Question(id=1, subject_id=1, prompt="Fractions?", question_type="multiple_choice", marks=2, difficulty="easy", chapter_ids=[1], approved=True),
        Question(id=2, subject_id=1, prompt="Algebra?", question_type="short_answer", marks=3, difficulty="medium", chapter_ids=[2], approved=True),
    ]
    paper, errors = validate_blueprint(blueprint, questions)
    assert not errors
    assert [item["question_id"] for item in paper] == [1, 2]
    assert not validate_paper(blueprint, paper, questions)
    duplicate_errors = validate_paper(blueprint, [paper[0], paper[0]], questions)
    assert any("Duplicate" in message for message in duplicate_errors)


def test_assessment_reports_unsatisfied_question_bank_and_chapter_coverage():
    blueprint = AssessmentBlueprint(
        subject_id=1, total_marks=4, required_chapters=[1, 2], internal_choice_rules={"mode": "none"},
        sections=[{"name": "A", "question_type": "multiple_choice", "count": 2, "marks_each": 2}],
    )
    question = Question(id=1, subject_id=1, prompt="Only one", question_type="multiple_choice", marks=2, difficulty="easy", chapter_ids=[1], approved=True)
    _, errors = validate_blueprint(blueprint, [question])
    assert any("needs 2" in message for message in errors)
    assert any("does not cover" in message for message in errors)


def test_cp_sat_returns_valid_schedule_and_respects_teacher_unavailability():
    school = School(working_days=["Monday", "Tuesday"], periods_per_day=2)
    classroom = AcademicClass(id=1, name="Grade 8 A", grade=8, section="A")
    math = Subject(id=1, name="Mathematics")
    science = Subject(id=2, name="Science")
    requirements = [
        TeacherAssignment(id=1, class_id=1, subject_id=1, teacher_id=10, weekly_lessons=2, unavailable_slots=[{"day": "Monday", "period": 1}]),
        TeacherAssignment(id=2, class_id=1, subject_id=2, teacher_id=11, weekly_lessons=1, unavailable_slots=[]),
    ]
    result = solve_timetable([classroom], [math, science], requirements, school, [])
    assert result["solver_status"] in {"OPTIMAL", "FEASIBLE"}
    assert len(result["assignments"]) == 3
    assert not any(row["subject_id"] == 1 and row["day"] == "Monday" and row["period"] == 1 for row in result["assignments"])
    assert not validate_assignments(result["assignments"], [classroom], [math, science], requirements, school, [])


def test_cp_sat_reports_proven_infeasibility_and_validator_detects_conflicts():
    school = School(working_days=["Monday"], periods_per_day=1)
    classes = [AcademicClass(id=1, name="A", grade=8, section="A"), AcademicClass(id=2, name="B", grade=8, section="B")]
    subject = Subject(id=1, name="Mathematics")
    requirements = [
        TeacherAssignment(id=1, class_id=1, subject_id=1, teacher_id=10, weekly_lessons=1, unavailable_slots=[]),
        TeacherAssignment(id=2, class_id=2, subject_id=1, teacher_id=10, weekly_lessons=1, unavailable_slots=[]),
    ]
    result = solve_timetable(classes, [subject], requirements, school, [])
    assert result["solver_status"] == "INFEASIBLE"
    assert result["assignments"] == []
    conflict = [
        {"class_id": 1, "subject_id": 1, "teacher_id": 10, "day": "Monday", "period": 1},
        {"class_id": 2, "subject_id": 1, "teacher_id": 10, "day": "Monday", "period": 1},
    ]
    errors = validate_assignments(conflict, classes, [subject], requirements, school, [])
    assert any("Teacher 10 has multiple" in message for message in errors)


def test_only_supported_natural_language_is_converted():
    subjects = [Subject(id=1, name="Mathematics")]
    supported = parse_instruction("avoid Mathematics on Monday", subjects, ["Monday", "Tuesday"], 6)
    assert supported["supported"] is True
    assert supported["constraint"]["kind"] == "avoid_subject_day"
    unsupported = parse_instruction("avoid heavy subjects before lunch", subjects, ["Monday"], 6)
    assert unsupported["supported"] is False
