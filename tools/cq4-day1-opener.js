"use strict";

const crypto = require("node:crypto");
const definition = require("../data/worldpacks/clear-q4/cq4-day1-opener.json");

const VERSION = definition.version;
const SCENARIO = definition.scenario;
const RUNTIME_SCENARIO = definition.runtime_scenario;
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const ONE_SHOT_EVENTS = Object.freeze([
  "briefing_date_card",
  "maxwell_opening_briefing",
  "intern_greets_player",
  "surveyor_greets_player",
  "doctor_greets_player",
  "radio_check_initial_cue",
  "radio_check_tone_feedback",
  "threshold_approach_rumble",
  "threshold_door_parting",
  "crossing_cutscene",
  "complex_acoustic_transition",
  "tape_discovery_cue",
  "outpost_a_revealed",
  "duffle_drop_acknowledge",
  "intern_completion_quip",
  "return_route_familiarity_cue",
  "kv31_return_chime",
  "cold_boot_state_preserved"
]);

function isOneShotConsumed(run, eventId) {
  if (!isOpener(run?.scenario)) return false;
  return Boolean(run?.expedition?.day1_opener?.one_shot_events?.[eventId]?.consumed);
}

function markOneShotConsumed(run, eventId, metadata = {}) {
  if (!isOpener(run?.scenario)) return false;
  run.expedition ??= {};
  run.expedition.day1_opener ??= {};
  run.expedition.day1_opener.one_shot_events ??= {};
  run.expedition.day1_opener.one_shot_events[eventId] = {
    consumed: true,
    at_interval: run.expedition.clock?.interval ?? 0,
    consumed_at: new Date().toISOString(),
    ...metadata
  };
  return true;
}

function ensureWorldOutpostGeography(world) {
  if (!world || typeof world !== "object") return null;
  if (world.q4_day1_geography) {
    return world.q4_day1_geography;
  }
  const seed = String(world.seed ?? "day1-opener");
  const hash = digest([seed, "outpost-a-geometry"]);
  const seedNum = Number.parseInt(hash.slice(0, 8), 16) >>> 0;
  const dx = 120 + (seedNum % 60);
  const dy = ((seedNum % 5) - 2) * 40;
  const geography = {
    version: VERSION,
    location_id: "outpost-a",
    name: "Outpost A (Bermuda Branch)",
    coordinates: { x: 580 + dx, y: 130 + dy, level: 0 },
    seed,
    created_at: new Date().toISOString()
  };
  world.q4_day1_geography = geography;
  return geography;
}

function validate() {
  if (VERSION !== "yellow-beast-cq4-opener@v1" || definition.id !== "clear-q4-day1-opener") {
    throw new Error("unsupported CQ4 Day 1 Opener definition");
  }
  if (definition.staffing.total !== 4 || definition.staffing.coworker_roles.length !== 3) {
    throw new Error("CQ4 Day 1 Opener staffing must be exactly player plus three coworkers");
  }
  return true;
}

function isOpener(value) {
  return value === SCENARIO || value === RUNTIME_SCENARIO || value === "day1-opener" || value === "cq4-day1-opener";
}

function staffingRules(base = {}) {
  validate();
  return { ...base, ...clone(definition.staffing) };
}

function mission({ run_id = null, seed = "day1-opener", staffing = null } = {}) {
  validate();
  const authored = definition.mission;
  const hash = digest([seed, run_id]).slice(0, 8).toUpperCase();
  return {
    version: "yellow-beast-q4-missions@v2",
    id: `CQ4-DAY1-${hash}`,
    display_id: "CQ4-DAY1-001",
    specimen_id: definition.id,
    assignment_authority: "ASYNC / Standard",
    family: authored.family,
    family_label: authored.family_label,
    authority: {
      classification: "authoritative-canonical-opener",
      source_claim_ids: [],
      provenance: "cq4-day1-locked-design-law"
    },
    rationale: authored.rationale,
    site: clone(authored.site),
    objective: {
      primary: authored.primary,
      procedures: clone(authored.procedures),
      completion_criteria: [
        "Enter the Complex through KV31 Threshold Chamber.",
        "Reach Outpost A (Bermuda branch).",
        "Deliver the startup prerequisite materials in Outpost A.",
        "Return through KV31 before 12:00."
      ]
    },
    assigned_personnel: staffing?.team?.map((person) => person.identity) ?? [],
    required_equipment: ["field-camera", "field-light", "startup-materials-duffle", "layout-record"],
    operational_window: clone(definition.operational_window),
    briefing_authority: clone(definition.briefing_authority),
    reporting: {
      check_ins: [
        "Complete formal radio check upstairs in KV31 Threshold Chamber prior to departure.",
        "Transmit formal 2-second hold check-in once every Standard hour.",
        "Verify return with Control Room surveillance before re-crossing."
      ],
      evidence: [
        "Retain photographic documentation of the guidance path and Outpost A.",
        "Record manifestation layout and condition observations."
      ],
      abort_conditions: [
        "Return immediately if personnel accountability or physical safety prevents mission completion."
      ],
      summary: "Report delivery status of startup materials, route condition, and personnel accountability."
    },
    expected_duration: "10:00 AM to 12:00 noon (2 Standard hours)",
    deployment_time: definition.operational_window.deployment_time,
    expected_return_time: definition.operational_window.expected_return_time,
    risks: [
      { text: "Uncertain route geometry and potential disorientation beyond the guidance line.", knowledge_status: "known operational factor" }
    ],
    safety_constraints: clone(definition.safety_constraints),
    status: "assigned",
    run_id,
    generated_from: { seed, specimen_id: definition.id }
  };
}

