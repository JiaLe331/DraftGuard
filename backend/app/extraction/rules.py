"""Bounded label/layout rules. No filename, paired-document, or answer-key lookups."""

import re
from dataclasses import dataclass
from decimal import Decimal, localcontext

from .models import (
    FIELD_KEYS,
    Evidence,
    ExtractionIssue,
    FieldExtraction,
    FieldKey,
    Locator,
    SourceUnit,
)
from .trace import Trace

ALIASES: dict[FieldKey, set[str]] = {
    "shipper": {"SHIPPER", "SHIPPER EXPORTER", "SHIPPER PRINCIPAL OR SELLER"},
    "consignee": {"CONSIGNEE", "CONSIGNEE NON NEGOTIABLE", "TO THE ORDER OF"},
    "notify_party": {"NOTIFY", "NOTIFY PARTY", "NOTIFY PARTY INTERMEDIATE CONSIGNEE"},
    "port_of_loading": {"POL", "LOAD PORT", "PORT OF LOADING", "PORT OF LOADING POL"},
    "port_of_discharge": {"POD", "DISCHARGE PORT", "PORT OF DISCHARGE", "PORT OF DISCHARGE POD"},
    "container_count": {
        "CONTAINER COUNT",
        "TOTAL CONTAINERS",
        "NO OF CONTAINERS",
        "NO OF CONTAINERS OR PACKAGES",
        "NUMBER OF CONTAINERS",
    },
    "gross_weight_kg": {"GROSS WEIGHT", "GROSS WT", "TOTAL GROSS WEIGHT", "TOTAL GROSS WT"},
}
UNIT_PATTERN = re.compile(
    r"(?<![A-Za-z])(?:KILOGRAMS?|KGS?|GRAMS?|G|METRIC\s+TON(?:NE)?S?|TONNES?|MTS?|T)(?![A-Za-z])",
    re.I,
)
OTHER_LABEL = re.compile(
    r"^(?:B/?L\s+(?:NO|NUMBER)|BILL OF LADING NO|BOOKING|VESSEL|OCEAN VESSEL|VOY(?:AGE)?"
    r"|EXPORT CARRIER|COMMODITY|DESCRIPTION|KINDS OF PACKAGES|HS\s*CODE|OC\s+NO|ORDER"
    r"|FREIGHT|NET\s+WEIGHT|CONTAINER\s+NO|INVOICE|CERTIFICATE|SELLER|BUYER|PAYMENT"
    r"|INCOTERMS|COUNTRY OF ORIGIN|ISSUING AUTHORITY|TOTAL AMOUNT)\b",
    re.I,
)
ADDRESS = re.compile(
    r"^(?:\d|#|P\.?\s*O\.?\s*BOX\b|TEL\b|FAX\b|EMAIL\b|E-MAIL\b|ADDRESS\b)"
    r"|\b(?:BLDG|BUILDING|INDUSTRIAL ZONE|AMENITY CENTER)\b"
    r"|(?=.*\d).*\b(?:ROAD|STREET|AVENUE)\b",
    re.I,
)
COMPANY_SUFFIX = re.compile(r"\b(?:LTD|LLC|INC|BHD|PTE|LIMITED|CORPORATION)\b", re.I)
AGENCY = re.compile(r"^(?:ON BEHALF OF|AS AGENT(?:S)? FOR|C/?O)\b", re.I)
MISSING = re.compile(r"^(?:N\s*/?\s*A|TBA|TBD|NONE|NULL|NOT AVAILABLE|NOT PROVIDED|[-_\s]*)$", re.I)


def clean_label(text: str) -> str:
    text = re.sub(r"[^\x00-\x7f]", "", text)
    return " ".join(re.sub(r"[^A-Za-z0-9]+", " ", text).upper().split())


def identify_label(text: str) -> FieldKey | None:
    label = clean_label(text)
    for key, aliases in ALIASES.items():
        if label in aliases:
            return key
    # Weight labels may carry an explicit unit, including bilingual decorations.
    without_unit = clean_label(UNIT_PATTERN.sub("", text))
    if without_unit in ALIASES["gross_weight_kg"]:
        return "gross_weight_kg"
    return None


def split_label(text: str) -> tuple[FieldKey, str, str] | None:
    for separator in (r"[:：]", r"\t+| {2,}"):
        parts = re.split(separator, text.strip(), maxsplit=1)
        if len(parts) == 2 and (key := identify_label(parts[0])):
            return key, parts[0], parts[1]
    if key := identify_label(text):
        return key, text.strip(), ""
    return None


