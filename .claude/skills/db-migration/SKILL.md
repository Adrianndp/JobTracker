---
name: db-migration
description: Safely change a Django model in this project (Job, User, ApiToken, BillingAccount, …) — back up the local Postgres, write or generate the migration with a descriptive name, review it for data loss, test it, and update to_dict/frontend/docs. Use whenever a models.py changes or a migration is added, renamed or squashed.
---

# Change a model safely

The local database (`localdb`, from `DATABASE_URL` in `.env`) holds the owner's real job
history, so every schema change starts with a backup.

## 1. Back up first

```bash
set -a && . ./.env && set +a
pg_dump --no-owner "$DATABASE_URL" > "backups/localdb-pre-<topic>-$(date +%Y%m%d-%H%M).sql"
```

`backups/` is gitignored and holds personal data: never print, commit or upload its files.
Restore, if needed (ask first — it replaces the data):
`createdb restore_test && psql -q restore_test < backups/<file>.sql`.

## 2. Change the model and make the migration

```bash
cd backend && set -a && . ../.env && set +a
.venv/bin/python manage.py makemigrations <app> --name <what_changed>
```

- Always pass `--name` (existing ones read like `0002_job_user`, `0005_email_required`).
- **Renames:** the autodetector can turn a rename into drop + add and lose the column's data.
  Write the `RenameField` migration by hand, as `accounts/0003_rename_to_abstractuser_columns.py`
  does, with a docstring saying why.
- **New NOT NULL column on an existing table:** give it a default, or add it nullable,
  backfill in a data migration, then tighten in a second migration.
- Keep `db_table` / `db_column` names as they are (`job`, `user`, `user_id`): the tables
  predate Django's naming.
- Data migrations must not contain personal data (emails, names) — do those one-offs in
  `manage.py shell` instead.
- Read the generated file before going on: `.venv/bin/python manage.py sqlmigrate <app> <number>`.

## 3. Everything the field touches

- `to_dict()` on the model if the API should expose it (datetimes: naive UTC, append `Z`).
- Validation in `jobs/validators.py` (and the courtesy `MAX` mirror in
  `frontend/extension/src/background.js`) for user-editable text.
- The view's accepted fields in `jobs/views.py` (POST/PATCH).
- `frontend/src/api.ts` types, the components that show or edit it, and
  `frontend/src/lib/exportJobs.ts` if it belongs in exports.
- A job status change touches six files — see "Job statuses" in CLAUDE.md.
- Tests in the app's `tests.py`; for jobs, include the ownership angle (another user's job
  is a 404).

## 4. Verify and apply

```bash
scripts/check.sh            # makemigrations --check, all tests, builds
cd backend && .venv/bin/python manage.py migrate     # apply to localdb (after the backup)
```

Docker applies migrations on start. Mention in the commit message when a migration needs a
backup before deploying.
