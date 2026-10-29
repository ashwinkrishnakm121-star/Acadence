import re

from ortools.sat.python import cp_model

from .models import AcademicClass, School, Subject, TeacherAssignment


def parse_instruction(text: str, subjects: list[Subject], days: list[str], periods: int) -> dict:
    subject_by_name = {subject.name.casefold(): subject for subject in subjects}
    day_by_name = {day.casefold(): day for day in days}
    match = re.fullmatch(r"\s*(?:avoid|do not schedule)\s+(.+?)\s+(?:on|during)\s+([a-zA-Z]+)\s*", text, re.I)
    if not match:
        match = re.fullmatch(r"\s*(.+?)\s+(?:should not be scheduled|must not be scheduled)\s+on\s+([a-zA-Z]+)\s*", text, re.I)
    if match:
        subject = subject_by_name.get(match.group(1).strip().casefold())
        day = day_by_name.get(match.group(2).strip().casefold())
        if subject and day:
            return {"supported": True, "constraint": {"kind": "avoid_subject_day", "subject_id": subject.id, "day": day, "hard": True}}
    match = re.fullmatch(r"\s*prefer\s+(.+?)\s+(?:in|during)\s+period\s+(\d+)\s*", text, re.I)
    if match:
        subject = subject_by_name.get(match.group(1).strip().casefold())
        period = int(match.group(2))
        if subject and 1 <= period <= periods:
            return {"supported": True, "constraint": {"kind": "prefer_subject_period", "subject_id": subject.id, "period": period, "weight": 1}}
    return {"supported": False, "source_text": text, "reason": "Instruction is unsupported or ambiguous. Use 'avoid <subject> on <weekday>' or 'prefer <subject> in period <number>'."}


def validate_assignments(assignments: list[dict], classes: list[AcademicClass], subjects: list[Subject], requirements: list[TeacherAssignment], school: School, constraints: list[dict]) -> list[str]:
    errors: list[str] = []
    class_ids = {row.id for row in classes}
    subject_ids = {row.id for row in subjects}
    subject_name = {row.id: row.name for row in subjects}
    valid_days = set(school.working_days)
    class_slots: set[tuple] = set()
    teacher_slots: set[tuple] = set()
    actual_counts: dict[tuple[int, int], int] = {}
    req_by_pair = {(row.class_id, row.subject_id): row for row in requirements}
    unavailable = {(row.class_id, row.subject_id, item.get("day"), int(item.get("period", -1))) for row in requirements for item in row.unavailable_slots}
    avoid = {(int(c["subject_id"]), c["day"]) for c in constraints if c.get("kind") == "avoid_subject_day" and c.get("hard", True)}
    for index, item in enumerate(assignments, 1):
        try:
            class_id, subject_id, teacher_id = int(item["class_id"]), int(item["subject_id"]), int(item["teacher_id"])
            day, period = str(item["day"]), int(item["period"])
        except (KeyError, TypeError, ValueError):
            errors.append(f"Assignment {index} is missing a valid class, subject, teacher, day or period.")
            continue
        if class_id not in class_ids or subject_id not in subject_ids:
            errors.append(f"Assignment {index} refers to an unknown class or subject.")
            continue
        if day not in valid_days or not (1 <= period <= school.periods_per_day):
            errors.append(f"Assignment {index} is outside the configured academic days or periods.")
            continue
        req = req_by_pair.get((class_id, subject_id))
        if req is None or req.teacher_id != teacher_id:
            errors.append(f"Assignment {index} has no matching teacher-subject-class assignment.")
            continue
        if (class_id, subject_id, day, period) in unavailable:
            errors.append(f"{subject_name[subject_id]} is scheduled in its teacher's unavailable period on {day}, period {period}.")
        if (subject_id, day) in avoid:
            errors.append(f"{subject_name[subject_id]} is scheduled on avoided day {day}.")
        class_key = (class_id, day, period)
        if class_key in class_slots:
            errors.append(f"Class {class_id} has multiple lessons on {day}, period {period}.")
        class_slots.add(class_key)
        teacher_key = (teacher_id, day, period)
        if teacher_key in teacher_slots:
            errors.append(f"Teacher {teacher_id} has multiple lessons on {day}, period {period}.")
        teacher_slots.add(teacher_key)
        pair = (class_id, subject_id)
        actual_counts[pair] = actual_counts.get(pair, 0) + 1
    expected_pairs = {(row.class_id, row.subject_id) for row in requirements}
    for pair in sorted(expected_pairs):
        required = req_by_pair[pair].weekly_lessons
        actual = actual_counts.get(pair, 0)
        if actual != required:
            errors.append(f"Class {pair[0]} subject {subject_name[pair[1]]} needs {required} weekly lesson(s); found {actual}.")
    return errors


