from typing import Literal

from pydantic import BaseModel, Field, FiniteFloat, field_validator, model_validator

SUPPORTED_CAPABILITIES = {
    "school:read", "school:write", "users:read", "users:write", "audit:read",
    "assessments:write", "assessments:review", "timetable:write", "timetable:review",
    "timetable:publish", "planner:write", "planner:review", "tasks:read", "tasks:write",
    "tasks:manage_all",
}


def validate_capabilities(values: list[str]) -> list[str]:
    unknown = sorted(set(values) - SUPPORTED_CAPABILITIES)
    if unknown:
        raise ValueError(f"Unsupported capability value(s): {', '.join(unknown)}.")
    return values


class SchoolRead(BaseModel):
    id: int
    name: str
    academic_year: str
    working_days: list[str]
    periods_per_day: int
    settings: dict

    model_config = {"from_attributes": True}


class SchoolUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    academic_year: str = Field(min_length=4, max_length=40)
    working_days: list[str] = Field(min_length=1)
    periods_per_day: int = Field(ge=1, le=12)
    settings: dict = Field(default_factory=dict)

    @field_validator("working_days")
    @classmethod
    def valid_working_days(cls, days: list[str]):
        supported = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"}
        if not days or len(days) != len(set(days)) or not set(days).issubset(supported):
            raise ValueError("Working days must be a nonempty list of unique weekday names.")
        return days


class UserRead(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    active: bool
    capabilities: list[str]

    model_config = {"from_attributes": True}


class UserCapabilitiesUpdate(BaseModel):
    capabilities: list[str]
    active: bool = True

    @field_validator("capabilities")
    @classmethod
    def known_capabilities(cls, values: list[str]):
        return validate_capabilities(values)


class DemoUserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=80, pattern="^[a-zA-Z0-9._-]+$")
    display_name: str = Field(min_length=1, max_length=160)
    role: Literal["Super Admin", "Teacher", "Academic Reviewer"]
    capabilities: list[str] = Field(default_factory=list)

    @field_validator("capabilities")
    @classmethod
    def known_capabilities(cls, values: list[str]):
        return validate_capabilities(values)


class AuditRead(BaseModel):
    id: int
    actor_id: int | None
    action: str
    record_type: str
    record_id: str
    details: str
    created_at: str


class AssessmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    class_id: int
    subject_id: int
    examination_type: str = Field(min_length=1, max_length=80)
    chapters: list[int] = Field(min_length=1)
    total_marks: int = Field(gt=0)
    duration_minutes: int = Field(gt=0, le=360)
    blueprint_id: int


