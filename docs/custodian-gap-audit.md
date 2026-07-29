# Custodian gap audit

- **Profile-aware session initialization** — Yellow Beast needs a public way to initialize observer-local knowledge, permissions, and resources from a declarative profile. This is setting-agnostic and useful to other packs. Current workaround: profile/scenario scaffolds are validated data only. Severity: medium.
- **Declarative player-facing action permission exposure** — profiles need a stable way to expose allowed actions without changing physics. Other packs would use it. Current workaround: permission sets remain metadata. Severity: medium.
