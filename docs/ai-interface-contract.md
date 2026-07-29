# AI interface contract

Custodian is simulation authority. Yellow Beast is setting authority. A future
AI interpreter and narrator are language and presentation authorities only.

`{ verb, target, parameters }` proposals must be resolved only against the
observer-safe action/status envelope, then submitted through Custodian's public
`submitSessionAction`. AI may clarify ambiguity and phrase results; it may not
mutate state, invent outcomes, expose hidden state, create permissions, or
bypass failed actions. If several visible targets fit a reference, it asks.
