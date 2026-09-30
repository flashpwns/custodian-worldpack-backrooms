"use strict";

const VERSION = "yellow-beast-canon-lexicon@v1";

const CANONICAL_LOCATIONS = Object.freeze({
  "async-briefing-room": {
    id: "async-briefing-room",
    display_name: "ASYNC Briefing Room",
    institutional_context: "Administrative briefing and assignment review in Lower Offices",
    known_destination: "Equipment Staging",
    phase: "BRIEFING"
  },
  "equipment-staging": {
    id: "equipment-staging",
    display_name: "Equipment Staging",
    institutional_context: "Controlled equipment issue and hazmat staging lockers",
    known_destination: "Threshold Approach",
    phase: "STAGING"
  },
  "threshold-approach": {
    id: "threshold-approach",
    display_name: "Threshold Approach",
    institutional_context: "Controlled transit corridor leading through maintenance wing toward Project KV31",
    known_destination: "KV31 Threshold Room",
    phase: "FACILITY_TRANSIT"
  },
  "threshold-room": {
    id: "threshold-room",
    display_name: "KV31 Threshold Room",
    institutional_context: "Staffed boundary chamber containing the Project KV31 Threshold",
    known_destination: "Threshold-Side Entry",
    phase: "THRESHOLD"
  },
  "threshold-side-entry": {
    id: "threshold-side-entry",
    display_name: "Threshold-Side Entry",
    institutional_context: "Controlled entry position and initial outpost anchor on the Complex side of the Threshold",
    known_destination: "Utility Room",
    phase: "FIELD_OPERATION"
  },
  "utility-room": {
    id: "utility-room",
    display_name: "Utility Room",
    institutional_context: "Service space under steady fluorescent illumination, initial operations staging",
    known_destination: "Open Passage survey line",
    phase: "FIELD_OPERATION"
  },
  "open-passage": {
    id: "open-passage",
    display_name: "Open Passage",
    institutional_context: "Survey line sloping away from the Utility Room south-wall datum",
    known_destination: "Lower-Level Transition",
    phase: "FIELD_OPERATION"
  },
  "columned-corridor": {
    id: "columned-corridor",
    display_name: "Columned Corridor",
    institutional_context: "Parallel corridor divided by regular square columns, acoustic observation zone",
    known_destination: "Service Bypass",
    phase: "FIELD_OPERATION"
  },
  "lower-level-transition": {
    id: "lower-level-transition",
    display_name: "Lower-Level Transition",
    institutional_context: "Descending vertical transition toward lower Complex tiers",
    known_destination: "Level 2 Boundary",
    phase: "FIELD_OPERATION"
  }
});

const CANONICAL_EQUIPMENT = Object.freeze({
  "survey-instrument": {
    id: "survey-instrument",
    display_name: "Model 17 Survey Instrument",
    purpose: "Baseline distance and alignment measurement",
    holder_role: "survey technician"
  },
  "survey-radio": {
    id: "survey-radio",
    display_name: "Standard Field Transceiver",
    purpose: "Direct two-way VHF communication with ASync Standard dispatch",
    holder_role: "team lead"
  },
  "recording-device": {
    id: "recording-device",
    display_name: "16mm Field Camera",
    purpose: "Visual evidence recording and environmental documentation",
    holder_role: "documentation specialist"
  },
  "field-light": {
    id: "field-light",
    display_name: "Portable Sealed Worklight",
    purpose: "Illumination in unpowered or low-light Complex regions",
    holder_role: "route specialist"
  },
  "marker-supplies": {
    id: "marker-supplies",
    display_name: "Route Marker Supplies",
    purpose: "Establishing and securing return route guide lines",
    holder_role: "route specialist"
  }
});

