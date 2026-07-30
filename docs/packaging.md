# Downloadable alpha packaging

YB-14 builds a portable app directory rather than duplicating the game in a launcher. It contains a platform-native bundled Node executable, the minimal Yellow Beast runtime assets, the lock-resolved Custodian dependency tree, `LICENSE`, and `START-HERE.md`. Research/canon archives, tests, `.git`, `.env`, logs, and saves are excluded.

Build on the target operating system so the bundled Node runtime is native:

```sh
npm ci
npm run build:alpha
npm run verify:alpha
```

Artifacts appear in `dist/macos/` or `dist/windows/`. macOS builds are locally smoke-tested on the host architecture; Windows builds are produced and smoke-tested by the GitHub Actions packaging matrix on packaging pull requests (and may be dispatched after the workflow first reaches `main`). Neither platform is signed or notarized in this alpha.

Mutable data is external: macOS uses `~/Library/Application Support/Yellow Beast/`; Windows uses `%APPDATA%\Yellow Beast\`. Existing developer saves under `.saves/` are untouched; copy a JSON save into the new `saves/` folder to import it manually. Configuration is `config.json`; logs are noncanonical under `logs/`.

Before a public release: build on clean target runners, run `npm run verify:alpha`, inspect uploaded artifacts, verify no secrets/absolute paths, attach the platform artifacts manually, and document Gatekeeper/SmartScreen behavior. No release, tag, or npm publish is created by this workflow.
