from fastapi import HTTPException
from sqlalchemy.orm import Session

from .models import AcademicTask, AuditEvent, Timetable, TimetableVersion, User


def record_audit(db: Session, actor: User, action: str, record_type: str, record_id: int | str, details: str = "") -> None:
    db.add(AuditEvent(actor_id=actor.id, action=action, record_type=record_type, record_id=str(record_id), details=details))


def link_task(db: Session, actor: User, title: str, workflow_type: str, workflow_id: int, responsible_user_id: int | None = None, status: str = "awaiting_preparation") -> AcademicTask:
    task = db.query(AcademicTask).filter_by(workflow_type=workflow_type, workflow_id=workflow_id).first()
    if task is None:
        task = AcademicTask(title=title, workflow_type=workflow_type, workflow_id=workflow_id, created_by=actor.id, responsible_user_id=responsible_user_id, status=status)
        db.add(task)
    else:
        task.status = status
    return task


def require_state(actual: str, allowed: set[str], action: str) -> None:
    if actual not in allowed:
        raise HTTPException(status_code=409, detail=f"Cannot {action} while this record is '{actual}'.")


def record_timetable_version(db: Session, timetable: Timetable, actor: User, action: str, comment: str = "") -> None:
    version = db.query(TimetableVersion).filter_by(timetable_id=timetable.id).count() + 1
    snapshot = {
        "status": timetable.status,
        "solver_status": timetable.solver_status,
        "assignments": timetable.assignments,
        "constraints": timetable.constraints,
        "validation": timetable.validation,
    }
    db.add(TimetableVersion(timetable_id=timetable.id, version=version, actor_id=actor.id, action=action, snapshot=snapshot, comment=comment))
