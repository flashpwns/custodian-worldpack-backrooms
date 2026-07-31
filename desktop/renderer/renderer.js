"use strict";
const app = document.querySelector("#app");
const current = { world: null, mode: null, projection: null };
const requestGate = new YBInteraction.RequestGate();
const presentation = new YBQol.PresentationMetadata();
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[char]);
const button = (label, action, disabled = false) => `<button data-action="${action}" ${disabled ? "disabled" : ""}>${escape(label)}</button>`;
const requestContext = () => ({ worldId: current.world?.id ?? "", mode: current.mode ?? "" });
const resultIsError = (result) => result?.ok === false || Boolean(result?.error);
const applicationError = (result) => /WORLD_|SAVE|REQUEST|INTERNAL/.test(result?.error?.code ?? "");

function setFeedback(text, state = "resolving") {
  const node = document.querySelector("#interaction-feedback");
  if (node) { node.textContent = text; node.dataset.state = state; }
}
function disableTurnForms() {
  app.querySelectorAll("#natural-form input, #natural-form button, #action-form select, #action-form button").forEach((item) => { item.disabled = true; });
}
function focusNaturalInput() { document.querySelector("#natural-form input")?.focus({ preventScroll: true }); }
function renderMessage(result, natural) {
  const detail = result?.result ?? {};
  if (detail.provider_unavailable) return "Offline narration is in use.";
  if (natural && detail.interpretation_error) return "That attempt could not be interpreted safely. No world state changed.";
  if (natural && detail.clarification_required) return `${detail.clarification_question || "That attempt needs clarification."} No world state changed.`;
  return detail.scene?.narration || detail.public_reason || detail.summary || (natural ? "That attempt could not be resolved." : "Action accepted.");
}

