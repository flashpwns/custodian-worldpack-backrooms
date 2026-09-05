"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const audio = require("../desktop/renderer/audio");

test("Acoustic Architecture exports all 7 frozen audio buses", () => {
  assert.ok(audio.AUDIO_BUSES);
  assert.equal(audio.AUDIO_BUSES.MASTER, "master");
  assert.equal(audio.AUDIO_BUSES.MUSIC, "music");
  assert.equal(audio.AUDIO_BUSES.ENVIRONMENT, "environment");
  assert.equal(audio.AUDIO_BUSES.MACHINERY, "machinery");
  assert.equal(audio.AUDIO_BUSES.COMMUNICATIONS, "communications");
  assert.equal(audio.AUDIO_BUSES.INTERFACE, "interface");
  assert.equal(audio.AUDIO_BUSES.CHARACTER, "character");
});

test("Acoustic Architecture defines all 35 frozen conceptual hooks", () => {
  const expectedHooks = [
    "boot_power", "boot_drive", "boot_relay", "boot_confirm",
    "opening_music_01", "opening_music_02", "opening_music_03",
    "ui_hover", "ui_select", "ui_back", "ui_toggle", "ui_submit", "ui_error", "ui_panel_open", "ui_panel_close",
    "facility_ambient", "lpmds_bed", "lpmds_twang_01", "lpmds_twang_02", "lpmds_twang_03", "threshold_cross_hum",
    "blast_door_release", "blast_door_open", "blast_door_open_stop", "blast_door_close", "blast_door_close_impact",
    "complex_music", "complex_hum", "threshold_beacon",
    "radio_tx_chirp", "radio_rx_cue", "radio_static", "radio_dropout",
    "localized_music_01", "localized_music_02"
  ];

  assert.equal(audio.CONCEPTUAL_HOOKS.length, 35);
  for (const hook of expectedHooks) {
    assert.ok(audio.CONCEPTUAL_HOOKS.includes(hook), `Missing conceptual hook: ${hook}`);
    assert.ok(audio.HOOK_BUS_MAP[hook], `Hook ${hook} not mapped to an audio bus`);
  }
});

test("Replaceable asset registry allows dynamic binding without code modification", () => {
  let played = false;
  const mockAsset = {
    play: () => { played = true; }
  };
  audio.registerAsset("radio_tx_chirp", mockAsset);
  assert.equal(audio.getRegisteredAsset("radio_tx_chirp"), mockAsset);

  audio.emitHook("radio_tx_chirp");
  assert.equal(played, true);

  assert.throws(() => {
    audio.registerAsset("nonexistent_hook", mockAsset);
  }, /Cannot register unknown acoustic hook/);
});

test("Spatial attenuation calculates volume and low-pass filtering based on distance and walls", () => {
  const nearOpen = audio.calculateSpatialAttenuation(5, 0);
  const distantOpen = audio.calculateSpatialAttenuation(60, 0);
  const distantOccluded = audio.calculateSpatialAttenuation(60, 3);
  const outOfRange = audio.calculateSpatialAttenuation(150, 0);

  assert.equal(nearOpen.audible, true);
  assert.ok(nearOpen.volume > distantOpen.volume);
  assert.ok(distantOpen.volume > distantOccluded.volume);
  assert.ok(distantOpen.lowPassHz > distantOccluded.lowPassHz);
  assert.equal(outOfRange.audible, false);
  assert.equal(outOfRange.volume, 0);
});

test("UI Spec Compliance: Forbidden terms cause failure and frozen vocabulary is enforced", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../desktop/renderer/index.html"), "utf8");

  // Hard blacklist terms that MUST NEVER exist anywhere in player-facing code
  const forbiddenPatterns = [
    /\bXP\b/,
    /Task Complete!/,
    /Side Objective/,
    /\bQuest\b/,
    /Submit \/ End Turn/,
    /LIVE HOSTED AI/,
    /Abandon expedition/,
    /Leave session/,
    /MODEL INTERPRETATION/
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(renderer, pattern, `Forbidden pattern ${pattern} found in renderer.js`);
    assert.doesNotMatch(surfaces, pattern, `Forbidden pattern ${pattern} found in surfaces.js`);
  }

  // index.html title must identify AEOT, not in-universe "Yellow Beast"
  assert.doesNotMatch(html, /<title>Yellow Beast<\/title>/);
  assert.match(html, /<title>ASYNC RESEARCH INSTITUTE · EXPEDITION TRACING INTERFACE<\/title>/);

  // Positive compliance checks
  assert.match(renderer, /<button type="submit"[^>]*>SUBMIT<\/button>/);
  assert.match(renderer, /TERMINATE FIELD SESSION/);
});

