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
- **Search by meaning and by keywords.** Keyword search is SQLite FTS5 (built into Node 22, BM25
  ranking, stemming, prefix match). Add Ollama and it also finds memories by meaning: "what do we drive?"
  finds "Shop van is a Ford Transit". Delete `.brain/` any time and it rebuilds from the files.
- **Hand edits are picked up.** Edit a file in Obsidian or add one; every interface sees it within ~2 s.
- **Nothing is ever lost to an over-eager AI**: `forget` moves files to `.trash/`.
- **Every memory records which assistant saved it** (`source`), so you can see who wrote what.
- **Only two dependencies** (the official MCP SDK and zod). No database server, no cloud account.

## Install

Needs Node.js 22.13 or newer.

```bash
cd projects/second-brain
npm install
npm test                      # 18 tests: store, semantic search, REST, MCP over HTTP and stdio
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

Then connect each app to `http://NAS-IP:7777/mcp` (configs below). The same compose file also starts
Ollama for [semantic search](#semantic-search-ollama). The first start downloads a ~270 MB model. The container restarts by itself,
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

## Semantic search (Ollama)

Keyword search only finds memories that share words with your question. Semantic search finds them by
**meaning**, using an embedding model running in Ollama on your NAS. Nothing leaves your network.

| You ask | Keyword search | With semantic search |
|---|---|---|
| "what vehicle do we have?" | nothing | **Shop van**: 2019 Ford Transit… |
| "how is the data protected?" | nothing | **Synology backups**: nightly to Hyper Backup… |
| "Ford Transit" | **Shop van** | **Shop van** (matched both ways, ranked first) |

**How it works**

- Every memory is turned into a vector (a list of numbers that captures its meaning) by Ollama and stored
  in the index. This happens in the background, so saving a memory never waits for Ollama.
- A search runs both ways at once and merges the two rankings (Reciprocal Rank Fusion). Results say how
  they matched (`match: keyword | meaning | both`) with a `similarity` score.
- `remember` also flags duplicates by meaning ("Backups go to the Synology nightly" vs "Nightly snapshot
  copies are stored on the NAS"), and `related` lists memories with similar meaning.
- Only new or changed memories are re-embedded. Change the model and everything is re-embedded automatically.
- **If Ollama is down, slow or still downloading, nothing breaks**: search falls back to keywords and says
  so (`"semantic": "unavailable (…); keyword results only"`), and embedding catches up when it's back.

**Setup**: it's already in `docker-compose.yml`. On first start, second-brain asks Ollama to download
the model, then embeds all your memories. Check progress:

```bash
curl -H "Authorization: Bearer TOKEN" http://NAS:7777/stats     # → "semantic": { "state": "idle", "embedded": 120, "total": 120 }
curl http://NAS:7777/health                                      # → { "ok": true, "semantic": "idle" }
```

`state` is `pulling` (downloading the model), `embedding`, `idle` (all done), or `error` (see `lastError`;
a failed download is retried every 10 minutes).

**Choosing a model** (`BRAIN_EMBED_MODEL` in `.env`):

| Model | Size | Good for |
|---|---|---|
| `nomic-embed-text` *(default)* | ~270 MB | English, fast on NAS CPUs (Celeron/Atom/Ryzen) |
| `mxbai-embed-large` | ~670 MB | More accurate English, slower |
| `bge-m3` | ~1.2 GB | Many languages, long notes |
| `embeddinggemma` | ~620 MB | Good all-rounder, multilingual |

**What to expect on a NAS** (rough estimates, not measured on your hardware): no GPU is needed. On a
typical 4-core NAS CPU, `nomic-embed-text` should embed somewhere around 5–20 memories a second the first time (a few thousand memories takes minutes, once), and a
search adds well under a second once the model is loaded. Ollama keeps the model in RAM for 30 minutes
after use (about 0.5 GB with the default model), so the first search after a quiet spell is a few
seconds slower. If the NAS has 4 GB of RAM or less, keep the default model.

**Tuning**

| Variable | Default | |
|---|---|---|
| `OLLAMA_URL` | `http://ollama:11434` in compose; unset elsewhere | Where Ollama is. Empty = semantic search off |
| `BRAIN_EMBED_MODEL` | `nomic-embed-text` | Any Ollama embedding model |
| `BRAIN_MIN_SIMILARITY` | `0.5` | Drop meaning matches below this (0–1). Lower = more, looser results |
| `BRAIN_QUERY_TIMEOUT_MS` | `10000` | How long a search waits for Ollama before using keywords only |

**Already run Ollama** (on the NAS, a gaming PC with a GPU, OpenJarvis…)? Set `OLLAMA_URL` in `.env`
to it and delete the `ollama` service from `docker-compose.yml`. Note that Ollama has no password, so
don't publish its port beyond your LAN.

**CLI**: `OLLAMA_URL=http://NAS:11434 brain embed` embeds anything missing and waits for a model
download if needed. `brain search` shows `~meaning` next to results found by meaning.

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
| `OLLAMA_URL`, `BRAIN_EMBED_MODEL`, … | | See [Semantic search](#semantic-search-ollama) |

## Security notes

- Assistants are told never to store secrets; don't paste passwords into memories either. The vault is
  plain text by design. Put it on an encrypted disk (BitLocker/FileVault) if that matters.
- `?key=` in a URL can end up in proxy logs. It exists because claude.ai connectors can't send custom
  headers; prefer the `Authorization` header everywhere else, and rotate the token if it leaks.
- Anyone with the token can read and change every memory. Treat it like a password.

## Roadmap ideas

- OAuth for the remote MCP endpoint instead of a URL key
- Scheduled "consolidation" that merges duplicate memories and summarises journals
