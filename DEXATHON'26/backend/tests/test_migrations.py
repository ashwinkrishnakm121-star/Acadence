from sqlalchemy import create_engine, inspect, text

from app.migrations import upgrade_question_marking_fields


def test_criteria_migration_adds_columns_without_replacing_existing_questions(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE questions (id INTEGER PRIMARY KEY, answer_reference TEXT NOT NULL)"))
        connection.execute(text("INSERT INTO questions (id, answer_reference) VALUES (1, 'existing answer key')"))
        connection.execute(text("CREATE TABLE evaluations (id INTEGER PRIMARY KEY, assessment_id INTEGER NOT NULL, status TEXT NOT NULL, created_by INTEGER NOT NULL, confirmed_by INTEGER, final_total FLOAT, created_at DATETIME NOT NULL, confirmed_at DATETIME)"))
        connection.execute(text("INSERT INTO evaluations (id, assessment_id, status, created_by, created_at) VALUES (7, 2, 'answers_review', 3, '2026-10-29T12:00:00')"))
    upgrade_question_marking_fields(engine)
    with engine.connect() as connection:
        row = connection.execute(text("SELECT id, answer_reference, expected_points, accepted_variants, marking_notes FROM questions WHERE id=1")).one()
        evaluation = connection.execute(text("SELECT id, assessment_id, status, answers_reviewed_at FROM evaluations WHERE id=7")).one()
    columns = {item["name"] for item in inspect(engine).get_columns("questions")}
    evaluation_columns = {item["name"] for item in inspect(engine).get_columns("evaluations")}
    assert {"expected_points", "accepted_variants", "marking_notes"}.issubset(columns)
    assert "answers_reviewed_at" in evaluation_columns
    assert row[0] == 1 and row[1] == "existing answer key"
    assert row[2:] == ("[]", "{}", "")
    assert evaluation == (7, 2, "answers_review", None)
    engine.dispose()
