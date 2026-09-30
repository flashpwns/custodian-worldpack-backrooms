"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const repoRoot = path.resolve(__dirname, "..");
const { DesktopService } = require(path.join(repoRoot, "desktop/service"));
const q4Personnel = require(path.join(repoRoot, "tools/q4-personnel"));
const cq4Day1Opener = require(path.join(repoRoot, "tools/cq4-day1-opener"));
const presentationBus = require(path.join(repoRoot, "tools/presentation-bus"));

async function main() {
  console.log("=== BEGIN COMPREHENSIVE DAY 1 OPENER WALKTHROUGH PROBE ===");
  const appDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "yb-opener-audit-"));
  const service = new DesktopService({
    appDataPath,
    defaultQ4Scenario: "day1-opener"
  });

  const logEvents = [];
  const logBeat = (name, detail) => {
    console.log(`\n[BEAT: ${name}]`);
    if (detail) console.log(detail);
    logEvents.push({ beat: name, detail });
  };

  try {
    // 1. World Creation
    const worldRes = service.createWorld({ name: "Day 1 Opener Audit World", seed: "audit-seed-1994" });
    const worldId = worldRes.world.id;
    logBeat("WORLD_CREATED", `World ID: ${worldId}, Seed: audit-seed-1994`);

    // 2. Personnel Creation ("Last, First")
    const createPers = service.createQ4Personnel({
      world_id: worldId,
      first_name: "Thorne, Marcus"
    });
    assert.equal(createPers.ok, true, "Personnel creation must succeed");
    assert.equal(createPers.player.first_name, "Marcus");
    assert.equal(createPers.player.last_name, "Thorne");
    assert.equal(createPers.player.display_name, "Marcus Thorne");
    logBeat("PERSONNEL_CREATED", {
      identity: createPers.player.identity,
      name: createPers.player.display_name,
      role: createPers.player.role,
      clearance: createPers.player.clearance
    });

    // 3. Start Session (Day 1 Opener)
    const sessionRes = service.startSession({
      world_id: worldId,
      mode: "field-researcher",
      scenario: "day1-opener"
    });
    assert.equal(sessionRes.ok, true, "Session start must succeed");
    const entry = service.session(worldId, "field-researcher");
    assert.ok(entry, "Session entry must exist");
    assert.equal(entry.phase.phase_id, "BRIEFING");

    // Check Dr. Kirk Maxwell
    const canonicalWorld = service.getWorld(worldId);
    const maxwell = canonicalWorld.characters["dr-kirk-maxwell"];
    assert.ok(maxwell, "Dr. Kirk Maxwell must exist in canonical characters");
    assert.equal(maxwell.mortal, true, "Maxwell is mortal human");
    assert.equal(maxwell.deployable, false, "Maxwell must be non-deployable");
    assert.equal(maxwell.role, "Chief Expedition Briefing Authority");

    // Check Team composition & archetypes
    const team = entry.run.expedition.team.members;
    assert.equal(team.length, 4, "Team must have 4 members");
    logBeat("BRIEFING_PHASE", {
      maxwell: { name: maxwell.display_name, role: maxwell.role, clearance: maxwell.clearance },
      player: { name: team[0].display_name, role: team[0].role },
      coworker1: { name: team[1].display_name, role: team[1].role, archetype: team[1].archetype, personality: team[1].personality },
      coworker2: { name: team[2].display_name, role: team[2].role, archetype: team[2].archetype, personality: team[2].personality },
      coworker3: { name: team[3].display_name, role: team[3].role, archetype: team[3].archetype, personality: team[3].personality }
    });

    // Check Presentation Events (Briefing card & Maxwell speech)
    const initialProjection = sessionRes.projection;
    const presentationEvents = initialProjection.presentation_events || [];
    const dateCard = presentationEvents.find(e => e.type === "opener_briefing_card");
    const maxwellSpeech = presentationEvents.find(e => e.speaker === "DR. KIRK MAXWELL");
    logBeat("PRESENTATION_EVENTS_BRIEFING", {
      dateCard: dateCard?.title,
      maxwellSpoken: maxwellSpeech?.text?.slice(0, 120) + "..."
    });
    assert.ok(dateCard, "Date card event must be emitted");
    assert.match(dateCard.title, /\b1991\b.*BRIEFING/, "Briefing card must contain '1991' and 'BRIEFING'");
    assert.ok(maxwellSpeech, "Maxwell spoken briefing must be emitted");

    // Check Equipment Manifest in BRIEFING
    const equip = entry.run.expedition.equipment;
    logBeat("INITIAL_EQUIPMENT_ALLOCATION", Object.entries(equip).map(([id, item]) => ({
      id, label: item.label, holder: item.holder, location: item.location
    })));
    // Intern courier must have duffle
    const duffle = equip["startup-materials-duffle"];
    assert.ok(duffle, "Startup materials duffle must exist");
    assert.equal(duffle.holder, team[2].personnel_id, "Intern courier must hold duffle");

    // 4. Advance from BRIEFING to STAGING
    const advanceToStaging = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "READY"
    });
    assert.equal(advanceToStaging.ok, true);
    assert.equal(advanceToStaging.projection.phase.phase_id, "STAGING");
    logBeat("STAGING_PHASE", "Successfully entered STAGING");

    // Check 2-item hard capacity enforcement
    const handoffAttempt = service.submitQ4Handoff({
      world_id: worldId,
      item_id: "layout-record",
      target: entry.run.session.startup.player.observer_id
    });
    logBeat("CAPACITY_ENFORCEMENT_CHECK", {
      handoffResult: handoffAttempt.ok ? "allowed" : handoffAttempt.error.code,
      message: handoffAttempt.error?.message
    });
    assert.equal(handoffAttempt.ok, false, "3rd item handoff to player must be rejected");
    assert.equal(handoffAttempt.error.code, "PERSONNEL_CAPACITY_EXCEEDED");

    // 5. Advance from STAGING to FACILITY_TRANSIT
    const advanceToTransit = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "PROCEED"
    });
    assert.equal(advanceToTransit.ok, true);
    assert.equal(advanceToTransit.projection.phase.phase_id, "FACILITY_TRANSIT");
    logBeat("FACILITY_TRANSIT_PHASE", "Successfully entered FACILITY_TRANSIT");

    // 6. Advance from FACILITY_TRANSIT to THRESHOLD
    const advanceToThreshold = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "APPROACH"
    });
    assert.equal(advanceToThreshold.ok, true);
    assert.equal(advanceToThreshold.projection.phase.phase_id, "THRESHOLD");
    logBeat("THRESHOLD_PHASE", "Successfully entered THRESHOLD");

    // 7. Advance from THRESHOLD to STANDARD_RADIO_CHECK
    const advanceToRadioCheck = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "READY"
    });
    assert.equal(advanceToRadioCheck.ok, true);
    assert.equal(advanceToRadioCheck.projection.phase.phase_id, "STANDARD_RADIO_CHECK");
    logBeat("STANDARD_RADIO_CHECK_PHASE", "Successfully entered STANDARD_RADIO_CHECK");

    // 8. Test Radio Check 2-second hold
    // Hold under 2 seconds:
    const holdShort = service.submitQ4CheckIn({
      world_id: worldId,
      hold_duration_ms: 1200
    });
    logBeat("RADIO_CHECK_SHORT_HOLD", {
      ok: holdShort.ok,
      error: holdShort.error?.code,
      message: holdShort.error?.message
    });
    assert.equal(holdShort.ok, false);
    assert.equal(holdShort.error.code, "CHECK_IN_HOLD_INSUFFICIENT");

    // Hold >= 2 seconds:
    const holdFull = service.submitQ4CheckIn({
      world_id: worldId,
      hold_duration_ms: 2200
    });
    logBeat("RADIO_CHECK_FULL_HOLD", {
      ok: holdFull.ok,
      held_seconds: entry.run.expedition.day1_opener?.check_in_held_seconds,
      radio_check_completed: entry.run.expedition.radio_check_completed
    });
    assert.equal(holdFull.ok, true);
    assert.equal(entry.run.expedition.radio_check_completed, true);

    // Also send standard radio transmission
    const radioTx = service.submitQ4Communication({
      world_id: worldId,
      channel: "standard",
      text: "Clear-Q4 team standing by at threshold. Radio check."
    });
    assert.equal(radioTx.ok, true);
    logBeat("STANDARD_RADIO_TRANSMISSION", "Transmission acknowledged by Standard");

    // 9. Crossing the Threshold into FIELD_OPERATION
    const crossRes = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "CROSS"
    });
    assert.equal(crossRes.ok, true);
    assert.equal(crossRes.projection.phase.phase_id, "FIELD_OPERATION");
    logBeat("FIELD_OPERATION_PHASE", {
      player_location: entry.run.spatial.player_location,
      acoustic_scene: crossRes.projection.acoustic_scene
    });

    // Check Outpost A Procedural Placement
    const geo = cq4Day1Opener.ensureWorldOutpostGeography(canonicalWorld);
    logBeat("OUTPOST_A_GEOGRAPHY", {
      location_id: geo.location_id,
      coordinates: geo.coordinates,
      seed: geo.seed
    });
    assert.ok(geo.coordinates.x >= 580, "Outpost A x coordinate is valid");

    // Check Guidance Tape at utility-room
    const utilityInspect = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "INSPECT",
      target: "neon-green-guidance-tape"
    });
    logBeat("INSPECT_GUIDANCE_TAPE", {
      ok: utilityInspect.ok,
      reason: utilityInspect.result?.public_reason
    });

    // 10. Movement through Bermuda Access Corridor to Outpost A
    const moveCorridor = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "MOVE",
      target: "east"
    });
    assert.equal(moveCorridor.ok, true, "Move east into corridor must succeed");
    logBeat("MOVED_TO_CORRIDOR", `Current location: ${entry.run.spatial.player_location}`);

    // Move team to Outpost A
    const moveOutpostA = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "MOVE",
      target: "forward"
    });
    assert.equal(moveOutpostA.ok, true, "Move forward to Outpost A must succeed");
    assert.equal(entry.run.spatial.player_location, "outpost-a");
    logBeat("MOVED_TO_OUTPOST_A", `Current location: ${entry.run.spatial.player_location}`);

    // Inspect Outpost A Props (two folding tables, stationary radio, emptied boxes, wooden slats, screwdrivers, stenciled placard)
    const inspectTable = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "INSPECT",
      target: "folding-table-assembly"
    });
    logBeat("INSPECT_OUTPOST_A_TABLES", {
      ok: inspectTable.ok,
      reason: inspectTable.result?.public_reason
    });

    // Inspect Outpost A Canonical Anomaly: Clipped swivel chair & Blue boundary tape
    const inspectChair = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "INSPECT",
      target: "clipped-swivel-chair"
    });
    assert.equal(inspectChair.ok, true, "Inspect clipped chair must succeed");
    logBeat("INSPECT_CLIPPED_CHAIR", {
      ok: inspectChair.ok,
      reason: inspectChair.result?.public_reason
    });

    const inspectTape = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "INSPECT",
      target: "blue-boundary-tape"
    });
    assert.equal(inspectTape.ok, true, "Inspect blue tape must succeed");
    logBeat("INSPECT_BLUE_BOUNDARY_TAPE", {
      ok: inspectTape.ok,
      reason: inspectTape.result?.public_reason
    });

    // 11. Delivery: Coworker 2 autonomously delivers duffle upon arrival at Outpost A
    assert.equal(entry.run.expedition.day1_opener?.delivery_completed, true, "Autonomous delivery marked delivery_completed on arrival");
    assert.equal(cq4Day1Opener.verifyDelivery(entry.run), true, "Duffle delivery at outpost-a must be verified");
    logBeat("DELIVERY_VERIFIED", {
      delivery_completed: entry.run.expedition.day1_opener?.delivery_completed,
      duffleLocation: entry.run.expedition.equipment["startup-materials-duffle"]?.location,
      duffleHolder: entry.run.expedition.equipment["startup-materials-duffle"]?.holder
    });

    // 12. Return to KV31 (threshold-side-entry)
    const retrace1 = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "MOVE", target: "corridor" });
    assert.equal(retrace1.ok, true);
    const retrace2 = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "MOVE", target: "utility-room" });
    assert.equal(retrace2.ok, true);
    const retrace3 = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
    assert.equal(retrace3.ok, true);
    logBeat("RETURNED_TO_KV31", `Current location: ${entry.run.spatial.player_location}`);

    // Initiate RETURN action
    const startReturn = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "RETURN" });
    assert.equal(startReturn.ok, true);
    assert.equal(entry.phase.phase_id, "RETURN");
    logBeat("RETURN_PHASE_INITIATED", "Phase transitioned to RETURN");

    // Verify premature return fails before surveillance
    const premature = service.submitAction({ world_id: worldId, mode: "field-researcher", action: "COMPLETE_RETURN" });
    assert.equal(premature.ok, false);
    assert.equal(premature.error.code, "RETURN_SURVEILLANCE_UNVERIFIED");
    logBeat("PREMATURE_RETURN_REJECTED", "COMPLETE_RETURN rejected without surveillance");

    // Surveillance verification via radio at utility room / threshold-side-entry
    const returnRadio = service.submitQ4Communication({
      world_id: worldId,
      channel: "standard",
      text: "Clear-Q4 team returned to KV31. Outpost A delivery completed."
    });
    assert.equal(returnRadio.ok, true);
    assert.equal(entry.run.expedition.day1_opener?.return_surveillance_verified, true, "Surveillance must be verified");
    logBeat("SURVEILLANCE_VERIFIED", {
      return_surveillance_verified: entry.run.expedition.day1_opener?.return_surveillance_verified
    });

    // 13. Complete Return to enter REPORT phase
    const completeReturn = service.submitAction({
      world_id: worldId,
      mode: "field-researcher",
      action: "COMPLETE_RETURN"
    });
    assert.equal(completeReturn.ok, true);
    assert.equal(entry.phase.phase_id, "REPORT");
    logBeat("REPORT_PHASE", "Successfully entered REPORT phase");

    // 14. Submit Written Expedition Report
    const reportText = "Field Expedition CQ4-DAY1-001 Account: The team staged at 10:00 and crossed the threshold into KV31 without incident. Neon-green guidance tape was observed intact leading through the Bermuda Access Corridor. The startup materials duffle was delivered to Outpost A and secured adjacent to the folding tables. The team completed egress to KV31 under standard observation.";
    const reportRes = service.submitReferenceWrittenReport({
      world_id: worldId,
      text: reportText
    });
    assert.equal(reportRes.ok, true);
    assert.equal(entry.phase.phase_id, "DEBRIEF");
    logBeat("REPORT_SUBMITTED_AND_DEBRIEF", {
      report_id: reportRes.result.report_id,
      institutional_assessment: reportRes.result.institutional_assessment,
      aeot_inspection: reportRes.projection?.aeot_inspection,
      end_of_shift_notice: reportRes.projection?.end_of_shift_notice
    });

    assert.equal(reportRes.projection?.demo_termination, undefined, "Normal debrief must not set obsolete demo_termination");
    assert.ok(reportRes.projection?.aeot_inspection, "AEOT inspection state must be present in projection");
    assert.equal(reportRes.projection?.aeot_inspection?.active, true);
    assert.equal(reportRes.projection?.aeot_inspection?.shift_status, "END OF SHIFT");
    assert.ok(reportRes.projection?.end_of_shift_notice, "End-of-Shift notice must be present in projection");
    assert.equal(reportRes.projection?.end_of_shift_notice?.title, "END OF SHIFT");
    assert.equal(reportRes.projection?.end_of_shift_notice?.date, "JULY 17, 1991");

    // 15. Verify PDF Export
    const pdfExport = service.exportReportPdf({ world_id: worldId });
    assert.equal(pdfExport.ok, true, "Report PDF export must succeed");
    assert.ok(fs.existsSync(pdfExport.destination), "Exported PDF file must exist on disk");
    assert.ok(pdfExport.byte_length > 1000, "Exported PDF file must have realistic byte length");
    const pdfHeader = fs.readFileSync(pdfExport.destination, "latin1").slice(0, 8);
    assert.equal(pdfHeader, "%PDF-1.4", "Exported PDF file must have valid PDF-1.4 header");
    logBeat("PDF_EXPORT_VERIFIED", { destination: pdfExport.destination, byte_length: pdfExport.byte_length });

    console.log("\n=== WALKTHROUGH COMPLETED SUCCESSFULLY WITH ZERO ERRORS ===");
    console.log(`Total beats executed and verified: ${logEvents.length}`);
  } finally {
    fs.rmSync(appDataPath, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
