# Yellow Beast — Remaining Alpha Gaps & Backlog Prioritization

**Audit Date**: 2026-09-07  
**Current Milestone**: Stable Alpha Substrate Certified (Pre-Opener Integration)  
**Governing Authority**: Yellow Beast Gameplay Constitution & Simulation Doctrine

---

## 1. Categorized Gap Register

### 1.1 BLOCKING (Must be resolved before Opener drop)
*None.* All runtime subsystems, autonomous decision scheduling, actor behavioral state engines, presentation buses, and epistemic persistence boundaries are operational and certified with 100% passing automated regressions.

---

### 1.2 HIGH (Critical for Full Alpha Playability)
1. **ComfyUI Local Visual Adapter Integration**:
   - *Status*: Fallback visual renderer produces deterministic SVG/canvas documentary representations; live photographic synthesis requires an active ComfyUI endpoint at `127.0.0.1:8188`.
   - *Requirement*: Validate graceful degradation and asynchronous queue handling when ComfyUI is unavailable or slow.
2. **Headless Native Renderer Test Harness**:
   - *Status*: `npm run desktop:verify` and first-run regressions succeed on standard displays; headless CI environments without mock virtual framebuffers report WebGL context warnings.
   - *Requirement*: Ensure native renderer test runner automatically falls back to software rendering in headless test environments.

---

### 1.3 MEDIUM (Alpha Hardening & Ergonomics)
1. **Acoustic Occlusion Across Multi-Room Boundaries**:
   - *Status*: Room-level ambient and machinery loops transition correctly via `acoustic-director.js`. Finer distance-based low-pass filtering through closed doors/bulkheads is currently approximated via room connection tags.
   - *Requirement*: Implement dynamic dB attenuation based on topological graph distance between sound source and observer.
2. **Expanded Teammate Dialogue Chunks for Rare Cascades**:
   - *Status*: Authored chunks in `data/interpretation/authored-chunks.json` cover all common triggers (`HAZARD_DETECTED`, `EQUIPMENT_ISSUE`, `LOST_CONTACT`).
   - *Requirement*: Author additional situational lines for complex compound states (e.g. simultaneously wounded, lost in dark zone, with depleted flashlight).

---

### 1.4 POLISH (User Experience & Aesthetic Cohesion)
1. **Terminal Display Formatting for Narrow Terminals (<80 cols)**:
   - *Status*: Desktop Electron UI is fully responsive; CLI fallback mode exhibits wrapping on very narrow terminal windows during debriefing table dumps.
   - *Requirement*: Add dynamic column trimming when `process.stdout.columns < 80`.
2. **High-Contrast Theme Auditing for Debrief Tables**:
   - *Status*: Standard dark theme verified; light theme contrast in debriefing evidence grids can be tuned for improved readability.

---

### 1.5 WAITING FOR SCRIPTED OPENER (Project Owner Milestone)
1. **Opening Mission Script & Authored Rail Execution**:
   - *Status*: Integration seams fully documented in `docs/YB_SCRIPTED_OPENER_SEAMS.md`.
   - *Owner*: Project Owner.
   - *Handoff*: The engine is completely ready to receive the opener's narrative beats, dialogue trees, procedure checks, and custom starting assets.
2. **Custom Character Voice & Flavor Profiles**:
   - *Status*: Generic bureaucratic personality archetypes are active. Bespoke character lines for Santiago, Beverly, and Autumn in the opening mission will be injected via the opener package.

---

### 1.6 WAITING FOR HUMAN VALIDATION (Subjective / Gameplay Tuning)
1. **Operational Time & Latency Pacing**:
   - *Status*: Standard radio check-in and delivery intervals are modeled deterministically.
   - *Validation Needed*: Playtest feedback on whether communication delays feel suitably tense without causing player frustration during field emergencies.
2. **Natural Language Hesitation Sensitivity**:
   - *Status*: 12 negation/hesitation forms and 7 positive aliases validated.
   - *Validation Needed*: Observe human players in blind onboarding to identify additional regional phrasing or colloquialisms.
