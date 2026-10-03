#!/usr/bin/env bash
# ADR-0016 expand/contract migration lint — AT-0016-4.
#
# A release may only ADD (expand): nullable/defaulted columns, new
# tables, new enum values. Destructive changes (DROP, RENAME, SET NOT
# NULL on an existing column) must carry a `-- contract:` marker plus an
# ADR reference, acknowledging they ship only once no deployed revision
# reads the old shape.
#
# Usage: migration-lint.sh [migrations-dir]
#   default migrations-dir: db/migrations (packages/db/drizzle.config.ts
#   `out` -- the monorepo-root migration history shared with services/
#   pipeline's raw SQL per ADR-0009).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATIONS_DIR="${1:-$REPO_ROOT/db/migrations}"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "migration-lint: $MIGRATIONS_DIR does not exist yet (no migrations to check) — PASS (vacuously)"
  exit 0
fi

SQL_FILES=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' 2>/dev/null)
if [[ -z "$SQL_FILES" ]]; then
  echo "migration-lint: no .sql files in $MIGRATIONS_DIR — PASS (vacuously)"
  exit 0
fi

FAIL=0
# Matches: DROP ... , RENAME ..., ALTER ... SET NOT NULL (case-insensitive).
# A contract marker anywhere in the SAME FILE exempts the whole file --
# per ADR-0016, a destructive migration needs ONE marker + ADR ref, not
# one per statement.
DESTRUCTIVE_RE='(^|[^a-zA-Z])(DROP[[:space:]]+(TABLE|COLUMN|INDEX|CONSTRAINT)|RENAME[[:space:]]+(TO|COLUMN)|SET[[:space:]]+NOT[[:space:]]+NULL)'

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if grep -Eiq "$DESTRUCTIVE_RE" "$f"; then
    if grep -Eq -- '--[[:space:]]*contract:[[:space:]]*ADR-[0-9]{4}' "$f"; then
      echo "PASS  $f (destructive change, has '-- contract: ADR-XXXX' marker)"
    else
      echo "FAIL  $f: destructive statement (DROP/RENAME/SET NOT NULL) without a '-- contract: ADR-XXXX' marker"
      FAIL=1
    fi
  else
    echo "PASS  $f (expand-only, no destructive statements)"
  fi
done <<< "$SQL_FILES"

exit $FAIL
