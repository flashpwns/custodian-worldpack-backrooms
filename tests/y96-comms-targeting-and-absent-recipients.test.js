"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DesktopService } = require("../desktop/service");
const history = require("../tools/world-history");
const personnelContinuity = require("../tools/q4-personnel-continuity");

function setupTestService(name = "targeting-test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `yb-${name}-`));
  const service = new DesktopService({
    appDataPath: root,
    defaultQ4Scenario: "reference-expedition"
  });
  const created = service.createWorld({ name, seed: "audit-target-seed-1994" });
  const world = service.getWorld(created.world.id);
  world.id = world.world_id;
  service.createQ4Personnel({ world_id: world.id, first_name: "Casey", last_name: "Morgan" });
  service.startSession({ world_id: world.id, mode: "field-researcher", scenario: "reference-expedition" });

  // Onboard into FIELD_OPERATION
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
  service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for. Radio check." });
  service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

  return { root, service, world };
}

test("y96: explicit targets resolve correctly to active roster members", () => {
  const { root, service, world } = setupTestService("valid-target");
  try {
    const entry = service.session(world.id, "field-researcher");
    const santiago = entry.run.expedition.team.members.find((m) => m.first_name === "Santiago");
    const beverly = entry.run.expedition.team.members.find((m) => m.first_name === "Beverly");

    // 1. Target by first name
    const t1 = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, status on the corridor?"
    });
    assert.equal(t1.ok, true, "Targeting by first name must succeed");
    assert.match(t1.result.public_reason, /^Santiago:/, "Santiago must be the responding speaker");

    // 2. Target by display name
    const t2 = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: beverly.display_name,
      text: "Beverly, safety review."
    });
    assert.equal(t2.ok, true, "Targeting by display name must succeed");
    assert.match(t2.result.public_reason, /^Beverly:/, "Beverly must be the responding speaker");

    // 3. Target by ID
    const t3 = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: santiago.personnel_id,
      text: "Confirm reading."
    });
    assert.equal(t3.ok, true, "Targeting by ID must succeed");
    assert.match(t3.result.public_reason, /^Santiago:/, "Santiago must be the responding speaker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y96: addressed text resolves recipient when target is null", () => {
  const { root, service, world } = setupTestService("addressed-text");
  try {
    const res = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: null,
      text: "Santiago, verify the seal on the hatch."
    });
    assert.equal(res.ok, true, "Addressed text with target null must resolve");
    assert.match(res.result.public_reason, /^Santiago:/, "Santiago must be the responding speaker");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y96: absent world character is rejected without delivering or broadcasting", () => {
  const { root, service, world } = setupTestService("absent-character");
  try {
    const q4Personnel = require("../tools/q4-personnel");
    const worldObj = service.getWorld(world.id);
    q4Personnel.ensureMaxwell(worldObj);
    service.saveCanonical(worldObj);
    const entry = service.session(world.id, "field-researcher");
    const initialReceiptCount = entry.run.expedition.communication_receipts?.length ?? 0;

    // Dr. Kirk Maxwell exists in world characters, but is not on the field team
    const res = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Dr. Kirk Maxwell",
      text: "Maxwell, do you copy from the field?"
    });

    assert.equal(res.ok, false, "Targeting an absent character must fail");
    assert.equal(res.error.code, "LOCAL_TARGET_UNAVAILABLE");
    assert.match(res.error.message, /not present|not assigned/i);

    // Assert zero receipts added and no coworker responded on his behalf
    const finalReceiptCount = entry.run.expedition.communication_receipts?.length ?? 0;
    assert.equal(finalReceiptCount, initialReceiptCount, "No receipt may be created for rejected absent target");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y96: completely unknown target is rejected with TARGET_NOT_FOUND", () => {
  const { root, service, world } = setupTestService("unknown-target");
  try {
    const res = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "GhostOperator",
      text: "Are you there?"
    });
    assert.equal(res.ok, false, "Targeting an unknown character must fail");
    assert.equal(res.error.code, "TARGET_NOT_FOUND");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y96: ambiguous target names are rejected with TARGET_AMBIGUOUS", () => {
  const { root, service, world } = setupTestService("ambiguous-target");
  try {
    const entry = service.session(world.id, "field-researcher");
    entry.run.expedition.team.members.push({
      personnel_id: "yb-fake-santiago-2",
      id: "yb-fake-santiago-2",
      first_name: "Santiago",
      last_name: "Cruz",
      display_name: "Santiago Cruz",
      role: "field technician",
      status: "active"
    });

    const res = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, which one are you?"
    });

    assert.equal(res.ok, false, "Ambiguous target name must fail");
    assert.equal(res.error.code, "TARGET_AMBIGUOUS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y96: intentional broadcasts deliver to all local peers", () => {
  const { root, service, world } = setupTestService("broadcast-comms");
  try {
    const entry = service.session(world.id, "field-researcher");
    const playerId = entry.run.session.startup.player.observer_id;
    const localPeers = entry.run.expedition.team.members.filter(m => m.personnel_id !== playerId);

    const res = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "team",
      text: "Team, take note of our positions."
    });

    assert.equal(res.ok, true, "Broadcast communication must succeed");
    for (const peer of localPeers) {
      assert.ok(
        (peer.known_information ?? []).some(k => k.text.includes("positions")),
        `Peer ${peer.first_name} must have received broadcast`
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("y96: absent coworker in subsequent operation retains history without answering", () => {
  const { root, service, world } = setupTestService("operation-transition-targeting");
  try {
    const entry = service.session(world.id, "field-researcher");
    const santiago = entry.run.expedition.team.members.find((m) => m.first_name === "Santiago");
    assert.ok(santiago, "Santiago must be on Operation 1 roster");

    // Turn 1: Personal disclosure to Santiago
    const t1 = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, note that I have asthma and get nervous in tight spaces."
    });
    assert.equal(t1.ok, true);
    const santiagoCharOp1 = service.getWorld(world.id).characters[santiago.personnel_id];
    const initialMemories = santiagoCharOp1.continuity?.dialogue_memories?.length ?? 0;
    assert.ok(initialMemories > 0, "Santiago must have stored memory");

    // Close Operation 1
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "RETURN" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "MOVE", target: "threshold-side-entry" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "COMPLETE_RETURN" });
    if (service.session(world.id, "field-researcher").phase.phase_id === "REPORT") {
      service.submitReferenceWrittenReport({
        world_id: world.id,
        text: "The team returned accounted for. Routine survey completed."
      });
    }

    // Advance to Operation 2
    const adv = service.advanceQ4Operations({ world_id: world.id });
    assert.equal(adv.ok, true);

    // Onboard Op 2
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.selectQ4OptionalStore({ world_id: world.id, item_id: "route-marker-kit" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "PROCEED" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "APPROACH" });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "READY" });
    service.submitQ4Communication({ world_id: world.id, channel: "standard", text: "Standard, Clear-Q4 team accounted for in operation 2. Radio check." });
    service.submitAction({ world_id: world.id, mode: "field-researcher", action: "CROSS" });

    const op2Entry = service.session(world.id, "field-researcher");
    const op2Roster = op2Entry.run.expedition.team.members;
    const santiagoOnOp2 = op2Roster.some(m => (m.personnel_id ?? m.id) === santiago.personnel_id);
    assert.equal(santiagoOnOp2, false, "Santiago must NOT be on Operation 2 roster (shift rotation)");

    // Player attempts to talk to Santiago in Operation 2
    const absentComms = service.submitQ4Communication({
      world_id: world.id,
      channel: "local",
      target: "Santiago",
      text: "Santiago, do you recall what we discussed?"
    });

    assert.equal(absentComms.ok, false, "Addressing absent Santiago in Op 2 must fail");
    assert.equal(absentComms.error.code, "LOCAL_TARGET_UNAVAILABLE");
    assert.match(absentComms.error.message, /not assigned to the current operational team/);

    const otherMember = op2Roster.find(m => m.personnel_id !== op2Entry.run.session.startup.player.observer_id);
    assert.notEqual(absentComms.result?.public_reason, otherMember?.first_name);

    const santiagoCharAfter = service.getWorld(world.id).characters[santiago.personnel_id];
    assert.equal(
      santiagoCharAfter.continuity?.dialogue_memories?.length,
      initialMemories,
      "Santiago stored memories must survive untouched while absent"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
