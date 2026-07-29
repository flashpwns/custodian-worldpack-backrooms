# Custodian gap audit

- **Profile-aware session initialization** — **Resolved** by Custodian `1.1.0` / `5589b2b` through public `createSession({ startup })`. Yellow Beast uses it in `tools/run-bootstrap.js` without private imports.
- **Public action submission** — **Resolved** by Custodian `1.2.0` / `29919ef684d047c4ca7fca7179599a592d886198` through `getAvailableSessionActions` and `submitSessionAction`.
- **Declarative player-facing action permission exposure** — profiles need a stable way to expose allowed actions without changing physics. Other packs would use it. Current workaround: permission sets remain metadata. Severity: medium.
