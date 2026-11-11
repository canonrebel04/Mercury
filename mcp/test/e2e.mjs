#!/usr/bin/env node
// End-to-end test for the Mercury MCP server.
//
// Launches a browser through dist/usr/bin/mercury-browser --mcp --mcp-headless
// (MERCURY_BIN points the wrapper at any Firefox/Mercury binary), starts
// mcp/mercury-mcp.mjs as an MCP stdio server, and drives it like an MCP client.
//
//   MERCURY_BIN=/path/to/firefox node mcp/test/e2e.mjs
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { request } from "node:http";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const wrapper = join(repo, "dist/usr/bin/mercury-browser");
const server = join(repo, "mcp/mercury-mcp.mjs");
const fixture = pathToFileURL(join(here, "fixture.html")).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!process.env.MERCURY_BIN) {
  console.error("set MERCURY_BIN to a Firefox or Mercury binary");
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "mercury-mcp-e2e-"));
const profile = join(work, "profile");
const results = [];
function ok(name, detail = "") {
  results.push(name);
  console.log(`  ok  ${name}${detail ? ` - ${detail}` : ""}`);
}

// --- 0. without --mcp nothing listens -------------------------------------
{
  const plainProfile = join(work, "plain-profile");
  const { mkdirSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  mkdirSync(plainProfile);
  const plain = spawn("bash", [wrapper, "--headless", "--no-remote", "--profile", plainProfile, "about:blank"], {
    env: { ...process.env, HOME: work },
    stdio: "ignore",
    detached: true,
  });
  await sleep(8000);
  assert.ok(!existsSync(join(plainProfile, "WebDriverBiDiServer.json")));
  let listening = "(ss not available)";
  try {
    const out = execFileSync("ss", ["-ltnpH"], { encoding: "utf8" });
    listening = out.split("\n").filter(l => /firefox|mercury/.test(l));
    assert.deepEqual(listening, [], `browser opened a listening socket without --mcp:\n${listening}`);
    listening = "no listening TCP sockets";
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  try { process.kill(-plain.pid, "SIGTERM"); } catch {}
  await sleep(1500);
  ok("default launch (no --mcp): Remote Agent off", listening);
}

// --- 1. launch the browser via the wrapper --------------------------------
// Optional: E2E_USER_JS=<file> seeds the automation profile with prefs, e.g.
// Mercury's default prefs when testing with a stock Firefox binary.
if (process.env.E2E_USER_JS) {
  const { mkdirSync, copyFileSync } = await import("node:fs");
  mkdirSync(profile, { recursive: true });
  copyFileSync(process.env.E2E_USER_JS, join(profile, "user.js"));
}
const browser = spawn("bash", [wrapper, "--mcp", "--mcp-headless", "--mcp-profile", profile, "about:blank"], {
  env: { ...process.env, HOME: work },
  stdio: ["ignore", "ignore", "pipe"],
  detached: true,
});
let browserErr = "";
browser.stderr.on("data", d => (browserErr += d));

function cleanup() {
  try { process.kill(-browser.pid, "SIGTERM"); } catch {}
}
process.on("exit", cleanup);

const portFile = join(profile, "WebDriverBiDiServer.json");
for (let i = 0; i < 120 && !existsSync(portFile); i++) await sleep(250);
assert.ok(existsSync(portFile), `browser did not start the Remote Agent:\n${browserErr}`);
await sleep(300);
const { ws_host, ws_port } = JSON.parse(readFileSync(portFile, "utf8"));
assert.equal(ws_host, "127.0.0.1");
assert.ok(ws_port > 1024);
ok("launcher --mcp starts the Remote Agent", `ws://${ws_host}:${ws_port} (random port)`);
assert.equal((statSync(profile).mode & 0o777).toString(8), "700");
ok("automation profile is private (0700)");
assert.match(browserErr, /anyone on this machine can control/);

// --- 2. security checks on the Remote Agent itself --------------------------
function upgrade(headers) {
  return new Promise(res => {
    const req = request({ host: "127.0.0.1", port: ws_port, path: "/session", agent: false, timeout: 10000, headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers } });
    req.on("upgrade", (r, sock) => { sock.destroy(); res(101); });
    req.on("response", r => { r.resume(); res(r.statusCode); });
    req.on("error", () => res(0));
    req.on("timeout", () => { req.destroy(); res(-1); });
    req.end();
  });
}
{ const st = await upgrade({ Origin: "https://evil.example" }); assert.ok(st >= 400, `status ${st}`); }
ok("web page Origin is refused by the Remote Agent");
{ const st = await upgrade({ Host: `evil.example:${ws_port}` }); assert.ok(st >= 400, `status ${st}`); }
{ const st = await upgrade({}); assert.equal(st, 101); }
ok("non-loopback Host header (DNS rebinding) is refused");

// --- 3. MCP client helper ---------------------------------------------------
function startServer(args = []) {
  const proc = spawn(process.execPath, [server, "--profile", profile, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  const waiting = new Map();
  let id = 0;
  proc.stdout.on("data", d => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
      waiting.delete(msg.id);
    }
  });
  proc.stderr.on("data", d => process.env.VERBOSE && process.stderr.write(d));
  const rpc = (method, params) =>
    new Promise((res, rej) => {
      const myId = ++id;
      const t = setTimeout(() => rej(new Error(`${method} timed out`)), 60000);
      waiting.set(myId, m => { clearTimeout(t); res(m); });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    });
  const call = async (name, args = {}) => {
    const m = await rpc("tools/call", { name, arguments: args });
    assert.ok(!m.error, JSON.stringify(m.error));
    if (m.result.isError) throw new Error(`${name}: ${m.result.content[0].text}`);
    return m.result;
  };
  const stop = () => new Promise(r => { proc.on("exit", r); proc.stdin.end(); });
  return { rpc, call, stop };
}
const textOf = r => r.content.filter(c => c.type === "text").map(c => c.text).join("\n");

// --- 4. drive the browser through MCP ----------------------------------------
{
  const s = startServer();
  const init = await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
  assert.equal(init.result.serverInfo.name, "mercury-mcp");
  const list = await s.rpc("tools/list", {});
  const names = list.result.tools.map(t => t.name);
  for (const n of ["list_tabs", "new_tab", "close_tab", "select_tab", "navigate", "back", "forward", "reload",
                   "snapshot", "get_text", "screenshot", "click", "type", "press_key", "console_logs"]) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
  assert.ok(!names.includes("evaluate"));
  ok("initialize + tools/list", `${names.length} tools, no 'evaluate' without --allow-eval`);
  const badEval = await s.rpc("tools/call", { name: "evaluate", arguments: { expression: "1" } });
  assert.ok(badEval.error);
  ok("evaluate is refused without --allow-eval");

  assert.match(textOf(await s.call("navigate", { url: fixture })), /fixture\.html/);
  ok("navigate");

  const snap = textOf(await s.call("snapshot"));
  assert.match(snap, /Page: Mercury MCP fixture/);
  assert.match(snap, /heading1 "Mercury MCP test page"/);
  const btnRef = snap.match(/\[(e\d+)\] button "Press me"/)?.[1];
  const inputRef = snap.match(/\[(e\d+)\] textbox\[text\] "Search box"/)?.[1];
  const linkRef = snap.match(/\[(e\d+)\] link "Go to page two"/)?.[1];
  assert.ok(btnRef && inputRef && linkRef, snap);
  ok("snapshot", `button=${btnRef} input=${inputRef} link=${linkRef}`);

  await s.call("click", { ref: btnRef });
  assert.match(textOf(await s.call("get_text")), /Clicked!/);
  ok("click by ref (page reacted)");

  await s.call("type", { ref: inputRef, text: "hello mercury", submit: true });
  assert.match(textOf(await s.call("get_text")), /You typed: hello mercury/);
  ok("type + submit by ref");

  await s.call("type", { selector: "#q", text: "xyz", clear: true });
  await s.call("press_key", { key: "Enter" });
  assert.match(textOf(await s.call("get_text")), /You typed: xyz/);
  ok("type by selector + press_key Enter");

  const shotPath = join(work, "shot.png");
  const shot = await s.call("screenshot", { save_to: shotPath });
  const png = Buffer.from(shot.content[0].data, "base64");
  assert.equal(shot.content[0].mimeType, "image/png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.length > 1000);
  assert.ok(existsSync(shotPath));
  ok("screenshot", `${png.length} byte PNG`);

  const logs = textOf(await s.call("console_logs"));
  assert.match(logs, /button-clicked-log/);
  ok("console_logs", logs.split("\n").length + " entries");

  await s.call("click", { ref: linkRef });
  await sleep(1000);
  assert.match(textOf(await s.call("get_text")), /Arrived on page two/);
  await s.call("back");
  await sleep(1000);
  assert.match(textOf(await s.call("get_text")), /Mercury MCP test page/);
  await s.call("forward");
  await sleep(1000);
  assert.match(textOf(await s.call("get_text")), /Arrived on page two/);
  await s.call("reload");
  ok("link click navigation + back/forward/reload");

  await s.call("new_tab", { url: fixture });
  let tabs = textOf(await s.call("list_tabs"));
  assert.equal(tabs.split("\n").length, 2, tabs);
  await s.call("select_tab", { tab: 0 });
  assert.match(textOf(await s.call("get_text")), /Arrived on page two/);
  await s.call("close_tab", { tab: 1 });
  tabs = textOf(await s.call("list_tabs"));
  assert.equal(tabs.split("\n").length, 1, tabs);
  ok("new_tab / list_tabs / select_tab / close_tab");

  await s.stop();
}

// --- 5. a second client can connect after the first exits; eval opt-in ----
{
  const s = startServer(["--allow-eval"]);
  await s.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  const names = (await s.rpc("tools/list", {})).result.tools.map(t => t.name);
  assert.ok(names.includes("evaluate"));
  const r = textOf(await s.call("evaluate", { expression: "({sum: 40 + 2, title: document.title, webdriver: navigator.webdriver})" }));
  assert.deepEqual(JSON.parse(r), { sum: 42, title: "Page two", webdriver: true });
  ok("evaluate with --allow-eval (new session after first client exited); navigator.webdriver is true (automation not hidden)");
  await s.stop();
}

cleanup();
rmSync(work, { recursive: true, force: true });
console.log(`\nPASS: ${results.length} checks`);
process.exit(0);
