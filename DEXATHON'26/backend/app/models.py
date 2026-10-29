from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    academic_year: Mapped[str] = mapped_column(String(40), nullable=False)
    working_days: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    periods_per_day: Mapped[int] = mapped_column(Integer, nullable=False)
    settings: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    capabilities: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    record_type: Mapped[str] = mapped_column(String(80), nullable=False)
    record_id: Mapped[str] = mapped_column(String(80), nullable=False)
    details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    actor: Mapped[User | None] = relationship()


class AcademicClass(Base):
    __tablename__ = "academic_classes"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    grade: Mapped[int] = mapped_column(Integer, nullable=False)
    section: Mapped[str] = mapped_column(String(20), nullable=False)


class Subject(Base):
    __tablename__ = "subjects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)


class Chapter(Base):
    __tablename__ = "chapters"
    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"
    __table_args__ = (UniqueConstraint("class_id", "subject_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("academic_classes.id"), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    weekly_lessons: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    unavailable_slots: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)


class AssessmentBlueprint(Base):
    __tablename__ = "assessment_blueprints"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    total_marks: Mapped[int] = mapped_column(Integer, nullable=False)
    sections: Mapped[list[dict]] = mapped_column(JSON, nullable=False)
    required_chapters: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    internal_choice_rules: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(40), nullable=False)
    marks: Mapped[int] = mapped_column(Integer, nullable=False)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False)
    chapter_ids: Mapped[list[int]] = mapped_column(JSON, nullable=False, default=list)
    answer_reference: Mapped[str] = mapped_column(Text, nullable=False, default="")
    expected_points: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    accepted_variants: Mapped[dict[str, list[str]]] = mapped_column(JSON, nullable=False, default=dict)
    marking_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class Assessment(Base):
    __tablename__ = "assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    class_id: Mapped[int] = mapped_column(ForeignKey("academic_classes.id"), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    examination_type: Mapped[str] = mapped_column(String(80), nullable=False)
    chapters: Mapped[list[int]] = mapped_column(JSON, nullable=False)
    total_marks: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    blueprint_id: Mapped[int] = mapped_column(ForeignKey("assessment_blueprints.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    current_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    paper: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    validation: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    review_comment: Mapped[str] = mapped_column(Text, nullable=False, default="")


class AssessmentVersion(Base):
    __tablename__ = "assessment_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="answers_review")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    answers_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    final_total: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvaluationQuestion(Base):
    __tablename__ = "evaluation_questions"
    __table_args__ = (UniqueConstraint("evaluation_id", "question_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    evaluation_id: Mapped[int] = mapped_column(ForeignKey("evaluations.id"), nullable=False)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False)
    question_number: Mapped[int] = mapped_column(Integer, nullable=False)
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(String(40), nullable=False)
    max_marks: Mapped[int] = mapped_column(Integer, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False, default="")
    answer_key_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    suggested_marks: Mapped[float | None] = mapped_column(Float, nullable=True)
    suggestion_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    suggestion_justification: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    requires_teacher_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    teacher_edited_marks: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_marks: Mapped[float | None] = mapped_column(Float, nullable=True)


class Timetable(Base):
    __tablename__ = "timetables"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    assignments: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    constraints: Mapped[list[dict]] = mapped_column(JSON, nullable=False, default=list)
    validation: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    solver_status: Mapped[str] = mapped_column(String(40), nullable=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    review_comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class TimetableVersion(Base):
    __tablename__ = "timetable_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    timetable_id: Mapped[int] = mapped_column(ForeignKey("timetables.id"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class AcademicRequirement(Base):
    __tablename__ = "academic_requirements"
    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="submitted")
    structured_data: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    review_comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class AcademicTask(Base):
    __tablename__ = "academic_tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    workflow_type: Mapped[str] = mapped_column(String(50), nullable=False)
    workflow_id: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="awaiting_preparation")
    responsible_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class TaskUpdate(Base):
    __tablename__ = "task_updates"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("academic_tasks.id"), nullable=False)
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