class BlueprintSection(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    question_type: Literal["multiple_choice", "short_answer", "long_answer"]
    count: int = Field(ge=1, le=50)
    marks_each: int = Field(ge=1, le=100)
    difficulty_counts: dict[Literal["easy", "medium", "hard"], int] = Field(default_factory=dict)
    chapter_ids: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_difficulty_counts(self):
        if self.difficulty_counts and (any(value < 0 for value in self.difficulty_counts.values()) or sum(self.difficulty_counts.values()) != self.count):
            raise ValueError("Difficulty distribution counts must be nonnegative and add up to the section question count.")
        return self


class BlueprintCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    subject_id: int
    total_marks: int = Field(gt=0)
    sections: list[BlueprintSection] = Field(min_length=1)
    required_chapters: list[int] = Field(default_factory=list)
    internal_choice_rules: dict = Field(default_factory=lambda: {"mode": "none"})

    @field_validator("internal_choice_rules")
    @classmethod
    def supported_internal_choices(cls, value: dict):
        if value.get("mode", "none") != "none":
            raise ValueError("Only internal_choice_rules.mode='none' is supported in this prototype.")
        return value


class QuestionCreate(BaseModel):
    subject_id: int
    prompt: str = Field(min_length=1)
    question_type: Literal["multiple_choice", "short_answer", "long_answer"]
    marks: int = Field(gt=0)
    difficulty: str = Field(pattern="^(easy|medium|hard)$")
    chapter_ids: list[int] = Field(min_length=1)
    answer_reference: str = ""
    expected_points: list[str] = Field(default_factory=list, max_length=30)
    accepted_variants: dict[str, list[str]] = Field(default_factory=dict)
    marking_notes: str = Field(default="", max_length=2000)

    @field_validator("expected_points")
    @classmethod
    def clean_expected_points(cls, values: list[str]):
        cleaned = [value.strip() for value in values if value.strip()]
        if len(cleaned) != len(set(cleaned)):
            raise ValueError("Expected points must be unique.")
        if any(len(value) > 300 for value in cleaned):
            raise ValueError("Each expected point must be 300 characters or fewer.")
        return cleaned

    @field_validator("accepted_variants")
    @classmethod
    def clean_accepted_variants(cls, values: dict[str, list[str]]):
        cleaned = {}
        for point, variants in values.items():
            key = point.strip()
            alternatives = [item.strip() for item in variants if item.strip()]
            if not key or any(len(item) > 300 for item in alternatives):
                raise ValueError("Accepted variants need a valid expected point and entries of at most 300 characters.")
            cleaned[key] = alternatives
        return cleaned

    @model_validator(mode="after")
    def variants_match_expected_points(self):
        if set(self.accepted_variants) - set(self.expected_points):
            raise ValueError("Accepted variant keys must match an expected point exactly.")
        if self.accepted_variants and not self.expected_points:
            raise ValueError("Accepted variants require at least one expected point.")
        return self


class QuestionCriteriaUpdate(BaseModel):
    expected_points: list[str] = Field(default_factory=list, max_length=30)
    accepted_variants: dict[str, list[str]] = Field(default_factory=dict)
    marking_notes: str = Field(default="", max_length=2000)

    @field_validator("expected_points")
    @classmethod
    def clean_expected_points(cls, values: list[str]):
        return QuestionCreate.clean_expected_points(values)

    @field_validator("accepted_variants")
    @classmethod
    def clean_accepted_variants(cls, values: dict[str, list[str]]):
        return QuestionCreate.clean_accepted_variants(values)

    @model_validator(mode="after")
    def variants_match_expected_points(self):
        if set(self.accepted_variants) - set(self.expected_points):
            raise ValueError("Accepted variant keys must match an expected point exactly.")
        if self.accepted_variants and not self.expected_points:
            raise ValueError("Accepted variants require at least one expected point.")
        return self


class EvaluationAnswerInput(BaseModel):
    question_id: int = Field(gt=0)
    answer: str = Field(max_length=10000)


class EvaluationCreate(BaseModel):
    assessment_id: int = Field(gt=0)
    answers: list[EvaluationAnswerInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_answers(self):
        ids = [row.question_id for row in self.answers]
        if len(ids) != len(set(ids)):
            raise ValueError("Each assessment question must have exactly one answer entry.")
        return self


class EvaluationMarkInput(BaseModel):
    question_id: int = Field(gt=0)
    marks: FiniteFloat = Field(ge=0)


class EvaluationMarksUpdate(BaseModel):
    marks: list[EvaluationMarkInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_marks(self):
        ids = [row.question_id for row in self.marks]
        if len(ids) != len(set(ids)):
            raise ValueError("Each question may appear only once in a mark update.")
        return self


class ChapterCreate(BaseModel):
    subject_id: int
    name: str = Field(min_length=1, max_length=120)


class PaperEdit(BaseModel):
    question_ids: list[int] = Field(min_length=1)
    edits: dict[int, str] = Field(default_factory=dict)

    @field_validator("edits")
    @classmethod
    def valid_edits(cls, edits: dict[int, str]):
        if any(not value.strip() or len(value) > 4000 for value in edits.values()):
            raise ValueError("Edited question text must contain 1 to 4000 characters.")
        return edits


class ReviewDecision(BaseModel):
    action: str = Field(pattern="^(approve|reject|request_changes)$")
    comment: str = Field(default="", max_length=2000)


class RequirementCreate(BaseModel):
    category: str = Field(min_length=1, max_length=60)
    source_text: str = Field(min_length=1, max_length=2000)
    structured_data: dict = Field(default_factory=dict)


class RequirementUpdate(BaseModel):
    source_text: str = Field(min_length=1, max_length=2000)
    structured_data: dict = Field(default_factory=dict)


class RequirementReview(BaseModel):
    action: str = Field(pattern="^(accept|reject|request_changes)$")
    comment: str = Field(default="", max_length=2000)


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = ""
    workflow_type: str = Field(pattern="^(assessment|timetable|planner|evaluation)$")
    workflow_id: int = Field(gt=0)
    responsible_user_id: int | None = None


class TaskUpdateInput(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    status: str | None = Field(default=None, pattern="^(awaiting_preparation|awaiting_review|changes_requested|completed)$")


class TimetableGenerate(BaseModel):
    constraints: list[dict] = Field(default_factory=list)
    natural_language: list[str] = Field(default_factory=list)


class TimetableEdit(BaseModel):
    assignments: list[dict]


class TeacherAssignmentUpdate(BaseModel):
    weekly_lessons: int = Field(ge=0, le=20)
    unavailable_slots: list[dict] = Field(default_factory=list)


class AcademicClassCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    grade: int = Field(ge=1, le=12)
    section: str = Field(min_length=1, max_length=20)


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class TeacherAssignmentCreate(BaseModel):
    class_id: int
    subject_id: int
    teacher_id: int
    weekly_lessons: int = Field(ge=0, le=20)
    unavailable_slots: list[dict] = Field(default_factory=list)
