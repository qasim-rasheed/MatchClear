import { mkdir, access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Offline video assembly only. Screens are captured from the running app with browser tools.
const scenes = [
  {
    file: "01-intro.png",
    seconds: 10,
    text: "MatchClear: preview team shirts and plan the whole tournament before ordering.\\NGuided walkthrough assembled from captured working application states.",
  },
  {
    file: "06-youcam-results.png",
    seconds: 16,
    text: "Actual saved YouCam Clothes V3 outputs from permitted stock photographs.\\NPresentation crops omit lower garment labels. Saved files are unchanged.",
  },
  {
    file: "07a-review-ordinary.png",
    seconds: 4,
    text: "Inspect accepted preview evidence before recording a decision.\\NThis example's confirmed regions cover central fabric, not the whole garment.",
  },
  {
    file: "07b-review-grayscale.png",
    seconds: 4,
    text: "Grayscale screening view of the confirmed regions.\\NScreening views do not certify physical colours or on-field visibility.",
  },
  {
    file: "07c-review-protan.png",
    seconds: 4,
    text: "Protan model view, calculated in linear sRGB.\\NThe reviewer decides; a model view does not automatically approve a matchup.",
  },
  {
    file: "07d-review-deutan.png",
    seconds: 4,
    text: "Deutan model view. Reviews save the exact images, regions and transform version.\\NChanging the source evidence invalidates dependent approvals.",
  },
  {
    file: "02-owned.png",
    seconds: 10,
    text: "Separate SYNTHETIC four-team case: supplied decisions and illustrative prices.\\NStarting with owned shirts leaves one supplied opposing-pair rejection.",
  },
  {
    file: "03-local-fix.png",
    seconds: 12,
    text: "A EUR 144 navy purchase fixes the first match but breaks the next matchup.\\NA locally cheaper change can move the conflict elsewhere in the tournament.",
  },
  {
    file: "04-global-plan.png",
    seconds: 14,
    text: "The production planner finds a complete EUR 216 selection within EUR 300.\\NNorthbank buys white; Old Town reuses its owned navy spare. Synthetic inputs.",
  },
  {
    file: "05-fixed-choice.png",
    seconds: 10,
    text: "Keeping Old Town in white leaves no valid plan within the EUR 300 budget.\\NThe planner reports the conflict rather than silently relaxing the fixed choice.",
  },
  {
    file: "08-benchmark.png",
    seconds: 12,
    text: "500 seeded synthetic cases matched independent exhaustive enumeration.\\NThis checks planner correctness, not user benefit, real savings or accessibility.",
  },
  {
    file: "09-real-plan.png",
    seconds: 10,
    text: "Back to the actual stock-photo workflow: a confirmed EUR 408 plan.\\NQuantities, stock and prices are supplied development records, not live retail data.",
  },
  {
    file: "10-order-brief.png",
    seconds: 12,
    text: "Export a frozen seller brief with designs, sizes, quantities and costs.\\NPerson previews are excluded by default. Solo builder testing; no participant-study claims.",
  },
];
function assTime(seconds: number) {
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.00`;
}
async function main() {
  const root = resolve(".local/submission"),
    draft = "matchclear-captioned-walkthrough.mp4",
    output = "matchclear-demo-final.mp4";
  for (const scene of scenes) await access(resolve(root, "screenshots", scene.file));
  try {
    await access(resolve(root, output));
    if (!process.argv.includes("--overwrite"))
      throw new Error(
        "The video already exists. Use --overwrite only after reviewing that destination.",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(root, { recursive: true });
  let elapsed = 0;
  const dialogues = scenes.map((scene) => {
    const line = `Dialogue: 0,${assTime(elapsed)},${assTime(elapsed + scene.seconds)},Default,,0,0,0,,${scene.text}`;
    elapsed += scene.seconds;
    return line;
  });
  await writeFile(
    resolve(root, "captions.ass"),
    `[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 864\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,23,&H00FFFFFF,&H00FFFFFF,&H0021342A,&H0021342A,0,0,0,0,100,100,0,0,1,0,0,2,38,38,35,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${dialogues.join("\n")}\n`,
  );
  await writeFile(
    resolve(root, "scenes.ffconcat"),
    "ffconcat version 1.0\n" +
      scenes.map((s) => `file 'screenshots/${s.file}'\nduration ${s.seconds}\n`).join("") +
      `file 'screenshots/${scenes.at(-1)!.file}'\n`,
  );
  await promisify(execFile)(
    "ffmpeg",
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "scenes.ffconcat",
      "-vf",
      "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xf8f8f4,pad=1280:864:0:0:color=0x21342a,tpad=stop_mode=clone:stop_duration=3,subtitles=captions.ass",
      "-r",
      "24",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-t",
      String(elapsed),
      draft,
    ],
    { cwd: root, maxBuffer: 4_000_000 },
  );
  // PNG concat demuxers may shorten the last still; pad a closing hold to the exact caption end.
  await promisify(execFile)(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      draft,
      "-vf",
      "tpad=stop_mode=clone:stop_duration=3",
      "-t",
      String(elapsed),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      output,
    ],
    { cwd: root, maxBuffer: 4_000_000 },
  );
  await writeFile(
    resolve(root, "video-manifest.json"),
    JSON.stringify(
      {
        version: 1,
        seconds: elapsed,
        kind: "captioned-working-screen-walkthrough",
        output,
        scenes,
        limitations:
          "Captured working states assembled offline, not a new real-time generation or independent user test. No narration, music or external uploads. Source model: Monstera Production/Pexels 6311639; garment references: Dmitriy Steinke/Pexels 20669538 and 36392069. See API_INTEGRATION.md for source/permission notes.",
      },
      null,
      2,
    ),
  );
  console.log(`${elapsed}-second captioned walkthrough created: ${resolve(root, output)}`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Video assembly failed.");
  process.exitCode = 1;
});
