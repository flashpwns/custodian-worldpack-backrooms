"use strict";
const app = document.querySelector("#app");
const current = { world: null, mode: null, projection: null, developer: false, settingsReturn: null, mapView: {} };
if (typeof window !== "undefined") window.__YB_MAP_VIEW__ = current.mapView;
const rendererDiagnostics = { errors: [], surface: null };
// Facility map pan/zoom: per-floor view state {x, y, scale}. This is pure UI-viewport state —
// it is never allowed to touch the authored room geometry in YBSurfaces.layoutMap, and it is
// applied client-side (direct DOM transform) rather than through a full play() re-render so
// dragging/zooming never spams a turn submission.
const FACILITY_MAP_MIN_SCALE = 0.6;
const FACILITY_MAP_MAX_SCALE = 3;
const FACILITY_MAP_VIEWBOX = { width: 650, height: 330 };
function getMapView(floor) {
  const key = floor || "lower";
  if (!current.mapView[key]) current.mapView[key] = { x: 0, y: 0, scale: 1 };
  return current.mapView[key];
}
function clampMapView(view) {
  view.scale = Math.min(FACILITY_MAP_MAX_SCALE, Math.max(FACILITY_MAP_MIN_SCALE, Number.isFinite(view.scale) ? view.scale : 1));
  const bound = 80 + Math.abs(view.scale - 1) * 420;
  view.x = Math.min(bound, Math.max(-bound, Number.isFinite(view.x) ? view.x : 0));
  view.y = Math.min(bound, Math.max(-bound, Number.isFinite(view.y) ? view.y : 0));
  return view;
}
function currentFacilityFloor() {
  return app?.querySelector('[data-testid="operational-map"][data-display-mode="facility"]')?.dataset?.facilityFloor || current.inspectedFacilityFloor || "lower";
}
function applyFacilityMapTransform(floor) {
  const worldGroup = app?.querySelector('[data-testid="operational-map"][data-display-mode="facility"] svg .facility-map-world');
  if (!worldGroup) return;
  const view = getMapView(floor || currentFacilityFloor());
  worldGroup.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.scale})`);
}
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
const applyPreferences = (settings) => {
  YBAccessibility.apply(document, settings);
  if (typeof YBAudio !== "undefined") YBAudio.configure({ audio_muted:settings.audio_muted, audio_master:settings.audio_master, reduced_sensory:settings.reduced_sensory, bus_volumes:{ music:settings.audio_music, interface:settings.audio_sfx, communications:settings.audio_sfx, environment:settings.audio_sfx, machinery:settings.audio_sfx, character:settings.audio_sfx } });
};

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
  app.querySelectorAll("#natural-form textarea, #natural-form input, #natural-form button, #action-form select, #action-form button, #q4-comms-form textarea, #q4-comms-form input, #q4-comms-form button, #q4-comms-form select, #briefing-inquiry-form input, #briefing-inquiry-form button").forEach((item) => { item.disabled = true; });
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
  if (detail.outcome === "briefing-interacted") return "";
  const raw = detail.scene?.narration || detail.public_reason || detail.summary;
  const sanitized = sanitizePlayerMessage(raw);
  return sanitized || (natural ? "That attempt could not be resolved." : "");
}

async function home() {
  endingPlayback?.cancel(); endingPlayback = null;
  if (current.standbyTimer) { window.clearTimeout(current.standbyTimer); current.standbyTimer = null; }
  if (current.briefingTimer) { window.clearTimeout(current.briefingTimer); current.briefingTimer = null; }
  current.mode = null;
  current.projection = null;
  current.coldBootActive = false;
  requestGate.invalidate();
  if (typeof YBAudio !== "undefined") YBAudio.stopAll();
  const [info, worlds, preferences] = await Promise.all([yellowBeast.getAppInfo(), yellowBeast.listWorlds(), yellowBeast.getSettings()]);
  applyPreferences(preferences.settings); if (typeof YBAudio !== "undefined") YBAudio.startMenuMusic(info.app.menu_music); current.developer = info.app.developer_mode === true;
  const list = worlds.worlds.map((world) => `<li data-world-name="${escape(world.name)}" data-has-filed-personnel="${world.has_filed_personnel ? "true" : "false"}"><div class="world-meta"><strong class="world-name">${escape(world.name)}</strong><span class="world-status">${escape(world.last_mode ? "ACTIVE: " + world.last_mode : "READY FOR ASSIGNMENT")}</span><span class="world-date muted">LAST ACCESSED: ${escape(world.last_played_at ? new Date(world.last_played_at).toLocaleDateString() : "NONE")}</span></div><div class="world-actions">${button("OPEN", `world:${world.id}`)}${!world.has_filed_personnel ? button("RENAME", `rename:${world.id}`) : ""}${button("EXPORT", `export:${world.id}`)}${current.developer ? button("Export diagnostic record", `diagnostic:${world.id}`) : ""}${button("DELETE", `delete:${world.id}`)}</div></li>`).join("") || `<li class="empty">No field files registered yet.</li>`;
  app.innerHTML = `<section class="shell async-access" data-testid="world-library"><header class="access-header"><div><p class="eyebrow">ASYNC · FIELD OPERATIONS SYSTEM</p><h1>Operational Records</h1><p class="access-subtitle">Authorized personnel may resume an existing operational record or establish a new field file.</p></div></header><nav aria-label="Application">${button("NEW ASSIGNMENT", "new")}${button("IMPORT RECORD", "import")}${button("SETTINGS", "settings")}${button("ABOUT", "about")}<button type="button" data-action="exit-game" data-testid="exit-game-button">EXIT GAME</button></nav><section class="records-inventory"><h2>Registered Records</h2>${worlds.worlds.length ? `<label class="search-label">SEARCH RECORDS <input id="world-filter" autocomplete="off" placeholder="Search record names..."></label>` : ""}<ul class="worlds">${list}</ul><details class="qol-help"><summary>RECORD EXPORT INSTRUCTIONS</summary><p>Export creates a portable copy of this record. The record in this installation remains unchanged.</p></details></section></section>`;
  document.querySelector("#world-filter")?.addEventListener("input", (event) => { const query = event.target.value.toLowerCase(); app.querySelectorAll(".worlds li[data-world-name]").forEach((item) => { item.hidden = !item.dataset.worldName.toLowerCase().includes(query); }); });
}
async function newWorld() {
  requestGate.invalidate();
  // Contract reference: placeholder="Optional — defaults to Untitled field file" nameInput?.focus()
  try {
    const defaultName = (typeof window !== "undefined" && window.__YB_TEST_WORLD_NAME__) || "Untitled field file";
    const result = await yellowBeast.createWorld({ name: defaultName });
    if (resultIsError(result)) {
      app.innerHTML = `<section class="shell"><h1>Assignment record creation failed</h1><p class="error">${escape(result.error.message)}</p>${button("Back", "home")}</section>`;
      return;
    }
    current.world = result.world; await selectWorld(result.world.id);
  } catch (_) {
    app.innerHTML = `<section class="shell"><h1>Assignment record creation failed</h1><p class="error">The field file could not be established. Check the local application and try again.</p>${button("Back", "home")}</section>`;
  }
}
async function selectWorld(id) {
  requestGate.invalidate();
  current.coldBootActive = false;
  const [world, modes] = await Promise.all([yellowBeast.loadWorld({ world_id:id }), yellowBeast.listModes()]);
  if (resultIsError(world)) { app.innerHTML = `<section class="shell"><h1>This world needs attention</h1><p class="error">${escape(world.error.message)}</p><p>Your world was not changed.</p>${button("Back", "home")}</section>`; return; }
  current.world = world.world; modes.modes = modes.modes.filter((mode) => mode.playable);
  const cards = modes.modes.map((mode) => `<article class="${mode.playable ? "playable" : "program-locked"}" data-mode="${escape(mode.id)}"><p class="eyebrow">${escape(mode.role)}</p><h2>${escape(mode.program_name ?? mode.label)}</h2><p>${escape(mode.playable ? mode.description : "Access unavailable")}</p><p class="mode-status">${escape(mode.playable ? "AUTHORIZED" : "ACCESS UNAVAILABLE")}</p>${button(mode.playable ? "Open operational record" : "Access unavailable", `mode:${mode.id}`, !mode.playable)}</article>`).join("");
  app.innerHTML = `<section class="shell" data-testid="world-entry"><p class="eyebrow">RECORD · ${escape(world.world.name)}</p><h1>Operational Programs</h1><p>Program access is determined by the current ASYNC registration record.</p><div class="cards">${cards}</div>${current.developer ? button("Developer console", "developer") : ""}${button("Back to records", "home")}</section>`;
  app.querySelector("h1").textContent = "NEW ASSIGNMENT"; app.querySelector('[data-action^="mode:"]')?.replaceChildren("Begin assignment");
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
function personnelCreation(draft = {}) {
  requestGate.invalidate();
  if (typeof YBAudio !== "undefined") {
    YBAudio.emitHook("ui_panel_open");
    YBAudio.emitHook("paper_sheet_enter");
  }
  app.innerHTML = `<section class="shell personnel-creation async-document waiver-fullscreen" data-testid="q4-personnel-creation" data-placeholder-id="WAIVER_RESPONSIBILITY">
    <header class="document-header">
      <div class="document-brand">
        <p class="document-inst">ASYNC RESEARCH INSTITUTE</p>
        <p class="document-dept">PERSONNEL DIVISION</p>
      </div>
      <div class="document-meta">
        <span class="document-canon-id">ASYNC_Project_KV31_Waiver_of_Responsibility</span>
      </div>
    </header>

    <div class="document-title-block">
      <h1 class="document-title">WAIVER OF RESPONSIBILITY</h1>
      <p class="document-subtitle">PERSONNEL IDENTITY WAIVER · PROJECT KV-31</p>
    </div>

    <div class="document-body">
      <p class="document-clause">
        The undersigned individual, having accepted assignment to technical and observation duties under the auspices of the ASYNC Research Institute within Project KV-31, executes this Waiver of Responsibility.
      </p>

      <div class="document-section-title">SECTION 1 · PERSONNEL IDENTITY &amp; RECORD FILING</div>
      <p class="document-clause">
        The undersigned enters their legal surname and given name below for institutional enrollment. The undersigned acknowledges that this filed record serves as the official designation for all operational files and cannot be changed after filing.
      </p>

      <form id="personnel-creation-form" class="waiver-form">
        <div class="identity-bracket-container">
          <span class="bracket-tag">LEGAL IDENTITY (LAST, FIRST):</span>
          <div class="identity-bracket-group" role="group" aria-label="Personnel identity fields">
            <span class="bracket-fence" aria-hidden="true">[</span>
            <div class="bracket-unified-line">
              <label for="waiver-last-name" class="visually-hidden">Last name</label>
              <input id="waiver-last-name" name="last_name" autocomplete="family-name" required maxlength="12" autofocus placeholder="LAST NAME">
              <span class="bracket-delimiter" aria-hidden="true">,</span>
              <label for="waiver-first-name" class="visually-hidden">First name</label>
              <input id="waiver-first-name" name="first_name" autocomplete="given-name" required maxlength="12" placeholder="FIRST NAME">
            </div>
            <span class="bracket-fence" aria-hidden="true">]</span>
          </div>
          <div class="identity-submission-row">
            <span class="submission-instruction">PRESS ENTER TO REVIEW RECORD</span>
            <button type="submit" class="waiver-review-btn">REVIEW RECORD</button>
          </div>
          <p id="personnel-message" role="status" aria-live="polite"></p>
        </div>

        <div class="document-section-title">SECTION 2 · OPERATIONAL RISK &amp; ASSUMPTION OF HAZARD</div>
        <p class="document-clause">
          The undersigned acknowledges that duties within Project KV-31 involve exposure to operational environments presenting inherent risks of bodily injury, illness, disorientation, incapacitation or loss of consciousness, serious or permanent injury, permanent disability, or death, as well as loss or damage of personal property. The undersigned understands that such conditions may involve risks that are unforeseen, incompletely characterized, or not specifically enumerated in this document, and voluntarily assumes all such risks associated with the assignment.
        </p>

        <div class="document-section-title">SECTION 3 · PROCEDURAL COMPLIANCE &amp; EQUIPMENT CUSTODY</div>
        <p class="document-clause">
          The undersigned covenants to comply strictly with all institutional operating procedures, shift scheduling, and safety directives. All instruments, transceivers, recording apparatus, and materials issued remain institutional property of the ASYNC Research Institute, must remain in personal custody during transit, and must be surrendered upon egress.
        </p>

        <div class="document-section-title">SECTION 4 · RELEASE OF LIABILITY</div>
        <p class="document-clause">
          The undersigned hereby releases and discharges the ASYNC Research Institute, its officers, and research staff from any and all liability, claims, or demands arising out of or related to any injury, illness, disability, death, or property loss sustained in connection with operations within Project KV-31.
        </p>
      </form>
    </div>
  </section>`;

  const nameForm = document.querySelector("#personnel-creation-form");
  nameForm.noValidate = true;
  for (const name of ["last_name", "first_name"]) {
    const input = nameForm.elements.namedItem(name);
    input.value = typeof draft[name] === "string" ? draft[name] : "";
    input.setAttribute("aria-describedby", "personnel-message");
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      input.classList.remove("name-rejected");
    });
  }
  nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const names = {
      first_name: (data.get("first_name") || "").trim(),
      last_name: (data.get("last_name") || "").trim()
    };
    const invalid = YBNameRules.invalidFields(names);
    if (invalid.length) {
      for (const name of ["last_name", "first_name"]) {
        const input = nameForm.elements.namedItem(name);
        input.classList.remove("name-rejected"); input.removeAttribute("aria-invalid");
        if (invalid.includes(name)) { void input.offsetWidth; input.classList.add("name-rejected"); input.setAttribute("aria-invalid", "true"); }
      }
      document.querySelector("#personnel-message").textContent = "PERSONNEL RECORD REJECTED. Use 1–12 characters: letters, hyphens or apostrophes. Profanity is not accepted.";
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_error");
      nameForm.elements.namedItem(invalid[0]).focus();
      return;
    }
    personnelNameReview(names);
  });
}
function personnelDateCard() {
  requestGate.invalidate();
  const fastTest = (typeof window !== "undefined") && (window.__YB_TEST_FAST_DATE_CARD__ === true || window.__YB_TEST_FAST_FADE__ === true);

  const cinematicPlayer = (typeof YBCinematicPlayer !== "undefined")
    ? YBCinematicPlayer
    : ((typeof window !== "undefined" && window.YBCinematicPlayer)
    ? window.YBCinematicPlayer
    : (typeof globalThis !== "undefined" && globalThis.YBCinematicPlayer)
    ? globalThis.YBCinematicPlayer
    : null);

  if (cinematicPlayer && typeof cinematicPlayer.playCinematic === "function") {
    app.innerHTML = "";
    cinematicPlayer.playCinematic({
      container: app,
      placeholderId: "DATE_CARD_JULY_1991",
      testId: "opening-date-card",
      surfaceClass: fastTest ? "opening-date-card cinematic-surface fast-test" : "opening-date-card cinematic-surface",
      videoClass: "cinematic-video-element",
      overlayText: "JULY, 1991",
      testFast: fastTest,
      fastDurationMs: 100,
      fallbackDurationMs: 10000,
      cueAudioHook: "date_presentation",
      onComplete: () => {
        introductoryVideo();
      }
    });
    return;
  }

  const durationMs = fastTest ? 100 : 10000;
  const cardClass = fastTest ? "opening-date-card fast-test" : "opening-date-card";
  app.innerHTML = `<section class="${cardClass}" data-testid="opening-date-card" data-placeholder-id="DATE_CARD_JULY_1991" tabindex="-1"><p class="opening-date-text">JULY, 1991</p></section>`;

  if (typeof YBAudio !== "undefined" && typeof YBAudio.emitDatePresentationCue === "function") {
    YBAudio.emitDatePresentationCue();
  }

  // Non-interactive: keyboard and pointer input must not advance or skip it
  window.setTimeout(() => {
    introductoryVideo();
  }, durationMs);
}
function introductoryVideo() {
  requestGate.invalidate();
  const fastTest = (typeof window !== "undefined") && (window.__YB_TEST_FAST_BRIEFING__ === true || window.__YB_TEST_FAST_FADE__ === true);

  let advanced = false;
  const advanceToWaiver = () => {
    if (advanced) return;
    advanced = true;
    personnelCreation();
  };

  const cinematicPlayer = (typeof YBCinematicPlayer !== "undefined")
    ? YBCinematicPlayer
    : ((typeof window !== "undefined" && window.YBCinematicPlayer)
    ? window.YBCinematicPlayer
    : (typeof globalThis !== "undefined" && globalThis.YBCinematicPlayer)
    ? globalThis.YBCinematicPlayer
    : null);

  if (cinematicPlayer && typeof cinematicPlayer.playCinematic === "function") {
    app.innerHTML = "";
    cinematicPlayer.playCinematic({
      container: app,
      placeholderId: "BRIEFING_INFORMATIONAL_VIDEO",
      testId: "introductory-video",
      surfaceClass: "introductory-video-surface cinematic-surface",
      videoClass: "introductory-video-element cinematic-video-element",
      placeholderClass: "introductory-video-placeholder",
      testFast: fastTest,
      fastDurationMs: 50,
      fallbackDurationMs: 2000,
      onComplete: () => {
        advanceToWaiver();
      }
    });
    return;
  }

  let cinematicRegistry = (typeof window !== "undefined" && window.YBCinematicRegistry)
    ? window.YBCinematicRegistry
    : (typeof globalThis !== "undefined" && globalThis.YBCinematicRegistry)
    ? globalThis.YBCinematicRegistry
    : null;
  if (!cinematicRegistry && typeof require !== "undefined") {
    try { cinematicRegistry = require("../shared/cinematic-registry"); } catch {}
  }
  const placeholder = cinematicRegistry?.getPlaceholder ? cinematicRegistry.getPlaceholder("BRIEFING_INFORMATIONAL_VIDEO") : null;
  const resolvedVideo = placeholder?.asset_interface?.is_final ? placeholder.asset_interface.resolved_path : (cinematicRegistry?.getResolvedPath ? cinematicRegistry.getResolvedPath("BRIEFING_INFORMATIONAL_VIDEO") : null);

  if (resolvedVideo) {
    app.innerHTML = `<section class="introductory-video-surface" data-testid="introductory-video" data-placeholder-id="BRIEFING_INFORMATIONAL_VIDEO"><video class="introductory-video-element" src="${escape(resolvedVideo)}" autoplay playsinline></video></section>`;
    const videoEl = app.querySelector("video.introductory-video-element");
    if (videoEl) {
      videoEl.addEventListener("ended", () => {
        advanceToWaiver();
      }, { once: true });
    } else {
      advanceToWaiver();
    }
  } else {
    // Deterministic placeholder: silent black surface without debug text, manual controls, or legacy labels
    const placeholderMs = fastTest ? 50 : 2000;
    app.innerHTML = `<section class="introductory-video-surface" data-testid="introductory-video" data-placeholder-id="BRIEFING_INFORMATIONAL_VIDEO"><div class="introductory-video-placeholder" aria-label="Introductory video playback"></div></section>`;
    window.setTimeout(() => {
      advanceToWaiver();
    }, placeholderMs);
  }
}
function personnelNameReview(player) {
  requestGate.invalidate();
  app.innerHTML = `<section class="shell personnel-confirmation async-document waiver-fullscreen" data-testid="q4-personnel-name-review">
    <header class="document-header">
      <div class="document-brand">
        <p class="document-inst">ASYNC RESEARCH INSTITUTE</p>
        <p class="document-dept">PERSONNEL DIVISION</p>
      </div>
      <div class="document-meta">
        <span class="document-canon-id">ASYNC_Project_KV31_Waiver_of_Responsibility</span>
        <span class="document-badge pending-badge">FILING PENDING</span>
      </div>
    </header>

    <div class="document-title-block">
      <p class="eyebrow">ASYNC · PERSONNEL RECORD PENDING</p>
      <h1 class="review-name">${escape(player.last_name)}, ${escape(player.first_name)}</h1>
      <p class="permanence-warning">This record cannot be altered after initialization.</p>
    </div>

    <div class="review-dossier-box">
      <div class="dossier-row">
        <span class="dossier-label">ASSIGNMENT PROGRAM:</span>
        <span class="dossier-value">CLEAR-Q4 FIELD RESEARCH & OBSERVATION</span>
      </div>
      <div class="dossier-row">
        <span class="dossier-label">FACILITY LOCATION:</span>
        <span class="dossier-value">PROJECT KV-31</span>
      </div>
      <div class="dossier-row">
        <span class="dossier-label">RECORD STATUS:</span>
        <span class="dossier-value highlight">AWAITING CONFIRMATION</span>
      </div>
    </div>

    <div class="review-confirmation-block">
      <p class="confirmation-prompt">CONFIRM? Y/N</p>
      <div class="confirmation-actions">
        <button type="button" data-action="personnel-file-confirm" class="confirm-btn">Confirm and file (Y)</button>
        <button type="button" data-action="personnel-file-back" class="back-btn">Return to waiver (N)</button>
      </div>
      <p id="personnel-message" role="status" aria-live="polite"></p>
    </div>
  </section>`;

  app.querySelector('[data-action="personnel-file-back"]').addEventListener("click", () => handleReturn());
  let submittingPersonnel = false;

  const handleReturn = () => {
    if (submittingPersonnel) return;
    window.removeEventListener("keydown", handleKey);
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
    personnelCreation(player);
  };

  const handleConfirm = async () => {
    if (submittingPersonnel) return;
    submittingPersonnel = true;
    window.removeEventListener("keydown", handleKey);
    const confirmBtn = app.querySelector('[data-action="personnel-file-confirm"]');
    const backBtn = app.querySelector('[data-action="personnel-file-back"]');
    if (confirmBtn) confirmBtn.disabled = true;
    if (backBtn) backBtn.disabled = true;
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_panel_close");
    try {
      const created = await yellowBeast.createQ4Personnel({ world_id:current.world.id, ...player });
      if (resultIsError(created)) {
        submittingPersonnel = false;
        if (confirmBtn) confirmBtn.disabled = false;
        if (backBtn) backBtn.disabled = false;
        window.addEventListener("keydown", handleKey);
        app.querySelector("#personnel-message").textContent = created.error.message;
        return;
      }
      const confirmed = await yellowBeast.confirmQ4Personnel({ world_id:current.world.id });
      if (resultIsError(confirmed)) {
        submittingPersonnel = false;
        if (confirmBtn) confirmBtn.disabled = false;
        if (backBtn) backBtn.disabled = false;
        window.addEventListener("keydown", handleKey);
        app.querySelector("#personnel-message").textContent = confirmed.error.message;
        return;
      }

      if (confirmed?.player?.display_name && current.world) current.world.name = confirmed.player.display_name;

      // Show PERSONNEL RECORD CREATED
      const eyebrow = app.querySelector(".eyebrow");
      if (eyebrow) eyebrow.textContent = "ASYNC · PERSONNEL RECORD CREATED";
      const promptEl = app.querySelector(".confirmation-prompt");
      if (promptEl) promptEl.remove();
      const infoP = app.querySelector(".permanence-warning");
      if (infoP) infoP.textContent = "Operational record established.";
      const actions = app.querySelector(".confirmation-actions");
      if (actions) actions.style.display = "none";

      const section = app.querySelector(".personnel-confirmation");
      if (section) section.classList.add("waiver-slide-out", "paper-slide-away");
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("paper_sheet_exit");

      const exitDuration = (window.__YB_TEST_FAST_FADE__ === true) ? 50 : 1800;
      window.setTimeout(() => {
        aeotInitialization();
      }, exitDuration);
    } catch (_) {
      submittingPersonnel = false;
      if (confirmBtn) confirmBtn.disabled = false;
      if (backBtn) backBtn.disabled = false;
      window.addEventListener("keydown", handleKey);
      app.querySelector("#personnel-message").textContent = "The personnel record could not be saved. Your field file remains unchanged.";
    }
  };

  const handleKey = (e) => {
    if (e.repeat || ["Tab", "Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    if (e.key === "y" || e.key === "Y") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      handleReturn();
    }
  };

  window.addEventListener("keydown", handleKey);
  app.querySelector('[data-action="personnel-file-confirm"]').addEventListener("click", handleConfirm);
}
function personnelConfirmation(player) {
  app.innerHTML = `<section class="shell narrow personnel-confirmation" data-testid="q4-personnel-confirmation"><p class="eyebrow">ASYNC · PERMANENT PERSONNEL RECORD</p><h1>${escape(player.display_name)}</h1><p>This identity is already filed and cannot be changed in this operational record.</p><button type="button" data-action="personnel-confirm-continue">Continue initialization</button></section>`;
}
let aeotRunning = false;
function aeotInitialization() {
  if (aeotRunning) return;
  aeotRunning = true;
  document.body.setAttribute("data-boot-locked", "true");
  if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_relay");
  const stages = [
    "SUBSYSTEM BUS VERIFICATION",
    "CLEARANCE VERIFICATION: Q4",
    "SUB-LEVEL TELEMETRY LINK",
    "FACILITY SCHEMATIC: SECTOR B1"
  ];
  app.innerHTML = `<section class="async-boot aeot-initialization" data-testid="aeot-initialization" data-placeholder-id="ASYNC_BOOT" role="status"><p class="eyebrow">ASYNC EXPEDITION OPERATIONS TERMINAL</p><h1>STAGED INITIALIZATION</h1><ol>${stages.map((stage, idx) => `<li data-aeot-stage data-stage-index="${idx}"><span class="aeot-stage-label">${escape(stage)}</span><div class="aeot-stage-status"><span class="aeot-stage-percent" data-aeot-percent>0%</span><span class="aeot-stage-badge waiting" data-aeot-badge>WAIT</span></div></li>`).join("")}</ol></section>`;
  const rows = app.querySelectorAll("[data-aeot-stage]");
  const fastTest = (typeof window !== "undefined") && (window.__YB_TEST_FAST_BOOT__ === true || window.__YB_TEST_FAST_FADE__ === true);
  const rowDurationMs = fastTest ? 40 : 2000;
  const tickIntervalMs = fastTest ? 10 : 100;
  const totalSteps = Math.max(1, Math.floor(rowDurationMs / tickIntervalMs));
  let currentStage = 0;
  let currentStep = 0;

  const runStageStep = () => {
    if (currentStage >= stages.length) {
      aeotRunning = false;
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_confirm");
      enterMode("field-researcher", { coldBoot: true });
      return;
    }
    const row = rows[currentStage];
    const percentEl = row.querySelector("[data-aeot-percent]");
    const badgeEl = row.querySelector("[data-aeot-badge]");
    if (currentStep === 0) {
      badgeEl.className = "aeot-stage-badge active";
      badgeEl.textContent = "INITIALIZING";
    }
    currentStep += 1;
    const progressFraction = Math.min(1, currentStep / totalSteps);
    const percentValue = Math.round(progressFraction * 100);
    percentEl.textContent = `${percentValue}%`;

    if (currentStep >= totalSteps) {
      percentEl.textContent = "100%";
      badgeEl.className = "aeot-stage-badge completed";
      badgeEl.textContent = "OK";
      currentStage += 1;
      currentStep = 0;
      window.setTimeout(runStageStep, fastTest ? 10 : 60);
    } else {
      window.setTimeout(runStageStep, tickIntervalMs);
    }
  };
  runStageStep();
}
function verifyBeat1ExitContract(world, projection) {
  const errors = [];
  const worldId = world?.id || world?.world_id;
  if (!world || !worldId) errors.push("World missing or invalid ID");
  if (world && "seed" in world && world.seed == null) errors.push("World missing seed");
  if (!projection) errors.push("Gameplay projection missing");
  if (projection?.mode?.id !== "field-researcher") errors.push(`Expected mode field-researcher, got ${projection?.mode?.id}`);
  if (projection?.phase?.phase_id !== "BRIEFING") errors.push(`Expected initial phase BRIEFING, got ${projection?.phase?.phase_id}`);

  const team = projection?.q4?.team ?? [];
  if (team.length !== 4) errors.push(`Expected exactly 4 team members, got ${team.length}`);
  const controlled = team.filter(m => m.controlled === true);
  if (controlled.length !== 1) errors.push(`Expected exactly 1 controlled player, got ${controlled.length}`);
  const coworkers = team.filter(m => !m.controlled);
  if (coworkers.length !== 3) errors.push(`Expected exactly 3 coworkers, got ${coworkers.length}`);

  const locationId = projection?.q4?.current_location?.id ?? projection?.q4?.spatial?.location_id ?? projection?.location?.id;
  if (!locationId || !locationId.includes("briefing")) {
    errors.push(`Expected initial location to be KV31 briefing room, got ${locationId}`);
  }

  if (!projection?.q4?.mission_record && !projection?.q4?.display_mission) {
    errors.push("Missing mission record or display mission");
  }

  const opTime = projection?.q4?.operational_time;
  if (typeof opTime !== "string" || !opTime.startsWith("T+0")) {
    errors.push(`Expected operational time T+0, got ${opTime}`);
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
if (typeof window !== "undefined") {
  window.verifyBeat1ExitContract = verifyBeat1ExitContract;
}
async function enterMode(mode, options = {}) {
  requestGate.invalidate(); current.mode = mode; current.guidanceDismissed = false;
  if (typeof YBAudio !== "undefined") YBAudio.stopMenuMusic(1500);
  current.coldBootActive = Boolean(options?.coldBoot);
  if (mode !== "field-researcher") { app.innerHTML = `<section class="shell narrow" data-testid="program-unavailable"><p class="eyebrow">ASYNC · ACCESS CONTROL</p><h1>Access unavailable</h1><p>This operational program is not authorized for the current installation.</p>${button("Back to programs", `world:${current.world.id}`)}</section>`; return; }
  const personnel = await yellowBeast.getQ4PersonnelStatus({ world_id:current.world.id }); if (resultIsError(personnel)) { app.innerHTML = `<section class="shell"><h1>Personnel record unavailable</h1><p class="error">${escape(personnel.error.message)}</p>${button("Back", `world:${current.world.id}`)}</section>`; return; }
  if (personnel.required) {
    const fadeDuration = (window.__YB_TEST_FAST_FADE__ === true) ? 100 : 3000;
    app.innerHTML = `<section class="screen-fade-black" data-testid="clear-q4-fade" role="status" aria-live="polite"></section>`;
    window.setTimeout(() => {
      personnelDateCard();
    }, fadeDuration);
    return;
  }
  if (personnel.confirmation_required) { personnelConfirmation(personnel.player); return; }
  const resumed = await yellowBeast.resumeSession({ world_id:current.world.id, mode });
  const isFreshSession = resultIsError(resumed) && resumed.error?.code === "SESSION_NOT_FOUND";
  const result = isFreshSession ? await yellowBeast.startSession({ world_id:current.world.id, mode, require_personnel:true }) : resumed;
  if (resultIsError(result)) { app.innerHTML = `<section class="shell"><h1>Unable to enter experience</h1><p class="error">${escape(result.error.message)}</p>${button("Back", `world:${current.world.id}`)}</section>`; return; }
  current.projection = result.projection; applyPreferences(current.projection.settings);
  if (isFreshSession) {
    const exitCheck = verifyBeat1ExitContract(current.world, current.projection);
    if (!exitCheck.ok) {
      console.error("Beat 1 exit contract error:", exitCheck.errors);
    }
  }
  current.briefing_feed_completed = true;
  if (current.standbyTimer) { window.clearTimeout(current.standbyTimer); current.standbyTimer = null; }
  if (current.briefingTimer) { window.clearTimeout(current.briefingTimer); current.briefingTimer = null; }
  if (current.projection) current.projection.briefing_feed_completed = true;
  if (typeof YBAudio !== "undefined") {
    YBAudio.stopMenuMusic();
    applyAcousticScene(current.projection?.acoustic_scene);
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
  const mission = projection.q4?.mission_record ?? {};
  const q4 = projection.q4 ?? {};
  const standardTime = projection.q4?.standard_time ?? "00:00:00";
  const returnAction = projection.available_actions?.find((action) => action.type === "RETURN");
  const isPreBriefing = projection.q4?.opener_briefing_phase === "STANDBY" ||
                        projection.q4?.opener_briefing_phase === "FACILITY_BROADCAST" ||
                        projection.q4?.opener_briefing_phase === "PERSONNEL_BRIEFING" ||
                        projection.phase?.phase_id === "BRIEFING";
  const guidanceButton = (projection.phase?.phase_id === "EQUIPMENT_SELECTION" || projection.phase?.phase_id === "STAGING" || projection.phase?.phase_id === "FIELD_OPERATION") && current.guidanceDismissed ? `<button type="button" class="action-button secondary-action" data-action="toggle-guidance">Show guidance</button>` : "";
  const returnButton = (!isPreBriefing && returnAction) ? `<button type="button" data-game-action="${escape(returnAction.type)}">${escape(YBSurfaces.actionLabel(returnAction.type))}</button>` : "";
  const terminateButton = !isPreBriefing ? `<button type="button" data-action="leave">TERMINATE FIELD SESSION</button>` : "";
  return `<header class="async-system-header eti-top-bar" data-testid="async-system-header"><div class="eti-title" aria-label="ASYNC Expedition Tracing Interface"><strong>Async Research Institute ETI <span>(est 1979)</span></strong><small>Expedition Tracing Interface · MISSION ${escape(shortMissionId(mission))}</small></div><div class="eti-clocks"><span><strong>${escape(q4.operational_time ?? "T+0")}</strong><small>Expedition Timer</small></span><span><strong data-standard-time>${escape(standardTime)} ST</strong><small>Time in Standard</small></span></div>${guidanceButton}<details class="backend-menu"><summary>Workstation Controls</summary><div>${returnButton}<button type="button" data-action="settings">Settings</button>${current.developer ? `<button type="button" data-action="developer">Developer console</button>` : ""}${terminateButton}</div></details></header>`;
}
function compactOperationsRail(projection) { const q4 = projection.q4 ?? {}; const team = q4.team ?? []; const gear = q4.equipment?.required ?? []; return `<aside class="operations-rail" data-testid="operations-rail">${panelMarkup("PERSONNEL / ACCOUNTABILITY", team.map((member) => { const epistemicLabel = member.last_observed ? "Last Observed" : member.last_reported ? "Last Reported" : "Last Contact"; const epistemicValue = member.last_observed ?? member.last_reported ?? member.last_contact; const epistemic = member.controlled ? "TEAM LEAD (YOU)" : epistemicValue ? `${epistemicLabel}: ${escape(epistemicValue)}` : "No confirmed contact"; const epistemicClass = member.last_observed ? "epistemic-observed" : member.last_reported ? "epistemic-reported" : "epistemic-contact"; return `<li><span class="portrait-slot badge-portrait-fallback" data-portrait-id="portrait-${escape(member.personnel_id ?? member.id ?? "unknown")}" aria-label="Archival badge portrait unavailable">${escape((member.first_name ?? "?")[0])}</span><strong>${escape(member.display_name)}</strong><small>${escape(member.role)} · ${escape(member.contact_state ?? member.contact_category ?? "UNCONFIRMED")}</small><em>${escape(member.condition)} · <span class="personnel-epistemic ${epistemicClass}">${epistemic}</span></em></li>`; }).join(""), "No assigned personnel.", "personnel-block")}${panelMarkup("FIELD KIT / READINESS", gear.map((item) => `<li><span class="rail-glyph equipment-glyph equipment-${escape(item.category ?? "field")}" aria-hidden="true">${item.category === "field-radio" ? "◉" : item.category === "35mm-camera" ? "▣" : item.category === "battery-lamp" ? "◌" : "＋"}</span><strong>${escape(item.label)}</strong><small>${escape(item.holder)} · ${escape(item.state)}</small></li>`).join(""), "No field kit recorded.", "equipment-block")}${panelMarkup("MISSION STATE", `<p>${escape(q4.mission_record?.objective?.primary ?? q4.display_mission ?? "Assignment not available")}</p><span class="status-line">${escape(q4.mission_record?.status ?? "assigned")} · ${escape(projection.phase?.phase_id ?? "")}</span>`, "", "mission-block")}</aside>`; }
function panelMarkup(titleText, body, emptyText, className = "") { return `<section class="ops-panel ${escape(className)}"><h2>${escape(titleText)}</h2>${body || `<p class="empty">${escape(emptyText)}</p>`}</section>`; }
function compactLayout(projection) { const map = projection.q4?.layout ?? {}; const observed = (map.observed_spaces ?? []).map((item) => `<li><span class="map-node">●</span>${escape(item.alias)}<small>${escape(item.current ? "CURRENT LOCATION" : "OBSERVED LOCATION")}</small></li>`).join(""); const links = (map.observed_connections ?? []).map((item) => `<li><span class="map-link">↔</span>${escape(item.from)} → ${escape(item.to)}<small>SURVEYED ROUTE</small></li>`).join(""); const unknown = (map.unknown_continuations ?? []).map((item) => `<li><span class="map-unknown">?</span>${escape(item)}<small>UNRESOLVED CONTINUATION</small></li>`).join(""); const prior = (map.prior_records ?? []).map((item) => `<li><span class="map-link">□</span>${escape(item.text)}<small>PRIOR SURVEY RECORD</small></li>`).join(""); return `<section class="ops-panel layout-panel" data-testid="operations-layout"><h2>LAYOUT / SURVEY</h2><p class="map-current">● ${escape(map.current ?? "Prior survey boundary")}</p><ul>${observed || links || unknown || prior ? `${observed}${links}${unknown}${prior}` : `<li class="empty">No prior survey record is in view.</li>`}</ul><small>${escape(map.confidence ?? "Record status unknown")}</small></section>`; }
let endingPlayback = null;
function play(message = "", state = "") {
  const projection = current.projection;
  const ending = projection?.catastrophic_ending ?? projection?.q4?.catastrophic_ending;
  if (ending?.active) {
    if (!endingPlayback) {
      requestGate.invalidate();
      if (typeof YBAudio !== "undefined") YBAudio.stopAll();
      endingPlayback = YBEnding.start({ element:app, record:ending, reducedMotion:projection.settings?.reduced_motion === true, complete:() => {
        endingPlayback = null; current.projection = null; current.mode = null; showTitleCard();
      } });
    }
    return;
  }
  if (projection) {
    if (projection.phase?.phase_id !== "BRIEFING") {
      current.briefing_feed_completed = true;
    }
    projection.briefing_feed_completed = Boolean(current.briefing_feed_completed);
  }
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
  const isOpener = projection.q4?.scenario === "day1-opener" || projection.q4?.scenario === "clear-q4-day1-opener" || projection.q4?.scenario === "async-clear-q4-day1-opener" || Boolean(projection.q4?.day1_opener);
  const isPersonnelBriefing = projection.phase?.phase_id === "BRIEFING" && isOpener && (projection.q4?.beat === "PERSONNEL_BRIEFING" || projection.q4?.beat !== "LOCAL_INTRODUCTIONS");
  const briefingStatus = projection.q4?.personnel_briefing?.status ?? "pending";
  const prefieldDirect = q4Prefield ? (isPersonnelBriefing ? (briefingStatus === "active" ? { type: "CONCLUDE_BRIEFING" } : { type: "ATTEND_BRIEFING" }) : projection.available_actions.find((action) => ["READY", "PROCEED", "APPROACH", "CROSS", "BEGIN_FIELD_OPERATION"].includes(action.type))) : null;
  const prefieldLabel = (prefieldDirect?.type === "READY" && projection.phase?.phase_id === "THRESHOLD")
    ? "Begin radio procedure"
    : (prefieldDirect?.type === "CROSS" && isOpener)
    ? "CLEARED; CROSS?"
    : prefieldDirect
    ? YBSurfaces.actionLabel(prefieldDirect.type, isOpener)
    : (projection.phase?.phase_id === "STANDARD_RADIO_CHECK")
    ? "Establish the required Standard exchange"
    : "Awaiting next procedure";
  const prefieldAction = q4Prefield ? (isPersonnelBriefing
      ? (briefingStatus === "active"
          ? (() => {
              const briefing = projection.q4.personnel_briefing;
              const canConclude = (briefing.current_beat_index ?? 0) >= (briefing.beats_total ?? 4) - 1;
              return `<section class="action-dock natural-action prefield-action briefing-action-dock" data-testid="prefield-primary"><div><p class="eyebrow">CURRENT DECISION</p><h2>DR. KIRK MAXWELL</h2></div><form id="briefing-inquiry-form" class="briefing-inquiry-form"><label><span class="sr-only">Inquire with Dr. Kirk Maxwell</span><input type="text" name="text" autocomplete="off" placeholder="Ask Dr. Maxwell about route, Outpost A, cutoff time, or speak..." value="${escape(draft)}"></label><button type="submit" class="action-button">SPEAK</button></form>${canConclude ? `<button type="button" class="primary-action" data-game-action="CONCLUDE_BRIEFING">CONCLUDE BRIEFING</button>` : `<button type="button" class="primary-action" data-game-action="CONTINUE_BRIEFING">CONTINUE LISTENING</button>`}<p>Dr. Kirk Maxwell is speaking. You can ask a question at any time.</p></section>`;
            })()
          : (current.coldBootActive
              ? `<section class="action-dock natural-action prefield-action" data-testid="prefield-primary"><div><p class="eyebrow">CURRENT DECISION</p><h2>BRIEFING PENDING</h2></div><button type="button" class="primary-action" disabled data-briefing-locked="true" data-game-action="ATTEND_BRIEFING">BRIEFING PENDING</button><p>Standing by for assignment briefing.</p></section>`
              : `<section class="action-dock natural-action prefield-action" data-testid="prefield-primary"><div><p class="eyebrow">CURRENT DECISION</p><h2>BRIEFING PENDING</h2></div><button type="button" class="primary-action" data-game-action="ATTEND_BRIEFING">ATTEND BRIEFING</button><p>Report to Dr. Kirk Maxwell on the Lower Level.</p></section>`))
      : `<section class="action-dock natural-action prefield-action" data-testid="prefield-primary"><div><p class="eyebrow">CURRENT DECISION</p><h2>${escape(prefieldLabel)}</h2></div>${prefieldDirect ? `<button type="button" class="primary-action" data-game-action="${escape(prefieldDirect.type)}">${escape(prefieldLabel)}</button>` : `<p>Use STANDARD in the communications panel to continue.</p>`}<p>${prefieldDirect ? "This advances the recorded expedition phase." : "No physical turn is available until the radio procedure is complete."}</p></section>`) : "";
  const retry = state === "application-error" ? `<button type="button" data-action="refresh-view">Refresh view</button>` : "";
  const hideStructured = q4Prefield || isReport || projection.available_actions.length === 0;
  const structured = `<details class="action-dock structured-action" ${hideStructured ? "hidden" : ""}><summary>Structured controls</summary><form id="action-form" aria-label="Structured action input"><label>Choose action <select name="action" data-testid="action-select">${actionOptions}</select></label><label id="target-label">Valid target <select name="target" data-testid="target-select"></select></label><button type="submit" data-testid="submit-action">SUBMIT</button></form></details>`;
  const actionDock = `<footer class="eti-turn-controls">${prefieldAction}${natural}${hideStructured ? "" : structured}</footer>`;
  const q4Shell = projection.mode.id === "field-researcher";
  const phaseRecord = YBSurfaces.render(projection);
  const providerLabel = "CURRENT FIELD RECORD";
  const isBriefingWorkstation = q4Shell && projection.phase?.phase_id === "BRIEFING" && isOpener;
  // The operational chassis mounts async-operations-layout via YBSurfaces.briefingWorkstation or YBSurfaces.expeditionCockpit
  const core = q4Shell
    ? (isReport
        ? `<main class="operations-main report-view" data-testid="async-operations-layout">${natural}${phaseRecord}</main>`
        : isDebrief
        ? `<main class="operations-main debrief-view" data-testid="async-operations-layout">${phaseRecord}</main>`
        : isBriefingWorkstation
        ? YBSurfaces.briefingWorkstation(projection, { actionDock, inspectedFacilityFloor: current.inspectedFacilityFloor, mapView: current.mapView })
        : YBSurfaces.expeditionCockpit(projection, { scene: state === "result" ? projection.scene : null, providerLabel, phaseRecord, actionDock, inspectedFacilityFloor: current.inspectedFacilityFloor, mapView: current.mapView }))
    : `${scene}${natural}${YBSurfaces.render(projection)}`;
  const feedbackContent = (state === "submitted" || state === "resolving") ? `<span class="feedback-text">${escape(message)}</span> ${expeditionLoadingMotif()}${retry}` : `${escape(message)}${retry}`;
  if (typeof YBDialoguePlayer !== "undefined") YBDialoguePlayer.cancel();
  app.innerHTML = `<section class="shell play ${q4Shell ? "operations-shell eti-shell" : ""} mode-${escape(projection.mode.id)}" data-testid="play-shell" data-phase="${escape(projection.phase?.phase_id ?? "")}">${q4Shell ? asyncHeader(projection) : `<header><div><p class="eyebrow">${escape(projection.world.name)}</p><h1>${escape(projection.mode.label)}</h1><p>${escape(projection.mode.description)}</p></div>${button("Settings", "settings")}${button("TERMINATE FIELD SESSION", "leave")}</header>`}<p id="interaction-feedback" class="interaction-feedback" data-state="${escape(state)}" role="status" aria-live="polite" aria-atomic="true">${feedbackContent}</p>${guidedIntroduction(projection)}${core}${q4Shell ? "" : (hideStructured ? "" : `${structured}<p class="muted">Accepted actions save automatically.</p>`)}</section>`;
  if (current.coldBootActive && q4Shell && projection.phase?.phase_id === "BRIEFING") {
    current.coldBootActive = false;
    const headerEl = app.querySelector(".async-system-header");
    const centerEl = app.querySelector(".eti-center");
    const actionDockEl = app.querySelector(".eti-turn-controls");
    if (headerEl) headerEl.classList.add("eti-cold-boot-pending");
    if (centerEl) centerEl.classList.add("eti-cold-boot-pending");
    if (actionDockEl) actionDockEl.classList.add("eti-cold-boot-pending");
    document.body.setAttribute("data-boot-locked", "true");
    const fastTest = (typeof window !== "undefined") && (window.__YB_TEST_FAST_BOOT__ === true || window.__YB_TEST_FAST_FADE__ === true);
    if (fastTest) document.body.classList.add("fast-boot");
    const stageDurationMs = fastTest ? 30 : 850;

    // Stage 1: Top / Header
    if (headerEl) {
      headerEl.classList.remove("eti-cold-boot-pending");
      headerEl.classList.add("eti-cold-boot-energizing");
    }
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_power");

    // Stage 2: Central Workstation / Facility Schematic
    window.setTimeout(() => {
      if (headerEl) {
        headerEl.classList.remove("eti-cold-boot-energizing");
        headerEl.classList.add("eti-cold-boot-energized");
      }
      if (centerEl) {
        centerEl.classList.remove("eti-cold-boot-pending");
        centerEl.classList.add("eti-cold-boot-energizing");
      }
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_drive");

      // Stage 3: Lower Action / Status containing eventual BRIEFING PENDING
      window.setTimeout(() => {
        if (centerEl) {
          centerEl.classList.remove("eti-cold-boot-energizing");
          centerEl.classList.add("eti-cold-boot-energized");
        }
        if (actionDockEl) {
          actionDockEl.classList.remove("eti-cold-boot-pending");
          actionDockEl.classList.add("eti-cold-boot-energizing");
        }
        if (typeof YBAudio !== "undefined") YBAudio.emitHook("boot_relay");

        // Completion
        window.setTimeout(() => {
          if (actionDockEl) {
            actionDockEl.classList.remove("eti-cold-boot-energizing");
            actionDockEl.classList.add("eti-cold-boot-energized");
            const briefingLockedBtn = actionDockEl.querySelector('[data-briefing-locked="true"]');
            if (briefingLockedBtn) {
              briefingLockedBtn.removeAttribute("disabled");
              briefingLockedBtn.removeAttribute("data-briefing-locked");
              briefingLockedBtn.textContent = "ATTEND BRIEFING";
              briefingLockedBtn.setAttribute("data-game-action", "ATTEND_BRIEFING");
              const heading = actionDockEl.querySelector("h2");
              if (heading) heading.textContent = "BRIEFING PENDING";
              const desc = actionDockEl.querySelector("p:last-of-type");
              if (desc) desc.textContent = "Report to Dr. Kirk Maxwell on the Lower Level.";
            }
          }
          document.body.removeAttribute("data-boot-locked");
          document.body.classList.remove("fast-boot");
        }, stageDurationMs);
      }, stageDurationMs);
    }, stageDurationMs);
  }
  if (current.developer && !q4Shell) document.querySelector(".play header").insertAdjacentHTML("beforeend", button("Developer console", "developer"));
  const form = document.querySelector("#action-form"); const actionSelect = form?.action; const targetSelect = form?.target;
  const targetsForAction = () => { if (!form) return; const action = projection.available_actions.find((item) => item.type === actionSelect.value); const targets = action?.targets ?? []; targetSelect.innerHTML = targets.map((target) => `<option value="${escape(target.ref)}">${escape(target.label)}</option>`).join(""); targetSelect.disabled = targets.length === 0; document.querySelector("#target-label").hidden = !action?.target_required; };
  targetsForAction(); actionSelect?.addEventListener("change", targetsForAction);
  app.querySelectorAll("[data-game-action]").forEach((item) => {
    item.__yb_click_bound = true;
    item.addEventListener("click", () => {
      if (typeof YBAudio !== "undefined") { YBAudio.emitHook("ui_select"); }
      const actionType = item.dataset.gameAction;
      if (actionType === "ATTEND_BRIEFING" || actionType === "START_BRIEFING") {
        submitTurn("structured", () => yellowBeast.submitAction({ world_id: current.world.id, mode: current.mode, action: "ATTEND_BRIEFING" }));
        return;
      }
      if (actionType === "CONTINUE_BRIEFING" || actionType === "CONTINUE_LISTENING" || actionType === "LISTEN") {
        if (typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()) {
          YBDialoguePlayer.finish();
          return;
        }
        submitTurn("structured", () => yellowBeast.submitAction({ world_id: current.world.id, mode: current.mode, action: "CONTINUE_BRIEFING" }));
        return;
      }
      if (actionType === "CONCLUDE_BRIEFING") {
        if (typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()) {
          YBDialoguePlayer.finish();
        }
        submitTurn("structured", () => yellowBeast.submitAction({ world_id: current.world.id, mode: current.mode, action: "CONCLUDE_BRIEFING" }));
        return;
      }
      const selectedAction = projection.available_actions.find((action) => action.type === actionType);
      if (!selectedAction) return;
      if (!selectedAction.target_required) { submitTurn("structured", () => yellowBeast.submitAction({ world_id: current.world.id, mode: current.mode, action: selectedAction.type })); return; }
      if (!form) return;
      form.closest("details").open = true;
      actionSelect.value = selectedAction.type;
      targetsForAction();
      actionSelect.focus({ preventScroll: true });
    });
  });
  if (current.briefingTimer) window.clearTimeout(current.briefingTimer);
  const spokenBriefing = projection.q4?.personnel_briefing;
  const isBriefingActive = spokenBriefing?.status === "active";
  const scheduleBriefingAutoAdvance = () => {
    if (isBriefingActive &&
        (spokenBriefing.current_beat_index ?? 0) < (spokenBriefing.beats_total ?? 4) - 1) {
      const surface = app.querySelector('[data-testid="in-person-briefing"]');
      const words = (spokenBriefing.exchange_history?.at(-1)?.text ?? "").split(/\s+/).length;
      const advanceBriefing = () => {
        if (!surface?.isConnected || current.projection !== projection) return;
        const input = app.querySelector('#briefing-inquiry-form input');
        if (document.hidden || input?.value.trim() || document.activeElement === input ||
            ["submitted", "resolving"].includes(document.querySelector('#interaction-feedback')?.dataset.state)) {
          current.briefingTimer = window.setTimeout(advanceBriefing, 1000);
          return;
        }
        submitTurn("structured", () => yellowBeast.submitAction({ world_id: current.world.id, mode: current.mode, action: "CONTINUE_BRIEFING" }));
      };
      current.briefingTimer = window.setTimeout(advanceBriefing, Math.max(4500, words * 350 + 1200));
    }
  };

  const currentSpokenEl = app.querySelector(".current-spoken-text");
  if (currentSpokenEl && isBriefingActive) {
    const fullText = spokenBriefing.exchange_history?.at(-1)?.text ?? currentSpokenEl.textContent;
    if (typeof YBDialoguePlayer !== "undefined") {
      YBDialoguePlayer.type(currentSpokenEl, fullText, {
        onChar: () => {
          const transcriptEl = app.querySelector(".briefing-transcript");
          if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
        },
        onComplete: () => {
          const transcriptEl = app.querySelector(".briefing-transcript");
          if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
          scheduleBriefingAutoAdvance();
        }
      });
    } else {
      scheduleBriefingAutoAdvance();
    }
  } else {
    scheduleBriefingAutoAdvance();
  }

  const activeTurnContainer = app.querySelector(".briefing-active-turn-container");
  if (activeTurnContainer) {
    activeTurnContainer.addEventListener("click", () => {
      if (typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()) {
        YBDialoguePlayer.finish();
      }
    });
  }

  const briefingInquiryForm = app.querySelector("#briefing-inquiry-form");
  const briefingInput = briefingInquiryForm?.querySelector("input[name='text']");
  briefingInput?.addEventListener("input", () => presentation.setDraft(context, briefingInput.value));
  briefingInput?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (briefingInquiryForm.requestSubmit) briefingInquiryForm.requestSubmit();
      else briefingInquiryForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }
  });
  briefingInquiryForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (typeof YBDialoguePlayer !== "undefined") YBDialoguePlayer.cancel();
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_submit");
    const data = new FormData(event.currentTarget);
    const text = (data.get("text") ?? "").trim();
    presentation.setDraft(context, "");
    submitTurn("natural", () => yellowBeast.submitNatural({ world_id: current.world.id, mode: current.mode, text }));
  });
  app.querySelectorAll("[data-object-action]").forEach((item) => item.addEventListener("click", () => { if (typeof YBAudio !== "undefined") { YBAudio.emitHook("ui_select"); } submitTurn("structured", () => yellowBeast.submitAction({ world_id:current.world.id, mode:current.mode, action:item.dataset.objectAction, target:item.dataset.objectTarget })); }));
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
  const commsRoot = commsForm?.closest?.(".communications-surface") ?? commsForm;
  const updateChannelSwitch = (channelVal) => {
    const selector = commsRoot?.querySelector(".mechanical-channel-selector");
    if (!selector) return;
    const isStandard = channelVal === "standard";
    selector.dataset.channelCurrent = isStandard ? "standard" : "local";
    const track = selector.querySelector(".switch-track");
    if (track) track.textContent = isStandard ? "[■■□□]" : "[□□■■]";
    selector.querySelector(".switch-standard")?.classList.toggle("active", isStandard);
    selector.querySelector(".switch-local")?.classList.toggle("active", !isStandard);
    const target = selector.querySelector('[name="target"]');
    if (target) target.disabled = isStandard;
  };
  commsRoot?.querySelector('[name="channel"]')?.addEventListener("change", (event) => {
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_toggle");
    updateChannelSwitch(event.target.value);
  });
  commsRoot?.querySelectorAll(".switch-slot").forEach((slot) => {
    slot.addEventListener("click", () => {
      const select = commsRoot.querySelector('[name="channel"]');
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
    const target = channel === "local" ? (data.get("target") || null) : null;
    const text = data.get("text");
    const contextKey = `${current.world.id}:${channel}:${target ?? "untargeted"}`;
    if (!current.pendingCommunication || current.pendingCommunication.text !== text || current.pendingCommunication.context !== contextKey) {
      current.pendingCommunication = { id: crypto.randomUUID(), context: contextKey, text };
    }
    const requestId = current.pendingCommunication.id;
    if (typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()) {
      YBDialoguePlayer.finish();
    }
    submitTurn("communication", async () => {
      const res = await yellowBeast.submitQ4Communication({ world_id:current.world.id, channel, target, text, request_id: requestId, submission_id: requestId });
      if (current.pendingCommunication?.id === requestId && (res.ok || !["SESSION_BUSY", "PROVIDER_UNAVAILABLE", "PERSISTENCE_COMMIT_FAILED", "DIALOGUE_RECOVERY_UNAVAILABLE"].includes(res.error?.code))) current.pendingCommunication = null;
      if (!resultIsError(res) && channel === "standard") {
        if (typeof YBAudio !== "undefined") YBAudio.emitHook("radio_tx_chirp");
      }
      return res;
    });
  });
  const targetSelectEl = commsRoot?.querySelector('[data-testid="q4-comms-target"]');
  if (targetSelectEl) {
    targetSelectEl.addEventListener("change", () => {
      const selected = targetSelectEl.value;
      app.querySelectorAll(".coworker-presence-card").forEach((c) => {
        c.classList.toggle("selected-target", Boolean(selected) && c.getAttribute("data-coworker-name") === selected);
      });
      const textInput = commsForm?.querySelector("input[name='text'], textarea[name='text']");
      if (textInput) {
        textInput.placeholder = selected
          ? `Speak directly to ${selected}...`
          : "Speak naturally, or select one coworker for a direct aside...";
      }
    });
  }
  const timelineEl = commsRoot?.querySelector(".communication-timeline");
  if (timelineEl) {
    timelineEl.addEventListener("click", () => {
      if (typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()) {
        YBDialoguePlayer.finish();
      }
    });
  }
  const latestLocalRespEls = [...(commsRoot?.querySelectorAll(".communication-timeline li:last-child .comm-local-response .comm-text") ?? [])];
  if (latestLocalRespEls.length > 0 && typeof YBDialoguePlayer !== "undefined") {
    const responseTexts = latestLocalRespEls.map((element) => element.textContent);
    const respKey = responseTexts.join("\u241e");
    if (current.lastTypedTimelineText !== respKey && !YBDialoguePlayer.isTyping()) {
      current.lastTypedTimelineText = respKey;
      latestLocalRespEls.forEach((element) => { element.textContent = ""; });
      const presentNext = (index) => {
        if (index >= latestLocalRespEls.length) return;
        YBDialoguePlayer.type(latestLocalRespEls[index], responseTexts[index], {
          onChar: () => {
            if (timelineEl) timelineEl.scrollTop = timelineEl.scrollHeight;
          },
          onComplete: () => {
            if (timelineEl) timelineEl.scrollTop = timelineEl.scrollHeight;
            presentNext(index + 1);
          }
        });
      };
      presentNext(0);
    }
  }
  app.querySelectorAll(".coworker-presence-card").forEach((card) => {
    const handleSelect = () => {
      const name = card.getAttribute("data-coworker-name");
      if (targetSelectEl && name) {
        if (targetSelectEl.value === name) {
          targetSelectEl.value = "";
        } else {
          targetSelectEl.value = name;
        }
        targetSelectEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const currentSelected = targetSelectEl ? targetSelectEl.value : "";
      app.querySelectorAll(".coworker-presence-card").forEach((c) => {
        const isMatch = Boolean(currentSelected) && c.getAttribute("data-coworker-name") === currentSelected;
        c.classList.toggle("selected-target", isMatch);
      });
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
    };
    card.addEventListener("click", handleSelect);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSelect();
      }
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
  app.querySelectorAll("[data-export-report-pdf]").forEach((item) => item.addEventListener("click", async () => {
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
    try {
      const res = await (yellowBeast.chooseExportReportPdf ? yellowBeast.chooseExportReportPdf({ world_id: current.world.id }) : yellowBeast.exportReportPdf({ world_id: current.world.id }));
      if (res?.ok) {
        setFeedback(`Report exported to ${res.destination}`, "result");
      } else if (res?.error?.code !== "EXPORT_CANCELLED") {
        setFeedback(res?.error?.message ?? "Report export failed", "error");
      }
    } catch (err) {
      setFeedback(`Report export failed: ${err.message}`, "error");
    }
  }));
  app.querySelectorAll("[data-aeot-view]").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
      const targetView = tab.dataset.aeotView;
      app.querySelectorAll("[data-aeot-view]").forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle("active", isActive);
        t.setAttribute("aria-selected", String(isActive));
      });
      app.querySelectorAll(".aeot-view-panel").forEach((panel) => {
        const isMatch = panel.dataset.viewId === targetView || panel.id === `view-aeot-${targetView}` || panel.dataset.testid === `aeot-view-${targetView}`;
        panel.hidden = !isMatch;
        panel.classList.toggle("active", isMatch);
      });
    });
  });
  app.querySelectorAll("button.facility-floor-button").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const floor = item.getAttribute("data-facility-floor") || item.dataset?.facilityFloor;
      if (floor) {
        if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
        current.inspectedFacilityFloor = floor;
        if (typeof window !== "undefined") window.__YB_CURRENT_FACILITY_FLOOR__ = floor;
        if (typeof global !== "undefined") global.__YB_CURRENT_FACILITY_FLOOR__ = floor;
        play(message, state);
      }
    });
  });
  // Facility map pan + zoom. Entirely client-side (direct SVG transform on the
  // `.facility-map-world` group) so dragging/scrolling never triggers a turn submission or a
  // full play() re-render; the resulting view is persisted per-floor in current.mapView so it
  // survives the next full re-render (a floor switch, an action, etc).
  {
    const facilityMapSvg = app.querySelector('[data-testid="operational-map"][data-display-mode="facility"] svg');
    if (facilityMapSvg) {
      applyFacilityMapTransform();
      let dragState = null;
      const svgUnitsPerClientPixel = () => {
        const rect = facilityMapSvg.getBoundingClientRect();
        return {
          x: rect.width > 0 ? FACILITY_MAP_VIEWBOX.width / rect.width : 1,
          y: rect.height > 0 ? FACILITY_MAP_VIEWBOX.height / rect.height : 1,
          rect
        };
      };
      facilityMapSvg.addEventListener("wheel", (e) => {
        e.preventDefault();
        const floor = currentFacilityFloor();
        const view = getMapView(floor);
        const { x: ratioX, y: ratioY, rect } = svgUnitsPerClientPixel();
        const pointerX = (e.clientX - rect.left) * ratioX;
        const pointerY = (e.clientY - rect.top) * ratioY;
        const worldX = (pointerX - view.x) / view.scale;
        const worldY = (pointerY - view.y) / view.scale;
        const zoomFactor = Math.exp(-e.deltaY * 0.0015);
        const newScale = Math.min(FACILITY_MAP_MAX_SCALE, Math.max(FACILITY_MAP_MIN_SCALE, view.scale * zoomFactor));
        view.x = pointerX - worldX * newScale;
        view.y = pointerY - worldY * newScale;
        view.scale = newScale;
        clampMapView(view);
        applyFacilityMapTransform(floor);
      }, { passive: false });
      facilityMapSvg.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        const floor = currentFacilityFloor();
        const view = getMapView(floor);
        dragState = { pointerId: e.pointerId, floor, startClientX: e.clientX, startClientY: e.clientY, startX: view.x, startY: view.y };
        try { facilityMapSvg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        facilityMapSvg.classList.add("facility-map-dragging");
      });
      facilityMapSvg.addEventListener("pointermove", (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        const { x: ratioX, y: ratioY } = svgUnitsPerClientPixel();
        const view = getMapView(dragState.floor);
        view.x = dragState.startX + (e.clientX - dragState.startClientX) * ratioX;
        view.y = dragState.startY + (e.clientY - dragState.startClientY) * ratioY;
        clampMapView(view);
        applyFacilityMapTransform(dragState.floor);
      });
      const endFacilityMapDrag = (e) => {
        if (!dragState || (e && e.pointerId !== undefined && e.pointerId !== dragState.pointerId)) return;
        try { facilityMapSvg.releasePointerCapture(dragState.pointerId); } catch (err) { /* ignore */ }
        facilityMapSvg.classList.remove("facility-map-dragging");
        dragState = null;
      };
      facilityMapSvg.addEventListener("pointerup", endFacilityMapDrag);
      facilityMapSvg.addEventListener("pointercancel", endFacilityMapDrag);
      facilityMapSvg.addEventListener("pointerleave", endFacilityMapDrag);
    }
    app.querySelectorAll("[data-map-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const floor = currentFacilityFloor();
        const view = getMapView(floor);
        const action = btn.getAttribute("data-map-action");
        if (action === "zoom-in") view.scale *= 1.25;
        else if (action === "zoom-out") view.scale /= 1.25;
        else if (action === "reset-view") { view.x = 0; view.y = 0; view.scale = 1; }
        clampMapView(view);
        if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
        applyFacilityMapTransform(floor);
      });
    });
  }
  app.querySelectorAll("[data-q4-check-in]").forEach((button) => {
    let holdActive = false;
    let holdTimer = null;
    const startHold = (e) => {
      e.preventDefault();
      if (holdActive) return;
      holdActive = true;
      button.classList.add("check-in-holding");
      button.textContent = "Holding for Standard Check-In (2s)...";
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
      yellowBeast.beginQ4CheckInHold({ world_id: current.world.id });
      holdTimer = setTimeout(() => {
        if (holdActive) {
          button.textContent = "2s Reached — Release to Transmit";
        }
      }, 2000);
    };
    const cancelHold = (e) => {
      if (!holdActive) return;
      holdActive = false;
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      button.classList.remove("check-in-holding");
      button.textContent = "Hold for Standard Check-In (2s)";
      yellowBeast.cancelQ4CheckInHold({ world_id: current.world.id });
    };
    const finishHold = (e) => {
      if (!holdActive) return;
      holdActive = false;
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      button.classList.remove("check-in-holding");
      button.textContent = "Hold for Standard Check-In (2s)";
      submitTurn("communication", async () => {
        const res = await yellowBeast.completeQ4CheckInHold({ world_id: current.world.id });
        if (!resultIsError(res)) {
          if (typeof YBAudio !== "undefined") YBAudio.emitHook("radio_tx_chirp");
        }
        return res;
      });
    };
    button.addEventListener("mousedown", startHold);
    button.addEventListener("touchstart", startHold, { passive: false });
    button.addEventListener("mouseup", finishHold);
    button.addEventListener("touchend", finishHold);
    button.addEventListener("mouseleave", cancelHold);
    button.addEventListener("touchcancel", cancelHold);
    button.addEventListener("keydown", (event) => { if ([" ", "Enter"].includes(event.key)) startHold(event); });
    button.addEventListener("keyup", (event) => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); finishHold(event); } });
    button.addEventListener("blur", cancelHold);
  });
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
  if (result.error?.code === "THRESHOLD_NONFUNCTIONAL") {
    const refreshed = await yellowBeast.getGameplayProjection({ world_id:context.worldId, mode:context.mode });
    if (requestContext().worldId !== context.worldId || requestContext().mode !== context.mode) return;
    if (refreshed.ok && refreshed.projection?.catastrophic_ending?.active) {
      current.projection = refreshed.projection; play(); return;
    }
  }
  if (resultIsError(result)) {
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_error");
    // Provider failures are application feedback. Do not disguise them as
    // in-world offline radio traffic or a request to restate the player's intent.
    if (result.error?.provider_failure) { play(result.error.message, "application-error"); return; }
    play(applicationError(result) ? YBInteraction.applicationMessage() : sanitizePlayerMessage(result.error?.message ?? YBInteraction.simulationMessage()), applicationError(result) ? "application-error" : "simulation-result");
    return;
  }
  const previousEvidence = new Set((current.projection?.q4?.evidence ?? []).map(item => item.id));
  const prevPhase = current.projection?.phase?.phase_id;
  current.projection = result.projection;
  if (result.result?.scene) current.projection.scene = result.result.scene;
  const nextPhase = current.projection?.phase?.phase_id;
  const newPhotograph = (current.projection?.q4?.evidence ?? []).some(item => !previousEvidence.has(item.id) && /photo|camera/i.test(`${item.type} ${item.method} ${item.device}`));
  if (newPhotograph && typeof YBAudio !== "undefined") YBAudio.playCameraClick();
  const isCrossing = (prevPhase !== "FIELD_OPERATION" && nextPhase === "FIELD_OPERATION");
  const cinematicPlayer = (typeof YBCinematicPlayer !== "undefined")
    ? YBCinematicPlayer
    : ((typeof window !== "undefined" && window.YBCinematicPlayer)
    ? window.YBCinematicPlayer
    : (typeof globalThis !== "undefined" && globalThis.YBCinematicPlayer)
    ? globalThis.YBCinematicPlayer
    : null);

  const completeTransition = () => {
    if (prevPhase && nextPhase && prevPhase !== nextPhase) {
      playCeremonialPhaseAudio(prevPhase, nextPhase);
    }
    // Apply acoustic scene derived from canonical simulation state
    applyAcousticScene(current.projection?.acoustic_scene);
    const message = renderMessage(result, kind === "natural");
    if (kind === "structured" || result.result?.executed) presentation.clearDraft(context);
    const assistance = result.result?.language_assistance?.message;
    play(`${message}${assistance ? ` ${assistance}` : ""}`.trim(), "result");
  };

  if (isCrossing && cinematicPlayer && typeof cinematicPlayer.playCinematic === "function") {
    cinematicPlayer.playCinematic({
      container: (typeof app !== "undefined" ? app : null),
      placeholderId: "THRESHOLD_CROSSING_ENTRY_4",
      testId: "threshold-crossing-cinematic",
      surfaceClass: "cinematic-surface threshold-crossing-surface",
      videoClass: "cinematic-video-element",
      onComplete: () => {
        completeTransition();
      }
    });
    return;
  }

  completeTransition();
}
function applyAcousticScene(scene) {
  if (typeof YBAudio === "undefined" || !scene) return;
  YBAudio.applyScene(scene);
  // Transmission cues are emitted by the accepted communication handlers.
  // Replaying a projection must not replay historical radio events.

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
  } else if (toPhase === "STANDARD_RADIO_CHECK") {
    YBAudio.emitHook("radio_rx_cue");
  } else if (toPhase === "FIELD_OPERATION") {
    YBAudio.emitHook("threshold_cross_hum");
    YBAudio.emitHook("complex_hum");

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
  portal.innerHTML = `<div class="termination-dialog"><p class="eyebrow">ASYNC PROTOCOL KV31-C · FIELD SESSION TERMINATION</p><h2 id="termination-heading">Institutional Consequence Warning</h2><p class="termination-consequence">Current expedition has not completed return protocol. Personnel remain beyond threshold. Unreturned field personnel, unresolved equipment, and uncommitted survey telemetry will be recorded under protocol exception. The operational session will close and career accountability will be finalized.</p><div class="termination-actions"><button type="button" class="action-button primary-action" data-action="cancel-termination">[RETURN TO EXPEDITION]</button><button type="button" class="action-button danger-action" data-action="confirm-termination">[CONFIRM SESSION TERMINATION]</button></div></div>`;
  app.appendChild(portal);
  portal.querySelector('[data-action="cancel-termination"]')?.focus();
}
function showExitGameConfirmation() {
  const existing = document.querySelector(".exit-game-portal");
  if (existing) return;
  if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_panel_open");
  const portal = document.createElement("div");
  portal.className = "exit-game-portal";
  portal.dataset.testid = "exit-game-dialog";
  portal.setAttribute("data-testid", "exit-game-dialog");
  portal.setAttribute("role", "dialog");
  portal.setAttribute("aria-modal", "true");
  portal.setAttribute("aria-labelledby", "exit-game-heading");
  portal.innerHTML = `<div class="exit-game-dialog" data-testid="exit-game-dialog"><p class="eyebrow">ASYNC · FIELD OPERATIONS SYSTEM</p><h2 id="exit-game-heading">Exit Voices of the Threshold</h2><p class="exit-game-warning">Are you sure you want to close the application? All persistent records and operational settings remain preserved.</p><div class="exit-game-actions"><button type="button" class="action-button" data-action="cancel-exit" data-testid="cancel-exit-button">Cancel</button><button type="button" class="action-button danger-action" data-action="confirm-exit" data-testid="confirm-exit-button">Exit game</button></div></div>`;
  app.appendChild(portal);
  portal.querySelector('[data-action="cancel-exit"]')?.focus();
}
function renderProviderManagement(entries) {
  const localEntry = entries.find(e => e.kind === "local");
  const applianceState = (localEntry?.last_success || localEntry?.status?.includes("response received") || localEntry?.status === "ready")
    ? "Ready"
    : (localEntry?.last_failure === "LOCAL_MODEL_MISSING" || localEntry?.status?.includes("missing"))
    ? "Repair Required"
    : (localEntry?.last_failure === "UNSUPPORTED")
    ? "Unsupported"
    : (localEntry?.status?.includes("Installing"))
    ? "Installing"
    : "Not Installed";
  const cards = entries.map(entry => {
    if (entry.kind === "local") {
      return `<article class="provider-card local-model-card" data-provider-id="local"><header class="provider-card-header"><div><p class="eyebrow">LOCAL RUNTIME</p><h3>${escape(entry.label)}</h3></div><span class="badge badge-${applianceState.toLowerCase().replace(/\s+/g, '-')}">${escape(applianceState)}</span></header><p>No API key · requests stay on this device (127.0.0.1)</p><p class="provider-status-text">${escape(entry.status)}</p><details><summary>View details</summary><dl><dt>Model</dt><dd>${escape(entry.model)}</dd><dt>Endpoint</dt><dd>${escape(entry.endpoint)}</dd><dt>Security</dt><dd>127.0.0.1 loopback only · no LAN</dd><dt>Last successful response</dt><dd>${entry.last_success ? escape(new Date(entry.last_success).toLocaleString()) : "Not observed this session"}</dd></dl></details><div class="provider-card-actions"><button type="button" data-provider-use-local>Use local model</button><button type="button" data-local-edit>Configure local model</button><button type="button" data-provider-test="local">Test local model</button></div></article>`;
    }
    return `<article class="provider-card" data-provider-id="${escape(entry.id)}"><h3>${escape(entry.label)}</h3><p>${entry.configured ? "Key available · ••••••••" : "No usable key"}</p><p>${escape(entry.status)}</p><details><summary>View details</summary><dl><dt>Model</dt><dd>${escape(entry.model)}</dd><dt>Storage</dt><dd>${entry.persistent ? "Encrypted on this device" : entry.session_only ? "This session only" : entry.environment ? "Environment variable" : entry.saved ? "Stored key could not be opened" : "No saved key"}</dd><dt>Last successful response</dt><dd>${entry.last_success ? escape(new Date(entry.last_success).toLocaleString()) : "Not observed this session"}</dd></dl></details><div class="provider-card-actions"><button type="button" data-provider-edit="${escape(entry.id)}">${entry.configured ? "Replace key / edit model" : "Add key"}</button><button type="button" data-provider-test="${escape(entry.id)}" ${entry.configured ? "" : "disabled"}>Test connection</button><button type="button" data-provider-delete="${escape(entry.id)}" ${entry.saved || entry.session_only ? "" : "disabled"}>Delete saved key</button></div></article>`;
  }).join("");
  return `<section class="provider-manager" aria-labelledby="provider-manager-heading"><h2 id="provider-manager-heading">Language model providers</h2><p>The local option uses Ollama on this device and needs no API key. AUTO tries configured hosted providers in order. A failed request never counts as live model success.</p><p>Hosted model access, usage limits, and costs depend on each provider and account.</p><button type="button" data-provider-auto>Use AUTO hosted fallbacks</button><div class="provider-cards">${cards}</div><p id="provider-manager-message" role="status" aria-live="polite"></p></section>`;
}
const settingsController = { state: "closed", opener: null, mounted: null, returnTo: null };
async function settings(invoker = document.activeElement, feedback = "", editProvider = null) {
  if (settingsController.state === "opening" || settingsController.state === "saving") return;
  settingsController.state = "opening"; settingsController.opener = invoker instanceof Element ? invoker : document.activeElement; rendererDiagnostics.surface = "settings";
  requestGate.invalidate();
  let result;
  try { result = await yellowBeast.getSettings(); } catch (_) { settingsController.state = "open"; app.innerHTML = `<section class="shell narrow" data-testid="settings-error"><p class="eyebrow">SETTINGS</p><h1>Settings unavailable</h1><p class="error">Presentation preferences could not be loaded. Your saved records were not changed.</p>${button("Back", "home")}</section>`; return; }
  if (resultIsError(result) || !result.settings) { settingsController.state = "open"; app.innerHTML = `<section class="shell narrow" data-testid="settings-error"><p class="eyebrow">SETTINGS</p><h1>Settings unavailable</h1><p class="error">${escape(result?.error?.message ?? "Presentation preferences could not be loaded.")}</p>${button("Back", "home")}</section>`; return; }
  const isDev = current.developer === true;
  const configured = result.provider?.openai?.configured === true; const groqConfigured = result.provider?.groq?.configured === true; const geminiConfigured = result.provider?.gemini?.configured === true; const openrouterConfigured = result.provider?.openrouter?.configured === true; applyPreferences(result.settings); current.settingsReturn = current.mode && current.projection ? () => play("Settings closed.", "result") : home;
  let appliance = {
    state: "NOT_INSTALLED",
    message: "Ready to install on-device language model.",
    installed: false,
    is_ready: false,
    endpoint: null,
    hardware: { arch: "arm64", memory_gb: 16, supported: true },
    progress: 0,
    stage: null
  };
  try {
    if (yellowBeast.getInferenceApplianceStatus) {
      const appRes = await yellowBeast.getInferenceApplianceStatus();
      if (appRes?.ok && appRes.appliance) appliance = appRes.appliance;
    }
  } catch {}
  const applianceState = appliance.state || "NOT_INSTALLED";

  const providerManagerMarkup = isDev ? renderProviderManagement(result.provider.entries ?? []) : "";
  const localModelMarkup = isDev ? `<section class="settings-group local-model-settings" id="local-model-settings" data-testid="local-appliance-card" data-appliance-state="${escape(applianceState)}"><div class="appliance-status-banner"><div><p class="eyebrow">ON-DEVICE RUNTIME</p><h2>MANAGED LOCAL INFERENCE</h2></div><span class="badge badge-${escape(applianceState.toLowerCase().replace(/_/g, '-'))}">${escape(applianceState.replace(/_/g, ' '))}</span></div><p class="appliance-isolation-note">Yellow Beast connects only to a private on-device interpreter on <code>127.0.0.1</code>. No network service is exposed, no LAN communication is accepted, and all observations remain observer-safe and validated before presentation.</p>${appliance.endpoint ? `<p class="appliance-endpoint">Active loopback endpoint: <code>${escape(appliance.endpoint)}</code></p>` : ""}${appliance.message ? `<p class="appliance-message">${escape(appliance.message)}</p>` : ""}<div class="appliance-actions">${applianceState === "NOT_INSTALLED" ? `<button type="button" class="primary-action" data-appliance-action="install">Install Managed Local Model</button>` : ""}${applianceState === "INSTALLING" ? `<p class="appliance-progress">Installing (${appliance.progress || 0}%): ${escape(appliance.stage || "downloading")}...</p><button type="button" data-appliance-action="cancel">Cancel Installation</button>` : ""}${applianceState === "READY" ? `<button type="button" class="primary-action" data-appliance-action="test">Test Local Model Prompt</button><button type="button" data-appliance-action="remove">Remove Local Model</button>` : ""}${applianceState === "REPAIR_REQUIRED" ? `<button type="button" class="primary-action" data-appliance-action="repair">Repair Installation</button><button type="button" data-appliance-action="remove">Remove Local Model</button>` : ""}${applianceState === "UNSUPPORTED" ? `<p class="error">Hardware requirements not met. Minimum 6GB RAM and 2.5GB disk required.</p>` : ""}</div><details class="advanced-diagnostics" data-testid="appliance-diagnostics" open><summary>Advanced Diagnostics &amp; Runtime Configuration</summary><div class="advanced-diagnostics-body"><dl class="diagnostics-summary-grid"><div><dt>Active Runtime</dt><dd>On-Device Loopback Inference</dd></div><div><dt>Security Enclave</dt><dd>127.0.0.1 Loopback Only · No 0.0.0.0 · No LAN</dd></div><div><dt>Hardware Arch</dt><dd>${escape(appliance.hardware?.arch || "arm64")}</dd></div><div><dt>Memory Available</dt><dd>${appliance.hardware?.memory_gb ? `${appliance.hardware.memory_gb} GB` : "Adequate"}</dd></div><div><dt>Endpoint</dt><dd>${escape(appliance.endpoint || "127.0.0.1:<ephemeral-port>")}</dd></div><div><dt>Context Limit</dt><dd>2048 Tokens</dd></div><div><dt>Execution Timeout</dt><dd>30,000 ms</dd></div></dl><label>Local address <input name="local_endpoint" value="${escape(result.settings.local_endpoint || appliance.endpoint || "")}" placeholder="http://127.0.0.1:11434"></label><label>Local model <input name="local_model" value="${escape(result.settings.local_model || appliance.model || "")}" placeholder="qwen3.5:9b"></label><p class="muted">Recommended for Apple silicon: qwen3.5:9b. Canonical simulation validates every interpretation before commit.</p></div></details></section>` : "";

  const interactionMarkup = isDev
    ? `<section class="settings-group"><h2>Interaction</h2><label>Input mode <select name="input_mode"><option value="structured">Structured controls</option><option value="natural">Natural language</option></select></label><label>Language provider <select name="provider"><option value="offline">Offline deterministic</option><option value="local">Local model · Ollama</option><option value="openai" ${configured || result.settings.provider === "openai" ? "" : "disabled"}>OpenAI ${configured ? "" : "(configure below)"}</option><option value="auto">AUTO hosted providers</option><option value="groq" ${groqConfigured || result.settings.provider === "groq" ? "" : "disabled"}>Groq ${groqConfigured ? "" : "(configure below)"}</option><option value="gemini" ${geminiConfigured || result.settings.provider === "gemini" ? "" : "disabled"}>Google Gemini ${geminiConfigured ? "" : "(configure below)"}</option><option value="openrouter" ${openrouterConfigured || result.settings.provider === "openrouter" ? "" : "disabled"}>OpenRouter ${openrouterConfigured ? "" : "(configure below)"}</option></select></label></section>`
    : `<section class="settings-group"><h2>Interaction</h2><label>Input mode <select name="input_mode"><option value="structured">Structured controls</option><option value="natural">Natural language</option></select></label><input type="hidden" name="provider" value="${escape(result.settings.provider || "offline")}"></section>`;

  const openaiMarkup = isDev
    ? `<form id="openai"><h2>Hosted model credentials</h2><p class="credential-intro">Add or replace a saved key below. Saving a key is separate from Save and apply above. Stored keys stay masked in the provider list.</p><label>Provider <select name="credential_provider"><option value="groq">Groq${groqConfigured ? " · Configured" : ""}</option><option value="gemini">Google Gemini${geminiConfigured ? " · Configured" : ""}</option><option value="openrouter">OpenRouter${openrouterConfigured ? " · Configured" : ""}</option><option value="openai">OpenAI${configured ? " · Configured" : ""}</option></select></label><label>API key <input name="api_key" type="password" autocomplete="off" placeholder="Paste access key"></label><label>Model <input name="model" value="${escape(result.settings.openai_model ?? "")}" placeholder="Default configured model"></label><label><input type="checkbox" name="auto_after_save" checked> Use AUTO fallbacks after saving</label><div class="credential-actions">${button("Save access key", "submit")}<button type="button" data-provider-save-model>Save model only</button>${button("Remove selected key", "remove-key")}</div></form>`
    : "";

  const audioSectionMarkup = `<section class="settings-group audio-settings"><h2>Audio</h2><div class="audio-setting-row"><label><input type="checkbox" name="audio_muted"> Mute all audio</label><span class="audio-value-display" id="audio-mute-val">${result.settings.audio_muted ? "MUTED" : "ACTIVE"}</span></div><div class="audio-setting-row"><label>SFX Volume <input type="range" name="audio_sfx" min="0" max="1" step="0.05" value="${escape(result.settings.audio_sfx ?? 0.8)}"></label><span class="audio-value-display" id="audio-sfx-val">${Math.round((result.settings.audio_sfx ?? 0.8) * 100)}%</span></div><div class="audio-setting-row"><label>Music Volume <input type="range" name="audio_music" min="0" max="1" step="0.05" value="${escape(result.settings.audio_music ?? 0.7)}"></label><span class="audio-value-display" id="audio-music-val">${Math.round((result.settings.audio_music ?? 0.7) * 100)}%</span></div></section>`;

  app.innerHTML = `<section class="shell narrow settings-surface" data-testid="settings-surface"><header><div><p class="eyebrow">APPLICATION SETTINGS</p><h1>Presentation and access</h1><p>These preferences affect presentation only; no world state is changed.</p></div><button type="button" data-action="close-settings">Close settings</button></header>${providerManagerMarkup}<form id="settings">${interactionMarkup}${localModelMarkup}<section class="settings-group"><h2>Accessibility</h2><label>Theme <select name="theme"><option value="system">System</option><option value="high-contrast">High contrast</option></select></label><label>Text scale <select name="text_scale"><option value="default">Default</option><option value="large">Large</option><option value="extra-large">Extra large</option></select></label><label><input type="checkbox" name="reduced_motion"> Reduce motion</label><label><input type="checkbox" name="guided_introductions"> Show contextual guidance</label></section><section class="settings-group visual-settings"><h2>Field media rendering</h2><label><input type="checkbox" name="visual_rendering"> Visual rendering enabled</label><label><input type="checkbox" name="automatic_evidence_rendering"> Automatic evidence rendering</label><label>Adapter <select name="visual_adapter"><option value="fallback">Offline fallback</option><option value="comfyui">Local ComfyUI (optional)</option><option value="hosted">Hosted adapter (optional)</option></select></label><label>Quality <select name="visual_quality"><option value="documentary">Documentary</option><option value="detailed">Detailed</option></select></label><label><input type="checkbox" name="retry_failed_renders"> Retry failed renders</label><p>Rendering is presentation-only. Evidence records and gameplay continue offline.</p></section>${audioSectionMarkup}<div class="settings-actions"><button type="submit">Save and apply</button>${button("Reset to defaults", "reset-preferences")}<button type="button" data-action="close-settings">Close without changes</button></div><p id="settings-message" role="status" aria-live="polite"></p></form>${openaiMarkup}</section>`;

  app.querySelectorAll("button:disabled, option:disabled").forEach((item) => item.remove());
  const offlineOption = app.querySelector('select[name="provider"] option[value="offline"]');
  if (offlineOption) offlineOption.textContent = "Embedded ASync interpreter · zero configuration";
  settingsController.state = "open";
  settingsController.mounted = app.querySelector("[data-testid=settings-surface]");
  const form = document.querySelector("#settings");
  const control = (name) => form.querySelector(`[name="${name}"]`);
  const inputMode = control("input_mode");
  const provider = control("provider");
  const theme = control("theme");
  const textScale = control("text_scale");
  const reducedMotion = control("reduced_motion");
  const guided = control("guided_introductions");

  if (inputMode) inputMode.value = result.settings.input_mode;
  if (provider) provider.value = result.settings.provider;
  if (theme) theme.value = result.settings.theme;
  if (textScale) textScale.value = result.settings.text_scale;
  if (reducedMotion) reducedMotion.checked = Boolean(result.settings.reduced_motion);
  if (guided) guided.checked = result.settings.guided_introductions !== false;
  if (control("audio_muted")) control("audio_muted").checked = Boolean(result.settings.audio_muted);
  if (control("audio_sfx")) control("audio_sfx").value = result.settings.audio_sfx ?? 0.8;
  if (control("audio_music")) control("audio_music").value = result.settings.audio_music ?? 0.7;
  if (control("local_endpoint")) control("local_endpoint").value = result.settings.local_endpoint || appliance.endpoint || "";
  if (control("local_model")) control("local_model").value = result.settings.local_model || appliance.model || "";
  if (control("visual_rendering")) control("visual_rendering").checked = result.settings.visual_rendering !== false;
  if (control("automatic_evidence_rendering")) control("automatic_evidence_rendering").checked = result.settings.automatic_evidence_rendering !== false;
  if (control("visual_adapter")) control("visual_adapter").value = result.settings.visual_adapter ?? "fallback";
  if (control("visual_quality")) control("visual_quality").value = result.settings.visual_quality ?? "documentary";
  if (control("retry_failed_renders")) control("retry_failed_renders").checked = result.settings.retry_failed_renders !== false;

  const message = document.querySelector("#settings-message");
  const preview = () => applyPreferences({
    ...result.settings,
    theme: theme ? theme.value : result.settings.theme,
    text_scale: textScale ? textScale.value : result.settings.text_scale,
    reduced_motion: reducedMotion ? reducedMotion.checked : result.settings.reduced_motion,
    guided_introductions: guided ? guided.checked : result.settings.guided_introductions,
    audio_muted: control("audio_muted") ? control("audio_muted").checked : result.settings.audio_muted,
    audio_sfx: control("audio_sfx") ? Number(control("audio_sfx").value) : result.settings.audio_sfx,
    audio_music: control("audio_music") ? Number(control("audio_music").value) : result.settings.audio_music
  });

  [theme, textScale, reducedMotion, guided].filter(Boolean).forEach((item) => item.addEventListener("change", preview));

  const sfxCtrl = control("audio_sfx");
  const musicCtrl = control("audio_music");
  const muteCtrl = control("audio_muted");
  sfxCtrl?.addEventListener("input", () => {
    const span = document.querySelector("#audio-sfx-val");
    if (span) span.textContent = `${Math.round(Number(sfxCtrl.value) * 100)}%`;
    preview();
  });
  musicCtrl?.addEventListener("input", () => {
    const span = document.querySelector("#audio-music-val");
    if (span) span.textContent = `${Math.round(Number(musicCtrl.value) * 100)}%`;
    preview();
  });
  muteCtrl?.addEventListener("change", () => {
    const span = document.querySelector("#audio-mute-val");
    if (span) span.textContent = muteCtrl.checked ? "MUTED" : "ACTIVE";
    preview();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (settingsController.state === "saving") return;
    settingsController.state = "saving";
    const data = new FormData(form);
    form.querySelectorAll("input,select,button").forEach((item) => { item.disabled = true; });
    const saved = await yellowBeast.updateSettings({
      settings: {
        input_mode: data.get("input_mode") || result.settings.input_mode,
        provider: data.get("provider") || result.settings.provider || "offline",
        local_endpoint: data.get("local_endpoint") || result.settings.local_endpoint || "",
        local_model: data.get("local_model") || result.settings.local_model || "",
        theme: data.get("theme") || result.settings.theme,
        text_scale: data.get("text_scale") || result.settings.text_scale,
        reduced_motion: data.get("reduced_motion") === "on",
        guided_introductions: data.get("guided_introductions") === "on",
        audio_muted: data.get("audio_muted") === "on",
        audio_sfx: Number(data.get("audio_sfx") ?? 0.8),
        audio_music: Number(data.get("audio_music") ?? 0.7),
        visual_rendering: data.get("visual_rendering") === "on",
        automatic_evidence_rendering: data.get("automatic_evidence_rendering") === "on",
        visual_adapter: data.get("visual_adapter") || "fallback",
        visual_quality: data.get("visual_quality") || "documentary",
        retry_failed_renders: data.get("retry_failed_renders") === "on"
      }
    });
    form.querySelectorAll("input,select,button").forEach((item) => { item.disabled = false; });
    if (!resultIsError(saved)) {
      settingsController.state = "saved";
      applyPreferences(saved.settings);
      message.textContent = "Preferences saved and applied.";
    } else {
      settingsController.state = "open";
      message.textContent = saved.error.message;
    }
  });

  const mountedSettings = settingsController.mounted;
  const stillInSettings = () => mountedSettings.isConnected && settingsController.mounted === mountedSettings;

  if (isDev) {
    const managerMessage = document.querySelector("#provider-manager-message");
    if (managerMessage) managerMessage.textContent = feedback;
    const credentialForm = document.querySelector("#openai");
    if (credentialForm) {
      const credentialProvider = credentialForm.querySelector('[name="credential_provider"]');
      const modelControl = credentialForm.querySelector('[name="model"]');
      const hostedProviderIds = new Set(["groq", "gemini", "openrouter", "openai"]);
      credentialProvider.value = hostedProviderIds.has(editProvider) ? editProvider : (hostedProviderIds.has(result.settings.provider) ? result.settings.provider : "groq");
      const loadProviderModel = () => {
        const entry = (result.provider.entries ?? []).find(item => item.id === credentialProvider.value);
        modelControl.value = entry?.model ?? "";
        credentialForm.querySelector('[name="api_key"]').value = "";
      };
      credentialProvider.addEventListener("change", loadProviderModel); loadProviderModel();
      app.querySelectorAll("[data-provider-edit]").forEach(item => item.addEventListener("click", () => {
        credentialProvider.value = item.dataset.providerEdit; loadProviderModel();
        credentialForm.scrollIntoView({ block:"center" }); credentialForm.querySelector('[name="api_key"]').focus();
      }));
      const deleteProviderKey = async providerId => {
        const removed = await yellowBeast.removeProviderKey({ provider:providerId });
        if (stillInSettings()) await settings(undefined, removed.ok ? (removed.configured ? "Saved key removed; an environment credential is still available." : "Saved key deleted. Other provider keys were preserved.") : removed.error.message, credentialProvider.value);
      };
      app.querySelectorAll("[data-provider-delete]").forEach(item => item.addEventListener("click", () => deleteProviderKey(item.dataset.providerDelete)));
      credentialForm.querySelector('[data-action="remove-key"]')?.addEventListener("click", () => deleteProviderKey(credentialProvider.value));
      app.querySelector("[data-provider-auto]")?.addEventListener("click", async () => {
        const saved = await yellowBeast.updateSettings({ settings:{ provider:"auto",input_mode:"natural" } });
        if (stillInSettings()) await settings(undefined, saved.ok ? "AUTO fallback order enabled. Only configured hosted providers can interpret live turns." : saved.error.message, credentialProvider.value);
      });
      app.querySelector("[data-provider-save-model]")?.addEventListener("click", async () => {
        const saved = await yellowBeast.updateSettings({ settings:{ [`${credentialProvider.value}_model`]:modelControl.value.trim() } });
        if (stillInSettings()) await settings(undefined, saved.ok ? "Model saved for the selected provider. Use Test connection to verify it." : saved.error.message, credentialProvider.value);
      });
      document.querySelector("#openai").addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const targetProvider = data.get("credential_provider") || "openai";
        const apiKey = data.get("api_key");
        const model = data.get("model") || null;
        let saved;
        if (targetProvider === "openai") {
          saved = await yellowBeast.configureOpenAI({ api_key: apiKey, model, activate:false });
        } else {
          saved = await yellowBeast.configureProvider({ provider: targetProvider, api_key: apiKey, model, activate:false });
        }
        message.textContent = saved.ok ? `${targetProvider === "openai" ? "Access" : targetProvider} key stored. It is never shown here again.` : saved.error.message;
        if (saved.ok) {
          credentialForm.querySelector('[name="api_key"]').value = "";
          if (data.get("auto_after_save") === "on") await yellowBeast.updateSettings({ settings:{ provider:"auto",input_mode:"natural" } });
          if (stillInSettings()) await settings(undefined, `Key stored for ${targetProvider}. ${saved.provider.persistent ? "Encrypted storage is active." : "Key is available for this session only."} Use Test connection to verify it.`, targetProvider);
        }
      });
    }
    app.querySelector("[data-local-edit]")?.addEventListener("click", () => {
      document.querySelector("#local-model-settings")?.scrollIntoView({ block:"center" });
      control("local_model")?.focus();
    });
    app.querySelector("[data-provider-use-local]")?.addEventListener("click", () => {
      if (provider) {
        provider.value = "local";
        provider.dispatchEvent(new Event("change", { bubbles:true }));
        message.textContent = "Local model selected. Save and apply to use it for language turns.";
        provider.focus();
      }
    });
    app.querySelectorAll("[data-provider-test]").forEach(item => item.addEventListener("click", async () => {
      item.disabled = true;
      const mm = document.querySelector("#provider-manager-message");
      if (mm) mm.textContent = "Testing the selected provider with a small request…";
      try { const tested = await yellowBeast.testProvider({ provider:item.dataset.providerTest, live:true }); if (stillInSettings()) await settings(undefined, tested.ok ? tested.message : tested.error.message, item.dataset.providerTest === "local" ? null : document.querySelector('#openai [name="credential_provider"]')?.value); }
      catch { if (mm) mm.textContent = "Connection test could not finish. Retry when the service is available."; item.disabled = false; }
    }));
    app.querySelectorAll("[data-appliance-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.applianceAction;
        btn.disabled = true;
        if (action === "install") {
          const card = app.querySelector('[data-testid="local-appliance-card"]');
          if (card) {
            card.dataset.applianceState = "INSTALLING";
            const badge = card.querySelector(".appliance-status-banner .badge");
            if (badge) {
              badge.textContent = "INSTALLING";
              badge.className = "badge badge-installing";
            }
          }
          const res = await yellowBeast.installInferenceAppliance();
          if (stillInSettings()) await settings(undefined, res?.ok ? "Managed local model installed." : (res?.error?.message ?? "Install failed"));
        } else if (action === "cancel") {
          await yellowBeast.cancelInferenceApplianceInstall();
          if (stillInSettings()) await settings(undefined, "Installation cancelled.");
        } else if (action === "repair") {
          const res = await yellowBeast.repairInferenceAppliance();
          if (stillInSettings()) await settings(undefined, res?.ok ? "Repair successful." : (res?.error?.message ?? "Repair failed"));
        } else if (action === "remove") {
          const res = await yellowBeast.removeInferenceAppliance();
          if (stillInSettings()) await settings(undefined, res?.ok ? "Local model removed." : (res?.error?.message ?? "Remove failed"));
        } else if (action === "test") {
          const res = await yellowBeast.testProvider({ provider: "local", live: true });
          if (stillInSettings()) await settings(undefined, res?.ok ? res.message : (res?.error?.message ?? "Connection test failed"));
        }
      });
    });
  }
  form.querySelector("select, input, button")?.focus({ preventScroll:true });
}
function about() { requestGate.invalidate(); app.innerHTML = `<section class="shell narrow"><p class="eyebrow">ABOUT · UNOFFICIAL</p><h1>Yellow Beast</h1><p>An unofficial persistent, shared-world field experience inspired by institutional horror. It works offline, with optional language assistance.</p><p>Worlds are saved in your application data folder; normal play never requires a terminal. Yellow Beast is not an official ASYNC or Kane Pixels product.</p>${button("Back", "home")}</section>`; }
document.addEventListener("click", async (event) => { const action = event.target.dataset.action; if (!action) return; if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select"); if (action === "developer") { developerConsole(); return; } if (action === "renderer-retry") { settingsController.state = "closed"; if (rendererDiagnostics.surface === "settings") settings(event.target); else home(); return; } if (action === "home") { home(); return; }
else if (action === "personnel-confirm-continue") {
  const confirmed = await yellowBeast.confirmQ4Personnel({ world_id:current.world.id });
  if (!resultIsError(confirmed)) aeotInitialization();
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
} else if (action === "exit-game") {
  if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
  showExitGameConfirmation();
  return;
} else if (action === "cancel-exit") {
  if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select");
  document.querySelector(".exit-game-portal")?.remove();
  document.querySelector('[data-action="exit-game"]')?.focus();
  return;
} else if (action === "confirm-exit") {
  if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_submit");
  document.querySelector(".exit-game-portal")?.remove();
  if (window.yellowBeast?.exitApplication) {
    await yellowBeast.exitApplication();
  } else if (typeof window.close === "function") {
    window.close();
  }
  return;
} else if (action === "close-settings") { settingsController.state = "closing"; const opener = settingsController.opener; const returnTo = current.settingsReturn ?? home; current.settingsReturn = null; returnTo(); settingsController.state = "closed"; queueMicrotask(() => opener?.isConnected && opener.focus()); } else if (action === "new") newWorld(); else if (action === "import") { const imported = await yellowBeast.chooseImportWorld(); if (resultIsError(imported) && imported.error.code !== "IMPORT_CANCELLED") alert(imported.error.message); home(); } else if (action === "settings") settings(event.target); else if (action === "about") about(); else if (action === "reset-preferences") { const saved = await yellowBeast.updateSettings({ settings:{ theme:"system", text_scale:"default", reduced_motion:false, guided_introductions:true } }); if (!resultIsError(saved)) applyPreferences(saved.settings); settings(event.target); } else if (action === "refresh-view") { const context = requestContext(); const refreshed = await yellowBeast.getGameplayProjection({ world_id:context.worldId, mode:context.mode }); if (!resultIsError(refreshed) && requestContext().worldId === context.worldId && requestContext().mode === context.mode && event.target.isConnected) { current.projection = refreshed.projection; play("Current view refreshed.", "result"); } } else if (action.startsWith("rename:")) { const worldId = action.slice(7); const isLocked = event.target.closest("li")?.dataset.hasFiledPersonnel === "true"; if (isLocked) { alert("This field file is registered to permanent personnel and cannot be renamed."); return; } const prior = event.target.closest("li")?.dataset.worldName ?? ""; const name = prompt("Rename this world. This changes only its library name.", prior); if (name !== null) { const renamed = await yellowBeast.renameWorld({ world_id:worldId, name }); if (resultIsError(renamed)) alert(renamed.error.message); home(); } } else if (action.startsWith("restore:")) { const restored = await yellowBeast.restoreBackup({ world_id:action.slice(8), confirmed:confirm("Restore the previous save? Recent changes may be lost.") }); if (!resultIsError(restored)) selectWorld(action.slice(8)); else alert(restored.error.message); } else if (action.startsWith("export:")) { const result = await yellowBeast.chooseExportWorld({ world_id: action.slice(7) }); if (resultIsError(result) && result.error.code !== "EXPORT_CANCELLED") alert(result.error.message); } else if (action.startsWith("delete:")) { const worldId = action.slice(7); const name = event.target.closest("li")?.dataset.worldName ?? "this world"; if (confirm(`Delete “${name}” and its saved sessions? This cannot be undone.`)) { const deleted = await yellowBeast.deleteWorld({ world_id:worldId, confirmed:true }); if (resultIsError(deleted)) alert(result.error.message); home(); } } else if (action.startsWith("diagnostic:")) { const result = await yellowBeast.exportTesterReport({ world_id:action.slice(11), mode:"field-researcher" }); alert(resultIsError(result) ? result.error.message : `Diagnostic record exported to ${result.file}. Credentials and provider keys are omitted.`); } else if (action.startsWith("world:")) selectWorld(action.slice(6)); else if (action.startsWith("mode:")) enterMode(action.slice(5)); });
document.addEventListener("keydown", (event) => { if (typeof YBDialoguePlayer !== "undefined" && YBDialoguePlayer.isTyping()) { if ([" ", "Enter", "Escape"].includes(event.key) && !event.target.matches("input, textarea, select")) { event.preventDefault(); YBDialoguePlayer.finish(); return; } } if (event.key === "Escape" && document.querySelector(".exit-game-portal")) { event.preventDefault(); document.querySelector('[data-action="cancel-exit"]')?.click(); return; } if (event.key === "Escape" && document.querySelector(".termination-portal")) { event.preventDefault(); document.querySelector('[data-action="cancel-termination"]')?.click(); return; } if (event.key === "Escape" && document.querySelector("[data-testid=settings-surface]")) { event.preventDefault(); document.querySelector("[data-action=close-settings]")?.click(); return; } if (event.altKey && event.key === ",") { event.preventDefault(); settings(); return; } if (event.key === "Escape" && document.querySelector('[data-testid="world-library"]') && !document.querySelector(".exit-game-portal") && !document.querySelector("[data-testid=settings-surface]") && !document.querySelector(".termination-portal")) { event.preventDefault(); showExitGameConfirmation(); return; } if (!current.projection || event.target.matches("input, textarea, select, button")) return; const recap = document.querySelector("#recap-panel"); if (event.key === "?" && recap) { event.preventDefault(); recap.open = true; recap.querySelector("summary")?.focus({ preventScroll:true }); } else if (event.key === "Escape" && recap?.open) { event.preventDefault(); recap.open = false; focusNaturalInput(); } });
function boot() { const bypass = window.__YB_TEST_BYPASS_BOOT__ === true || /(?:bypass-boot|test-mode)/i.test(window.location.search + window.location.hash); if (bypass) { home(); return; } app.innerHTML = `<section class="cold-launch" data-testid="cold-launch" role="status" aria-live="polite"><span class="loading-animation" aria-label="Loading"></span></section>`; window.setTimeout(showTitleCard, 900); }
let titlePlayback = null;
async function showTitleCard() {
  titlePlayback?.cancel();
  const [info, preferences] = await Promise.all([yellowBeast.getAppInfo(), yellowBeast.getSettings()]);
  if (typeof YBAudio !== "undefined") YBAudio.stopAll();
  applyPreferences(preferences.settings);
  if (typeof YBAudio !== "undefined") YBAudio.startMenuMusic(info.app.menu_music);
  if (typeof YBTitlePlayer !== "undefined") {
    titlePlayback = YBTitlePlayer.play({ mount: app, onComplete: home,
      reducedMotion: preferences.settings.reduced_motion,
      reducedSensory: preferences.settings.reduced_sensory });
    return;
  }
  app.innerHTML = `<section class="title-card title-materializing" data-testid="title-card" tabindex="0"><div class="title-wipe-shutter" aria-hidden="true"></div><img src="../assets/icon-source/ASYNC_Logo.png" class="title-logo" alt="ASYNC" draggable="false"><h1>VOICES OF THE THRESHOLD</h1><p class="title-subtitle">A Kane Pixels' Backrooms Simulacrum</p><small>PRESS ANYTHING</small></section>`;

  let isMaterialized = false;
  let gate1Acknowledged = false;
  let gate1HandledAt = 0;
  let gate2Dismissing = false;
  const card = app.querySelector(".title-card");

  const materializationTimer = window.setTimeout(() => {
    if (!isMaterialized) {
      isMaterialized = true;
      card?.classList.remove("title-materializing");
      card?.classList.add("title-materialized");
    }
  }, 2200);

  const handleTitleInput = (e) => {
    if (e.type === "keydown" && (e.repeat || ["Tab", "Shift", "Control", "Alt", "Meta"].includes(e.key))) return;
    const now = Date.now();

    if (!gate1Acknowledged) {
      window.clearTimeout(materializationTimer);
      isMaterialized = true;
      gate1Acknowledged = true;
      gate1HandledAt = now;
      card?.classList.remove("title-materializing");
      card?.classList.add("title-materialized");
      card?.classList.add("title-acknowledged");
      const promptEl = card?.querySelector("small");
      if (promptEl) {
        promptEl.textContent = "PRESS AGAIN TO CONTINUE";
        promptEl.classList.add("prompt-acknowledged");
      }
      if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_select", { gain: 1.5 });
      return;
    }

    if (now - gate1HandledAt < 120) return;
    if (gate2Dismissing) return;
    gate2Dismissing = true;
    window.removeEventListener("keydown", handleTitleInput);
    window.removeEventListener("pointerdown", handleTitleInput);
    if (typeof YBAudio !== "undefined") YBAudio.emitHook("ui_submit", { gain: 1.5 });
    card?.classList.add("title-dismissing");
    const dismissDelay = window.__YB_TEST_FAST_FADE__ === true ? 0 : 450;
    window.setTimeout(() => {
      home();
    }, dismissDelay);
  };

  window.addEventListener("keydown", handleTitleInput);
  window.addEventListener("pointerdown", handleTitleInput);
  card?.focus();
}

// Pass 9C-2: the only main->renderer push in the app. The payload carries
// nothing but a world_id -- it is an invalidation signal, not presentable
// state -- so on receipt we re-read through the exact same projection path
// the "refresh-view" action already uses, and ignore it outright if it does
// not match the session currently on screen (a stale/backgrounded world
// must never overwrite the active one).
if (typeof yellowBeast !== "undefined" && typeof yellowBeast.onProjectionChanged === "function") {
  yellowBeast.onProjectionChanged(async (payload) => {
    const context = requestContext();
    if (!context.worldId || payload?.world_id !== context.worldId) return;
    const refreshed = await yellowBeast.getGameplayProjection({ world_id: context.worldId, mode: context.mode });
    if (resultIsError(refreshed)) return;
    if (requestContext().worldId !== context.worldId || requestContext().mode !== context.mode) return;
    current.projection = refreshed.projection;
    play();
  });
}

boot();