@dataclass
class Fragment:
    text: str
    unit: SourceUnit


@dataclass
class Candidate:
    key: FieldKey
    label: str
    raw: str
    units: list[SourceUnit]
    formula: bool = False
    explicit_total: bool = False
    container_table: bool = False


def candidates(units: list[SourceUnit]) -> dict[FieldKey, list[Candidate]]:
    found: dict[FieldKey, list[Candidate]] = {key: [] for key in FIELD_KEYS}
    grid = {(u.sheet, u.table, u.row, u.column): u for u in units if u.row is not None}
    for unit in units:
        if unit.row is None or unit.is_formula:
            continue
        parsed = split_label(unit.text)
        if not parsed:
            continue
        key, label, raw = parsed
        evidence = [unit]
        formula = False
        if not raw.strip():
            neighbor = grid.get((unit.sheet, unit.table, unit.row, unit.column + 1))
            if neighbor is not None and not split_label(neighbor.text):
                raw = neighbor.text
                formula = neighbor.is_formula
                evidence.append(neighbor)
        found[key].append(
            Candidate(
                key,
                label,
                raw,
                evidence,
                formula,
                explicit_total=clean_label(label).startswith("TOTAL "),
            )
        )

    fragments = [
        Fragment(line, unit)
        for unit in units
        if unit.row is None
        for line in unit.text.splitlines()
    ]
    index = 0
    while index < len(fragments):
        start = index
        current = fragments[index]
        parsed = split_label(current.text)
        label_units = [current.unit]
        if not parsed and index + 1 < len(fragments):
            combined = f"{current.text.strip()} {fragments[index + 1].text.strip()}"
            parsed = split_label(combined)
            if parsed:
                index += 1
                label_units.append(fragments[index].unit)
        if not parsed:
            index += 1
            continue
        key, label, raw = parsed
        values = [raw] if raw.strip() else []
        evidence = label_units.copy()
        end = index + 1
        while end < len(fragments):
            item = fragments[end]
            text = item.text.strip()
            next_label = split_label(text)
            if not next_label and end + 1 < len(fragments):
                next_label = split_label(f"{text} {fragments[end + 1].text.strip()}")
            if next_label or OTHER_LABEL.match(text) or _heading(text):
                break
            if text:
                values.append(item.text)
                evidence.append(item.unit)
            end += 1
        container_table = any(
            re.match(r"^CONTAINER\s+NO\b", clean_label(f.text))
            for f in fragments[max(0, start - 3) : start]
        )
        found[key].append(
            Candidate(
                key,
                label,
                "\n".join(values),
                evidence,
                explicit_total=clean_label(label).startswith("TOTAL "),
                container_table=container_table,
            )
        )
        index = end
    return found


def _heading(text: str) -> bool:
    return bool(
        re.match(
            r"^(?:SHIPPING INSTRUCTIONS?|BILL OF LADING|B/?L INSTRUCTIONS?|COMMERCIAL INVOICE"
            r"|PACKING LIST|CERTIFICATE OF ORIGIN)(?:\s|$)",
            text,
            re.I,
        )
    )


def detect_role(units: list[SourceUnit]):
    roles = set()
    other = False
    for unit in units:
        if unit.is_formula:
            continue
        for line in unit.text.splitlines():
            text = " ".join(line.strip().upper().split())
            if re.fullmatch(r"(?:SHIPPING|BILL OF LADING|B/?L) INSTRUCTIONS?", text):
                roles.add("SI")
            elif re.fullmatch(r"BILL OF LADING(?:\s*\(DRAFT\)|\s+DRAFT)?", text):
                roles.add("BL")
            elif re.fullmatch(r"(?:COMMERCIAL )?INVOICE|PACKING LIST|CERTIFICATE OF ORIGIN", text):
                other = True
    if len(roles) == 1 and not other:
        return next(iter(roles)), None
    if len(roles) > 1 or (roles and other):
        return None, "AMBIGUOUS_DOCUMENT_ROLE"
    return None, "WRONG_DOCUMENT_TYPE" if other else "UNKNOWN_DOCUMENT_ROLE"


def evidence_for(items: list[Candidate]) -> list[Evidence]:
    unique = {unit.unit_id: unit for item in items for unit in item.units}
    return [
        Evidence(
            **{key: getattr(unit, key) for key in Locator.model_fields},
            unit_id=unit.unit_id,
            document_id=unit.document_id,
            excerpt=unit.text,
        )
        for unit in unique.values()
    ]


