"""Import the provided mailbox without reading evaluation answers."""

import argparse
import json
from pathlib import Path

from app.config import Settings
from app.dev_extraction.service import RunService
from app.dev_extraction.store import AuditStore
from app.documents.analysis import PIPELINE_VERSION
from app.store import Store, StoreError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["import-dataset"])
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--analyze", action="store_true")
    parser.add_argument("--rerun", action="store_true", help="Reanalyze unchanged emails too.")
    args = parser.parse_args()
    settings = Settings()
    if settings.app_env != "development":
        parser.error("Local dataset import is only available in development.")
    audit = AuditStore(settings.dev_audit_db)
    audit.initialize()
    service = RunService(audit, settings)
    store = Store(settings.local_data_dir, service)
    store.recover_audit_runs()
    try:
        changed = store.import_dataset(args.source)
        print(f"Imported {len(changed)} new or changed emails.", flush=True)
        if args.analyze or args.rerun:
            items = store.list_samples(limit=100_000)["items"]
            count = 0
            for item in items:
                detail = store.detail(item["id"])
                current = detail["current_run"]
                if args.rerun or not current or current["pipeline_version"] != PIPELINE_VERSION:
                    store.analyze(item["id"], item["revision"], mode="precomputed")
                    count += 1
                    if count % 50 == 0:
                        print(f"Analyzed {count} emails.", flush=True)
            print(f"Analysis attempts: {count}")
        print(json.dumps(store.list_samples(limit=1)["summary"], indent=2))
    except StoreError as exc:
        parser.exit(1, f"{exc.code}: {exc}\n")
    finally:
        service.shutdown()


if __name__ == "__main__":
    main()
