"use strict";
const fs = require("node:fs");
const path = require("node:path");
const packageVersion = require("../package.json").version;
function report({ world, session = null, provider = "offline", note = null, platform = process.platform, save_schema_version = "yellow-beast-session@7", recent_public_events = [], logs = [], recovery = {} } = {}) {
  const q4 = session?.q4 ?? null;
  const providerStatus = typeof provider === "string" ? { selected: provider } : provider;
  return { version: "yellow-beast-diagnostic-record@1", build_version: packageVersion, commit: process.env.GIT_COMMIT ?? "unknown", platform, world_id: world?.id ?? world?.world_id ?? null, world_seed: world?.seed ?? null, mission_id: q4?.mission_record?.id ?? null, controlled_personnel: q4?.player?.name ?? null, phase: session?.phase?.phase_id ?? null, save_schema_version, provider_status: providerStatus, recovery, recent_public_events: recent_public_events.slice(-20), safe_renderer_state: session ? { world: session.world, mode: session.mode, phase: session.phase, q4: session.q4, available_actions: session.available_actions } : null, recent_errors: logs.filter((line) => /error|failed|damaged|unsupported/i.test(line)), recent_logs: logs.slice(-40), tester_note: typeof note === "string" ? note.slice(0, 2000) : null, redaction: "Credentials and recognizable provider keys are omitted or redacted.", attachments: [] };
}
function writeReport(directory, input) { fs.mkdirSync(directory, { recursive: true }); const file = path.join(directory, `q4-tester-${Date.now()}.json`); fs.writeFileSync(file, `${JSON.stringify(report(input), null, 2)}\n`); return file; }
module.exports = { report, writeReport };
