# Feature: MCP Server Support

## Overview
Add support for external MCP (Model Context Protocol) servers to Claude Whisperer, allowing users to extend Claude's capabilities with custom tools from stdio-based processes and remote HTTP/SSE servers. MCP servers can be configured globally or associated with specific repositories, and are started on-demand when sessions need them.

## Requirements
Based on user preferences:
- **Server Types**: Stdio + HTTP/SSE (local processes and remote servers)
- **Configuration**: Global + Per-repository MCP server associations
- **Lifecycle**: On-demand startup (lazy loading when sessions need them)
- **UI**: Settings tab only (add/edit/remove servers, no runtime controls)
- **Import**: One-time import from Claude Desktop's `claude_desktop_config.json`

## Decisions Made
| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Server types | Stdio + HTTP/SSE | Covers most use cases: local tools via stdio, remote services via HTTP/SSE |
| Configuration scope | Global + Per-repo | Flexibility to have common tools available everywhere plus project-specific tools |
| Server lifecycle | On-demand | Saves resources by only starting servers when actually needed |
| UI complexity | Settings only | Keeps UI simple, users manage servers in settings, no runtime indicators needed |
| Config import | One-time only | Users can import existing Claude Desktop config without ongoing sync complexity |

## Alternatives Considered
- **Auto-start on app launch**: Rejected - wastes resources if user doesn't need MCP tools in current session
- **Per-session server selection**: Rejected - adds UI complexity; per-repo covers most use cases
- **Full management UI with logs**: Rejected - overkill for v1; can add status indicators later if needed
- **Continuous sync with Claude Desktop**: Rejected - adds complexity and potential conflicts

## Implementation Plan

### Phase 1: Configuration & Types
Add MCP server configuration to the Rust config system:

- [ ] Add `McpServerType` enum (Stdio, Http, Sse) in `config.rs`
- [ ] Add `McpServerConfig` struct with fields:
  - `id: String` - Unique identifier
  - `name: String` - Display name
  - `server_type: McpServerType`
  - `command: Option<String>` - For stdio servers
  - `args: Option<Vec<String>>` - For stdio servers
  - `env: Option<HashMap<String, String>>` - Environment variables
  - `url: Option<String>` - For HTTP/SSE servers
  - `enabled: bool` - Whether server is active
- [ ] Add `McpConfig` struct to `AppConfig`:
  - `servers: Vec<McpServerConfig>` - Global MCP servers
  - `import_path: Option<String>` - Path to imported claude_desktop_config.json
- [ ] Add `mcp_servers: Option<Vec<String>>` to `RepoConfig` (list of server IDs to use for this repo)
- [ ] Create TypeScript types in `src/lib/types/mcp.ts` mirroring Rust types

### Phase 2: Import from Claude Desktop
Add ability to import MCP servers from Claude Desktop's config:

