"""
Importiert Zeilen aus job.csv in die bestehende jobs.db.

Nutzung (im backend-Ordner, venv aktiv):
    python manage.py import_jobs --username Adrian            # liest job.csv
    python manage.py import_jobs pfad.csv --username Adrian

Bereits vorhandene IDs werden aktualisiert (Upsert), neue IDs werden angelegt.
"""

import csv
from datetime import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import User, utcnow
from jobs.models import VALID_STATUSES, Job


def parse_dt(value):
    value = (value or '').strip()
    if not value:
        return None
    # Format wie in der CSV: 2026-06-01 19:44:07.955329
    try:
        return datetime.strptime(value, '%Y-%m-%d %H:%M:%S.%f')
    except ValueError:
        # Fallback ohne Mikrosekunden
        return datetime.strptime(value, '%Y-%m-%d %H:%M:%S')


class Command(BaseCommand):
    help = 'Import jobs from a CSV file (upsert by id).'

    def add_arguments(self, parser):
        parser.add_argument('csv_path', nargs='?', default='job.csv')
        parser.add_argument('--username', required=True, help='Account the imported jobs belong to.')

    @transaction.atomic
    def handle(self, *args, csv_path, username, **options):
        owner = User.objects.filter(username=username).first()
        if owner is None:
            raise CommandError(f'No account named "{username}".')
        created, updated = 0, 0

        with open(csv_path, newline='', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                status = (row.get('status') or '').strip()
                if status not in VALID_STATUSES:
                    status = 'to_be_applied'

                _, was_created = Job.objects.update_or_create(
                    id=int(row['id']),
                    defaults={
                        'user': owner,
                        'name': (row.get('name') or '').strip(),
                        'company': (row.get('company') or '').strip() or None,
                        'link': (row.get('link') or '').strip() or None,
                        'salary': (row.get('salary') or '').strip() or None,
                        'status': status,
                        'had_interview': row.get('had_interview') == '1',
                        'applied_date': parse_dt(row.get('applied_date')),
                        'created_at': parse_dt(row.get('created_at')) or utcnow(),
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(f'Fertig: {created} neu angelegt, {updated} aktualisiert.')
