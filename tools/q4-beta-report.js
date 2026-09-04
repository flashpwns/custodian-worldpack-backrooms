"use strict";
const fs = require("node:fs");
const path = require("node:path");
const packageVersion = require("../package.json").version;
function report({ world, session = null, provider = "offline", build = null, interpretation_provenance = [], note = null, platform = process.platform, save_schema_version = "yellow-beast-session@7", recent_public_events = [], logs = [], recovery = {}, phenomenon_diagnostics = null, environment_diagnostics = null, render_diagnostics = [] } = {}) {
  const q4 = session?.q4 ?? null;
  const providerStatus = typeof provider === "string" ? { selected: provider } : { selected:provider?.selected, offline:Boolean(provider?.offline), configured:Boolean(provider?.configured), status:provider?.status };
  const hostedInvocations = interpretation_provenance.filter((record) => record?.provider_invoked === true).slice(-40);
  return { version: "yellow-beast-diagnostic-record@1", build_version: build?.version ?? packageVersion, commit: build?.commit ?? process.env.GIT_COMMIT ?? "unknown", build:build ?? null, platform, world_id: world?.id ?? world?.world_id ?? null, world_seed: world?.seed ?? null, mission_id: q4?.mission_record?.id ?? null, controlled_personnel: q4?.player?.name ?? null, phase: session?.phase?.phase_id ?? null, save_schema_version, provider_status: providerStatus, hosted_invocation_provenance:hostedInvocations, interpretation_provenance:interpretation_provenance.slice(-60), recovery, phenomenon_diagnostics, environment_diagnostics, render_diagnostics, recent_public_events: recent_public_events.slice(-20), safe_renderer_state: session ? { world: session.world, mode: session.mode, phase: session.phase, q4: session.q4, available_actions: session.available_actions } : null, recent_errors: logs.filter((line) => /error|failed|damaged|unsupported|unavailable|\b429\b|no credits|quota/i.test(line)), recent_logs: logs.slice(-40), tester_note: typeof note === "string" ? note.slice(0, 2000) : null, redaction: "Credentials, hidden phenomenon identities, and recognizable provider keys are omitted or redacted.", attachments: [] };
}
function writeReport(directory, input) { fs.mkdirSync(directory, { recursive: true }); const file = path.join(directory, `q4-tester-${Date.now()}.json`); fs.writeFileSync(file, `${JSON.stringify(report(input), null, 2)}\n`); return file; }
module.exports = { report, writeReport };
