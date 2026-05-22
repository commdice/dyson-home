# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a monorepo containing three independent AI/agent projects plus a subproject:

- **opcode** — Desktop GUI for Claude Code management (TypeScript/React + Rust/Tauri)
- **space-agent** — Browser-first AI agent with Node.js server (JavaScript/Vue)
- **OpenJarvis** — Personal AI framework for on-device LLMs (Python + Rust extensions)
- **projects/claude/smart-connections-mcp** — MCP server for Obsidian Smart Connections (TypeScript/Node.js)

Each project is fully independent with its own toolchain.

---

## opcode

Desktop app using Tauri 2 (Rust backend) + React 18/Vite 6 frontend, managed with Bun. Has a `justfile` for common tasks.

### Commands
```bash
cd opcode
bun install              # install frontend deps
bun run tauri dev        # dev mode (or: just dev)
bun run tauri build      # production build (or: just build)
bunx tsc --noEmit        # type-check frontend
cd src-tauri && cargo test  # run Rust tests
cargo fmt                # format Rust
cargo check              # check Rust
```

### Architecture
- `src/` — React frontend: components, UI, hooks
- `src-tauri/src/` — Rust backend
  - `commands/` — Tauri IPC command handlers (frontend↔backend bridge)
  - `checkpoint/` — Timeline/versioning system
  - `process/` — Process lifecycle management
- `.github/workflows/` — CI: `build-test.yml`, `build-linux.yml`, `build-macos.yml`, `release.yml`, Claude Code review workflows

---

## space-agent

Browser-first AI agent with a thin Node.js server and a hierarchical frontend module system.

### Commands
```bash
cd space-agent
npm install
npm run dev              # start dev server
node server/dev_server.js  # alternative dev start
npm run desktop:dev      # Electron dev mode
npm run desktop:dist     # Electron production build
node space serve         # production server
```

### Architecture
The frontend uses a layered module system (L0/L1/L2) in `app/`:
- `app/L0/_all/mod/` — Core foundational modules
- `app/share/` — Shared utilities
- `server/` — Node.js backend: `app.js`, `server.js`, `api/`, `router/`, `lib/`
- `commands/` — CLI command definitions

---

## OpenJarvis

Python AI framework for on-device LLMs. Uses `uv` as the package manager, with optional Rust extensions built via `maturin`.

### Commands
```bash
cd OpenJarvis
uv sync                           # install base deps
uv sync --extra server            # include FastAPI server
uv sync --extra dev               # include test/dev deps
uv run maturin develop            # build Rust extensions
uv run pytest tests/ -v           # run tests
uv run pre-commit install         # set up pre-commit hooks (ruff)
```

### Architecture
- `src/openjarvis/` — Main package
  - `agents/` — Agent implementations
  - `engine/` — Inference engine abstractions
  - `channels/` — Integrations (Discord, Telegram, etc.)
  - `evals/` — Evaluation framework
  - `learning/` — Model optimization/training
  - `skills/` — Tool libraries
  - `tools/` — Execution tools
  - `mcp/` — Model Context Protocol support
  - `cli/` — Command-line interface
- `rust/` — Rust extension modules (Cargo workspace)
- `tests/` — pytest test suite
- Docs generated via MkDocs (`mkdocs.yml`)
- CI: `ci.yml` (tests), `pypi-publish.yml` (releases), Claude Code review workflows

---

## projects/claude/smart-connections-mcp

MCP server for Obsidian Smart Connections. TypeScript/Node.js, security-first design.

### Commands
```bash
cd projects/claude/smart-connections-mcp
npm install
npm run build
tsc --noEmit             # type check
```

---

## Toolchain Quick Reference

| Project | Package Manager | Runtime |
|---------|----------------|---------|
| opcode  | Bun + Cargo    | Node.js + Rust |
| space-agent | npm       | Node.js 20+ |
| OpenJarvis  | uv + Cargo | Python 3.10+ |
| smart-connections-mcp | npm | Node.js |
