import { describe, expect, it } from "vitest";
import { parseCsv, checkCsvColumns, checkCsvRows, teamCsvExample } from "../src/domain/csv";
import { openDatabase } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed";
import { getWorkspace, mutateWorkspace } from "../src/server/workspace";

describe("reviewable CSV import", () => {
  it("handles quoted commas, escaped quotes, CRLF, BOM and missing columns", () => {
    const result = parseCsv('\uFEFFname,code\r\n"East, United",EU\r\n"The ""Owls""",OW');
    expect(result.rows).toEqual([
      { name: "East, United", code: "EU" },
      { name: 'The "Owls"', code: "OW" },
    ]);
    expect(result.errors).toEqual([]);
    expect(checkCsvColumns("teams", result.headers)).toContain("Missing column: XS");
    expect(parseCsv('name,code\n"unfinished').errors).toContain("A quoted field is not closed.");
    expect(parseCsv("name,code\nWrong").errors.length).toBeGreaterThan(0);
    expect(parseCsv(teamCsvExample).rows).toHaveLength(2);
    expect(
      checkCsvRows("teams", [
        { name: "East", code: "EFC", XS: "0", S: "0", M: "1.5", L: "0", XL: "0", XXL: "0" },
      ]),
    ).toContain("Row 2: M must be a whole number from 0 to 1000.");
  });
  it("rolls back an entire batch when a later team conflicts", () => {
    const ctx = openDatabase(":memory:");
    seedDatabase(ctx);
    try {
      const quantities = { XS: 0, S: 0, M: 12, L: 0, XL: 0, XXL: 0 };
      expect(() =>
        mutateWorkspace(ctx, {
          op: "importTeams",
          eventId: "riverside-cup",
          revision: 1,
          input: {
            rows: [
              { name: "Eastfield", code: "EFC", quantities },
              { name: "Northbank FC", code: "NB", quantities },
            ],
          },
        }),
      ).toThrow("No rows");
      expect(getWorkspace(ctx).teams).toHaveLength(4);
      expect(getWorkspace(ctx).event?.revision).toBe(1);
      mutateWorkspace(ctx, {
        op: "importFixtures",
        eventId: "riverside-cup",
        revision: 1,
        input: { rows: [{ label: "Match 4", teamA: "RU", teamB: "OT" }] },
      });
      expect(getWorkspace(ctx).fixtures).toHaveLength(4);
    } finally {
      ctx.sqlite.close();
    }
  });
});
