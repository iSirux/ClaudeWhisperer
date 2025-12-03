import { query, type Query, type Options, type SDKMessage, type SubagentStartHookInput, type SubagentStopHookInput } from '@anthropic-ai/claude-agent-sdk';
import * as readline from 'readline';

// Types for IPC messages
interface CreateMessage {
  type: 'create';
  id: string;
  cwd: string;
  model?: string;
  system_prompt?: string;
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

type InboundMessage = CreateMessage | QueryMessage | CloseMessage | StopMessage | UpdateModelMessage;

interface Session {
  cwd: string;
  options: Options;
  abortController?: AbortController;
  queryIterator?: Query; // The active query iterator for interrupt()
  sdkSessionId?: string; // Track the SDK's internal session ID for resume
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

  sessions.set(msg.id, { cwd: msg.cwd, options });
  send({ type: 'created', id: msg.id });
}

// Content block types for multimodal prompts
type TextBlock = { type: 'text'; text: string };
type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };
type ContentBlock = TextBlock | ImageBlock;

// Build content blocks for multimodal prompts (text + images)
function buildPromptContent(prompt: string, images?: ImageData[]): string | ContentBlock[] {
  // If no images, just return the string prompt (simpler path)
  if (!images || images.length === 0) {
    return prompt;
  }

  // Build content blocks array with images first, then text
  const contentBlocks: ContentBlock[] = [];

  // Add image blocks
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

  // Add text block
  contentBlocks.push({
    type: 'text',
    text: prompt,
  });

  return contentBlocks;
}

async function handleQuery(msg: QueryMessage): Promise<void> {
  const session = sessions.get(msg.id);
  if (!session) {
    sendError(msg.id, 'Session not found');
    return;
  }

  const hasImages = msg.images && msg.images.length > 0;
  send({ type: 'debug', id: msg.id, message: `Starting query with prompt: ${msg.prompt.slice(0, 100)}... (images: ${msg.images?.length ?? 0})` });

  try {
    // Create abort controller for this query
    const abortController = new AbortController();
    session.abortController = abortController;

    send({ type: 'debug', id: msg.id, message: `Calling SDK query()... resume=${session.sdkSessionId || 'none'}` });
    send({ type: 'debug', id: msg.id, message: `Options: cwd=${session.options.cwd}, pathToClaudeCodeExecutable=${session.options.pathToClaudeCodeExecutable}` });

    // Build the prompt - either string or content blocks with images
    const promptContent = buildPromptContent(msg.prompt, msg.images);
    if (hasImages) {
      send({ type: 'debug', id: msg.id, message: `Built multimodal prompt with ${msg.images!.length} image(s)` });
    }

    // Use the query function from the SDK
    let queryIterator;
    try {
      // The SDK accepts either a string or content blocks array for prompt
      queryIterator = query({
        prompt: promptContent as string, // Type assertion - SDK accepts both
        options: {
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
        },
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

    send({ type: 'debug', id: msg.id, message: `Query complete, received ${messageCount} messages` });
    sendDone(msg.id);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    send({ type: 'debug', id: msg.id, message: `Query error: ${errorMessage}\n${errorStack}` });
    sendError(msg.id, errorMessage);
  } finally {
    session.abortController = undefined;
    session.queryIterator = undefined;
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
