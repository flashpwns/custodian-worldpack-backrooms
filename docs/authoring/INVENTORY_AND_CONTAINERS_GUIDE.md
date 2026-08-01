# Inventory and Containers Guide

`logistics-runtime.js` is the sole authoritative field-logistics model. Object interactions, equipment capability checks, spatial markers, mission conditions, institutional reconciliation, and renderer surfaces all consume this state. The historical `expedition.equipment` shape is a derived compatibility facade, not competing truth.

## Items

Definitions declare display/category/capabilities/capacity/consumable and optional charge or replenishment behavior. Instances receive stable IDs and persist definition, condition, charge/quantity, holder, container, location, equipped/active state, assignment and institutional owner, known/last-confirmed custody, recoverability, reconciliation, and history. Category-appropriate schema/runtime validation rejects malformed state.

## Containers

Containers declare kind, capacity, allowed categories, initial access/open state, holder/location, and optional parent. Runtime state stores contents, lost/recovered/reconciled state, last-confirmed custody, and history. Personal harnesses are generated for coworkers. Staging stores, player/teammate storage, field/evidence cases, fixed caches, and placed/lost containers share the same model.

Only one nested-container level is permitted. A container cannot contain itself, form a cycle, exceed capacity, accept an incompatible category, or make contents accessible through a closed/inaccessible/lost ancestor.

## Actions and transaction semantics

The generic action set covers inspect, carry, equip/unequip, use, activate/deactivate, consume, replenish, hand over/receive/assign, place/drop, store/retrieve, lose/abandon/recover, verify, and return reconciliation.

Each transaction:

1. clones authoritative logistics state;
2. validates actor/target existence, location/proximity, current custody, capacity/category, access/open state, item condition/quantity, route/hazard constraints, mission phase, restrictions, and nesting;
3. applies every custody, quantity, condition, container-content, last-known, and history mutation to the clone;
4. validates uniqueness and graph invariants again;
5. replaces canonical state once, synchronizes spatial equipment, and then evaluates mission/institution inputs.

Any failure returns a grounded reason and commits nothing. Items cannot teleport, duplicate, partially consume, or disappear from a failed transfer.

## Loadout and reconciliation

Worldpacks distinguish required and optional item instances, waiver/degraded deployment policy, and public recommendations. Staging projects missing required capabilities, holder/container, capacity, consumables, restrictions, and readiness. Institutional state can restrict optional stores or recommend/release additional capability.

Return reconciliation classifies each item and container from actual holder/location/condition/loss state, preserves unresolved custody, and supplies structured equipment/container outcomes to mission and Standard review.

## UI contract

The inventory projection supplies public label/category/capabilities, loadout status, player-safe holder/container/location, condition, remaining supply, equipped/access state, restriction, and complete action availability with reasons. The renderer shows at most six immediate contextual actions and a full list with identical actions. Both use normal buttons/focus order, semantic labels, text scaling, reduced motion, responsive layout, and text/symbol status rather than color alone. Neither surface mutates local inventory state.