test("Safe interface audio hooks wired to runtime events", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // radio_tx_chirp wired to standard communication, never on local
  assert.match(renderer, /radio_tx_chirp/);
  // ui_submit wired to submission
  assert.match(renderer, /ui_submit/);
  // ui_select wired to interactions
  assert.match(renderer, /ui_select/);
  // ui_error wired to error state
  assert.match(renderer, /ui_error/);
  // boot_relay and boot_confirm wired to boot sequence
  assert.match(renderer, /boot_relay/);
  assert.match(renderer, /boot_confirm/);
});

test("Radio transmit audio contract: chirp on successful standard send only, never on local", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // Verify the condition under which radio_tx_chirp is emitted
  assert.match(renderer, /channel === "standard"/);
  assert.match(renderer, /!resultIsError\(res\)\s*&&\s*channel === "standard"/);
  // Ensure radio_tx_chirp is not emitted for local
  assert.doesNotMatch(renderer, /channel === "local"[^;]*radio_tx_chirp/);
});

test("Input separation: natural action form and comms form remain distinct DOM structures", () => {
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // Natural action form uses #natural-form
  assert.match(renderer, /id="natural-form"/);
  // Comms form uses #q4-comms-form
  assert.match(surfaces, /id="q4-comms-form"/);
  // Comms selector uses name="channel"
  assert.match(surfaces, /name="channel"/);
});

test("Mechanical channel switch presentation and audio toggle contract", () => {
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Visual mechanical slider/switch indicator
  assert.match(surfaces, /mechanical-channel-switch/);
  assert.match(surfaces, /\[■■□□\]/);
  assert.match(css, /\.mechanical-channel-switch/);
  assert.match(css, /\.switch-track/);

  // Audio wiring for toggle
  assert.match(renderer, /ui_toggle/);
});

