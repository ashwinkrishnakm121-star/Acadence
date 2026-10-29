import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


DATABASE_URL = (
    os.getenv("ACADENCE_DATABASE_URL")
    or os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or f"sqlite:///{(Path(__file__).resolve().parents[1] / 'acadence.db').as_posix()}"
)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.removeprefix("postgres://")
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL.removeprefix("postgresql://")
if os.getenv("VERCEL") == "1" and DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("Configure a persistent PostgreSQL database before deploying Acadence on Vercel.")
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
