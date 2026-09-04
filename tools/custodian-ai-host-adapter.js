"use strict";

const { executeLivingTurn } = require("./ai-living-turn");

const VERSION = "custodian-ai-gameplay-host-adapter@v1";
const TURN_VERSION = "custodian-ai-gameplay-host-turn@v1";

function memberId(member) { return member?.personnel_id ?? member?.id ?? null; }

function dialogueFor(run, living) {
  const names = new Map((run.expedition?.team?.members ?? []).map((member) => [memberId(member), member.display_name ?? member.first_name ?? "Coworker"]));
  return (living.presentation?.npc_presentations ?? []).filter((item) => item.speech).map((item) => ({ speaker: names.get(item.observer_id) ?? "Coworker", text: item.speech }));
}

function canonicalEventRefs(living) {
  const resolution = living.resolution ?? {};
  return [...new Set([
    resolution.interval_id,
    ...(resolution.outcomes ?? []).flatMap((outcome) => [outcome.interval_id, outcome.evidence_id])
  ].filter(Boolean).map(String))];
}

async function emitTrace(sink, value) {
  if (typeof sink !== "function") return;
  try { await sink(structuredClone(value)); } catch { /* Developer diagnostics cannot affect play. */ }
}

function createCustodianAIHostAdapter() {
  return Object.freeze({
    version: VERSION,
    async runTurn({ session: run, observer, player_input, generate, trace }) {
      if (!run || observer !== run.session?.startup?.player?.observer_id) throw new Error("HOST_OBSERVER_MISMATCH");
      if (typeof generate !== "function") throw new Error("HOST_GENERATOR_REQUIRED");
      const living = await executeLivingTurn({
        run,
        player_text: player_input,
        interpreter: { name: "custodian-host", interpret: (request) => generate({ phase: "interpretation", request }) },
        presentation_provider: { name: "custodian-host", present: (request) => generate({ phase: "presentation", request }) }
      });
      const resolved = living.status === "resolved";
      const reason = resolved ? living.resolution?.public_reason ?? null : living.interpretation?.question ?? living.resolution?.result?.public_reason ?? "The attempted turn was not committed.";
      const environment = resolved ? living.presentation.scene_description : reason;
      const turn = {
        version: TURN_VERSION,
        status: living.status,
        player_input,
        action_outcome: resolved ? living.resolution?.outcome ?? "resolved" : living.status,
        reason,
        environment,
        dialogue: resolved ? dialogueFor(run, living) : [],
        canonical_event_refs: resolved ? canonicalEventRefs(living) : []
      };
      await emitTrace(trace, {
        version: "yellow-beast-custodian-host-trace@v1",
        player_input,
        status: living.status,
        phase_order: living.trace,
        validation: living.validation ?? null,
        canonical_event_refs: turn.canonical_event_refs
      });
      return { ok: true, session: run, turn, diagnostics: living.validation?.accepted === false ? [{ code: living.validation.code }] : [] };
    }
  });
}

module.exports = { VERSION, TURN_VERSION, createCustodianAIHostAdapter };