test("Visual hierarchy: Map -> Interpretive Output -> Comms dominates operational field", () => {
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Map is positioned at grid row 1 (center-top)
  assert.match(css, /\.operational-field>\.operational-map\{grid-row:1/);
  // Field observation / Interpretive Output is positioned at grid row 2 (center-bottom)
  assert.match(css, /\.operational-field>\.field-observation\{grid-row:2\}/);
  // Interactables at row 3
  assert.match(css, /\.operational-field>\[data-testid="field-interactables"\]\{grid-row:3\}/);
  // Objectives and operational status at row 4
  assert.match(css, /\.operational-field>\.field-priority-grid\{grid-row:4\}/);
  // Comms surface occupies column 2 spanning rows (right rail)
  assert.match(css, /\.operational-field>\.communications-surface\{[^}]*grid-column:2;grid-row:1 \/ span 4/);
});

test("AEOT Palette: cold blue tokens and epistemic accents exist in CSS stylesheets", () => {
  const palette = fs.readFileSync(path.join(__dirname, "../desktop/renderer/aeot-palette.css"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Palette tokens
  assert.match(palette, /--aeot-navy-deep:\s*#060a12/);
  assert.match(palette, /--aeot-midnight-desaturated:\s*#0b1320/);
  assert.match(palette, /--aeot-line-blue:\s*#2c476d/);
  assert.match(palette, /--aeot-pale-blue:\s*#7b9ec9/);
  assert.match(palette, /--aeot-epistemic-observed-now:\s*#3ebd68/);
  assert.match(palette, /--aeot-epistemic-alert:\s*#d94b4b/);

  // Stylesheet uses cold blue vars
  assert.match(styles, /var\(--aeot-navy-deep/);
  assert.match(styles, /var\(--aeot-midnight-desaturated/);
});

test("Interpretive Heading: Dominant prose uses OBSERVATION RECORD and purges RESOLUTION", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  // Dominant prose heading is OBSERVATION RECORD
  assert.match(renderer, /<h2 id="current-scene-heading">OBSERVATION RECORD<\/h2>/);
  assert.match(renderer, /<span class="sr-only">Current scene observation record<\/span>/);

  // RESOLUTION is purged from player-facing scene resolution
  assert.doesNotMatch(renderer, /<h2 id="current-scene-heading">RESOLUTION<\/h2>/);
});

test("Natural action and comms input specifications: textarea and keyboard shortcuts", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Natural action form uses textarea
  assert.match(renderer, /<textarea name="text"/);
  // Ctrl+Enter / Cmd+Enter submits natural action
  assert.match(renderer, /\(event\.ctrlKey \|\| event\.metaKey\) && event\.key === "Enter"/);
  // Enter without Shift submits comms
  assert.match(renderer, /event\.key === "Enter" && !event\.shiftKey/);

  // Textarea styling
  assert.match(css, /\.natural-action textarea/);
});

test("Expedition loading motif: restrained 3-person walking pictogram with rear glance", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // 3-person walking pictogram: lead camera [▣], middle case [■], rear lamp/tape [◌↩]
  assert.match(renderer, /expeditionLoadingMotif/);
  assert.match(renderer, /\[▣\]/);
  assert.match(renderer, /\[■\]/);
  assert.match(renderer, /\[◌↩\]/);

  // CSS animations
  assert.match(css, /\.expedition-loading-motif/);
  assert.match(css, /@keyframes rear-glance/);
  assert.match(css, /animation:\s*rear-glance/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test("Institutional Consequence Portal for session termination forbids videogame popups", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Zero instances of videogame popups like "Are you sure?"
  assert.doesNotMatch(renderer, /are you sure\?/i);
  assert.doesNotMatch(surfaces, /are you sure\?/i);
  assert.doesNotMatch(renderer, /are you sure you want to quit/i);

  // Strict institutional consequence vocabulary
  assert.match(renderer, /showTerminationPortal/);
  assert.match(renderer, /\[RETURN TO EXPEDITION\]/);
  assert.match(renderer, /\[CONFIRM SESSION TERMINATION\]/);
  assert.match(renderer, /A-SYNC PROTOCOL KV31-C/);
  assert.match(renderer, /Institutional Consequence Warning/);

  // Styling for consequence portal
  assert.match(css, /\.termination-portal/);
  assert.match(css, /\.termination-dialog/);
  assert.match(css, /\.termination-consequence/);
});

test("Facility mechanism audio is driven only by new canonical facility events", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");
  const audio = fs.readFileSync(path.join(__dirname, "../desktop/renderer/audio.js"), "utf8");

  assert.match(renderer, /playFacilityOperationAudio/);
  assert.match(renderer, /previousFacilityOperations/);
  assert.doesNotMatch(renderer, /playCeremonialPhaseAudio/);
  assert.doesNotMatch(renderer, /toPhase ===/);
  assert.match(renderer, /YBAudio\.emitHook\("threshold_cross_hum"\)/);
  assert.match(renderer, /item\.type === "EAST_BLAST_DOOR_OPEN"/);
  assert.match(renderer, /item\.type === "EAST_BLAST_DOOR_CLOSED"/);

  // Procedural audio synthesizers defined in audio.js
  assert.match(audio, /case "facility_ambient":/);
  assert.match(audio, /case "lpmds_bed":/);
  assert.match(audio, /case "blast_door_open":/);
  assert.match(audio, /case "blast_door_close":/);
  assert.match(audio, /case "complex_music":/);
  assert.match(audio, /case "complex_hum":/);
});

test("Multipurpose Spatial / Visual Display modes: facility schematic, field survey, and media playback", () => {
  const surfaces = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");

  // Supports facility, field-survey, and media modes
  assert.match(surfaces, /data-display-mode="facility"/);
  assert.match(surfaces, /data-display-mode="field-survey"/);
  assert.match(surfaces, /data-display-mode="media"/);

  assert.match(surfaces, /projection\.q4\?\.facility_operations\?\.current/);
  assert.match(surfaces, /No canonical facility-mechanism state reported/);
  assert.doesNotMatch(surfaces, /projection\.q4\?\.interlock/);
  assert.doesNotMatch(surfaces, /const facilityNodes/);

  // CSS rules for spatial display
  assert.match(css, /\.spatial-visual-display/);
  assert.match(css, /\.facility-edge/);
  assert.match(css, /\.media-display-surface/);
});

test("TASK A Compliance: PROCEED button is unoccluded, hit-testable, and CSS rules prevent click interception", () => {
  const css = fs.readFileSync(path.join(__dirname, "../desktop/renderer/styles.css"), "utf8");
  const surfacesModule = require("../desktop/renderer/surfaces");

  // .operations-shell .structured-action must NOT be position: fixed at bottom (which could intercept clicks)
  assert.match(css, /\.operations-shell \.structured-action\{position:static;/);

  // .briefing-next .primary-action must explicitly ensure pointer-events: auto and relative z-index
  assert.match(css, /\.briefing-next \.primary-action\{[^}]*pointer-events:auto;position:relative;z-index:2/);

  // .operations-shell .q4-preparation-surface>.operational-map must be assigned to grid-column: 1
  assert.match(css, /\.operations-shell \.q4-preparation-surface>\.operational-map\{grid-column:1\}/);

  // Surfaces produces data-game-action="PROCEED" in STAGING
  const stagingProjection = {
    mode: { id: "field-researcher" },
    phase: { phase_id: "STAGING" },
    q4: {
      team: [],
      mission_record: { display_id: "CQ4-TEST" },
      channels: { standard: { available: false } },
      equipment: { required: [], optional: [] },
      facility_operations: { current: { standard_side_barrier:null, east_blast_door:null, field_release:null } },
      map: { nodes:[{ id:"equipment-staging", name:"Equipment Staging", status:"OBSERVED", current:true, coordinates:{ x:10, y:10 } }], edges:[], unresolved_exits:[] },
      current_location: { id:"equipment-staging", name:"Equipment Staging" }
    }
  };
  const stagingHtml = surfacesModule.render(stagingProjection);
  assert.match(stagingHtml, /data-game-action="PROCEED"/);
  assert.match(stagingHtml, /Proceed toward the Threshold/);
});

test("TASK B Compliance: Canonical REPORT phase renders return to Standard, custody, report requirement, and observer claim disclaimer", () => {
  const surfaces = require("../desktop/renderer/surfaces");
  const renderer = fs.readFileSync(path.join(__dirname, "../desktop/renderer/renderer.js"), "utf8");

  const reportProjection = {
    mode: { id: "field-researcher" },
    phase: { phase_id: "REPORT" },
    available_actions: [],
    q4: {
      team: [{ display_name: "Jack Rocha · YOU", role: "Team Lead · YOU", controlled: true, condition: "accounted" }],
      evidence: [{ id: "evidence-001", type: "passage-depth-measurement", storage: "archived", custody: { state: "archived" }, measurement: { value: 18, unit: "metre" } }],
      mission_record: { display_id: "CQ4-REFERENCE-001", objective: { primary: "Survey assigned passage" } }
    }
  };

  const renderedHtml = surfaces.render(reportProjection);

  // Test surface presence
  assert.match(renderedHtml, /data-testid="surface-clear-q4-report"/);
  // Four required institutional notices
  assert.match(renderedHtml, /RETURN PROCESSING RECORDED/);
  assert.match(renderedHtml, /RETURNED EVIDENCE RECORD/);
  assert.match(renderedHtml, /WRITTEN REPORT REQUIRED/);
  assert.match(renderedHtml, /Official Record Notice: The submitted report is the observer's personal account and claim/);
  assert.match(renderedHtml, /does not establish institutional ground truth unless supported through legitimate evidence/);

  // Renderer provides natural multi-line input with "SUBMIT REPORT" button and suppresses structured actions
  assert.match(renderer, /const isReport = projection\.phase\?\.phase_id === "REPORT"/);
  assert.match(renderer, /const submitButtonLabel = isReport \? "SUBMIT REPORT" : "SUBMIT"/);
  assert.match(renderer, /const hideStructured = q4Prefield \|\| isReport \|\| projection\.available_actions\.length === 0/);
});

test("TASK B Compliance: Debrief review (DEBRIEF phase) strictly decouples Written Report, Returned Evidence, and Institutional Findings", () => {
  const surfaces = require("../desktop/renderer/surfaces");

  const debriefProjection = {
    mode: { id: "field-researcher" },
    phase: { phase_id: "DEBRIEF" },
    available_actions: [],
    q4: {
      review: {
        outcome: "returned-complete",
        public_debrief_summary: "Expedition concluded.",
        written_report: {
          id: "report-123",
          author: "TEAM LEAD (YOU)",
          kind: "player-authored-claim",
          text: "The Open Passage measured 18.0 metres from the datum. This conflicts with layout sheet 17-B."
        },
        evidence: [
          { id: "evidence-001", type: "passage-depth-measurement", custodian: "institutional custody", standard_available: true, custody: { state: "archived" }, measurement: { kind: "passage-depth", value: 18, unit: "metre" } }
        ],
        institutional_findings: {
          reference_assessment: {
            status: "provisional-spatial-discrepancy",
            confidence: "provisional",
            summary: "Returned measurement records 18.0 metres from the south-wall datum; layout sheet 17-B places the parallel corridor volume from 14.0 metres.",
            basis: { written_report_id: "report-123", evidence_ids: ["evidence-001"], prior_record_ids: ["sheet-17-b"] },
            claims_cause: false
          }
        },
        assignment: { objective: "Survey assigned passage", objective_outcomes: [{ name: "Survey baseline", kind: "required", state: "satisfied" }] },
        personnel: [{ display_name: "Jack Rocha", status: "returned", last_contact: "T+10" }],
        equipment: [{ label: "Survey instrument", status: "surrendered", location: "archive" }],
        containers: []
      }
    }
  };

  const renderedDebrief = surfaces.render(debriefProjection);

  // Surface check
  assert.match(renderedDebrief, /data-testid="surface-clear-q4-debrief"/);
  assert.match(renderedDebrief, /class="debrief-triad"/);

  // Card 1: Written Report (Observer Claim)
  assert.match(renderedDebrief, /data-testid="debrief-written-report"/);
  assert.match(renderedDebrief, /OBSERVER TESTIMONY · CLAIM/);
  assert.match(renderedDebrief, /The Open Passage measured 18\.0 metres from the datum/);
  assert.match(renderedDebrief, /represents a claim and does not establish institutional ground truth/);

  // Card 2: Returned Evidence (Physical Custody)
  assert.match(renderedDebrief, /data-testid="debrief-returned-evidence"/);
  assert.match(renderedDebrief, /PHYSICAL ARCHIVE · MEASUREMENT/);
  assert.match(renderedDebrief, /passage-depth-measurement/);
  assert.match(renderedDebrief, /evidence-001/);

  // Card 3: Institutional Findings (Reference Assessment)
  assert.match(renderedDebrief, /data-testid="debrief-institutional-findings"/);
  assert.match(renderedDebrief, /STANDARD ASSESSMENT · FINDINGS/);
  assert.match(renderedDebrief, /provisional-spatial-discrepancy/);
  assert.match(renderedDebrief, /Standard evaluates returned physical evidence and prior engineering records separately from observer testimony/);
});

test("Director correction: facility presentation consumes explicit operation authority", () => {
  const experienceCode = fs.readFileSync(path.join(__dirname, "../tools/q4-experience.js"), "utf8");
  const surfacesCode = fs.readFileSync(path.join(__dirname, "../desktop/renderer/surfaces.js"), "utf8");

  assert.doesNotMatch(experienceCode, /function kv31Interlock/);
  assert.match(experienceCode, /facility_operations: facilityOperationsProjection\(expedition\)/);
  assert.doesNotMatch(surfacesCode, /phaseId === "STAGING" \? "equipment-staging"/);
  assert.doesNotMatch(surfacesCode, /south_barrier\?\.state/);
});


