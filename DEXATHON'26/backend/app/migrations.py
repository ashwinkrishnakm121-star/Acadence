from sqlalchemy import Engine, inspect


def upgrade_question_marking_fields(engine: Engine) -> None:
    """Additive SQLite-compatible updates for existing question/evaluation tables."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    additions = {
        "expected_points": "JSON NOT NULL DEFAULT '[]'",
        "accepted_variants": "JSON NOT NULL DEFAULT '{}'",
        "marking_notes": "TEXT NOT NULL DEFAULT ''",
    }
    with engine.begin() as connection:
        if "questions" in tables:
            existing = {column["name"] for column in inspector.get_columns("questions")}
            for name, definition in additions.items():
                if name not in existing:
                    connection.exec_driver_sql(f"ALTER TABLE questions ADD COLUMN {name} {definition}")
        if "evaluations" in tables:
            existing = {column["name"] for column in inspector.get_columns("evaluations")}
            if "answers_reviewed_at" not in existing:
                column_type = "TIMESTAMP WITH TIME ZONE" if engine.dialect.name == "postgresql" else "DATETIME"
                connection.exec_driver_sql(f"ALTER TABLE evaluations ADD COLUMN answers_reviewed_at {column_type} NULL")