function instantiate(run) {
  validate();
  if (!isOpener(run?.scenario) || !run.spatial) return run;

  // Initialize Day 1 Opener state if not present
  run.expedition ??= {};
  run.expedition.day1_opener ??= {
    version: VERSION,
    delivery_completed: false,
    delivery_location: "outpost-a",
    delivery_item: "startup-materials-duffle",
    return_surveillance_verified: false,
    check_in_held_seconds: 0,
    last_check_in_time: null,
    one_shot_events: {}
  };
  run.expedition.day1_opener.one_shot_events ??= {};

  const seed = String(run.seed ?? "day1-opener");
  const hash = digest([seed, "outpost-a-geometry"]);
  const seedNum = Number.parseInt(hash.slice(0, 8), 16) >>> 0;

  // Ensure Outpost A exists in generated_locations
  const existingOutpost = (run.spatial.generated_locations ?? []).find((loc) => loc.id === "outpost-a");
  if (!existingOutpost) {
    run.spatial.generated_locations ??= [];
    run.spatial.generated_connections ??= [];
    run.spatial.route_markers ??= [];

    // Calculate seed-dependent coordinate offset or use persistent world geography
    const worldGeo = ensureWorldOutpostGeography(run._world);
    const dx = 120 + (seedNum % 60);
    const dy = ((seedNum % 5) - 2) * 40;
    const outpostCoordinates = worldGeo?.coordinates ? clone(worldGeo.coordinates) : { x: 580 + dx, y: 130 + dy, level: 0 };

    const outpostLocation = {
      id: "outpost-a",
      name: "Outpost A (Bermuda Branch)",
      type: "outpost",
      short_description: "A forward A-Sync operational staging point under fluorescent lighting. Two folding tables sit against the drywall beside emptied boxes, wooden slats, screwdrivers, and a field radio station.",
      coordinates: outpostCoordinates,
      entry_state: "unmapped",
      environment: {
        lighting: "steady fluorescent tubes",
        surface: "concrete floor with adhesive remnants",
        sound: "a quiet fluorescent fixture hum"
      },
      landmarks: [
        {
          id: "outpost-a-placard",
          name: "stenciled equipment placard",
          aliases: ["placard", "stencil", "sign", "label", "stenciled equipment placard", "outpost-a-placard", "A-SYNC OUTPOST A // BERMUDA BRANCH"],
          observation: "A stenciled equipment placard reads: A-SYNC OUTPOST A // BERMUDA BRANCH.",
          inspection: "The stenciled equipment placard is riveted into the drywall: A-SYNC OUTPOST A // BERMUDA BRANCH."
        },
        {
          id: "folding-tables",
          name: "folding tables",
          aliases: ["folding-tables", "folding tables", "tables", "table", "folding table"],
          observation: "Two metal folding tables sit against the drywall with emptied boxes, wooden slats, and screwdrivers.",
          inspection: "Two metal folding tables provide an operational staging surface beside the drywall."
        },
        {
          id: "wooden-slats",
          name: "wooden slats",
          aliases: ["wooden-slats", "wooden slats", "slats", "wood slats"],
          observation: "Bundled wooden slats lean against the drywall beside the tables.",
          inspection: "Unpainted pine slats bundled with twine, left from initial outpost construction."
        },
        {
          id: "radio-interface",
          name: "radio interface",
          aliases: ["radio-interface", "radio interface", "stationary radio", "outpost radio", "radio station"],
          observation: "A stationary field radio interface unit is mounted on the folding table.",
          inspection: "A heavy field radio interface bolted to the table, wired to monitor the KV31 Threshold frequency."
        },
        {
          id: "emptied-boxes",
          name: "emptied boxes",
          aliases: ["emptied-boxes", "emptied boxes", "empty boxes", "boxes", "cartons"],
          observation: "Several emptied cardboard shipping boxes rest beneath the folding tables.",
          inspection: "Corrugated boxes marked with A-Sync logistics codes, their contents already unpacked."
        },
        {
          id: "screwdrivers",
          name: "screwdrivers",
          aliases: ["screwdrivers", "screwdriver", "hand tools", "tools"],
          observation: "A set of maintenance screwdrivers lies near the edge of the folding table.",
          inspection: "Two flathead and two Phillips screwdrivers with scuffed yellow plastic handles."
        },
        {
          id: "guidance-tape-outpost",
          name: "neon-green guidance tape termination",
          aliases: ["guidance tape", "green tape", "directional tape", "tape termination"],
          observation: "The thick neon-green guidance tape terminates here on the concrete floor beside the tables.",
          inspection: "The bright green adhesive tape ends beside the folding tables, with reverse arrows pointing back toward KV31."
        }
      ],
      hazards: [],
      tags: ["field", "outpost", "mission-destination"]
    };

    const intermediateId = `corridor-bermuda-${hash.slice(0, 6)}`;
    const intermediateLocation = {
      id: intermediateId,
      name: "Bermuda Access Corridor",
      type: "corridor",
      short_description: "A wide corridor with scuffed linoleum floor under fluorescent illumination.",
      coordinates: { x: 500 + Math.floor(dx / 2), y: 130 + Math.floor(dy / 2), level: 0 },
      entry_state: "unmapped",
      environment: {
        lighting: "fluorescent tubes",
        surface: "scuffed linoleum floor",
        sound: "low electric drone"
      },
      landmarks: [
        {
          id: "guidance-tape-intermediate",
          name: "neon-green guidance tape",
          aliases: ["tape", "green tape", "guidance tape", "directional tape", "arrows"],
          observation: "Thick neon-green adhesive tape with directional arrows runs along the linoleum floor.",
          inspection: "The tape has printed black directional arrows pointing forward toward Outpost A and reverse toward KV31."
        }
      ],
      hazards: [],
      tags: ["field", "corridor", "guidance-route"]
    };

    run.spatial.generated_locations.push(intermediateLocation, outpostLocation);

    // Connections: utility-room -> intermediate -> outpost-a
    run.spatial.generated_connections.push(
      {
        id: `conn-utility-${intermediateId}`,
        from: "utility-room",
        to: intermediateId,
        direction: "east",
        reverse_direction: "west",
        relationship: "access corridor",
        transition: "The team follows the green tape along the floor through the eastern accessway.",
        reverse_transition: "The team retraces the green tape westward toward the utility room.",
        lock_state: "open",
        hazard_state: "clear",
        visibility: "visible",
        discovery: "on-traversal",
        bidirectional: true,
        aliases: ["east", "corridor", "green tape", "arrows", "accessway"]
      },
      {
        id: `conn-${intermediateId}-outpost`,
        from: intermediateId,
        to: "outpost-a",
        direction: "forward",
        reverse_direction: "back",
        relationship: "outpost threshold",
        transition: "The team follows the guidance tape through double framed doors into Outpost A.",
        reverse_transition: "The team steps out of Outpost A back into the access corridor.",
        lock_state: "open",
        hazard_state: "clear",
        visibility: "visible",
        discovery: "on-traversal",
        bidirectional: true,
        aliases: ["forward", "outpost", "double doors", "green tape"]
      }
    );

    // Physical neon-green guidance tape markers
    run.spatial.route_markers.push(
      {
        id: "tape-marker-utility",
        location: "utility-room",
        label: "Thick neon-green tape with directional arrows",
        aliases: ["tape", "green tape", "guidance tape", "directional tape", "arrows"],
        direction: "toward Outpost A",
        description: "Thick neon-green adhesive tape with printed directional arrows runs along the scuffed floor heading toward Outpost A.",
        state: "canonical-physical-object"
      },
      {
        id: "tape-marker-intermediate",
        location: intermediateId,
        label: "Thick neon-green tape with directional arrows",
        aliases: ["tape", "green tape", "guidance tape", "directional tape", "arrows"],
        direction: "pointing to Outpost A / reverse to KV31",
        description: "Thick neon-green adhesive tape with directional arrows continues along the corridor floor, pointing forward to Outpost A and reverse to KV31.",
        state: "canonical-physical-object"
      },
      {
        id: "tape-marker-outpost",
        location: "outpost-a",
        label: "Neon-green tape termination beside folding tables",
        aliases: ["tape", "green tape", "guidance tape", "directional tape", "tape termination"],
        direction: "reverse to KV31",
        description: "The neon-green tape terminates cleanly on the floor beside the folding tables, with arrows pointing back along the corridor reverse to KV31.",
        state: "canonical-physical-object"
      }
    );
  }

  return run;
}