def party_value(raw: str) -> tuple[str, str | None]:
    lines = [s.strip() for s in re.split(r"\n|\s+\|\s+|;", raw) if s.strip()]
    if not lines:
        return raw, "PARTY_BOUNDARY_UNCLEAR"
    identity = [lines[0]]
    for index, line in enumerate(lines[1:], 1):
        if AGENCY.match(line) or re.fullmatch(
            r"ON BEHALF OF|AS AGENTS? FOR", lines[index - 1], re.I
        ):
            identity.append(line)
        elif ADDRESS.search(line) and not COMPANY_SUFFIX.search(line):
            if any(
                AGENCY.match(tail) or COMPANY_SUFFIX.search(tail) for tail in lines[index + 1 :]
            ):
                return raw, "PARTY_BOUNDARY_UNCLEAR"
            break
        else:
            # Never silently discard another company name or guess a wrapped identity.
            return raw, "PARTY_BOUNDARY_UNCLEAR"
    if re.fullmatch(r"ON BEHALF OF|AS AGENTS? FOR", identity[-1], re.I):
        return raw, "PARTY_BOUNDARY_UNCLEAR"
    return "\n".join(identity), None


def _number(text: str) -> Decimal | None:
    if len(text) > 100:
        return None
    if not re.fullmatch(r"(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?", text):
        return None
    return Decimal(text.replace(",", ""))


