#!/usr/bin/env bash
# Encrypted logical backup of the PaisaFollow / wacrm database.
#
#   SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres \
#   BACKUP_PASSPHRASE='long random passphrase' \
#   scripts/backup.sh [output-dir]
#
# Produces <output-dir>/paisafollow-<UTC timestamp>.dump.enc
#   - pg_dump custom format of the app schemas (public, auth, storage metadata)
#   - encrypted with AES-256 (openssl, PBKDF2, 200k iterations)
#
# Supabase Free has no automatic backups — run this nightly (see
# .github/workflows/backup.yml) and keep the passphrase somewhere other
# than the place you keep the backups. Restore: scripts/restore.sh.
set -euo pipefail

: "${SUPABASE_DB_URL:?set SUPABASE_DB_URL (Supabase → Project Settings → Database → connection string)}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE (a long random string; keep it safe)}"
OUT_DIR="${1:-backups}"
SCHEMAS="${BACKUP_SCHEMAS:-public auth storage}"

command -v pg_dump >/dev/null || { echo "pg_dump not found (install the PostgreSQL client, same major version as the server or newer)" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$OUT_DIR/paisafollow-$STAMP.dump.enc"
TMP="$(mktemp "${TMPDIR:-/tmp}/pf-backup.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

schema_args=()
for s in $SCHEMAS; do schema_args+=(--schema="$s"); done

pg_dump "$SUPABASE_DB_URL" \
  --format=custom --compress=9 --no-owner --no-privileges \
  "${schema_args[@]}" \
  --file="$TMP"

openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$TMP" -out "$TARGET" -pass env:BACKUP_PASSPHRASE

# Integrity check: the encrypted file must decrypt to a readable archive.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$TARGET" -pass env:BACKUP_PASSPHRASE \
  | pg_restore --list >/dev/null

echo "backup written: $TARGET ($(wc -c <"$TARGET" | tr -d ' ') bytes)"
