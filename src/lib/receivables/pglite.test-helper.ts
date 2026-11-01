/**
 * In-process Postgres for migration + RLS tests — no Docker, no
 * Supabase CLI, no network. PGlite is real Postgres compiled to WASM,
 * so constraints, triggers, SECURITY DEFINER functions and row level
 * security behave exactly as on Supabase.
 *
 * The shim recreates the small slice of Supabase the migrations rely
 * on: the anon / authenticated / service_role roles, auth.users +
 * auth.uid()/role()/jwt(), the storage schema, and the realtime
 * publication. A "session" is simulated the way PostgREST does it:
 * SET ROLE authenticated + request.jwt.claim.sub.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite-pgvector";

const SUPABASE_SHIM = `
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;
CREATE FUNCTION auth.jwt() RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner UUID,
  public BOOLEAN DEFAULT FALSE,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT,
  owner UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

CREATE PUBLICATION supabase_realtime;

GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`;

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

export interface TestDb {
  db: PGlite;
  /** Create an auth user; the signup trigger provisions account + owner profile. */
  createUser(email: string): Promise<{ userId: string; accountId: string }>;
  /** Run `fn` as an authenticated end user (PostgREST semantics). */
  asUser<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  /** Run `fn` with the anon key's role (no JWT subject). */
  asAnon<T>(fn: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Boot PGlite, install the Supabase shim, replay every migration in order. */
export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create({ extensions: { uuid_ossp, vector } });
  await db.exec(SUPABASE_SHIM);
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }

  // One shared connection: serialise role switches so concurrent
  // helpers can never interleave identities.
  let chain: Promise<unknown> = Promise.resolve();
  const serialise = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const runAs = async <T>(role: string, sub: string, fn: () => Promise<T>): Promise<T> =>
    serialise(async () => {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [sub]);
      await db.exec(`SET ROLE ${role}`);
      try {
        return await fn();
      } finally {
        await db.exec(`RESET ROLE`);
        await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
      }
    });

  return {
    db,
    async createUser(email) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO auth.users (email, raw_user_meta_data)
         VALUES ($1, jsonb_build_object('full_name', $1::text)) RETURNING id`,
        [email],
      );
      const userId = rows[0].id;
      const profile = await db.query<{ account_id: string }>(
        `SELECT account_id FROM profiles WHERE user_id = $1`,
        [userId],
      );
      if (!profile.rows[0]) throw new Error(`signup trigger did not provision ${email}`);
      return { userId, accountId: profile.rows[0].account_id };
    },
    asUser: (userId, fn) => runAs("authenticated", userId, fn),
    asAnon: (fn) => runAs("anon", "", fn),
    close: () => db.close(),
  };
}
