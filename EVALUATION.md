# Software verification and product evaluation

Automated tests verify planning, input/evidence rules, provider recovery, confirmed briefs, validated text drafts, deletion and backups. They do not establish garment fidelity or accessibility. Development walkthroughs are not participant research.

No target-user benefit or field-recognition improvement is claimed. The following study is prepared for actual adult volunteers; outreach requires separate authorization.

## Garment matrix

Use six permitted shirt designs and two consenting adult/licensed stock photos for twelve combinations. Include solid, panel and striped designs. Reserve two designs as held-out examples before optimizing the showcase. Record input IDs, permissions, model/task version, success/failure, elapsed time, estimated units, acceptance and reasons. Check colour blocks, sleeves, patterns, crest/text and altered person details. Include failures/inconclusive outputs.

```csv
case_id,design_id,person_alias,held_out,api_status,elapsed_ms,estimated_units,appearance_decision,colour_blocks,pattern,sleeves,text_marks,reason
```

Pixel differences do not establish physical colour accuracy. Use actual-wear comparison photographs where available.

## Product-only versus on-person study

1. Recruit adult organizers, players and sellers; include people with colour-vision deficiency where possible. Keep participation consent separately; use anonymous result IDs. Do not infer or diagnose colour perception.
2. Match fixtures, references, budget and stock between modes. One task uses product references alone; a matched task adds accepted on-person previews. Alternate order: odd participant IDs A then B, even IDs B then A.
3. Include held-out designs and an unresolved/poor-output case. Inconclusive is a legitimate response.
4. Observe without coaching. Record duration, completion, errors, confidence, hesitation, evidence used and whether previews changed the decision.
5. Test the complete four-team flow: setup, reviews, change/lock, affected fixtures, compute, confirm and export. Ask a seller whether the brief supports quoting an order.
6. Report actual counts and roles, including contradictory observations. LLMs and synthetic personas do not count as participants. Use descriptive results for small samples; separate solver benchmarks, provider smoke tests and human findings.

```csv
participant_alias,role,task_id,held_out,condition,condition_order,duration_seconds,decision,completed_without_help,confidence_1_to_5,observation
```

## Repeatable checks

- `npm test`: local service/logic tests, synthetic files and mocked providers; no external image uploads.
- `npm run typecheck` and `npm run build`: application checks.
- `npm run assistant:smoke -- --confirm-three-calls`: live, explicitly invoked OpenRouter check capped at three calls across runs; not an offline test. This checkout has already used all three. Results/request counter remain in ignored `.local/openrouter-smoke`. Do not reset the counter to run extra calls without a new allowance.
- `npm run data:backup`: database and referenced-photo backup with checksums; no environment file or API key is copied.
- `npm run data:restore -- --from BACKUP --to NEW_LOCAL_DIRECTORY`: verifies schema, integrity and photo hashes, writes a new inactive workspace, refuses existing destinations and holds in-progress jobs.

## Browser acceptance

- Use disposable events and synthetic assets or specifically permitted samples.
- Check proposal without mutation, explicit apply, stale-draft rejection and ordinary form fallback.
- Check missing evidence, rejected pairs, budget and locks. Do not manufacture visual approvals to claim real-world benefit.
- Confirm and export HTML/CSV/JSON. Verify quantities and charges; exclude person photos by default.
- Change price/budget: briefs remain frozen and historical; stale plans cannot produce new current confirmations/exports.
- Delete only disposable assets: originals/outputs unavailable, reviews/plans stale, late outputs discarded. Downloaded backups/briefs are independent copies and cannot be recalled.
- Check keyboard focus, errors and labels without relying on colour. Inspect laptop and smaller-screen layouts separately.

## Recorded development checks

- OpenRouter: three requests, two valid structured text results (explicit edits and clarification without edits), plus one synthetic red/blue image successfully read. This establishes basic connectivity and response behavior, not general prompt reliability, image accuracy or a quota guarantee. The application helper sends text only.
- Gemini: the earlier twelve-request attempt produced no usable response and encountered quota/rate limits. No successful Gemini image-input result is claimed. Gemini is not the active app provider.
- Automated tests use synthetic inputs and mock external responses; they do not consume provider credits.
- A browser walkthrough of the existing stock-photo development event confirmed a complete plan and generated a no-player-photo brief. These development decisions are not participant findings or physical shirt-visibility evidence.
