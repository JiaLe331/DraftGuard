"""Pure human-review overlays over immutable machine analysis results."""

from copy import deepcopy


def apply_review_overlay(machine_result: dict, actions: list[dict]) -> tuple[dict, dict]:
    reviewed = deepcopy(machine_result)
    latest = {}
    for action in actions:
        latest[(action["document_id"], action["field"])] = action

    documents = {item["id"]: item for item in reviewed.get("documents", [])}
    total = confirmed = corrected = 0
    for field in reviewed.get("fields", []):
        for role in ("si", "bl"):
            extraction = field[role]
            if extraction.get("method") != "gemini_vision":
                continue
            total += 1
            document = next((item for item in documents.values() if item["role"] == role), None)
            action = latest.get((document["id"], field["key"])) if document else None
            if not action:
                continue
            effective = deepcopy(extraction)
            if action["action"] == "CORRECT_EXTRACTION":
                unit = next(
                    (
                        item
                        for item in document.get("units", [])
                        if item.get("page") == action["page"]
                    ),
                    None,
                )
                effective.update(
                    raw_value=action["raw_value"],
                    normalized_value=action["normalized_value"],
                    value_state="PRESENT",
                    method="human",
                    requires_human_confirmation=False,
                    reason="human_visual_correction",
                    evidence=[
                        {
                            **({k: v for k, v in unit.items() if k != "text"} if unit else {}),
                            "unit_id": action["unit_id"],
                            "id": action["unit_id"],
                            "document_id": action["document_id"],
                            "page": action["page"],
                            "excerpt": action["raw_value"],
                            "verified": False,
                            "verification_source": "human_visual",
                        }
                    ],
                )
                corrected += 1
            else:
                effective.update(
                    requires_human_confirmation=False,
                    reason="human_confirmed_visual_candidate",
                    evidence=[
                        {**item, "verified": False, "verification_source": "human_visual"}
                        for item in extraction.get("evidence", [])
                    ],
                )
                confirmed += 1
            effective["review"] = action
            field[role] = effective

    if total == 0:
        return reviewed, {
            "total": 0,
            "reviewed": 0,
            "confirmed": 0,
            "corrected": 0,
            "pending": 0,
        }

    checked = 0
    defects = []
    for field in reviewed.get("fields", []):
        sides = [field["si"], field["bl"]]
        if all(
            item["value_state"] == "PRESENT" and not item.get("requires_human_confirmation", False)
            for item in sides
        ):
            field["finding"] = (
                "MATCH"
                if field["si"]["normalized_value"] == field["bl"]["normalized_value"]
                else "MISMATCH"
            )
            checked += 1
        else:
            field["finding"] = "NEEDS_REVIEW"
        if field["finding"] == "MISMATCH":
            defects.append(field["key"])

    pending_keys = {
        (document["id"], field["key"])
        for field in reviewed.get("fields", [])
        for role in ("si", "bl")
        if field[role].get("requires_human_confirmation")
        for document in reviewed.get("documents", [])
        if document.get("role") == role
    }
    requirements = []
    for item in machine_result.get("review_requirements", []):
        key = (item.get("document_id"), item.get("field"))
        if item.get("code") in {"AI_CONFIRMATION_REQUIRED", "AI_CANDIDATE_MISSING"}:
            if key not in pending_keys:
                continue
        if item.get("code") == "unresolved_fields":
            continue
        requirements.append(deepcopy(item))
    if checked < 7:
        requirements.append(
            {
                "code": "unresolved_fields",
                "message": "Some fields still require source-backed human review.",
            }
        )

    reviewed["coverage"] = {"checked": checked, "total": 7}
    reviewed["known_defect_fields"] = defects
    reviewed["review_requirements"] = requirements
    if any(field["finding"] == "NEEDS_REVIEW" for field in reviewed.get("fields", [])):
        reviewed["workflow_state"] = "REVIEW_REQUIRED"
    elif requirements:
        reviewed["workflow_state"] = "REVIEW_REQUIRED"
    elif defects:
        reviewed["workflow_state"] = "DISCREPANCIES_FOUND"
    else:
        reviewed["workflow_state"] = "READY"
    progress = {
        "total": total,
        "reviewed": confirmed + corrected,
        "confirmed": confirmed,
        "corrected": corrected,
        "pending": total - confirmed - corrected,
    }
    return reviewed, progress
