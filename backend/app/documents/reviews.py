"""Pure human-review overlays over immutable machine analysis results."""

from copy import deepcopy


def apply_review_overlay(machine_result: dict, actions: list[dict]) -> tuple[dict, dict]:
    reviewed = deepcopy(machine_result)
    latest = {}
    for action in actions:
        latest[(action["document_id"], action["field"])] = action

    documents = {item["id"]: item for item in reviewed.get("documents", [])}
    total = confirmed = corrected = supplied = 0
    for field in reviewed.get("fields", []):
        for role in ("si", "bl"):
            extraction = field[role]
            document = next((item for item in documents.values() if item["role"] == role), None)
            action = latest.get((document["id"], field["key"])) if document else None
            if action and action["action"] == "SUPPLY_INFORMATION":
                extraction["supplied_information"] = action
                supplied += 1
            mandatory = extraction.get("requires_human_confirmation", False) and extraction.get(
                "method"
            ) in {"gemini_vision", "gemini_text"}
            if mandatory:
                total += 1
            if not action:
                continue
            effective = deepcopy(extraction)
            if action["action"] == "CORRECT_EXTRACTION":
                unit = next(
                    (
                        item
                        for item in document.get("units", [])
                        if item.get("id") == action["unit_id"]
                    ),
                    None,
                )
                visual = extraction.get("method") == "gemini_vision"
                effective.update(
                    raw_value=action["raw_value"],
                    normalized_value=action["normalized_value"],
                    value_state="PRESENT",
                    method="human",
                    requires_human_confirmation=False,
                    reason="human_visual_correction" if visual else "human_text_correction",
                    evidence=[
                        {
                            **({k: v for k, v in unit.items() if k != "text"} if unit else {}),
                            "unit_id": action["unit_id"],
                            "id": action["unit_id"],
                            "document_id": action["document_id"],
                            "page": action["page"],
                            "excerpt": action["raw_value"],
                            "verified": not visual,
                            "verification_source": "human_visual" if visual else "source_text",
                        }
                    ],
                )
                if mandatory:
                    corrected += 1
            elif action["action"] == "CONFIRM_CANDIDATE" and mandatory:
                effective.update(
                    requires_human_confirmation=False,
                    reason="human_confirmed_visual_candidate",
                    evidence=[
                        {**item, "verified": False, "verification_source": "human_visual"}
                        for item in extraction.get("evidence", [])
                    ],
                )
                confirmed += 1
            else:
                continue
            effective["review"] = action
            field[role] = effective

    value_actions = any(
        action.get("action") in {"CONFIRM_CANDIDATE", "CORRECT_EXTRACTION"}
        for action in latest.values()
    )
    if total == 0 and not value_actions:
        return reviewed, {
            "total": 0,
            "reviewed": 0,
            "confirmed": 0,
            "corrected": 0,
            "supplied": supplied,
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
        if latest.get(key, {}).get("action") == "CORRECT_EXTRACTION":
            continue
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
        "supplied": supplied,
        "pending": total - confirmed - corrected,
    }
    return reviewed, progress


def completion_eligibility(reviewed_result: dict | None, actions: list[dict], run: dict) -> dict:
    """Return stable blockers for acknowledging one immutable seven-field run."""
    blockers = []

    def block(code, message):
        if not any(item["code"] == code for item in blockers):
            blockers.append({"code": code, "message": message})

    if (
        not reviewed_result
        or reviewed_result.get("classification", {}).get("category") != "BL_COMPARISON"
    ):
        block("not_comparison", "This run is not a completed SI and draft-BL comparison.")
    document_ids = set(run.get("document_ids") or [])
    if (
        not run.get("current_si_id")
        or not run.get("current_bl_id")
        or not {
            run.get("current_si_id"),
            run.get("current_bl_id"),
        }.issubset(document_ids)
    ):
        block("missing_documents", "Both current SI and draft-BL sources are required.")
    fields = reviewed_result.get("fields", []) if reviewed_result else []
    if (
        not reviewed_result
        or reviewed_result.get("coverage") != {"checked": 7, "total": 7}
        or len(fields) != 7
    ):
        block("incomplete_coverage", "All seven fields must be checked.")
    if reviewed_result and any(item.get("finding") != "MATCH" for item in fields):
        block("unresolved_findings", "Every field must have a confirmed match.")
    if reviewed_result and reviewed_result.get("known_defect_fields"):
        block("discrepancies", "Resolve every discrepancy before completing the check.")
    if reviewed_result and reviewed_result.get("review_requirements"):
        block("pending_review", "Resolve every pending review requirement.")
    if any(
        extraction.get("requires_human_confirmation")
        for item in fields
        for extraction in (item.get("si", {}), item.get("bl", {}))
    ):
        block("pending_candidates", "Confirm or correct every visual candidate.")
    latest = {}
    for action in actions:
        latest[(action["document_id"], action["field"])] = action
    if any(item.get("action") == "SUPPLY_INFORMATION" for item in latest.values()):
        block(
            "supplied_information_unverified",
            "Replace the source document to verify externally supplied information.",
        )
    return {"eligible": not blockers, "blockers": blockers}