def solve_timetable(classes: list[AcademicClass], subjects: list[Subject], requirements: list[TeacherAssignment], school: School, constraints: list[dict]) -> dict:
    if not classes or not subjects or not requirements or not school.working_days or school.periods_per_day < 1:
        return {"solver_status": "not_run", "assignments": [], "errors": ["Timetable inputs are incomplete: configure classes, subjects, teacher assignments, working days and periods."]}
    lesson_rows: list[tuple[TeacherAssignment, int]] = []
    for req in requirements:
        if req.weekly_lessons < 0:
            return {"solver_status": "not_run", "assignments": [], "errors": ["Weekly lesson counts cannot be negative."]}
        lesson_rows.extend((req, occurrence) for occurrence in range(req.weekly_lessons))
    slots = [(day, period) for day in school.working_days for period in range(1, school.periods_per_day + 1)]
    model = cp_model.CpModel()
    variables: dict[tuple[int, int], object] = {}
    subject_lookup = {subject.id: subject for subject in subjects}
    for lesson_index, (req, _) in enumerate(lesson_rows):
        unavailable = {(item.get("day"), int(item.get("period", -1))) for item in req.unavailable_slots}
        for slot_index, (day, period) in enumerate(slots):
            excluded = (day, period) in unavailable
            excluded |= any(c.get("kind") == "avoid_subject_day" and c.get("hard", True) and int(c.get("subject_id", -1)) == req.subject_id and c.get("day") == day for c in constraints)
            if not excluded:
                variables[(lesson_index, slot_index)] = model.NewBoolVar(f"lesson_{lesson_index}_slot_{slot_index}")
        choices = [variables[(lesson_index, s)] for s in range(len(slots)) if (lesson_index, s) in variables]
        if choices:
            model.AddExactlyOne(choices)
        else:
            model.AddBoolOr([])
    for lesson_index in range(len(lesson_rows)):
        req, _ = lesson_rows[lesson_index]
        for slot_index, _slot in enumerate(slots):
            group = [variables[(i, slot_index)] for i, (other, _) in enumerate(lesson_rows) if (i, slot_index) in variables and other.class_id == req.class_id]
            if group:
                model.Add(sum(group) <= 1)
            group = [variables[(i, slot_index)] for i, (other, _) in enumerate(lesson_rows) if (i, slot_index) in variables and other.teacher_id == req.teacher_id]
            if group:
                model.Add(sum(group) <= 1)
    penalties = []
    for lesson_index, (req, _) in enumerate(lesson_rows):
        for constraint in constraints:
            if constraint.get("kind") != "prefer_subject_period" or int(constraint.get("subject_id", -1)) != req.subject_id:
                continue
            preferred = [variables[(lesson_index, i)] for i, (_, period) in enumerate(slots) if period == int(constraint["period"]) and (lesson_index, i) in variables]
            assigned_preferred = model.NewBoolVar(f"preferred_{lesson_index}_{len(penalties)}")
            if preferred:
                model.Add(assigned_preferred == sum(preferred))
            else:
                model.Add(assigned_preferred == 0)
            penalty = model.NewIntVar(0, 1, f"penalty_{lesson_index}_{len(penalties)}")
            model.Add(penalty == 1 - assigned_preferred)
            penalties.append(penalty * max(1, int(constraint.get("weight", 1))))
    if penalties:
        model.Minimize(sum(penalties))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10
    status = solver.Solve(model)
    status_names = {
        cp_model.OPTIMAL: "OPTIMAL",
        cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE",
        cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }
    status_name = status_names.get(status, "UNKNOWN")
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        diagnostic = "No schedule satisfies the configured hard constraints." if status == cp_model.INFEASIBLE else "Solver did not find a solution before its search limit; infeasibility is not proven." if status == cp_model.UNKNOWN else "Solver rejected the model as invalid."
        return {"solver_status": status_name, "assignments": [], "errors": [diagnostic]}
    out = []
    for lesson_index, (req, _) in enumerate(lesson_rows):
        for slot_index, (day, period) in enumerate(slots):
            variable = variables.get((lesson_index, slot_index))
            if variable is not None and solver.Value(variable):
                out.append({"class_id": req.class_id, "subject_id": req.subject_id, "teacher_id": req.teacher_id, "day": day, "period": period})
    return {"solver_status": status_name, "assignments": out, "errors": []}
