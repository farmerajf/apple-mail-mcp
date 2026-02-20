# Apple Mail MCP Server

MCP server for Apple Mail on macOS via JXA (JavaScript for Automation). Read, search, and compose emails programmatically through the Model Context Protocol.

## Requirements

- macOS with Apple Mail configured
- Node.js 18+
- Automation permissions: System Settings > Privacy & Security > Automation > allow your terminal/app to control Mail

## Setup

```bash
npm install
npm run build
```

Create a `config.json` in the project root:

```json
{
  "port": 3032,
  "apiKey": "your-secret-key",
  "draftMode": false,
  "excludeMailboxes": ["Junk", "Deleted Messages"]
}
```

## Usage

### Stdio (for Claude Desktop / Claude Code)

```bash
node dist/index.js --stdio
```

Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-mail": {
      "command": "node",
      "args": ["/path/to/apple-mail-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

### HTTP (for remote clients)

```bash
npm start
```

Starts an HTTP server with Streamable HTTP transport. Endpoint: `http://localhost:{port}/{apiKey}/mcp`

## Tools

### Reading

| Tool | Description |
|------|-------------|
| `list_accounts` | List all configured mail accounts |
| `list_mailboxes` | List mailboxes for an account or all accounts |
| `get_mailbox_summary` | Unread counts and recent activity overview |
| `list_messages` | List messages in a mailbox with pagination |
| `get_message` | Get full message content, recipients, and attachment metadata |
| `search_messages` | Search across mailboxes by query, sender, subject, date, flags |

### Composing

All compose tools create **drafts only** — emails are never sent programmatically. Drafts appear in the Drafts folder and sync across devices for review before sending.

| Tool | Description |
|------|-------------|
| `send_message` | Create a new email draft |
| `reply_to_message` | Create a reply draft |
| `forward_message` | Create a forward draft |

### Managing

| Tool | Description |
|------|-------------|
| `move_message` | Move a message to a different mailbox |
| `mark_message` | Set read/unread, flagged, or color flag (supports bulk) |
| `delete_message` | Move to trash or permanently delete (supports bulk) |

## Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | — | HTTP server port |
| `apiKey` | string | — | API key for HTTP auth (passed in URL path) |
| `basePath` | string | `""` | External base path for reverse proxy setups |
| `draftMode` | boolean | `false` | Legacy option (compose is always draft-only now) |
| `excludeMailboxes` | string[] | `["Junk", "Deleted Messages"]` | Mailboxes to skip in search |

Transport is selected by CLI flag: `--stdio` for stdio, otherwise HTTP.

## Architecture

All Apple Mail interaction happens through JXA scripts executed via `osascript`. Key performance patterns:

- **Batch property access** (`mb.messages.subject()`) for listing and searching — fetches all values in a single IPC call
- **`whose({id:...})`** for single-message lookup — narrows the reference so subsequent property access is fast, even in mailboxes with 20k+ messages
- **Unicode sanitization** strips U+2028/2029 (line/paragraph separators), U+FFFC, and control characters that break JSON transport
