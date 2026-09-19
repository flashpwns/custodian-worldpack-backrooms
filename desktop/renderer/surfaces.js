"use strict";
// Pure renderer helpers: input is already a safe desktop projection. No host
// APIs, world-history access, or inferred historical connections live here.
(function (global) {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[char]);
  const title = (value) => String(value ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
  const empty = (message) => `<p class="empty">${escape(message)}</p>`;
  const list = (items, render, message) => items?.length ? `<ul class="data-list">${items.map(render).join("")}</ul>` : empty(message);
  const panel = (heading, content, extra = "") => { const documentLabels = { Objective: "Site objective", "Current Instructions": "Expected procedures", Reporting: "Radio and reporting", "Prior Survey Record": "Recorded prior history" }; const label = documentLabels[heading]; return `<section class="panel" ${extra}><h2>${escape(heading)}</h2>${label ? `<small class="document-label">${escape(label)}</small>` : ""}${content}</section>`; };
  const badge = (value) => `<span class="badge badge-${escape(String(value).toLowerCase())}">${escape(title(value))}</span>`;
  const presentationEvents = (projection) => {
    const broadcast = projection.q4?.facility_broadcast;
    if (broadcast && broadcast.visible && broadcast.status === "in-progress" && projection.phase?.phase_id === "BRIEFING") {
      const cleanTitle = (broadcast.title ?? "JULY 17, 1991").replace(/\s*[·-]\s*ASSIGNMENT BRIEFING/gi, "").replace(/ASSIGNMENT BRIEFING/gi, "").trim() || "JULY 17, 1991";
      return `<section class="opener-presentation facility-broadcast" data-testid="opener-presentation" data-channel="facility-broadcast"><div><p class="eyebrow">FACILITY BROADCAST // PROJECTOR 01</p><h1>${escape(cleanTitle)}</h1></div>${broadcast.text ? `<div><p class="broadcast-body">${escape(broadcast.text)}</p></div>` : ""}</section>`;
    }
    return "";
  };
  const callbacks = (projection) => projection.gameplay.callbacks?.length ? panel("Recognized callbacks", list(projection.gameplay.callbacks, (item) => `<li><strong>${escape(item.description)}</strong>${badge(item.recognition)}</li>`, "")) : "";
  const timeline = (projection, label = "Timeline") => projection.gameplay.timeline?.length ? panel(label, list(projection.gameplay.timeline, (item) => `<li>${escape(title(item.type))}${item.description ? ` — ${escape(item.description)}` : ""}</li>`, "")) : "";
  const objectives = (projection) => {
    const progress = projection.q4?.mission_progress;
    if (!progress) return panel("Mission status", empty("No current assignment is known."), 'data-testid="objectives"');
    const symbol = (state) => ({ satisfied:"✓", failed:"!", blocked:"▰", waived:"◇", abandoned:"×", inactive:"○", active:"→" })[state] ?? "·";
    const objectiveList = (items, message) => list(items, (item) => `<li class="mission-objective mission-${escape(item.state)}" aria-label="${escape(`${item.name}: ${item.state_label}. ${item.summary}`)}"><span class="objective-symbol" aria-hidden="true">${symbol(item.state)}</span><div><strong>${escape(item.name)}</strong><span>${escape(item.summary)}</span>${item.next_requirement ? `<small>${escape(item.next_requirement)}</small>` : ""}${item.recent_transition ? `<details><summary>Recent change</summary><p>${escape(item.recent_transition.summary)}</p></details>` : ""}</div><span class="state-label">${escape(item.state_label)}</span></li>`, message);
    const blockers = progress.blockers?.length ? `<section class="mission-subsection"><h3>Current blockers</h3>${list(progress.blockers, (item) => `<li><strong>${escape(item.name)}</strong><span>${escape(item.reason)}</span></li>`, "")}</section>` : "";
    const updates = progress.recent_updates?.length ? `<section class="mission-subsection mission-updates"><h3>Recent mission updates</h3>${list(progress.recent_updates, (item) => `<li><strong>${escape(item.headline)}</strong><span>${escape(item.summary)}</span></li>`, "")}</section>` : "";
    const readiness = progress.return_readiness ?? {};
    return `<section class="panel mission-status" data-testid="objectives" aria-labelledby="mission-status-heading"><header><div><p class="eyebrow">MISSION STATUS</p><h2 id="mission-status-heading">${escape(progress.display_name)}</h2></div>${badge(progress.lifecycle_label)}</header><p>${escape(progress.operational_intent)}</p><section class="mission-subsection"><h3>Required objectives</h3>${objectiveList(progress.required_objectives, "No required objective is declared.")}</section><section class="mission-subsection"><h3>Optional objectives</h3>${objectiveList(progress.optional_objectives, "No optional objective is declared.")}</section>${blockers}${updates}<section class="mission-subsection return-readiness"><h3>Return readiness</h3><p><strong>${escape(readiness.ready ? "READY" : readiness.route_available ? "ROUTE AVAILABLE" : "NOT AVAILABLE")}</strong></p><p>${escape(readiness.summary)}</p>${readiness.unresolved?.length ? `<details><summary>Unresolved if the mission closes now</summary>${list(readiness.unresolved, (item) => `<li><strong>${escape(item.name)}</strong><span>${escape(item.summary)}</span></li>`, "")}</details>` : ""}</section></section>`;
  };
  const isOpenerProjection = (projection) => Boolean(
    projection?.q4?.scenario === "day1-opener" ||
    projection?.q4?.scenario === "clear-q4-day1-opener" ||
    projection?.q4?.scenario === "async-clear-q4-day1-opener" ||
    projection?.q4?.day1_opener
  );
  const actionLabel = (type, isOpener = false) => {
    if (type === "CROSS" && isOpener) return "CLEARED; CROSS?";
    if (type === "READY") return isOpener ? "PROCEED TO ESD · PROCEED TO EQUIPMENT STAGING" : "PROCEED TO ESD";
    if (type === "PROCEED") return isOpener ? "CONFIRM ISSUE" : "Proceed toward the Threshold";
    return ({ READY:"PROCEED TO ESD", PROCEED:"Proceed toward the Threshold", APPROACH:"Approach Threshold Room", CROSS:"Cross Threshold", RADIO_CHECK:"Establish Radio Contact", BEGIN_FIELD_OPERATION:"Proceed into the Complex", LOOK:"Observe", MOVE:"Move", INSPECT:"Inspect", USE:"Use equipment", ACTIVATE:"Activate", DEACTIVATE:"Deactivate", OPEN:"Open", CLOSE:"Close", TAKE:"Take", PLACE:"Place", MARK:"Mark", PHOTOGRAPH:"Photograph", RECORD:"Record evidence", TEST:"Test", REPAIR:"Repair", DAMAGE:"Damage", SECURE:"Secure", RELEASE:"Release", COMMUNICATE:"Communicate", WAIT:"Wait", ORDER_HOLD:"Order: Hold position", ORDER_INVESTIGATE:"Order: Investigate route", ORDER_FOLLOW:"Order: Restore contact", ASSIST:"Assist teammate", RECOVER:"Recover equipment", MITIGATE:"Mitigate known hazard", RETURN:"Begin Return Procedure", COMPLETE_RETURN:"Complete Return Procedure", ABORT:"Declare Controlled Abort", DROP:"Leave item", STRAND:"Stop and leave a remnant", EXPAND:"Explore route", DISCOVER:"Record object", REVIEW_REPORT:"Review reports", ADVANCE:"Advance institutional time", ADVANCE_OPERATIONS:"Continue to next assignment" })[type] ?? title(type);
  };
  const CAPABILITIES = Object.freeze({ "async-command": ["institution", "reports", "personnel", "research", "infrastructure", "tasks", "known-complex"], "field-researcher": ["objectives", "surroundings", "team", "communications", "evidence", "equipment", "risk", "known-route"], "local-anomaly": ["base", "archive", "artifacts", "questions", "routes", "preparation", "excursion"], lost: ["surroundings", "route-fragments", "landmarks", "resources", "notes"] });
  const actions = (projection) => {
    const isOpener = isOpenerProjection(projection);
    return panel("Available actions", projection.available_actions.length ? `<div class="action-grid">${projection.available_actions.map((item) => `<button type="button" class="action-button" data-game-action="${escape(item.type)}" data-testid="action-${escape(item.type)}">${escape(actionLabel(item.type, isOpener))}</button>`).join("")}</div>` : empty("No action is available right now."), 'data-testid="actions"');
  };
  const communicationLanes = (projection, disabled = false) => {
    const channels = projection.q4?.channels ?? {}; const local = channels.local ?? {}; const standard = channels.standard ?? {}; const team = channels.team_status ?? projection.q4?.team ?? [];
    const broadcast = projection.q4?.facility_broadcast;
    const isBroadcastActive = Boolean(broadcast && broadcast.visible && broadcast.status === "in-progress");
    const broadcastMsg = (broadcast && broadcast.status !== "standby" && broadcast.text) ? [{
      channel: "FACILITY BROADCAST",
      speaker: broadcast.speaker ?? "DR. KIRK MAXWELL",
      text: broadcast.text,
      order: -1,
      isBroadcast: true
    }] : [];
    const messages = [...broadcastMsg, ...(local.history ?? []).map((item, index) => ({ ...item, channel: "LOCAL", order: item.at ?? item.sent_at ?? index })), ...(standard.history ?? []).map((item, index) => ({ ...item, channel: "STANDARD", order: item.at ?? item.sent_at ?? index }))].sort((a, b) => Number(a.order) - Number(b.order)).slice(-12);
    const timeline = list(messages, (item) => {
      if (item.isBroadcast || item.channel === "FACILITY BROADCAST") {
        return `<li class="communication-message channel-facility-broadcast" data-channel="facility-broadcast"><span class="message-channel">FACILITY BROADCAST</span><div><span class="comm-speaker comm-broadcast-speaker">${escape(item.speaker ?? "FACILITY BROADCAST")}:</span> <span class="comm-text comm-broadcast-text">${escape(item.text)}</span></div>${badge("FACILITY FEED")}</li>`;
      }
      const isLocal = item.channel === "LOCAL";
      const speaker = item.speaker === "You" ? (isLocal ? "YOU" : "EXPEDITION LEAD") : (item.speaker ?? item.targets?.[0] ?? "Record");
      const targetText = isLocal && item.targets?.[0] && item.speaker === "You" ? ` → ${escape(item.targets[0])}` : "";
      const textClass = isLocal ? "comm-spoken" : "comm-radio-body";
      const responseText = item.coworker_response ?? item.response;
      const responseSpeaker = item.response_speaker ?? item.coworker ?? (isLocal ? (item.targets?.[0] ?? "Coworker") : "STANDARD DESK");
      const quote = (txt) => isLocal ? `“${escape(txt)}”` : escape(txt);
      return `<li class="communication-message channel-${String(item.channel).toLowerCase()}" data-channel="${String(item.channel).toLowerCase()}"><span class="message-channel">${!isLocal ? `<span class="standard-channel-marker" aria-hidden="true">●</span> ` : ""}${escape(item.channel)}</span><div><span class="comm-speaker ${isLocal ? "comm-local-speaker" : "comm-radio-callsign"}">${escape(speaker)}${targetText}:</span> <span class="comm-text ${textClass}">${isLocal ? quote(item.text ?? item.result ?? "No detail recorded.") : `[TX] ${escape(item.text ?? item.result ?? "No detail recorded.")}`}</span>${responseText ? `<div class="comm-response ${isLocal ? "comm-local-response" : "comm-radio-rx"}"><span class="comm-speaker ${isLocal ? "comm-coworker-speaker" : "comm-radio-callsign"}">${escape(responseSpeaker)}:</span> <span class="comm-text ${textClass}">${isLocal ? quote(responseText) : `[RX] ${escape(responseText)}`}</span></div>` : ""}</div>${item.delivery ? badge(item.delivery) : item.delivery_status ? `<span class="badge badge-acknowledged">${escape(item.delivery_status)}</span>` : ""}</li>`;
    }, "No communication has been recorded in this operation.");
    const roster = list(team, (member) => {
      const epistemic = member.controlled ? "TEAM LEAD (YOU)" : member.last_observed ? `Last Observed: ${escape(member.last_observed)}` : member.last_reported ? `Last Reported: ${escape(member.last_reported)}` : member.last_contact ? `Last Contact: ${escape(member.last_contact)}` : "No confirmed contact";
      return `<li><strong>${escape(member.display_name)}</strong><span>${escape(member.role ?? "assigned personnel")} · ${escape(member.contact_state ?? member.contact_category ?? "contact unconfirmed")}</span>${badge(member.condition)}<small>${escape(member.current_or_last_known_location ?? member.location ?? "Location unconfirmed")} · ${epistemic}</small></li>`;
    }, "No team status is available.");
    const localState = local.available ? `LOCAL AVAILABLE · ${(local.targets ?? []).join(", ")}` : (local.unavailable_reason ?? "No personnel are within speaking range."); const standardState = standard.state_label ?? (standard.available ? "CHANNEL READY" : "UNAVAILABLE");
    const radioReady = projection.phase?.phase_id === "STANDARD_RADIO_CHECK"; const composerDisabled = disabled || (!local.available && !standard.available); const localDisabled = disabled ? "disabled" : ""; const standardDisabled = disabled || (!standard.available && !radioReady) ? "disabled" : ""; const standardSelected = radioReady ? "selected" : ""; const localSelected = radioReady ? "" : "selected";
    const checkInBtn = `<button type="button" class="action-button radio-check-in-button" data-q4-check-in="true" ${standardDisabled}>Hold for Standard Check-In (2s)</button>`;
    const localNotice = (projection.phase?.phase_id === "BRIEFING" && local.available) ? `<div class="local-communication-notice"><div class="eyebrow">LOCAL COMMUNICATION</div><p>Address assigned coworkers directly (or to all nearby) before proceeding to Equipment Staging. Speaking does not advance the phase.</p></div>` : "";
    return `<aside class="communications-surface" data-testid="q4-communications"><header><div><p class="eyebrow">COMMUNICATIONS</p><h2>One chronological channel record</h2></div><span class="channel-state" data-radio-state="${escape(standard.state ?? "unavailable")}">${escape(standardState)}</span></header><section class="compact-team" data-testid="q4-team-status"><h3>Immediate team condition</h3>${roster}</section><ol class="communication-timeline" aria-label="Chronological communication history">${timeline}</ol><form id="q4-comms-form" data-testid="q4-comms-form"><div class="mechanical-channel-selector" data-channel-current="${radioReady ? "standard" : "local"}"><div class="mechanical-channel-switch" role="group" aria-label="Channel toggle"><span class="switch-slot switch-standard ${standardSelected ? "active" : ""}">STANDARD</span><span class="switch-track" aria-hidden="true">${standardSelected ? "[■■□□]" : "[□□■■]"}</span><span class="switch-slot switch-local ${localSelected ? "active" : ""}">LOCAL</span></div><label class="channel-select-label">Channel<select name="channel" data-testid="q4-channel"><option value="local" ${localDisabled} ${localSelected}>LOCAL · nearby personnel (${escape(localState)})</option><option value="standard" ${standardDisabled} ${standardSelected}>STANDARD · operations desk (${escape(standardState)})</option></select></label></div><p class="channel-explanation">LOCAL is heard by all nearby participating personnel. STANDARD is a radio transmission; delivery and acknowledgment are recorded separately.</p><label class="q4-composer">Message<input name="text" autocomplete="off" placeholder="Compose your own speech or transmission" ${composerDisabled ? "disabled" : ""}></label><div class="comms-form-actions"><button type="submit" ${composerDisabled ? "disabled" : ""}>Submit transmission</button>${checkInBtn}</div></form><p class="comms-state"><span data-channel-state="local">${escape(localState)}</span><span data-channel-state="standard">${escape(standardState)}</span></p></aside>`;
  };
  const communicationConsole = (projection, disabled = false) => {
    const channels = projection.q4?.channels ?? {}; const local = channels.local ?? {}; const standard = channels.standard ?? {};
    const broadcast = projection.q4?.facility_broadcast;
    const isBroadcastActive = Boolean(broadcast && broadcast.visible && broadcast.status === "in-progress");
    const isBriefingActive = projection.phase?.phase_id === "BRIEFING" && isBroadcastActive && !projection.briefing_feed_completed;
    const broadcastMsg = (broadcast && broadcast.status !== "standby" && broadcast.text) ? [{
      channel: "FACILITY BROADCAST",
      speaker: broadcast.speaker ?? "DR. KIRK MAXWELL",
      text: broadcast.text,
      order: -1,
      isBroadcast: true
    }] : [];
    const messages = [...broadcastMsg, ...(local.history ?? []).map((item, index) => ({ ...item, channel:"LOCAL", order:item.at ?? item.sent_at ?? index })), ...(standard.history ?? []).map((item, index) => ({ ...item, channel:"STANDARD", order:item.at ?? item.sent_at ?? index }))].sort((a, b) => Number(a.order) - Number(b.order)).slice(-30);
    const timeline = messages.length ? messages.map((item) => {
      if (item.isBroadcast || item.channel === "FACILITY BROADCAST") {
        return `<li class="communication-message channel-facility-broadcast" data-channel="facility-broadcast"><span class="message-channel">FACILITY BROADCAST</span><div><span class="comm-speaker comm-broadcast-speaker">${escape(item.speaker ?? "FACILITY BROADCAST")}:</span> <span class="comm-text comm-broadcast-text">${escape(item.text)}</span></div>${badge("FACILITY FEED")}</li>`;
      }
      const isLocal = item.channel === "LOCAL";
      const speaker = item.speaker === "You" ? (isLocal ? "YOU" : "EXPEDITION LEAD") : (item.speaker ?? item.targets?.[0] ?? "Record");
      const targetText = isLocal && item.targets?.[0] && item.speaker === "You" ? ` → ${escape(item.targets[0])}` : "";
      const textClass = isLocal ? "comm-spoken" : "comm-radio-body";
      const responseText = item.coworker_response ?? item.response;
      const responseSpeaker = item.response_speaker ?? item.coworker ?? (isLocal ? (item.targets?.[0] ?? "Coworker") : "STANDARD DESK");
      const quote = (txt) => isLocal ? `“${escape(txt)}”` : escape(txt);
      return `<li class="communication-message channel-${String(item.channel).toLowerCase()}" data-channel="${String(item.channel).toLowerCase()}"><span class="message-channel">${!isLocal ? `<span class="standard-channel-marker" aria-hidden="true">●</span> ` : ""}${escape(item.channel)}</span><div><span class="comm-speaker ${isLocal ? "comm-local-speaker" : "comm-radio-callsign"}">${escape(speaker)}${targetText}:</span> <span class="comm-text ${textClass}">${isLocal ? quote(item.text ?? item.result ?? "No detail recorded.") : `[TX] ${escape(item.text ?? item.result ?? "No detail recorded.")}`}</span>${responseText ? `<div class="comm-response ${isLocal ? "comm-local-response" : "comm-radio-rx"}"><span class="comm-speaker ${isLocal ? "comm-coworker-speaker" : "comm-radio-callsign"}">${escape(responseSpeaker)}:</span> <span class="comm-text ${textClass}">${isLocal ? quote(responseText) : `[RX] ${escape(responseText)}`}</span></div>` : ""}</div>${item.delivery ? badge(item.delivery) : item.delivery_status ? `<span class="badge badge-acknowledged">${escape(item.delivery_status)}</span>` : ""}</li>`;
    }).join("") : (isBriefingActive ? `<li class="empty broadcast-active-notice">FACILITY BROADCAST IN PROGRESS · PROJECTOR 01 ACTIVE</li>` : `<li class="empty">No communication has been recorded in this operation.</li>`);
    const radioReady = projection.phase?.phase_id === "STANDARD_RADIO_CHECK";
    const composerDisabled = disabled || (!local.available && !standard.available);
    const localDisabled = disabled ? "disabled" : "";
    const standardDisabled = disabled || (!standard.available && !radioReady) ? "disabled" : "";
    const standardSelected = radioReady ? "selected" : "";
    const localSelected = radioReady ? "" : "selected";
    const localState = isBriefingActive ? "broadcast in progress" : local.available ? (local.targets ?? []).join(", ") || "team" : (local.unavailable_reason ?? "unavailable");
    const standardState = standard.state_label ?? (standard.available ? "CHANNEL READY" : "UNAVAILABLE");
    const radioEquipment = (projection.q4?.equipment?.required ?? []).find((item) => item.category === "field-radio");
    const radioBattery = radioEquipment?.consumable?.remaining;
    const radioBatteryText = radioBattery !== undefined && radioBattery !== "Unknown" ? String(radioBattery) : null;
    const radioBatteryHtml = radioBatteryText !== null ? (Number(radioBatteryText) === 0 ? `<span class="badge badge-depleted" aria-label="Radio battery depleted">◉ DEPLETED</span>` : `<span class="radio-battery-indicator" aria-label="Radio battery: ${escape(radioBatteryText)} charges remaining">◉ ${escape(radioBatteryText)}</span>`) : "";
    const addressableTeam = (projection.q4?.team ?? []).filter((m) => !m.controlled && m.local_eligible);
    const targetSelector = addressableTeam.length > 0 ? `<label class="channel-select-label channel-target-label">To<select name="target" form="q4-comms-form" data-testid="q4-comms-target" ${radioReady || isBriefingActive ? "disabled" : ""}><option value="">— broadcast to all nearby —</option>${addressableTeam.map((m) => `<option value="${escape(m.first_name ?? m.display_name ?? "")}">${escape(String(m.display_name ?? "").replace(/ · YOU$/, ""))}</option>`).join("")}</select></label>` : "";
    const checkInButton = radioReady ? `<button type="button" class="action-button radio-check-in-button" data-q4-check-in="true" ${standardDisabled}>Hold for Standard Check-In (2s)</button>` : "";
    const localNotice = (!isBriefingActive && projection.phase?.phase_id === "BRIEFING" && local.available) ? `<div class="local-communication-notice"><div class="eyebrow">LOCAL COMMUNICATION</div><p>Address assigned coworkers directly (or to all nearby) before proceeding to Equipment Staging. Speaking does not advance the phase.</p></div>` : "";
    const composerPlaceholder = isBriefingActive ? "Facility broadcast in progress..." : "Speak locally or transmit to Standard";
    return `<aside class="eti-comms communications-surface" data-testid="q4-communications"><header><p class="eyebrow">STANDARD // LOCAL</p><div class="comms-header-status"><span class="channel-state" data-radio-state="${escape(standard.state ?? "unavailable")}">${escape(standardState)}</span>${radioBatteryHtml}</div></header><div class="mechanical-channel-selector" data-channel-current="${radioReady ? "standard" : "local"}"><div class="mechanical-channel-switch" role="group" aria-label="Channel toggle"><span class="switch-slot switch-standard ${standardSelected ? "active" : ""}">STANDARD</span><span class="switch-track" aria-hidden="true">${standardSelected ? "[■■□□]" : "[□□■■]"}</span><span class="switch-slot switch-local ${localSelected ? "active" : ""}">LOCAL</span></div><div class="channel-routing-controls"><label class="channel-select-label">Address<select name="channel" form="q4-comms-form" data-testid="q4-channel"><option value="local" ${localDisabled} ${localSelected}>LOCAL — nearby team</option><option value="standard" ${standardDisabled} ${standardSelected}>STANDARD — operations desk</option></select></label>${targetSelector}</div></div><ol class="communication-timeline" aria-label="Unified chronological communication history">${timeline}</ol><div class="comms-guidance"><p class="channel-explanation">LOCAL is heard by all nearby participating personnel. STANDARD is a radio transmission; delivery and acknowledgment are recorded separately.</p>${localNotice}</div><form id="q4-comms-form" data-testid="q4-comms-form"><label class="comms-input-label">Enter Coms Message<input name="text" autocomplete="off" placeholder="${composerPlaceholder}" ${composerDisabled ? "disabled" : ""}></label><button type="submit" ${composerDisabled ? "disabled" : ""}>Send</button>${checkInButton}</form><p class="comms-state"><span data-channel-state="local">LOCAL: ${escape(localState)}</span><span data-channel-state="standard">STANDARD: ${escape(standardState)}</span></p></aside>`;
  };
  const teamRail = (projection) => {
    const q4 = projection.q4 ?? {}; const player = q4.player ?? {}; const team = q4.team ?? [];
    const rows = team.map((member) => {
      const contact = member.contact_state ?? member.contact_category ?? "UNCONFIRMED";
      const distance = member.controlled ? "SELF" : contact === "LOCAL" ? "WITHIN SPEAKING RANGE" : "DISTANCE UNCONFIRMED";
      const epistemicLabel = member.last_observed ? "Last Observed" : member.last_reported ? "Last Reported" : "Last Contact";
      const epistemicValue = member.last_observed ?? member.last_reported ?? member.last_contact;
      const epistemic = member.controlled ? "TEAM LEAD (YOU)" : epistemicValue ? `${epistemicLabel}: ${escape(epistemicValue)}` : "No confirmed contact";
      const epistemicClass = member.last_observed ? "epistemic-observed" : member.last_reported ? "epistemic-reported" : "epistemic-contact";
      return `<li><span class="portrait-slot badge-portrait-fallback" aria-hidden="true">${escape((member.first_name ?? "?")[0])}</span><div><strong>${escape(String(member.display_name ?? "Assigned personnel").replace(/ · YOU$/, ""))}</strong><small>${escape(distance)} · RADIO ${escape(contact)}</small><small>${escape(member.condition ?? "condition unconfirmed")} · <span class="personnel-epistemic ${epistemicClass}">${epistemic}</span></small></div></li>`;
    }).join("");
    return `<section class="eti-team" data-testid="eti-team"><h2>Team status</h2><ul>${rows || `<li class="empty">No assigned personnel record.</li>`}</ul><section class="eti-team-lead"><span class="eyebrow">TEAM LEAD</span><strong>${escape(player.name ?? "Controlled personnel")}</strong><small>${escape(player.role ?? "field researcher")} · Clearance ${escape(player.clearance ?? "Q4")}</small></section></section>`;
  };
  const equipmentRail = (projection) => {
    const gear = projection.q4?.equipment?.required ?? [];
    const rows = gear.map((item) => {
      const remaining = item.consumable?.remaining;
      const remainingDisplay = remaining !== undefined && remaining !== "Unknown" ? ` · ${escape(remaining)}` : "";
      return `<li><span class="rail-glyph equipment-glyph equipment-${escape(item.category ?? "field")}" aria-hidden="true">${item.category === "field-radio" ? "◉" : item.category === "35mm-camera" ? "▣" : item.category === "battery-lamp" ? "◌" : "＋"}</span><div><strong>${escape(item.label)}</strong><small>${escape(item.holder)} · ${escape(item.state)}${remainingDisplay}</small></div></li>`;
    }).join("");
    return `<section class="eti-equipment" data-testid="eti-equipment"><h2>Field kit</h2><ul>${rows || `<li class="empty">No field kit recorded.</li>`}</ul></section>`;
  };
  const objectiveRail = (projection) => {
    const q4 = projection.q4 ?? {};
    const objectives = q4.objectives ?? [];
    const progress = q4.mission_progress ?? {};
    const current = objectives.find((item) => item.status === "current") ?? objectives[0];
    const text = current?.next_requirement ?? current?.summary ?? q4.mission_record?.objective?.primary ?? q4.display_mission ?? "Await the next instruction from Standard.";
    return `<section class="eti-objective" data-testid="eti-objective"><p class="eyebrow">CURRENT EXPEDITION OBJECTIVE</p><strong>${escape(current?.name ?? q4.mission_record?.display_id ?? "Assigned field work")}</strong><p>${escape(text)}</p><small>${escape(progress.lifecycle_label ?? q4.mission_record?.status ?? projection.phase?.phase_id ?? "active")}</small></section>`;
  };
  const briefingWorkstation = (projection, options = {}) => {
    const defaultAction = `<footer class="eti-turn-controls"><section class="action-dock natural-action prefield-action" data-testid="prefield-primary"><div><p class="eyebrow">CURRENT DECISION</p><h2>BRIEFING PENDING</h2></div><button type="button" class="primary-action" disabled data-briefing-locked="true">BRIEFING PENDING</button><p>Standing by for assignment briefing.</p></section></footer>`;
    const actionDock = options.actionDock ?? defaultAction;
    return `<section class="eti-cockpit briefing-workstation" data-testid="async-operations-layout">${presentationEvents(projection)}<main class="eti-center briefing-center"><section class="eti-spatial" aria-label="Current spatial view">${layoutMap(projection)}</section></main>${actionDock}</section>`;
  };
  const expeditionCockpit = (projection, options = {}) => {
    const isOpener = isOpenerProjection(projection);
    const phaseId = projection.phase?.phase_id ?? "BRIEFING";
    if (phaseId === "BRIEFING" && isOpener) {
      return briefingWorkstation(projection, options);
    }
    const q4 = projection.q4 ?? {}; const fieldPhase = ["FIELD_OPERATION", "RETURN"].includes(projection.phase?.phase_id); const evidence = q4.evidence ?? [];
    const evidenceRows = evidence.map((item) => `<li data-view-media="${escape(item.id)}" class="clickable-evidence" title="Inspect in Spatial Display"><strong>${escape(item.type ?? "Field record")}</strong><small>${escape(item.storage ?? item.reporting_state ?? "retained")}</small></li>`).join("");
    const interactables = fieldPhase ? panel("Evidence and visible objects", list(q4.interactables, (object) => `<li class="interactable-card"><div><strong>${escape(object.name)}</strong><small>${escape(object.observation ?? object.condition)}</small></div><div class="object-actions"><button type="button" class="action-button" data-object-action="INSPECT" data-object-target="${escape(object.name)}">Inspect</button>${(object.actions ?? []).filter((action) => action.available).map((action) => `<button type="button" class="action-button" data-object-action="${escape(action.action)}" data-object-target="${escape(action.target)}">${escape(action.label)}</button>`).join("")}</div></li>`, "No authored object is visible from this position."), 'data-testid="field-interactables"') : "";
    const narration = options.scene?.narration ?? projection.scene?.narration ?? q4.field_observation ?? q4.briefing ?? "Observer-safe output is pending.";
    const rawPhase = options.phaseRecord ?? render(projection);
    const phaseRecord = rawPhase.replace(/<aside class="communications-surface[\s\S]*?<\/aside>/g, "").replace(/<details class="operational-map[\s\S]*?<\/details>/g, "");
    const readiness = q4.mission_progress?.return_readiness;
    const readinessState = readiness?.ready ? "READY TO CLOSE" : readiness?.route_available ? "RETURN ROUTE AVAILABLE" : "RETURN STATUS";
    const returnReadinessBar = projection.phase?.phase_id === "RETURN" && readiness ? `<div class="return-readiness-bar ${readiness.ready ? "return-ready" : "return-blocked"}" role="status" aria-live="polite"><span class="return-readiness-label">${escape(`${readinessState} — ${readiness.summary ?? "No return assessment is available."}`)}</span></div>` : "";
    return `<section class="eti-cockpit" data-testid="async-operations-layout">${presentationEvents(projection)}${returnReadinessBar}<aside class="eti-left-rail">${teamRail(projection)}${equipmentRail(projection)}${objectiveRail(projection)}</aside><main class="eti-center"><section class="eti-spatial" aria-label="Current spatial view">${layoutMap(projection)}</section><section class="eti-interpretive field-observation" data-testid="field-observation"><span class="sr-only">Current scene observation record</span><header><p class="eyebrow observation-eyebrow">OBSERVATION RECORD</p><strong>${escape(q4.current_location?.name ?? projection.phase?.phase_id ?? "Expedition record")}</strong><small>${escape(options.providerLabel ?? "CURRENT FIELD RECORD")}</small></header><div class="observation-prose-container"><p class="observation-prose">${escape(narration)}</p></div>${interactables}<details class="eti-phase-record"><summary>Expedition record and structured controls</summary>${phaseRecord}</details></section></main>${communicationConsole(projection, options.disabled)}<aside class="eti-evidence"><header><p class="eyebrow">EVIDENCE / MEDIA</p><span class="film-indicator">${evidence.length} RETAINED</span></header><ul>${evidenceRows || `<li class="empty">No evidence returned or recorded.</li>`}</ul></aside>${options.actionDock ?? ""}</section>`;
  };
  const equipmentList = (projection, optional = false, handoff = false) => list(projection.q4?.equipment?.[optional ? "optional" : "required"], (item) => `<li><strong><span class="equipment-mark" aria-hidden="true">${item.category === "field-radio" ? "◉" : item.category === "35mm-camera" ? "▣" : item.category === "battery-lamp" ? "◌" : "＋"}</span>${escape(item.label)}</strong><span>${escape(`${item.holder} · ${item.location}`)}</span>${badge(item.state)}<small>${escape(item.verification ?? "verification unknown")}${item.consumable?.remaining !== "Unknown" ? ` · ${escape(item.consumable?.kind ?? "condition")}: ${escape(item.consumable?.remaining ?? "known")}` : ""}</small>${optional ? `<button type="button" class="action-button" data-q4-store="${escape(item.ref)}" data-testid="select-store-${escape(item.ref)}">Select for kit</button>` : handoff && item.available ? `<button type="button" class="action-button" data-q4-handoff="${escape(item.ref)}" data-q4-handoff-target="${item.holder === "You" ? "" : "player"}" data-testid="handoff-${escape(item.ref)}">${item.holder === "You" ? "Hand to teammate" : "Take custody"}</button>` : ""}</li>`, optional ? "No optional stores are currently listed." : "No required field equipment is currently listed.");
  const logisticsButton = (item, action, compact = false) => `<button type="button" class="logistics-action ${compact ? "logistics-primary-action" : ""}" data-logistics-action="${escape(action.action)}" data-logistics-item="${escape(item.id)}" data-logistics-holder="${escape(action.target_holder ?? "")}" data-logistics-container="${escape(action.target_container ?? "")}" data-logistics-source="${escape(action.source_item_id ?? "")}" ${action.available ? "" : "disabled"} title="${escape(action.unavailable_reason ?? actionLabel(action.action))}" aria-label="${escape(`${actionLabel(action.action)} ${item.label}${action.unavailable_reason ? `. ${action.unavailable_reason}` : ""}`)}">${escape(actionLabel(action.action))}</button>`;
  const inventorySurface = (projection) => {
    const inventory = projection.q4?.inventory; if (!inventory) return empty("The authoritative inventory record is unavailable."); const loadout = inventory.loadout ?? {};
    const items = list(inventory.items, (item) => { const available = (item.actions ?? []).filter((action) => action.available); const quick = available.slice(0, 6).map((action) => logisticsButton(item, action, true)).join(""); const all = (item.actions ?? []).map((action) => logisticsButton(item, action)).join(""); const quantity = item.charges !== null && item.charges !== undefined ? `${item.charges} charges` : item.quantity !== null && item.quantity !== undefined ? `quantity ${item.quantity}` : "supply unconfirmed"; return `<li class="inventory-item"><header><div><strong>${escape(item.label)}</strong><span>${escape(`${item.holder} · ${item.container ?? item.location ?? "location unconfirmed"}`)}</span></div>${badge(item.condition)}</header><small>${escape(`${title(item.loadout_status)} · ${item.equipped ? "Equipped" : "Not equipped"} · ${quantity} · ${item.accessibility}`)}</small>${item.institutional_restriction ? `<p class="restriction-note">Institutional restriction: ${escape(item.institutional_restriction)}</p>` : ""}<div class="context-action-menu" role="toolbar" aria-label="Quick actions for ${escape(item.label)}">${quick || `<span class="empty">No immediate action.</span>`}</div><details class="inventory-action-list"><summary>All item actions and unavailable reasons</summary><div class="action-grid">${all}</div></details></li>`; }, "No issued items are recorded.");
    const containers = list(inventory.containers, (container) => `<li class="inventory-container"><header><strong>${escape(container.name)}</strong>${badge(container.lost ? "lost" : container.open ? "open" : "closed")}</header><span>${escape(`${container.holder ?? "No confirmed holder"} · ${container.location ?? "location unconfirmed"}`)}</span><small>${escape(`${container.used} of ${container.capacity} capacity · ${container.accessible ? "accessible" : "not accessible"}`)}</small>${container.contents?.length ? `<p>Contents: ${escape(container.contents.join(", "))}</p>` : `<p class="empty">Contents unavailable or empty.</p>`}<div class="action-grid">${(container.actions ?? []).map((action) => `<button type="button" class="logistics-action" data-logistics-action="${escape(action.action)}" data-logistics-container-id="${escape(container.id)}" ${action.available ? "" : "disabled"} title="${escape(action.unavailable_reason ?? actionLabel(action.action))}" aria-label="${escape(`${actionLabel(action.action)} ${container.name}${action.unavailable_reason ? `. ${action.unavailable_reason}` : ""}`)}">${escape(actionLabel(action.action))}</button>`).join("")}</div></li>`, "No container is recorded.");
    return `<section class="inventory-surface" data-testid="full-inventory" aria-labelledby="inventory-heading"><header><div><p class="eyebrow">FIELD LOGISTICS</p><h3 id="inventory-heading">Inventory and containers</h3></div>${badge(loadout.ready ? "loadout ready" : "loadout incomplete")}</header>${loadout.missing?.length ? `<p class="restriction-note">Missing requirement: ${escape(loadout.missing.join(", "))}${loadout.waiver_allowed ? "; degraded deployment may be recorded." : "."}</p>` : ""}${loadout.restrictions?.length ? `<p class="restriction-note">Current restriction: ${escape(loadout.restrictions.join(", "))}</p>` : ""}${list(loadout.recommendations, (item) => `<li>${escape(item)}</li>`, "No additional loadout recommendation.")}<h4>Items</h4>${items}<h4>Containers</h4>${containers}</section>`;
  };
  const institutionSurface = (projection) => { const state = projection.q4?.institution; if (!state) return ""; const career = projection.q4?.career ?? {}; const dimensions = state.dimensions ?? {}; return panel("Standard posture", `<dl class="institution-dimensions"><div><dt>Support</dt><dd>${escape(title(dimensions.support_posture ?? "routine"))}</dd></div><div><dt>Scrutiny</dt><dd>${escape(title(dimensions.scrutiny_level ?? "routine"))}</dd></div><div><dt>Information confidence</dt><dd>${escape(title(dimensions.information_confidence ?? "uncertain"))}</dd></div><div><dt>Equipment issue</dt><dd>${escape(title(dimensions.equipment_restriction_level ?? "none"))}</dd></div></dl>${list(career.recent_updates, (item) => `<li><strong>Institutional update</strong><span>${escape(item.summary)}</span></li>`, "No between-operation update is recorded.")}${list(state.recent_decisions, (item) => `<li><strong>${escape(title(item.decision))}</strong><span>${escape(item.public_response)}</span></li>`, "No new instruction has been delivered.")}${list(state.follow_up_assignments, (item) => `<li><strong>${escape(item.display_name)}</strong><span>${escape(item.public_summary)}</span>${badge(item.status)}</li>`, "No follow-up assignment is available.")}`, 'data-testid="institutional-response"'); };
  const layoutMap = (projection, activeMedia = projection?.activeMedia ?? null) => {
    const phaseId = projection.phase?.phase_id ?? "BRIEFING";
    const isPrefield = ["BRIEFING", "STAGING", "FACILITY_TRANSIT", "THRESHOLD", "STANDARD_RADIO_CHECK"].includes(phaseId);
    const mode = activeMedia ? "media" : (isPrefield ? "facility" : "field-survey");

    if (mode === "media") {
      const item = activeMedia;
      const displayStatus = item.render?.status ?? "ready";
      return `<details class="operational-map survey-map spatial-visual-display media-mode" data-testid="operational-map" data-display-mode="media" open><summary>Spatial / Visual Display · Media Playback</summary><p class="map-knowledge-note">Institutional media playback · Telemetry verification · ${escape(item.type ?? "RECORD")}</p><div class="media-display-surface"><header class="media-display-header"><div><strong>${escape(item.id ?? "EVIDENCE-RECORD")}</strong><span>${escape(item.type ?? "Visual telemetry")} · Observer: ${escape(item.observer ?? "FIELD PERSONNEL")}</span></div>${badge(displayStatus)}</header><div class="media-display-body">${item.visual?.artifact_url ? `<img class="media-artifact-frame" src="${escape(item.visual.artifact_url)}" alt="${escape(item.type ?? "Visual evidence")}">` : `<div class="media-crt-raster" role="img" aria-label="Archival telemetry raster"><p class="media-telemetry-text">ARCHIVAL RASTER PREVIEW<br><small>OBSERVER: ${escape(item.observer ?? "FIELD PERSONNEL")} · DEVICE: ${escape(item.device ?? "OPTICAL")} · T+${escape(item.time?.interval ?? 0)}</small></p></div>`}</div><footer class="media-display-footer"><button type="button" class="action-button" data-spatial-mode="exit-media">Return to Spatial Display</button></footer></div></details>`;
    }

    if (mode === "facility") {
      const facilityNodes = [
        { id: "maintenance-wing", name: "Maintenance Wing", x: 80, y: 165, desc: "Circulation and machinery access" },
        { id: "async-briefing-room", name: "Lower Offices / Briefing", x: 195, y: 165, desc: "Administrative records and briefing" },
        { id: "equipment-staging", name: "Hazmat / Staging", x: 310, y: 165, desc: "Equipment issue and suit lockers" },
        { id: "control-observation", name: "KV31 Control Room", x: 435, y: 75, desc: "Observation window overlooking LPMDS" },
        { id: "threshold-room", name: "Threshold Chamber (LPMDS)", x: 435, y: 195, desc: "Primary machine hall and dimensional boundary" },
        { id: "threshold-side-entry", name: "KV31 Outpost", x: 565, y: 195, desc: "Protected ASync workplace beyond Threshold" }
      ];

      const currentFacilityId = phaseId === "BRIEFING" ? "async-briefing-room" :
        phaseId === "STAGING" ? "equipment-staging" :
        phaseId === "FACILITY_TRANSIT" ? "maintenance-wing" :
        phaseId === "STANDARD_RADIO_CHECK" ? "threshold-room" :
        phaseId === "THRESHOLD" ? "threshold-room" : "async-briefing-room";

      const nodeSvg = facilityNodes.map((node) => {
        const isCurrent = node.id === currentFacilityId;
        const cls = `facility-node ${isCurrent ? "map-current-node" : "map-async-node"}`;
        const marker = isCurrent ? `<text class="you-label" x="${node.x}" y="${node.y - 14}" text-anchor="middle">YOU</text>` : "";
        return `<g class="${cls}" data-node-id="${escape(node.id)}"><circle cx="${node.x}" cy="${node.y}" r="${isCurrent ? 7 : 5}"></circle>${marker}<text x="${node.x}" y="${node.y + 16}" text-anchor="middle">${escape(node.name)}</text></g>`;
      }).join("");

      const facilityEdges = [
        ["async-briefing-room", "maintenance-wing"],
        ["maintenance-wing", "equipment-staging"],
        ["equipment-staging", "control-observation"],
        ["equipment-staging", "threshold-room"],
        ["control-observation", "threshold-room"],
        ["threshold-room", "threshold-side-entry"]
      ];

      const byId = new Map(facilityNodes.map((n) => [n.id, n]));
      const edgeSvg = facilityEdges.map(([fromId, toId]) => {
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (!from || !to) return "";
        const isThresholdLink = (fromId === "threshold-room" && toId === "threshold-side-entry") || (toId === "threshold-room" && fromId === "threshold-side-entry");
        return `<line class="facility-edge ${isThresholdLink ? "operational-edge-interlock" : ""}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
      }).join("");

      const interlock = projection.q4?.interlock;
      const interlockStatus = interlock ? `South: ${interlock.south_barrier?.state?.toUpperCase() ?? "OPEN"} · East: ${interlock.east_blast_door?.state?.toUpperCase() ?? "SEALED"}` : "Interlock: Unmonitored";

      return `<details class="operational-map survey-map spatial-visual-display facility-mode" data-testid="operational-map" data-display-mode="facility" open><summary>Spatial / Visual Display · Facility Schematic</summary><p class="map-knowledge-note">High institutional confidence · Controlled facility geography · Lower Sector · ${escape(interlockStatus)} · <span class="echomapping-disabled-indicator">ECHOMAPPING DISABLED IN STANDARD</span></p><svg role="img" aria-labelledby="facility-map-title facility-map-description" viewBox="0 0 650 330" preserveAspectRatio="xMidYMid meet"><title id="facility-map-title">ASync Facility Schematic centered on ${escape(byId.get(currentFacilityId)?.name ?? "current sector")}</title><desc id="facility-map-description">Controlled facility engineering schematic showing Maintenance Wing, Briefing, Staging, KV31 Control, and Threshold Chamber.</desc><rect x="5" y="5" width="640" height="320" fill="none" stroke="var(--async-line)" stroke-dasharray="2 4" opacity="0.4"></rect>${edgeSvg}${nodeSvg}<text class="facility-ingress" x="22" y="304">ASYNC RESEARCH FACILITY · SECTOR B1</text></svg><div class="operational-map-record"><section><h3>Current Sector</h3><p><strong>${escape(byId.get(currentFacilityId)?.name ?? "Controlled Sector")}</strong><br><small>${escape(byId.get(currentFacilityId)?.desc ?? "Authorized workplace")}</small></p></section><section><h3>Circulation</h3><p>Controlled personnel transit only.<br><small>Level 0 / Sub-level 1 infrastructure</small></p></section><section class="operational-map-legend-box"><details class="map-legend-details" open><summary>Map Legend</summary><ul class="map-legend"><li><strong>●</strong><span>Current location (YOU)</span></li><li><strong>○</strong><span>Controlled facility node</span></li><li><strong>═</strong><span>Observation / Threshold link</span></li></ul></details></section></div></details>`;
    }

    // FIELD SURVEY MODE (Complex field map)
    const map = projection.q4?.map ?? {}; const sourceNodes = map.nodes ?? []; const complexSide = sourceNodes.some((node) => node.current && !String(node.type ?? "").startsWith("controlled-")); const visibleNodes = complexSide ? sourceNodes.filter((node) => !String(node.type ?? "").startsWith("controlled-")) : sourceNodes;
    const xValues = visibleNodes.map((node) => Number(node.coordinates?.x ?? 0)); const yValues = visibleNodes.map((node) => Number(node.coordinates?.y ?? 0)); const minX = Math.min(...xValues, 0), maxX = Math.max(...xValues, 1), minY = Math.min(...yValues, 0), maxY = Math.max(...yValues, 1);
    const scale = (value, low, high, size, padding) => high === low ? size / 2 : padding + ((value - low) / (high - low)) * (size - padding * 2);
    const nodes = visibleNodes.map((node) => ({ ...node, coordinates: { ...node.coordinates, x: scale(Number(node.coordinates?.x ?? 0), minX, maxX, 650, 80), y: scale(Number(node.coordinates?.y ?? 0), minY, maxY, 330, 60) } })); const edges = (map.edges ?? []).filter((edge) => !complexSide || !String(edge.from ?? "").startsWith("async-") && !["equipment-staging", "threshold-approach", "threshold-room", "threshold-side-entry"].includes(edge.from)); const byId = new Map(nodes.map((node) => [node.id, node]));
    const edgeMarkup = edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to)).map((edge) => {
      const from = byId.get(edge.from), to = byId.get(edge.to);
      const isInferred = edge.status === "inferred" || edge.inferred;
      return `<line class="operational-edge ${edge.blocked ? "map-blocked" : ""} ${isInferred ? "map-inferred" : ""}" x1="${escape(from.coordinates?.x ?? 0)}" y1="${escape(from.coordinates?.y ?? 0)}" x2="${escape(to.coordinates?.x ?? 0)}" y2="${escape(to.coordinates?.y ?? 0)}"><title>${escape(edge.relationship ?? "confirmed route")}</title></line>`;
    }).join("");
    const nodeMarkup = nodes.map((node) => {
      const personnel = node.personnel ?? [];
      const isCurrent = Boolean(node.current);
      const isVisited = Boolean(node.visited || node.visited_this_expedition);
      const nodeClass = isCurrent ? "map-current-node node-observed-now" : isVisited ? "map-visited-node node-visited-expedition" : "map-async-node node-inherited-async";
      return `<g class="operational-node ${nodeClass}" transform="translate(${escape(node.coordinates?.x ?? 0)} ${escape(node.coordinates?.y ?? 0)})"><circle r="${node.current ? 12 : 8}"></circle><text y="-17" text-anchor="middle">${escape(node.name)}</text>${node.current ? `<text y="4" text-anchor="middle" class="you-label">YOU</text>` : ""}${personnel.length > 1 ? `<text y="25" text-anchor="middle" class="team-label">TEAM · ${escape(personnel.length)}</text>` : ""}<title>${escape(`${node.name}; ${node.status}; ${personnel.map((person) => person.name).join(", ") || "no personnel marker"}`)}</title></g>`;
    }).join("");
    const current = nodes.find((node) => node.current); const direction = (label) => ({ WEST:[-70,0], EAST:[70,0], NORTH:[0,-60], SOUTH:[0,60], SOUTHEAST:[55,50], SOUTHWEST:[-55,50], NORTHEAST:[55,-50], NORTHWEST:[-55,-50] })[String(label).split(" ")[0]] ?? [45,45]; const frontierMarkup = (map.unresolved_exits ?? []).map((item) => { if (!current) return ""; const [dx, dy] = direction(item.label); const x = Number(current.coordinates.x) + dx, y = Number(current.coordinates.y) + dy; return `<g class="operational-frontier"><line x1="${escape(current.coordinates.x)}" y1="${escape(current.coordinates.y)}" x2="${escape(x)}" y2="${escape(y)}"></line><rect x="${escape(x - 7)}" y="${escape(y - 7)}" width="14" height="14"></rect><text x="${escape(x)}" y="${escape(y + 22)}" text-anchor="middle">?</text><title>${escape(item.label)}</title></g>`; }).join("");
    const unresolved = (map.unresolved_exits ?? []).map((item) => `<li><strong>?</strong><span>${escape(item.label)}</span>${badge(item.status)}</li>`).join("");
    const route = (map.route_history ?? []).slice(-5).map((step) => `<li><span>${escape(byId.get(step.from)?.name ?? step.from)} → ${escape(byId.get(step.to)?.name ?? step.to)}</span><small>T+${escape(step.at)}</small></li>`).join("");
    const colorKeyItems = `<li><strong class="legend-key-green">● Green</strong><span>Immediately observed locale</span></li><li><strong class="legend-key-cream">● Cream</strong><span>Visited this expedition</span></li><li><strong class="legend-key-blue">● Light Blue</strong><span>Institutionally inherited / ASYNC map</span></li><li><strong class="legend-key-dotted">╌ Dotted</strong><span>Inferred connection</span></li>`;
    const legend = (map.legend ?? []).map((item) => `<li><strong>${escape(item.code)}</strong><span>${escape(item.meaning)}</span></li>`).join("");
    return `<details class="operational-map survey-map spatial-visual-display field-survey-mode" data-testid="operational-map" data-display-mode="field-survey" open><summary>Spatial / Visual Display · Complex Survey · Field map · observer record</summary><p class="map-knowledge-note">${complexSide ? "Facility ingress condensed · Complex-side knowledge only · KV31 Origin" : "Observer record · discovered space only"}</p><svg role="img" aria-labelledby="operational-map-title operational-map-description" viewBox="0 0 650 330" preserveAspectRatio="xMidYMid meet"><title id="operational-map-title">Operational map centered on ${escape(current?.name ?? "the current location")}</title><desc id="operational-map-description">${escape(`${nodes.length} mapped locations, ${edges.length} recorded connections, ${(map.unresolved_exits ?? []).length} unresolved exits.`)}</desc>${edgeMarkup}${frontierMarkup}${nodeMarkup}${complexSide ? `<text class="facility-ingress" x="22" y="304">← FACILITY INGRESS</text>` : ""}</svg><div class="operational-map-record"><section><h3>Unresolved exits</h3><ul class="data-list">${unresolved || "<li>None currently observed.</li>"}</ul></section><section><h3>Recent route</h3><ul class="data-list">${route || "<li>No field movement recorded.</li>"}</ul></section><section class="operational-map-legend-box"><details class="map-legend-details" open><summary>Map Color Key</summary><ul class="map-legend map-color-key-list">${colorKeyItems}${legend}</ul></details></section></div></details>`;
  };
  function reportSurface(projection) {
    const q4 = projection.q4 ?? {};
    const mission = q4.mission_record ?? {};
    const team = q4.team ?? [];
    const evidence = q4.evidence ?? [];

    const teamList = list(team, (member) => `<li><strong>${escape(String(member.display_name ?? "").replace(/ · YOU$/, ""))}</strong><span>${escape(String(member.role ?? "assigned personnel").replace(/ · YOU$/, ""))}${member.controlled ? " · TEAM LEAD (YOU)" : " · COWORKER"}</span>${badge(member.condition ?? "accounted")}</li>`, "No team personnel recorded.");

    const evidenceList = list(evidence, (item) => `<li><strong>${escape(item.type)}</strong><span>ID: ${escape(item.id)} · storage: ${escape(item.storage ?? "surrendered to archive")}</span>${badge(item.custody?.state ?? "in custody")}${item.measurement ? `<small>Measurement: ${escape(item.measurement.value)} ${escape(item.measurement.unit ?? "")}</small>` : ""}</li>`, "No physical field evidence recovered.");

    return `<div class="mode-surface report-surface" data-testid="surface-clear-q4-report"><header class="report-header"><p class="eyebrow">ASYNC PROTOCOL KV31-C · EVIDENCE CUSTODY &amp; REPORT INTAKE</p><h1>Post-Expedition Intake &amp; Written Report</h1><div class="report-notices"><p class="report-status-notice" data-placeholder-id="THRESHOLD_RETURN_1_TO_4"><strong>RETURN TO STANDARD CONFIRMED:</strong> The field team has returned through the Threshold. Environmental decontamination and personnel accountability procedures have concluded.</p><p class="report-custody-notice"><strong>PHYSICAL EVIDENCE IN CUSTODY:</strong> All returned measurement instrumentation, media plates, physical specimens, and logs have been transferred to institutional custody and logged into the archive.</p><p class="report-requirement-notice"><strong>WRITTEN REPORT MANDATE:</strong> ASync requires the Team Lead to enter an official written account of events, field observations, and anomalies encountered before administrative debriefing.</p><p class="report-epistemic-disclaimer">Official Record Notice: The submitted report constitutes the observer's personal account and claim. It is preserved as subjective testimony and does not establish institutional ground truth until corroborated against surrendered evidence.</p></div></header><div class="report-grid">${panel("Accountable Personnel", teamList, 'data-testid="report-personnel"')}${panel("Surrendered Evidence in Custody", evidenceList, 'data-testid="report-evidence"')}${panel("Expedition Assignment", `<p><strong>${escape(mission.display_id ?? mission.id ?? "Assigned expedition")}</strong></p><p>${escape(mission.objective?.primary ?? q4.display_mission ?? "Field operation")}</p>`, 'data-testid="report-assignment"')}</div></div>`;
  }
  function reviewSurface(projection) {
    const review = projection.q4?.review;
    const writtenReport = review?.written_report ?? projection.q4?.written_report;
    const assessment = review?.institutional_findings?.reference_assessment ?? writtenReport?.institutional_assessment;
    const archive = projection.q4?.archive ?? { records: [], contradictions: [] };
    const returnedEvidence = (review?.evidence && review.evidence.length) ? review.evidence : (projection.q4?.evidence && projection.q4.evidence.length) ? projection.q4.evidence : (archive.records ?? []);

    const notice = (projection.end_of_shift_notice || projection.aeot_inspection) ? `<section class="panel end-of-shift-notice-card" data-testid="end-of-shift-notice" data-placeholder-id="END_OF_SHIFT_NOTICE"><div class="notice-badge">END OF SHIFT</div><h2>JULY 17, 1991</h2><div class="notice-details"><p><strong>EXPEDITION RECORD COMMITTED</strong></p><p>NO FURTHER ASSIGNMENT ISSUED</p><p>AEOT RECORDS REMAIN AVAILABLE</p></div><div class="notice-actions"><button type="button" class="action-button export-report-button" data-export-report-pdf="true" data-testid="button-export-report-pdf">Export Report (PDF)</button><span class="notice-footnote">Day One operations concluded. All returned equipment, photographs, and institutional records remain inspectable.</span></div></section>` : "";

    const reportCard = `<section class="panel debrief-written-report-card" data-testid="debrief-written-report"><header class="written-report-header"><div class="eyebrow">OBSERVER TESTIMONY · CLAIM</div><h2>WRITTEN EXPEDITION REPORT</h2><span class="report-meta">Author: ${escape(writtenReport?.author ?? "TEAM LEAD (YOU)")} · Kind: ${escape(writtenReport?.kind ?? "player-authored-claim")}</span></header><div class="written-report-body"><p>${escape(writtenReport?.text ?? "No written report statement entered.")}</p></div><div class="epistemic-disclaimer"><small>Observer statement under Protocol KV31-C. Represents subjective claim and belief; does not establish institutional ground truth.</small></div><div class="report-card-actions"><button type="button" class="action-button export-report-button" data-export-report-pdf="true" data-testid="button-export-report-pdf-report">Export Report (PDF)</button></div></section>`;

    const evidenceItems = list(returnedEvidence, (item) => {
      const render = item.render_presentation ?? {};
      const displayStatus = render.artifact_available || render.status !== "ready" ? (render.status ?? item.render_status ?? "not-rendered") : "unavailable";
      const visual = render.artifact_available ? `<img class="evidence-media-artifact" src="${escape(render.artifact_url)}" alt="${escape(item.fallback?.alt ?? `${item.type} ${item.id}`)}">` : render.status ? `<div class="evidence-media-fallback" role="img" aria-label="${escape(item.fallback?.alt ?? "Generated visual presentation unavailable")}">${escape(item.fallback?.label ?? "Generated visual presentation unavailable")}</div>` : "";
      const retry = ["failed", "fallback", "unavailable"].includes(displayStatus) ? `<button type="button" class="action-button" data-evidence-render="${escape(item.id)}" data-evidence-retry="true">Retry render</button>` : displayStatus === "not-rendered" ? `<button type="button" class="action-button" data-evidence-render="${escape(item.id)}">Render presentation</button>` : "";
      const measurementText = item.measurement ? ` · ${escape(item.measurement.kind)}: ${escape(item.measurement.value)} ${escape(item.measurement.unit ?? "")}` : "";
      return `<li class="evidence-archive-record"><strong>${escape(item.type)}</strong><span>ID: ${escape(item.id)}${measurementText}</span>${badge(item.custody?.state ?? "archived")}${render.status ? badge(displayStatus) : ""}<small>Custodian: ${escape(item.custodian ?? item.operator ?? "institutional custody")} · standard available: ${item.standard_available ? "YES" : "NO"}</small>${visual}${retry}</li>`;
    }, "No returned physical evidence logged in institutional custody.");

    const evidenceCard = `<section class="panel debrief-evidence-card" data-testid="debrief-returned-evidence"><header><div class="eyebrow">PHYSICAL ARCHIVE · MEASUREMENT</div><h2>RETURNED EVIDENCE IN CUSTODY</h2><span>Surrendered material &amp; telemetry</span></header>${evidenceItems}</section>`;

    const assessmentStatus = assessment?.status ?? review?.outcome ?? "pending-review";
    const assessmentConfidence = assessment?.confidence ?? "provisional";
    const assessmentSummary = assessment?.summary ?? review?.public_debrief_summary ?? "The institutional debriefing remains in progress.";
    const assessmentBasis = assessment?.basis;

    const basisRows = assessmentBasis ? `<dl class="findings-basis"><div><dt>Report ID</dt><dd>${escape(assessmentBasis.written_report_id ?? "NONE")}</dd></div><div><dt>Corroborating Evidence</dt><dd>${escape(assessmentBasis.evidence_ids?.join(", ") || "NONE")}</dd></div><div><dt>Prior Institutional Record</dt><dd>${escape(assessmentBasis.prior_record_ids?.join(", ") || "NONE")}</dd></div></dl>` : "";

    const findingsCard = `<section class="panel debrief-findings-card" data-testid="debrief-institutional-findings"><header class="findings-header"><div class="eyebrow">STANDARD ASSESSMENT · FINDINGS</div><h2>INSTITUTIONAL FINDINGS</h2><div class="findings-badges">${badge(assessmentStatus)}${badge(assessmentConfidence)}</div></header><div class="findings-summary"><p>${escape(assessmentSummary)}</p></div>${basisRows}<div class="findings-note"><small>Standard evaluates returned physical evidence and prior engineering records separately from observer testimony.</small></div></section>`;

    const outcomes = review?.assignment?.objective_outcomes ?? [];
    const objectiveOutcome = list(outcomes, (item) => `<li><strong>${escape(item.name)}</strong><span>${escape(item.kind)} objective</span>${badge(item.state)}</li>`, "No objective outcome is recorded.");
    const personnelList = list(review?.personnel, (item) => `<li><strong>${escape(item.display_name ?? item.identity)}</strong><span>${escape(item.status)}</span>${badge(item.last_contact ?? "recorded")}</li>`, "No personnel disposition is recorded.");
    const equipmentListDisposition = `${list(review?.equipment, (item) => `<li><strong>${escape(item.label)}</strong><span>${escape(item.status)} · ${escape(item.location ?? "location unknown")}</span></li>`, "No equipment disposition is recorded.")}${list(review?.containers, (item) => `<li><strong>${escape(item.name)}</strong><span>Container · ${escape(item.status)} · ${escape(item.location ?? "location unknown")}</span></li>`, "No container disposition is recorded.")}`;

    const archiveRows = list(archive.records, (item) => {
      const render = item.render_presentation ?? {};
      const displayStatus = render.artifact_available || render.status !== "ready" ? (render.status ?? item.render_status ?? "not-rendered") : "unavailable";
      const visual = render.artifact_available ? `<img class="evidence-media-artifact" src="${escape(render.artifact_url)}" alt="${escape(item.fallback?.alt ?? `${item.type} ${item.id}`)}">` : `<div class="evidence-media-fallback" role="img" aria-label="${escape(item.fallback?.alt ?? "Generated visual presentation unavailable")}">${escape(item.fallback?.label ?? "Generated visual presentation unavailable")}</div>`;
      const retry = ["failed", "fallback", "unavailable"].includes(displayStatus) ? `<button type="button" class="action-button" data-evidence-render="${escape(item.id)}" data-evidence-retry="true">Retry render</button>` : displayStatus === "not-rendered" ? `<button type="button" class="action-button" data-evidence-render="${escape(item.id)}">Render presentation</button>` : "";
      return `<li class="evidence-archive-record"><strong>${escape(item.id)}</strong><span>${escape(item.type)} · ${escape(item.location_name ?? item.location ?? "location unrecorded")} · custody: ${escape(item.custody?.state ?? "unknown")} · Standard: ${item.standard_available ? "AVAILABLE" : "NOT AVAILABLE"}</span>${badge(item.reporting_state ?? "unreported")}${badge(displayStatus)}<small>${escape(render.last_error?.message ?? "Canonical metadata remains authoritative.")}</small>${visual}${retry}</li>`;
    }, "No institutionally accessible evidence record exists.");
    const conflicts = list(archive.contradictions, (item) => `<li><strong>CONFLICTING RECORD</strong><span>${escape(item.claim ?? "Recorded disagreement")} · ${escape(item.state)}</span></li>`, "No recorded conflict is accessible.");

    const aeot = projection.aeot_inspection;
    let inspectionSection = "";
    if (aeot?.active) {
      const views = aeot.views ?? {};
      const reportView = views.report ?? {};
      const personnelView = views.personnel ?? {};
      const evidenceView = views.evidence ?? {};
      const photographsView = views.photographs ?? {};
      const mapView = views.map ?? {};
      const recordsView = views.institutional_records ?? {};

      const tabs = `
        <nav class="aeot-inspection-tabs" data-testid="aeot-inspection-tabs" role="tablist">
          <button type="button" class="action-button aeot-tab active" data-aeot-view="report" role="tab" aria-selected="true" data-testid="tab-report">Report</button>
          <button type="button" class="action-button aeot-tab" data-aeot-view="personnel" role="tab" aria-selected="false" data-testid="tab-personnel">Personnel</button>
          <button type="button" class="action-button aeot-tab" data-aeot-view="evidence" role="tab" aria-selected="false" data-testid="tab-evidence">Evidence</button>
          <button type="button" class="action-button aeot-tab" data-aeot-view="photographs" role="tab" aria-selected="false" data-testid="tab-photographs">Photographs</button>
          <button type="button" class="action-button aeot-tab" data-aeot-view="map" role="tab" aria-selected="false" data-testid="tab-map">Map</button>
          <button type="button" class="action-button aeot-tab" data-aeot-view="institutional_records" role="tab" aria-selected="false" data-testid="tab-institutional_records">Institutional Records</button>
        </nav>
      `;

      const viewReportPanel = `
        <section class="panel aeot-view-panel active" data-testid="aeot-view-report" data-view-id="report" role="tabpanel" id="view-aeot-report">
          ${reportCard}
          ${findingsCard}
        </section>
      `;

      const rosterItems = list(personnelView.roster ?? [], (p) => {
        const equipStr = p.assigned_equipment?.length ? p.assigned_equipment.map((e) => e.label).join(", ") : "No assigned equipment";
        return `<li class="personnel-card"><strong>${escape(p.display_name)}</strong><span>${escape(p.role)} · Clearance: ${escape(p.clearance)}</span>${badge(p.condition)}<small>Archetype: ${escape(p.personality_archetype)} · End-of-shift equipment: ${escape(equipStr)}</small></li>`;
      }, "No personnel records in roster.");

      const viewPersonnelPanel = `
        <section class="panel aeot-view-panel" data-testid="aeot-view-personnel" data-view-id="personnel" role="tabpanel" id="view-aeot-personnel" hidden>
          <header class="written-report-header"><div class="eyebrow">PERSONNEL ROSTER · END OF SHIFT ACCOUNTABILITY</div><h2>Accountable Field Expedition Roster</h2><span>Assigned team members and final disposition</span></header>
          ${rosterItems}
        </section>
      `;

      const vaultItems = list(evidenceView.items ?? [], (item) => {
        return `<li class="evidence-archive-record"><strong>${escape(item.label)}</strong><span>ID: ${escape(item.id)} · ${escape(item.type)}</span>${badge(item.custody_status)}<small>Vault: ${escape(item.vault_location)} · Received: ${escape(item.receipt_timestamp)} · Custodian: ${escape(item.custodian)}</small><p>${escape(item.notes)}</p></li>`;
      }, "No surrendered physical evidence logged in central intake vault.");

      const viewEvidencePanel = `
        <section class="panel aeot-view-panel" data-testid="aeot-view-evidence" data-view-id="evidence" role="tabpanel" id="view-aeot-evidence" hidden>
          <header class="written-report-header"><div class="eyebrow">PHYSICAL EVIDENCE ARCHIVE · CENTRAL INTAKE VAULT</div><h2>Surrendered Materials in Central Vault Custody</h2><span>Location: ${escape(evidenceView.vault_location ?? "Central Intake Vault / Sector B1 Vault 4")}</span></header>
          ${vaultItems}
          ${evidenceCard}
        </section>
      `;

      const photoFrames = list(photographsView.frames ?? [], (f) => {
        return `<li class="photo-frame-card"><strong>EXP-${String(f.frame).padStart(2, "0")}: ${escape(f.subject)}</strong><span>${escape(f.location)} · ${escape(f.timestamp)}</span><p>${escape(f.description)}</p></li>`;
      }, "No 35mm photographic frames developed.");

      const viewPhotographsPanel = `
        <section class="panel aeot-view-panel" data-testid="aeot-view-photographs" data-view-id="photographs" role="tabpanel" id="view-aeot-photographs" hidden>
          <header class="written-report-header"><div class="eyebrow">FIELD CAMERA LOG · 35MM EXPOSURES</div><h2>Field Photography Exposures</h2><span>${escape(photographsView.exposures_used ?? 6)} / ${escape(photographsView.total_capacity ?? 24)} EXPOSURES USED · ${escape(photographsView.exposures_remaining ?? 18)} exposures remaining</span></header>
          ${photoFrames}
        </section>
      `;

      const schematicNodes = list(mapView.facility_schematic?.nodes ?? [], (n) => `<li><strong>${escape(n.name)}</strong><span>${escape(n.desc)}</span></li>`, "No schematic nodes available.");
      const traversedNodes = list(mapView.bermuda_branch_route?.traversed_nodes ?? [], (n) => `<li><strong>${escape(n.name)}</strong><span>${escape(n.desc)}</span></li>`, "No traversed route recorded.");
      const outpostAInsp = mapView.bermuda_branch_route?.inspections?.["outpost-a"];
      const kv31Insp = mapView.bermuda_branch_route?.inspections?.["threshold-side-entry"];

      const viewMapPanel = `
        <section class="panel aeot-view-panel" data-testid="aeot-view-map" data-view-id="map" role="tabpanel" id="view-aeot-map" hidden>
          <header class="written-report-header"><div class="eyebrow">SPATIAL SCHEMATIC · TRAVERSED BERMUDA ROUTE</div><h2>Facility Schematic &amp; Traversed Bermuda Route</h2><span>${escape(mapView.facility_schematic?.title ?? "ASYNC RESEARCH FACILITY · SECTOR B1")} · ${escape(mapView.facility_schematic?.sector ?? "Sector B1")}</span></header>
          <div class="map-inspection-grid">
            <div><h3>Controlled Facility Schematic Nodes</h3>${schematicNodes}</div>
            <div><h3>Traversed Route: ${escape(mapView.bermuda_branch_route?.branch ?? "Bermuda Branch")}</h3>${traversedNodes}</div>
            <div class="node-inspections">
              <h3>Node Inspections</h3>
              ${outpostAInsp ? `<div class="node-card"><strong>${escape(outpostAInsp.label)}</strong><p>Placard: <em>${escape(outpostAInsp.placard)}</em></p><small>${escape(outpostAInsp.furniture)} · ${escape(outpostAInsp.equipment)}</small></div>` : ""}
              ${kv31Insp ? `<div class="node-card"><strong>${escape(kv31Insp.label)}</strong><p>Signage: <em>${escape(kv31Insp.hazard_signage)}</em></p><small>${escape(kv31Insp.aperture)} · ${escape(kv31Insp.status)}</small></div>` : ""}
            </div>
          </div>
        </section>
      `;

      const ledger = recordsView.intake_ledger ?? {};
      const knowledgeList = list(recordsView.confirmed_knowledge ?? [], (k) => `<li>✓ ${escape(k)}</li>`, "No confirmed knowledge recorded.");
      const endStatus = recordsView.end_of_shift_status ?? {};

      const viewRecordsPanel = `
        <section class="panel aeot-view-panel" data-testid="aeot-view-institutional_records" data-view-id="institutional_records" role="tabpanel" id="view-aeot-institutional_records" hidden>
          <header class="written-report-header"><div class="eyebrow">INSTITUTIONAL INTAKE LEDGER · PROTOCOL KV31-C</div><h2>Institutional Records &amp; Shift Status</h2><span>Batch: ${escape(ledger.batch_id ?? "REC-1991-0717-KV31-CQ4")} · Status: ${escape(ledger.status ?? "CLOSED / COMMITTED")}</span></header>
          <dl class="findings-basis">
            <div><dt>Batch ID</dt><dd>${escape(ledger.batch_id ?? "REC-1991-0717-KV31-CQ4")}</dd></div>
            <div><dt>Intake Operator</dt><dd>${escape(ledger.intake_operator ?? "Records Custodian / Intake Division B")}</dd></div>
            <div><dt>Timestamp</dt><dd>${escape(ledger.timestamp ?? "1991-07-17 12:52:10")}</dd></div>
            <div><dt>Protocol Authority</dt><dd>${escape(ledger.protocol ?? "Protocol KV31-C Section 9.2")}</dd></div>
          </dl>
          <h3>Confirmed Institutional Knowledge</h3>
          ${knowledgeList}
          <div class="shift-status-card">
            <strong>${escape(endStatus.shift_status ?? "END OF SHIFT")} · ${escape(endStatus.date ?? "JULY 17, 1991")}</strong>
            <p>${escape(endStatus.record_status ?? "EXPEDITION RECORD COMMITTED")} · ${escape(endStatus.assignment_status ?? "NO FURTHER ASSIGNMENT ISSUED")}</p>
            <small>${escape(endStatus.records_status ?? "AEOT RECORDS REMAIN AVAILABLE")}</small>
          </div>
        </section>
      `;

      inspectionSection = `<div class="aeot-inspection-surface" data-testid="aeot-inspection-surface">${tabs}<div class="aeot-views-container">${viewReportPanel}${viewPersonnelPanel}${viewEvidencePanel}${viewPhotographsPanel}${viewMapPanel}${viewRecordsPanel}</div></div>`;
    }

    const triad = aeot?.active ? "" : `<div class="debrief-triad">${reportCard}${evidenceCard}${findingsCard}</div>`;

    return `<div class="mode-surface debrief-surface" data-testid="surface-clear-q4-debrief"><section class="briefing-heading"><p class="eyebrow">CLEAR-Q4 · EXPEDITION DEBRIEFING &amp; RECORD CLOSURE</p><h1>Expedition Operational Closure</h1><p>ASync institutional review decouples observer accounts, surrendered physical evidence, and administrative findings.</p></section>${notice}${inspectionSection}${triad}<div class="debrief-secondary">${panel("Assignment & Objective Outcomes", `<p>${escape(review?.assignment?.objective ?? "Assigned field work")}</p>${objectiveOutcome}`, 'data-testid="review-assignment"')}${panel("Personnel Accountability", personnelList, 'data-testid="review-personnel"')}${panel("Equipment & Container Disposition", equipmentListDisposition, 'data-testid="review-equipment"')}${panel("Institutional archive · evidence", `${archiveRows}${conflicts}`, 'data-testid="institutional-archive"')}${institutionSurface(projection)}</div>${actions(projection)}</div>`;
  }
  function beck(projection) { const inst = projection.institution ?? projection.surface; const overview = `<dl class="metrics"><div><dt>Institutional time</dt><dd>${escape(inst.logical_time ?? 0)}</dd></div><div><dt>Available budget</dt><dd>${escape(inst.budget?.available ?? 0)}</dd></div><div><dt>Pending tasks</dt><dd>${escape(inst.tasks?.length ?? 0)}</dd></div><div><dt>Active operations</dt><dd>${escape((inst.operations ?? []).filter((x) => x.status === "active").length)}</dd></div></dl>`;
    return `<div class="mode-surface beck-surface" data-testid="surface-beck"><section class="desk-heading"><p class="eyebrow">BECK'S DESK</p><h2>What needs attention</h2>${overview}</section><div class="desk-layout"><section class="desk-inbox">${panel("Reports and calls", list([...(inst.inbox ?? []), ...(inst.communications ?? [])], (item) => `<li><strong>${escape(title(item.type ?? "report"))}</strong>${badge(item.lifecycle ?? item.status ?? "queued")}</li>`, "No reports or calls are waiting."), 'data-testid="beck-reports"')}${panel("On the desk", list(inst.tasks, (task) => `<li><div><strong>${escape(title(task.type ?? "matter"))}</strong><span>${escape(task.summary ?? task.context ?? "A decision is available.")}</span></div>${badge(task.status ?? "pending")}</li>`, "Nothing is waiting for a decision."), 'data-testid="beck-tasks"')}</section><aside class="desk-context">${panel("People and teams", `${list(inst.personnel, (person) => `<li><strong>${escape(title(person.role))}</strong>${badge(person.status)}</li>`, "No personnel update.")}${list(inst.teams, (team) => `<li><strong>${escape(team.name ?? "Field team")}</strong><span>${escape(team.status ?? "known status pending")}</span></li>`, "No team update.")}`, 'data-testid="beck-personnel"')}${panel("Work in progress", `${list(inst.research?.active, (item) => `<li>${escape(item.topic ?? "Active work")}</li>`, "No active work.")}${list(inst.infrastructure?.projects, (item) => `<li><strong>${escape(item.type ?? "Project")}</strong>${badge(item.status)}</li>`, "No active projects.")}`, 'data-testid="beck-infrastructure"')}</aside></div><details class="desk-record"><summary>Desk record</summary>${panel("Possible next work", list([...(inst.research?.eligible ?? []), ...(inst.research?.unlocks ?? [])], (item) => `<li>${escape(item.topic ?? item.summary ?? item.type ?? "Operational possibility")}</li>`, "No additional work is available."), 'data-testid="beck-research"')}${callbacks(projection)}${timeline(projection, "Desk record")}${actions(projection)}</details></div>`; }
  function nullzone(projection) { const state = projection.surface; const base = state.base ?? {}; const excursion = state.current_excursion; return `<div class="mode-surface nullzone-surface" data-testid="surface-nullzone"><section class="casefile-heading"><p class="eyebrow">NULLZONE</p><h2>${excursion ? "Notes from an excursion" : "A personal notebook"}</h2><p>${excursion ? "Keep observations separate from conclusions." : "Keep only what you have seen, carried, or recorded yourself."}</p></section><div class="casefile"><section class="notebook-page">${panel("Notebook", list(state.investigation?.unresolved, (question) => `<li>${escape(title(question))}</li>`, "No open question yet."), 'data-testid="nullzone-questions"')}${panel("Current evidence", state.local_observation ? `<p>${escape(state.local_observation.landmark?.description ?? "A local observation is available.")}</p>` : empty("No new observation."), 'data-testid="nullzone-observation"')}${panel("Comparison", list(base.archived_artifacts, (item) => `<li><strong>${escape(title(item.type))}</strong><span>Recorded observation</span></li>`, "Nothing recorded for comparison."), 'data-testid="nullzone-archive"')}</section><aside class="casefile-margin">${panel("What you carry", excursion ? `<p>${escape(excursion.carried?.map(title).join(", ") || "Nothing")}</p><p>Returning remains your choice.</p>` : empty("No excursion in progress."), 'data-testid="nullzone-excursion"')}${panel("At home", `<p>Access point: ${escape(base.known_access_point ?? "not established")}</p>${list(Object.entries(base.stored_equipment ?? {}), ([name, quantity]) => `<li><strong>${escape(title(name))}</strong><span>${escape(quantity)}</span></li>`, "No stored equipment.")}`, 'data-testid="nullzone-base"')}${panel("Remembered way", list(excursion?.known_routes, (route) => `<li>${escape(route.alias ?? "remembered way")}</li>`, "No route is remembered yet."), 'data-testid="nullzone-routes"')}</aside></div><details class="casefile-record"><summary>Notebook record</summary>${callbacks(projection)}${timeline(projection, "Personal record")}${actions(projection)}</details></div>`; }
  function lost(projection) { const state = projection.surface; const around = state.surroundings ?? {}; return `<div class="mode-surface lost-surface" data-testid="surface-lost"><section class="lost-hero"><p class="eyebrow">LOST</p><h2>${escape(around.location?.alias ?? "Unknown place")}</h2><p>${escape(around.environment ? Object.values(around.environment).join(" · ") : "Listen. Look. Choose only from what is here.")}</p></section><section class="lost-immediate" data-testid="lost-surroundings"><p>${escape(around.landmark?.description ?? "No landmark you can name.")}</p><p>${escape([...(around.exits ?? []), ...(around.features ?? []), ...(around.objects ?? [])].map((item) => item.alias ?? item.kind).join(", ") || "Nothing certain stands out.")}</p></section><footer class="lost-kept" data-testid="lost-resources"><span>Light: ${escape(state.status?.light_charge ?? 0)}</span><span>${escape((state.status?.carried ?? []).map(title).join(", ") || "Empty hands")}</span></footer>${state.run_notes?.length ? `<aside class="lost-memory">${list(state.run_notes, (note) => `<li>${escape(note)}</li>`, "")}</aside>` : ""}<details class="lost-remember"><summary>What you remember</summary>${list([...(state.known_routes?.spaces ?? []), ...(state.known_routes?.connections ?? [])], (route) => `<li>${escape(route.alias ?? route.from ?? "remembered path")}</li>`, "No route beyond this place is known.")}${actions(projection)}</details></div>`; }
  function operationalPreField(projection) {
    const view = projection.q4 ?? {}; const mission = view.mission_record ?? {}; const phase = projection.phase?.phase_id ?? "BRIEFING"; const radioChecked = view.radio_check?.completed === true;
    const isOpener = isOpenerProjection(projection);
    const crossLabel = isOpener ? "CLEARED; CROSS?" : "Cross Threshold";
    const labels = {
      BRIEFING: ["INTRODUCTIONS", isOpener ? "Speak with the assigned team over LOCAL, then proceed together to Equipment Staging Department." : "Inspect the work order and assigned team, then continue to Equipment Staging.", isOpener ? "PROCEED TO ESD · PROCEED TO EQUIPMENT STAGING" : "PROCEED TO ESD", "READY"],
      STAGING: ["EQUIPMENT STAGING DEPARTMENT / ESD", isOpener ? "Review assigned manifest and confirm equipment issue before departure." : "Cooperate with the team on equipment and movement preparation.", isOpener ? "CONFIRM ISSUE" : "Proceed toward the Threshold", "PROCEED"],
      FACILITY_TRANSIT: ["THRESHOLD APPROACH", "Proceed with the accounted team toward the Threshold.", "Approach Threshold Room", "APPROACH"],
      THRESHOLD: ["THRESHOLD PROCEDURE", "Confirm the party outside the Complex, then begin the Standard radio procedure.", "Begin radio procedure", "READY"],
      STANDARD_RADIO_CHECK: ["RADIO READINESS", radioChecked ? "Standard has acknowledged the team. Crossing the Threshold is now your explicit decision." : "Select STANDARD, write your own transmission, and submit it. No player speech is generated.", radioChecked ? crossLabel : "", radioChecked ? "CROSS" : ""]
    };
    const [heading, instruction, primary, action] = labels[phase] ?? labels.BRIEFING;
    const team = list(view.team, (member) => `<li><strong>${escape(String(member.display_name ?? "").replace(/ · YOU$/, ""))}</strong><span>${escape(String(member.role ?? "assigned personnel").replace(/ · YOU$/, ""))}${member.controlled ? " · TEAM LEAD (YOU)" : " · COWORKER"}</span>${badge(member.contact_category ?? member.condition)}<small>${escape(member.last_contact)}</small></li>`, "The assigned team is not available.");
    const radioHistory = list(view.channels?.standard?.history, (item) => `<li><strong>${escape(item.speaker)}</strong><span>${escape(item.text)}</span>${badge(item.delivery)}</li>`, "The required radio exchange has not started.");
    const step = (id, label, complete) => `<li class="${complete ? "complete" : "current"}"><span>${complete ? "✓" : "•"}</span>${escape(label)}</li>`;
    const isBroadcastCompleted = Boolean(view.facility_broadcast?.completed || projection.briefing_feed_completed);
    const isStandby = phase === "BRIEFING" && isOpener && (view.facility_broadcast?.status === "standby" || (!view.facility_broadcast?.visible && !isBroadcastCompleted));
    const isBroadcastIncomplete = phase === "BRIEFING" && isOpener && !isBroadcastCompleted;
    const isPersonnelBriefing = phase === "BRIEFING" && isOpener && isBroadcastCompleted && (view.beat === "PERSONNEL_BRIEFING" || view.beat === "FACILITY_BROADCAST" || !view.beat);
    const introductions = phase === "BRIEFING" && isOpener && isBroadcastCompleted && !isPersonnelBriefing && view.introduction_pressure?.length ? `<section class="introduction-pressure" data-testid="introduction-pressure"><header><p class="eyebrow">LOCAL · ASSIGNED TEAM</p><h2>The room has not gone quiet for you</h2></header>${list(view.introduction_pressure, (item) => `<li><strong>${escape(item.prompt)}</strong></li>`, "Your assigned coworkers are present.")}<details><summary>Conversation guidance</summary><p>Address one person or speak to everyone nearby. LOCAL dialogue is live and does not advance the procedure.</p></details></section>` : "";
    const stageIndex = phase === "STANDARD_RADIO_CHECK" ? 1 : 0;
    const magneticWarning = (phase === "THRESHOLD" || phase === "FACILITY_TRANSIT") ? `<div class="magnetic-field-warning-banner" data-testid="threshold-magnetic-warning">WARNING / HIGH MAGNETIC FIELD / AUTHORIZED PERSONNEL ONLY</div>` : "";
    const thresholdRoomEnvironment = (phase === "THRESHOLD" || phase === "STANDARD_RADIO_CHECK") ? `<div class="threshold-room-scene-display" data-placeholder-id="THRESHOLD_ROOM_ENVIRONMENT" data-testid="threshold-room-environment"><header><p class="eyebrow">CENTERPIECE ENVIRONMENT · CANONICAL GEOMETRY</p><strong>Threshold Chamber Approach (LPMDS)</strong></header><ul class="threshold-features"><li>Massive concrete portal frame with electromagnetic emitter arrays</li><li>Threshold observation window on upper gallery</li><li>Yellow-painted perimeter boundary line</li><li>Dr. Kirk Maxwell observing from upper staging post</li></ul></div>` : "";

    const currentDecisionInstruction = isStandby
      ? "Terminal operational. Standing by for facility transmission."
      : (isBroadcastIncomplete
        ? "Facility broadcast in progress. Await conclusion of the broadcast before proceeding."
        : (isPersonnelBriefing
          ? "Facility broadcast concluded. Standing by for assignment briefing."
          : instruction));
    const primaryButtonLabel = isStandby
      ? "STANDBY"
      : (isBroadcastIncomplete
        ? "FACILITY BROADCAST IN PROGRESS"
        : (isPersonnelBriefing
          ? "BRIEFING PENDING"
          : (isOpener && phase === "BRIEFING" ? "PROCEED TO ESD · PROCEED TO EQUIPMENT STAGING" : primary)));
    const primaryButtonDisabled = isStandby || isBroadcastIncomplete || isPersonnelBriefing;

    let primaryBrief = `<section class="preparation-board" data-testid="q4-preparation"><div class="preparation-summary"><p class="eyebrow">WORK ORDER</p><h1>${escape(mission.display_id ?? mission.id ?? "CLEAR-Q4 FIELD ASSIGNMENT")}</h1><p>${escape(mission.rationale ?? "Institutional field assignment.")}</p><strong>${escape(mission.objective?.primary ?? view.display_mission)}</strong></div><div class="preparation-progress"><p class="eyebrow">OPERATIONAL PREPARATION</p><ol>${step("prep", "Preparation", stageIndex > 0)}${step("radio", "Radio readiness", radioChecked)}</ol></div>${magneticWarning}${thresholdRoomEnvironment}${phase === "STANDARD_RADIO_CHECK" && !radioChecked ? "" : `<div class="briefing-next"><p class="eyebrow">CURRENT DECISION</p><p>${escape(currentDecisionInstruction)}</p><button type="button" class="primary-action" data-game-action="${escape(action)}" ${primaryButtonDisabled ? 'disabled aria-disabled="true" data-briefing-locked="true"' : ""} title="${primaryButtonDisabled ? escape(currentDecisionInstruction) : escape(primaryButtonLabel)}">${escape(primaryButtonLabel)}</button></div>`}</section>`;
    const equipmentHeading = (phase === "STAGING" && isOpener) ? "CLEAR Q4 ASSIGNED EXPEDITION MANIFEST" : "Authorized field kit";
    const equipment = `${introductions}${phase === "STAGING" ? `${equipmentList(projection)}${equipmentList(projection, true)}` : equipmentList(projection)}`;
    return `<div class="mode-surface q4-preparation-surface q4-prefield-${escape(phase.toLowerCase())} surface-clear-q4-${escape(phase.toLowerCase())}" data-testid="q4-preparation-surface"><header class="prefield-heading"><p class="eyebrow">CLEAR-Q4 · ${escape(heading)}</p><p>One preparation surface follows the team from briefing through deployment. Canonical phase changes remain recorded.</p></header>${primaryBrief}${layoutMap(projection)}${phase === "STANDARD_RADIO_CHECK" ? `<section class="radio-procedure" data-testid="visible-radio-exchange"><header><p class="eyebrow">STANDARD PROCEDURAL EXCHANGE</p><strong>${escape(view.channels?.standard?.state_label ?? "ESTABLISHING LINK")}</strong></header>${radioHistory}<div class="radio-check-in-container"><button type="button" class="action-button radio-check-in-button" data-q4-check-in="true">Hold for Standard Check-In (2s)</button></div></section>` : ""}<section class="preparation-secondary"><details ${phase === "STAGING" ? "open" : ""}><summary>Team and authorized preparation</summary>${panel("Personnel", team, 'data-testid="prefield-personnel"')}${panel(equipmentHeading, equipment, 'data-testid="prefield-equipment"')}</details><details><summary>Work-order records</summary>${panel("Reporting expectations", `<p>${escape(mission.reporting?.summary ?? view.reporting)}</p>${list(mission.reporting?.check_ins, (item) => `<li>${escape(item)}</li>`, "No schedule recorded.")}`, 'data-testid="prefield-reporting"')}${panel("Prior Survey Record", list(mission.prior_history, (item) => `<li><strong>${escape(item.status ?? "RECORDED")}</strong><span>${escape(item.text)}</span></li>`, "No prior survey record is part of this assignment."), 'data-testid="prefield-history"')}</details></section>${communicationLanes(projection, false)}</div>`;
  }
  function operationalStatus(projection) {
    const q4 = projection.q4 ?? {}; const clock = q4.operational_clock ?? {}; const checkIn = q4.communications?.check_ins?.[0] ?? q4.check_in ?? {}; const messages = q4.communications?.messages ?? [];
    const recent = messages.slice(-3); const updates = q4.operational_updates ?? [];
    return `<section class="panel operational-status" data-testid="operational-status" aria-labelledby="operational-status-heading"><header><div><p class="eyebrow">OPERATIONAL STATUS</p><h2 id="operational-status-heading">${escape(clock.label ?? q4.operational_time ?? "Operational time unavailable")}</h2></div>${badge(checkIn.state_label ?? checkIn.label ?? "Not scheduled")}</header><p>${escape(checkIn.summary ?? "No scheduled field report is currently active.")}</p>${recent.length ? `<h3>Recent radio traffic</h3>${list(recent, (message) => `<li><strong>${escape(message.recipient)}</strong><span>${escape(message.purpose)} · sent at interval ${escape(message.sent_at)}</span>${badge(message.state_label ?? message.state)}${message.known_reason ? `<small>${escape(message.known_reason)}</small>` : ""}</li>`, "")}` : empty("No field-radio traffic yet.")}${updates.length ? `<div class="operational-updates" role="status" aria-live="polite"><h3>What just changed</h3>${list(updates, (update) => `<li>${escape(update.summary)}</li>`, "")}</div>` : ""}</section>`;
  }
  function operationalField(projection) {
    if (projection.phase?.phase_id === "REPORT") return reportSurface(projection);
    if (projection.phase?.phase_id === "DEBRIEF") return reviewSurface(projection);
    if (!['FIELD_OPERATION', 'RETURN'].includes(projection.phase?.phase_id)) return operationalPreField(projection);
    const q4 = projection.q4 ?? {}; const location = q4.current_location ?? {}; const checkIn = q4.check_in ?? {};
    const interactables = panel("Visible objects", list(q4.interactables, (object) => `<li class="interactable-card"><div><strong>${escape(object.name)}</strong><span>${escape(object.condition)}</span>${object.known_properties?.length ? `<small>${escape(object.known_properties.join(" "))}</small>` : ""}</div><div class="object-actions"><button type="button" class="action-button" data-object-action="INSPECT" data-object-target="${escape(object.name)}">Inspect</button>${(object.actions ?? []).map((action) => `<button type="button" class="action-button" data-object-action="${escape(action.action)}" data-object-target="${escape(action.target)}" ${action.available ? "" : "disabled"} title="${escape(action.unavailable_reason ?? actionLabel(action.action))}" aria-label="${escape(`${actionLabel(action.action)} ${object.name}${action.unavailable_reason ? `. ${action.unavailable_reason}` : ""}`)}">${escape(action.label)}</button>`).join("")}</div></li>`, "No authored object is visible from this position."), 'data-testid="field-interactables"');
    const returnPhase = projection.phase?.phase_id === "RETURN";
    return `<div class="mode-surface field-surface operational-field" data-testid="surface-clear-q4"><section class="field-observation" data-testid="field-observation"><span class="sr-only">Current scene observation record</span><p class="eyebrow observation-eyebrow">OBSERVATION RECORD · ${escape(location.type ?? "FIELD LOCATION")}</p><h1>${escape(location.name ?? "Current location unknown")}</h1><div class="observation-prose-container"><p class="observation-prose">${escape(q4.field_observation ?? "Observe the current location before proceeding.")}</p></div></section>${interactables}<section class="field-priority-grid">${objectives(projection)}${operationalStatus(projection)}</section>${layoutMap(projection)}<details class="field-support"><summary>Team, inventory, and Standard posture</summary>${panel("Team", list(q4.team, (member) => { const epistemic = member.last_observed ? `Last Observed: ${escape(member.last_observed)}` : member.last_reported ? `Last Reported: ${escape(member.last_reported)}` : escape(member.last_contact ?? "no confirmed contact"); const task = member.current_task ? `${escape(member.current_task)} · ` : ""; const lead = member.controlled ? " · TEAM LEAD (YOU)" : ""; return `<li><strong>${escape(member.display_name)}${lead}</strong><span>${escape(member.role)} · ${escape(member.contact_state ?? member.contact_category)} · ${escape(member.current_or_last_known_location ?? "location unconfirmed")}</span>${badge(member.condition)}<small>${task}${epistemic}</small></li>`; }, "No team status is available."), 'data-testid="field-team"')}${inventorySurface(projection)}${institutionSurface(projection)}</details><details class="field-notes" ${returnPhase ? "open" : ""}><summary>${returnPhase ? "Return processing and available controls" : "Field record and available controls"}</summary>${panel("Detected warnings", list(q4.hazards, (hazard) => `<li><strong>${escape(title(hazard.category))}</strong><span>${escape(hazard.summary)}</span>${badge(hazard.state)}</li>`, "No hazard or warning sign has been detected here."), 'data-testid="field-hazards"')}${panel("Visible routes", list(q4.map?.unresolved_exits, (exit) => `<li><strong>${escape(exit.label)}</strong>${badge(exit.status)}</li>`, "No unresolved route is visible."), 'data-testid="field-surroundings"')}${actions(projection)}</details>${communicationLanes(projection)}</div>`;
  }
  const render = (projection) => ({ "async-command": beck, "field-researcher": operationalField, "local-anomaly": nullzone, lost })[projection.mode.id]?.(projection) ?? empty("This role is not available.");
  const inputPrompt = (mode) => ({ "field-researcher":"What do you do?", "async-command":"What do you decide?", "local-anomaly":"What do you investigate?", lost:"What do you try?" })[mode] ?? "What do you do?";
  const inputExample = (mode) => ({ "field-researcher":"For example: wedge the door open with the survey case", "async-command":"For example: call for the latest field report", "local-anomaly":"For example: compare the note with what I saw", lost:"For example: listen at the doorway before moving" })[mode] ?? "Describe your next attempt";
  const shortMissionId = (mission) => mission?.display_id ?? String(mission?.id ?? "UNASSIGNED").replace(/^CQ4-[A-Z-]+-/, "CQ4-").replace(/-[A-Z0-9]{4,}$/, "");
  function asyncHeader(projection, options = {}) {
    const q4 = projection.q4 ?? {};
    const mission = q4.mission_record ?? {};
    const standardTime = q4.simulation_time ?? q4.operational_time ?? "TIME UNAVAILABLE";
    const lastCheckInDisplay = q4.last_check_in_time ? `${escape(q4.last_check_in_time)} ST` : (q4.last_check_in?.timestamp ? `${escape(new Date(q4.last_check_in.timestamp).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }))} ST` : "NONE RECORDED");
    const returnAction = (projection.available_actions ?? []).find((item) => ["RETURN", "COMPLETE_RETURN", "ABORT"].includes(item.type));
    const guidanceDismissed = options.guidanceDismissed ?? false;
    const guidanceButton = guidanceDismissed || projection.settings?.guided_introductions === false ? `<button type="button" class="guidance-toggle" data-guidance-show>Show guidance</button>` : "";
    const isOpener = isOpenerProjection(projection);
    const phaseId = projection.phase?.phase_id ?? "BRIEFING";
    const isStandby = phaseId === "BRIEFING" && isOpener && (projection.q4?.facility_broadcast?.status === "standby" || (!projection.q4?.facility_broadcast?.visible && !projection.briefing_feed_completed && !projection.q4?.facility_broadcast?.completed));
    const isBriefingActive = phaseId === "BRIEFING" && projection.q4?.facility_broadcast?.visible && projection.q4?.facility_broadcast?.status === "in-progress" && !projection.briefing_feed_completed;
    const isPersonnelBriefing = phaseId === "BRIEFING" && isOpener && (projection.q4?.beat === "PERSONNEL_BRIEFING" || (!isStandby && !isBriefingActive && projection.q4?.beat !== "LOCAL_INTRODUCTIONS"));
    const isPreBriefing = phaseId === "BRIEFING" && isOpener && (isStandby || isBriefingActive || isPersonnelBriefing);
    const showReturnAction = !isPreBriefing && Boolean(returnAction);
    const showTerminateSession = !isPreBriefing;
    const developer = options.developer ?? false;
    return `<header class="async-system-header eti-top-bar" data-testid="async-system-header"><div class="eti-title" aria-label="ASYNC Expedition Tracing Interface"><strong>Async Research Institute ETI <span>(est 1979)</span></strong><small>Expedition Tracing Interface · MISSION ${escape(shortMissionId(mission))}</small></div><div class="eti-clocks"><span><strong>${escape(q4.operational_time ?? "T+0")}</strong><small>Expedition Timer</small></span><span><strong data-standard-time>${escape(standardTime)} ST</strong><small>Time in Standard</small></span><span><strong data-last-check-in>${lastCheckInDisplay}</strong><small>Last Radio Check-In</small></span></div>${guidanceButton}<details class="backend-menu"><summary>Interface Backend</summary><div>${showReturnAction ? `<button type="button" data-game-action="${escape(returnAction.type)}">${escape(actionLabel(returnAction.type))}</button>` : ""}<button type="button" data-action="settings">Settings</button>${developer ? `<button type="button" data-action="developer">Developer console</button>` : ""}${showTerminateSession ? `<button type="button" data-action="leave">TERMINATE FIELD SESSION</button>` : ""}</div></details></header>`;
  }
  const api = { render, communicationLanes, communicationConsole, expeditionCockpit, briefingWorkstation, asyncHeader, presentationEvents, actionLabel, title, CAPABILITIES, inputPrompt, inputExample, layoutMap, spatialVisualDisplay: layoutMap };
  global.YBSurfaces = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
