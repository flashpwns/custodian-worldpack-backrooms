# Custodian gap audit

- **Profile-aware session initialization** — **Resolved** by Custodian `1.1.0` / `5589b2b` through public `createSession({ startup })`. Yellow Beast uses it in `tools/run-bootstrap.js` without private imports.
- **Declarative player-facing action permission exposure** — profiles need a stable way to expose allowed actions without changing physics. Other packs would use it. Current workaround: permission sets remain metadata. Severity: medium.
