"""
Importiert Zeilen aus job.csv in die bestehende jobs.db.

Nutzung:
    1. Diese Datei in denselben Ordner wie app.py legen.
    2. job.csv ebenfalls in diesen Ordner legen.
    3. Ausführen:  python import_jobs.py

Das Skript nutzt das Job-Model direkt aus app.py, damit Schema
und Migrationslogik (had_interview, applied_date, company) konsistent
bleiben. Bereits vorhandene IDs werden aktualisiert (Upsert),
neue IDs werden angelegt.
"""

import csv
from datetime import datetime

from app import app, db, Job, VALID_STATUSES

CSV_PATH = "job.csv"


def parse_dt(value: str):
    value = (value or "").strip()
    if not value:
        return None
    # Format wie in der CSV: 2026-06-01 19:44:07.955329
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f")
    except ValueError:
        # Fallback ohne Mikrosekunden
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")


def main():
    with app.app_context():
        created, updated = 0, 0

        with open(CSV_PATH, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)

            for row in reader:
                job_id = int(row["id"])
                job = Job.query.get(job_id)

                if job is None:
                    job = Job(id=job_id)
                    db.session.add(job)
                    created += 1
                else:
                    updated += 1

                status = (row.get("status") or "").strip()
                if status not in VALID_STATUSES:
                    status = "to_be_applied"

                job.name = (row.get("name") or "").strip()
                job.company = (row.get("company") or "").strip() or None
                job.link = (row.get("link") or "").strip() or None
                job.salary = (row.get("salary") or "").strip() or None
                job.status = status
                job.had_interview = row.get("had_interview") == "1"
                job.applied_date = parse_dt(row.get("applied_date"))
                job.created_at = parse_dt(row.get("created_at")) or datetime.utcnow()

        db.session.commit()
        print(f"Fertig: {created} neu angelegt, {updated} aktualisiert.")


if __name__ == "__main__":
    main()