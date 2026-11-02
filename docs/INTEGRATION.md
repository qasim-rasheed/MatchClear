# Integration and local architecture

## YouCam Clothes V3

The implemented feature is upper-body clothing appearance preview. The provider adapter lives in `src/server/youcam/client.ts`; the durable pipeline is in `src/worker/process.ts` and `src/server/pipeline.ts`.

1. A user supplies permitted adult-person and garment JPEG/PNG photos. The server corrects orientation and normalizes private inputs.
2. Explicit generation permission creates a persisted job and reserves an estimated two units per new task.
3. The server registers each file with `POST /s2s/v2.0/file` on the fixed YouCam API origin and uploads bytes to the returned allowed signed URL. Bearer credentials are not forwarded to the upload host.
4. `POST /s2s/v2.0/task/cloth-v3` receives `src_file_id`, `ref_file_id`, `garment_category: upper_body` and `change_shoes: false`.
5. The worker saves the task ID and polls `GET /s2s/v2.0/task/cloth-v3/{task_id}`. Completed outputs are downloaded, normalized and stored privately.
6. The user inspects and accepts/rejects the output. Accepted, current previews with confirmed outlines can support recorded pair reviews. API completion alone never approves a matchup.

Known tasks resume after a restart. An uncertain submission is held for attention rather than blindly repeated. Identical completed inputs are reused. Replaced/deleted sources prevent late outputs from becoming usable evidence. Estimated units are conservative local accounting, not verified account billing.

## Planning and order output

Matchup review requires all eight views described in [COLOR_VIEWS.md](COLOR_VIEWS.md). Machado red–green and Brettel tritan transforms operate in linear sRGB. Geometry versions are separate from screening-policy versions, so broadening coverage requires re-review without regenerating images or marking the same polygon again. Previous four-view plans and decisions are historical after migration 0004.

The separate worker selects one option per team across all scheduled fixtures. Current recorded approvals, availability, sizes, allocated minimum-order extras, charges, budget and locks are constraints. Cost is minimized first, changes second. Missing evidence, infeasibility and search limits are distinct outcomes.

Supported exact-search bounds: 16 teams, 64 eligible options, 250,000 nodes and approximately two seconds. A limited search does not claim proven optimality or impossibility.

Confirmation rechecks the saved inputs and evidence. Brief snapshots preserve quantities, costs, source information and review notes. HTML/CSV/JSON are available, with person previews excluded by default. Browser printing provides PDF output; saving a PDF through the in-app browser was not verified.

## Text assistant

The optional helper uses the fixed free `nvidia/nemotron-3.5-super-vl:free` model through OpenRouter, via the AI SDK compatible adapter. It sends text only: instructions and the disclosed event fields. It does not receive photographs, private file paths or application credentials.

The floating assistant uses `/api/assistant/agent`. Contextual suggestions are computed from current saved data and the current screen, then independently recomputed on the server. Navigation, suggestions and recorded-plan explanations require no model request. Other written requests automatically use the disclosed text-only model; there is no AI-mode switch. A five-second per-event request reservation, 45-second model timeout, no automatic retries and no paid fallback limit accidental usage.

The structured action schema supports explicit teams, exact size lists, named matches, all missing pairings, budgets, fixed/unfixed choices, a planning run and a photo-free brief. Known-ID checks and domain validation produce a server-saved proposal. Applying requires explicit review, the unchanged event revision and an unapplied proposal. Multiple edits run in one SQLite transaction. Planning queues last, against the final revision, and the UI watches that specific job. Brief creation requires an already confirmed current plan; visual approvals, photo submissions, purchases and plan confirmation remain outside assistant actions.

Explanations select code-generated planner facts; outdated results are compared with the current planning inputs. Questions discard every proposed edit. Outdated suggestions/proposals, malformed model output and provider failures return readable errors without partially changing the tournament. Tests use isolated databases and mocked model transport. The new structured action prompt has not been retested against the live provider, preserving the user's limited quota.

## Local storage and access

SQLite/Drizzle stores event and evidence records. Applied migration checksums must not change. Private normalized images are under `.local/files`; `.local` and environment files are ignored by Git. Routes validate local origins/hosts, scoped asset IDs and revisions. This is a single-organizer application bound to loopback, without remote accounts or deployment.

Deletion immediately blocks local image access and invalidates dependent evidence, with retries for physical cleanup. Provider retention and already downloaded copies are separate. Backups contain private images but exclude environment keys. Restore verifies hashes/schema and writes a new inactive workspace with unfinished provider jobs held.

## Development sample sources

- Adult stock model: Monstera Production, [Pexels 6311639](https://www.pexels.com/photo/black-man-holding-t-shirt-standing-against-white-background-6311639/).
- White garment: Dmitriy Steinke, [Pexels 20669538](https://www.pexels.com/photo/hand-holds-hanger-with-t-shirt-20669538/).
- Orange garment: Dmitriy Steinke, [Pexels 36392069](https://www.pexels.com/photo/orange-t-shirt-held-on-hanger-isolated-36392069/).

The local register records the Pexels License basis for these downloads. The people are stock models, not users or endorsers. Garment references contain small labels; permission for a photograph does not by itself establish permission to feature every visible third-party mark. Use the presentation toggle to hide original references when preparing a public recording unless those marks are cleared. Private inputs/results are not bundled in the repository; other contributors supply permitted files.

The eight starter shirt drawings are original SVG illustrations. Their teams, inventories, prices and the `/proof` teaching decisions are synthetic. Numerical colour-view source attribution is in `THIRD_PARTY_NOTICES.md`.
