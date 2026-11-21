# Second Brain

One long-term memory that all your AI assistants share. Tell Claude something on Monday and ChatGPT,
Cursor, Gemini or a shell script can use it on Tuesday.

```
 Claude Code ─┐                                   ┌─ ~/SecondBrain/
 Claude Desktop├─ MCP (stdio) ──┐                  │    fact/pos-vlan-0f5acd3fda.md
 Cursor/VS Code┘                │                  │    preference/…md
                                ├──► Brain store ──┤    project/…md       ← plain Markdown, the source of truth
 claude.ai / phone ─ MCP (HTTP) ┤                  │    .brain/index.db   ← search index, rebuildable
 ChatGPT GPT ─ REST + OpenAPI ──┤                  │    .trash/           ← "forgotten" memories, recoverable
 scripts / n8n ─ REST or CLI ───┘                  └─ (open it in Obsidian, sync it with git)
```

**Design choices**

- **Your data is plain files.** One Markdown file per memory, with front matter. Readable without this
  software, opens as an Obsidian vault, backs up with git/OneDrive/Syncthing. No vendor lock-in.
- **Search is SQLite FTS5** (built into Node 22, BM25 ranking, stemming, prefix match), boosted by
  importance, pinning and recency. Delete `.brain/` any time and it rebuilds from the files.
- **Hand edits are picked up.** Edit a file in Obsidian or add one; every interface sees it within ~2 s.
- **Nothing is ever lost to an over-eager AI**: `forget` moves files to `.trash/`.
- **Every memory records which assistant saved it** (`source`), so you can see who wrote what.
- **Only two dependencies** (the official MCP SDK and zod). No database server, no cloud account.

## Install

Needs Node.js 22.13 or newer.

```bash
cd projects/second-brain
npm install
npm test                      # 9 tests: store, REST, MCP over HTTP and stdio
npm link                      # optional: puts `brain` on your PATH
```

The vault lives at `~/SecondBrain` unless you set `BRAIN_VAULT`. Point every platform at the same folder.

## Run it on your NAS (recommended)

A NAS is the natural home: always on, already backed up, reachable from every PC on the network.
One container holds the memory, and every app connects to it over the LAN.

```
 PC: Claude Code / Desktop / Cursor / VS Code ─┐
 Laptop (via Tailscale when away) ─────────────┼──► NAS: second-brain container :7777 ──► /volume1/SecondBrain
 Scripts, n8n, Home Assistant ─────────────────┘                                      (snapshots + Hyper Backup)
```

Works with any NAS that runs containers: **Synology** (Container Manager), **QNAP** (Container
Station), **TrueNAS SCALE**, **Unraid**, or plain Docker.

1. Make a shared folder for the memories, e.g. `/volume1/SecondBrain`.
2. Copy this project folder to the NAS, e.g. `/volume1/docker/second-brain`.
3. `cp .env.example .env` and set:
   - `BRAIN_TOKEN`: a long random string (`openssl rand -hex 32`). This is the password.
   - `VAULT_DIR`: the folder from step 1.
   - `PUID` / `PGID`: the NAS user that owns that folder (SSH in and run `id`; on Synology it's often `1026` / `100`).
   - `BRAIN_PUBLIC_URL`: how your PCs reach the NAS, e.g. `http://192.168.1.20:7777` or `http://nas.local:7777`.
4. Start it: `docker compose up -d`, or in Synology Container Manager → **Project** → Create → pick the folder.
5. Check it: open `http://NAS-IP:7777/health` in a browser. It should say `{"ok": true}`.

Then connect each app to `http://NAS-IP:7777/mcp` (configs below). The container restarts by itself,
reports its health to the NAS, and keeps everything in your shared folder.

**Do / don't on a NAS**

- **Do** snapshot and back up the vault folder (Btrfs snapshots, Hyper Backup, etc.). It's just Markdown files.
- **Do** browse and edit the vault over SMB from Obsidian or Explorer. The server picks up changes within seconds.
- **Don't** run the local stdio server on a PC against the vault over an SMB/NFS share. The search index is
  SQLite, and SQLite over network shares can corrupt it. Let the NAS container be the only process that
  runs the server, and point apps at its URL.
- **Don't** forward port 7777 on your router. For access away from home, use **Tailscale** (there's a
  Synology/QNAP package): your laptop then reaches `http://nas-name:7777` as if it were at home.

## Memory model