async function home() {
  requestGate.invalidate();
  const [info, worlds] = await Promise.all([yellowBeast.getAppInfo(), yellowBeast.listWorlds()]);
  const list = worlds.worlds.map((world) => `<li data-world-name="${escape(world.name)}"><strong>${escape(world.name)}</strong><span>${escape(world.last_mode ?? "Ready to choose an experience")}</span><span class="muted">Last played ${escape(world.last_played_at ? new Date(world.last_played_at).toLocaleDateString() : "not yet")}</span>${button("Open world", `world:${world.id}`)}${button("Rename", `rename:${world.id}`)}${button("Export", `export:${world.id}`)}${button("Delete", `delete:${world.id}`)}</li>`).join("") || `<li>${button("Create world", "new")}</li>`;
  app.innerHTML = `<section class="shell" data-testid="world-library"><header><div><p class="eyebrow">YELLOW BEAST <span>ALPHA</span></p><h1>World Library</h1><p>Choose a world. Each experience reveals a different legitimate part of the same history.</p></div><p class="version">v${escape(info.app.version)}</p></header><nav aria-label="Application">${button("Create world", "new")}${button("Import world", "import")}${button("Settings", "settings")}${button("About", "about")}</nav><section><h2>Your worlds</h2>${worlds.worlds.length ? `<label>Find a world <input id="world-filter" autocomplete="off" placeholder="Search names"></label>` : ""}<ul class="worlds">${list}</ul><details class="qol-help"><summary>Exporting a world</summary><p>Export creates a portable copy of this world. The world in your library remains unchanged; import that copy on another installation to continue it.</p></details></section></section>`;
  document.querySelector("#world-filter")?.addEventListener("input", (event) => { const query = event.target.value.toLowerCase(); app.querySelectorAll(".worlds li[data-world-name]").forEach((item) => { item.hidden = !item.dataset.worldName.toLowerCase().includes(query); }); });
}
function newWorld() {
  app.innerHTML = `<section class="shell narrow" data-testid="create-world"><p class="eyebrow">CREATE WORLD</p><h1>Start a shared world</h1><p>Choose a name, then select an experience. Worlds save what happens; introductions only change guidance.</p><form id="new-world"><label>World name <input name="name" required maxlength="80" autofocus></label><label>Starting experience <select name="experience"><option>Async: Clear-Q4</option><option>Async: Beck's Desk</option><option>Nullzone Exposure</option><option>Lost</option></select></label><label><input name="guided" type="checkbox" checked> Guided introductions (recommended)</label><details><summary>Optional repeatable seed</summary><label>Seed <input name="seed"></label></details><div>${button("Create world", "submit")}${button("Back", "home")}</div></form><div id="message"></div></section>`;
  document.querySelector("#new-world").addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const result = await yellowBeast.createWorld({ name: data.get("name"), seed: data.get("seed") || null }); if (resultIsError(result)) document.querySelector("#message").textContent = result.error.message; else selectWorld(result.world.id); });
}
async function selectWorld(id) {
  requestGate.invalidate();
  const [world, modes] = await Promise.all([yellowBeast.loadWorld({ world_id:id }), yellowBeast.listModes()]);
  if (resultIsError(world)) { app.innerHTML = `<section class="shell"><h1>This world needs attention</h1><p class="error">${escape(world.error.message)}</p><p>Your world was not changed.</p>${button("Back", "home")}</section>`; return; }
  current.world = world.world;
  const style = { "async-command":"Institutional decisions, reports, and unresolved matters.", "field-researcher":"Operational field expedition with equipment and radio.", "local-anomaly":"Personal investigation through evidence and comparison.", lost:"Sparse exploration through immediate sensory detail." };
  const cards = modes.modes.map((mode) => `<article><h2>${escape(mode.label)}</h2><p>${escape(style[mode.id])}</p>${button("Enter experience", `mode:${mode.id}`)}</article>`).join("");
  app.innerHTML = `<section class="shell" data-testid="world-entry"><p class="eyebrow">${escape(world.world.name)}</p><h1>Choose an experience</h1><p>Physical consequences persist; private knowledge does not transfer automatically.</p><div class="cards">${cards}</div>${button("Back to library", "home")}</section>`;
}
async function enterMode(mode) {
  requestGate.invalidate(); current.mode = mode;
  const resumed = await yellowBeast.resumeSession({ world_id:current.world.id, mode });
  const result = resultIsError(resumed) ? await yellowBeast.startSession({ world_id:current.world.id, mode }) : resumed;
  if (resultIsError(result)) { app.innerHTML = `<section class="shell"><h1>Unable to enter experience</h1><p class="error">${escape(result.error.message)}</p>${button("Back", `world:${current.world.id}`)}</section>`; return; }
  current.projection = result.projection; play(resumed.ok ? YBQol.history(current.projection, 1).length ? `Last time: ${YBQol.history(current.projection, 1)[0]}` : "Last time: return to what you can observe now." : "");
}
function recapMarkup(projection) {
  const recap = YBQol.recap(projection); const context = requestContext(); const history = YBQol.history(projection);
  const sections = recap.sections.map((part, sectionIndex) => `<section class="qol-recap-section" data-searchable="${part.search}"><h3>${escape(part.heading)}</h3><ul>${part.items.length ? part.items.map((item, itemIndex) => { const pin = `${sectionIndex}:${itemIndex}:${item}`; return `<li data-qol-item="${escape(String(item).toLowerCase())}"><span>${escape(item)}</span>${part.search ? `<button type="button" class="qol-pin" data-qol-pin="${escape(pin)}">${presentation.pinned(context, pin) ? "Pinned" : "Pin"}</button>` : ""}</li>`; }).join("") : "<li class=\"empty\">Nothing more is known here.</li>"}</ul></section>`).join("");
  const historyItems = history.length ? history.map((item) => `<li data-qol-item="${escape(item.toLowerCase())}">${escape(item)}</li>`).join("") : "<li class=\"empty\">No recent record is available.</li>";
  return `<details id="recap-panel" class="qol-recap" data-testid="qol-recap"><summary>What do I know?</summary><div class="qol-recap-body"><p>${escape(recap.title)} · only what this experience has legitimately revealed.</p>${recap.sections.some((part) => part.search) ? `<label>Find in this record <input id="recap-filter" autocomplete="off" placeholder="Search known notes"></label>` : ""}${sections}<section class="qol-recap-section"><h3>Recent record</h3><ul>${historyItems}</ul></section><button type="button" data-copy="scene">Copy current scene</button><p class="muted">Shortcut: ? opens this record; Escape closes it.</p></div></details>`;
}
function play(message = "", state = "") {
  const projection = current.projection;
  const context = requestContext(); const draft = presentation.draft(context);
  const actionOptions = projection.available_actions.map((action) => `<option value="${escape(action.type)}">${escape(YBSurfaces.actionLabel(action.type))}</option>`).join("");
  const scene = projection.scene ? `<section class="scene ${state === "result" ? "scene-result" : ""}" aria-label="Current scene"><p class="eyebrow">${escape(projection.scene.significance)}</p><p>${escape(projection.scene.narration)}</p>${projection.scene.inventory?.length ? `<p class="muted">Carrying: ${escape(projection.scene.inventory.map((item) => item.text).join(", "))}</p>` : ""}</section>` : "";
  const natural = `<section class="action-dock natural-action" data-testid="natural-primary"><h2>${escape(YBSurfaces.inputPrompt(projection.mode.id))}</h2><form id="natural-form"><label>Describe what you are trying to do <input name="text" autocomplete="off" value="${escape(draft)}" placeholder="${escape(YBSurfaces.inputExample(projection.mode.id))}"></label><button type="submit">Act</button></form><p>Describe an attempt in your own words. Structured controls remain available when useful.</p></section>`;
  const retry = state === "application-error" ? `<button type="button" data-action="refresh-view">Refresh view</button>` : "";
  app.innerHTML = `<section class="shell play mode-${escape(projection.mode.id)}" data-testid="play-shell"><header><div><p class="eyebrow">${escape(projection.world.name)}</p><h1>${escape(projection.mode.label)}</h1><p>${escape(projection.mode.description)}</p></div>${button("Leave session", "leave")}</header><p id="interaction-feedback" class="interaction-feedback" data-state="${escape(state)}" role="status">${escape(message)}${retry}</p>${scene}${natural}${recapMarkup(projection)}${YBSurfaces.render(projection)}<details class="action-dock structured-action"><summary>Structured controls</summary><form id="action-form" aria-label="Structured action input"><label>Choose action <select name="action" data-testid="action-select">${actionOptions}</select></label><label id="target-label">Valid target <select name="target" data-testid="target-select"></select></label><button type="submit" data-testid="submit-action">Submit action</button></form></details><p class="muted">Accepted actions save automatically.</p></section>`;
  const form = document.querySelector("#action-form"); const actionSelect = form.action; const targetSelect = form.target;
  const targetsForAction = () => { const action = projection.available_actions.find((item) => item.type === actionSelect.value); const targets = action?.targets ?? []; targetSelect.innerHTML = targets.map((target) => `<option value="${escape(target.ref)}">${escape(target.label)}</option>`).join(""); targetSelect.disabled = targets.length === 0; document.querySelector("#target-label").hidden = !action?.target_required; };
  targetsForAction(); actionSelect.addEventListener("change", targetsForAction);
  app.querySelectorAll("[data-game-action]").forEach((item) => item.addEventListener("click", () => { form.closest("details").open = true; actionSelect.value = item.dataset.gameAction; targetsForAction(); actionSelect.focus({ preventScroll: true }); }));
  form.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(form); submitTurn("structured", () => yellowBeast.submitAction({ world_id:current.world.id, mode:current.mode, action:data.get("action"), target:data.get("target") || null })); });
  const naturalForm = document.querySelector("#natural-form"); naturalForm.text.addEventListener("input", () => presentation.setDraft(context, naturalForm.text.value));
  naturalForm.addEventListener("submit", (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); submitTurn("natural", () => yellowBeast.submitNatural({ world_id:current.world.id, mode:current.mode, text:data.get("text") })); });
  const recap = document.querySelector("#recap-panel"); recap.open = presentation.panel(context) === "recap"; recap.addEventListener("toggle", () => presentation.setPanel(context, recap.open ? "recap" : ""));
  document.querySelector("#recap-filter")?.addEventListener("input", (event) => { const query = event.target.value; app.querySelectorAll("[data-qol-item]").forEach((item) => { item.hidden = !YBQol.filter([item.dataset.qolItem], query).length; }); });
  app.querySelectorAll("[data-qol-pin]").forEach((item) => item.addEventListener("click", () => { const pinned = presentation.togglePin(context, item.dataset.qolPin); item.textContent = pinned ? "Pinned" : "Pin"; }));
  app.querySelector("[data-copy=scene]")?.addEventListener("click", async () => { const text = projection.scene?.narration ?? ""; await navigator.clipboard?.writeText(text); setFeedback("Scene copied.", "result"); });
  if (state === "result") focusNaturalInput();
}
async function submitTurn(kind, request) {
  const context = requestContext(); const token = requestGate.begin(context);
  if (!token) return;
  disableTurnForms(); setFeedback(kind === "natural" ? "Submitted." : "Saving…", "submitted");
  Promise.resolve().then(() => { if (requestGate.isCurrent(token, context)) setFeedback(kind === "natural" ? "Resolving…" : "Saving…", "resolving"); });
  let result;
  try { result = await request(); } catch (_) {
    if (requestGate.settle(token, context)) play(YBInteraction.applicationMessage(), "application-error");
    return;
  }
  if (!requestGate.settle(token, context)) return;
  if (resultIsError(result)) {
    play(applicationError(result) ? YBInteraction.applicationMessage() : YBInteraction.simulationMessage(), applicationError(result) ? "application-error" : "simulation-result");
    return;
  }
  current.projection = result.projection;
  if (result.result?.scene) current.projection.scene = result.result.scene;
  const message = renderMessage(result, kind === "natural");
  const saved = kind === "structured" || result.result?.scene ? " Saved." : "";
  if (kind === "structured" || result.result?.executed) presentation.clearDraft(context);
  play(`${message}${saved}`, "result");
}
async function settings() {
  requestGate.invalidate(); const result = await yellowBeast.getSettings(); const configured = result.provider.openai.configured;
  app.innerHTML = `<section class="shell narrow" data-testid="settings"><p class="eyebrow">SETTINGS</p><h1>Settings</h1><p>Offline structured play remains complete without a connection.</p><section class="panel"><h2>Language assistance</h2><p>Optional assistance can help interpret natural-language input. Only the safe gameplay context needed for that request is used.</p><p>Status: <strong>${configured ? "Ready" : "Not set up"}</strong></p><form id="settings"><label>Input mode <select name="input_mode"><option value="structured">Structured controls</option><option value="natural">Natural language</option></select></label><label>Interpretation <select name="provider"><option value="offline">Offline / Structured</option><option value="openai">Language assistance</option></select></label><label>Appearance <select name="theme"><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label><label><input type="checkbox" name="reduced_motion"> Reduce motion</label><div>${button("Save settings", "submit")}</div></form><form id="openai"><label>Access key <input name="api_key" type="password" autocomplete="new-password" placeholder="Stored securely by the desktop app"></label><label>Response model (optional) <input name="model" maxlength="120"></label><div>${button("Save access key", "save-key")}${configured ? button("Remove key", "remove-key") : ""}</div></form><p id="settings-message"></p></section><section class="panel"><h2>Saves</h2><p>Worlds save after accepted actions and retain one previous-good backup.</p></section>${button("Back", "home")}</section>`;
  const form = document.querySelector("#settings"); form.input_mode.value = result.settings.input_mode; form.provider.value = result.settings.provider; form.theme.value = result.settings.theme; form.reduced_motion.checked = Boolean(result.settings.reduced_motion);
  const message = document.querySelector("#settings-message"); form.addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(form); const saved = await yellowBeast.updateSettings({ settings:{ input_mode:data.get("input_mode"), provider:data.get("provider"), theme:data.get("theme"), reduced_motion:data.get("reduced_motion") === "on" } }); message.textContent = saved.ok ? "Settings saved." : saved.error.message; });
  document.querySelector("#openai").addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const saved = await yellowBeast.configureOpenAI({ api_key:data.get("api_key"), model:data.get("model") || null }); message.textContent = saved.ok ? "Access key stored. It is never shown here again." : saved.error.message; if (saved.ok) settings(); });
}
function about() { requestGate.invalidate(); app.innerHTML = `<section class="shell narrow"><p class="eyebrow">ABOUT · ALPHA</p><h1>Yellow Beast</h1><p>A persistent, shared-world Backrooms experience. It works offline, with optional language assistance.</p><p>Worlds are saved in your application data folder; normal play never requires a terminal.</p>${button("Back", "home")}</section>`; }
document.addEventListener("click", async (event) => { const action = event.target.dataset.action; if (!action) return; if (action === "home" || action === "leave") home(); else if (action === "new") newWorld(); else if (action === "import") { const imported = await yellowBeast.chooseImportWorld(); if (resultIsError(imported) && imported.error.code !== "IMPORT_CANCELLED") alert(imported.error.message); home(); } else if (action === "settings") settings(); else if (action === "about") about(); else if (action === "refresh-view") { const context = requestContext(); const refreshed = await yellowBeast.getGameplayProjection({ world_id:context.worldId, mode:context.mode }); if (!resultIsError(refreshed) && requestContext().worldId === context.worldId && requestContext().mode === context.mode) { current.projection = refreshed.projection; play("Current view refreshed.", "result"); } } else if (action === "remove-key") { await yellowBeast.removeOpenAIKey(); settings(); } else if (action.startsWith("rename:")) { const worldId = action.slice(7); const prior = event.target.closest("li")?.dataset.worldName ?? ""; const name = prompt("Rename this world. This changes only its library name.", prior); if (name !== null) { const renamed = await yellowBeast.renameWorld({ world_id:worldId, name }); if (resultIsError(renamed)) alert(renamed.error.message); home(); } } else if (action.startsWith("restore:")) { const restored = await yellowBeast.restoreBackup({ world_id:action.slice(8), confirmed:confirm("Restore the previous save? Recent changes may be lost.") }); if (!resultIsError(restored)) selectWorld(action.slice(8)); else alert(restored.error.message); } else if (action.startsWith("export:")) { const result = await yellowBeast.chooseExportWorld({ world_id: action.slice(7) }); if (resultIsError(result) && result.error.code !== "EXPORT_CANCELLED") alert(result.error.message); } else if (action.startsWith("delete:")) { const worldId = action.slice(7); const name = event.target.closest("li")?.dataset.worldName ?? "this world"; if (confirm(`Delete “${name}” and its saved sessions? This cannot be undone.`)) { const deleted = await yellowBeast.deleteWorld({ world_id:worldId, confirmed:true }); if (resultIsError(deleted)) alert(deleted.error.message); home(); } } else if (action.startsWith("world:")) selectWorld(action.slice(6)); else if (action.startsWith("mode:")) enterMode(action.slice(5)); });
document.addEventListener("keydown", (event) => { if (!current.projection || event.target.matches("input, textarea, select, button")) return; const recap = document.querySelector("#recap-panel"); if (event.key === "?") { event.preventDefault(); recap.open = true; recap.querySelector("summary")?.focus({ preventScroll:true }); } else if (event.key === "Escape" && recap?.open) { event.preventDefault(); recap.open = false; focusNaturalInput(); } });
home();
