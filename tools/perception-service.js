"use strict";

const bootstrap = require("./run-bootstrap");
const canonicalLedger = require("./canonical-world-ledger");

const VERSION = "yellow-beast-perception-service@v1";

function resolveEntityLocation(run, entityId) {
  if (!entityId || !run) return null;
  const id = String(entityId).trim();
  const player = run.session?.startup?.player?.observer_id;
  if (id === player || id === "player") return canonicalLedger.getPlayerLocation(run);

  const normCoworker = canonicalLedger.normalizePersonnelId(run, id);
  const coworkerLoc = canonicalLedger.getCoworkerLocation(run, normCoworker);
  if (coworkerLoc) return coworkerLoc;

  // Equipment check
  const eq = canonicalLedger.getEquipment(run, id);
  if (eq) {
    if (eq.holder) return resolveEntityLocation(run, eq.holder);
    return run.spatial?.equipment_locations?.[id] ?? null;
  }

  // Object / landmark check in topology
  try {
    const topology = bootstrap.topologyFor(run);
    for (const loc of topology.locations ?? []) {
      if (loc.id === id) return loc.id;
      if ((loc.landmarks ?? []).some((lm) => lm.id === id || lm.name?.toLowerCase() === id.toLowerCase())) {
        return loc.id;
      }
    }
    const obj = canonicalLedger.getObjectState(run, id);
    if (obj?.location) return obj.location;
  } catch {}

  return run.spatial?.equipment_locations?.[id] ?? null;
}

function sameRoom(a, b, run) {
  const locA = resolveEntityLocation(run, a);
  const locB = resolveEntityLocation(run, b);
  if (!locA || !locB) return false;
  return locA === locB;
}

function getTopology(run) {
  try {
    return bootstrap.topologyFor(run);
  } catch {
    return { locations: [], connections: [] };
  }
}

function adjacent(a, b, run) {
  if (sameRoom(a, b, run)) return true;
  const locA = resolveEntityLocation(run, a);
  const locB = resolveEntityLocation(run, b);
  if (!locA || !locB) return false;

  const topology = getTopology(run);
  const connections = topology.connections ?? [];
  return connections.some((c) =>
    (c.from === locA && c.to === locB) || (c.bidirectional && c.from === locB && c.to === locA)
  );
}

function distanceBetween(a, b, run) {
  if (a === b) return 0.0;
  const locA = resolveEntityLocation(run, a);
  const locB = resolveEntityLocation(run, b);
  if (!locA || !locB) return Infinity;
  if (locA === locB) {
    const normB = canonicalLedger.normalizePersonnelId(run, b);
    if (normB) return 2.2;
    return 1.2;
  }
  if (adjacent(a, b, run)) return 6.5;

  const topology = getTopology(run);
  const graph = new Map();
  for (const c of topology.connections ?? []) {
    if (!graph.has(c.from)) graph.set(c.from, []);
    graph.get(c.from).push(c.to);
    if (c.bidirectional) {
      if (!graph.has(c.to)) graph.set(c.to, []);
      graph.get(c.to).push(c.from);
    }
  }

  const queue = [[locA, 0]];
  const visited = new Set([locA]);
  while (queue.length > 0) {
    const [curr, hops] = queue.shift();
    if (curr === locB) return hops * 8.0;
    for (const next of (graph.get(curr) ?? [])) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([next, hops + 1]);
      }
    }
  }

  return Infinity;
}

function reachable(actor, target, run) {
  const actorLoc = resolveEntityLocation(run, actor);
  const targetLoc = resolveEntityLocation(run, target);
  if (!actorLoc || !targetLoc) return false;

  if (actorLoc === targetLoc) {
    const obj = canonicalLedger.getObjectState(run, target);
    if (obj && obj.state === "locked") return false;
    return true;
  }

  const topology = getTopology(run);
  const directConnection = (topology.connections ?? []).find((c) =>
    ((c.id === target || c.to === target) && c.from === actorLoc) ||
    (c.bidirectional && (c.id === target || c.from === target) && c.to === actorLoc)
  );
  if (directConnection) {
    const isBlocked = directConnection.lock_state === "blocked" || directConnection.lock_state === "closed" || Boolean(run.spatial?.blocked_paths?.[directConnection.id]);
    return !isBlocked;
  }

  return false;
}

function directionFrom(observer, target, run) {
  const obsLoc = resolveEntityLocation(run, observer);
  const topology = getTopology(run);
  const conn = (topology.connections ?? []).find((c) =>
    (c.from === obsLoc && (c.to === target || c.id === target)) ||
    (c.bidirectional && c.to === obsLoc && (c.from === target || c.id === target))
  );
  if (conn) {
    if (conn.from === obsLoc && conn.direction) return conn.direction;
    if (conn.to === obsLoc && conn.reverse_direction) return conn.reverse_direction;
    if (conn.direction) return conn.direction;
  }
  return "ahead";
}

