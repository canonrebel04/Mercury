Mercury 160.0.1 for Linux x86-64-v3 (AVX2 required).

Built from Firefox `FIREFOX_160_0_1_RELEASE` with full PGO + LTO optimizations, Mercury privacy defaults, optional Hardened mode, de-Google changes, and opt-in MCP browser control.

Google, Bing, eBay, and Perplexity are removed from search engines; DuckDuckGo is the default search engine.

Arch Linux / CachyOS: `paru -S mercury-browser-v3-bin` (or install the attached `mercury-browser-v3-bin-160.0.1-1-x86_64.pkg.tar.zst` directly with `sudo pacman -U`).

The package installs to `/opt/mercury`; launch it with `mercury-browser`. MCP control remains off unless launched with `--mcp`. The MCP client script and setup instructions are in `mcp/README.md` in the release source.
