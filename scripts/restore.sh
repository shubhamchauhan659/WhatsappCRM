#!/usr/bin/env bash
# Restore an encrypted backup made by scripts/backup.sh.
#
#   TARGET_DB_URL=postgresql://... BACKUP_PASSPHRASE='...' scripts/restore.sh backups/paisafollow-<stamp>.dump.enc
#
# Restore into a NEW, EMPTY Supabase project (never over a live one):
#   1. Create the project and apply every migration in supabase/migrations
#      (supabase db push, or paste them in order into the SQL editor).
#   2. Run this script. It restores DATA ONLY with triggers disabled, so the
#      stored invoice totals are taken verbatim from the backup instead of
#      being re-derived (re-deriving would double-count payments).
#   3. Verify with the queries printed at the end, then point the app's
#      NEXT_PUBLIC_SUPABASE_URL / keys at the new project.
#
# Set RESTORE_ALLOW_NONEMPTY=1 only if you know the target already has
# matching rows you intend to collide with (not recommended).
set -euo pipefail

FILE="${1:?usage: scripts/restore.sh <backup.dump.enc>}"
: "${TARGET_DB_URL:?set TARGET_DB_URL to the NEW database connection string}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
command -v pg_restore >/dev/null || { echo "pg_restore not found" >&2; exit 1; }

if [ "${RESTORE_ALLOW_NONEMPTY:-0}" != "1" ]; then
  existing="$(psql "$TARGET_DB_URL" -Atc "select coalesce((select count(*) from public.invoices), 0)" 2>/dev/null || echo 0)"
  if [ "${existing:-0}" != "0" ]; then
    echo "target already has $existing invoices — refusing to restore over existing data" >&2
    exit 1
  fi
fi

TMP="$(mktemp "${TMPDIR:-/tmp}/pf-restore.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$TMP" -pass env:BACKUP_PASSPHRASE

pg_restore --dbname="$TARGET_DB_URL" --data-only --disable-triggers --no-owner --no-privileges \
  --single-transaction --exit-on-error "$TMP"

echo "restore complete. Verify:"
psql "$TARGET_DB_URL" -c "select count(*) as invoices, sum(outstanding_paise) as outstanding_paise from public.invoices" || true
psql "$TARGET_DB_URL" -c "select count(*) as invoices_with_drift from public.invoices i where i.paid_paise <> coalesce((select sum(amount_paise) from public.invoice_payments p where p.invoice_id = i.id and p.kind = 'payment' and p.voided_at is null), 0)" || true
