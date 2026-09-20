import re
from decimal import Decimal, InvalidOperation
from pathlib import Path

from app.documents.parsers import parse_document

PIPELINE_VERSION = "rules-1"
FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)
CATEGORIES = ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")
LABELS = {
    "shipper": r"shipper(?:/exporter)?",
    "consignee": r"consignee|to the order of",
    "notify_party": r"notify party/intermediate consignee|notify party|notify",
    "port_of_loading": r"port of loading|load port|pol",
    "port_of_discharge": r"port of discharge|discharge port|pod",
    "container_count": r"no\. of containers(?: or packages)?|total containers|container count",
    "gross_weight_kg": r"(?:total\s+)?gross\s*(?:weight|wt)",
}
PATTERNS = {
    key: re.compile(
        r"^\s*(?P<label>(?:"
        + label
        + r")(?:\s*\([^)]*\)|[毛重■]+)*)(?:\s*[:|]\s*|\s+|$)(?P<value>.*)$",
        re.I | re.S,
    )
    for key, label in LABELS.items()
}
MISSING = re.compile(r"^(?:N/?A|TBA|TBD|NONE|NULL|[-_?\s]*)$", re.I)


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


def detect_role(units: list[dict]) -> str | None:
    title = "\n".join(u["text"] for u in units[:4]).upper()
    if re.search(r"COMMERCIAL INVOICE|PACKING LIST|CERTIFICATE OF ORIGIN", title):
        return "other"
    instruction = bool(
        re.search(r"SHIPPING INSTRUCTION|(?:BILL OF LADING|B/?L) INSTRUCTION", title)
    )
    bill = bool(re.search(r"BILL OF LADING(?!\s+INSTRUCTION)", title))
    if instruction and not bill:
        return "si"
    if bill and not instruction:
        return "bl"
    return None


# Bounded aliases observed in the provided source documents, not a port-code authority.
PORT_LABELS = {
    "INNSA": "NHAVA SHEVA, INDIA",
    "GNCKY": "CONAKRY, GUINEA",
    "NGAPP": "APAPA, NIGERIA",
    "JOAQB": "AQABA, JORDAN",
    "ILASH": "ASHDOD, ISRAEL",
    "USBAL": "BALTIMORE, US",
    "AUBNE": "BRISBANE, AUSTRALIA",
    "IDBUA": "BUATAN, INDONESIA",
    "KRPUS": "BUSAN, SOUTH KOREA",
    "PECLL": "CALLAO, PERU",
    "PHCEB": "CEBU, PHILIPPINES",
    "AUFRE": "FREMANTLE, AUSTRALIA",
    "PLGDN": "GDANSK, POLAND",
    "VNSGN": "HOCHIMINH CITY, VIETNAM",
    "USHOU": "HOUSTON, US",
    "AEJEA": "JEBEL ALI, UAE",
    "PKKHI": "KARACHI, PAKISTAN",
    "LTKLJ": "KLAIPEDA, LITHUANIA",
    "SIKOP": "KOPER, SLOVENIA",
    "USLGB": "LONG BEACH, US",
    "TRMER": "MERSIN, TURKEY",
    "KEMBA": "MOMBASA, KENYA",
    "CNNTG": "NANTONG, CHINA",
    "USNYC": "NEW YORK, US",
    "KRPTK": "PYEONGTAEK, SOUTH KOREA",
    "MYPKG": "PORT KLANG (WESTPORT), MALAYSIA",
    "USSAV": "SAVANNAH, US",
    "SGSIN": "SINGAPORE",
    "CLVAP": "VALPARAISO, CHILE",
    "MMRGN": "YANGON, MYANMAR",
}


