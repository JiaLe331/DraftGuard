"""Deterministic facts for amendment email drafts."""

import hashlib
import json

from app.extraction.models import FIELD_KEYS

FIELD_LABELS = {
    "shipper": "Shipper",
    "consignee": "Consignee",
    "notify_party": "Notify party",
    "port_of_loading": "Port of loading",
    "port_of_discharge": "Port of discharge",
    "container_count": "Container count",
    "gross_weight_kg": "Gross weight",
}


def _display(extraction: dict) -> str:
    return extraction.get("raw_value") or "Missing"


def _field_item(field: dict, role: str) -> dict | None:
    extraction = field[role]
    label = FIELD_LABELS[field["key"]]
    supplied = extraction.get("supplied_information")
    if supplied:
        return {
            "id": f"{field['key']}:{role}:supplied_information",
            "field": field["key"],
            "field_label": label,
            "kind": "supplied_information",
            "source_role": role,
            "si_value": _display(field["si"]),
            "bl_value": _display(field["bl"]),
            "summary": f"{label} is supported only by unverified external information.",
            "requested_action": (
                f"Provide a revised {role.upper()} that states this value in the source document."
            ),
        }
    if extraction.get("requires_human_confirmation"):
        return {
            "id": f"{field['key']}:{role}:pending_review",
            "field": field["key"],
            "field_label": label,
            "kind": "pending_review",
            "source_role": role,
            "si_value": None,
            "bl_value": None,
            "summary": f"{label} in the {role.upper()} is not yet source-confirmed.",
            "requested_action": (
                f"Clarify {label.lower()} or provide a clearer revised {role.upper()} source."
            ),
        }
    state = extraction.get("value_state")
    if state == "PRESENT":
        return None
    kind = {
        "MISSING": "missing_value",
        "UNREADABLE": "unreadable",
        "AMBIGUOUS": "ambiguous",
    }.get(state, "pending_review")
    state_copy = {
        "missing_value": "is missing",
        "unreadable": "could not be read reliably",
        "ambiguous": "is ambiguous",
        "pending_review": "still requires review",
    }[kind]
    action = (
        f"Provide a revised draft BL with a clear {label.lower()} value."
        if role == "bl"
        else f"Provide a corrected SI or written clarification for {label.lower()}."
    )
    return {
        "id": f"{field['key']}:{role}:{kind}",
        "field": field["key"],
        "field_label": label,
        "kind": kind,
        "source_role": role,
        "si_value": _display(field["si"]) if role == "bl" else "Missing",
        "bl_value": _display(field["bl"]) if role == "si" else "Missing",
        "summary": f"{label} in the {role.upper()} {state_copy}.",
        "requested_action": action,
    }


def build_issue_items(reviewed_result: dict) -> list[dict]:
    """Build ordered external-facing facts without treating AI candidates as facts."""
    fields = {item["key"]: item for item in reviewed_result.get("fields", [])}
    items = []
    for key in FIELD_KEYS:
        field = fields.get(key)
        if not field:
            continue
        has_unconfirmed_source = any(
            field[role].get("supplied_information")
            or field[role].get("requires_human_confirmation")
            or field[role].get("value_state") != "PRESENT"
            for role in ("si", "bl")
        )
        if field.get("finding") == "MISMATCH" and not has_unconfirmed_source:
            label = FIELD_LABELS[key]
            items.append(
                {
                    "id": f"{key}:mismatch",
                    "field": key,
                    "field_label": label,
                    "kind": "mismatch",
                    "source_role": "bl",
                    "si_value": _display(field["si"]),
                    "bl_value": _display(field["bl"]),
                    "summary": f"{label} differs between the SI and draft BL.",
                    "requested_action": "Revise the draft BL to match the confirmed SI value.",
                }
            )
            continue
        for role in ("si", "bl"):
            item = _field_item(field, role)
            if item:
                items.append(item)

    represented_fields = {item["field"] for item in items if item.get("field")}
    seen = {item["id"] for item in items}
    for problem in reviewed_result.get("review_requirements", []):
        if problem.get("code") == "unresolved_fields" or problem.get("field") in represented_fields:
            continue
        identifier = f"requirement:{problem.get('code', 'review')}:{problem.get('document_id', '')}"
        if identifier in seen:
            continue
        seen.add(identifier)
        items.append(
            {
                "id": identifier,
                "field": problem.get("field"),
                "field_label": FIELD_LABELS.get(problem.get("field"), "Source document"),
                "kind": "document_requirement",
                "source_role": None,
                "si_value": None,
                "bl_value": None,
                "summary": problem.get("message") or "A source document requires attention.",
                "requested_action": problem.get("next_action")
                or "Provide a corrected or clearer source document.",
            }
        )
    return items


def facts_hash(items: list[dict]) -> str:
    payload = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def standard_wording(original_subject: str) -> dict:
    return {
        "subject": f"Revision requested: {original_subject}"[:500],
        "opening": (
            "Hello,\n\nWe reviewed the shipping instruction and draft bill of lading. "
            "Please address the items below before sending the next draft."
        ),
        "closing": "Thank you. Please send the revised source documents for another check.",
    }
