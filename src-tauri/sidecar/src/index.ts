import { query, type Query, type Options, type SDKMessage, type SubagentStartHookInput, type SubagentStopHookInput } from '@anthropic-ai/claude-agent-sdk';
import * as readline from 'readline';

// Message types for conversation history restoration
interface HistoryUserMessage {
  type: 'user';
  content: string;
}

interface HistoryAssistantMessage {
  type: 'assistant';
  content: string;
}

interface HistoryToolUseMessage {
  type: 'tool_use';
  tool: string;
  input: unknown;
}

interface HistoryToolResultMessage {
  type: 'tool_result';
  tool: string;
  output: string;
}

type HistoryMessage = HistoryUserMessage | HistoryAssistantMessage | HistoryToolUseMessage | HistoryToolResultMessage;

// Types for IPC messages
interface CreateMessage {
  type: 'create';
  id: string;
  cwd: string;
  model?: string;
  system_prompt?: string;
  messages?: HistoryMessage[]; // Conversation history for restored sessions
  options?: Partial<Options>;
}

interface ImageData {
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  base64Data: string;
  width?: number;
  height?: number;
}

interface QueryMessage {
  type: 'query';
  id: string;
  prompt: string;
  images?: ImageData[];
}

interface CloseMessage {
  type: 'close';
  id: string;
}

interface StopMessage {
  type: 'stop';
  id: string;
}

interface UpdateModelMessage {
  type: 'update_model';
  id: string;
  model: string;
}

interface UpdateThinkingMessage {
  type: 'update_thinking';
  id: string;
  maxThinkingTokens: number | null;
}

type InboundMessage = CreateMessage | QueryMessage | CloseMessage | StopMessage | UpdateModelMessage | UpdateThinkingMessage;

interface Session {
  cwd: string;
  options: Options;
  abortController?: AbortController;
  queryIterator?: Query; // The active query iterator for interrupt()
  sdkSessionId?: string; // Track the SDK's internal session ID for resume
  conversationHistory?: HistoryMessage[]; // Conversation history for restored sessions
  maxThinkingTokens?: number; // Extended thinking budget (null/undefined = off)
  currentQueryId?: string; // Unique ID for the current query (to detect stale done events)
}

const sessions = new Map<string, Session>();

function send(msg: object): void {
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
}

function sendText(id: string, content: string): void {
  send({ type: 'text', id, content });
}

function sendToolStart(id: string, tool: string, input: unknown): void {
  send({ type: 'tool_start', id, tool, input });
}

function sendToolResult(id: string, tool: string, output: string): void {
  send({ type: 'tool_result', id, tool, output });
}

function sendDone(id: string): void {
  send({ type: 'done', id });
}

function sendUsage(id: string, usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  contextWindow: number;
}): void {
  send({ type: 'usage', id, ...usage });
}

// Progressive usage during streaming (from assistant messages)
function sendProgressiveUsage(id: string, usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): void {
  send({ type: 'progressive_usage', id, ...usage });
}

function sendError(id: string, message: string): void {
  send({ type: 'error', id, message });
}

function sendSubagentStart(id: string, agentId: string, agentType: string): void {
  send({ type: 'subagent_start', id, agentId, agentType });
}

function sendSubagentStop(id: string, agentId: string, transcriptPath: string): void {
  send({ type: 'subagent_stop', id, agentId, transcriptPath });
}

async function handleCreate(msg: CreateMessage): Promise<void> {
  const options: Options = {
    cwd: msg.cwd,
    permissionMode: 'acceptEdits',
    // Load CLAUDE.md and settings from filesystem like Claude Code does
    settingSources: ['user', 'project', 'local'],
    ...(msg.model && { model: msg.model }),
    ...(msg.system_prompt && { systemPrompt: msg.system_prompt }),
    ...msg.options,
  };

  sessions.set(msg.id, {
    cwd: msg.cwd,
    options,
    conversationHistory: msg.messages, // Store conversation history for restored sessions
  });

  if (msg.messages && msg.messages.length > 0) {
    send({ type: 'debug', id: msg.id, message: `Session created with ${msg.messages.length} history messages` });
  }

  send({ type: 'created', id: msg.id });
}

