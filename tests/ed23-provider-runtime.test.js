"use strict";

// PROVIDER UPGRADE + RUNTIME CLOSURE: the internal wording runtime is pinned, verified, loopback-only and
// replaceable without changing any semantics; wording-side validators stay strict.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pin = require("../tools/local-runtime-pin.json");
const V = require("../tools/dialogue-validation");
const D = require("../tools/dialogue-discourse");
const { validateLocalDialogue } = require("../tools/ai-local-dialogue");
const { createLocalModelProvider } = require("../tools/ai-local-model-provider");
const { ManagedInferenceAppliance } = require("../tools/managed-inference-appliance");
const { renderContributionTask, LOCAL_DIALOGUE_WORDING_TEXT } = require("../tools/dialogue-prompt-contract");
const { stage, sha256File } = require("../tools/stage-runtime-resources");

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const contributionFor = (text, recipient_type = "group") => {
  const frame = D.buildSemanticFrame({ text, recipient_type });
  const [plan] = D.planResponses({ frame, owner_ids: ["o"], responders: {}, names: {} });
  return D.toAuthorizedContribution(plan, frame);
};

// ─── pin / provider options ────────────────────────────────────────────────
test("runtime pin — one shipped model, exact source, license and disabled reasoning mode", () => {
  assert.equal(pin.model.license, "Apache-2.0");
  assert.match(pin.model.revision, /^[0-9a-f]{40}$/);
  assert.match(pin.model.sha256, /^[0-9a-f]{64}$/);
  assert.match(pin.model.url, /^https:\/\/huggingface\.co\/Qwen\/Qwen3-4B-GGUF\/resolve\/[0-9a-f]{40}\//, "official upstream, revision-pinned");
  assert.equal(pin.model.internal_filename, "yellow-beast-local-v1.gguf", "the player-facing runtime never carries the upstream model name");
});

test("local provider — pinned request options reach the runtime request body; wording contract stays internal", async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({ id: "x", choices: [{ message: { content: JSON.stringify({ version: "yellow-beast-local-dialogue-candidate@v1", observer_id: "o", speech: "Hi.", semantic_claims: [] }) } }] }) }; };
  const provider = createLocalModelProvider({ endpoint: "http://127.0.0.1:1", fetchImpl });
  const packet = { speaker: { observer_id: "o" }, authorized_contribution: contributionFor("Good morning, y'all.") };
  await provider.presentLocal(packet);
  assert.equal(bodies[0].chat_template_kwargs.enable_thinking, false);
  assert.equal(bodies[0].temperature, pin.model.request_options.sampling.dialogue.temperature);
  assert.equal(bodies[0].top_k, pin.model.request_options.sampling.dialogue.top_k);
  assert.equal(bodies[0].stream, false);
  assert.throws(() => createLocalModelProvider({ endpoint: "http://example.com:8080" }), /loopback|local/i, "non-loopback endpoints are rejected");
});

