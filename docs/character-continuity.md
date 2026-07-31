# Character continuity

A named character is a singular persistent identity in one `yellow-beast-world-history@v1` world. A role is not a person: a dead named field researcher leaves a vacancy that can remain vacant, be reassigned, or be filled by a different existing or procedural person. It never recreates the deceased identity.

`world.characters` is canonical current state backed by append-only `character.*` world-history events. It is not an observer-knowledge store and can be reconstructed from those events on load. Identity allocation rejects any identity that has already appeared in the world, including a dead, missing, retired, or removed identity. `dead` is irreversible through normal `setCharacterStatus` transitions.

Institutional belief may lag: an observer can hold an old status report while the character is objectively dead. That belief never revives the person. Save/reload and exported world import retain the history events and rebuild the same death state. Current generic ASYNC personnel are role occupants, not named canon characters; future Pass-2 named-character admission must include source claims, era constraints, and explicit provenance.