// Content block types for multimodal prompts (matching Anthropic API format)
type TextBlock = { type: 'text'; text: string };
type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
type ContentBlock = TextBlock | ImageBlock;

// SDKUserMessage type for streaming input (matches SDK types)
interface SDKUserMessageForInput {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  parent_tool_use_id: null;
  session_id: string;
}

/**
 * Format conversation history into a context string for the prompt.
 * This allows Claude to understand what happened before in the conversation.
 */
function formatConversationHistory(messages: HistoryMessage[]): string {
  if (!messages || messages.length === 0) return '';

  const parts: string[] = [];
  parts.push('<conversation_history>');
  parts.push('The following is the history of our previous conversation. Please continue from where we left off:');
  parts.push('');

  for (const msg of messages) {
    switch (msg.type) {
      case 'user':
        parts.push(`[User]: ${msg.content}`);
        break;
      case 'assistant':
        parts.push(`[Assistant]: ${msg.content}`);
        break;
      case 'tool_use':
        parts.push(`[Assistant used tool "${msg.tool}"]: ${JSON.stringify(msg.input)}`);
        break;
      case 'tool_result':
        // Truncate very long tool outputs
        const output = msg.output.length > 500 ? msg.output.slice(0, 500) + '...[truncated]' : msg.output;
        parts.push(`[Tool "${msg.tool}" result]: ${output}`);
        break;
    }
  }

  parts.push('');
  parts.push('</conversation_history>');
  parts.push('');
  parts.push('Continue the conversation based on the history above. Here is the new request:');
  parts.push('');

  return parts.join('\n');
}

// Build content blocks for multimodal prompts (text + images)
function buildContentBlocks(prompt: string, images?: ImageData[]): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];

  // Add image blocks first
  if (images) {
    for (const img of images) {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType,
          data: img.base64Data,
        },
      });
    }
  }

  // Only add text block if there's actual text content
  // Empty text blocks with cache_control cause API errors
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt) {
    contentBlocks.push({
      type: 'text',
      text: trimmedPrompt,
    });
  }
  // If no text and no images, contentBlocks will be empty - caller should handle

  return contentBlocks;
}