// Canonical ENTITY ontology: what a named world concept IS, independent of what any observer
// currently knows about its state. Model-facing text may phrase these naturally but may never
// rename them or change their class. Classes reuse the project's existing categories; this is
// the one lexicon-level table, not a second ontology.
const ENTITY_CLASSES = Object.freeze(["person", "fixed_location", "room", "structural_feature", "fixed_transition", "equipment", "carried_item", "communication_system", "institutional_procedure", "mission_phase", "anomaly", "observation", "event"]);
const CANONICAL_ENTITIES = Object.freeze({
  threshold: Object.freeze({
    id: "threshold",
    display_name: "the Threshold",
    bare_name: "Threshold",
    entity_class: "fixed_transition",
    spatial_status: "fixed",
    portable: false,
    inventory_capable: false,
    custody_capable: false,
    crossable: true,
    connects: Object.freeze(["STANDARD", "the Complex"]),
    affordances: Object.freeze(["cross", "approach", "inspect"]),
    // Worldpack ids/landmarks that ARE this entity (internal identifiers; never model wording).
    source_ids: Object.freeze(["threshold-apparatus", "threshold"]),
    // "the Threshold" the gate -- not "Threshold Room" / "Threshold-Side Entry" / "Threshold Approach".
    mention: /\bthe threshold\b(?![- ]+(?:room|side|approach))/i,
    definition: "The Threshold is ASYNC's fixed gate between STANDARD and the Complex. It is part of the facility: it cannot be carried, held, handed over or found like an object."
  })
});
const normalizeEntityRef = (ref) => String(ref ?? "").toLowerCase().replace(/^[a-z]+:/, "").trim();
/** The canonical entity a worldpack id/label denotes, or null. */
function resolveCanonicalEntity(ref) {
  const key = normalizeEntityRef(ref);
  if (!key) return null;
  return Object.values(CANONICAL_ENTITIES).find((entity) => entity.source_ids.includes(key) || entity.display_name.toLowerCase() === key || entity.bare_name.toLowerCase() === key) ?? null;
}
/** Canonical entities a piece of text mentions BY THEIR CANONICAL NAME. */
function entitiesMentioned(text) {
  return Object.values(CANONICAL_ENTITIES).filter((entity) => entity.mention.test(String(text ?? "")));
}

const FORBIDDEN_TERMINOLOGY = Object.freeze([
  { pattern: /\bthreshold\s+apparatus\b/i, replacement: "the Threshold", reason: "Invented substitute for a canonical fixed transition; the Threshold is a fixed gate, not an apparatus or object" },
  { pattern: /\b(?:portal|gateway|dimensional|transition)\s+(?:device|machine|apparatus)\b/i, replacement: "the Threshold", reason: "Generic substitute for the canonical Threshold" },
  { pattern: /\bthreshold\s+side\b(?!-entry)/i, replacement: "Threshold-Side Entry", reason: "Fuzzy colloquialism; use exact location Threshold-Side Entry or Complex side" },
  { pattern: /\bfacility\s+side\b/i, replacement: "KV31 Threshold Room", reason: "Vague location improvisation; use KV31 Threshold Room or controlled facility" },
  { pattern: /\bsafe\s+side\b/i, replacement: "controlled facility", reason: "Gamey/vague term; use controlled facility or KV31 Threshold Room" },
  { pattern: /\bbackrooms\s+dimension\b/i, replacement: "Complex", reason: "Forbidden internet-lore term; use Complex or Project KV31" },
  { pattern: /\bportal\s+room\b/i, replacement: "KV31 Threshold Room", reason: "Video game terminology; use KV31 Threshold Room" },
  { pattern: /\bmission\s+hub\b/i, replacement: "ASYNC Briefing Room", reason: "Video game terminology; use institutional facility names" },
  { pattern: /\bspawn\s+area\b/i, replacement: "controlled facility", reason: "Video game terminology; use institutional facility names" },
  { pattern: /\blevel\s+entrance\b/i, replacement: "Complex Entry", reason: "Video game terminology; use Complex Entry or Threshold" },
  { pattern: /\bbase\s+zone\b/i, replacement: "controlled facility", reason: "Video game terminology; use institutional facility names" },
  { pattern: /\bnpc\b/i, replacement: "coworker", reason: "Developer terminology; use coworker or field personnel" },
  { pattern: /\bquest\b/i, replacement: "assigned survey", reason: "Video game terminology; use assigned survey or procedure" },
  { pattern: /\bplayer\s+character\b/i, replacement: "team lead", reason: "Developer terminology; use team lead or field researcher" },
  { pattern: /\bllm\b/i, replacement: "systems analysis", reason: "Internal implementation terminology" },
  { pattern: /\bai\s+model\b/i, replacement: "institutional analysis", reason: "Internal implementation terminology" },
  { pattern: /\bruntime\s+id\b/i, replacement: "designation", reason: "Developer terminology" },
  { pattern: /\baction\s+id\b/i, replacement: "operational procedure", reason: "Developer terminology" }
]);

function getLocationDescriptor(locationId) {
  if (!locationId) return null;
  return CANONICAL_LOCATIONS[locationId] ?? {
    id: locationId,
    display_name: locationId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    institutional_context: "Declared operational sector",
    known_destination: null,
    phase: "FIELD_OPERATION"
  };
}

module.exports = {
  VERSION,
  CANONICAL_LOCATIONS,
  CANONICAL_EQUIPMENT,
  ENTITY_CLASSES,
  CANONICAL_ENTITIES,
  resolveCanonicalEntity,
  entitiesMentioned,
  FORBIDDEN_TERMINOLOGY,
  getLocationDescriptor
};
