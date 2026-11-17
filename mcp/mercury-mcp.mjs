#!/usr/bin/env node
// Mercury MCP server (EXPERIMENTAL).
//
// A tiny, zero-dependency Model Context Protocol server that lets an LLM
// client (Claude Desktop, Cursor, ...) drive a Mercury/Firefox browser through
// Firefox's built-in WebDriver BiDi Remote Agent.
//
//   MCP client  <-- stdio JSON-RPC -->  this process  <-- WebDriver BiDi (ws) -->  Mercury
//
// It runs outside the browser and only when the MCP client starts it. The
// browser side is the stock Firefox Remote Agent, which is off unless Mercury
// is launched with `mercury-browser --mcp` (or --remote-debugging-port).
//
// Requires Node.js >= 22 (global WebSocket). No npm dependencies.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// ---------------------------------------------------------------- options --

function parseArgs(argv) {
  const opts = {
    wsUrl: process.env.MERCURY_MCP_WS_URL || "",
    port: process.env.MERCURY_MCP_PORT || "",
    host: "127.0.0.1",
    profile: process.env.MERCURY_MCP_PROFILE || "",
    allowEval: process.env.MERCURY_MCP_ALLOW_EVAL === "1",
    timeoutMs: 30000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) {
        die(`${a} needs a value`);
      }
      return argv[++i];
    };
    switch (a) {
      case "--ws-url": opts.wsUrl = next(); break;
      case "--port": opts.port = next(); break;
      case "--profile": opts.profile = next(); break;
      case "--allow-eval": opts.allowEval = true; break;
      case "--timeout": opts.timeoutMs = Number(next()) * 1000; break;
      case "-h": case "--help": usage(); process.exit(0); break;
      case "--version": process.stdout.write(VERSION + "\n"); process.exit(0); break;
      default: die(`unknown option ${a}`);
    }
  }
  if (!opts.profile) {
    const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    opts.profile = join(xdg, "mercury-mcp", "profile");
  }
  return opts;
}

function usage() {
  process.stderr.write(`mercury-mcp ${VERSION} - MCP server for Mercury (WebDriver BiDi)

Start Mercury first with:  mercury-browser --mcp   (see mcp/README.md)

Options:
  --profile <dir>   Automation profile used by 'mercury-browser --mcp'; the
                    port is read from <dir>/WebDriverBiDiServer.json
                    (default: $XDG_DATA_HOME/mercury-mcp/profile)
  --port <port>     Connect to ws://127.0.0.1:<port>/session instead
  --ws-url <url>    Full WebDriver BiDi URL (must be loopback)
  --allow-eval      Expose the 'evaluate' tool (runs arbitrary JS in pages)
  --timeout <sec>   Per-command timeout (default 30)
`);
}

function die(msg) {
  process.stderr.write(`mercury-mcp: ${msg}\n`);
  process.exit(2);
}

function log(msg) {
  process.stderr.write(`mercury-mcp: ${msg}\n`);
}

const OPTS = parseArgs(process.argv.slice(2));

// ------------------------------------------------------------ BiDi client --

function resolveWsUrl() {
  let url = OPTS.wsUrl;
  if (!url && OPTS.port) {
    url = `ws://${OPTS.host}:${Number(OPTS.port)}/session`;
  }
  if (!url) {
    const file = join(OPTS.profile, "WebDriverBiDiServer.json");
    let info;
    try {
      info = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(
        `Mercury is not running with MCP control enabled (could not read ${file}). ` +
          "Start it with 'mercury-browser --mcp' or pass --port."
      );
    }
    url = `ws://${info.ws_host}:${Number(info.ws_port)}/session`;
  }
  const u = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) {
    throw new Error(`refusing non-loopback WebDriver BiDi URL ${url}`);
  }
  return url;
}

class Bidi {
  #ws = null;
  #nextId = 1;
  #pending = new Map();
  #connecting = null;
  logs = [];

