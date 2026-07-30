# AI interface contract

Custodian is simulation authority. Yellow Beast is setting authority. A future AI interpreter and narrator are language and presentation authorities only.

The interpreter may turn player language into `{ verb, target, parameters }`, but it resolves targets only through the current Yellow Beast alias map produced from Custodian 1.5.0 `inspectSessionObserver({ session, observer, request })`. Aliases map to opaque Custodian refs; neither the AI nor Yellow Beast may resolve references from objective IDs or raw projections.

```
Player language → AI Intent Interpreter → Yellow Beast verb/action
  → submitSessionAction or inspectSessionObserver
  → structured observer-safe result → AI Narration Presenter → player
```

AI may select currently available actions, sequence compound requests, request clarification for multiple aliases, and summarize safe results. It may not mutate canonical state, invoke private APIs, invent success/entities/events/observations, expose raw objective state, override failure, grant permissions, or change canon. Narration receives only action outcome, safe view/details, accessible evidence, public failure reason, and next public actions.
