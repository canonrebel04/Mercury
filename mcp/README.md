# Mercury MCP control (experimental)

> **Status: experimental.** This is meant for a future merge once it has been
> tested on real Mercury builds. It's off unless you turn it on.

`mercury-mcp` is a small [Model Context Protocol](https://modelcontextprotocol.io)
server. It lets an LLM client, such as Claude Desktop or Cursor, open pages,
read them, click, type and take screenshots in Mercury.

```
MCP client  <-- stdio (MCP JSON-RPC) -->  mercury-mcp.mjs  <-- WebDriver BiDi (WebSocket, 127.0.0.1) -->  Mercury
```

- **No browser code.** The browser side is the WebDriver BiDi
  **Remote Agent** that ships in every Firefox, Mercury included. Mercury
  doesn't patch it. Like in stock Firefox, it starts only when the browser
  is launched with `--remote-debugging-port`.
- **One file, no dependencies.** The server is a single Node.js script
  ([`mercury-mcp.mjs`](mercury-mcp.mjs)) with no `npm install` step. It uses
  Node's built-in `WebSocket`, so it needs Node.js 22 or newer.
- **Only runs on demand.** Your MCP client starts the server when it needs it.
  The server doesn't start, install or change the browser.

## 1. Start Mercury with MCP control

Linux (`.deb` / tarball launcher):

```sh
mercury-browser --mcp                  # visible window, random port
mercury-browser --mcp --mcp-headless   # no window
mercury-browser --mcp --mcp-port 9333  # fixed port instead of a random one
mercury-browser --mcp --mcp-profile ~/my-agent-profile
```

`--mcp` starts Mercury with these options:

| Option passed to Mercury | Why |
|---|---|
| `--profile $XDG_DATA_HOME/mercury-mcp/profile` (mode 0700) | Separate **automation profile**, so the agent never sees your everyday cookies, logins and history. Change it with `--mcp-profile`. |
| `--no-remote` | Lets this instance run next to your normal Mercury window. |
| `--remote-debugging-port 0` | Starts the built-in Remote Agent on a random free port. Firefox always binds it to localhost (`127.0.0.1`). |
| `--remote-allow-hosts localhost,127.0.0.1` | Refuses requests whose `Host` header isn't loopback, which blocks DNS-rebinding attacks. |
| *(no `--remote-allow-origins`)* | The Remote Agent refuses any request that carries an `Origin` header, so web pages can't connect to it. |

Firefox writes the port it picked to
`<profile>/WebDriverBiDiServer.json`. The MCP server reads it from there.

**Windows / macOS** don't have the launcher script yet. Start Mercury with the
same flags yourself:

```sh
# macOS
/Applications/Mercury.app/Contents/MacOS/mercury --no-remote \
  --profile ~/Library/Application\ Support/mercury-mcp/profile \
  --remote-debugging-port 0 --remote-allow-hosts localhost,127.0.0.1
# Windows (PowerShell)
& "C:\Program Files\Mercury\mercury.exe" --no-remote `
  --profile "$env:LOCALAPPDATA\mercury-mcp\profile" `
  --remote-debugging-port 0 --remote-allow-hosts localhost,127.0.0.1
```

Then point the server at that profile with `--profile <dir>`, or pick a fixed
port and use `--port <port>`.

While the Remote Agent runs, Mercury shows Firefox's **remote-control
indicator** (striped address bar and a robot icon). Mercury keeps it on
purpose, so you can always see that the browser is being controlled.

## 2. Add the server to your MCP client

The server is `mcp/mercury-mcp.mjs` in this repository. Copy the `mcp/`
folder anywhere you like. In the examples below, `/path/to/Mercury/mcp` stands
for that folder.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mercury": {
      "command": "node",
      "args": ["/path/to/Mercury/mcp/mercury-mcp.mjs"]
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "mercury": {
      "command": "node",
      "args": ["/path/to/Mercury/mcp/mercury-mcp.mjs"]
    }
  }
}
```

**Other clients** (VS Code, Claude Code, Zed, Windsurf, Cline, ...): add a
*stdio* server whose command is `node /path/to/Mercury/mcp/mercury-mcp.mjs`.
For example, with Claude Code:
`claude mcp add mercury -- node /path/to/Mercury/mcp/mercury-mcp.mjs`.

Server options:

| Option | Meaning |
|---|---|
| `--profile <dir>` | Automation profile the browser was started with. Default: `$XDG_DATA_HOME/mercury-mcp/profile`, the same as `mercury-browser --mcp`. |
| `--port <n>` | Connect to `ws://127.0.0.1:<n>/session`. Use this with `--mcp-port`. |
| `--ws-url <url>` | A full WebDriver BiDi URL. Only loopback addresses are accepted. |
| `--allow-eval` | Adds the `evaluate` tool. See [Security](#security). Off by default. |
| `--timeout <s>` | Timeout for each browser command. Default: 30 seconds. |

Each option can also be set with an environment variable:
`MERCURY_MCP_PROFILE`, `MERCURY_MCP_PORT`, `MERCURY_MCP_WS_URL` and
`MERCURY_MCP_ALLOW_EVAL=1`.

The server connects to the browser on the first tool call, not at startup.
You can register it once and start Mercury with `--mcp` only when you want to
use it.

## Tools

| Tool | What it does |
|---|---|
| `list_tabs`, `new_tab`, `select_tab`, `close_tab` | Manage tabs. Commands go to the selected tab unless you pass `tab` (an index or id). |
| `navigate`, `back`, `forward`, `reload` | Move between pages. `navigate` waits until the page has loaded. |
| `snapshot` | A short text outline of the visible page: headings, text, links, buttons and form fields. Each element you can interact with gets a ref like `[e3]`. The snapshot only reads the page and never changes its DOM. |
| `get_text` | The page's visible text (`innerText`), shortened if it's long. |
| `screenshot` | A PNG of the viewport, or of the whole page with `full_page`. `save_to` also writes it to a file. |
| `click` | Clicks an element given as a snapshot `ref` or a CSS `selector`, using real WebDriver mouse input. |
| `type` | Clicks into an element and types with real key events. `clear` empties the field first; `submit` presses Enter at the end. |
| `press_key` | Presses a key or a key combination, such as `Enter`, `Escape`, `ArrowDown` or `Control+a`. |
| `console_logs` | Console messages and JS errors the page logged since the server connected. |
| `evaluate` | **Only available with `--allow-eval`.** Runs a JavaScript expression in the page and returns the result. |

Firefox allows one WebDriver session at a time, so only one MCP client can
drive the browser at once. The server ends its session when the client stops
it, and the next client can then connect.

## Security

- **Localhost only.** The Remote Agent listens only on `127.0.0.1`. It refuses
  connections whose `Origin` is a web page and connections whose `Host` isn't
  loopback, so websites, including DNS-rebinding attacks, can't reach it.
  The automated test checks both.
- **Anyone on your computer can control the browser while it's on.** Firefox's
  Remote Agent has no password or token. Any program running as any user on
  this machine that finds the port has full control of that browser instance.
  It can read pages, cookies and logins in that profile, and it can click and
  type anywhere. The random port and the private profile folder make the port
  harder to find, but a local port scan can still find it. Only use `--mcp` on
  a machine you trust, and close that browser when you're done.
- **Use the separate profile.** Don't point `--mcp-profile` at your everyday
  profile. Whatever is logged in there is available to the agent, and to
  anything else on the machine, while MCP control is on.
- **Prompt injection.** Pages can contain text written to trick an LLM. Review
  what the agent does, especially on sites where you're logged in.
- **`evaluate` runs arbitrary JavaScript** in the page, with the page's
  cookies and the logins in the automation profile, as written by the LLM or
  by any page text that manipulates it. It's off unless you start the server
  with `--allow-eval`. Without it, the tool isn't listed and calls to it are
  rejected.
- **Nothing is hidden.** The browser shows that it's under remote control.
  `navigator.webdriver` is `true` in pages, as in stock Firefox. Mercury
  doesn't try to hide automation from websites.

## Performance: zero cost when unused

- **No browser code.** This feature adds no patch, pref, component, listener,
  thread or startup code to the browser
  (`git diff degoogle -- patches/ browser/ app/ policies/` is empty).
  The Remote Agent is Firefox's own. With no `--remote-debugging-port` flag,
  it handles that flag at startup and stops, exactly as in stock Firefox.
- **The launcher change only runs with `--mcp`.** Without it, the wrapper runs
  the same command line as before.
- **The server isn't part of the browser.** It runs only while an MCP client
  has started it.

The automated test starts the browser through the wrapper without `--mcp`. It
checks that no `WebDriverBiDiServer.json` is written and that the browser has
no listening TCP socket.

## Test

```sh
MERCURY_BIN=/usr/lib/mercury/mercury node mcp/test/e2e.mjs
# or with any Firefox 159 release binary:
MERCURY_BIN=/path/to/firefox/firefox node mcp/test/e2e.mjs
```

The test:

1. Starts the browser headless with the real `mercury-browser` wrapper
   (`MERCURY_BIN` picks the binary).
2. Checks the security properties of the Remote Agent.
3. Starts `mercury-mcp.mjs` as a stdio MCP server and calls its tools like an
   MCP client would: navigate, snapshot, click, type, press_key, screenshot,
   console_logs, history, tabs, and `evaluate` with and without opt-in.

## Want more tools? firefox-devtools-mcp

Mozilla's [firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp)
(MIT OR Apache-2.0) is a much bigger server built on Selenium and geckodriver.
It adds network inspection, a DevTools-style toolset and preset tool groups.
It also works with Mercury: either launch Mercury through it with
`--firefox-path /usr/lib/mercury/mercury --profile-path <automation profile>`,
or attach it to a running Mercury with `--connect-existing`. Attaching needs
Mercury started with `--marionette --remote-debugging-port`.
`mercury-mcp` borrows some of its ideas (snapshot refs for click and type, and
keeping script evaluation out of the default tools) but contains none of its
code.
