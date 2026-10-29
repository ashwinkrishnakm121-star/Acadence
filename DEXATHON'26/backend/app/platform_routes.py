from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .database import get_db
from .models import (
    AcademicClass, AcademicRequirement, AcademicTask, Assessment, School, Subject,
    TaskUpdate as TaskUpdateRecord, TeacherAssignment, Timetable, TimetableVersion, User,
)
from .schemas import (
    AcademicClassCreate, RequirementCreate, RequirementReview, SubjectCreate,
    TaskCreate, TaskUpdateInput, TeacherAssignmentCreate, TeacherAssignmentUpdate, RequirementUpdate,
    TimetableEdit, TimetableGenerate, ReviewDecision,
)
from .security import current_user, require
from .timetable_service import parse_instruction, solve_timetable, validate_assignments
from .workflow import link_task, record_audit, record_timetable_version, require_state

router = APIRouter(prefix="/api")


def get_schedule(db: Session, schedule_id: int) -> Timetable:
    item = db.get(Timetable, schedule_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Timetable not found.")
    return item


def require_timetable_read(user: User) -> User:
    if not any(cap in user.capabilities for cap in ("timetable:write", "timetable:review")):
        raise HTTPException(status_code=403, detail="Missing capability: timetable:read")
    return user


def require_planner_read(user: User) -> User:
    if not any(cap in user.capabilities for cap in ("planner:write", "planner:review")):
        raise HTTPException(status_code=403, detail="Missing capability: planner:read")
    return user


@router.get("/timetable/inputs")
def timetable_inputs(_: User = Depends(require("school:read")), db: Session = Depends(get_db)):
    return {
        "school": db.query(School).first(),
        "classes": db.query(AcademicClass).order_by(AcademicClass.id).all(),
        "subjects": db.query(Subject).order_by(Subject.id).all(),
        "teachers": [{"id": u.id, "display_name": u.display_name} for u in db.query(User).filter(User.role == "Teacher", User.active.is_(True)).all()],
        "assignments": db.query(TeacherAssignment).order_by(TeacherAssignment.id).all(),
    }


@router.post("/academic-classes")
def create_class(payload: AcademicClassCreate, actor: User = Depends(require("timetable:write")), db: Session = Depends(get_db)):
    row = AcademicClass(**payload.model_dump())
    db.add(row); db.flush()
    record_audit(db, actor, "academic_class.created", "academic_class", row.id)
    db.commit(); db.refresh(row)
    return row


@router.post("/subjects")
def create_subject(payload: SubjectCreate, actor: User = Depends(require("timetable:write")), db: Session = Depends(get_db)):
    if db.query(Subject).filter(Subject.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Subject already exists.")
    row = Subject(name=payload.name)
    db.add(row); db.flush()
    record_audit(db, actor, "subject.created", "subject", row.id)
    db.commit(); db.refresh(row)
    return row


@router.post("/teacher-assignments")
def create_teacher_assignment(payload: TeacherAssignmentCreate, actor: User = Depends(require("timetable:write")), db: Session = Depends(get_db)):
    teacher = db.get(User, payload.teacher_id)
    if not db.get(AcademicClass, payload.class_id) or not db.get(Subject, payload.subject_id) or not teacher or teacher.role != "Teacher" or not teacher.active:
        raise HTTPException(status_code=422, detail="Assignment must use an existing class, subject and teacher account.")
    if db.query(TeacherAssignment).filter_by(class_id=payload.class_id, subject_id=payload.subject_id).first():
        raise HTTPException(status_code=409, detail="This class already has a teacher assignment for the selected subject.")
    school = db.query(School).first()
    for slot in payload.unavailable_slots:
        if slot.get("day") not in school.working_days or not isinstance(slot.get("period"), int) or not 1 <= slot["period"] <= school.periods_per_day:
            raise HTTPException(status_code=422, detail="Availability slots must be within the configured working days and periods.")
    row = TeacherAssignment(**payload.model_dump())
    db.add(row); db.flush()
    record_audit(db, actor, "teacher_assignment.created", "teacher_assignment", row.id)
    db.commit(); db.refresh(row)
    return row


@router.put("/teacher-assignments/{assignment_id}")
def update_teacher_assignment(assignment_id: int, payload: TeacherAssignmentUpdate, actor: User = Depends(require("timetable:write")), db: Session = Depends(get_db)):
    row = db.get(TeacherAssignment, assignment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Teacher assignment not found.")
    school = db.query(School).first()
    for slot in payload.unavailable_slots:
        if slot.get("day") not in school.working_days or not isinstance(slot.get("period"), int) or not 1 <= slot["period"] <= school.periods_per_day:
            raise HTTPException(status_code=422, detail="Availability slots must be within the configured working days and periods.")
    row.weekly_lessons = payload.weekly_lessons
    row.unavailable_slots = payload.unavailable_slots
    record_audit(db, actor, "teacher_assignment.updated", "teacher_assignment", row.id)
    db.commit(); db.refresh(row)
    return row


@router.post("/timetables/generate")
def generate_timetable(payload: TimetableGenerate, actor: User = Depends(require("timetable:write")), db: Session = Depends(get_db)):
    school = db.query(School).first()
    classes = db.query(AcademicClass).order_by(AcademicClass.id).all()
    subjects = db.query(Subject).order_by(Subject.id).all()
    requirements = db.query(TeacherAssignment).order_by(TeacherAssignment.id).all()
    constraints = list(payload.constraints)
    unsupported = []
    for text in payload.natural_language:
        parsed = parse_instruction(text, subjects, school.working_days, school.periods_per_day)
        if not parsed["supported"]:
            unsupported.append(parsed)
        else:
            constraints.append(parsed["constraint"])
    if unsupported:
        return {"solver_status": "not_run", "valid": False, "assignments": [], "constraints": constraints, "unsupported_instructions": unsupported, "errors": [item["reason"] for item in unsupported]}
    subject_ids = {subject.id for subject in subjects}
    normalized_constraints = []
    for item in constraints:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="Each timetable constraint must be a structured object.")
        try:
            subject_id = int(item.get("subject_id", -1))
            kind = item.get("kind")
            if kind == "avoid_subject_day":
                day = item.get("day")
                hard = item.get("hard", True)
                if subject_id not in subject_ids or day not in school.working_days or not isinstance(hard, bool):
                    raise ValueError
                normalized_constraints.append({"kind": kind, "subject_id": subject_id, "day": day, "hard": hard})
            elif kind == "prefer_subject_period":
                period = int(item.get("period", 0)); weight = int(item.get("weight", 1))
                if subject_id not in subject_ids or not 1 <= period <= school.periods_per_day or not 1 <= weight <= 100:
                    raise ValueError
                normalized_constraints.append({"kind": kind, "subject_id": subject_id, "period": period, "weight": weight})
            else:
                raise HTTPException(status_code=422, detail=f"Unsupported structured constraint: {kind}.")
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Timetable constraint references an invalid subject, day, period or preference weight.")
    constraints = normalized_constraints
    planner_requirements = db.query(AcademicRequirement).filter_by(category="timetable_instruction", status="accepted").all()
    for requirement in planner_requirements:
        constraint = requirement.structured_data.get("constraint")
        if constraint and constraint not in constraints:
            constraints.append(constraint)
    result = solve_timetable(classes, subjects, requirements, school, constraints)
    validation_errors = list(result["errors"])
    if result["assignments"]:
        validation_errors.extend(validate_assignments(result["assignments"], classes, subjects, requirements, school, constraints))
    valid = bool(result["assignments"]) and not validation_errors
    previous_version = db.query(Timetable).order_by(Timetable.version.desc()).first()
    row = Timetable(version=(previous_version.version + 1 if previous_version else 1), status="draft", assignments=result["assignments"], constraints=constraints, validation={"valid": valid, "errors": validation_errors}, solver_status=result["solver_status"], created_by=actor.id)
    db.add(row); db.flush()
    record_timetable_version(db, row, actor, "generated")
    link_task(db, actor, f"Review timetable draft v{row.version}", "timetable", row.id, actor.id, "awaiting_preparation")
    record_audit(db, actor, "timetable.generated", "timetable", row.id, result["solver_status"])
    db.commit(); db.refresh(row)
    return {"id": row.id, "version": row.version, "status": row.status, "solver_status": row.solver_status, "assignments": row.assignments, "constraints": row.constraints, "validation": row.validation}


@router.get("/timetables")
def timetable_history(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_timetable_read(user)
    return db.query(Timetable).order_by(Timetable.version.desc()).all()


@router.get("/timetables/{schedule_id}")
def timetable_detail(schedule_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_timetable_read(user)
    return get_schedule(db, schedule_id)


@router.put("/timetables/{schedule_id}/assignments")
def correct_timetable(schedule_id: int, payload: TimetableEdit, actor: User = Depends(require("timetable:write")), db: Session = Depends(get_db)):
    row = get_schedule(db, schedule_id)
    require_state(row.status, {"draft", "changes_requested"}, "edit the timetable")
    classes = db.query(AcademicClass).all(); subjects = db.query(Subject).all()
    requirements = db.query(TeacherAssignment).all(); school = db.query(School).first()
    errors = validate_assignments(payload.assignments, classes, subjects, requirements, school, row.constraints)
    row.assignments = payload.assignments
    row.validation = {"valid": not errors, "errors": errors}
    row.status = "draft"
    record_timetable_version(db, row, actor, "manually_corrected", "; ".join(errors))
    record_audit(db, actor, "timetable.corrected", "timetable", row.id, "; ".join(errors))
    db.commit(); db.refresh(row)
    return row


@router.post("/timetables/{schedule_id}/submit")
def submit_timetable(schedule_id: int, actor: User = Depends(require("timetable:write")), db: Session = Depends(get_db)):
    row = get_schedule(db, schedule_id)
    require_state(row.status, {"draft", "changes_requested"}, "submit the timetable")
    errors = validate_assignments(row.assignments, db.query(AcademicClass).all(), db.query(Subject).all(), db.query(TeacherAssignment).all(), db.query(School).first(), row.constraints)
    row.validation = {"valid": not errors, "errors": errors}
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Timetable hard constraints failed.", "errors": errors})
    row.status = "submitted"
    record_timetable_version(db, row, actor, "submitted")
    link_task(db, actor, f"Review timetable draft v{row.version}", "timetable", row.id, status="awaiting_review")
    record_audit(db, actor, "timetable.submitted", "timetable", row.id)
    db.commit()
    return {"id": row.id, "status": row.status, "validation": row.validation}


@router.post("/timetables/{schedule_id}/review")
def review_timetable(schedule_id: int, payload: ReviewDecision, reviewer: User = Depends(require("timetable:review")), db: Session = Depends(get_db)):
    row = get_schedule(db, schedule_id)
    require_state(row.status, {"submitted"}, "review the timetable")
    errors = validate_assignments(row.assignments, db.query(AcademicClass).all(), db.query(Subject).all(), db.query(TeacherAssignment).all(), db.query(School).first(), row.constraints)
    if errors:
        row.validation = {"valid": False, "errors": errors}
        db.commit()
        raise HTTPException(status_code=422, detail={"message": "Timetable failed independent review validation.", "errors": errors})
    row.status = {"approve": "approved", "reject": "rejected", "request_changes": "changes_requested"}[payload.action]
    row.reviewer_id = reviewer.id; row.review_comment = payload.comment
    record_timetable_version(db, row, reviewer, payload.action, payload.comment)
    link_task(db, reviewer, f"Review timetable draft v{row.version}", "timetable", row.id, status="completed" if payload.action == "approve" else "changes_requested")
    record_audit(db, reviewer, f"timetable.{payload.action}", "timetable", row.id, payload.comment)
    db.commit()
    return {"id": row.id, "status": row.status, "review_comment": row.review_comment}


@router.post("/timetables/{schedule_id}/publish")
def publish_timetable(schedule_id: int, actor: User = Depends(require("timetable:publish")), db: Session = Depends(get_db)):
    row = get_schedule(db, schedule_id)
    require_state(row.status, {"approved"}, "publish the timetable")
    errors = validate_assignments(row.assignments, db.query(AcademicClass).all(), db.query(Subject).all(), db.query(TeacherAssignment).all(), db.query(School).first(), row.constraints)
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Invalid timetable cannot be published.", "errors": errors})
    row.status = "published"
    record_timetable_version(db, row, actor, "published")
    record_audit(db, actor, "timetable.published", "timetable", row.id)
    db.commit()
    return {"id": row.id, "status": row.status}


@router.get("/timetables/{schedule_id}/validate")
def validate_timetable(schedule_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_timetable_read(user)
    row = get_schedule(db, schedule_id)
    errors = validate_assignments(row.assignments, db.query(AcademicClass).all(), db.query(Subject).all(), db.query(TeacherAssignment).all(), db.query(School).first(), row.constraints)
    row.validation = {"valid": not errors, "errors": errors}; db.commit()
    return row.validation


@router.get("/timetables/{schedule_id}/versions")
def timetable_versions(schedule_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_timetable_read(user)
    get_schedule(db, schedule_id)
    return db.query(TimetableVersion).filter_by(timetable_id=schedule_id).order_by(TimetableVersion.version).all()


@router.post("/planner/requirements")
def create_requirement(payload: RequirementCreate, actor: User = Depends(require("planner:write")), db: Session = Depends(get_db)):
    allowed = {"syllabus", "teaching_periods", "teacher_availability", "holiday", "examination_date", "timetable_instruction"}
    if payload.category not in allowed:
        raise HTTPException(status_code=422, detail=f"Supported requirement categories are: {', '.join(sorted(allowed))}.")
    data = payload.structured_data
    status = "submitted"
    if payload.category == "timetable_instruction":
        school = db.query(School).first(); subjects = db.query(Subject).all()
        parsed = parse_instruction(payload.source_text, subjects, school.working_days, school.periods_per_day)
        if parsed["supported"]:
            data = {"constraint": parsed["constraint"]}; status = "submitted"
        else:
            data = {"unsupported": True, "reason": parsed["reason"]}; status = "unsupported"
    row = AcademicRequirement(category=payload.category, source_text=payload.source_text, structured_data=data, status=status, created_by=actor.id)
    db.add(row); db.flush()
    link_task(db, actor, f"Review academic requirement: {payload.category}", "planner", row.id, status="awaiting_review")
    record_audit(db, actor, "planner.requirement_submitted", "planner_requirement", row.id, status)
    db.commit(); db.refresh(row)
    return row


@router.get("/planner/requirements")
def list_requirements(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_planner_read(user)
    return db.query(AcademicRequirement).order_by(AcademicRequirement.id.desc()).all()


@router.put("/planner/requirements/{requirement_id}")
def update_requirement(requirement_id: int, payload: RequirementUpdate, actor: User = Depends(require("planner:write")), db: Session = Depends(get_db)):
    row = db.get(AcademicRequirement, requirement_id)
    if not row:
        raise HTTPException(status_code=404, detail="Academic requirement not found.")
    require_state(row.status, {"changes_requested", "unsupported"}, "update the requirement")
    if row.created_by != actor.id and "planner:review" not in actor.capabilities:
        raise HTTPException(status_code=403, detail="Only the requirement author or an authorized reviewer may update it.")
    data = payload.structured_data
    status = "submitted"
    if row.category == "timetable_instruction":
        school = db.query(School).first(); subjects = db.query(Subject).all()
        parsed = parse_instruction(payload.source_text, subjects, school.working_days, school.periods_per_day)
        if parsed["supported"]:
            data = {"constraint": parsed["constraint"]}
        else:
            data = {"unsupported": True, "reason": parsed["reason"]}; status = "unsupported"
    row.source_text = payload.source_text
    row.structured_data = data
    row.status = status
    row.review_comment = ""
    link_task(db, actor, f"Review academic requirement: {row.category}", "planner", row.id, status="awaiting_review")
    record_audit(db, actor, "planner.requirement_updated", "planner_requirement", row.id, status)
    db.commit(); db.refresh(row)
    return row


@router.post("/planner/requirements/{requirement_id}/review")
def review_requirement(requirement_id: int, payload: RequirementReview, reviewer: User = Depends(require("planner:review")), db: Session = Depends(get_db)):
    row = db.get(AcademicRequirement, requirement_id)
    if not row:
        raise HTTPException(status_code=404, detail="Academic requirement not found.")
    require_state(row.status, {"submitted", "unsupported"}, "review the requirement")
    if payload.action == "accept" and row.structured_data.get("unsupported"):
        raise HTTPException(status_code=422, detail="Unsupported or ambiguous instructions must be corrected before acceptance.")
    row.status = {"accept": "accepted", "reject": "rejected", "request_changes": "changes_requested"}[payload.action]
    row.reviewed_by = reviewer.id; row.review_comment = payload.comment
    link_task(db, reviewer, f"Review academic requirement: {row.category}", "planner", row.id, status="completed" if payload.action == "accept" else "changes_requested")
    record_audit(db, reviewer, f"planner.requirement_{payload.action}", "planner_requirement", row.id, payload.comment)
    db.commit()
    return row


@router.post("/tasks")
def create_task(payload: TaskCreate, actor: User = Depends(require("tasks:write")), db: Session = Depends(get_db)):
    valid_workflow = {
        "assessment": db.get(Assessment, payload.workflow_id),
        "timetable": db.get(Timetable, payload.workflow_id),
        "planner": db.get(AcademicRequirement, payload.workflow_id),
    }[payload.workflow_type]
    if not valid_workflow:
        raise HTTPException(status_code=422, detail="Task must link to an existing academic workflow record.")
    if payload.responsible_user_id and not db.get(User, payload.responsible_user_id):
        raise HTTPException(status_code=422, detail="Responsible demo user not found.")
    row = AcademicTask(**payload.model_dump(), created_by=actor.id)
    db.add(row); db.flush()
    record_audit(db, actor, "task.created", "academic_task", row.id)
    db.commit(); db.refresh(row)
    return row


@router.get("/tasks")
def list_tasks(status: str | None = None, _: User = Depends(require("tasks:read")), db: Session = Depends(get_db)):
    query = db.query(AcademicTask)
    if status:
        query = query.filter(AcademicTask.status == status)
    rows = query.order_by(AcademicTask.created_at.desc()).all()
    return [{"id": row.id, "title": row.title, "description": row.description, "workflow_type": row.workflow_type, "workflow_id": row.workflow_id, "status": row.status, "responsible_user_id": row.responsible_user_id, "created_by": row.created_by, "updates": db.query(TaskUpdateRecord).filter_by(task_id=row.id).order_by(TaskUpdateRecord.id).all()} for row in rows]


@router.post("/tasks/{task_id}/updates")
def update_task(task_id: int, payload: TaskUpdateInput, actor: User = Depends(require("tasks:write")), db: Session = Depends(get_db)):
    row = db.get(AcademicTask, task_id)
    if not row:
        raise HTTPException(status_code=404, detail="Academic task not found.")
    if row.responsible_user_id not in (None, actor.id) and "tasks:manage_all" not in actor.capabilities:
        raise HTTPException(status_code=403, detail="Only the responsible user or a task manager may update this task.")
    if payload.status:
        transitions = {
            "awaiting_preparation": {"awaiting_review"},
            "awaiting_review": {"changes_requested", "completed"},
            "changes_requested": {"awaiting_preparation", "awaiting_review"},
            "completed": set(),
        }
        if payload.status != row.status and payload.status not in transitions.get(row.status, set()):
            raise HTTPException(status_code=409, detail=f"Illegal task transition: {row.status} to {payload.status}.")
        row.status = payload.status
    update = TaskUpdateRecord(task_id=row.id, actor_id=actor.id, body=payload.body)
    db.add(update)
    record_audit(db, actor, "task.updated", "academic_task", row.id, payload.status or "update added")
    db.commit(); db.refresh(update)
    return {"task_id": row.id, "status": row.status, "update": update}
