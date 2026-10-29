import re
import unicodedata


def normalize_answer(value: str) -> str:
    """Case-fold, remove punctuation/symbols, and collapse whitespace for literal comparison."""
    folded = unicodedata.normalize("NFKC", value).casefold()
    normalized = "".join(" " if unicodedata.category(char)[0] in {"P", "S"} else char for char in folded)
    return " ".join(normalized.split())


def option_label(value: str) -> str | None:
    normalized = normalize_answer(value)
    match = re.fullmatch(r"(?:option\s+)?([a-z]|[0-9]{1,2})", normalized)
    return match.group(1) if match else None


def contains_phrase(answer: str, phrase: str) -> bool:
    normalized_answer = normalize_answer(answer)
    normalized_phrase = normalize_answer(phrase)
    if not normalized_answer or not normalized_phrase:
        return False
    return f" {normalized_phrase} " in f" {normalized_answer} "


def suggest_marks(question: dict, answer: str) -> dict:
    """Return a deterministic suggestion; lexical matching always requires teacher review."""
    max_marks = int(question["max_marks"])
    key = question["answer_key_snapshot"]
    question_type = question["question_type"]

    if question_type == "multiple_choice":
        expected = option_label(key.get("answer_reference", ""))
        submitted = option_label(answer)
        if expected is None:
            return {
                "suggested_marks": None,
                "suggestion_method": "manual_review_required",
                "suggestion_justification": {
                    "message": "The answer reference does not identify one unambiguous option label.",
                    "submitted_option": answer.strip(),
                    "answer_reference": key.get("answer_reference", ""),
                },
                "requires_teacher_review": True,
            }
        awarded = max_marks if submitted is not None and submitted == expected else 0
        return {
            "suggested_marks": awarded,
            "suggestion_method": "exact_option_label",
            "suggestion_justification": {
                "submitted_option": answer.strip() or None,
                "correct_option": expected,
                "matched": awarded > 0,
            },
            "requires_teacher_review": True,
        }

    if question_type == "short_answer":
        points = [point.strip() for point in key.get("expected_points", []) if point.strip()]
        if not points:
            return {
                "suggested_marks": None,
                "suggestion_method": "manual_review_required",
                "suggestion_justification": {
                    "message": "No structured expected points are configured for this question.",
                    "matched_points": [],
                    "missing_points": [],
                },
                "requires_teacher_review": True,
            }
        variants = key.get("accepted_variants", {})
        matched: list[str] = []
        missing: list[str] = []
        phrase_owners: dict[str, int] = {}
        for point_index, point in enumerate(points):
            phrases = [point, *variants.get(point, [])]
            normalized_phrases = {normalize_answer(item) for item in phrases if normalize_answer(item)}
            ambiguous = any(phrase in phrase_owners and phrase_owners[phrase] != point_index for phrase in normalized_phrases)
            for phrase in normalized_phrases:
                phrase_owners.setdefault(phrase, point_index)
            if ambiguous:
                return {
                    "suggested_marks": None,
                    "suggestion_method": "manual_review_required",
                    "suggestion_justification": {
                        "message": "Configured expected points or accepted variants overlap; teacher review is required.",
                        "matched_points": [],
                        "missing_points": points,
                    },
                    "requires_teacher_review": True,
                }
            (matched if any(contains_phrase(answer, phrase) for phrase in phrases) else missing).append(point)
        suggested = round(max_marks * len(matched) / len(points), 2)
        return {
            "suggested_marks": min(float(max_marks), suggested),
            "suggestion_method": "expected_point_literal_match",
            "suggestion_justification": {
                "matched_points": matched,
                "missing_points": missing,
                "message": "Literal text matching is a review aid, not proof of academic correctness.",
            },
            "requires_teacher_review": True,
        }

    return {
        "suggested_marks": None,
        "suggestion_method": "teacher_entry_required",
        "suggestion_justification": {
            "answer_reference": key.get("answer_reference", ""),
            "marking_notes": key.get("marking_notes", ""),
            "message": "Long answers require teacher judgment; no automatic marks were assigned.",
        },
        "requires_teacher_review": True,
    }
