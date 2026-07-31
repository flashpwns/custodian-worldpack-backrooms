# YB-33 public beta candidate audit

YB-33 Pass 3 records the final release-candidate audit. The repository keeps
the existing `0.13.0-alpha` version because `docs/packaging.md` explicitly
defers tags/releases and no beta-version policy exists.

The audit is green for the stranger flow, all four mode surfaces, natural
language as the primary path, canon/provenance gravity, observer boundaries,
death and object continuity, bounded phenomena, derived story threads,
replayability, accessibility/QoL, offline/provider fallback, save/load,
long-world stability, developer/player separation, secret handling, assets,
and version/documentation consistency.

Validation included the 219-test full suite, all milestone reports, the YB-33
stranger and 2,650-turn torture reports, desktop test/build, alpha directory
build and verifier, and Electron macOS/Windows arm64 ZIP packaging plus
offline desktop smoke. Packaged artifacts contain the required player/runtime
assets and no repository tests/docs, `.git`, `.env`, absolute developer paths,
or credential values. Developer tooling remains disabled in the default player
configuration and is not present in the player-facing surface.

The native artifacts remain unsigned, matching the existing alpha policy and
the documented Gatekeeper/SmartScreen handoff. No gameplay, Custodian, world
authority, or version format changed for the candidate.