| Field | Meaning |
|---|---|
| `type` | `fact` · `preference` · `person` · `project` · `decision` · `howto` · `note` · `journal` |
| `tags` | lower-case labels, e.g. `network`, `shop` |
| `importance` | 1 (trivial) … 5 (critical); boosts ranking |
| `pinned` | always returned by `context` (good for "who I am" and standing rules) |
| `source` | which assistant or app saved it |
| `[[Title]]` | in content, links to another memory; backlinks are tracked |

## Tools (the same everywhere)

| MCP tool | REST | CLI | What it does |
|---|---|---|---|
| `brain_context` | `GET /context?topic=` | `brain context [topic]` | Load at session start: pinned + key preferences + recent |
| `brain_recall` | `GET /memories?q=&type=&tags=` | `brain search …` | Ranked keyword search with filters |
| `brain_remember` | `POST /memories` | `brain add …` | Save; reports possible duplicates |
| `brain_get` | `GET /memories/{id}` | `brain get <id\|title>` | Full memory with links and backlinks |
| `brain_update` | `PATCH /memories/{id}` | `brain edit <id> --append …` | Replace or append, retag, pin |
| `brain_forget` | `DELETE /memories/{id}` | `brain forget <id>` | Soft delete to `.trash/` |
| `brain_related` | `GET /memories/{id}/related` | `brain related <id>` | Linked, backlinked and similar |
| `brain_stats` | `GET /stats` | `brain stats` | Counts by type, source, tag |

The MCP server also sends assistants instructions on *when* to recall and remember, so they use it
without being told each time.

---

## Connect your platforms to the NAS

Replace `NAS` with your NAS's address and `TOKEN` with your `BRAIN_TOKEN`. The `source=` part labels
which app saved each memory.

**Claude Code**

```bash
claude mcp add --transport http -s user second-brain "http://NAS:7777/mcp?source=claude-code" \
  --header "Authorization: Bearer TOKEN"
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "second-brain": {
    "url": "http://NAS:7777/mcp?source=cursor",
    "headers": { "Authorization": "Bearer TOKEN" } } } }
```

**VS Code** (`.vscode/mcp.json` or user settings):

```json
{ "servers": { "second-brain": { "type": "http",
    "url": "http://NAS:7777/mcp?source=vscode",
    "headers": { "Authorization": "Bearer TOKEN" } } } }
```

**Claude Desktop**: its config file only launches local programs, so use the `mcp-remote` bridge
(needs Node.js on the PC):

```json
{ "mcpServers": { "second-brain": { "command": "npx",
    "args": ["-y", "mcp-remote", "http://NAS:7777/mcp?source=claude-desktop&key=TOKEN", "--allow-http"] } } }
```

**Gemini CLI** (`~/.gemini/settings.json`): `{ "mcpServers": { "second-brain": { "httpUrl": "http://NAS:7777/mcp?source=gemini&key=TOKEN" } } }`

**Codex CLI** (`~/.codex/config.toml`):

```toml
[mcp_servers.second-brain]
url = "http://NAS:7777/mcp?source=codex&key=TOKEN"
```

**Scripts / PowerShell / n8n / Home Assistant**: use the REST API (examples below) at `http://NAS:7777`.

> **claude.ai and ChatGPT on the web or phone are different.** Their connectors call out from
> Anthropic's and OpenAI's servers, not from your device, so they can't see a NAS that's only on your
> LAN. Being on Tailscale on your phone doesn't change that. To use them, publish the NAS server with
> Cloudflare Tunnel or Tailscale Funnel (see "Web and phone apps" below). Otherwise, use the desktop and
> CLI apps above, which reach the NAS directly.

## Connect your platforms without a NAS (single PC)

If everything runs on one computer, apps can start the server themselves over stdio. Replace
`/ABS/PATH` with the full path to this folder.

### Claude Code

```bash
claude mcp add second-brain -s user \
  -e BRAIN_VAULT="$HOME/SecondBrain" -e BRAIN_SOURCE=claude-code \
  -- node --no-warnings /ABS/PATH/src/stdio.js
```

Optional, in `~/.claude/CLAUDE.md`, to make it a habit:

```markdown
Use the second-brain MCP: call brain_context at the start of a task, brain_recall before answering
questions about me or my projects, and brain_remember for durable facts, preferences and decisions.
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "second-brain": {
      "command": "node",
      "args": ["--no-warnings", "/ABS/PATH/src/stdio.js"],
      "env": { "BRAIN_VAULT": "/Users/you/SecondBrain", "BRAIN_SOURCE": "claude-desktop" }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`), Windsurf, Gemini CLI (`~/.gemini/settings.json`)