- [ ] Add `import_mcp_servers` command in `src-tauri/src/commands/mcp_cmds.rs`:
  - Reads `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or equivalent paths
  - Parses the `mcpServers` object from Claude Desktop config
  - Converts to our `McpServerConfig` format
  - Returns list of servers for user to select which to import
- [ ] Add frontend import dialog in settings tab
- [ ] Handle path conversion (Claude Desktop uses different path formats)

### Phase 3: Settings UI
Create MCP settings tab for managing servers:

- [ ] Create `src/lib/components/settings/McpTab.svelte`:
  - List of configured MCP servers with name, type, status badge
  - Add new server form (type selector, command/url input, args, env vars)
  - Edit existing server (inline or modal)
  - Delete server with confirmation
  - Import from Claude Desktop button
  - Test connection button for HTTP/SSE servers
- [ ] Add "MCP Servers" option to per-repo settings in `ReposTab.svelte`:
  - Multi-select dropdown to associate servers with repository
  - Shows which global servers are enabled for this repo

### Phase 4: Sidecar Integration
Pass MCP server configs to the sidecar for session creation:

- [ ] Extend `CreateMessage` type in sidecar to accept `mcp_servers` config:
  ```typescript
  interface McpServerConfig {
    id: string;
    name: string;
    type: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
  }
  ```
- [ ] Modify `handleCreate()` to register MCP servers with the SDK:
  - For stdio servers: Use `McpStdioServerConfig` format
  - For HTTP servers: Use `McpHttpServerConfig` format
  - For SSE servers: Use `McpSSEServerConfig` format
- [ ] Add server configs to `Options.mcpServers` object
- [ ] Update `Options.allowedTools` to include MCP tool prefixes

### Phase 5: Rust Backend Commands
Add Tauri commands for MCP management:

- [ ] Create `src-tauri/src/commands/mcp_cmds.rs`:
  - `get_mcp_servers()` - Return all configured servers
  - `add_mcp_server(config)` - Add new server to config
  - `update_mcp_server(id, config)` - Update existing server
  - `delete_mcp_server(id)` - Remove server from config
  - `import_mcp_servers()` - Import from Claude Desktop
  - `test_mcp_server(id)` - Test HTTP/SSE server connectivity
- [ ] Register commands in `lib.rs`
- [ ] Add to command handler in frontend

### Phase 6: Session Integration
Wire MCP servers into session creation flow:

- [ ] Update `sdkSessions.ts` `createSession()`:
  - Determine which MCP servers to include based on:
    1. If repo has specific MCP servers configured, use those
    2. Otherwise, include all enabled global servers
  - Pass server configs to sidecar via create message
- [ ] Update `src-tauri/src/commands/sdk_cmds.rs` `create_sdk_session()`:
  - Accept MCP server configs
  - Forward to sidecar in create message
- [ ] Update `src-tauri/src/sidecar.rs` `OutboundMessage::Create`:
  - Add `mcp_servers: Vec<McpServerConfig>` field

### Phase 7: Testing & Documentation
- [ ] Test stdio MCP server (e.g., filesystem MCP server)
- [ ] Test HTTP/SSE MCP server connectivity
- [ ] Test per-repo MCP server association
- [ ] Test import from Claude Desktop config
- [ ] Update CLAUDE.md with MCP configuration documentation

## Technical Details

### Claude Desktop Config Format
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem"],
      "env": {}
    },
    "remote-api": {
      "url": "http://localhost:3000/mcp",
      "transport": "sse"
    }
  }
}
```

### SDK MCP Server Config Types
From `@anthropic-ai/claude-agent-sdk`:
```typescript
// Stdio server
{ command: string, args?: string[], env?: Record<string, string> }

// HTTP server
{ url: string }

// SSE server
{ url: string }
```

### Config Location
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

## Open Questions
1. Should we validate MCP server configs before saving? (e.g., check command exists)
2. How should we handle MCP server startup failures? (silent fail vs error toast)
3. Should we add a way to view available tools from an MCP server before using it?
4. Should per-repo MCP settings override global or merge with global?

## File Changes Summary

### New Files
- `src-tauri/src/commands/mcp_cmds.rs` - MCP Tauri commands
- `src/lib/components/settings/McpTab.svelte` - MCP settings UI
- `src/lib/types/mcp.ts` - TypeScript MCP types

### Modified Files
- `src-tauri/src/config.rs` - Add MCP config types
- `src-tauri/src/lib.rs` - Register MCP commands
- `src-tauri/src/commands/mod.rs` - Export MCP commands
- `src-tauri/src/commands/sdk_cmds.rs` - Pass MCP configs to sidecar
- `src-tauri/src/sidecar.rs` - Add MCP to OutboundMessage
- `src-tauri/sidecar/src/index.ts` - Register external MCP servers
- `src/lib/stores/sdkSessions.ts` - Include MCP servers in session creation
- `src/routes/settings/+page.svelte` - Add MCP tab
- `CLAUDE.md` - Document MCP configuration
