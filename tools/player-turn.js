"use strict";
const { executeNatural } = require("./ai-adapter");
const { buildSafeScene, narrateScene } = require("./scene-presentation");
const VERSION = "yellow-beast-player-turn@v1";
async function executePlayerTurn({ run, mode = run.profile_id, provider, narration_provider = null, player_text, request_id }) {
  const natural = await executeNatural({ run, provider, player_text, request_id });
  const status = natural.intent.status === "interpretation_error" ? "INTERPRETATION_ERROR" : natural.grounded_intent?.clarification_required ? "CLARIFICATION_REQUIRED" : !natural.consequence ? "IMPOSSIBLE" : !natural.consequence.result.accepted ? "FAILED" : natural.consequence.result.partial_steps.length ? "PARTIAL" : natural.consequence.result.interrupted_steps.length ? "INTERRUPTED" : "RESOLVED";
  const scene = buildSafeScene({ run, mode, input: player_text, consequence: natural.consequence, scene_type: natural.executed ? "delta" : "observation" });
  const narration = await narrateScene({ scene, provider: narration_provider });
  return { version: VERSION, request_id, submitted_text: player_text, status, clarification: natural.grounded_intent?.clarification ?? natural.intent.clarification ?? null, scene, narration, save_required: Boolean(natural.consequence?.result.accepted), safe_diagnostics: { executed: natural.executed, duplicate: Boolean(natural.consequence?.result.duplicate) } };
}
module.exports = { VERSION, executePlayerTurn };
