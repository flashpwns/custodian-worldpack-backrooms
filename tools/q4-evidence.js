"use strict";

const VERSION = "yellow-beast-q4-evidence@v1";
const clone = (value) => structuredClone(value);
const FORBIDDEN = /hidden_trajectory|trajectory|latent_condition|future escalation|unrevealed|objective hidden/i;

function observerSafeCaptureFacts(input = {}) {
  const facts = { visible_scene: input.visible_scene ?? "field observation", visible_personnel: clone(input.visible_personnel ?? []), visible_objects: clone(input.visible_objects ?? []), camera_angle: input.camera_angle ?? "field record", device: input.device ?? "recording-device", media: input.media ?? "field record", lighting: input.lighting ?? "observed lighting", capture_state: input.capture_state ?? "recorded" };
  if (FORBIDDEN.test(JSON.stringify(facts))) throw Object.assign(new Error("hidden state is not valid capture context"), { code: "EVIDENCE_CONTEXT_HIDDEN_STATE" });
  return facts;
}
function fallbackCapture(facts = {}) { return { version: VERSION, kind: "schematic-capture", status: "fallback", label: "Observer-safe field capture", facts: observerSafeCaptureFacts(facts), provenance: "local-deterministic-fallback" }; }
function generationRequest(facts = {}) { return { version: VERSION, status: "not-requested", source_facts: observerSafeCaptureFacts(facts), result: null, fallback: fallbackCapture(facts), provenance: "generation-boundary-no-provider" }; }
function publicEvidence(expedition, observer = null, endpoint = "player") { return (expedition?.evidence ?? []).filter((item) => endpoint !== "standard" || item.available_to_standard === true).map((item) => ({ id: item.id, type: item.type, mission_id: expedition.mission?.id ?? null, capture_event: item.capture_event ?? "evidence.recorded", device: item.device ?? "field recording device", observer: item.creator, location: item.location ?? null, time: clone(item.captured_at ?? { interval: item.interval ?? 0 }), provenance: item.provenance, storage: item.storage ?? "unknown", access: endpoint === "standard" ? "Standard received returned/delivered record" : observer ? "observer-owned field record" : "restricted field record" })); }
module.exports = { VERSION, observerSafeCaptureFacts, fallbackCapture, generationRequest, publicEvidence };