// ─── verification / lifecycle ──────────────────────────────────────────────
test("appliance — streaming SHA-256 matches, and only the bundled model is held to the pin", () => {
  const dir = tmp("yb-ed23-");
  const file = path.join(dir, "m.bin");
  fs.writeFileSync(file, crypto.randomBytes(9 * 1024 * 1024 + 17));
  assert.equal(sha256File(file), crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  const appliance = new ManagedInferenceAppliance({ appDataPath: dir, overrideTotalMem: 16 * 1024 ** 3 });
  appliance.bundledModelPath = () => file;
  assert.throws(() => appliance.assertPinnedModel(file, "0".repeat(64)), { code: "CHECKSUM_MISMATCH" });
  assert.doesNotThrow(() => appliance.assertPinnedModel(file, pin.model.sha256));
  assert.doesNotThrow(() => appliance.assertPinnedModel(path.join(dir, "elsewhere.bin"), "0".repeat(64)), "a developer-supplied path is not held to the pin");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("appliance — daemon is loopback-only with the web UI disabled and no key/network dependency", () => {
  const src = fs.readFileSync(path.join(__dirname, "../tools/managed-inference-appliance.js"), "utf8");
  assert.match(src, /"--host", "127\.0\.0\.1"/);
  assert.match(src, /"--no-webui"/);
  assert.doesNotMatch(src, /ollama|api[_-]?key|https?:\/\/(?!127\.0\.0\.1)/i.test(src) ? /^$/ : /a^/);
});

test("service — a fresh profile installs the bundled runtime silently before warmup (the player never manages it)", async () => {
  const { DesktopService } = require("../desktop/service");
  const service = new DesktopService({ appDataPath: tmp("yb-ed23s-") });
  const calls = [];
  service.inferenceAppliance.hasBundledAssets = () => true;
  service.inferenceAppliance.install = async () => { calls.push("install"); return { ok: true }; };
  service.dialogueRuntime.start = async () => { calls.push("start"); return {}; };
  await service.startDialogueRuntime();
  assert.deepEqual(calls, ["install", "start"]);
  service.shutdown();
});

test("staging — resources are copied only when the model equals the pin", () => {
  const vendor = tmp("yb-vendor-");
  const out = tmp("yb-out-");
  fs.mkdirSync(path.join(vendor, "llama"), { recursive: true });
  fs.mkdirSync(path.join(vendor, "model"), { recursive: true });
  fs.writeFileSync(path.join(vendor, "llama", "llama-server"), "x");
  fs.writeFileSync(path.join(vendor, "llama", "llama-cli"), "x");
  fs.writeFileSync(path.join(vendor, "model", "yellow-beast-local-v1.gguf"), "not the pinned model");
  assert.throws(() => stage({ vendor, out }), /does not match the pin/);
  assert.ok(!fs.existsSync(path.join(out, "model")), "nothing is staged for a model that fails the pin");
});

// ─── wording contract & validators (a better model must not need looser validation) ────
test("prompt — no stock phrases a small model can parrot for greetings, jokes or introductions", () => {
  assert.doesNotMatch(LOCAL_DIALOGUE_WORDING_TEXT, /Yeah, real comforting|'Morning\.'|Good to meet you\.|Yeah, reassuring/);
  for (const text of ["Well, this seems incredibly safe.", "Good morning.", "I'm Jack."]) {
    const prompt = renderContributionTask({ speaker: { observer_id: "o", known_identity: "Nora" }, player_message: { text }, authorized_contribution: contributionFor(text, "none") });
    assert.doesNotMatch(prompt, /Yeah, reassuring|Very comforting|e\.g\. 'Morning/);
  }
});

test("validators — invented names, danger/safety claims, invented history and bare affirmations are rejected", () => {
  const joke = contributionFor("Well, this seems incredibly safe.", "none");
  for (const bad of ["That's the most dangerous thing we've ever done.", "You're not wrong about that.", "I was starting to think we'd all get hurt.", "Yeah, we'd all die in there."]) assert.equal(V.validateContribution(joke, bad).ok, false, bad);
  assert.equal(V.validateContribution(joke, "That’s the most optimistic thing I’ve heard all week.").ok, true, "curly apostrophes are one word, not a length violation");
  const intro = contributionFor("I'm Jack.", "none");
  assert.equal(V.validateContribution(intro, "Yeah.").ok, false);
  assert.equal(V.validateContribution(intro, "Good to meet you, Jack.").ok, true);
  assert.equal(V.validateContribution(intro, "You\u2019re all set, Jack.").ok, false, "an introduction is not answered with an invented status");
  const checkIn = contributionFor("How are you holding up?", "direct");
  assert.equal(V.validateContribution(checkIn, "I'm fine, just waiting for the camera to charge.").ok, false, "a check-in reply invents no activity");
  assert.equal(V.validateContribution(checkIn, "Holding up, thanks.").ok, true);
  assert.equal(V.validateContribution(contributionFor("You know the thing by the thing?", "none"), "What were you referring to?").ok, true, "a genuine clarification question is accepted");
  const packet = { speaker: { observer_id: "o" }, player_message: { text: "Good morning." }, context_capsule: { actor: { name: "Nora" }, present_people: [{ name: "PLAYER", is_player: true }, { name: "Scott" }], heard_turns: [], human_context: { affect: [] }, known_state: [] }, authorized_contribution: contributionFor("Good morning.", "none") };
  const verdict = (speech) => validateLocalDialogue(packet, { version: "yellow-beast-local-dialogue-candidate@v1", observer_id: "o", speech });
  assert.equal(verdict("Morning, Joe.").ok, false, "the name of the person spoken to is not invented");
  assert.equal(verdict("Morning, Scott.").ok, false, "naming a bystander the contribution does not mention is an invented interaction");
  assert.equal(verdict("Morning.").ok, true);
  assert.equal(verdict("Morning, Nora.").ok, false, "a speaker never greets the listener by the speaker's own name");
  assert.equal(verdict("Morning, PLAYER.").ok, false);
});
