#!/usr/bin/env python3
"""Run the frozen localhost evaluation manifest and emit ignored artifacts."""

import argparse
import csv
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.semantic import quote_matches
from app.documents.analysis import CATEGORIES, classify
from app.extraction import extract_document


def safe_div(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=Path("evaluation/manifest.json"))
    parser.add_argument("--output", type=Path, default=Path(".local/evaluation"))
    parser.add_argument(
        "--provider-records",
        type=Path,
        help=(
            "Optional local JSON array of real provider-call metadata; never used by runtime code."
        ),
    )
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())

    pairs = []
    for case in manifest["classification_cases"]:
        predicted = classify(case["subject"], case["body"])["category"]
        pairs.append((case["expected"], predicted))
    confusion = {
        expected: {predicted: pairs.count((expected, predicted)) for predicted in CATEGORIES}
        for expected in CATEGORIES
    }
    per_class = {}
    for category in CATEGORIES:
        true_positive = pairs.count((category, category))
        false_positive = sum(
            1 for expected, predicted in pairs if predicted == category and expected != category
        )
        false_negative = sum(
            1 for expected, predicted in pairs if expected == category and predicted != category
        )
        precision = safe_div(true_positive, true_positive + false_positive)
        recall = safe_div(true_positive, true_positive + false_negative)
        per_class[category] = {
            "precision": precision,
            "recall": recall,
            "f1": safe_div(round(2 * precision * recall, 4), precision + recall),
            "support": sum(1 for expected, _ in pairs if expected == category),
        }

    extracted = {}
    document_results = []
    state_counts = Counter()
    evidence_total = evidence_valid = 0
    for case in manifest["document_cases"]:
        path = Path(case["path"])
        result = extract_document(path.read_bytes(), path.name, f"eval-{case['id']}").model_dump(
            mode="json"
        )
        extracted[case["id"]] = result
        document_results.append(
            {
                "id": case["id"],
                "format": case["format"],
                "expected_role": case["expected_role"],
                "predicted_role": result["detected_role"],
                "role_correct": result["detected_role"] == case["expected_role"],
            }
        )
        units = {unit["unit_id"]: unit["text"] for unit in result["source_units"]}
        for field in result["fields"]:
            state_counts[field["value_state"]] += 1
            for evidence in field["evidence"]:
                evidence_total += 1
                evidence_valid += int(evidence["excerpt"] in units[evidence["unit_id"]])

    expected_fields = manifest["field_case"]["expected"]
    actual_fields = {
        field["field"]: field["normalized_value"]
        for field in extracted[manifest["field_case"]["document_case_id"]]["fields"]
    }
    correct_fields = sum(actual_fields.get(key) == value for key, value in expected_fields.items())
    quote_case = manifest["quote_mismatch_case"]
    quote_mismatch_passed = (
        quote_matches(quote_case["source"], quote_case["quote"]) == quote_case["expected_valid"]
    )
    provider_records = (
        json.loads(args.provider_records.read_text()) if args.provider_records else []
    )
    token_usage = Counter()
    for record in provider_records:
        token_usage.update(record.get("usage") or {})
    report = {
        "manifest_version": manifest["version"],
        "generated_at": datetime.now(UTC).isoformat(),
        "classification": {
            "accuracy": safe_div(
                sum(expected == predicted for expected, predicted in pairs), len(pairs)
            ),
            "confusion_matrix": confusion,
            "per_class": per_class,
        },
        "documents": document_results,
        "extraction": {
            "field_accuracy": safe_div(correct_fields, len(expected_fields)),
            "correct_fields": correct_fields,
            "total_fields": len(expected_fields),
            "value_state_breakdown": dict(sorted(state_counts.items())),
            "evidence_quote_validity": safe_div(evidence_valid, evidence_total),
            "evidence_quotes_valid": evidence_valid,
            "evidence_quotes_total": evidence_total,
            "quote_mismatch_rejected": quote_mismatch_passed,
        },
        "ai": {
            "call_count": len(provider_records),
            "calls": provider_records,
            "latency_ms": [record["duration_ms"] for record in provider_records],
            "token_usage": dict(token_usage) or None,
            "cost": "unavailable",
            "note": (
                "Provider metadata was loaded from a local smoke-test record."
                if provider_records
                else "This deterministic frozen run does not call Gemini; real-path evidence "
                "is checked separately in the demo gate."
            ),
        },
    }

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    rows = [
        ("classification", "overall", "accuracy", report["classification"]["accuracy"]),
        ("extraction", "seven_fields", "accuracy", report["extraction"]["field_accuracy"]),
        (
            "evidence",
            "all_documents",
            "quote_validity",
            report["extraction"]["evidence_quote_validity"],
        ),
        ("ai", "provider_records", "call_count", len(provider_records)),
        ("ai", "frozen_deterministic_run", "cost", "unavailable"),
    ]
    rows.extend(
        ("classification", category, metric, values[metric])
        for category, values in per_class.items()
        for metric in ("precision", "recall", "f1")
    )
    with (args.output / "evaluation.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("area", "scope", "metric", "value"))
        writer.writerows(rows)

    markdown = [
        "# DraftGuard localhost P0 evaluation",
        "",
        f"Manifest: `{manifest['version']}`  ",
        f"Generated: `{report['generated_at']}`",
        "",
        "## Results",
        "",
        f"- Classification accuracy: {report['classification']['accuracy']:.1%}",
        f"- Seven-field extraction accuracy: {report['extraction']['field_accuracy']:.1%}",
        f"- Evidence quote validity: {report['extraction']['evidence_quote_validity']:.1%}",
        f"- Quote mismatch rejected: {'yes' if quote_mismatch_passed else 'no'}",
        f"- Recorded real AI calls: {len(provider_records)}",
        "- Cost: unavailable",
        "",
        "## Per-class metrics",
        "",
        "| Category | Precision | Recall | F1 |",
        "|---|---:|---:|---:|",
        *[
            f"| {category} | {values['precision']:.2f} | "
            f"{values['recall']:.2f} | {values['f1']:.2f} |"
            for category, values in per_class.items()
        ],
        "",
        (
            "The JSON artifact contains the full confusion matrix, format coverage, "
            "value-state breakdown, and evidence counts."
        ),
    ]
    (args.output / "evaluation.md").write_text("\n".join(markdown) + "\n")
    print(args.output.resolve())


if __name__ == "__main__":
    main()
