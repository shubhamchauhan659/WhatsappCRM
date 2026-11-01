// ============================================================
// /api/account
//
//   GET    — current caller's account + role. Any member.
//   PATCH  — rename the account.                  Admin+.
//   DELETE — permanently delete the account, all of its data
//            and the owner's login.               Owner only,
//            sole member, typed confirmation.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { getT } from "@/lib/i18n/translate";
import { supabaseAdmin } from "@/lib/automations/admin-client";

const t = getT("Api");

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown }
      | null;
    const rawName = body?.name;

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: t('account.nameMustBeString') },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: t('account.nameEmpty') },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: t('account.nameTooLong', { max: MAX_NAME_LEN }) },
        { status: 400 },
      );
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, and requireRole already
    // guaranteed the caller is admin+.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ name })
      .eq("id", ctx.accountId)
      .select("id, name")
      .single();

    if (error) {
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: t('account.updateFailed') },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Storage folders written by this app for an account (see migrations
// 008 / 016 / 023 / 039 and lib/storage/upload-media.ts).
const ACCOUNT_STORAGE = [
  { bucket: "chat-media", prefix: (accountId: string) => `account-${accountId}` },
  { bucket: "flow-media", prefix: (accountId: string) => `account-${accountId}` },
] as const;
const MAX_STORAGE_OBJECTS = 5000;

type StorageClient = ReturnType<typeof supabaseAdmin>["storage"];

/** Recursively list object paths under `prefix` (bounded). */
async function listObjects(storage: StorageClient, bucket: string, prefix: string, depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 6 || out.length >= MAX_STORAGE_OBJECTS) return out;
  const { data, error } = await storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const item of data) {
    const path = `${prefix}/${item.name}`;
    if (item.id === null) await listObjects(storage, bucket, path, depth + 1, out);
    else out.push(path);
    if (out.length >= MAX_STORAGE_OBJECTS) break;
  }
  return out;
}

/**
 * Permanently delete the caller's account.
 *
 * Order matters: accounts.owner_user_id is ON DELETE RESTRICT, so the
 * account row (which cascades to every tenant table) goes first, then
 * the auth user. Storage cleanup is best-effort and never blocks the
 * deletion of the database rows.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(`owner:delete-account:${ctx.userId}`, RATE_LIMITS.accountDeletion);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null;
    if (typeof body?.confirm !== "string" || body.confirm.trim() !== ctx.account.name.trim()) {
      return NextResponse.json({ error: t("account.deleteConfirmMismatch") }, { status: 400 });
    }

    const { count, error: membersErr } = await ctx.supabase
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId);
    if (membersErr) {
      console.error("[DELETE /api/account] member count error:", membersErr);
      return NextResponse.json({ error: t("account.deleteFailed") }, { status: 500 });
    }
    if ((count ?? 0) > 1) {
      return NextResponse.json({ error: t("account.deleteHasMembers") }, { status: 409 });
    }

    const admin = supabaseAdmin();

    for (const { bucket, prefix } of ACCOUNT_STORAGE) {
      try {
        const paths = await listObjects(admin.storage, bucket, prefix(ctx.accountId));
        for (let i = 0; i < paths.length; i += 100) {
          await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
        }
      } catch (err) {
        console.warn(`[DELETE /api/account] storage cleanup skipped for ${bucket}:`, err);
      }
    }
    try {
      const avatars = await listObjects(admin.storage, "avatars", ctx.userId);
      if (avatars.length > 0) await admin.storage.from("avatars").remove(avatars);
    } catch (err) {
      console.warn("[DELETE /api/account] avatar cleanup skipped:", err);
    }

    const { error: deleteErr } = await admin
      .from("accounts")
      .delete()
      .eq("id", ctx.accountId)
      .eq("owner_user_id", ctx.userId);
    if (deleteErr) {
      console.error("[DELETE /api/account] account delete error:", deleteErr);
      return NextResponse.json({ error: t("account.deleteFailed") }, { status: 500 });
    }

    const { error: userErr } = await admin.auth.admin.deleteUser(ctx.userId);
    if (userErr) {
      console.error("[DELETE /api/account] auth user delete error:", userErr);
      return NextResponse.json({ error: t("account.deleteUserFailed"), accountDeleted: true }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