def _decimal_string(number: Decimal) -> str:
    text = format(number, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def normalize(item: Candidate) -> tuple[str | None, str | None, str, str | None]:
    raw = item.raw.strip()
    if item.formula:
        return raw, None, "AMBIGUOUS", "FORMULA_VALUE"
    if MISSING.fullmatch(raw):
        return raw or None, None, "MISSING", "MISSING_VALUE"
    key = item.key
    normalized_text = raw
    if key in {"shipper", "consignee", "notify_party"}:
        normalized_text, problem = party_value(raw)
        if problem:
            return raw, None, "AMBIGUOUS", problem
    if key == "container_count":
        if len(raw) > 100:
            return raw, None, "AMBIGUOUS", "AMBIGUOUS_CONTAINER_COUNT"
        expression = re.fullmatch(
            r"(\d+)\s*[xX×]\s*(?:20|40|45)\s*['\u2019\u2032]?\s*(?:HC|HQ|FCL|GP|DC|RF|FT)?",
            raw,
            re.I,
        )
        if expression:
            return raw, str(int(expression[1])), "PRESENT", None
        if re.fullmatch(r"\d+", raw) and "PACKAGES" not in clean_label(item.label):
            return raw, str(int(raw)), "PRESENT", None
        return raw, None, "AMBIGUOUS", "AMBIGUOUS_CONTAINER_COUNT"
    if key == "gross_weight_kg":
        if item.container_table and not item.explicit_total:
            return raw, None, "AMBIGUOUS", "TOTAL_WEIGHT_REQUIRED"
        unit_names = [
            m.group().upper() for text in (item.label, raw) for m in UNIT_PATTERN.finditer(text)
        ]
        if not unit_names:
            return raw, None, "AMBIGUOUS", "MISSING_WEIGHT_UNIT"
        factors = {
            Decimal("1")
            if name.startswith("K")
            else Decimal("0.001")
            if name in {"G", "GRAM", "GRAMS"}
            else Decimal("1000")
            for name in unit_names
        }
        if len(factors) != 1:
            return raw, None, "AMBIGUOUS", "CONFLICTING_WEIGHT_UNITS"
        numeric = UNIT_PATTERN.sub("", raw).strip()
        number = _number(numeric)
        if number is None:
            return raw, None, "AMBIGUOUS", "AMBIGUOUS_WEIGHT"
        with localcontext() as context:
            context.prec = 110
            normalized = _decimal_string(number * next(iter(factors)))
        return raw, normalized, "PRESENT", None
    if key in {"port_of_loading", "port_of_discharge"} and len(raw.splitlines()) > 1:
        return raw, None, "AMBIGUOUS", "AMBIGUOUS_TEXT_VALUE"
    return raw, " ".join(normalized_text.upper().split()), "PRESENT", None


ISSUE_DETAILS = {
    "AMBIGUOUS_TEXT_VALUE": (
        "Multiple text lines cannot be established as one port value.",
        "Review the source and provide an unambiguous port value.",
    ),
    "FIELD_NOT_FOUND": (
        "No supported source label was located.",
        "Review the source or provide a clearer document.",
    ),
    "MISSING_VALUE": (
        "The source value is blank or a placeholder.",
        "Supply an authoritative replacement source.",
    ),
    "FORMULA_VALUE": (
        "The value is a spreadsheet formula and has not been evaluated.",
        "Provide an authoritative document with a literal value.",
    ),
    "PARTY_BOUNDARY_UNCLEAR": (
        "The company identity cannot be separated reliably from its surrounding text.",
        "Review the complete source block.",
    ),
    "AMBIGUOUS_CONTAINER_COUNT": (
        "An explicit container quantity could not be established.",
        "Provide the number of containers, separate from packages and IDs.",
    ),
    "TOTAL_WEIGHT_REQUIRED": (
        "A container-table weight is not an explicit shipment total.",
        "Provide an authoritative total gross weight.",
    ),
    "MISSING_WEIGHT_UNIT": (
        "The weight has no supported explicit unit.",
        "Provide a source stating kg, grams, or metric tonnes.",
    ),
    "CONFLICTING_WEIGHT_UNITS": (
        "The weight label and value state conflicting units.",
        "Resolve the units in the source document.",
    ),
    "AMBIGUOUS_WEIGHT": (
        "The weight has ambiguous numeric formatting or unsupported content.",
        "Provide one unambiguous total and explicit unit.",
    ),
    "CONFLICTING_VALUES": (
        "Multiple source values conflict for this field.",
        "Review the cited sources and provide one authoritative value.",
    ),
}


def extract_fields(units: list[SourceUnit], *, trace: Trace | None = None):
    trace = trace or Trace()
    fields, issues = [], []
    by_key = candidates(units)
    for key in FIELD_KEYS:
        items = by_key[key]
        all_items = items
        if key == "gross_weight_kg" and any(item.explicit_total for item in items):
            items = [item for item in items if item.explicit_total]
        trace.emit(
            "candidates",
            "SUCCEEDED",
            "Source candidates inspected.",
            field=key,
            candidates=[
                {
                    "label": item.label,
                    "raw_value": item.raw,
                    "source_unit_ids": list(dict.fromkeys(u.unit_id for u in item.units)),
                    "selected": any(item is chosen for chosen in items),
                    "selection_reason": "explicit_total_precedence"
                    if len(items) < len(all_items)
                    else "retain_all_candidates",
                }
                for item in all_items
            ],
        )
        problem = None
        if not items:
            raw, normalized, state, problem = None, None, "MISSING", "FIELD_NOT_FOUND"
        else:
            results = [normalize(item) for item in items]
            for item, result in zip(items, results, strict=True):
                trace.emit(
                    "normalization",
                    "SUCCEEDED" if result[2] == "PRESENT" else "NEEDS_REVIEW",
                    "Candidate normalization evaluated.",
                    field=key,
                    rule=f"normalize.{key}",
                    label=item.label,
                    source_unit_ids=list(dict.fromkeys(u.unit_id for u in item.units)),
                    raw_value=result[0],
                    normalized_value=result[1],
                    value_state=result[2],
                    issue_code=result[3],
                )
            raw, normalized, state, problem = results[0]
            if any(result[1:] != results[0][1:] for result in results[1:]) or (
                len(results) > 1
                and state != "PRESENT"
                and len({result[0] for result in results}) > 1
            ):
                raw = "\n".join(dict.fromkeys(item.raw for item in items))
                normalized, state, problem = None, "AMBIGUOUS", "CONFLICTING_VALUES"
        fields.append(
            FieldExtraction(
                field=key,
                raw_value=raw,
                normalized_value=normalized,
                value_state=state,
                evidence=evidence_for(items),
            )
        )
        trace.emit(
            "field_result",
            "SUCCEEDED" if state == "PRESENT" else "NEEDS_REVIEW",
            "Final field value recorded.",
            field=key,
            raw_value=raw,
            normalized_value=normalized,
            value_state=state,
            issue_code=problem,
        )
        if problem:
            message, action = ISSUE_DETAILS[problem]
            issues.append(
                ExtractionIssue(
                    code=problem,
                    message=message,
                    next_action=action,
                    field=key,
                    reason="missing_value" if state == "MISSING" else "unreadable",
                )
            )
    return fields, issues
