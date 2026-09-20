"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { DesktopService } = require("../desktop/service");
const { inspectLocalModel, LOCAL_PROVIDER_SPEC } = require("./ai-local-model-provider");

function conciseResult(result) {
  return {
    ok:result?.ok === true,
    turn_status:result?.result?.turn_status ?? null,
    executed:result?.result?.executed ?? null,
    source:result?.result?.presentation_source ?? result?.result?.scene?.narration_source ?? null,
    text:result?.result?.public_reason ?? result?.result?.summary ?? null,
    validation:result?.result?.living_turn?.validation ?? null,
    language_assistance:result?.result?.language_assistance ?? null,
    error:result?.error ?? null
  };
}

function onboard(service, worldId) {
  service.createQ4Personnel({ world_id:worldId, first_name:"Casey", last_name:"Morgan" });
  service.confirmQ4Personnel({ world_id:worldId });
  const started = service.startSession({ world_id:worldId, mode:"field-researcher", require_personnel:true, scenario:"reference-expedition" });
  assert.equal(started.ok, true);
  for (const action of ["READY", "PROCEED", "APPROACH", "READY"]) {
    assert.equal(service.submitAction({ world_id:worldId, mode:"field-researcher", action }).ok, true, action);
  }
  assert.equal(service.submitQ4Communication({ world_id:worldId, channel:"standard", text:"Standard, radio check." }).ok, true);
  assert.equal(service.submitAction({ world_id:worldId, mode:"field-researcher", action:"CROSS" }).ok, true);
}

async function verifyLocalModel({
  endpoint = process.env.YELLOW_BEAST_LOCAL_ENDPOINT || LOCAL_PROVIDER_SPEC.defaultEndpoint,
  model = process.env.YELLOW_BEAST_LOCAL_MODEL || LOCAL_PROVIDER_SPEC.defaultModel,
  keepProfile = process.env.YELLOW_BEAST_KEEP_LOCAL_PROFILE === "1"
} = {}) {
  const runtime = await inspectLocalModel({ endpoint, model, timeout:5000 });
  assert.equal(runtime.runtime_available, true, `Ollama is not reachable at ${endpoint}`);
  assert.equal(runtime.model_available, true, `Model ${model} is not installed`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yb-local-acceptance-"));
  const startedAt = Date.now();
  let passed = false;
  try {
    let service = new DesktopService({ appDataPath:root, defaultQ4Scenario:"reference-expedition", developerMode:true, logger:console.log });
    const settings = service.updateSettings({ settings:{ provider:"local", input_mode:"natural", local_endpoint:endpoint, local_model:model } });
    assert.equal(settings.ok, true);
    const connection = await service.testProvider({ provider:"local", live:true });
    assert.equal(connection.ok, true, JSON.stringify(connection));

    const world = service.createWorld({ name:"Local model acceptance", seed:"local-model-acceptance" }).world;
    onboard(service, world.id);
    const before = service.getGameplayProjection({ world_id:world.id, mode:"field-researcher" }).projection;
    assert.equal(before.q4.current_location.name, "Utility Room");

    const natural = await service.submitNatural({ world_id:world.id, mode:"field-researcher", text:"Look around." });
    const naturalResult = conciseResult(natural);
    assert.equal(naturalResult.ok, true, JSON.stringify(naturalResult));
    assert.equal(naturalResult.turn_status, "RESOLVED", JSON.stringify(naturalResult));
    assert.equal(naturalResult.validation?.accepted, true, JSON.stringify(naturalResult));
    assert.equal(naturalResult.language_assistance?.interpretation_provider, "local");
    assert.equal(naturalResult.language_assistance?.local_interpretation, true);
    assert.equal(naturalResult.source, "provider");
    assert.ok(naturalResult.text.length >= 35 && naturalResult.text.length <= 900);
    const afterLook = service.getGameplayProjection({ world_id:world.id, mode:"field-researcher" }).projection;
    assert.equal(afterLook.q4.current_location.name, "Utility Room", "LOOK changed canonical location");

    const firstDialogue = await service.submitQ4Communication({
      world_id:world.id,
      channel:"local",
      target:"Santiago",
      text:"I prefer short instructions when things get tense.",
      request_id:"local-acceptance-dialogue-1"
    });
    const firstDialogueResult = conciseResult(firstDialogue);
    assert.equal(firstDialogueResult.ok, true, JSON.stringify(firstDialogueResult));
    assert.equal(firstDialogueResult.source, "local-model", JSON.stringify(firstDialogueResult));
    assert.doesNotMatch(firstDialogueResult.text, /I heard you about|Which part should I check|Language assistance/i);

    service.shutdown();
    service = new DesktopService({ appDataPath:root, defaultQ4Scenario:"reference-expedition", developerMode:true, logger:console.log });
    assert.equal(service.resumeSession({ world_id:world.id, mode:"field-researcher" }).ok, true);
    const rememberedDialogue = await service.submitQ4Communication({
      world_id:world.id,
      channel:"local",
      target:"Santiago",
      text:"How should you give me instructions when things get tense?",
      request_id:"local-acceptance-dialogue-2"
    });
    const rememberedDialogueResult = conciseResult(rememberedDialogue);
    assert.equal(rememberedDialogueResult.ok, true, JSON.stringify(rememberedDialogueResult));
    assert.equal(rememberedDialogueResult.source, "local-model", JSON.stringify(rememberedDialogueResult));
    assert.match(rememberedDialogueResult.text, /short|brief|concise|few words|one step|direct|simple|clear|minimal|straightforward|compact|succinct|plain|as requested|you said|you prefer|instructions/i);
    assert.doesNotMatch(rememberedDialogueResult.text, /I heard you about|Which part should I check|Language assistance/i);
    assert.notEqual(rememberedDialogueResult.text, firstDialogueResult.text);

    const diagnostics = service.getDiagnostics().diagnostics;
    assert.equal(diagnostics.provider, "local");
    assert.equal(diagnostics.local_ai.model, model);
    assert.equal(diagnostics.hosted_ai.hosted_request, false);
    const provenance = service.getInterpretationProvenance({ limit:100 }).records;
    assert.ok(provenance.some(item => item.provider === "local" && item.invocation_status === "completed" && item.hosted_request === false));

    passed = true;
    return {
      passed:true,
      provider:"local",
      model,
      endpoint,
      runtime:{ runtime_available:true, model_available:true },
      connection:{ status:connection.status, selected_provider:connection.selected_provider },
      natural:naturalResult,
      dialogue:firstDialogueResult,
      remembered_dialogue:rememberedDialogueResult,
      restart_persistence:true,
      canonical_location_after_look:afterLook.q4.current_location.name,
      hosted_request:false,
      duration_ms:Date.now() - startedAt,
      profile:keepProfile ? root : null
    };
  } finally {
    if (!keepProfile && passed) fs.rmSync(root, { recursive:true, force:true });
    else if (!passed) console.error(`Local acceptance profile retained at ${root}`);
  }
}

if (require.main === module) {
  verifyLocalModel().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(error => {
    console.error(error.stack);
    process.exitCode = 1;
  });
}

module.exports = { verifyLocalModel };
