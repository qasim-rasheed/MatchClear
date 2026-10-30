import { openDatabase } from "../src/server/db";
import { seedDatabase } from "../src/server/db/seed";

const ctx = openDatabase();
if (process.argv[2] === "seed")
  console.log(
    seedDatabase(ctx)
      ? "Starter tournament created. All data is illustrative."
      : "Existing workspace kept; no data replaced.",
  );
else console.log("Database migrations applied.");
ctx.sqlite.close();
