import { SCHEMA } from "./schema";
import { seedDemoData } from "./seed";

/**
 * Tiny database layer.
 * - Production: Postgres (Supabase / Neon) via DATABASE_URL.
 * - Local dev without DATABASE_URL: an embedded Postgres (PGlite) on disk.
 * Every query goes through `q(text, params)` with $1-style parameters.
 */

type Row = Record<string, any>;
type Driver = {
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
  exec: (text: string) => Promise<void>;
};

const g = globalThis as unknown as { __pnDriver?: Promise<Driver> };

async function createDriver(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, onnotice: () => {} });
    return {
      query: async (text, params = []) => (await sql.unsafe(text, params as any[])) as unknown as Row[],
      exec: async (text) => {
        await sql.unsafe(text);
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(process.env.PGLITE_DIR || "./.pglite");
  return {
    query: async (text, params = []) => (await db.query<Row>(text, params as any[])).rows,
    exec: async (text) => {
      await db.exec(text);
    },
  };
}

async function init(): Promise<Driver> {
  const d = await createDriver();
  await d.exec(SCHEMA);
  const [{ n }] = await d.query("select count(*)::int as n from customers");
  if (n === 0) await seedDemoData((t, p) => d.query(t, p));
  return d;
}

function driver(): Promise<Driver> {
  if (!g.__pnDriver) {
    g.__pnDriver = init().catch((e) => {
      g.__pnDriver = undefined;
      throw e;
    });
  }
  return g.__pnDriver;
}

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const d = await driver();
  return (await d.query(text, params)) as T[];
}

export async function resetDemoData() {
  const d = await driver();
  await d.exec("truncate activity, reminders, invoices, customers restart identity cascade;");
  await seedDemoData((t, p) => d.query(t, p));
}
