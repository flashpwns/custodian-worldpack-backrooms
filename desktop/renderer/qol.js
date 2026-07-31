"use strict";
// QoL derives concise, observer-safe presentation from the existing desktop
// projection. It never reads a world, session, or thread store directly.
(function (global) {
  const title = (value) => String(value ?? "").replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const text = (value) => typeof value === "string" ? value : "";
  const bounded = (items, limit = 6) => (items ?? []).filter(Boolean).slice(0, limit);
  const named = (items, fallback) => bounded(items).map((item) => text(item?.alias ?? item?.name ?? item?.description ?? item?.type ?? item) || fallback).filter(Boolean);
  const section = (heading, items, search = false) => ({ heading, items: bounded(items), search });
  function recap(projection) {
    const state = projection.surface ?? {}; const scene = text(projection.scene?.narration);
    if (projection.mode.id === "field-researcher") {
      const expedition = state.expedition ?? {}; const objectives = [...(projection.gameplay?.objectives ?? []).map((item) => item.target ?? item.type), ...Object.values(expedition.objectives ?? {}).map((item) => item?.state)].filter(Boolean);
      return { title:"Field recap", sections:[section("Current situation", [scene || text(state.view?.location?.alias) || "Observe the current area."]), section("Operational concerns", objectives), section("Carrying", (projection.scene?.inventory ?? []).map((item) => item.text)), section("Recent radio", expedition.message_count ? [`${expedition.message_count} message${expedition.message_count === 1 ? "" : "s"} sent.`] : [])] };
    }
    if (projection.mode.id === "async-command") {
      const desk = projection.institution ?? state;
      return { title:"Desk recap", sections:[section("Matters on the desk", (desk.tasks ?? []).map((item) => item.summary ?? item.context ?? item.type), true), section("Recent reports and calls", [...(desk.inbox ?? []), ...(desk.communications ?? [])].map((item) => item.summary ?? item.type), true), section("People and teams", [...(desk.personnel ?? []).map((item) => item.role), ...(desk.teams ?? []).map((item) => item.name)], true)] };
    }
    if (projection.mode.id === "local-anomaly") {
      const base = state.base ?? {}; const excursion = state.current_excursion ?? {};
      return { title:"Notebook recap", sections:[section("Open questions", (state.investigation?.unresolved ?? []).map(title), true), section("Personal evidence", (base.archived_artifacts ?? []).map((item) => title(item.type)), true), section("What you carry", (excursion.carried ?? []).map(title)), section("Recent observation", [text(state.local_observation?.landmark?.description)].filter(Boolean))] };
    }
    const around = state.surroundings ?? {};
    return { title:"What you remember", sections:[section("Here", [text(around.landmark?.description) || text(around.location?.alias) || "Nothing certain stands out."]), section("What remains", [`Light: ${state.status?.light_charge ?? 0}`, ...(state.status?.carried ?? []).map(title)]), section("Nearby memory", named([...(state.known_routes?.spaces ?? []), ...(state.known_routes?.connections ?? [])], "remembered path"))] };
  }
  function history(projection, limit = 6) {
    if (projection.mode.id === "async-command") return bounded([...(projection.institution?.inbox ?? []), ...(projection.institution?.communications ?? []), ...(projection.institution?.tasks ?? [])].map((item) => text(item.summary ?? item.context ?? item.type)), limit);
    if (projection.mode.id === "local-anomaly") return bounded([...(projection.surface?.run_notes ?? []), ...(projection.surface?.base?.archived_artifacts ?? [])].map((item) => text(item.description ?? item.type ?? item)), limit);
    if (projection.mode.id === "lost") return bounded(projection.surface?.run_notes ?? [], Math.min(limit, 4)).map(text);
    return bounded(projection.gameplay?.timeline ?? [], limit).map((item) => text(item.description ?? item.type));
  }
  const filter = (items, query) => !query ? items : items.filter((item) => String(item).toLowerCase().includes(String(query).trim().toLowerCase()));
  class PresentationMetadata {
    constructor() { this.entries = new Map(); }
    key(context) { return `${context.worldId}:${context.mode}`; }
    entry(context) { const key = this.key(context); if (!this.entries.has(key)) this.entries.set(key, { draft:"", pins:new Set(), panel:"" }); return this.entries.get(key); }
    draft(context) { return this.entry(context).draft; }
    setDraft(context, value) { this.entry(context).draft = String(value ?? ""); }
    clearDraft(context) { this.entry(context).draft = ""; }
    togglePin(context, value) { const pins = this.entry(context).pins; pins.has(value) ? pins.delete(value) : pins.add(value); return pins.has(value); }
    pinned(context, value) { return this.entry(context).pins.has(value); }
    setPanel(context, value) { this.entry(context).panel = value; }
    panel(context) { return this.entry(context).panel; }
  }
  const api = { recap, history, filter, PresentationMetadata };
  global.YBQol = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
