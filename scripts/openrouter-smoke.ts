import { mkdir, readFile, writeFile } from "node:fs/promises";
import { generateText } from "ai";
import sharp from "sharp";
import { generateDraft, type TextContext } from "../src/server/assistant";
import { textModel, TEXT_MODEL } from "../src/server/text-model";
const root = ".local/openrouter-smoke";
const context: TextContext = {
  currency: "EUR",
  teams: [
    { id: "A", name: "Northbank", code: "NB" },
    { id: "B", name: "Parkside", code: "PA" },
  ],
  options: [
    { id: "A-red", teamId: "A", design: "Red home" },
    { id: "A-blue", teamId: "A", design: "Blue alternate" },
    { id: "B-white", teamId: "B", design: "White home" },
  ],
};
async function main() {
  if (!process.argv.includes("--confirm-three-calls"))
    throw new Error(
      "Use --confirm-three-calls to send at most two synthetic text prompts and one generated colour card.",
    );
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY is not present in .env.local.");
  await mkdir(root, { recursive: true });
  let calls = 0;
  try {
    calls = JSON.parse(await readFile(`${root}/request-count.json`, "utf8")).requests;
  } catch {
    /* First run. */
  }
  const results: Record<string, unknown>[] = [];
  const save = () =>
    writeFile(
      `${root}/results.json`,
      JSON.stringify(
        {
          date: new Date().toISOString(),
          model: TEXT_MODEL,
          calls,
          results,
          limits: "Three-call smoke check, not an extensive benchmark or billing audit.",
        },
        null,
        2,
      ),
    );
  const reserve = async () => {
    if (!Number.isInteger(calls) || calls >= 3)
      throw new Error("The approved three-call cap has been reached.");
    calls++;
    await writeFile(`${root}/request-count.json`, JSON.stringify({ requests: calls }));
  };
  const tests = [
    {
      name: "explicit edits",
      text: "Set budget to EUR 300.50. Lock Northbank to Blue alternate. Add NB vs PA.",
      check: (d: Awaited<ReturnType<typeof generateDraft>>) =>
        d.budgetMinor === 30050 &&
        d.locks[0]?.optionId === "A-blue" &&
        d.fixtures[0]?.teamA === "A" &&
        d.fixtures[0]?.teamB === "B" &&
        !d.questions.length,
    },
    {
      name: "ambiguous instruction",
      text: "Keep Northbank fixed and make the budget cheaper.",
      check: (d: Awaited<ReturnType<typeof generateDraft>>) =>
        d.questions.length > 0 && d.budgetMinor === null && !d.locks.length && !d.fixtures.length,
    },
  ];
  for (const test of tests) {
    await reserve();
    const started = Date.now();
    try {
      const draft = await generateDraft(test.text, context);
      const passed = test.check(draft);
      results.push({ name: test.name, passed, elapsedMs: Date.now() - started, draft });
      console.log(`${passed ? "PASS" : "FAIL"} ${test.name}`);
      await save();
    } catch (error) {
      const cause = (error as { cause?: { name?: string; statusCode?: number; message?: string } })
        .cause;
      const message = (
        cause?.message || (error instanceof Error ? error.message : "Provider request failed")
      )
        .replaceAll(process.env.OPENROUTER_API_KEY!, "[redacted]")
        .slice(0, 500);
      results.push({
        name: test.name,
        passed: false,
        http: cause?.statusCode,
        diagnostic: message,
      });
      console.log(
        "Connection/result failed; stopping before further calls.",
        cause?.statusCode || "",
        message,
      );
      await save();
      process.exitCode = 1;
      return;
    }
  }
  await reserve();
  const card = await sharp(
    Buffer.from(
      '<svg width="640" height="400" xmlns="http://www.w3.org/2000/svg"><path fill="red" d="M0 0h320v400H0z"/><path fill="blue" d="M320 0h320v400H320z"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  try {
    const response = await generateText({
      model: textModel(),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Name the left and right colours in this synthetic test card. Reply briefly: left=colour, right=colour.",
            },
            { type: "file", mediaType: "image/png", data: { type: "data", data: card } },
          ],
        },
      ],
      maxRetries: 0,
      maxOutputTokens: 1024,
      abortSignal: AbortSignal.timeout(45000),
    });
    results.push({
      name: "synthetic image input",
      accepted: true,
      text: response.text,
      usage: response.usage,
    });
    console.log("Image accepted:", response.text);
  } catch (error) {
    results.push({
      name: "synthetic image input",
      accepted: false,
      error: error instanceof Error ? error.name : "Failed",
    });
    console.log("Image request failed.");
    process.exitCode = 1;
  }
  await save();
  if (results.some((r) => r.passed === false)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Smoke test stopped.");
  process.exitCode = 1;
});
