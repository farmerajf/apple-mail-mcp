# Apple Mail MCP Server

MCP server providing programmatic access to Apple Mail on macOS via JXA.

## Build & Run

```bash
npm install
npm run build    # tsc → dist/
npm start        # node dist/index.js
npm run dev      # tsc --watch
```

## Transport modes

Configured via `config.json` (or `CONFIG_PATH` env var), CLI args (`--stdio`/`--sse`), or `MCP_TRANSPORT` env var. CLI args take priority.

- **stdio** (default): For Claude Desktop and local use
- **sse**: HTTP server with SSE transport for remote access (Claude Web, iOS, etc.)

SSE mode requires `port` and `apiKey` in config.json. Auth uses API key in the URL path: `GET /:apiKey/sse`, `POST /:apiKey/messages`. Optional `basePath` for reverse proxy support (e.g. Tailscale Funnel with `--set-path`).

## Architecture

- **Entry point**: `src/index.ts` — transport selection (stdio vs SSE/Express)
- **Config**: `src/config.ts` — loads config.json, validates per transport mode
- **Server**: `src/server.ts` — registers all MCP tools with Zod schemas
- **JXA layer**: `src/jxa/` — each file exports functions that build JXA scripts and execute them via `osascript -l JavaScript`
  - `executor.ts` — runs JXA scripts as child processes, parses JSON output
  - `accounts.jxa.ts` — account listing
  - `mailboxes.jxa.ts` — mailbox listing and summary
  - `messages.jxa.ts` — message list, get, search, move, mark, delete
  - `compose.jxa.ts` — send, reply, forward
- **Types**: `src/types.ts`
- **Utils**: `src/utils.ts` — deep link builder, text helpers

## Key patterns

- All JXA scripts read args from `__args` env var (JSON), output JSON to stdout
- JXA scripts are embedded as template strings in TypeScript — not separate files
- The executor has configurable timeouts (30s default, 60s for searches)
- All tools return consistent error format: `{ error: string }`
- SSE mode creates a new McpServer instance per connection (same pattern as obsidian-mcp-server)

## Configuration

`config.json` at project root (or path via `CONFIG_PATH` env var):

```json
{
  "transport": "stdio",
  "port": 3031,
  "apiKey": "your-secret-key",
  "basePath": "/apple-mail-mcp",
  "draftMode": false,
  "excludeMailboxes": ["Junk", "Deleted Messages"]
}
```

Env var overrides: `MAIL_DEFAULT_ACCOUNT`, `MAIL_DRAFT_MODE`.
