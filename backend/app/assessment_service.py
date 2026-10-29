from collections import Counter

from .models import AssessmentBlueprint, Question


def validate_blueprint(blueprint: AssessmentBlueprint, questions: list[Question]) -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    if blueprint.internal_choice_rules.get("mode", "none") != "none":
        errors.append("Only blueprints with internal_choice_rules.mode='none' are supported in this prototype.")
    expected = sum(int(section["count"]) * int(section["marks_each"]) for section in blueprint.sections)
    if expected != blueprint.total_marks:
        errors.append(f"Blueprint sections total {expected} marks, but blueprint total is {blueprint.total_marks}.")
    used: set[int] = set()
    paper: list[dict] = []
    covered: set[int] = set()
    for section in blueprint.sections:
        label = section["name"]
        count = int(section["count"])
        marks_each = int(section["marks_each"])
        qtype = section.get("question_type")
        difficulty_counts = section.get("difficulty_counts", {})
        desired_chapters = set(section.get("chapter_ids", []))
        eligible = [
            q for q in questions
            if q.approved and q.id not in used and q.subject_id == blueprint.subject_id
            and q.marks == marks_each and (not qtype or q.question_type == qtype)
            and (not desired_chapters or desired_chapters.intersection(q.chapter_ids))
        ]
        eligible.sort(key=lambda q: q.id)
        chosen: list[Question] = []
        for difficulty, needed in difficulty_counts.items():
            candidates = [q for q in eligible if q.difficulty == difficulty]
            for q in candidates[: int(needed)]:
                if len(chosen) < count:
                    chosen.append(q)
        for q in eligible:
            if len(chosen) >= count:
                break
            if q not in chosen:
                chosen.append(q)
        if len(chosen) != count:
            errors.append(f"Section '{label}' needs {count} {qtype or 'question'} question(s) worth {marks_each} marks; found {len(chosen)} suitable approved question(s).")
            continue
        if difficulty_counts:
            actual = Counter(q.difficulty for q in chosen)
            for difficulty, needed in difficulty_counts.items():
                if actual[difficulty] != int(needed):
                    errors.append(f"Section '{label}' needs {needed} {difficulty} question(s); selected {actual[difficulty]}.")
        for q in chosen:
            used.add(q.id)
            covered.update(q.chapter_ids)
            paper.append({"section": label, "question_id": q.id, "prompt": q.prompt, "question_type": q.question_type, "marks": q.marks, "difficulty": q.difficulty, "chapter_ids": q.chapter_ids})
    missing_chapters = set(blueprint.required_chapters) - covered
    if missing_chapters:
        errors.append(f"Question bank does not cover required chapter ID(s): {', '.join(map(str, sorted(missing_chapters)))}.")
    selected_marks = sum(item["marks"] for item in paper)
    if selected_marks != blueprint.total_marks:
        errors.append(f"Selected questions total {selected_marks} marks; expected {blueprint.total_marks}.")
    return paper, errors


def validate_paper(blueprint: AssessmentBlueprint, paper: list[dict], questions: list[Question], allowed_chapters: list[int] | None = None) -> list[str]:
    errors: list[str] = []
    ids = [int(item["question_id"]) for item in paper]
    if len(ids) != len(set(ids)):
        errors.append("Duplicate question IDs are not allowed.")
    by_id = {q.id: q for q in questions}
    for section in blueprint.sections:
        items = [item for item in paper if item.get("section") == section["name"]]
        if len(items) != int(section["count"]):
            errors.append(f"Section '{section['name']}' needs {section['count']} questions; it has {len(items)}.")
        if any(int(item.get("marks", 0)) != int(section["marks_each"]) for item in items):
            errors.append(f"Section '{section['name']}' has a question with incorrect marks.")
        section_marks = sum(int(item.get("marks", 0)) for item in items)
        expected_section_marks = int(section["count"]) * int(section["marks_each"])
        if section_marks != expected_section_marks:
            errors.append(f"Section '{section['name']}' totals {section_marks} marks; expected {expected_section_marks}.")
        required_type = section.get("question_type")
        if required_type and any(item.get("question_type") != required_type for item in items):
            errors.append(f"Section '{section['name']}' requires question type '{required_type}'.")
        expected_difficulty = section.get("difficulty_counts", {})
        actual_difficulty = Counter(item.get("difficulty") for item in items)
        for difficulty, count in expected_difficulty.items():
            if actual_difficulty[difficulty] != int(count):
                errors.append(f"Section '{section['name']}' requires {count} {difficulty} question(s); found {actual_difficulty[difficulty]}.")
        section_chapters = set(section.get("chapter_ids", []))
        section_covered = {chapter for item in items for chapter in item.get("chapter_ids", [])}
        if section_chapters - section_covered:
            errors.append(f"Section '{section['name']}' misses required chapter ID(s): {', '.join(map(str, sorted(section_chapters - section_covered)))}.")
    missing = set(blueprint.required_chapters) - {chapter for item in paper for chapter in item.get("chapter_ids", [])}
    if missing:
        errors.append(f"Required chapter coverage is missing chapter ID(s): {', '.join(map(str, sorted(missing)))}.")
    if allowed_chapters is not None:
        outside = {chapter for item in paper for chapter in item.get("chapter_ids", [])} - set(allowed_chapters)
        if outside:
            errors.append(f"Paper contains question(s) outside the assessment's selected chapters: {', '.join(map(str, sorted(outside)))}.")
    if any(question_id not in by_id for question_id in ids):
        errors.append("Paper contains a question that is no longer in the question bank.")
    total = sum(int(item.get("marks", 0)) for item in paper)
    if total != blueprint.total_marks:
        errors.append(f"Paper totals {total} marks; expected {blueprint.total_marks}.")
    if blueprint.internal_choice_rules.get("mode", "none") != "none":
        errors.append("This prototype only validates blueprints without internal choice.")
    return errors