Same `mcpServers` block as Claude Desktop; change `BRAIN_SOURCE` to `cursor`, `windsurf`, `gemini`.

### VS Code (Copilot agent mode) — `.vscode/mcp.json` or user settings

```json
{ "servers": { "second-brain": { "type": "stdio", "command": "node",
  "args": ["--no-warnings", "/ABS/PATH/src/stdio.js"],
  "env": { "BRAIN_VAULT": "/Users/you/SecondBrain", "BRAIN_SOURCE": "vscode" } } } }
```

### OpenAI Codex CLI — `~/.codex/config.toml`

```toml
[mcp_servers.second-brain]
command = "node"
args = ["--no-warnings", "/ABS/PATH/src/stdio.js"]
env = { BRAIN_VAULT = "/Users/you/SecondBrain", BRAIN_SOURCE = "codex" }
```

### Web and phone apps (claude.ai, ChatGPT) — run the HTTP server

Cloud apps cannot reach files on your PC, so run the server on an always-on machine (home server,
NAS, a small VPS) and publish it over HTTPS.

```bash
export BRAIN_TOKEN=$(openssl rand -hex 32)      # keep this; it is the password
BRAIN_HOST=0.0.0.0 BRAIN_PUBLIC_URL=https://brain.example.com npm run serve
# or: docker build -t second-brain . && docker run -d -p 7777:7777 \
#       -e BRAIN_TOKEN=$BRAIN_TOKEN -e BRAIN_PUBLIC_URL=https://brain.example.com \
#       -v $HOME/SecondBrain:/vault second-brain
```

Put it behind HTTPS with **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:7777`) or
**Tailscale Funnel**, rather than opening a port on your router. The server refuses to listen on a
non-local address without `BRAIN_TOKEN`.

**claude.ai (web, desktop and mobile):** Settings → Connectors → Add custom connector, URL:

```
https://brain.example.com/mcp?source=claude-ai&key=YOUR_TOKEN
```

**ChatGPT (Custom GPT):** Create a GPT → Configure → Actions → *Import from URL*
`https://brain.example.com/openapi.json`. Authentication: API Key, **Bearer**, paste the token.
In the GPT's instructions: *"Call loadContext at the start of each chat. Search with recall before
answering questions about me. Save durable facts and preferences with remember (source: chatgpt)."*
(ChatGPT's developer-mode MCP connectors can also use the `/mcp` URL above with `source=chatgpt`.)

**Anything else** (n8n, Zapier, Home Assistant, iOS Shortcuts, PowerShell):

```bash
curl -H "Authorization: Bearer $BRAIN_TOKEN" -H "X-Brain-Source: shortcut" \
     -d '{"content":"Paint order #4471 delayed to Friday","type":"note","tags":["orders"]}' \
     https://brain.example.com/memories
curl -H "Authorization: Bearer $BRAIN_TOKEN" "https://brain.example.com/memories?q=order+4471"
```

### Local apps and the server at the same time

Stdio and HTTP processes can share one vault simultaneously (files are written atomically; the
index uses SQLite WAL and re-syncs from the files). If the server runs on another machine, sync the
vault folder (Syncthing, git, OneDrive) or point local apps at the HTTP `/mcp` URL instead.

## Configuration

| Variable | Default | |
|---|---|---|
| `BRAIN_VAULT` | `~/SecondBrain` | Vault folder |
| `BRAIN_SOURCE` | client name | Label stored on memories saved via stdio/CLI |
| `BRAIN_HOST` / `BRAIN_PORT` | `127.0.0.1` / `7777` | HTTP bind address |
| `BRAIN_TOKEN` | *(none)* | Required for non-local binding. Bearer header, `X-API-Key`, or `?key=` |
| `BRAIN_PUBLIC_URL` | `http://host:port` | URL written into `/openapi.json` |

## Security notes

- Assistants are told never to store secrets; don't paste passwords into memories either. The vault is
  plain text by design. Put it on an encrypted disk (BitLocker/FileVault) if that matters.
- `?key=` in a URL can end up in proxy logs. It exists because claude.ai connectors can't send custom
  headers; prefer the `Authorization` header everywhere else, and rotate the token if it leaks.
- Anyone with the token can read and change every memory. Treat it like a password.

## Roadmap ideas

- Semantic (embedding) search alongside keywords — e.g. via a local Ollama model or OpenJarvis
- OAuth for the remote MCP endpoint instead of a URL key
- Scheduled "consolidation" that merges duplicate memories and summarises journals
