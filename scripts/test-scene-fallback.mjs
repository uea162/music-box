import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/app/api/scene/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const route = await import(moduleUrl);
const visible = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "雨夜街道" }] } }] })}\n\n`;
const thoughtOnly = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "internal", thought: true }] } }] })}\n\n`;
const originalFetch = globalThis.fetch;
const originalKey = process.env.GEMINI_API_KEY;
const originalMoondreamKey = process.env.MOONDREAM_API_KEY;
process.env.GEMINI_API_KEY = "test-key";
delete process.env.MOONDREAM_API_KEY;

function request() {
  return new Request("http://localhost/api/scene", {
    method: "POST",
    body: JSON.stringify({ image: "AA==" }),
  });
}

try {
  process.env.MOONDREAM_API_KEY = "moon-test-key";
  const moonCalls = [];
  globalThis.fetch = async (url, options) => {
    moonCalls.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
    return Response.json({ answer: "雨夜街道" });
  };
  const moonResponse = await route.POST(request());
  assert.deepEqual(await moonResponse.json(), { scene: "雨夜街道" });
  assert.equal(moonCalls.length, 1);
  assert.equal(moonCalls[0].url, "https://api.moondream.ai/v1/query");
  assert.equal(moonCalls[0].headers["X-Moondream-Auth"], "moon-test-key");
  assert.equal(moonCalls[0].body.model, "moondream3.1-9B-A2B");
  assert.equal(moonCalls[0].body.image_url, "data:image/jpeg;base64,AA==");

  globalThis.fetch = async (url) => String(url).includes("moondream.ai")
    ? Response.json({ error: "temporary" }, { status: 503 })
    : new Response(visible);
  const moonFallback = await route.POST(request());
  assert.equal(moonFallback.status, 200);
  assert.match(await moonFallback.text(), /雨夜街道/);

  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async () => Response.json({ answer: "" });
  assert.equal((await route.POST(request())).status, 502);

  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.MOONDREAM_API_KEY;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const model = String(url).match(/models\/([^:]+)/)?.[1];
    calls.push({ model, body: JSON.parse(options.body) });
    if (model === "gemini-3.6-flash") {
      return Response.json({ error: { message: "Requests per day quota exceeded" } }, { status: 429 });
    }
    return new Response(visible, { status: 200 });
  };
  const first = await route.POST(request());
  assert.equal(first.status, 200);
  assert.deepEqual(calls.map((call) => call.model), ["gemini-3.6-flash", "gemini-3.1-flash-lite"]);
  assert.equal(calls[1].body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
  assert.match(await first.text(), /雨夜街道/);

  calls.length = 0;
  await route.POST(request());
  assert.deepEqual(calls.map((call) => call.model), ["gemini-3.1-flash-lite"]);

  calls.length = 0;
  globalThis.fetch = async (url) => {
    const model = String(url).match(/models\/([^:]+)/)?.[1];
    calls.push({ model });
    return new Response(model === "gemini-3.1-flash-lite" ? thoughtOnly : visible);
  };
  const third = await route.POST(request());
  assert.equal(third.status, 200);
  assert.deepEqual(calls.map((call) => call.model), ["gemini-3.1-flash-lite", "gemini-3.5-flash"]);

  const freshRoute = await import(`${moduleUrl}#fourth-model`);
  calls.length = 0;
  globalThis.fetch = async (url, options) => {
    const model = String(url).match(/models\/([^:]+)/)?.[1];
    calls.push({ model, body: JSON.parse(options.body) });
    return model === "gemini-3.8-flash"
      ? new Response(visible)
      : Response.json({ error: { message: "Model unavailable" } }, { status: 404 });
  };
  const fourth = await freshRoute.POST(request());
  assert.equal(fourth.status, 200);
  assert.deepEqual(calls.map((call) => call.model), [
    "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash",
  ]);
  assert.equal(calls[3].body.generationConfig.thinkingConfig.thinkingLevel, "low");

  console.log("Moondream and Gemini fallback checks passed");
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
  if (originalMoondreamKey === undefined) delete process.env.MOONDREAM_API_KEY;
  else process.env.MOONDREAM_API_KEY = originalMoondreamKey;
}
