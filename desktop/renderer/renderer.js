"use strict";
const app = document.querySelector("#app");
const current = { world: null, mode: null, projection: null, developer: false, settingsReturn: null };
const rendererDiagnostics = { errors: [], surface: null };
function showRendererFailure(kind, error) {
  const message = String(error?.message ?? error ?? "Unknown renderer failure").slice(0, 240);
  rendererDiagnostics.errors.push({ kind, message, at: new Date().toISOString() });
  const existing = document.querySelector("[data-testid=renderer-error]");
  if (existing) { existing.querySelector("[data-error-message]").textContent = message; return; }
  if (!app) return;
  app.innerHTML = `<section class="shell narrow renderer-error" data-testid="renderer-error"><p class="eyebrow">RENDERER RECOVERY</p><h1>Interaction paused safely</h1><p data-error-message>${escape(message)}</p><p>Retry the current surface or return to operational records. No canonical state was changed by this presentation error.</p><button type="button" data-action="renderer-retry">Retry surface</button><button type="button" data-action="home">Return to records</button></section>`;
}
window.addEventListener("error", (event) => showRendererFailure("uncaught-error", event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => { const settingsForm = document.querySelector("#settings"); if (settingsForm) { settingsForm.querySelectorAll("input,select,button").forEach((item) => { item.disabled = false; }); settingsController.state = "open"; } showRendererFailure("unhandled-rejection", event.reason); });
const requestGate = new YBInteraction.RequestGate();
const presentation = new YBQol.PresentationMetadata();
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[char]);
const button = (label, action, disabled = false) => `<button type="${action === "submit" ? "submit" : "button"}" data-action="${action}" ${disabled ? "disabled" : ""}>${escape(label)}</button>`;
const requestContext = () => ({ worldId: current.world?.id ?? "", mode: current.mode ?? "" });
const resultIsError = (result) => result?.ok === false || Boolean(result?.error);
const applicationError = (result) => /WORLD_|SAVE|REQUEST|INTERNAL/.test(result?.error?.code ?? "");
const applyPreferences = (settings) => YBAccessibility.apply(document, settings);

function expeditionLoadingMotif() {
  return `<span class="expedition-loading-motif" aria-label="Field expedition progression" role="img"><span class="walking-person lead" title="Lead surveyor (camera)">[▣]</span><span class="walking-person middle" title="Survey technician (equipment case)">[■]</span><span class="walking-person rear" title="Trailing researcher (lamp / tape)">[◌↩]</span></span>`;
}
function setFeedback(text, state = "resolving") {
  const node = document.querySelector("#interaction-feedback");
  if (node) {
    node.dataset.state = state;
    if (state === "submitted" || state === "resolving") {
      node.innerHTML = `<span class="feedback-text">${escape(text)}</span> ${expeditionLoadingMotif()}`;
    } else {
      node.textContent = text;
    }
  }
}
function disableTurnForms() {
  app.querySelectorAll("#natural-form textarea, #natural-form input, #natural-form button, #action-form select, #action-form button, #q4-comms-form textarea, #q4-comms-form input, #q4-comms-form button, #q4-comms-form select").forEach((item) => { item.disabled = true; });
}
function focusNaturalInput() { (document.querySelector("#natural-form textarea") || document.querySelector("#natural-form input"))?.focus({ preventScroll: true }); }
function sanitizePlayerMessage(text) {
  if (!text || typeof text !== "string") return "";
  let clean = text
    .replace(/Language assistance returned an invalid response and was rejected\.\s*Deterministic response:\s*/gi, "")
    .replace(/Language assistance is unavailable\.\s*Deterministic response:\s*/gi, "")
    .replace(/Language assistance is unavailable\.\s*Your world is safe\.\s*Continue using structured controls or try again\./gi, "Field terminal operating under local offline protocol. Operational record intact.")
    .replace(/Language assistance needs an access key\.\s*Your world is safe;\s*you can continue offline\./gi, "Field terminal operating under local offline protocol. Operational record intact.")
    .replace(/Deterministic response:\s*/gi, "")
    .trim();
  if (/^Language assistance/i.test(clean) || /PROVIDER_UNAVAILABLE/i.test(clean) || /PROVIDER[ _]FAILURE/i.test(clean)) {
    clean = "Field terminal operating under local offline protocol. Operational record intact.";
  }
  return clean;
}
function renderMessage(result, natural) {
  const detail = result?.result ?? {};
  if (natural && detail.interpretation_error) return "That attempt could not be interpreted safely. No world state changed.";
  if (natural && detail.clarification_required) return `${detail.clarification_question || "That attempt needs clarification."} No world state changed.`;
  if (detail.mission_updates?.length) { const update = detail.mission_updates.at(-1); return `OBJECTIVE UPDATED · ${update.headline}. ${update.reason}`; }
  const raw = detail.scene?.narration || detail.public_reason || detail.summary;
  const sanitized = sanitizePlayerMessage(raw);
  return sanitized || (natural ? "That attempt could not be resolved." : "Action accepted.");
}

