# Reader Phase 2 machine assistance

Current dialogue readiness and the 2026-10-05 provenance audit are authoritative in `../dialogue/DIALOGUE_CLOSURE_STATUS.md`. The historical machine runs below retain their original evidence and authority.

Separate development-only machine candidates for the existing frozen 474-render census. This does not amend the preregistration, label schema, registry, scoring gates, human workstation, or gold eligibility. Machine consensus cannot establish accuracy or teacher ceiling and does not replace the preregistered human-gold experiment.

The runner reuses hostedArm, its retry policy and durable receipts, frozen renderReaderPrompt inputs, and validateGoldFrame (V0–V3 plus resolveTurn). Offline capture is regenerated in memory solely for mechanical validation; legacy outputs are excluded from model inputs and are never used to propose labels. Only the frozen system and user text are transmitted. Reviewer receives no teacher candidate.

Outputs live in an exclusive machine-run directory under .agent-notes/reader-phase2-labeling. Every candidate preserves routed and response model identities, actual timestamp, render digest, raw wire, mechanical validity, and transport status. Confidence is null because the frozen prompt supplies no calibrated confidence. Full normalized wire agreement on ACCEPT becomes MODEL_CONSENSUS, never human gold. Clarifications, disagreements, and malformed responses go to exceptions; items awaiting a provider or with unavailable transport are separately pending. No suggestions enter the blind human primary UI. Any human reviewing these machine suggestions must not later be represented as a blind primary.

## Execute

Use tools/dialogue-reader-machine-labeling-electron.js through the repo Electron binary to read saved credentials with the existing CredentialStore, or run tools/dialogue-reader-machine-labeling.js with provider keys already available in the process environment. Never put secrets in command arguments, output artifacts, or chat. The Electron bridge creates no service or windows and exports no credential.

Required execution flags: --run --confirm-egress --reviewer-model <owner-selected Claude model> --max-output-tokens 8192. --teacher-only permits teacher candidates while reviewer access is blocked. Teacher identity remains the frozen registry identity; unsupported identity is a blocker, never silently substituted. --include-human-trace is separate explicit consent; otherwise 19 human-trace renders are excluded. OpenAI store:false is enforced; retention/training remains unknown unless separately verified. The 8192 output-token budget and high OpenAI reasoning effort are diagnostic run choices, not frozen scoring semantics.

The owner approved the OpenRouter route for the full 474-item machine run, with explicit provenance and no governance changes. Use --openrouter --reviewer-model anthropic/claude-opus-5.5; teacher requests name openai/gpt-5.6-sol. Identities preserve the original registry selection separately from the actual routing provider/model. The request body sends store:false through the OpenAI-compatible adapter; this does not establish provider retention or training policy.

The same three deterministic stratified pilot items run through both models before census fan-out. Every pilot candidate must pass the existing mechanical decoder, V0–V3 and resolver checks; transport availability alone does not pass the pilot. Completed malformed output is retained without semantic retry. Resume with --resume --out <existing machine-run directory> and identical configuration; completed rows are revalidated locally without being regenerated. Each continuation gets exclusive receipts and reports. Truncated JSONL fails closed.

## Validation

node --test tests/ed33f-reader-machine-labeling.test.js tests/ed33c-reader-phase2-step01.test.js

The audited workstation tests contain two assumptions that real labels/journal files do not exist. On this checkout those assertions fail because one preexisting HUMAN_PRIMARY label and its journal are preserved. The runner never deletes them to satisfy tests.

## Separate local route

`node tools/dialogue-reader-local-labeling.js` inventories installed Ollama Qwen 3.5 9B and the pinned Gemma 4 E4B appliance, then uses only observer-safe frozen render inputs. It benchmarks five varied items before a census run, runs sequentially with a 4096-token context, and stops a route on resource pressure or repeated malformed output. No download is performed. Local output remains machine-only; it never rewrites the frozen OpenAI teacher or human-gold rules. A second suitable distinct local model may review, but is not required for teacher completion.

The 2026-10-03 local run is preserved under `.agent-notes/reader-phase2-labeling/machine-run-local-2026-10-03T09-43-41-513Z/`. Qwen was stopped after one malformed output and a large swap increase. Gemma passed the five-item pilot and completed 474 generations: 352 mechanically valid (315 ACCEPT, 37 EXPECTED_CLARIFY), 122 invalid (93 V2, 20 V1, 9 decode failures), zero pending. The exception queue has 159 rows, including the 37 valid clarification cases. All ACCEPT rows are explicitly unreviewed machine candidates. No independent reviewer completed a suitable pilot, no confidence probability is claimed, and no human/gold row was created. Detailed pilot/resource receipts and saved-result validation accompany the run.

Local tests: `node --test tests/ed33g-reader-local-labeling.test.js tests/ed33f-reader-machine-labeling.test.js tests/ed33c-reader-phase2-step01.test.js`.
