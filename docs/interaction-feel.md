# Interaction feel

YB-30 Pass 3 gives a turn three presentation-only stages: submitted,
resolving, and result. Natural-language input remains the primary control. A
single request gate prevents duplicate submissions; it records only a renderer
token and the visible world/mode context, never a canonical action or fact.

When a reply arrives late, after a world change, or after an experience change,
it is ignored by the renderer. A normal in-world refusal is phrased as an
attempt that cannot be completed; an application failure says that the request
did not complete and the world was not changed. Offline narration is named once
when it is actually used, without exposing provider or model internals.

Motion is limited to a short scene-result settle transition. It has centralized
timing tokens and honors `prefers-reduced-motion`; it has no decorative horror
effects, fabricated progress, hidden-threat signal, or factual meaning. Turn
controls lock while resolving, while report/notebook/detail panels remain
usable and never affect turn resolution.

Pass 4’s recovery control is deliberately presentation-only: **Refresh view**
may retrieve a safe current projection after an application failure, but it
never retries a submitted turn. Opening recap or history panels leaves an
unfinished draft in place. Keyboard recap shortcuts never run while a text
control is active and never resolve an action.

Pass 5 applies the player Reduced Motion preference through the same centralized
motion seam. Submitted, resolving, result, offline, and application-error
feedback remain textual and politely announced; animation is never required to
understand a change.
