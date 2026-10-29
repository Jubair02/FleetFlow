import { readdirSync, readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// Guards for prisma/migrations. Migrations run against the live database
// with `prisma migrate deploy`, so anything destructive must be a deliberate,
// reviewed exception listed here — never something `migrate dev` slipped in.

const DIR = path.resolve(__dirname, "../../prisma/migrations");
const migrations = readdirSync(DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => ({ name: d.name, sql: readFileSync(path.join(DIR, d.name, "migration.sql"), "utf8") }));

/** Destructive statements reviewed and accepted, as "<migration>: <statement prefix>". */
const REVIEWED_DESTRUCTIVE: string[] = [];

const DESTRUCTIVE = /^\s*(DROP\s+(TABLE|COLUMN|INDEX|SCHEMA|TYPE)|ALTER\s+TABLE\s+\S+\s+DROP|TRUNCATE|DELETE\s+FROM)\b[^;]*/gim;

function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

describe("prisma migrations", () => {
  it("starts from the 0_init baseline", () => {
    expect(migrations[0]?.name).toBe("0_init");
  });

  it("keeps the partial unique index that allows only one default plan", () => {
    // Prisma 6 can't express partial indexes, so `migrate dev` may propose dropping it.
    const all = migrations.map((m) => stripComments(m.sql)).join("\n");
    expect(all).toMatch(/CREATE UNIQUE INDEX "Plan_single_default" ON "Plan" \("isDefault"\) WHERE "isDefault"/);
    expect(all).not.toMatch(/DROP INDEX[^;]*"Plan_single_default"/i);
  });

  it("seeds exactly one default plan in the baseline", () => {
    const baseline = migrations[0].sql;
    const rows = baseline.match(/^\s*\('[a-z0-9-]+',.*\)[,]?$/gm) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => /,true,(true|false),true,\d+,CURRENT_TIMESTAMP\)/.test(r))).toHaveLength(1);
  });

  it("contains no unreviewed destructive statements", () => {
    const found = migrations.flatMap((m) =>
      [...stripComments(m.sql).matchAll(DESTRUCTIVE)].map((x) => `${m.name}: ${x[0].trim().slice(0, 80)}`)
    );
    const unreviewed = found.filter((f) => !REVIEWED_DESTRUCTIVE.some((r) => f.startsWith(r)));
    expect(unreviewed).toEqual([]);
  });
});