def normalize(key: str, raw: str, label: str) -> tuple[str | None, str]:
    text = re.sub(r"\s+", " ", raw).strip().upper()
    if MISSING.fullmatch(text):
        return None, "missing_value"
    if "FORMULA RESULT UNAVAILABLE" in text:
        return None, "formula_result_unavailable"
    if key == "container_count":
        match = re.fullmatch(r"(\d+)\s*(?:[X×]\s*\d{2}\s*['’]?\s*[A-Z]+)?", text)
        if not match or ("packages" in label.lower() and not re.search(r"[X×]", text)):
            return None, "ambiguous_container_count"
        return str(int(match[1])), "explicit_container_count"
    if key == "gross_weight_kg":
        match = re.fullmatch(
            r"(\d+(?:,\d{3})*(?:\.\d+)?)\s*(KG[S]?|KILOGRAMS?|MTS?|TONNES?)?", text
        )
        if not match:
            return None, "ambiguous_weight"
        numeric, unit = match.groups()
        if "," in numeric and not re.fullmatch(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?", numeric):
            return None, "ambiguous_weight"
        if not unit:
            found = re.search(r"\b(KGS?|KILOGRAMS?|MTS?|TONNES?)\b", label.upper())
            unit = found[1] if found else None
        if not unit:
            return None, "weight_unit_required"
        try:
            value = Decimal(numeric.replace(",", ""))
            if unit in {"MT", "MTS", "TONNE", "TONNES"}:
                value *= 1000
            canonical = format(value, "f")
            if "." in canonical:
                canonical = canonical.rstrip("0").rstrip(".")
            return canonical, "explicit_weight_unit_to_kg"
        except InvalidOperation:
            return None, "ambiguous_weight"
    if key in {"port_of_loading", "port_of_discharge"}:
        match = re.fullmatch(r"(.+)\s+\(([A-Z]{5})\)", text)
        if match and PORT_LABELS.get(match[2]) == match[1]:
            return match[1], "documented_port_label_alias"
    return text, "whitespace_and_case"


def empty_value(state: str = "MISSING", reason: str = "missing_value") -> dict:
    return {
        "raw_value": None,
        "normalized_value": None,
        "value_state": state,
        "method": "rule",
        "requires_human_confirmation": True,
        "reason": reason,
        "evidence": [],
    }


def extract(units: list[dict], key: str) -> dict:
    candidates = []
    for unit in units:
        matched = PATTERNS[key].match(unit["text"])
        if not matched:
            continue
        label, raw = matched.group("label", "value")
        # The first line/cell segment holds the party name, not its address.
        raw = raw.split("\n")[0].split(" | ")[0].strip()
        if not raw:
            continue
        canonical, rule = normalize(key, raw, label)
        state = (
            "PRESENT"
            if canonical is not None
            else ("MISSING" if rule == "missing_value" else "AMBIGUOUS")
        )
        candidates.append(
            {
                "raw_value": raw,
                "normalized_value": canonical,
                "value_state": state,
                "method": "rule",
                "requires_human_confirmation": state != "PRESENT",
                "reason": rule,
                "evidence": [{**unit, "excerpt": unit["text"], "verified": True}],
                "total": label.strip().lower().startswith("total"),
            }
        )
    if key == "gross_weight_kg" and any(c["total"] for c in candidates):
        candidates = [c for c in candidates if c["total"]]
    if not candidates:
        return empty_value()
    for candidate in candidates:
        candidate.pop("total")
    if len({(c["normalized_value"], c["value_state"]) for c in candidates}) != 1:
        return {
            **empty_value("AMBIGUOUS", "conflicting_source_values"),
            "evidence": [e for c in candidates for e in c["evidence"]],
        }
    return candidates[0]


def analyze(email: dict, documents: list[dict]) -> dict:
    classification = classify(email["subject"], email["body"])
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
    if classification["category"] is None:
        result["workflow_state"] = "REVIEW_REQUIRED"
        result["review_requirements"].append(
            {"code": "classification_review", "message": classification["reason"]}
        )
        return result
    if classification["category"] != "BL_COMPARISON":
        return result
    requirements = result["review_requirements"]
    for doc in documents:
        parsed = parse_document(Path(doc["path"]), doc["filename"], doc["id"])
        role = detect_role(parsed["units"]) if parsed["state"] == "PARSED" else None
        result["documents"].append({"id": doc["id"], "role": role, **parsed})
        if parsed["error"]:
            requirements.append({**parsed["error"], "document_id": doc["id"]})
        elif role == "other":
            requirements.append(
                {
                    "code": "wrong_doc_type",
                    "document_id": doc["id"],
                    "message": "This attachment is not an SI or draft BL.",
                }
            )
        elif role is None:
            requirements.append(
                {
                    "code": "document_role_required",
                    "document_id": doc["id"],
                    "message": "Document role could not be established from its content.",
                }
            )
    selected = {}
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
    if len(documents) < 2:
        requirements.append(
            {
                "code": "missing_attachment",
                "message": "Waiting for both SI and draft BL attachments.",
            }
        )
    for key in FIELDS:
        sides = {
            role: extract(selected[role]["units"], key)
            if role in selected
            else empty_value("UNREADABLE", "source_not_selected")
            for role in ("si", "bl")
        }
        if all(side["value_state"] == "PRESENT" for side in sides.values()):
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
