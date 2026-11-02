import { mkdir, writeFile } from "node:fs/promises";
import { runBenchmark } from "../src/lib/planner/benchmark";
async function main() {
  const report = runBenchmark();
  await mkdir("evidence", { recursive: true });
  await writeFile("evidence/planner-benchmark.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.failedCaseIndexes.length || report.invalidSelections) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
