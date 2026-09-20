"""Email classification and comparison over the shared extraction contract."""

import re
from pathlib import Path

from app.extraction import extract_document
from app.extraction.models import FIELD_KEYS

PIPELINE_VERSION = "mailbox-shared-2"
FIELDS = FIELD_KEYS
CATEGORIES = ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")


def classify(subject: str, body: str) -> dict:
    # Ignore quoted threads, signatures, and the external-sender banner.
    primary = re.split(
        r"(?im)^\s*(?:_{5,}|-{5,}|from:|on .+ wrote:|best regards|kind regards|warm regards)",
        body,
    )[0]
    primary = re.sub(r"(?im)^WARNING:.*$", "", primary)
    subject = re.sub(r"^(?:(?:RE|FW|FWD)\s*[:_]\s*)+", "", subject, flags=re.I)
    # Requests to create an SI may mention a future BL without requesting comparison.
    primary = re.sub(r"(?im)^Please revert with draft BL once available\.\s*$", "", primary)
    text = subject + "\n" + primary
    # A completed billing notification is not an invoice query.
    text = re.sub(
        r"(?i)billing process(?: for [^\n]+?)? (?:has )?completed", "process completed", text
    )
    signals = {
        "BL_COMPARISON": r"\b(?:draft\s+(?:bl|bill of lading)|bl\s+draft|compare\s+the\s+si|"
        r"to confirm docs|verify the bl)\b",
        "SI_REQUEST": r"\b(?:request si|cust si|si needed|please find shipping instruction)\b|"
        r"^SI\s*-",
        "INVOICE_QUERY": r"\b(?:billing|cancel invoice|query on invoice|local charges|"
        r"telex release charges|total freight|d\s*&\s*d charges|missing gr)\b",
        "GENERAL": r"\b(?:update summary|berthing report|sla|holiday|office resumes|"
        r"new year|team meeting|maintenance|staff announcement)\b|_RPA_",
        "SPAM": r"\b(?:congratulations|claim.{0,30}prize|gift card|bitcoin|"
        r"guaranteed.{0,15}returns|"
        r"storage is full|mailbox.{0,15}full|verify account|undelivered messages|"
        r"unpaid customs fee|bank details|limited time offer|weird trick|you have won)\b",
    }
    matches = [category for category, pattern in signals.items() if re.search(pattern, text, re.I)]
    category = matches[0] if len(matches) == 1 else None
    return {
        "category": category,
        "method": "rule",
        "matched_categories": matches,
        "status": "CLASSIFIED" if category else "NEEDS_REVIEW",
        "reason": "Matched explicit email intent."
        if category
        else "Needs classification review: rules are inconclusive or conflicting.",
    }


def locator(unit: dict) -> str:
    if unit.get("page"):
        return f"Page {unit['page']}"
    if unit.get("sheet"):
        return f"{unit['sheet']}!{unit['cell']}"
    if unit.get("table"):
        return f"Table {unit['table']}, row {unit['row']}, cell {unit['column']}"
    if unit.get("paragraph"):
        return f"Paragraph {unit['paragraph']}"
    return f"Line {unit['line']}"


def empty_value(state="MISSING", reason="missing_value"):
    return dict(
        raw_value=None,
        normalized_value=None,
        value_state=state,
        method="rule",
        requires_human_confirmation=True,
        reason=reason,
        evidence=[],
    )


def adapt_document(document: dict) -> dict:
    """Keep mailbox response names; values and evidence come only from extraction."""
    extracted = document.get("result")
    units = [
        {**unit, "id": unit["unit_id"], "locator": locator(unit)}
        for unit in (extracted or {}).get("source_units", document.get("source_units", []))
    ]
    by_id = {unit["id"]: unit for unit in units}
    values = {}
    for field in (extracted or {}).get("fields", []):
        problems = [i for i in extracted["issues"] if i.get("field") == field["field"]]
        evidence = []
        for ref in field["evidence"]:
            unit = by_id[ref["unit_id"]]
            if ref["document_id"] != document["document_id"] or ref["excerpt"] not in unit["text"]:
                raise ValueError("Shared extraction returned invalid source evidence")
            evidence.append({**unit, **ref})
        values[field["field"]] = {
            **field,
            "evidence": evidence,
            "reason": ", ".join(i["code"] for i in problems) or "shared_extractor",
        }
    role = (extracted or {}).get("detected_role")
    issues = (extracted or {}).get("issues", [])
    if not role and any(i["code"] == "WRONG_DOCUMENT_TYPE" for i in issues):
        role = "other"
    error = document.get("error")
    if not error and extracted and extracted["parsing_status"] != "READABLE":
        error = next(iter(issues), None)
    return {
        "id": document["document_id"],
        "role": role.lower() if role else None,
        "state": "PARSED"
        if extracted and extracted["parsing_status"] == "READABLE"
        else "UNREADABLE",
        "units": units,
        "error": error,
        "values": values,
        "extraction": extracted,
    }


