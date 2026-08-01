"use strict";
const fs = require("node:fs");
const path = require("node:path");
const packageVersion = require("../package.json").version;
function report({ world, session = null, provider = "offline", note = null, platform = process.platform } = {}) {
  const q4 = session?.q4 ?? null;
  return { version: "yellow-beast-q4-tester-report@1", build_version: packageVersion, commit: process.env.GIT_COMMIT ?? "unknown", platform, world_id: world?.id ?? world?.world_id ?? null, mission_id: q4?.mission_record?.id ?? null, controlled_personnel_id: q4?.player?.name ?? null, phase: session?.phase?.phase_id ?? null, observer_safe_event_trace: [], save_schema_version: "yellow-beast-session@2", provider_status: provider, errors: [], warnings: [], tester_note: typeof note === "string" ? note.slice(0, 2000) : null, attachments: [] };
}
function writeReport(directory, input) { fs.mkdirSync(directory, { recursive: true }); const file = path.join(directory, `q4-tester-${Date.now()}.json`); fs.writeFileSync(file, `${JSON.stringify(report(input), null, 2)}\n`); return file; }
module.exports = { report, writeReport };