function canSee(observer, entity, run) {
  const obsLoc = resolveEntityLocation(run, observer);
  const entLoc = resolveEntityLocation(run, entity);
  if (!obsLoc || !entLoc) return false;

  if (obsLoc !== entLoc) {
    const topology = getTopology(run);
    const conn = (topology.connections ?? []).find((c) =>
      (c.from === obsLoc && c.to === entLoc && ["visible", "open"].includes(c.visibility ?? "visible")) ||
      (c.bidirectional && c.to === obsLoc && c.from === entLoc && ["visible", "open"].includes(c.visibility ?? "visible"))
    );
    if (!conn) return false;
  }

  const topology = getTopology(run);
  const loc = (topology.locations ?? []).find((l) => l.id === obsLoc);
  const lighting = loc?.environment?.lighting ?? "dim";
  if (lighting === "pitch-black" || lighting === "none") {
    const membersInRoom = Object.entries(run.spatial?.personnel_locations ?? {})
      .filter(([, l]) => l === obsLoc)
      .map(([id]) => id);
    const hasLight = membersInRoom.some((id) => {
      const items = canonicalLedger.getEquipmentHeldBy(run, id);
      return items.some((item) => (item.id === "field-light" || item.capability === "illumination") && item.state !== "depleted");
    });
    if (!hasLight) return false;
  }

  return true;
}

function canHear(observer, source, run) {
  const obsLoc = resolveEntityLocation(run, observer);
  const srcLoc = resolveEntityLocation(run, source);
  if (!obsLoc) return false;
  if (!srcLoc) {
    const topology = getTopology(run);
    const loc = (topology.locations ?? []).find((l) => l.id === obsLoc);
    return Boolean(loc?.environment?.sound);
  }

  if (obsLoc === srcLoc) return true;
  return adjacent(obsLoc, srcLoc, run);
}

function perceive(run, observerId) {
  const obsLoc = resolveEntityLocation(run, observerId);
  const topology = getTopology(run);
  const loc = (topology.locations ?? []).find((l) => l.id === obsLoc) ?? {};

  const visible = [];
  const audible = [];

  for (const lm of loc.landmarks ?? []) {
    visible.push({
      id: lm.id ?? lm.name,
      name: lm.name ?? lm.id,
      distance_m: 1.2,
      direction: "ahead"
    });
  }

  if (run.object_state?.objects) {
    for (const [id, obj] of Object.entries(run.object_state.objects)) {
      if (obj.location === obsLoc && canSee(observerId, id, run)) {
        visible.push({
          id,
          name: obj.name ?? id,
          distance_m: 0.9,
          direction: "ahead"
        });
      }
    }
  }

  const playerId = run.session?.startup?.player?.observer_id ?? "player";
  if ((observerId === playerId || observerId === "player") && obsLoc === run.spatial?.player_location) {
    try {
      const observed = bootstrap.look(run, { record: false });
      for (const item of observed.aliases ?? []) {
        if (!visible.some((v) => v.id === item.ref || v.name === item.alias)) {
          visible.push({
            id: item.ref,
            name: item.alias,
            distance_m: 1.0,
            direction: "ahead"
          });
        }
      }
    } catch {
      // fallback
    }
  }

  for (const conn of topology.connections ?? []) {
    if (conn.from === obsLoc && ["visible", "institutional"].includes(conn.visibility ?? "visible")) {
      visible.push({
        id: conn.id,
        name: conn.direction ? `${conn.direction} passage` : "passage",
        distance_m: 3.5,
        direction: conn.direction ?? "ahead"
      });
    }
  }

  for (const member of run.expedition?.team?.members ?? []) {
    const id = member.personnel_id ?? member.id;
    if (id !== observerId && canSee(observerId, id, run)) {
      visible.push({
        id,
        name: member.display_name ?? `${member.first_name} ${member.last_name}`.trim(),
        role: member.role ?? null,
        distance_m: 2.1,
        direction: "beside"
      });
    }
  }

  if (loc.environment?.sound) {
    audible.push({
      source: loc.environment.sound,
      direction: "ambient"
    });
  }

  return {
    observer_id: observerId,
    location_id: obsLoc,
    visible,
    audible
  };
}

module.exports = {
  VERSION,
  resolveEntityLocation,
  sameRoom,
  adjacent,
  distanceBetween,
  reachable,
  directionFrom,
  canSee,
  canHear,
  perceive
};
