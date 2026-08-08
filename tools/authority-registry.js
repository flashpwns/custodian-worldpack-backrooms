"use strict";

// Runtime authority is explicit and auditable.  This registry deliberately
// excludes reports, fixtures, roadmaps, logs, and obsolete drafts.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFINITIONS = [
  ["simulation-doctrine", "SIMULATION_DOCTRINE.md", "constitutional", "simulation causality, ontology, observer boundary", "all", "required"],
  ["design-charter", "docs/YELLOW_BEAST_1.0_DESIGN_CHARTER.md", "design-authority", "Yellow Beast runtime contract", "all", "required"],
  ["ai-interface-contract", "docs/ai-interface-contract.md", "runtime-contract", "bounded interpretation and grounding", "interpretation", "required"],
  ["ai-provider-boundary", "docs/ai-provider.md", "provider-contract", "provider behavior and fallback", "interpretation", "required"],
  ["worldpack-clear-q4-manifest", "data/worldpacks/clear-q4/worldpack.json", "worldpack-canon", "active worldpack identity and record map", "clear-q4", "required"],
  ["worldpack-clear-q4-operation", "data/worldpacks/clear-q4/operation.json", "worldpack-canon", "canonical operation and phase rules", "clear-q4", "required"],
  ["worldpack-clear-q4-institution", "data/worldpacks/clear-q4/institution.json", "institution-authority", "institution and STANDARD rules", "clear-q4", "required"],
  ["worldpack-clear-q4-dynamics", "data/worldpacks/clear-q4/dynamics.json", "simulation-authority", "operational dynamics", "clear-q4", "required"],
  ["worldpack-clear-q4-interactions", "data/worldpacks/clear-q4/interactions.json", "interaction-authority", "canonical interaction affordances", "clear-q4", "required"],
  ["project-terminology", "canon/terminology.json", "terminology-authority", "observer-safe labels and protected terms", "all", "required"],
  ["personnel-authority", "data/personnel-name-pools.json", "personnel-authority", "personnel identity inputs", "clear-q4", "optional"],
  ["still-life-authority", "data/still-life-behavior-authority.json", "phenomenon-authority", "bounded phenomenon behavior", "clear-q4", "optional"]
];

function hash(content) { return crypto.createHash("sha256").update(content).digest("hex"); }
function load(root, definition) {
  const [id, relativePath, classification, purpose, scope, required] = definition;
  const absolutePath = path.resolve(root, relativePath);
  try {
    const content = fs.readFileSync(absolutePath);
    if (!content.length) throw new Error("empty source");
    const text = content.toString("utf8");
    return { id, path: relativePath, classification, purpose, scope, required: required === "required", sha256: hash(content), bytes: content.length, text, last_successful_load: new Date().toISOString() };
  } catch (error) {
    return { id, path: relativePath, classification, purpose, scope, required: required === "required", sha256: null, bytes: 0, text: null, load_error: error.message, last_successful_load: null };
  }
}
function createRegistry({ root = path.resolve(__dirname, "..") } = {}) {
  const sources = DEFINITIONS.map((definition) => load(root, definition));
  const requiredFailures = sources.filter((source) => source.required && !source.text);
  return {
    version: "yellow-beast-authority-registry@v1",
    root,
    sources,
    healthy: requiredFailures.length === 0,
    required_failures: requiredFailures.map(({ id, path: sourcePath, load_error }) => ({ id, path: sourcePath, error: load_error })),
    sourceMetadata() { return this.sources.map(({ text, ...metadata }) => metadata); },
    applicable(worldpackId = "clear-q4", requestKind = "interpretation") {
      return this.sources.filter((source) => source.text && (source.scope === "all" || source.scope === worldpackId || (requestKind === "interpretation" && source.scope === "interpretation")));
    },
    assemble({ worldpackId = "clear-q4", requestKind = "interpretation", canonicalState, observerProjection, history, playerText, responseContract }) {
      const applicable = this.applicable(worldpackId, requestKind);
      if (!this.healthy) throw new Error(`Required authority unavailable: ${this.required_failures.map((item) => item.id).join(", ")}`);
      const sections = [
        { id: "simulation-doctrine", authority: "constitutional", sources: applicable.filter((item) => item.id === "simulation-doctrine").map((item) => ({ id: item.id, sha256: item.sha256, sections: "bounded doctrine sections" })), content: applicable.find((item) => item.id === "simulation-doctrine")?.text.slice(0, 48000) },
        { id: "worldpack-and-domain-authority", authority: "canonical-worldpack", sources: applicable.filter((item) => item.scope === worldpackId || item.classification === "terminology-authority" || item.classification === "design-authority" || item.classification === "runtime-contract" || item.classification === "provider-contract").map(({ id, sha256, path: sourcePath }) => ({ id, path: sourcePath, sha256 })), content: applicable.filter((item) => item.id !== "simulation-doctrine").map((item) => ({ id: item.id, sha256: item.sha256, text: item.text.slice(0, 12000) })) },
        { id: "canonical-current-state", authority: "custodian", content: canonicalState },
        { id: "observer-safe-projection", authority: "projection", content: observerProjection },
        { id: "persisted-history", authority: "history", content: history ?? [] },
        { id: "player-submission", authority: "player", content: playerText },
        { id: "response-contract", authority: "contract", content: responseContract }
      ];
      return { version: "yellow-beast-authority-context@v1", order: sections.map((section) => section.id), sources: applicable.map(({ text, ...metadata }) => metadata), sections };
    }
  };
}
module.exports = { DEFINITIONS, createRegistry };
