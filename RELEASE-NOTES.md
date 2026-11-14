Mercury 160.0 for Linux x86-64-v3 (AVX2 required).

Built from Firefox FIREFOX_160_0_RELEASE with Mercury privacy defaults, optional Hardened mode, de-Google changes and opt-in MCP browser control.

This release retains the locally tested PGO/LTO native binaries and refreshes the frontend resources with the corrected search configuration. Google, Bing, eBay and Perplexity are removed. DuckDuckGo is the default search engine.

Arch Linux: `paru -S mercury-browser-bin`.

The package installs to `/opt/mercury`; launch it with `mercury-browser`. MCP control remains off unless launched with `--mcp`. The MCP client script and setup instructions are in `mcp/README.md` in the release source.
