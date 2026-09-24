# Third-party notices

Yellow Beast Alpha bundles the Custodian framework and its resolved runtime dependencies. Their licenses remain in the package metadata distributed with the artifact.

- Custodian 1.5.0 — MIT
- Ajv and Ajv Formats — MIT
- fast-deep-equal — MIT
- fast-uri — BSD-3-Clause
- json-schema-traverse — MIT

## Local dialogue runtime (bundled)

The application ships an on-device wording runtime; it is started, verified and stopped by the application and never reaches the network during play.

- llama.cpp (`llama-server`, ggml libraries; release b11146) — MIT, Copyright (c) 2023-2026 The ggml authors. Full text: `docs/licenses/llama.cpp-MIT.txt` (also shipped beside the runtime).
  - Compiled into `llama-server` from llama.cpp's `vendor/` tree: cpp-httplib 0.57.1 — MIT, Copyright (c) 2017 yhirose (`docs/licenses/cpp-httplib-MIT.txt`); nlohmann/json — MIT, Copyright (c) 2013-2025 Niels Lohmann (`docs/licenses/nlohmann-json-MIT.txt`); miniaudio — public domain or MIT-0; stb_image — public domain (MIT alternative). The runtime links only macOS system frameworks otherwise.
- Gemma 4 E4B instruction-tuned, Q4_K_M GGUF (google/gemma-4-E4B-it by Google DeepMind; quantization unsloth/gemma-4-E4B-it-GGUF, revision bfc15c382204943c3a8fff0c750b94ae2364d7a3; SHA-256 85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87) — Apache-2.0; use also subject to the Gemma Prohibited Use Policy. Full text: `docs/licenses/Gemma-4-Apache-2.0.txt` (also shipped beside the model). Pinned in `tools/local-runtime-pin.json`.

Yellow Beast is an unofficial fan project and is not affiliated with Kane Pixels.

## Owner-supplied Day One menu recordings

The canonical LivingBeatmap_Reconciled_Canonical.docx records the project owner's clearance for the named menu recordings and branding for the intended release. Copies supplied on 2026-09-13 are packaged with their original filenames and SHA-256 provenance in `desktop/assets/audio/Music/provenance.json`:

- Libet's Delay — The Caretaker.
- Chirp — C418.
- Hanging Frame (Time Passages) — supplied for the Kane Parsons version slot.

The supplied 5% music slot uses the owner-provided “Bossanova, Sweet, Healing, Peaceful — Today's diary” track. This replaces the previously planned Al Stewart slot. This notice records the supplied beatmap's clearance statement; the supplied folder contains no separate license instrument.
