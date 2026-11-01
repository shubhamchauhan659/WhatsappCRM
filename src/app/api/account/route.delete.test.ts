import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  role: "owner" as string,
  memberCount: 1,
  calls: [] as string[],
  accountDeleteError: null as null | { message: string },
  userDeleteError: null as null | { message: string },
}));

vi.mock("@/lib/auth/account", () => {
  class ForbiddenError extends Error {
    readonly status = 403 as const;
  }
  return {
    getCurrentAccount: vi.fn(),
    requireRole: vi.fn(async (min: string) => {
      if (min === "owner" && h.role !== "owner") throw new ForbiddenError("owner only");
      return {
        userId: "user-1",
        accountId: "acc-1",
        role: h.role,
        account: { id: "acc-1", name: "Agarwal Distributors" },
        supabase: {
          from: () => ({
            select: () => ({
              eq: async () => ({ count: h.memberCount, error: null }),
            }),
          }),
        },
      };
    }),
    toErrorResponse: vi.fn((err: { status?: number; message?: string }) =>
      Response.json({ error: err.message }, { status: err.status ?? 500 }),
    ),
  };
});

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (col: string, val: string) => ({
          eq: async (col2: string, val2: string) => {
            h.calls.push(`delete ${table} ${col}=${val} ${col2}=${val2}`);
            return { error: h.accountDeleteError };
          },
        }),
      }),
    }),
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          h.calls.push(`deleteUser ${id}`);
          return { error: h.userDeleteError };
        },
      },
    },
  }),
}));

import { DELETE } from "./route";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

const req = (body: unknown) =>
  new Request("http://localhost/api/account", { method: "DELETE", body: JSON.stringify(body) });

beforeEach(() => {
  h.role = "owner";
  h.memberCount = 1;
  h.calls = [];
  h.accountDeleteError = null;
  h.userDeleteError = null;
  __resetRateLimitForTests();
});

describe("DELETE /api/account", () => {
  it("deletes the account first, then the owner's login", async () => {
    const res = await DELETE(req({ confirm: "Agarwal Distributors" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(h.calls).toEqual(["delete accounts id=acc-1 owner_user_id=user-1", "deleteUser user-1"]);
  });

  it("requires the business name typed exactly", async () => {
    const res = await DELETE(req({ confirm: "agarwal" }));
    expect(res.status).toBe(400);
    expect(h.calls).toEqual([]);
  });

  it("is owner-only", async () => {
    h.role = "admin";
    const res = await DELETE(req({ confirm: "Agarwal Distributors" }));
    expect(res.status).toBe(403);
    expect(h.calls).toEqual([]);
  });

  it("refuses while other members still belong to the account", async () => {
    h.memberCount = 2;
    const res = await DELETE(req({ confirm: "Agarwal Distributors" }));
    expect(res.status).toBe(409);
    expect(h.calls).toEqual([]);
  });

  it("does not delete the login when the data deletion fails", async () => {
    h.accountDeleteError = { message: "boom" };
    const res = await DELETE(req({ confirm: "Agarwal Distributors" }));
    expect(res.status).toBe(500);
    expect(h.calls).toEqual(["delete accounts id=acc-1 owner_user_id=user-1"]);
  });

  it("is rate limited", async () => {
    h.accountDeleteError = { message: "boom" };
    for (let i = 0; i < 3; i++) await DELETE(req({ confirm: "Agarwal Distributors" }));
    const res = await DELETE(req({ confirm: "Agarwal Distributors" }));
    expect(res.status).toBe(429);
  });
});
