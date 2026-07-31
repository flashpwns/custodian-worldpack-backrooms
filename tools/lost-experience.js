"use strict";
const VERSION = "yellow-beast-lost-experience@v1";
function presentation(run, phase) { const view = run?.surroundings ?? run ?? {}; const carried = (run?.status?.carried ?? []).map((item) => ({ label: String(item).replace(/[-_]+/g, " ") })); return { version: VERSION, scene_first: true, phase_visible: false, entry_hint: phase.tutorial_context.enabled && !phase.tutorial_context.completed ? "What do you do?" : null, surroundings: { openings: (view.exits ?? []).map(() => "an opening"), sensory: [] }, carrying: carried, landmarks: [], institutional_context: null, map: null, risk: null, objective: null }; }
module.exports = { VERSION, presentation };
