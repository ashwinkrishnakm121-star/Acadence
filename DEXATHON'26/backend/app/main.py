from contextlib import asynccontextmanager
import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine, get_db
from .models import AuditEvent, School, User
from .schemas import AuditRead, DemoUserCreate, SchoolRead, SchoolUpdate, UserCapabilitiesUpdate, UserRead
from .security import current_user, require
from .seed import seed_database
from .assessment_routes import router as assessment_router
from .evaluation_routes import router as evaluation_router
from .platform_routes import router as platform_router
from .migrations import upgrade_question_marking_fields


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    upgrade_question_marking_fields(engine)
    with SessionLocal() as db:
        seed_database(db)
    yield


app = FastAPI(title="Acadence API", version="0.1.0", lifespan=lifespan)
allowed_origins = [
    origin.strip()
    for origin in os.getenv("ACADENCE_ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["Content-Type", "X-Demo-User"],
)
app.include_router(assessment_router)
app.include_router(evaluation_router)
app.include_router(platform_router)


def audit(db: Session, actor: User, action: str, record_type: str, record_id: str, details: str = "") -> None:
    db.add(AuditEvent(actor_id=actor.id, action=action, record_type=record_type, record_id=record_id, details=details))


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}


@app.get("/api/school", response_model=SchoolRead)
def read_school(_: User = Depends(require("school:read")), db: Session = Depends(get_db)):
    school = db.query(School).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School configuration not found.")
    return school


@app.put("/api/school", response_model=SchoolRead)
def update_school(payload: SchoolUpdate, user: User = Depends(require("school:write")), db: Session = Depends(get_db)):
    school = db.query(School).first()
    if school is None:
        raise HTTPException(status_code=404, detail="School configuration not found.")
    school.name = payload.name
    school.academic_year = payload.academic_year
    school.working_days = payload.working_days
    school.periods_per_day = payload.periods_per_day
    school.settings = payload.settings
    audit(db, user, "school.updated", "school", str(school.id))
    db.commit()
    db.refresh(school)
    return school


@app.get("/api/users", response_model=list[UserRead])
def list_users(_: User = Depends(require("users:read")), db: Session = Depends(get_db)):
    return db.query(User).order_by(User.id).all()


@app.post("/api/users", response_model=UserRead)
def create_user(payload: DemoUserCreate, actor: User = Depends(require("users:write")), db: Session = Depends(get_db)):
    if db.query(User).filter_by(username=payload.username).first():
        raise HTTPException(status_code=409, detail="A demo account with this username already exists.")
    target = User(**payload.model_dump(), active=True)
    target.capabilities = sorted(set(target.capabilities))
    db.add(target)
    db.flush()
    audit(db, actor, "user.provisioned", "user", str(target.id), target.username)
    db.commit()
    db.refresh(target)
    return target


@app.put("/api/users/{user_id}/capabilities", response_model=UserRead)
def update_user_capabilities(
    user_id: int,
    payload: UserCapabilitiesUpdate,
    actor: User = Depends(require("users:write")),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Demo user not found.")
    target.capabilities = sorted(set(payload.capabilities))
    target.active = payload.active
    audit(db, actor, "user.capabilities_updated", "user", str(target.id), ",".join(target.capabilities))
    db.commit()
    db.refresh(target)
    return target


@app.get("/api/audit", response_model=list[AuditRead])
def list_audit(_: User = Depends(require("audit:read")), db: Session = Depends(get_db)):
    events = db.query(AuditEvent).order_by(AuditEvent.id.desc()).limit(100).all()
    return [
        AuditRead(
            id=event.id,
            actor_id=event.actor_id,
            action=event.action,
            record_type=event.record_type,
            record_id=event.record_id,
            details=event.details,
            created_at=event.created_at.isoformat(),
        )
        for event in events
    ]


@app.get("/api/me", response_model=UserRead)
def me(user: User = Depends(current_user)):
    return user
