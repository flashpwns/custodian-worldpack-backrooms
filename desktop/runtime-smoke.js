"use strict";

// Packaged acceptance for the internal LOCAL DIALOGUE RUNTIME: the application alone (no Homebrew, Ollama,
// Python, second terminal, API key or network) finds its bundled runtime, starts the model, reaches READY,
// answers one loopback request, and shuts it down. Process-orphan checks live in verify-desktop-artifact.
const http = require("node:http");
const { LOCAL_PROVIDER_SPEC } = require("../tools/ai-local-model-provider");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (endpoint, method, path, body = null) => new Promise((resolve, reject) => {
  const url = new URL(path, endpoint);
  const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method, headers: body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}, timeout: 90000 }, (res) => { let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"] ?? "", data })); });
  req.on("error", reject); req.on("timeout", () => req.destroy(new Error("request timed out")));
  if (body) req.write(body);
  req.end();
});

async function run(service) {
  service.startDialogueRuntime();
  let status = null;
  for (let waited = 0; waited < 240000; waited += 500) {
    status = service.getInferenceApplianceStatus().appliance;
    if (status.state === "READY" && status.endpoint) break;
    if (status.state === "UNSUPPORTED" && status.hardware?.supported === false) {
      // Below the on-device hardware floor the packaged application correctly declines local wording and
      // dialogue uses the same-plan deterministic fallback. Reported as such -- never as READY.
      service.shutdown();
      await pause(500);
      console.log(JSON.stringify({ runtime_smoke: "below-hardware-floor", state: status.state, memory_gb: status.hardware.memory_gb, arch: status.hardware.arch }));
      return;
    }
    if (["REPAIR_REQUIRED", "UNSUPPORTED"].includes(status.state)) throw new Error(`local dialogue runtime failed: ${status.state} (${status.message ?? "no status message"})`);
    await pause(500);
  }
  if (status?.state !== "READY") throw new Error(`local dialogue runtime did not reach READY (${status?.state})`);
  const url = new URL(status.endpoint);
  if (url.hostname !== "127.0.0.1") throw new Error(`runtime is not loopback-only: ${url.hostname}`);
  const home = await request(status.endpoint, "GET", "/");
  if (/<html/i.test(home.data)) throw new Error("runtime exposes a web UI");
  const reply = await request(status.endpoint, "POST", "/v1/chat/completions", JSON.stringify({ model: LOCAL_PROVIDER_SPEC.defaultModel, messages: [{ role: "user", content: "Reply with one word." }], max_tokens: 6, temperature: 0, stream: false }));
  if (reply.status !== 200 || !JSON.parse(reply.data)?.choices?.[0]) throw new Error("runtime did not answer a loopback request");
  service.shutdown();
  await pause(1500);
  console.log(JSON.stringify({ runtime_smoke: "passed", state: "READY", loopback: true, web_ui: false, answered: true }));
}
module.exports = { run };