  async ensure() {
    if (this.#ws && this.#ws.readyState === WebSocket.OPEN) {
      return;
    }
    if (!this.#connecting) {
      this.#connecting = this.#connect().finally(() => (this.#connecting = null));
    }
    await this.#connecting;
  }

  async #connect() {
    const url = resolveWsUrl();
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener(
        "error",
        () => reject(new Error(`cannot connect to ${url} (is Mercury running with --mcp?)`)),
        { once: true }
      );
    });
    ws.addEventListener("message", ev => this.#onMessage(ev.data));
    ws.addEventListener("close", () => {
      for (const { reject } of this.#pending.values()) {
        reject(new Error("browser connection closed"));
      }
      this.#pending.clear();
      this.#ws = null;
    });
    this.#ws = ws;
    await this.send("session.new", { capabilities: {} });
    await this.send("session.subscribe", { events: ["log.entryAdded"] });
    log(`connected to ${url}`);
  }

  #onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.id !== undefined && this.#pending.has(msg.id)) {
      const { resolve, reject, timer } = this.#pending.get(msg.id);
      clearTimeout(timer);
      this.#pending.delete(msg.id);
      if (msg.type === "error") {
        reject(new Error(`${msg.error}: ${msg.message}`));
      } else {
        resolve(msg.result);
      }
      return;
    }
    if (msg.method === "log.entryAdded") {
      const p = msg.params;
      this.logs.push({
        context: p.source?.context,
        level: p.level,
        type: p.type === "console" ? `console.${p.method}` : p.type,
        text: p.text ?? "",
        timestamp: p.timestamp,
      });
      if (this.logs.length > 500) {
        this.logs.splice(0, this.logs.length - 500);
      }
    }
  }

  send(method, params = {}) {
    if (!this.#ws) {
      return Promise.reject(new Error("not connected"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, OPTS.timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (this.#ws) {
      try {
        await Promise.race([this.send("session.end"), sleep(1000)]);
      } catch {}
      this.#ws?.close();
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bidi = new Bidi();

// ------------------------------------------------------------ browser ops --

let currentContext = null;
// Snapshot refs ("e1", "e2", ...) -> BiDi sharedId. Reset on each snapshot.
let refs = new Map();

async function topContexts() {
  const { contexts } = await bidi.send("browsingContext.getTree", { maxDepth: 0 });
  return contexts;
}

async function ctx(tab) {
  await bidi.ensure();
  const contexts = await topContexts();
  if (tab !== undefined && tab !== null && tab !== "") {
    const byIndex = Number.isInteger(tab) ? contexts[tab] : undefined;
    const found = byIndex || contexts.find(c => c.context === tab);
    if (!found) {
      throw new Error(`no such tab: ${tab}`);
    }
    return found.context;
  }
  if (!currentContext || !contexts.some(c => c.context === currentContext)) {
    if (!contexts.length) {
      const { context } = await bidi.send("browsingContext.create", { type: "tab" });
      currentContext = context;
    } else {
      currentContext = contexts[0].context;
    }
  }
  return currentContext;
}

async function callFn(context, fn, args = [], extra = {}) {
  const res = await bidi.send("script.callFunction", {
    functionDeclaration: fn.toString(),
    target: { context },
    arguments: args,
    awaitPromise: true,
    resultOwnership: "none",
    ...extra,
  });
  if (res.type === "exception") {
    throw new Error(`page script error: ${res.exceptionDetails?.text}`);
  }
  return res.result;
}

// Turn a BiDi RemoteValue into plain JSON for the LLM.
function plain(v, depth = 0) {
  if (!v || depth > 6) {
    return null;
  }
  switch (v.type) {
    case "undefined": return undefined;
    case "null": return null;
    case "string": case "boolean": return v.value;
    case "number": return typeof v.value === "string" ? v.value : v.value;
    case "bigint": return `${v.value}n`;
    case "array": case "set": return (v.value || []).map(x => plain(x, depth + 1));
    case "object": case "map": {
      const o = {};
      for (const [k, val] of v.value || []) {
        o[typeof k === "string" ? k : JSON.stringify(plain(k, depth + 1))] = plain(val, depth + 1);
      }
      return o;
    }
    case "node": return `<${v.value?.localName || v.value?.nodeName || "node"}>`;
    default: return `[${v.type}]`;
  }
}

// Resolve {ref} or {selector} to a BiDi element reference ({sharedId}).
async function element(context, { ref, selector }) {
  if (ref) {
    const sharedId = refs.get(ref);
    if (!sharedId) {
      throw new Error(`unknown ref ${ref}; take a new snapshot`);
    }
    return { sharedId };
  }
  if (!selector) {
    throw new Error("give either 'ref' (from snapshot) or 'selector' (CSS)");
  }
  const r = await callFn(
    context,
    sel => document.querySelector(sel),
    [{ type: "string", value: selector }]
  );
  if (r.type !== "node") {
    throw new Error(`no element matches ${selector}`);
  }
  return { sharedId: r.sharedId };
}

// In-page function that builds a compact outline of the page. It only reads
// the DOM; it never modifies the page. Returns [nodes[], lines[]].
function snapshotInPage(maxItems) {
  const INTERACTIVE = "a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=combobox],[role=textbox],[contenteditable=''],[contenteditable=true],[onclick],[tabindex]:not([tabindex='-1'])";
  const TEXTY = "h1,h2,h3,h4,h5,h6,p,li,td,th,label,img[alt],legend,caption,figcaption,pre,blockquote";
  const nodes = [];
  const lines = [];
  const visible = el => {
    if (el.closest("[hidden],[aria-hidden=true]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const clip = (t, n = 100) => {
    t = (t || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  };
  const nameOf = el => {
    const l = el.getAttribute("aria-label");
    if (l) return l;
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ");
      if (t.trim()) return t;
    }
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    return el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder") || el.innerText || el.value || "";
  };
  const roleOf = el => {
    const r = el.getAttribute("role");
    if (r) return r;
    const t = el.localName;
    if (t === "a") return "link";
    if (t === "input") {
      const ty = (el.getAttribute("type") || "text").toLowerCase();
      return { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", image: "button" }[ty] || `textbox[${ty}]`;
    }
    if (t === "textarea") return "textbox";
    if (t === "select") return "combobox";
    if (t === "img") return "img";
    if (/^h[1-6]$/.test(t)) return `heading${t[1]}`;
    return t;
  };
  const seen = new Set();
  const all = document.querySelectorAll(`${INTERACTIVE},${TEXTY}`);
  for (const el of all) {
    if (nodes.length >= maxItems) break;
    if (seen.has(el) || !visible(el)) continue;
    const interactive = el.matches(INTERACTIVE);
    // Skip text blocks that merely wrap an interactive element already listed.
    if (!interactive && el.querySelector(INTERACTIVE) && !/^h[1-6]$/.test(el.localName)) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join("").trim();
      if (!own) continue;
    }
    seen.add(el);
    let line = `${roleOf(el)} "${clip(nameOf(el))}"`;
    if (el.localName === "a" && el.href) line += ` href=${clip(el.href, 80)}`;
    if (el.localName === "input" || el.localName === "textarea" || el.localName === "select") {
      if (el.type === "checkbox" || el.type === "radio") line += el.checked ? " checked" : " unchecked";
      else if (el.type !== "password" && el.value) line += ` value="${clip(el.value, 60)}"`;
    }
    if (el.disabled) line += " disabled";
    nodes.push(el);
    lines.push({ line, interactive });
  }
  return [nodes, lines];
}

async function snapshot(context, maxItems) {
  const r = await callFn(
    context,
    snapshotInPage,
    [{ type: "number", value: maxItems }],
    { serializationOptions: { maxDomDepth: 0, maxObjectDepth: 4 } }
  );
  const [nodesV, linesV] = r.value;
  refs = new Map();
  const info = await bidi.send("browsingContext.getTree", { root: context, maxDepth: 0 });
  const top = info.contexts[0];
  const title = plain(await callFn(context, () => document.title));
  const out = [`Page: ${title || "(untitled)"}`, `URL: ${top?.url}`, ""];
  nodesV.value.forEach((n, i) => {
    const l = plain(linesV.value[i]);
    if (l.interactive) {
      const ref = `e${refs.size + 1}`;
      refs.set(ref, n.sharedId);
      out.push(`[${ref}] ${l.line}`);
    } else {
      out.push(`      ${l.line}`);
    }
  });
  if (nodesV.value.length >= maxItems) {
    out.push(`… truncated at ${maxItems} items (pass max_items to see more)`);
  }
  out.push("", "Use the [eN] refs with click/type. Refs are invalid after navigation.");
  return out.join("\n");
}

const KEYS = {
  enter: "\uE007", return: "\uE006", tab: "\uE004", escape: "\uE00C", esc: "\uE00C",
  backspace: "\uE003", delete: "\uE017", space: " ", arrowup: "\uE013",
  arrowdown: "\uE015", arrowleft: "\uE012", arrowright: "\uE014", home: "\uE011",
  end: "\uE010", pageup: "\uE00E", pagedown: "\uE00F", shift: "\uE008",
  control: "\uE009", ctrl: "\uE009", alt: "\uE00A", meta: "\uE03D", cmd: "\uE03D",
  f1: "\uE031", f5: "\uE035", f12: "\uE03C",
};

function keyValue(name) {
  const v = KEYS[name.toLowerCase()];
  if (v) return v;
  if ([...name].length === 1) return name;
  throw new Error(`unknown key ${name}`);
}

async function keyChord(context, combo) {
  const parts = combo === "+" ? ["+"] : combo.split("+").filter(Boolean);
  const values = parts.map(keyValue);
  const actions = [
    ...values.map(value => ({ type: "keyDown", value })),
    ...values.reverse().map(value => ({ type: "keyUp", value })),
  ];
  await bidi.send("input.performActions", {
    context,
    actions: [{ type: "key", id: "mercury-mcp-keyboard", actions }],
  });
}

async function clickEl(context, el) {
  await callFn(context, e => e.scrollIntoView({ block: "center", inline: "center" }), [el]);
  await bidi.send("input.performActions", {
    context,
    actions: [
      {
        type: "pointer",
        id: "mercury-mcp-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", x: 0, y: 0, origin: { type: "element", element: el } },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ],
  });
  await bidi.send("input.releaseActions", { context });
}

// ------------------------------------------------------------------ tools --

const tabArg = {
  tab: { type: ["string", "integer"], description: "Tab id or index from list_tabs (default: selected tab)" },
};
const target = {
  ref: { type: "string", description: "Element ref from snapshot, e.g. e12" },
  selector: { type: "string", description: "CSS selector (used if ref not given)" },
};
const text = t => ({ content: [{ type: "text", text: t }] });

const TOOLS = [
  {
    name: "list_tabs",
    description: "List open tabs (index, id, URL). The selected tab is marked with *.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      await ctx();
      const cs = await topContexts();
      return text(cs.map((c, i) => `${c.context === currentContext ? "*" : " "} ${i}  ${c.context}  ${c.url}`).join("\n"));
    },
  },
  {
    name: "new_tab",
    description: "Open a new tab (optionally at a URL) and select it.",
    inputSchema: { type: "object", properties: { url: { type: "string" } } },
    run: async ({ url }) => {
      await bidi.ensure();
      const { context } = await bidi.send("browsingContext.create", { type: "tab" });
      currentContext = context;
      if (url) {
        await bidi.send("browsingContext.navigate", { context, url, wait: "complete" });
      }
      return text(`opened tab ${context}${url ? ` at ${url}` : ""}`);
    },
  },
  {
    name: "select_tab",
    description: "Select (and bring to front) a tab for subsequent commands.",
    inputSchema: { type: "object", properties: { ...tabArg }, required: ["tab"] },
    run: async ({ tab }) => {
      const c = await ctx(tab);
      currentContext = c;
      await bidi.send("browsingContext.activate", { context: c });
      return text(`selected tab ${c}`);
    },
  },
  {
    name: "close_tab",
    description: "Close a tab (default: the selected one).",
    inputSchema: { type: "object", properties: { ...tabArg } },
    run: async ({ tab }) => {
      const c = await ctx(tab);
      await bidi.send("browsingContext.close", { context: c });
      if (c === currentContext) currentContext = null;
      return text(`closed tab ${c}`);
    },
  },
  {
    name: "navigate",
    description: "Load a URL in the selected tab and wait for it to finish loading.",
    inputSchema: { type: "object", properties: { url: { type: "string" }, ...tabArg }, required: ["url"] },
    run: async ({ url, tab }) => {
      const c = await ctx(tab);
      const r = await bidi.send("browsingContext.navigate", { context: c, url, wait: "complete" });
      return text(`navigated to ${r.url}`);
    },
  },
  {
    name: "back",
    description: "Go back in history.",
    inputSchema: { type: "object", properties: { ...tabArg } },
    run: async ({ tab }) => {
      const c = await ctx(tab);
      await bidi.send("browsingContext.traverseHistory", { context: c, delta: -1 });
      return text("went back");
    },
  },
  {
    name: "forward",
    description: "Go forward in history.",
    inputSchema: { type: "object", properties: { ...tabArg } },
    run: async ({ tab }) => {
      const c = await ctx(tab);
      await bidi.send("browsingContext.traverseHistory", { context: c, delta: 1 });
      return text("went forward");
    },
  },
  {
    name: "reload",
    description: "Reload the page.",
    inputSchema: { type: "object", properties: { ...tabArg } },
    run: async ({ tab }) => {
      const c = await ctx(tab);
      await bidi.send("browsingContext.reload", { context: c, wait: "complete" });
      return text("reloaded");
    },
  },
  {
    name: "snapshot",
    description:
      "Compact text outline of the visible page (headings, text, links, buttons, form fields). " +
      "Interactive elements get refs like [e3] for click/type.",
    inputSchema: { type: "object", properties: { max_items: { type: "integer", default: 300 }, ...tabArg } },
    run: async ({ max_items = 300, tab }) => text(await snapshot(await ctx(tab), Math.min(Math.max(1, max_items), 2000))),
  },
  {
    name: "get_text",
    description: "The page's visible text (document.body.innerText), truncated.",
    inputSchema: { type: "object", properties: { max_chars: { type: "integer", default: 20000 }, ...tabArg } },
    run: async ({ max_chars = 20000, tab }) => {
      const c = await ctx(tab);
      const t = plain(await callFn(c, () => document.body ? document.body.innerText : ""));
      return text(t.length > max_chars ? t.slice(0, max_chars) + "\n… (truncated)" : t);
    },
  },
  {
    name: "screenshot",
    description: "PNG screenshot of the viewport (or the whole page). Optionally also saves it to a file.",
    inputSchema: {
      type: "object",
      properties: { full_page: { type: "boolean", default: false }, save_to: { type: "string" }, ...tabArg },
    },
    run: async ({ full_page = false, save_to, tab }) => {
      const c = await ctx(tab);
      const { data } = await bidi.send("browsingContext.captureScreenshot", {
        context: c,
        origin: full_page ? "document" : "viewport",
      });
      if (save_to) writeFileSync(save_to, Buffer.from(data, "base64"));
      const content = [{ type: "image", data, mimeType: "image/png" }];
      if (save_to) content.push({ type: "text", text: `saved to ${save_to}` });
      return { content };
    },
  },
  {
    name: "click",
    description: "Click an element by snapshot ref or CSS selector (real mouse events).",
    inputSchema: { type: "object", properties: { ...target, ...tabArg } },
    run: async args => {
      const c = await ctx(args.tab);
      await clickEl(c, await element(c, args));
      return text(`clicked ${args.ref || args.selector}`);
    },
  },
  {
    name: "type",
    description: "Click into an element and type text with real key events. Optionally clear it first and/or press Enter.",
    inputSchema: {
      type: "object",
      properties: {
        ...target,
        text: { type: "string" },
        clear: { type: "boolean", default: false },
        submit: { type: "boolean", default: false, description: "Press Enter afterwards" },
        ...tabArg,
      },
      required: ["text"],
    },
    run: async args => {
      const c = await ctx(args.tab);
      const el = await element(c, args);
      await clickEl(c, el);
      if (args.clear) {
        await callFn(c, e => {
          if ("value" in e) {
            e.value = "";
            e.dispatchEvent(new Event("input", { bubbles: true }));
          } else if (e.isContentEditable) {
            e.textContent = "";
          }
        }, [el]);
      }
      const actions = [];
      for (const ch of args.text) {
        actions.push({ type: "keyDown", value: ch }, { type: "keyUp", value: ch });
      }
      if (args.submit) actions.push({ type: "keyDown", value: KEYS.enter }, { type: "keyUp", value: KEYS.enter });
      await bidi.send("input.performActions", {
        context: c,
        actions: [{ type: "key", id: "mercury-mcp-keyboard", actions }],
      });
      return text(`typed ${args.text.length} characters${args.submit ? " and pressed Enter" : ""}`);
    },
  },
  {
    name: "press_key",
    description: "Press a key or chord in the focused element, e.g. Enter, Escape, Tab, ArrowDown, Control+a.",
    inputSchema: { type: "object", properties: { key: { type: "string" }, ...tabArg }, required: ["key"] },
    run: async ({ key, tab }) => {
      await keyChord(await ctx(tab), key);
      return text(`pressed ${key}`);
    },
  },
  {
    name: "console_logs",
    description: "Console messages and JS errors collected since the server connected (newest last).",
    inputSchema: {
      type: "object",
      properties: {
        all_tabs: { type: "boolean", default: false },
        clear: { type: "boolean", default: false },
        limit: { type: "integer", default: 100 },
        ...tabArg,
      },
    },
    run: async ({ all_tabs = false, clear = false, limit = 100, tab }) => {
      const c = await ctx(tab);
      const entries = bidi.logs.filter(e => all_tabs || e.context === c).slice(-limit);
      if (clear) bidi.logs = [];
      return text(entries.length ? entries.map(e => `[${e.level}] ${e.type}: ${e.text}`).join("\n") : "(no console messages)");
    },
  },
];

const EVAL_TOOL = {
  name: "evaluate",
  description:
    "Run a JavaScript expression in the page and return its JSON value. " +
    "Only available because the server was started with --allow-eval.",
  inputSchema: { type: "object", properties: { expression: { type: "string" }, ...tabArg }, required: ["expression"] },
  run: async ({ expression, tab }) => {
    const c = await ctx(tab);
    const r = await bidi.send("script.evaluate", {
      expression,
      target: { context: c },
      awaitPromise: true,
      resultOwnership: "none",
    });
    if (r.type === "exception") return { ...text(`exception: ${r.exceptionDetails?.text}`), isError: true };
    return text(JSON.stringify(plain(r.result), null, 2) ?? "undefined");
  },
};
if (OPTS.allowEval) TOOLS.push(EVAL_TOOL);

// --------------------------------------------------------- MCP over stdio --

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notification
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "mercury-mcp", version: VERSION },
        instructions:
          "Controls a Mercury browser. Use snapshot to read the page and get [eN] refs, then click/type by ref.",
      });
      return;
    }
    case "ping":
      reply(id, {});
      return;
    case "tools/list":
      reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      return;
    case "tools/call": {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) {
        replyError(id, -32602, `unknown tool ${params?.name}`);
        return;
      }
      try {
        reply(id, await tool.run(params.arguments || {}));
      } catch (e) {
        reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
      return;
    }
    default:
      replyError(id, -32601, `method not found: ${method}`);
  }
}

// Requests are handled one at a time, in order.
let queue = Promise.resolve();
const rl = createInterface({ input: process.stdin });
rl.on("line", line => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    replyError(null, -32700, "parse error");
    return;
  }
  queue = queue.then(() => handle(msg)).catch(e => log(e.stack));
});
rl.on("close", async () => {
  await queue;
  await bidi.close();
  process.exit(0);
});
