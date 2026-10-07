#!/usr/bin/env bash
# Everything that should pass before a commit, from any folder:
#
#   scripts/check.sh                 # backend tests, migration check, web + extension builds
#   scripts/check.sh backend         # backend only
#   scripts/check.sh frontend        # builds only
#   scripts/check.sh backend jobs.tests.OwnershipTests   # extra args go to `manage.py test`
#
# Loads DATABASE_URL (and the rest) from the repo .env, like the README's manual
# setup. Tests create and drop a test_ database on that Postgres.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
what=${1:-all}
[ $# -gt 0 ] && shift

backend() {
  cd "$root/backend"
  local python=.venv/bin/python
  [ -x "$python" ] || python=venv/bin/python
  [ -x "$python" ] || python=python
  set -a && . "$root/.env" && set +a
  "$python" manage.py makemigrations --check --dry-run
  "$python" manage.py test "$@"
}

frontend() {
  cd "$root/frontend"
  npm run build:all
}

case "$what" in
  all) (backend "$@") && (frontend) ;;
  backend) backend "$@" ;;
  frontend) frontend ;;
  *) echo "usage: scripts/check.sh [all|backend|frontend] [test labels...]" >&2; exit 2 ;;
esac