async function home() {
  current.mode = null;
  current.projection = null;
  requestGate.invalidate();
  const [info, worlds, preferences] = await Promise.all([yellowBeast.getAppInfo(), yellowBeast.listWorlds(), yellowBeast.getSettings()]);
  applyPreferences(preferences.settings); current.developer = info.app.developer_mode === true;
  const list = worlds.worlds.map((world) => `<li data-world-name="${escape(world.name)}"><strong>${escape(world.name)}</strong><span>${escape(world.last_mode ?? "Ready to choose an experience")}</span><span class="muted">Last played ${escape(world.last_played_at ? new Date(world.last_played_at).toLocaleDateString() : "not yet")}</span>${button("Open world", `world:${world.id}`)}${button("Rename", `rename:${world.id}`)}${button("Export", `export:${world.id}`)}${current.developer ? button("Export diagnostic record", `diagnostic:${world.id}`) : ""}${button("Delete", `delete:${world.id}`)}</li>`).join("") || `<li class="empty">No field files registered yet.</li>`;
  const build = info.app.build ?? {}; app.innerHTML = `<section class="shell async-access" data-testid="world-library"><header class="access-header"><div><p class="eyebrow">ASYNC · FIELD OPERATIONS SYSTEM</p><h1>Operational Records</h1><p>Authorized personnel may resume an existing operational record or establish a new field file.</p></div><p class="version">v${escape(info.app.version)} · ${escape(String(build.commit ?? "source").slice(0, 12))}<br><small>${escape(build.built_at ?? "SOURCE_TREE")}</small></p></header><nav aria-label="Application">${button("Establish field file", "new")}${button("Import record", "import")}${button("Settings", "settings")}${button("About", "about")}</nav><section><h2>Registered records</h2>${worlds.worlds.length ? `<label>Find a record <input id="world-filter" autocomplete="off" placeholder="Search record names"></label>` : ""}<ul class="worlds">${list}</ul><details class="qol-help"><summary>Exporting an operational record</summary><p>Export creates a portable copy of this record. The record in this installation remains unchanged.</p></details></section></section>`;
  document.querySelector("#world-filter")?.addEventListener("input", (event) => { const query = event.target.value.toLowerCase(); app.querySelectorAll(".worlds li[data-world-name]").forEach((item) => { item.hidden = !item.dataset.worldName.toLowerCase().includes(query); }); });
}
async function newWorld() {
  app.innerHTML = `<section class="shell narrow" data-testid="create-world"><p class="eyebrow">ASYNC · RECORDS CONTROL</p><h1>Establish a field file</h1><p>Name the persistent record before choosing an authorized operational program.</p><form id="new-world"><label>Record name <input name="name" maxlength="80" autofocus placeholder="Optional — defaults to Untitled field file"><small>Use a name for this career record, or leave it blank and continue.</small></label><label><input name="guided" type="checkbox" checked> Guided introduction</label><details><summary>Record initialization reference</summary><label>Repeatable seed <input name="seed"></label></details><div>${button("Establish and begin", "submit")}${button("Back", "home")}</div></form><div id="message" role="status" aria-live="polite"></div></section>`;
  const form = document.querySelector("#new-world"); const nameInput = form.elements.namedItem("name"); const submit = form.querySelector('[data-action="submit"]'); let submitting = false;
  form.addEventListener("submit", async (event) => { event.preventDefault(); if (submitting) return; submitting = true; submit.disabled = true; const data = new FormData(form); const message = document.querySelector("#message"); const guided = data.get("guided") === "on"; try { const preference = await yellowBeast.updateSettings({ settings:{ guided_introductions:guided } }); if (resultIsError(preference)) { message.textContent = preference.error.message; submitting = false; submit.disabled = false; nameInput?.focus(); return; } const result = await yellowBeast.createWorld({ name: data.get("name"), seed: data.get("seed") || null }); if (resultIsError(result)) { message.textContent = result.error.message; submitting = false; submit.disabled = false; nameInput?.focus(); } else { current.world = result.world; await selectWorld(result.world.id); } } catch (_) { message.textContent = "The field file could not be established. Check the local application and try again."; submitting = false; submit.disabled = false; nameInput?.focus(); } });
}
async function selectWorld(id) {
  requestGate.invalidate();
  const [world, modes] = await Promise.all([yellowBeast.loadWorld({ world_id:id }), yellowBeast.listModes()]);
  if (resultIsError(world)) { app.innerHTML = `<section class="shell"><h1>This world needs attention</h1><p class="error">${escape(world.error.message)}</p><p>Your world was not changed.</p>${button("Back", "home")}</section>`; return; }
  current.world = world.world;
  const cards = modes.modes.map((mode) => `<article class="${mode.playable ? "playable" : "program-locked"}" data-mode="${escape(mode.id)}"><p class="eyebrow">${escape(mode.role)}</p><h2>${escape(mode.program_name ?? mode.label)}</h2><p>${escape(mode.playable ? mode.description : "Access unavailable")}</p><p class="mode-status">${escape(mode.playable ? "AUTHORIZED" : "ACCESS UNAVAILABLE")}</p>${button(mode.playable ? "Open operational record" : "Access unavailable", `mode:${mode.id}`, !mode.playable)}</article>`).join("");
  app.innerHTML = `<section class="shell" data-testid="world-entry"><p class="eyebrow">RECORD · ${escape(world.world.name)}</p><h1>Operational Programs</h1><p>Program access is determined by the current ASYNC registration record.</p><div class="cards">${cards}</div>${current.developer ? button("Developer console", "developer") : ""}${button("Back to records", "home")}</section>`;
}
const developerJson = (value) => escape(JSON.stringify(value, null, 2));
async function developerConsole() {
  requestGate.invalidate(); if (!current.world) return home();
  const result = await yellowBeast.getDeveloperSnapshot({ world_id:current.world.id, mode:current.mode });
  if (resultIsError(result)) { app.innerHTML = `<section class="shell"><h1>Developer console unavailable</h1><p class="error">${escape(result.error.message)}</p>${button("Back", `world:${current.world.id}`)}</section>`; return; }
  const data = result.snapshot, objective = data.objective, observer = current.devObserver ?? current.mode ?? "field-researcher", view = data.observer_views[observer] ?? {};
  const overview = { world:objective.world, active:result.active, counts:{ actors:objective.characters.length, artifacts:objective.objects.artifacts.length, evidence:objective.objects.evidence.length, regions:objective.regions.length, phenomena:objective.phenomena.length, threads:objective.threads.index.threads?.length ?? 0, recent_events:result.recent_history.length }, provider:result.provider };
  const q4Phenomena=objective.phenomena.filter((item)=>item.canonical_family);const phenomenonOptions=q4Phenomena.map((item)=>`<option value="${escape(item.id)}">${escape(item.canonical_family)} · ${escape(item.location_id)} · ${escape(item.current_state)}</option>`).join("");
  const fixturePanel=result.active?.session_kind==="bootstrap"?`<section class="panel"><h2>Pass 16B controlled fixtures · CANONICAL WRITE</h2><p>Developer-only deterministic controls. These bypass production eligibility and persist in this world.</p><form id="developer-fixture-create"><label>Family <select name="family"><option>STILL_LIFE</option><option>BACTERIA</option><option>SPATIAL_INCONSISTENCY</option><option>OBJECT_DISPLACEMENT</option><option>ACOUSTIC_ANOMALY</option><option>TRANSIENT_ARCHITECTURE</option><option>ENVIRONMENTAL_DISCONTINUITY</option><option>EVIDENCE_INCONSISTENCY</option></select></label><label>Still Life profile <select name="profile_id"><option value="">Canonical/default</option>${["INERT","BREATHING_PASSIVE","VOCAL_FEAR","FLEEING","AGGRESSIVE","LIGHT_INTERACTIVE","HAZARD_SEEKING","LOW_REACTIVITY"].map((id)=>`<option>${id}</option>`).join("")}</select></label><label>Location override <input name="location_id" placeholder="Current location"></label><button type="submit">Instantiate controlled fixture</button></form><form id="developer-fixture-action"><label>Instance <select name="phenomenon_id">${phenomenonOptions||"<option value=''>Instantiate a fixture first</option>"}</select></label><label>Action <select name="fixture_action"><option>observe</option><option>stimulus</option><option>speech</option><option>mimic</option><option>acquire</option><option>pursue</option><option>capture</option><option>slam</option><option>alias</option></select></label><label>Text / stimulus / surface <input name="text" placeholder="approach or acquired speech"></label><label>Target personnel ID <input name="target_id" placeholder="Defaults to controlled personnel"></label><label>Encounter alias <input name="alias" placeholder="MARVIN'S FRIEND"></label><button type="submit">Apply controlled action</button></form><pre id="developer-fixture-result">No controlled fixture action run.</pre></section>`:"";
  app.innerHTML = `<section class="shell developer-console" data-testid="developer-console"><header><div><p class="eyebrow">DEVELOPER TOOLING · READ ONLY${fixturePanel?" + SEPARATE CONTROLLED FIXTURES":""}</p><h1>Simulation Inspector</h1><p>Objective, observer-safe, and provider-safe material are separate derived inspections.</p></div>${button("Return to player", `world:${current.world.id}`)}</header>${fixturePanel}<label>Inspect observer <select id="dev-observer">${Object.keys(data.observer_views).map((id) => `<option value="${escape(id)}" ${id === observer ? "selected" : ""}>${escape(id)}</option>`).join("")}</select></label><section class="panel"><h2>Overview · OBJECTIVE / DERIVED</h2><pre>${developerJson(overview)}</pre></section><section class="panel"><h2>Objective world</h2><details open><summary>Actors and continuity</summary><pre>${developerJson(objective.characters)}</pre></details><details><summary>Objects and evidence</summary><pre>${developerJson(objective.objects)}</pre></details><details><summary>Regions · initial seed and history modifications</summary><pre>${developerJson(objective.regions)}</pre></details><details><summary>Phenomena · capabilities and observer records</summary><pre>${developerJson(objective.phenomena)}</pre></details><details><summary>Story threads · DERIVED / NONCANONICAL</summary><pre>${developerJson(objective.threads)}</pre></details></section><section class="panel"><h2>Observer view · ${escape(observer)}</h2><pre>${developerJson(view)}</pre></section><section class="panel"><h2>Provider-safe context</h2><pre>${developerJson(result.provider_safe_context ?? { status:"No Clear-Q4 session selected." })}</pre></section><section class="panel"><h2>Recent canonical history · bounded</h2><pre>${developerJson(result.recent_history)}</pre></section><section class="panel"><h2>Intent trace · NON-EXECUTING</h2><form id="developer-trace"><label>Test phrase <input name="text" value="look around"></label><button type="submit">Trace only</button></form><pre id="developer-trace-result">No trace run.</pre></section></section>`;
  document.querySelector("#dev-observer").addEventListener("change", (event) => { current.devObserver = event.target.value; developerConsole(); });
  document.querySelector("#developer-trace").addEventListener("submit", async (event) => { event.preventDefault(); const response = await yellowBeast.traceDeveloperIntent({ world_id:current.world.id, mode:current.mode, text:new FormData(event.currentTarget).get("text") }); document.querySelector("#developer-trace-result").textContent = resultIsError(response) ? response.error.message : JSON.stringify(response.trace, null, 2); });
  document.querySelector("#developer-fixture-create")?.addEventListener("submit",async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const response=await yellowBeast.controlQ4PhenomenonFixture({world_id:current.world.id,action:"instantiate",family:form.get("family"),profile_id:form.get("profile_id")||null,location_id:form.get("location_id")||null});if(resultIsError(response))document.querySelector("#developer-fixture-result").textContent=response.error.message;else{current.projection=response.projection;developerConsole();}});
  document.querySelector("#developer-fixture-action")?.addEventListener("submit",async(event)=>{event.preventDefault();const form=new FormData(event.currentTarget);const response=await yellowBeast.controlQ4PhenomenonFixture({world_id:current.world.id,action:String(form.get("fixture_action")).toLowerCase(),phenomenon_id:form.get("phenomenon_id")||null,text:form.get("text")||null,target_id:form.get("target_id")||null,alias:form.get("alias")||null});const node=document.querySelector("#developer-fixture-result");if(node)node.textContent=resultIsError(response)?response.error.message:JSON.stringify(response.result,null,2);if(!resultIsError(response))current.projection=response.projection;});
}
function personnelCreation() {
  requestGate.invalidate();
  app.innerHTML = `<section class="shell narrow personnel-creation" data-testid="q4-personnel-creation"><p class="eyebrow">ASYNC · PERSONNEL ENTRY</p><h1>Create your ASYNC personnel record.</h1><p>This record identifies the person you control in Clear-Q4. ASYNC assigns the field role and Q4 clearance; you do not choose mission or stats.</p><form id="personnel-creation-form"><label>First name <input name="first_name" autocomplete="given-name" required maxlength="40" autofocus></label><label>Last name <input name="last_name" autocomplete="family-name" required maxlength="60"></label><button type="submit">Create Personnel Record</button></form><p id="personnel-message" role="status"></p></section>`;
  document.querySelector("#personnel-creation-form").addEventListener("submit", async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const message = document.querySelector("#personnel-message"); try { const created = await yellowBeast.createQ4Personnel({ world_id:current.world.id, first_name:data.get("first_name"), last_name:data.get("last_name") }); if (resultIsError(created)) { message.textContent = created.error.message; document.querySelector("input[name=first_name]")?.focus(); return; } personnelConfirmation(created.player); } catch (_) { message.textContent = "The personnel record could not be saved. Your field file remains unchanged."; document.querySelector("input[name=first_name]")?.focus(); } });
}
function personnelConfirmation(player) {
  app.innerHTML = `<section class="shell narrow personnel-confirmation" data-testid="q4-personnel-confirmation"><p class="eyebrow">ASYNC · PERSONNEL RECORD CREATED</p><h1>Personnel record created</h1><section class="personnel-record-card"><span class="portrait-slot badge-portrait-fallback" aria-hidden="true">${escape((player.first_name ?? "?")[0])}</span><h2>${escape(player.display_name)}</h2><p>${escape(player.role)} · Clearance ${escape(player.clearance)}</p><p>Status: Active</p></section><p>You are ${escape(player.display_name)}.</p><button type="button" data-action="personnel-confirm-continue">Continue to Assignment Briefing</button></section>`;
}
async function enterMode(mode) {
  requestGate.invalidate(); current.mode = mode; current.guidanceDismissed = false;
  if (mode !== "field-researcher") { app.innerHTML = `<section class="shell narrow" data-testid="program-unavailable"><p class="eyebrow">ASYNC · ACCESS CONTROL</p><h1>Access unavailable</h1><p>This operational program is not authorized for the current installation.</p>${button("Back to programs", `world:${current.world.id}`)}</section>`; return; }
  const personnel = await yellowBeast.getQ4PersonnelStatus({ world_id:current.world.id }); if (resultIsError(personnel)) { app.innerHTML = `<section class="shell"><h1>Personnel record unavailable</h1><p class="error">${escape(personnel.error.message)}</p>${button("Back", `world:${current.world.id}`)}</section>`; return; }
  if (personnel.required) { personnelCreation(); return; }
  if (personnel.confirmation_required) { personnelConfirmation(personnel.player); return; }
  const resumed = await yellowBeast.resumeSession({ world_id:current.world.id, mode });
  const result = resultIsError(resumed) && resumed.error?.code === "SESSION_NOT_FOUND" ? await yellowBeast.startSession({ world_id:current.world.id, mode, require_personnel:true }) : resumed;
  if (resultIsError(result)) { app.innerHTML = `<section class="shell"><h1>Unable to enter experience</h1><p class="error">${escape(result.error.message)}</p>${button("Back", `world:${current.world.id}`)}</section>`; return; }
  current.projection = result.projection; applyPreferences(current.projection.settings);
  const initialPhase = current.projection?.phase?.phase_id;
  if (typeof YBAudio !== "undefined") {
    if (initialPhase === "FIELD_OPERATION") YBAudio.emitHook("complex_hum");
    else if (initialPhase) YBAudio.emitHook("facility_ambient");
  }
  const recovery = result.recovery?.world?.recovered ? result.recovery.world.message : result.recovery?.session?.recovered ? result.recovery.session.message : null; play(recovery ?? (resumed.ok ? YBQol.history(current.projection, 1).length ? `Last time: ${YBQol.history(current.projection, 1)[0]}` : "Last time: return to what you can observe now." : ""));
}
function recapMarkup(projection) {
  const recap = YBQol.recap(projection); const context = requestContext(); const history = YBQol.history(projection);
  const sections = recap.sections.map((part, sectionIndex) => `<section class="qol-recap-section" data-searchable="${part.search}"><h3>${escape(part.heading)}</h3><ul>${part.items.length ? part.items.map((item, itemIndex) => { const pin = `${sectionIndex}:${itemIndex}:${item}`; const pinned = presentation.pinned(context, pin); return `<li data-qol-item="${escape(String(item).toLowerCase())}"><span>${escape(item)}</span>${part.search ? `<button type="button" class="qol-pin" data-qol-pin="${escape(pin)}" aria-pressed="${pinned}" aria-label="${pinned ? "Unpin" : "Pin"} ${escape(item)}">${pinned ? "Pinned" : "Pin"}</button>` : ""}</li>`; }).join("") : "<li class=\"empty\">Nothing more is known here.</li>"}</ul></section>`).join("");
  const historyItems = history.length ? history.map((item) => `<li data-qol-item="${escape(item.toLowerCase())}">${escape(item)}</li>`).join("") : "<li class=\"empty\">No recent record is available.</li>";
  return `<details id="recap-panel" class="qol-recap" data-testid="qol-recap"><summary>What do I know?</summary><div class="qol-recap-body"><p>${escape(recap.title)} · only what this experience has legitimately revealed.</p>${recap.sections.some((part) => part.search) ? `<label>Find in this record <input id="recap-filter" autocomplete="off" placeholder="Search known notes"></label>` : ""}${sections}<section class="qol-recap-section"><h3>Recent record</h3><ul>${historyItems}</ul></section><button type="button" data-copy="scene">Copy current scene</button><p class="muted">Shortcut: ? opens this record; Escape closes it.</p></div></details>`;
}
function guidedIntroduction(projection) {
  if (projection.phase?.tutorial_context?.enabled !== true || current.guidanceDismissed || (projection.mode.id === "field-researcher" && !["FIELD_OPERATION", "RETURN", "REPORT", "DEBRIEF"].includes(projection.phase?.phase_id))) return "";
  const q4Guidance = {
    BRIEFING: ["Current instruction", "Review the assignment and assigned team, then continue to staging."],
    STAGING: ["Current instruction", "Review issued equipment, adjust optional stores, and confirm readiness."],
    FACILITY_TRANSIT: ["Current instruction", "Proceed with the accounted team toward the Threshold room."],
    THRESHOLD: ["Current instruction", "Verify team accountability and begin the Standard radio procedure."],
    STANDARD_RADIO_CHECK: ["Current instruction", "Establish contact with Standard before entering the field."],
    FIELD_OPERATION: ["Channel guidance", "ACTION affects the environment. LOCAL addresses nearby personnel. STANDARD transmits over radio when available."],
    REPORT: ["Report requirement", "Submit your personal written account of the expedition. Your statement will be preserved as observer testimony."],
    DEBRIEF: ["Institutional debriefing", "Review your submitted report, custody log of returned evidence, and the institutional findings."]
  };
  const guidance = projection.mode.id === "field-researcher" ? (q4Guidance[projection.phase?.phase_id] ?? ["Current instruction", "Continue with the assigned operation."]) : ({ "async-command":["Desk instruction","Review the reports and choose what needs attention."], "local-anomaly":["Investigation instruction","Keep observations separate from conclusions."], lost:["Field instruction","Start with what you can see, hear, carry, or remember."] }[projection.mode.id] ?? ["Current instruction", "Describe your next attempt."]);
  return `<aside class="guided-introduction" data-testid="guided-introduction" aria-labelledby="guided-introduction-heading"><h2 id="guided-introduction-heading">${escape(guidance[0])}</h2><p>${escape(guidance[1])}</p><button type="button" data-guidance-dismiss>Hide guidance</button></aside>`;
}
function shortMissionId(mission) { return mission.display_id ?? String(mission.id ?? "UNASSIGNED").replace(/^CQ4-[A-Z-]+-/, "CQ4-").replace(/-[A-Z0-9]{4,}$/, ""); }
function asyncHeader(projection) {
  const q4 = projection.q4 ?? {};
  const mission = q4.mission_record ?? {};
  const standardTime = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" });
  const returnAction = (projection.available_actions ?? []).find((item) => ["RETURN", "COMPLETE_RETURN", "ABORT"].includes(item.type));
  const guidanceButton = current.guidanceDismissed || projection.settings?.guided_introductions === false ? `<button type="button" class="guidance-toggle" data-guidance-show>Show guidance</button>` : "";
  return `<header class="async-system-header eti-top-bar" data-testid="async-system-header"><div class="eti-title" aria-label="ASYNC Expedition Tracing Interface"><strong>Async Research Institute ETI <span>(est 1979)</span></strong><small>Expedition Tracing Interface · MISSION ${escape(shortMissionId(mission))}</small></div><div class="eti-clocks"><span><strong>${escape(q4.operational_time ?? "T+0")}</strong><small>Expedition Timer</small></span><span><strong data-standard-time>${escape(standardTime)} ST</strong><small>Time in Standard</small></span></div>${guidanceButton}<details class="backend-menu"><summary>Interface Backend</summary><div>${returnAction ? `<button type="button" data-game-action="${escape(returnAction.type)}">${escape(YBSurfaces.actionLabel(returnAction.type))}</button>` : ""}<button type="button" data-action="settings">Settings</button>${current.developer ? `<button type="button" data-action="developer">Developer console</button>` : ""}<button type="button" data-action="leave">TERMINATE FIELD SESSION</button></div></details></header>`;
}
function compactOperationsRail(projection) { const q4 = projection.q4 ?? {}; const team = q4.team ?? []; const gear = q4.equipment?.required ?? []; return `<aside class="operations-rail" data-testid="operations-rail">${panelMarkup("PERSONNEL / ACCOUNTABILITY", team.map((member) => { const epistemicLabel = member.last_observed ? "Last Observed" : member.last_reported ? "Last Reported" : "Last Contact"; const epistemicValue = member.last_observed ?? member.last_reported ?? member.last_contact; const epistemic = member.controlled ? "TEAM LEAD (YOU)" : epistemicValue ? `${epistemicLabel}: ${escape(epistemicValue)}` : "No confirmed contact"; const epistemicClass = member.last_observed ? "epistemic-observed" : member.last_reported ? "epistemic-reported" : "epistemic-contact"; return `<li><span class="portrait-slot badge-portrait-fallback" data-portrait-id="portrait-${escape(member.personnel_id ?? member.id ?? "unknown")}" aria-label="Archival badge portrait unavailable">${escape((member.first_name ?? "?")[0])}</span><strong>${escape(member.display_name)}</strong><small>${escape(member.role)} · ${escape(member.contact_state ?? member.contact_category ?? "UNCONFIRMED")}</small><em>${escape(member.condition)} · <span class="personnel-epistemic ${epistemicClass}">${epistemic}</span></em></li>`; }).join(""), "No assigned personnel.", "personnel-block")}${panelMarkup("FIELD KIT / READINESS", gear.map((item) => `<li><span class="rail-glyph equipment-glyph equipment-${escape(item.category ?? "field")}" aria-hidden="true">${item.category === "field-radio" ? "◉" : item.category === "35mm-camera" ? "▣" : item.category === "battery-lamp" ? "◌" : "＋"}</span><strong>${escape(item.label)}</strong><small>${escape(item.holder)} · ${escape(item.state)}</small></li>`).join(""), "No field kit recorded.", "equipment-block")}${panelMarkup("MISSION STATE", `<p>${escape(q4.mission_record?.objective?.primary ?? q4.display_mission ?? "Assignment not available")}</p><span class="status-line">${escape(q4.mission_record?.status ?? "assigned")} · ${escape(projection.phase?.phase_id ?? "")}</span>`, "", "mission-block")}</aside>`; }
function panelMarkup(titleText, body, emptyText, className = "") { return `<section class="ops-panel ${escape(className)}"><h2>${escape(titleText)}</h2>${body || `<p class="empty">${escape(emptyText)}</p>`}</section>`; }
function compactLayout(projection) { const map = projection.q4?.layout ?? {}; const observed = (map.observed_spaces ?? []).map((item) => `<li><span class="map-node">●</span>${escape(item.alias)}<small>${escape(item.current ? "CURRENT LOCATION" : "OBSERVED LOCATION")}</small></li>`).join(""); const links = (map.observed_connections ?? []).map((item) => `<li><span class="map-link">↔</span>${escape(item.from)} → ${escape(item.to)}<small>SURVEYED ROUTE</small></li>`).join(""); const unknown = (map.unknown_continuations ?? []).map((item) => `<li><span class="map-unknown">?</span>${escape(item)}<small>UNRESOLVED CONTINUATION</small></li>`).join(""); const prior = (map.prior_records ?? []).map((item) => `<li><span class="map-link">□</span>${escape(item.text)}<small>PRIOR SURVEY RECORD</small></li>`).join(""); return `<section class="ops-panel layout-panel" data-testid="operations-layout"><h2>LAYOUT / SURVEY</h2><p class="map-current">● ${escape(map.current ?? "Prior survey boundary")}</p><ul>${observed || links || unknown || prior ? `${observed}${links}${unknown}${prior}` : `<li class="empty">No prior survey record is in view.</li>`}</ul><small>${escape(map.confidence ?? "Record status unknown")}</small></section>`; }
function play(message = "", state = "") {
  const projection = current.projection;
  const context = requestContext(); const draft = presentation.draft(context);
  const isReport = projection.phase?.phase_id === "REPORT";
  const isDebrief = projection.phase?.phase_id === "DEBRIEF";
  const q4Prefield = projection.mode.id === "field-researcher" && !["FIELD_OPERATION", "RETURN", "REPORT", "DEBRIEF"].includes(projection.phase?.phase_id);
  const actionOptions = projection.available_actions.map((action) => `<option value="${escape(action.type)}">${escape(YBSurfaces.actionLabel(action.type))}</option>`).join("");
  applyPreferences(projection.settings); const scene = q4Prefield || !projection.scene || (projection.mode.id === "field-researcher" && state !== "result") ? "" : `<section class="scene resolution-band ${state === "result" ? "scene-result" : ""}" aria-label="Current scene resolution" aria-labelledby="current-scene-heading"><span class="sr-only">Current scene observation record</span><h2 id="current-scene-heading">OBSERVATION RECORD</h2><p>${escape(projection.scene.narration)}</p>${projection.scene.inventory?.length ? `<p class="muted">Carrying: ${escape(projection.scene.inventory.map((item) => item.text).join(", "))}</p>` : ""}</section>`;
  const naturalHeading = isReport ? "Written Expedition Account" : YBSurfaces.inputPrompt(projection.mode.id);
  const naturalPlaceholder = isReport ? "Provide your written statement of events, observations, and anomalies encountered beyond the Threshold..." : YBSurfaces.inputExample(projection.mode.id);
  const submitButtonLabel = isReport ? "SUBMIT REPORT" : "SUBMIT";
  const naturalInstruction = isReport ? "Official Record Notice: The submitted report constitutes the observer's personal account and claim. It does not establish institutional ground truth until verified against returned evidence." : "Attempt a physical action here. LOCAL and STANDARD communication remain separate below.";
  const naturalControl = isReport
    ? `<textarea name="text" rows="6" autocomplete="off" placeholder="${escape(naturalPlaceholder)}">${escape(draft)}</textarea>`
    : `<input type="text" name="text" autocomplete="off" placeholder="${escape(naturalPlaceholder)}" value="${escape(draft)}">`;
  const natural = q4Prefield ? "" : `<section class="action-dock natural-action" data-testid="natural-primary"><div>${isReport ? `<p class="eyebrow">EXPEDITION REPORT</p>` : `<p class="eyebrow">ACTION</p>`}<h2>${escape(naturalHeading)}</h2></div><form id="natural-form"><label><span class="sr-only">${isReport ? "Written expedition account" : "Describe what you are trying to do"}</span>${naturalControl}</label><button type="submit">${escape(submitButtonLabel)}</button></form><p>${escape(naturalInstruction)}</p></section>`;
  const prefieldDirect = q4Prefield ? projection.available_actions.find((action) => !action.target_required && action.type !== "WAIT") : null;
  const prefieldLabel = prefieldDirect?.type === "READY" && projection.phase?.phase_id === "THRESHOLD" ? "Begin radio procedure" : prefieldDirect ? YBSurfaces.actionLabel(prefieldDirect.type) : "Establish the required Standard exchange";
  const prefieldAction = q4Prefield ? `<section class="action-dock natural-action prefield-action" data-testid="prefield-primary"><div><p class="eyebrow">CURRENT DECISION</p><h2>${escape(prefieldLabel)}</h2></div>${prefieldDirect ? `<button type="button" class="primary-action" data-game-action="${escape(prefieldDirect.type)}">${escape(prefieldLabel)}</button>` : `<p>Use STANDARD in the communications panel to continue.</p>`}<p>${prefieldDirect ? "This advances the recorded expedition phase." : "No physical turn is available until the radio procedure is complete."}</p></section>` : "";
  const retry = state === "application-error" ? `<button type="button" data-action="refresh-view">Refresh view</button>` : "";
  const hideStructured = q4Prefield || isReport || projection.available_actions.length === 0;
  const structured = `<details class="action-dock structured-action" ${hideStructured ? "hidden" : ""}><summary>Structured controls</summary><form id="action-form" aria-label="Structured action input"><label>Choose action <select name="action" data-testid="action-select">${actionOptions}</select></label><label id="target-label">Valid target <select name="target" data-testid="target-select"></select></label><button type="submit" data-testid="submit-action">SUBMIT</button></form></details>`;
  const actionDock = `<footer class="eti-turn-controls">${prefieldAction}${natural}${hideStructured ? "" : structured}</footer>`;
  const q4Shell = projection.mode.id === "field-researcher";
  const phaseRecord = YBSurfaces.render(projection);
  const providerLabel = "CURRENT FIELD RECORD";
  // The operational chassis mounts async-operations-layout via YBSurfaces.expeditionCockpit
  const core = q4Shell
    ? (isReport
        ? `<main class="operations-main report-view" data-testid="async-operations-layout">${natural}${phaseRecord}</main>`
        : isDebrief
        ? `<main class="operations-main debrief-view" data-testid="async-operations-layout">${phaseRecord}</main>`
        : YBSurfaces.expeditionCockpit(projection, { scene: state === "result" ? projection.scene : null, providerLabel, phaseRecord, actionDock }))
    : `${scene}${natural}${YBSurfaces.render(projection)}`;
  const feedbackContent = (state === "submitted" || state === "resolving") ? `<span class="feedback-text">${escape(message)}</span> ${expeditionLoadingMotif()}${retry}` : `${escape(message)}${retry}`;
  app.innerHTML = `<section class="shell play ${q4Shell ? "operations-shell eti-shell" : ""} mode-${escape(projection.mode.id)}" data-testid="play-shell">${q4Shell ? asyncHeader(projection) : `<header><div><p class="eyebrow">${escape(projection.world.name)}</p><h1>${escape(projection.mode.label)}</h1><p>${escape(projection.mode.description)}</p></div>${button("Settings", "settings")}${button("TERMINATE FIELD SESSION", "leave")}</header>`}<p id="interaction-feedback" class="interaction-feedback" data-state="${escape(state)}" role="status" aria-live="polite" aria-atomic="true">${feedbackContent}</p>${guidedIntroduction(projection)}${core}${q4Shell ? "" : (hideStructured ? "" : `${structured}<p class="muted">Accepted actions save automatically.</p>`)}</section>`;
  if (current.developer && !q4Shell) document.querySelector(".play header").insertAdjacentHTML("beforeend", button("Developer console", "developer"));
  const form = document.querySelector("#action-form"); const actionSelect = form?.action; const targetSelect = form?.target;
  const targetsForAction = () => { if (!form) return; const action = projection.available_actions.find((item) => item.type === actionSelect.value); const targets = action?.targets ?? []; targetSelect.innerHTML = targets.map((target) => `<option value="${escape(target.ref)}">${escape(target.label)}</option>`).join(""); targetSelect.disabled = targets.length === 0; document.querySelector("#target-label").hidden = !action?.target_required; };
  targetsForAction(); actionSelect?.addEventListener("change", targetsForAction);
  app.querySelectorAll("[data-game-action]").forEach((item) => item.addEventListener("click", () => { if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); const selectedAction = projection.available_actions.find((action) => action.type === item.dataset.gameAction); if (!selectedAction) return; if (!selectedAction.target_required) { submitTurn("structured", () => yellowBeast.submitAction({ world_id:current.world.id, mode:current.mode, action:selectedAction.type })); return; } if (!form) return; form.closest("details").open = true; actionSelect.value = selectedAction.type; targetsForAction(); actionSelect.focus({ preventScroll: true }); }));
  app.querySelectorAll("[data-object-action]").forEach((item) => item.addEventListener("click", () => { if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); submitTurn("structured", () => yellowBeast.submitAction({ world_id:current.world.id, mode:current.mode, action:item.dataset.objectAction, target:item.dataset.objectTarget })); }));
  form?.addEventListener("submit", (event) => { event.preventDefault(); if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_submit"); const data = new FormData(form); submitTurn("structured", () => yellowBeast.submitAction({ world_id:current.world.id, mode:current.mode, action:data.get("action"), target:data.get("target") || null })); });
  const naturalForm = document.querySelector("#natural-form");
  const naturalInput = naturalForm?.querySelector("textarea, input[name='text']");
  naturalInput?.addEventListener("input", () => presentation.setDraft(context, naturalInput.value));
  naturalInput?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (naturalForm.requestSubmit) naturalForm.requestSubmit();
      else naturalForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
  });
  naturalForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_submit");
    const data = new FormData(event.currentTarget);
    const text = data.get("text");
    const contextKey = `${current.world.id}:${current.mode}`;
    if (!current.pendingNatural || current.pendingNatural.text !== text || current.pendingNatural.context !== contextKey) current.pendingNatural = { id:crypto.randomUUID(), context:contextKey, text };
    const requestId = current.pendingNatural.id;
    submitTurn("natural", async () => {
      const result = await yellowBeast.submitNatural({ world_id:current.world.id, mode:current.mode, text, request_id:requestId });
      if (result.ok || !["SESSION_BUSY", "PROVIDER_UNAVAILABLE"].includes(result.error?.code)) current.pendingNatural = null;
      return result;
    });
  });
  const commsForm = document.querySelector("#q4-comms-form");
  const updateChannelSwitch = (channelVal) => {
    const selector = commsForm?.querySelector(".mechanical-channel-selector");
    if (!selector) return;
    const isStandard = channelVal === "standard";
    selector.dataset.channelCurrent = isStandard ? "standard" : "local";
    const track = selector.querySelector(".switch-track");
    if (track) track.textContent = isStandard ? "[■■□□]" : "[□□■■]";
    selector.querySelector(".switch-standard")?.classList.toggle("active", isStandard);
    selector.querySelector(".switch-local")?.classList.toggle("active", !isStandard);
  };
  commsForm?.querySelector('[name="channel"]')?.addEventListener("change", (event) => {
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_toggle");
    updateChannelSwitch(event.target.value);
  });
  commsForm?.querySelectorAll(".switch-slot").forEach((slot) => {
    slot.addEventListener("click", () => {
      const select = commsForm.querySelector('[name="channel"]');
      if (!select || select.disabled) return;
      const targetVal = slot.classList.contains("switch-standard") ? "standard" : "local";
      const option = select.querySelector(`option[value="${targetVal}"]`);
      if (option && !option.disabled && select.value !== targetVal) {
        select.value = targetVal;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  });
  const commsInput = commsForm?.querySelector("input[name='text'], textarea[name='text']");
  commsInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (commsForm.requestSubmit) commsForm.requestSubmit();
      else commsForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
  });
  commsForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(commsForm);
    const channel = data.get("channel");
    submitTurn("communication", async () => {
      const res = await yellowBeast.submitQ4Communication({ world_id:current.world.id, channel, target:null, text:data.get("text") });
      if (!resultIsError(res) && channel === "standard") {
        if (typeof YBAudio !== "undefined") YBAudio.emitHook("radio_tx_chirp");
      }
      return res;
    });
  });
  app.querySelectorAll("[data-spatial-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
      current.activeMedia = null;
      if (current.projection) current.projection.activeMedia = null;
      play(message, state);
    });
  });
  app.querySelectorAll("[data-view-media]").forEach((item) => {
    item.addEventListener("click", () => {
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
      const evidenceId = item.dataset.viewMedia;
      const found = (current.projection?.q4?.evidence ?? []).find((e) => e.id === evidenceId);
      if (found) {
        current.activeMedia = found;
        if (current.projection) current.projection.activeMedia = found;
        play(message, state);
      }
    });
  });
  app.querySelectorAll("[data-q4-store]").forEach((item) => item.addEventListener("click", () => { if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); submitTurn("structured", () => yellowBeast.selectQ4OptionalStore({ world_id:current.world.id, item_id:item.dataset.q4Store })); }));
  app.querySelectorAll("[data-q4-handoff]").forEach((item) => item.addEventListener("click", () => { if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); submitTurn("structured", () => yellowBeast.submitQ4Handoff({ world_id:current.world.id, item_id:item.dataset.q4Handoff, target:item.dataset.q4HandoffTarget || null })); }));
  app.querySelectorAll("[data-logistics-action]").forEach((control) => control.addEventListener("click", () => { if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); submitTurn("structured", () => yellowBeast.submitQ4Logistics({ world_id:current.world.id, action:control.dataset.logisticsAction, item_id:control.dataset.logisticsItem || null, container_id:control.dataset.logisticsContainerId || null, target_holder:control.dataset.logisticsHolder || null, target_container:control.dataset.logisticsContainer || null, source_item_id:control.dataset.logisticsSource || null })); }));
  app.querySelectorAll("[data-evidence-render]").forEach((item) => item.addEventListener("click", () => { if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); submitTurn("presentation", () => yellowBeast.renderEvidence({ world_id:current.world.id, evidence_id:item.dataset.evidenceRender, retry:item.dataset.evidenceRetry === "true" })); }));
  const recap = document.querySelector("#recap-panel"); if (recap) { recap.open = presentation.panel(context) === "recap"; recap.addEventListener("toggle", () => presentation.setPanel(context, recap.open ? "recap" : "")); }
  document.querySelector("[data-guidance-dismiss]")?.addEventListener("click", async () => { current.guidanceDismissed = true; await yellowBeast.updateSettings({ settings:{ guided_introductions:false } }); play(message, state); });
  document.querySelector("[data-guidance-show]")?.addEventListener("click", async () => { current.guidanceDismissed = false; await yellowBeast.updateSettings({ settings:{ guided_introductions:true } }); play(message, state); });
  document.querySelector("#recap-filter")?.addEventListener("input", (event) => { const query = event.target.value; app.querySelectorAll("[data-qol-item]").forEach((item) => { item.hidden = !YBQol.filter([item.dataset.qolItem], query).length; }); });
  app.querySelectorAll("[data-qol-pin]").forEach((item) => item.addEventListener("click", () => { const pinned = presentation.togglePin(context, item.dataset.qolPin); item.textContent = pinned ? "Pinned" : "Pin"; item.setAttribute("aria-pressed", String(pinned)); item.setAttribute("aria-label", `${pinned ? "Unpin" : "Pin"} ${item.closest("li")?.querySelector("span")?.textContent ?? "item"}`); }));
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
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_error");
    if (requestGate.settle(token, context)) play(YBInteraction.applicationMessage(), "application-error");
    return;
  }
  if (!requestGate.settle(token, context)) return;
  if (resultIsError(result)) {
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_error");
    play(applicationError(result) ? YBInteraction.applicationMessage() : sanitizePlayerMessage(result.error?.message ?? YBInteraction.simulationMessage()), applicationError(result) ? "application-error" : "simulation-result");
    return;
  }
  const prevPhase = current.projection?.phase?.phase_id;
  current.projection = result.projection;
  if (result.result?.scene) current.projection.scene = result.result.scene;
  const nextPhase = current.projection?.phase?.phase_id;
  if (prevPhase && nextPhase && prevPhase !== nextPhase) {
    playCeremonialPhaseAudio(prevPhase, nextPhase);
  }
  const message = renderMessage(result, kind === "natural");
  const saved = kind === "structured" || result.result?.executed ? " Saved." : "";
  if (kind === "structured" || result.result?.executed) presentation.clearDraft(context);
  play(`${message}${saved}`, "result");
}
function playCeremonialPhaseAudio(fromPhase, toPhase) {
  if (typeof YBAudio === "undefined") return;
  if (!toPhase || fromPhase === toPhase) return;
  if (toPhase === "STAGING") {
    YBAudio.emitHook("facility_ambient");
  } else if (toPhase === "FACILITY_TRANSIT") {
    YBAudio.emitHook("lpmds_bed");
  } else if (toPhase === "THRESHOLD") {
    YBAudio.emitHook("lpmds_bed");
    YBAudio.emitHook("threshold_cross_hum");
  } else if (toPhase === "STANDARD_RADIO_CHECK") {
    YBAudio.emitHook("radio_rx_cue");
  } else if (toPhase === "FIELD_OPERATION") {
    YBAudio.emitHook("threshold_cross_hum");
    YBAudio.emitHook("complex_hum");
    YBAudio.emitHook("complex_music");
  } else if (toPhase === "RETURN") {
    YBAudio.emitHook("threshold_beacon");
  } else if (toPhase === "REPORT") {
    YBAudio.emitHook("facility_ambient");
  } else if (toPhase === "DEBRIEF") {
    YBAudio.emitHook("facility_ambient");
  }
}
function showTerminationPortal() {
  const existing = document.querySelector(".termination-portal");
  if (existing) return;
  const portal = document.createElement("div");
  portal.className = "termination-portal";
  portal.dataset.testid = "termination-portal";
  portal.setAttribute("role", "dialog");
  portal.setAttribute("aria-modal", "true");
  portal.setAttribute("aria-labelledby", "termination-heading");
  portal.innerHTML = `<div class="termination-dialog"><p class="eyebrow">A-SYNC PROTOCOL KV31-C · FIELD SESSION TERMINATION</p><h2 id="termination-heading">Institutional Consequence Warning</h2><p class="termination-consequence">Unreturned field personnel, unresolved equipment, and uncommitted survey telemetry will be recorded under protocol exception. The operational session will close and career accountability will be finalized.</p><div class="termination-actions"><button type="button" class="action-button primary-action" data-action="cancel-termination">[RETURN TO EXPEDITION]</button><button type="button" class="action-button danger-action" data-action="confirm-termination">[CONFIRM SESSION TERMINATION]</button></div></div>`;
  app.appendChild(portal);
  portal.querySelector('[data-action="cancel-termination"]')?.focus();
}
const settingsController = { state: "closed", opener: null, mounted: null, returnTo: null };
async function settings(invoker = document.activeElement) {
  if (settingsController.state === "opening" || settingsController.state === "saving") return;
  settingsController.state = "opening"; settingsController.opener = invoker instanceof Element ? invoker : document.activeElement; rendererDiagnostics.surface = "settings";
  requestGate.invalidate();
  let result;
  try { result = await yellowBeast.getSettings(); } catch (_) { settingsController.state = "open"; app.innerHTML = `<section class="shell narrow" data-testid="settings-error"><p class="eyebrow">SETTINGS</p><h1>Settings unavailable</h1><p class="error">Presentation preferences could not be loaded. Your saved records were not changed.</p>${button("Back", "home")}</section>`; return; }
  if (resultIsError(result) || !result.settings) { settingsController.state = "open"; app.innerHTML = `<section class="shell narrow" data-testid="settings-error"><p class="eyebrow">SETTINGS</p><h1>Settings unavailable</h1><p class="error">${escape(result?.error?.message ?? "Presentation preferences could not be loaded.")}</p>${button("Back", "home")}</section>`; return; }
  const configured = result.provider?.openai?.configured === true; const groqConfigured = result.provider?.groq?.configured === true; const geminiConfigured = result.provider?.gemini?.configured === true; const openrouterConfigured = result.provider?.openrouter?.configured === true; applyPreferences(result.settings); current.settingsReturn = current.mode && current.projection ? () => play("Settings closed.", "result") : home;
  app.innerHTML = `<section class="shell narrow settings-surface" data-testid="settings-surface"><header><div><p class="eyebrow">APPLICATION SETTINGS</p><h1>Presentation and access</h1><p>These preferences affect presentation only; no world state is changed.</p></div><button type="button" data-action="close-settings">Close settings</button></header><form id="settings"><section class="settings-group"><h2>Interaction</h2><label>Input mode <select name="input_mode"><option value="structured">Structured controls</option><option value="natural">Natural language</option></select></label><label>Presentation provider <select name="provider"><option value="offline">Offline deterministic</option><option value="openai" ${configured ? "" : "disabled"}>OpenAI ${configured ? "" : "(configure below)"}</option><option value="auto">AUTO (Recommended)</option><option value="groq" ${groqConfigured ? "" : "disabled"}>Groq ${groqConfigured ? "" : "(configure below)"}</option><option value="gemini" ${geminiConfigured ? "" : "disabled"}>Google Gemini ${geminiConfigured ? "" : "(configure below)"}</option><option value="openrouter" ${openrouterConfigured ? "" : "disabled"}>OpenRouter ${openrouterConfigured ? "" : "(configure below)"}</option></select></label></section><section class="settings-group"><h2>Accessibility</h2><label>Theme <select name="theme"><option value="system">System</option><option value="high-contrast">High contrast</option></select></label><label>Text scale <select name="text_scale"><option value="default">Default</option><option value="large">Large</option><option value="extra-large">Extra large</option></select></label><label><input type="checkbox" name="reduced_motion"> Reduce motion</label><label><input type="checkbox" name="guided_introductions"> Show contextual guidance</label></section><section class="settings-group visual-settings"><h2>Field media rendering</h2><label><input type="checkbox" name="visual_rendering"> Visual rendering enabled</label><label><input type="checkbox" name="automatic_evidence_rendering"> Automatic evidence rendering</label><label>Adapter <select name="visual_adapter"><option value="fallback">Offline fallback</option><option value="comfyui">Local ComfyUI (optional)</option><option value="hosted">Hosted adapter (optional)</option></select></label><label>Quality <select name="visual_quality"><option value="documentary">Documentary</option><option value="detailed">Detailed</option></select></label><label><input type="checkbox" name="retry_failed_renders"> Retry failed renders</label><p>Rendering is presentation-only. Evidence records and gameplay continue offline.</p></section><div class="settings-actions"><button type="submit">Save and apply</button>${button("Reset to defaults", "reset-preferences")}<button type="button" data-action="close-settings">Close without changes</button></div><p id="settings-message" role="status" aria-live="polite"></p></form><form id="openai"><h2>Model &amp; Provider Credentials</h2><p class="credential-intro">Optional credentials for hosted language assistance. Keys are persisted locally and never shown again.</p><label>Provider <select name="credential_provider"><option value="groq">Groq (Free · gpt-oss-120b)${groqConfigured ? " · Configured" : ""}</option><option value="gemini">Google Gemini (Free · gemini-2.5-flash)${geminiConfigured ? " · Configured" : ""}</option><option value="openrouter">OpenRouter (Free router)${openrouterConfigured ? " · Configured" : ""}</option><option value="openai">OpenAI${configured ? " · Configured" : ""}</option></select></label><label>API key <input name="api_key" type="password" autocomplete="off" placeholder="Paste access key"></label><label>Model <input name="model" value="${escape(result.settings.openai_model ?? "")}" placeholder="Default configured model"></label><div class="credential-actions">${button("Save access key", "submit")}${button("Remove selected key", "remove-key")}</div></form></section>`;
  settingsController.state = "open"; settingsController.mounted = app.querySelector("[data-testid=settings-surface]");
  const form = document.querySelector("#settings");
  const control = (name) => form.querySelector(`[name="${name}"]`); const inputMode = control("input_mode"); const provider = control("provider"); const theme = control("theme"); const textScale = control("text_scale"); const reducedMotion = control("reduced_motion"); const guided = control("guided_introductions");
  inputMode.value = result.settings.input_mode; provider.value = result.settings.provider; theme.value = result.settings.theme; textScale.value = result.settings.text_scale; reducedMotion.checked = Boolean(result.settings.reduced_motion); guided.checked = result.settings.guided_introductions !== false; control("visual_rendering").checked = result.settings.visual_rendering !== false; control("automatic_evidence_rendering").checked = result.settings.automatic_evidence_rendering !== false; control("visual_adapter").value = result.settings.visual_adapter ?? "fallback"; control("visual_quality").value = result.settings.visual_quality ?? "documentary"; control("retry_failed_renders").checked = result.settings.retry_failed_renders !== false;
  const message = document.querySelector("#settings-message"); const preview = () => applyPreferences({ ...result.settings, theme:theme.value, text_scale:textScale.value, reduced_motion:reducedMotion.checked, guided_introductions:guided.checked }); [theme, textScale, reducedMotion, guided].forEach((item) => item.addEventListener("change", preview)); form.addEventListener("submit", async (event) => { event.preventDefault(); if (settingsController.state === "saving") return; settingsController.state = "saving"; const data = new FormData(form); const model = document.querySelector('#openai [name="model"]')?.value?.trim() || undefined; form.querySelectorAll("input,select,button").forEach((item) => { item.disabled = true; }); const saved = await yellowBeast.updateSettings({ settings:{ input_mode:data.get("input_mode"), provider:data.get("provider"), theme:data.get("theme"), text_scale:data.get("text_scale"), reduced_motion:data.get("reduced_motion") === "on", guided_introductions:data.get("guided_introductions") === "on", visual_rendering:data.get("visual_rendering") === "on", automatic_evidence_rendering:data.get("automatic_evidence_rendering") === "on", visual_adapter:data.get("visual_adapter"), visual_quality:data.get("visual_quality"), retry_failed_renders:data.get("retry_failed_renders") === "on", openai_model:model } }); form.querySelectorAll("input,select,button").forEach((item) => { item.disabled = false; }); if (!resultIsError(saved)) { settingsController.state = "saved"; applyPreferences(saved.settings); message.textContent = "Preferences saved and applied."; } else { settingsController.state = "open"; message.textContent = saved.error.message; } });
  const modelControl = document.querySelector('#openai [name="model"]'); if (modelControl) modelControl.value = result.settings.openai_model ?? "";
  document.querySelector("#openai").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const targetProvider = data.get("credential_provider") || "openai";
    const apiKey = data.get("api_key");
    const model = data.get("model") || null;
    let saved;
    if (targetProvider === "openai") {
      saved = await yellowBeast.configureOpenAI({ api_key: apiKey, model });
    } else {
      saved = await yellowBeast.configureProvider({ provider: targetProvider, api_key: apiKey, model });
    }
    message.textContent = saved.ok ? `${targetProvider === "openai" ? "Access" : targetProvider} key stored. It is never shown here again.` : saved.error.message;
    if (saved.ok) settings();
  });
  form.querySelector("select, input, button")?.focus({ preventScroll:true });
}
function about() { requestGate.invalidate(); app.innerHTML = `<section class="shell narrow"><p class="eyebrow">ABOUT · UNOFFICIAL</p><h1>Yellow Beast</h1><p>An unofficial persistent, shared-world field experience inspired by institutional horror. It works offline, with optional language assistance.</p><p>Worlds are saved in your application data folder; normal play never requires a terminal. Yellow Beast is not an official ASYNC or Kane Pixels product.</p>${button("Back", "home")}</section>`; }
document.addEventListener("click", async (event) => { const action = event.target.dataset.action; if (!action) return; if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); if (action === "developer") { developerConsole(); return; } if (action === "renderer-retry") { settingsController.state = "closed"; if (rendererDiagnostics.surface === "settings") settings(event.target); else home(); return; } if (action === "home") { home(); return; }
else if (action === "personnel-confirm-continue") {
  const confirmed = await yellowBeast.confirmQ4Personnel({ world_id:current.world.id });
  if (!resultIsError(confirmed)) enterMode("field-researcher");
  return;
}
else if (action === "leave") {
  const isField = current.projection?.mode?.id === "field-researcher" && ["FIELD_OPERATION", "RETURN"].includes(current.projection?.phase?.phase_id);
  if (isField) {
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_panel_open");
    showTerminationPortal();
    return;
  }
  home();
  return;
}
else if (action === "cancel-termination") {
  if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_panel_close");
  document.querySelector(".termination-portal")?.remove();
  focusNaturalInput();
  return;
}
else if (action === "confirm-termination") {
  if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
  document.querySelector(".termination-portal")?.remove();
  home();
  return;
} else if (action === "close-settings") { settingsController.state = "closing"; const opener = settingsController.opener; const returnTo = current.settingsReturn ?? home; current.settingsReturn = null; returnTo(); settingsController.state = "closed"; queueMicrotask(() => opener?.isConnected && opener.focus()); } else if (action === "new") newWorld(); else if (action === "import") { const imported = await yellowBeast.chooseImportWorld(); if (resultIsError(imported) && imported.error.code !== "IMPORT_CANCELLED") alert(imported.error.message); home(); } else if (action === "settings") settings(event.target); else if (action === "about") about(); else if (action === "reset-preferences") { const saved = await yellowBeast.updateSettings({ settings:{ theme:"system", text_scale:"default", reduced_motion:false, guided_introductions:true } }); if (!resultIsError(saved)) applyPreferences(saved.settings); settings(event.target); } else if (action === "refresh-view") { const context = requestContext(); const refreshed = await yellowBeast.getGameplayProjection({ world_id:context.worldId, mode:context.mode }); if (!resultIsError(refreshed) && requestContext().worldId === context.mode) { current.projection = refreshed.projection; play("Current view refreshed.", "result"); } } else if (action === "remove-key") { const providerSelect = document.querySelector('#openai [name="credential_provider"]'); const targetProvider = providerSelect?.value || "openai"; if (targetProvider === "openai" && yellowBeast.removeOpenAIKey) { await yellowBeast.removeOpenAIKey(); } else if (yellowBeast.removeProviderKey) { await yellowBeast.removeProviderKey({ provider: targetProvider }); } settings(event.target); } else if (action.startsWith("rename:")) { const worldId = action.slice(7); const prior = event.target.closest("li")?.dataset.worldName ?? ""; const name = prompt("Rename this world. This changes only its library name.", prior); if (name !== null) { const renamed = await yellowBeast.renameWorld({ world_id:worldId, name }); if (resultIsError(renamed)) alert(renamed.error.message); home(); } } else if (action.startsWith("restore:")) { const restored = await yellowBeast.restoreBackup({ world_id:action.slice(8), confirmed:confirm("Restore the previous save? Recent changes may be lost.") }); if (!resultIsError(restored)) selectWorld(action.slice(8)); else alert(restored.error.message); } else if (action.startsWith("export:")) { const result = await yellowBeast.chooseExportWorld({ world_id: action.slice(7) }); if (resultIsError(result) && result.error.code !== "EXPORT_CANCELLED") alert(result.error.message); } else if (action.startsWith("delete:")) { const worldId = action.slice(7); const name = event.target.closest("li")?.dataset.worldName ?? "this world"; if (confirm(`Delete “${name}” and its saved sessions? This cannot be undone.`)) { const deleted = await yellowBeast.deleteWorld({ world_id:worldId, confirmed:true }); if (resultIsError(deleted)) alert(result.error.message); home(); } } else if (action.startsWith("diagnostic:")) { const result = await yellowBeast.exportTesterReport({ world_id:action.slice(11), mode:"field-researcher" }); alert(resultIsError(result) ? result.error.message : `Diagnostic record exported to ${result.file}. Credentials and provider keys are omitted.`); } else if (action.startsWith("world:")) selectWorld(action.slice(6)); else if (action.startsWith("mode:")) enterMode(action.slice(5)); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && document.querySelector(".termination-portal")) { event.preventDefault(); document.querySelector('[data-action="cancel-termination"]')?.click(); return; } if (event.key === "Escape" && document.querySelector("[data-testid=settings-surface]")) { event.preventDefault(); document.querySelector("[data-action=close-settings]")?.click(); return; } if (event.altKey && event.key === ",") { event.preventDefault(); settings(); return; } if (!current.projection || event.target.matches("input, textarea, select, button")) return; const recap = document.querySelector("#recap-panel"); if (event.key === "?" && recap) { event.preventDefault(); recap.open = true; recap.querySelector("summary")?.focus({ preventScroll:true }); } else if (event.key === "Escape" && recap?.open) { event.preventDefault(); recap.open = false; focusNaturalInput(); } });
function boot() { const bypass = window.__YB_TEST_BYPASS_BOOT__ === true || /(?:bypass-boot|test-mode)/i.test(window.location.search + window.location.hash); if (bypass) { home(); return; } if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_relay"); app.innerHTML = `<section class="async-boot" data-testid="async-boot" role="status" aria-live="polite"><div class="async-boot-mark"><span>A</span><strong>ASYNC</strong></div><p>FIELD OPERATIONS SYSTEM</p><small>IDENTIFICATION / INITIALIZING</small><div class="boot-rule"><i></i></div><button type="button" data-action="skip-boot">Skip initialization</button></section>`; const timer = window.setTimeout(() => { if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_confirm"); home(); }, 700); document.querySelector("[data-action=skip-boot]").addEventListener("click", () => { window.clearTimeout(timer); if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_confirm"); home(); }); }
boot();