// Create an async iterable that yields a single SDKUserMessage for multimodal prompts
async function* createUserMessageStream(prompt: string, images: ImageData[], sessionId: string): AsyncGenerator<SDKUserMessageForInput> {
  const contentBlocks = buildContentBlocks(prompt, images);

  yield {
    type: 'user',
    message: {
      role: 'user',
      content: contentBlocks,
    },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

async function handleQuery(msg: QueryMessage): Promise<void> {
  const session = sessions.get(msg.id);
  if (!session) {
    sendError(msg.id, 'Session not found');
    return;
  }

  // Generate a unique query ID to track this specific query
  // This prevents stale done/error events from affecting newer queries
  const queryId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // If there's already a query in progress, interrupt it first
  // This prevents race conditions where the old query's 'done' event arrives after the new query starts
  if (session.queryIterator) {
    send({ type: 'debug', id: msg.id, message: 'Previous query still in progress, interrupting it first...' });
    try {
      await session.queryIterator.interrupt();
      send({ type: 'debug', id: msg.id, message: 'Previous query interrupted successfully' });
    } catch (err) {
      send({ type: 'debug', id: msg.id, message: `Error interrupting previous query: ${err}` });
      // Fall back to abort controller if interrupt fails
      if (session.abortController) {
        session.abortController.abort();
      }
    }
    session.queryIterator = undefined;
    session.abortController = undefined;
  }

  // Set this as the current query BEFORE starting
  session.currentQueryId = queryId;

  const hasImages = msg.images && msg.images.length > 0;
  const hasHistory = session.conversationHistory && session.conversationHistory.length > 0 && !session.sdkSessionId;
  send({ type: 'debug', id: msg.id, message: `Starting query ${queryId} with prompt: ${msg.prompt.slice(0, 100)}... (images: ${msg.images?.length ?? 0}, history: ${session.conversationHistory?.length ?? 0})` });

  try {
    // Create abort controller for this query
    const abortController = new AbortController();
    session.abortController = abortController;

    send({ type: 'debug', id: msg.id, message: `Calling SDK query()... resume=${session.sdkSessionId || 'none'}` });
    send({ type: 'debug', id: msg.id, message: `Options: cwd=${session.options.cwd}, pathToClaudeCodeExecutable=${session.options.pathToClaudeCodeExecutable}` });

    // If this is a restored session without an SDK session ID, prepend conversation history
    // (After first query, we'll have an sdkSessionId and can use the SDK's built-in resume)
    let promptToSend = msg.prompt;
    if (hasHistory) {
      const historyContext = formatConversationHistory(session.conversationHistory!);
      promptToSend = historyContext + msg.prompt;
      send({ type: 'debug', id: msg.id, message: `Prepended ${session.conversationHistory!.length} history messages to prompt` });
    }

    // Build the prompt - for images we need to use AsyncIterable<SDKUserMessage>
    // For text-only prompts we can use a simple string
    let promptInput: string | AsyncGenerator<SDKUserMessageForInput>;
    if (hasImages) {
      // Use the session ID if we have one, otherwise use the message ID as placeholder
      const sessionId = session.sdkSessionId || msg.id;
      promptInput = createUserMessageStream(promptToSend, msg.images!, sessionId);
      send({ type: 'debug', id: msg.id, message: `Built multimodal prompt stream with ${msg.images!.length} image(s)` });
    } else {
      promptInput = promptToSend;
    }

    // Common options for both text and multimodal queries
    const queryOptions = {
      ...session.options,
      abortController,
      // Resume from previous session if we have one
      resume: session.sdkSessionId,
      // Capture stderr for debugging
      stderr: (data: string) => {
        send({ type: 'debug', id: msg.id, message: `[stderr] ${data}` });
      },
      // Hook callbacks for subagent lifecycle events
      hooks: {
        SubagentStart: [{
          hooks: [async (input: SubagentStartHookInput) => {
            sendSubagentStart(msg.id, input.agent_id, input.agent_type);
            return { continue: true };
          }],
        }],
        SubagentStop: [{
          hooks: [async (input: SubagentStopHookInput) => {
            sendSubagentStop(msg.id, input.agent_id, input.agent_transcript_path);
            return { continue: true };
          }],
        }],
      },
    };

    // Use the query function from the SDK
    let queryIterator;
    try {
      // The SDK accepts either a string or AsyncIterable<SDKUserMessage> for prompt
      queryIterator = query({
        prompt: promptInput as string, // Type assertion - SDK accepts both
        options: queryOptions,
      });
    } catch (spawnError) {
      send({ type: 'debug', id: msg.id, message: `Failed to create query: ${spawnError}` });
      sendError(msg.id, `Failed to spawn query: ${spawnError}`);
      return;
    }

    // Store the query iterator on the session so we can call interrupt() on it
    session.queryIterator = queryIterator;

    send({ type: 'debug', id: msg.id, message: `Query iterator created, starting iteration...` });

    let messageCount = 0;
    for await (const message of queryIterator) {
      messageCount++;
      send({ type: 'debug', id: msg.id, message: `Received message #${messageCount}: type=${message.type}` });
      try {
        // Capture SDK session ID from system init message for resume
        if (message.type === 'system' && message.subtype === 'init') {
          session.sdkSessionId = message.session_id;
          send({ type: 'debug', id: msg.id, message: `Captured SDK session ID: ${message.session_id}` });
        }
        handleSdkMessage(msg.id, message);
      } catch (err) {
        send({ type: 'debug', id: msg.id, message: `Error handling message: ${err}` });
      }
    }

    send({ type: 'debug', id: msg.id, message: `Query ${queryId} complete, received ${messageCount} messages` });

    // Only emit done if this query is still the current one
    // This prevents stale done events from affecting newer queries
    if (session.currentQueryId === queryId) {
      sendDone(msg.id);
    } else {
      send({ type: 'debug', id: msg.id, message: `Query ${queryId} was superseded by ${session.currentQueryId}, not emitting done` });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    send({ type: 'debug', id: msg.id, message: `Query ${queryId} error: ${errorMessage}\n${errorStack}` });

    // Only emit error if this query is still the current one
    if (session.currentQueryId === queryId) {
      sendError(msg.id, errorMessage);
    } else {
      send({ type: 'debug', id: msg.id, message: `Query ${queryId} was superseded, not emitting error` });
    }
  } finally {
    // Only clear the iterator/controller if this is still the current query
    if (session.currentQueryId === queryId) {
      session.abortController = undefined;
      session.queryIterator = undefined;
    }
  }
}

function handleSdkMessage(id: string, message: SDKMessage): void {
  switch (message.type) {
    case 'assistant':
      // Assistant message with content blocks
      send({ type: 'debug', id, message: `Assistant message has ${message.message.content.length} content blocks` });
      for (const block of message.message.content) {
        send({ type: 'debug', id, message: `Content block type: ${block.type}` });
        if (block.type === 'text') {
          send({ type: 'debug', id, message: `Text content: ${block.text.slice(0, 100)}` });
          sendText(id, block.text);
        } else if (block.type === 'tool_use') {
          sendToolStart(id, block.name, block.input);
        }
      }
      // Send progressive usage data from assistant message if available
      if (message.message.usage) {
        const usage = message.message.usage;
        sendProgressiveUsage(id, {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        });
      }
      break;

    case 'partial_assistant':
      // Streaming partial message
      if (message.delta?.text) {
        sendText(id, message.delta.text);
      }
      break;

    case 'result':
      // Final result message - send usage data and handle errors
      if (message.subtype === 'success') {
        // Extract usage data from successful result
        const modelUsageValues = Object.values(message.modelUsage || {});
        const contextWindow = modelUsageValues.length > 0 ? modelUsageValues[0].contextWindow : 200000;

        sendUsage(id, {
          inputTokens: message.usage?.input_tokens || 0,
          outputTokens: message.usage?.output_tokens || 0,
          cacheReadTokens: message.usage?.cache_read_input_tokens || 0,
          cacheCreationTokens: message.usage?.cache_creation_input_tokens || 0,
          totalCostUsd: message.total_cost_usd || 0,
          durationMs: message.duration_ms || 0,
          durationApiMs: message.duration_api_ms || 0,
          numTurns: message.num_turns || 0,
          contextWindow,
        });
      } else if (message.subtype === 'error' || message.subtype === 'error_tool_use') {
        // Still send usage data even for errors (if available)
        if (message.usage) {
          const modelUsageValues = Object.values(message.modelUsage || {});
          const contextWindow = modelUsageValues.length > 0 ? modelUsageValues[0].contextWindow : 200000;

          sendUsage(id, {
            inputTokens: message.usage?.input_tokens || 0,
            outputTokens: message.usage?.output_tokens || 0,
            cacheReadTokens: message.usage?.cache_read_input_tokens || 0,
            cacheCreationTokens: message.usage?.cache_creation_input_tokens || 0,
            totalCostUsd: message.total_cost_usd || 0,
            durationMs: message.duration_ms || 0,
            durationApiMs: message.duration_api_ms || 0,
            numTurns: message.num_turns || 0,
            contextWindow,
          });
        }
        sendError(id, message.error || 'Unknown error');
      }
      // Don't send result.result as text - it duplicates the assistant message content
      break;

    case 'system':
      // System messages - don't send init to UI, we handle it above
      // Could add other system message handling here if needed
      break;

    case 'auth_status':
      // Authentication status
      if (message.isAuthenticating) {
        sendText(id, '[Authenticating...]');
      }
      if (message.error) {
        sendError(id, `Authentication error: ${message.error}`);
      }
      break;

    case 'tool_progress':
      // Tool is running
      sendText(id, `[${message.tool_name}: ${message.elapsed_time_seconds.toFixed(1)}s]`);
      break;

    default:
      // Log unknown message types for debugging
      send({ type: 'debug', id, message: `Unknown SDK message type: ${(message as { type: string }).type}` });
  }
}

async function handleStop(msg: StopMessage): Promise<void> {
  const session = sessions.get(msg.id);
  if (!session) {
    sendError(msg.id, 'Session not found');
    return;
  }

  // Use interrupt() on the query iterator - this is the proper way to stop
  // the query and all subagents. The abort controller alone doesn't properly
  // stop subagents that are already running.
  if (session.queryIterator) {
    send({ type: 'debug', id: msg.id, message: 'Interrupting query via iterator.interrupt()...' });
    try {
      await session.queryIterator.interrupt();
      send({ type: 'debug', id: msg.id, message: 'Query interrupted successfully' });
    } catch (err) {
      send({ type: 'debug', id: msg.id, message: `Error interrupting query: ${err}` });
      // Fall back to abort controller if interrupt fails
      if (session.abortController) {
        session.abortController.abort();
      }
    }
    session.queryIterator = undefined;
    session.abortController = undefined;
  } else if (session.abortController) {
    send({ type: 'debug', id: msg.id, message: 'No query iterator, falling back to abortController.abort()...' });
    session.abortController.abort();
    session.abortController = undefined;
  } else {
    send({ type: 'debug', id: msg.id, message: 'No active query to stop' });
  }
}

async function handleUpdateModel(msg: UpdateModelMessage): Promise<void> {
  const session = sessions.get(msg.id);
  if (!session) {
    sendError(msg.id, 'Session not found');
    return;
  }

  // Update the model in the session options
  session.options.model = msg.model;
  send({ type: 'model_updated', id: msg.id, model: msg.model });
}

async function handleUpdateThinking(msg: UpdateThinkingMessage): Promise<void> {
  const session = sessions.get(msg.id);
  if (!session) {
    sendError(msg.id, 'Session not found');
    return;
  }

  // Update the thinking tokens in the session
  // null means thinking is off, a number sets the budget
  session.maxThinkingTokens = msg.maxThinkingTokens ?? undefined;

  // Also update the options for future queries
  if (msg.maxThinkingTokens) {
    session.options.maxThinkingTokens = msg.maxThinkingTokens;
  } else {
    delete session.options.maxThinkingTokens;
  }

  // If there's an active query, use setMaxThinkingTokens to update it dynamically
  if (session.queryIterator) {
    try {
      await session.queryIterator.setMaxThinkingTokens(msg.maxThinkingTokens);
      send({ type: 'debug', id: msg.id, message: `Updated thinking tokens on active query: ${msg.maxThinkingTokens}` });
    } catch (err) {
      send({ type: 'debug', id: msg.id, message: `Failed to update thinking on active query: ${err}` });
    }
  }

  send({ type: 'thinking_updated', id: msg.id, maxThinkingTokens: msg.maxThinkingTokens });
}

async function handleClose(msg: CloseMessage): Promise<void> {
  const session = sessions.get(msg.id);
  if (session) {
    // Use interrupt() if we have an active query
    if (session.queryIterator) {
      try {
        await session.queryIterator.interrupt();
      } catch {
        // Ignore errors during close
      }
    } else if (session.abortController) {
      session.abortController.abort();
    }
  }
  sessions.delete(msg.id);
  send({ type: 'closed', id: msg.id });
}

async function handleMessage(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case 'create':
      await handleCreate(msg);
      break;
    case 'query':
      await handleQuery(msg);
      break;
    case 'stop':
      await handleStop(msg);
      break;
    case 'update_model':
      await handleUpdateModel(msg);
      break;
    case 'update_thinking':
      await handleUpdateThinking(msg);
      break;
    case 'close':
      await handleClose(msg);
      break;
    default:
      sendError('unknown', `Unknown message type: ${(msg as { type: string }).type}`);
  }
}

// Set up readline for JSON line protocol
const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', async (line: string) => {
  try {
    const msg = JSON.parse(line) as InboundMessage;
    await handleMessage(msg);
  } catch (err) {
    sendError('unknown', err instanceof Error ? err.message : String(err));
  }
});

// Handle process errors - log but don't crash
process.on('uncaughtException', (err) => {
  send({ type: 'debug', id: 'process', message: `Uncaught exception: ${err.message}\n${err.stack}` });
  sendError('process', `Uncaught exception: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  send({ type: 'debug', id: 'process', message: `Unhandled rejection: ${reason}` });
  sendError('process', `Unhandled rejection: ${reason}`);
});

// Handle stdin close gracefully
process.stdin.on('close', () => {
  send({ type: 'debug', id: 'process', message: 'stdin closed, exiting' });
  process.exit(0);
});

process.stdin.on('error', (err) => {
  send({ type: 'debug', id: 'process', message: `stdin error: ${err.message}` });
});

// Keep process alive
process.stdin.resume();

// Log startup
send({ type: 'ready' });
send({ type: 'debug', id: 'process', message: 'Sidecar started successfully' });