def compare(classification: dict, documents: list[dict], emit=None) -> dict:
    result = {
        "classification": classification,
        "documents": [],
        "fields": [],
        "review_requirements": [],
        "known_defect_fields": [],
        "coverage": {"checked": 0, "total": 7},
        "workflow_state": "NOT_APPLICABLE",
        "processing_status": "SUCCEEDED",
    }
    requirements = result["review_requirements"]
    if classification["category"] is None:
        result["workflow_state"] = "REVIEW_REQUIRED"
        requirements.append({"code": "classification_review", "message": classification["reason"]})
        return result
    if classification["category"] != "BL_COMPARISON":
        return result
    selected = {}
    for document in documents:
        adapted = adapt_document(document)
        result["documents"].append(adapted)
        if adapted["error"]:
            requirements.append({**adapted["error"], "document_id": adapted["id"]})
        for issue in (adapted["extraction"] or {}).get("issues", []):
            if issue != adapted["error"]:
                requirements.append({**issue, "document_id": adapted["id"]})
    for role in ("si", "bl"):
        options = [d for d in result["documents"] if d["role"] == role]
        if len(options) == 1:
            selected[role] = options[0]
        elif len(options) > 1:
            requirements.append(
                {
                    "code": "ambiguous_document_pair",
                    "message": f"Multiple {role.upper()} documents require pair selection.",
                }
            )
    if emit:
        emit(
            "pair_selection",
            "SUCCEEDED" if len(selected) == 2 else "NEEDS_REVIEW",
            "SI and BL document roles checked for a unique pair.",
            selected_document_ids={role: doc["id"] for role, doc in selected.items()},
            rule="unique_document_per_role",
        )
    if len(documents) < 2:
        requirements.append(
            {
                "code": "missing_attachment",
                "message": "Waiting for both SI and draft BL attachments.",
            }
        )
    for key in FIELDS:
        sides = {
            role: selected[role]["values"].get(
                key, empty_value("UNREADABLE", "source_not_selected")
            )
            if role in selected
            else empty_value("UNREADABLE", "source_not_selected")
            for role in ("si", "bl")
        }
        if all(
            v["value_state"] == "PRESENT" and not v["requires_human_confirmation"]
            for v in sides.values()
        ):
            finding = (
                "MATCH"
                if sides["si"]["normalized_value"] == sides["bl"]["normalized_value"]
                else "MISMATCH"
            )
            result["coverage"]["checked"] += 1
        else:
            finding = "NEEDS_REVIEW" if documents else "NOT_CHECKED"
        if finding == "MISMATCH":
            result["known_defect_fields"].append(key)
        result["fields"].append({"key": key, **sides, "finding": finding})
        if emit:
            emit(
                "comparison",
                "SUCCEEDED" if finding == "MATCH" else "NEEDS_REVIEW",
                f"{key.replace('_', ' ').capitalize()}: {finding.replace('_', ' ').lower()}.",
                field=key,
                finding=finding,
                rule="exact_normalized_values_with_verified_evidence",
                si=sides["si"],
                bl=sides["bl"],
            )
    if any(f["finding"] == "NEEDS_REVIEW" for f in result["fields"]):
        requirements.append(
            {
                "code": "unresolved_fields",
                "message": "Some fields need readable evidence, explicit units, or missing values.",
            }
        )
    if len(documents) < 2:
        result["workflow_state"] = "WAITING_DOCUMENT"
    elif requirements:
        result["workflow_state"] = "REVIEW_REQUIRED"
    elif result["known_defect_fields"]:
        result["workflow_state"] = "DISCREPANCIES_FOUND"
    else:
        result["workflow_state"] = "READY"
    return result


def analyze(email: dict, documents: list[dict]) -> dict:
    """In-process convenience; persisted mailbox runs use the bounded run service."""
    classification = classify(email["subject"], email["body"])
    results = []
    if classification["category"] == "BL_COMPARISON":
        for doc in documents:
            result = extract_document(Path(doc["path"]).read_bytes(), doc["filename"], doc["id"])
            results.append({"document_id": doc["id"], "result": result.model_dump(mode="json")})
    return compare(classification, results)
