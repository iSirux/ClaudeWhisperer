// MCP (Model Context Protocol) server types

/** MCP server transport type */
export type McpServerType = 'stdio' | 'http' | 'sse';

/** MCP server authentication type */
export type McpAuthType = 'none' | 'bearer_token' | 'oauth';

/** OAuth 2.1 configuration for MCP servers */
export interface McpOAuthConfig {
  /** OAuth client ID (public, safe to store in config) */
  client_id?: string;
  /** Authorization endpoint URL */
  authorization_url?: string;
  /** Token endpoint URL */
  token_url?: string;
  /** Scopes to request (space-separated) */
  scopes?: string;
  /** Redirect URI for OAuth callback */
  redirect_uri?: string;
}

/** Configuration for an individual MCP server */
export interface McpServerConfig {
  /** Unique identifier for this server */
  id: string;
  /** Display name */
  name: string;
  /** Transport type (stdio, http, sse) */
  server_type: McpServerType;
  /** Command to run (for stdio servers) */
  command?: string;
  /** Command arguments (for stdio servers) */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** URL endpoint (for HTTP/SSE servers) */
  url?: string;
  /** Whether this server is enabled */
  enabled: boolean;
  /** Authentication type for HTTP/SSE servers */
  auth_type?: McpAuthType;
  /** OAuth configuration (when auth_type is 'oauth') */
  oauth?: McpOAuthConfig;
  /** Custom headers for HTTP/SSE servers */
  headers?: Record<string, string>;
}

/** Global MCP configuration */
export interface McpConfig {
  /** List of global MCP servers */
  servers: McpServerConfig[];
}

/** MCP server runtime status */
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Runtime state for an MCP server in a session */
export interface McpServerState {
  id: string;
  name: string;
  status: McpServerStatus;
  /** Number of tools available from this server */
  toolCount?: number;
  /** Error message if status is 'error' */
  error?: string;
}
