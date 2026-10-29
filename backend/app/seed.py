from sqlalchemy.orm import Session

from .models import (
    AcademicClass, AssessmentBlueprint, Chapter, Question, School, Subject,
    TeacherAssignment, User,
)


DEMO_USERS = [
    {
        "username": "admin",
        "display_name": "Super Admin",
        "role": "Super Admin",
        "capabilities": ["school:read", "school:write", "users:read", "users:write", "audit:read", "assessments:write", "assessments:review", "timetable:write", "timetable:review", "timetable:publish", "planner:write", "planner:review", "tasks:read", "tasks:write", "tasks:manage_all"],
    },
    {
        "username": "teacher",
        "display_name": "Teacher",
        "role": "Teacher",
        "capabilities": ["school:read", "users:read", "assessments:write", "timetable:write", "planner:write", "tasks:read", "tasks:write"],
    },
    {
        "username": "reviewer",
        "display_name": "Academic Reviewer",
        "role": "Academic Reviewer",
        "capabilities": ["school:read", "users:read", "audit:read", "assessments:review", "timetable:review", "planner:review", "tasks:read", "tasks:write"],
    },
]

LEGACY_CAPABILITIES = {
    "admin": {"school:read", "school:write", "users:read", "users:write", "audit:read"},
    "teacher": {"school:read", "users:read"},
    "reviewer": {"school:read", "users:read", "audit:read"},
}


def seed_database(db: Session) -> None:
    if db.query(School).count() == 0:
        db.add(
            School(
                name="Acadence Demonstration School",
                academic_year="2026-2027",
                working_days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                periods_per_day=6,
                settings={"period_duration_minutes": 45},
            )
        )
    existing = {user.username for user in db.query(User).all()}
    for data in DEMO_USERS:
        if data["username"] not in existing:
            db.add(User(**data, active=True))
    db.commit()

    users = {user.username: user for user in db.query(User).all()}
    for data in DEMO_USERS:
        user = users.get(data["username"])
        if user and set(user.capabilities) == LEGACY_CAPABILITIES[data["username"]]:
            user.capabilities = data["capabilities"]

    if db.query(AcademicClass).count() == 0:
        classes = [AcademicClass(name="Grade 8 A", grade=8, section="A"), AcademicClass(name="Grade 8 B", grade=8, section="B")]
        subjects = [Subject(name=name) for name in ["Mathematics", "Science", "English"]]
        db.add_all(classes + subjects)
        db.flush()
        math = next(subject for subject in subjects if subject.name == "Mathematics")
        chapters = [Chapter(subject_id=math.id, name=name) for name in ["Fractions", "Algebra", "Geometry"]]
        db.add_all(chapters)
        db.flush()
        teacher = users["teacher"]
        for classroom in classes:
            for subject in subjects:
                db.add(TeacherAssignment(class_id=classroom.id, subject_id=subject.id, teacher_id=teacher.id, weekly_lessons=2, unavailable_slots=[]))
        db.add(AssessmentBlueprint(
            name="Grade 8 Mathematics Unit Assessment",
            subject_id=math.id,
            total_marks=20,
            sections=[
                {"name": "Section A", "question_type": "multiple_choice", "count": 4, "marks_each": 2, "difficulty_counts": {"easy": 4}},
                {"name": "Section B", "question_type": "short_answer", "count": 2, "marks_each": 3, "difficulty_counts": {"medium": 2}},
                {"name": "Section C", "question_type": "long_answer", "count": 1, "marks_each": 6, "difficulty_counts": {"hard": 1}},
            ],
            required_chapters=[chapters[0].id, chapters[1].id],
            internal_choice_rules={"mode": "none"},
        ))
        prompts = [
            ("Which fraction is equivalent to 1/2?", "multiple_choice", 2, "easy", [chapters[0].id]),
            ("Simplify the fraction 6/12.", "multiple_choice", 2, "easy", [chapters[0].id]),
            ("What is 3/4 of 20?", "multiple_choice", 2, "easy", [chapters[0].id]),
            ("Which expression equals 2x + 2x?", "multiple_choice", 2, "easy", [chapters[1].id]),
            ("Show the steps to solve x + 7 = 15.", "short_answer", 3, "medium", [chapters[1].id]),
            ("Write an expression for five more than twice n.", "short_answer", 3, "medium", [chapters[1].id]),
            ("A rectangle has length x + 3 and width 4. Write and simplify its perimeter expression.", "long_answer", 6, "hard", [chapters[1].id]),
        ]
        for prompt, qtype, marks, difficulty, chapter_ids in prompts:
            db.add(Question(subject_id=math.id, prompt=prompt, question_type=qtype, marks=marks, difficulty=difficulty, chapter_ids=chapter_ids, answer_reference="Teacher marking reference stored for review.", approved=True, created_by=teacher.id))
    else:
        algebra = db.query(Chapter).join(Subject).filter(Subject.name == "Mathematics", Chapter.name == "Algebra").first()
        long_question = db.query(Question).filter(Question.prompt == "A rectangle has length x + 3 and width 4. Write and simplify its perimeter expression.").first()
        if algebra and long_question and long_question.chapter_ids != [algebra.id]:
            long_question.chapter_ids = [algebra.id]
    db.commit()
