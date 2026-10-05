"use strict";
// Read existing OS-encrypted credentials through the application's own store.
// No windows, service, saves, configuration writes, or credential export.
const { app, safeStorage } = require("electron");
const path = require("node:path");
const { CredentialStore } = require("../desktop/credentials");
const profiles = require("../desktop/profile-resolver");
app.setName("yellow-beast");
app.whenReady().then(async () => {
  const directory = profiles.profilePaths(profiles.defaultProductionUserDataRoot()).credentials;
  const store = new CredentialStore({ safeStorage, file: path.join(directory, "openai.bin") });
  const argv = process.argv.slice(2);
  const apiKeys = argv.includes("--openrouter") ? [store.get("openrouter"), store.get("openrouter")] : [store.get("openai"), store.get("anthropic")];
  if (argv.includes("--check-openrouter-capacity")) {
    const key = store.get("openrouter");
    if (!key) throw new Error("OpenRouter credential missing");
    for (const endpoint of ["key", "credits"]) {
      const response = await fetch("https://openrouter.ai/api/v1/" + endpoint, { headers: { authorization: "Bearer " + key }, signal: AbortSignal.timeout(30000) });
      const body = await response.json();
      const d = body.data ?? {};
      console.log(JSON.stringify({ endpoint, http_status: response.status, limit: d.limit ?? null, limit_remaining: d.limit_remaining ?? null, usage: d.usage ?? null, is_free_tier: d.is_free_tier ?? null, total_credits: d.total_credits ?? null, total_usage: d.total_usage ?? null, error_code: body.error?.code ?? null, secrets_exported: false }));
    }
  } else if (argv.includes("--check-model-access")) {
    if (!apiKeys[0]) throw new Error("OpenAI credential missing");
    const response = await fetch("https://api.openai.com/v1/models", { headers: { authorization: "Bearer " + apiKeys[0] }, signal: AbortSignal.timeout(30000) });
    const registry = require("./dialogue-reader-labels").loadRegistry();
    const models = response.ok ? (await response.json()).data.map((m) => m.id) : [];
    console.log(JSON.stringify({ http_status: response.status, recorded_teacher: registry.teacher.model, recorded_teacher_available: models.includes(registry.teacher.model), available_reasoning_models: models.filter((m) => /^(gpt-5|o[134])/.test(m)).sort(), secrets_exported: false }));
  } else if (argv.includes("--check-provider-access")) console.log(JSON.stringify({ openai_available: Boolean(apiKeys[0]), anthropic_available: Boolean(apiKeys[1]), secrets_exported: false }));
  else await require("./dialogue-reader-machine-labeling").main(argv, { apiKeys });
  app.exit(0);
}).catch(() => { console.error("Machine labeling failed; inspect run artifacts. No credential exported."); app.exit(1); });
