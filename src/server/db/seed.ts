import { eq, count } from "drizzle-orm";
import type { DatabaseContext } from "./index";
import { events, teams, fixtures, designs, options, activity } from "./schema";

export function seedDatabase(ctx: DatabaseContext) {
  return ctx.sqlite
    .transaction(() => {
      if (ctx.db.select({ count: count() }).from(events).get()!.count > 0) return false;
      const now = new Date().toISOString();
      ctx.db
        .insert(events)
        .values({
          id: "riverside-cup",
          name: "Riverside Community Cup",
          currency: "EUR",
          budgetMinor: 90000,
          eventDate: null,
          sample: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const roster = [
        ["northbank", "Northbank FC", "NB", 3, 5, 4],
        ["parkside", "Parkside Athletic", "PA", 4, 4, 4],
        ["riverside", "Riverside United", "RU", 2, 6, 4],
        ["oldtown", "Old Town Rovers", "OT", 3, 4, 5],
      ] as const;
      for (const [id, name, code, s, m, l] of roster)
        ctx.db
          .insert(teams)
          .values({
            id,
            eventId: "riverside-cup",
            name,
            code,
            quantities: { XS: 0, S: s, M: m, L: l, XL: 0, XXL: 0 },
          })
          .run();
      for (const [i, a, b] of [
        [1, "northbank", "parkside"],
        [2, "parkside", "riverside"],
        [3, "northbank", "oldtown"],
      ] as const)
        ctx.db
          .insert(fixtures)
          .values({
            id: `fixture-${i}`,
            eventId: "riverside-cup",
            teamA: a,
            teamB: b,
            pairKey: [a, b].sort().join("|"),
            label: `Match ${i}`,
          })
          .run();
      const shirts = [
        [
          "northbank-red",
          "northbank",
          "Northbank home",
          "Brick red",
          "#AC393B",
          "#E9D7CB",
          "solid",
          true,
          0,
        ],
        [
          "northbank-white",
          "northbank",
          "Northbank alternate",
          "Chalk white",
          "#E7E5DB",
          "#343F4D",
          "panel",
          false,
          1800,
        ],
        [
          "parkside-green",
          "parkside",
          "Parkside home",
          "Forest green",
          "#3E6B54",
          "#DBE5D1",
          "solid",
          true,
          0,
        ],
        [
          "parkside-navy",
          "parkside",
          "Parkside alternate",
          "Deep navy",
          "#283E56",
          "#EFEDE2",
          "panel",
          false,
          1200,
        ],
        [
          "riverside-navy",
          "riverside",
          "Riverside home",
          "Navy / chalk",
          "#283E56",
          "#E7E5DB",
          "stripe",
          true,
          0,
        ],
        [
          "riverside-white",
          "riverside",
          "Riverside alternate",
          "Chalk white",
          "#E7E5DB",
          "#3E6B54",
          "solid",
          false,
          2500,
        ],
        [
          "oldtown-white",
          "oldtown",
          "Old Town home",
          "Chalk / navy",
          "#E7E5DB",
          "#283E56",
          "panel",
          true,
          0,
        ],
        [
          "oldtown-navy",
          "oldtown",
          "Old Town spare",
          "Deep navy",
          "#283E56",
          "#E9D7CB",
          "solid",
          true,
          0,
        ],
      ] as const;
      for (const [
        id,
        teamId,
        name,
        colour,
        primaryHex,
        secondaryHex,
        pattern,
        owned,
        unitMinor,
      ] of shirts) {
        ctx.db
          .insert(designs)
          .values({ id, eventId: "riverside-cup", name, colour, primaryHex, secondaryHex, pattern })
          .run();
        const team = ctx.db.select().from(teams).where(eq(teams.id, teamId)).get()!;
        ctx.db
          .insert(options)
          .values({
            id: `option-${id}`,
            eventId: "riverside-cup",
            teamId,
            designId: id,
            owned,
            unitMinor,
            setupMinor: 0,
            minimumOrder: 0,
            stock: owned ? team.quantities : { XS: 20, S: 20, M: 20, L: 20, XL: 20, XXL: 20 },
            available: true,
            seller: owned
              ? "Illustrative team inventory"
              : "Illustrative price; no retailer connected",
            priceDate: now.slice(0, 10),
            illustrative: true,
          })
          .run();
      }
      ctx.db
        .insert(activity)
        .values({
          id: crypto.randomUUID(),
          eventId: "riverside-cup",
          action: "sample.created",
          entityId: "riverside-cup",
          detail: {
            note: "Fictional teams, original vector illustrations and illustrative inventory. No API calls or visual approvals.",
          },
          createdAt: now,
        })
        .run();
      return true;
    })
    .immediate();
}