function verifyDelivery(run) {
  if (!isOpener(run?.scenario)) return false;
  const expedition = run.expedition;

  const duffle = expedition?.equipment?.["startup-materials-duffle"]
    ?? expedition?.logistics?.items?.["startup-materials-duffle"]
    ?? Object.values(expedition?.equipment ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle")
    ?? Object.values(expedition?.logistics?.items ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle");

  if (!duffle) return false;

  // The duffle must be physically deposited at outpost-a (placed or dropped, and not currently held)
  const atOutpost = duffle.location === "outpost-a" || duffle.current_location === "outpost-a";
  const unheld = (duffle.holder == null && duffle.current_holder == null) || duffle.state === "dropped" || duffle.condition === "dropped";

  if (atOutpost && unheld) {
    if (expedition?.day1_opener) expedition.day1_opener.delivery_completed = true;
    return true;
  }
  if (expedition?.day1_opener) expedition.day1_opener.delivery_completed = false;
  return false;
}

function verifyReturn(run) {
  if (!isOpener(run?.scenario)) return false;
  const playerLoc = run.spatial?.player_location;
  const isAtKV31 = playerLoc === "utility-room" || playerLoc === "threshold-side-entry";
  const surveillanceVerified = Boolean(run.expedition?.day1_opener?.return_surveillance_verified);
  return isAtKV31 && surveillanceVerified;
}

function writeReport(run, { author = null, text, at = null } = {}) {
  if (!isOpener(run?.scenario) || run?.lifecycle !== "completed") return { ok: false, code: "OPENER_REPORT_UNAVAILABLE" };
  const body = typeof text === "string" ? text.trim() : "";
  if (!body) return { ok: false, code: "OPENER_REPORT_EMPTY" };
  if (body.length > 4000) return { ok: false, code: "OPENER_REPORT_TOO_LONG" };
  const writer = author ?? run.session?.startup?.player?.observer_id;
  if (!writer || writer !== run.session?.startup?.player?.observer_id) return { ok: false, code: "OPENER_REPORT_AUTHOR_INVALID" };
  const existing = run.expedition?.written_report;
  if (existing) return existing.text === body ? { ok: true, idempotent: true, report: clone(existing) } : { ok: false, code: "OPENER_REPORT_ALREADY_SUBMITTED" };
  const report = {
    version: "yellow-beast-opener-written-report@v1",
    id: `opener-report-${digest([run.run_id, run.expedition?.mission?.id, writer]).slice(0, 16)}`,
    mission_id: run.expedition?.mission?.id ?? null,
    run_id: run.run_id,
    author: writer,
    text: body,
    submitted_at: { interval: Number.isInteger(at) ? at : run.expedition?.clock?.interval ?? 0 },
    kind: "player-authored-claim",
    available_evidence_ids: [],
    institutional_assessment: null
  };
  run.expedition.written_report = report;
  return { ok: true, idempotent: false, report: clone(report) };
}

function assessInstitutionalRecord({ report, run, evidence_records = [] } = {}) {
  const deliveryCompleted = Boolean(run?.expedition?.day1_opener?.delivery_completed);
  const returnVerified = Boolean(run?.expedition?.day1_opener?.return_surveillance_verified);
  const interval = run?.expedition?.clock?.interval ?? 0;

  const duffle = run?.expedition?.logistics?.items?.["startup-materials-duffle"]
    ?? run?.expedition?.equipment?.["startup-materials-duffle"]
    ?? Object.values(run?.expedition?.logistics?.items ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle")
    ?? Object.values(run?.expedition?.equipment ?? {}).find((item) => item.definition_id === "startup-materials-duffle" || item.id === "startup-materials-duffle");

  const playerLoc = run?.spatial?.player_location;
  const isAtKV31 = playerLoc === "utility-room" || playerLoc === "threshold-side-entry";
  const duffleAtKV31 = duffle && (
    duffle.location === playerLoc ||
    duffle.current_location === playerLoc ||
    duffle.location === "utility-room" ||
    duffle.current_location === "utility-room" ||
    (duffle.holder && (run?.spatial?.personnel_locations?.[duffle.holder] === playerLoc || isAtKV31)) ||
    (duffle.current_holder && (run?.spatial?.personnel_locations?.[duffle.current_holder] === playerLoc || isAtKV31))
  );

  const maxInterval = run?.expedition?.mission?.operational_window?.max_intervals ?? 24;
  const isLate = interval > maxInterval;

  let status = "delivery-confirmed";
  let summary = "Startup materials confirmed delivered to Outpost A. Field reconnaissance completed with accounted return.";

  if (isLate) {
    status = "late-return";
    summary = `Expedition returned past scheduled operational window at interval ${interval}. Egress logged.`;
  } else if (!deliveryCompleted) {
    if (duffleAtKV31) {
      status = "delivery-undelivered";
      summary = "Startup materials were not delivered to Outpost A and were brought back to KV31. Mission incomplete.";
    } else {
      status = "delivery-lost-materials";
      summary = "Startup materials were not delivered to Outpost A and were unaccounted or abandoned in the Complex.";
    }
  } else if (!returnVerified) {
    status = "surveillance-unverified-return";
    summary = "Materials delivered to Outpost A, but return procedure lacked Standard visual surveillance confirmation.";
  }

  return {
    version: "yellow-beast-opener-institutional-assessment@v1",
    status,
    confidence: "institutional-intake-verified",
    summary,
    basis: {
      written_report_id: report?.id,
      delivery_completed: deliveryCompleted,
      return_verified: returnVerified,
      interval,
      evidence_ids: evidence_records.map((r) => r.id),
      duffle_recovered: Boolean(duffleAtKV31),
      is_late: isLate
    },
    claims_cause: false
  };
}

function logisticsDefinition(base) {
  const cloned = clone(base);
  cloned.item_definitions ??= [];
  if (!cloned.item_definitions.some((d) => d.id === "startup-materials-duffle")) {
    cloned.item_definitions.push({
      id: "startup-materials-duffle",
      display_name: "Startup materials duffle",
      category: "equipment",
      model: "heavy canvas startup materials duffle",
      capabilities: ["prerequisite material transport"],
      capacity_contribution: 1,
      maximum_charges: 1,
      consumable: false
    });
  }
  if (!cloned.item_definitions.some((d) => d.id === "layout-record")) {
    cloned.item_definitions.push({
      id: "layout-record",
      display_name: "Manifestation layout record",
      category: "recording",
      model: "field clipboard and layout record sheets",
      capabilities: ["layout documentation"],
      capacity_contribution: 1,
      maximum_charges: 10,
      consumable: false
    });
  }
  cloned.item_instances = [
    { id: "field-light", definition_id: "battery-lamp", assignment: { holder: "player" }, initial_container: "player-harness", initial_location: "equipment-staging", initial_charges: 6 },
    { id: "recording-device", definition_id: "field-camera", assignment: { holder: "player" }, initial_container: "player-harness", initial_location: "equipment-staging", initial_charges: 12 },
    { id: "startup-materials-duffle", definition_id: "startup-materials-duffle", assignment: { role: "field technician" }, initial_container: null, initial_location: "equipment-staging", initial_charges: 1 },
    { id: "layout-record", definition_id: "layout-record", assignment: { role: "field medical doctor" }, initial_container: null, initial_location: "equipment-staging", initial_charges: 10 },
    { id: "field-notebook", definition_id: "field-notebook", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_charges: 30 },
    { id: "spare-film", definition_id: "spare-film", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_quantity: 1 },
    { id: "route-marker-kit", definition_id: "route-marker-kit", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_charges: 8 },
    { id: "evidence-sleeves", definition_id: "evidence-sleeves", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_quantity: 4 },
    { id: "spare-battery", definition_id: "spare-battery", assignment: { holder: "institution" }, initial_container: "staging-locker", initial_location: "equipment-staging", initial_quantity: 1 }
  ];
  cloned.loadout = {
    required: ["field-light", "recording-device", "startup-materials-duffle", "layout-record"],
    optional: ["field-notebook", "spare-film", "route-marker-kit", "evidence-sleeves", "spare-battery"],
    waiver_allowed: false,
    public_recommendations: []
  };
  cloned.assigned_manifest = clone(definition.assigned_manifest);
  cloned.hard_capacity_per_person = 2;
  return cloned;
}

module.exports = {
  VERSION,
  SCENARIO,
  RUNTIME_SCENARIO,
  ONE_SHOT_EVENTS,
  validate,
  isOpener,
  staffingRules,
  mission,
  instantiate,
  ensureWorldOutpostGeography,
  isOneShotConsumed,
  markOneShotConsumed,
  verifyDelivery,
  verifyReturn,
  writeReport,
  assessInstitutionalRecord,
  logisticsDefinition
};


