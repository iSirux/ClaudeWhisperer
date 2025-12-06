<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import Terminal from '$lib/components/Terminal.svelte';
  import SdkView from '$lib/components/SdkView.svelte';
  import SessionList from '$lib/components/SessionList.svelte';
  import SessionHeader from '$lib/components/SessionHeader.svelte';
  import Settings from './settings/+page.svelte';
  import Start from '$lib/components/Start.svelte';
  import SessionPendingView from '$lib/components/SessionPendingView.svelte';

  // Refactored components
  import AppHeader from '$lib/components/AppHeader.svelte';
  import SdkSessionHeader from '$lib/components/SdkSessionHeader.svelte';
  import SessionSidebarHeader from '$lib/components/SessionSidebarHeader.svelte';
  import EmptySessionPlaceholder from '$lib/components/EmptySessionPlaceholder.svelte';

  // Composables
  import { useSidebarResize } from '$lib/composables/useSidebarResize.svelte';

  // Stores
  import { sessions, activeSessionId, activeSession } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId, activeSdkSession, type ThinkingLevel, settingsToStoreThinking } from '$lib/stores/sdkSessions';
  import { settings, activeRepo, isAutoRepoSelected } from '$lib/stores/settings';
  import { recording, isRecording, pendingTranscriptions } from '$lib/stores/recording';
  import { overlay } from '$lib/stores/overlay';
  import { openMic, isOpenMicListening } from '$lib/stores/openMic';
  import { loadSessionsFromDisk, saveSessionsToDisk, setupAutoSave, setupPeriodicAutoSave } from '$lib/stores/sessionPersistence';
  import { navigation } from '$lib/stores/navigation';

  // Tauri APIs
  import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { get } from 'svelte/store';

  // Utils
  import { cleanTranscription, recommendModel, recommendRepo, getRepoConfirmationSystemPrompt, isTranscriptionCleanupEnabled, isModelRecommendationEnabled, isRepoAutoSelectEnabled, needsUserConfirmation, buildRepoContextForCleanup, buildAllReposContextForCleanup } from '$lib/utils/llm';
  import { isAutoModel } from '$lib/utils/models';
  import { processVoiceCommand, type VoiceCommandType } from '$lib/utils/voiceCommands';
  import { playRepoSelectedSound, playOpenMicTriggerSound, playVoiceCommandSound } from '$lib/utils/sound';
  import { goto } from '$app/navigation';

  // System prompt for voice-transcribed sessions
  const VOICE_TRANSCRIPTION_SYSTEM_PROMPT =
    "The user's prompt was recorded via voice and transcribed using speech-to-text. " +
    "There may be minor transcription errors such as homophones, missing punctuation, or misheard words. " +
    "Please interpret the intent behind the request even if there are small errors in the transcription.";

  // Sidebar resize composable
  const sidebar = useSidebarResize();

  // Flag to track if we're recording for a new session (header button)
  let isRecordingForNewSession = $state(false);

  // Current view from navigation store (persists across route changes)
  let currentView = $derived($navigation.mainView);
  let settingsTabFromNav = $derived($navigation.settingsTab);
  let isTogglingRecording = false;
  let wasAppFocusedOnRecordStart = true;
  let transcribeHotkeyRegistered = false;
  let cycleRepoHotkeyRegistered = false;
  let cycleModelHotkeyRegistered = false;
  // Store the hotkey strings we registered with, so we can unregister them properly
  let registeredCycleRepoHotkey: string | null = null;
  let registeredCycleModelHotkey: string | null = null;
  let cleanupAutoSave: (() => void) | null = null;
  let cleanupPeriodicSave: (() => void) | null = null;

  // Pending transcription session tracking
  let pendingTranscriptionSessionId: string | null = null;

  // Reference to SdkView for focusing prompt input
  let sdkViewRef: { focusPromptInput: () => void } | undefined;
  let unlistenAudioVisualization: UnlistenFn | null = null;
  let unlistenDiscardRecording: UnlistenFn | null = null;
  let unlistenOpenMicTriggered: UnlistenFn | null = null;
  let unlistenVoiceCommandTriggered: UnlistenFn | null = null;

  // Model cycling uses enabled models from settings
  // Note: Sonnet 1M is excluded from cycling as it's a variant

  // Active SDK session header info
  let activeSdkSessionBranch = $state<string | null>(null);
  const PROMPT_PREVIEW_LENGTH = 80;

  // Computed values for the active SDK session header
  // Return empty string for auto mode (no cwd or cwd is '.')
  let activeSdkRepoName = $derived(
    !$activeSdkSession?.cwd || $activeSdkSession?.cwd === '.'
      ? ''
      : $activeSdkSession?.cwd?.split(/[/\\]/).pop() || $activeSdkSession?.cwd || ''
  );
  let activeSdkFirstPrompt = $derived(() => {
    const firstUserMessage = $activeSdkSession?.messages.find(m => m.type === 'user');
    if (!firstUserMessage?.content) return null;
    const content = firstUserMessage.content.trim();
    if (content.length <= PROMPT_PREVIEW_LENGTH) return content;
    return content.slice(0, PROMPT_PREVIEW_LENGTH) + '…';
  });

  // Effect to fetch branch when active SDK session changes
  $effect(() => {
    const cwd = $activeSdkSession?.cwd;
    // Skip fetching branch for auto mode (empty or '.')
    if (cwd && cwd !== '.') {
      invoke<string>('get_git_branch', { repoPath: cwd })
        .then(b => { activeSdkSessionBranch = b; })
        .catch(() => { activeSdkSessionBranch = null; });
    } else {
      activeSdkSessionBranch = null;
    }
  });

  function handleOpenSettings(event: CustomEvent<{ tab: string }>) {
    navigation.showSettings(event.detail.tab);
  }

  function handleCloseSettings() {
    // Return to sessions view when closing settings
    showSessionsView();
  }

  // Handle repo selection for session event from SessionList
  function handleSelectRepoForSessionEvent(event: CustomEvent<{ sessionId: string; repoIndex: number }>) {
    handleRepoSelectionForSession(event.detail.sessionId, event.detail.repoIndex);
  }

  // Handle focus-sdk-prompt event from SessionList (when new session is created)
  async function handleFocusSdkPrompt() {
    // Wait for the component to be mounted/updated
    await tick();
    sdkViewRef?.focusPromptInput();
  }

  // Track the currently registered toggle_recording hotkey so we can detect changes
  let registeredToggleRecordingHotkey: string | null = null;

  onMount(async () => {
    await settings.load();

    // Apply saved theme
    document.documentElement.setAttribute('data-theme', $settings.theme);

    // Initialize sidebar width from settings
    sidebar.initFromSettings();

    await sessions.load();
    sessions.setupListeners();

    // Load persisted sessions if enabled
    if ($settings.session_persistence.enabled) {
      await loadSessionsFromDisk();
    }

    // If there are sessions and we're still on the start view, switch to sessions view
    // This ensures users see their sessions when returning to the app
    if (($sessions.length > 0 || $sdkSessions.length > 0) && $navigation.mainView === 'start') {
      navigation.setView('sessions');
    }

    // Setup auto-save for session persistence
    cleanupAutoSave = setupAutoSave();
    cleanupPeriodicSave = setupPeriodicAutoSave();

    await setupHotkeys();

    // Listen for session selection from SessionList
    window.addEventListener('switch-to-sessions', showSessionsView);
    // Listen for open-settings events from Start component
    window.addEventListener('open-settings', handleOpenSettings as EventListener);
    // Listen for close-settings events from Settings component
    window.addEventListener('close-settings', handleCloseSettings);
    // Listen for retry-transcription events from SdkView
    window.addEventListener('retry-transcription', handleRetryTranscription as unknown as EventListener);
    // Listen for approve-transcription events from SdkView
    window.addEventListener('approve-transcription', handleApproveTranscription as unknown as EventListener);
    // Listen for repo selection events from SessionList
    window.addEventListener('select-repo-for-session', handleSelectRepoForSessionEvent as unknown as EventListener);
    // Listen for focus-sdk-prompt events from SessionList (new session created)
    window.addEventListener('focus-sdk-prompt', handleFocusSdkPrompt);

    // Listen for discard-recording events from overlay
    unlistenDiscardRecording = await listen('discard-recording', async () => {
      console.log('[Recording] Discard recording event received');

      // Cancel the recording in main window's store (overlay has its own store instance)
      await recording.cancelRecording();

      // Unregister hotkeys
      await unregisterTranscribeHotkey();
      await unregisterCycleRepoHotkey();
      await unregisterCycleModelHotkey();

      // Stop audio visualization listener
      if (unlistenAudioVisualization) {
        unlistenAudioVisualization();
        unlistenAudioVisualization = null;
      }

      // Cancel the pending transcription session if it exists
      if (pendingTranscriptionSessionId) {
        sdkSessions.cancelPendingTranscription(pendingTranscriptionSessionId);
        pendingTranscriptionSessionId = null;
      }

      // Clear active session selection
      activeSdkSessionId.set(null);

      // Reset recording-for-new-session flag
      isRecordingForNewSession = false;
    });

    // Listen for open-mic-triggered events (wake command detected)
    unlistenOpenMicTriggered = await listen<{ command: string }>('open-mic-triggered', async (event) => {
      console.log('[open-mic] Wake command triggered:', event.payload?.command);

      // Don't start if already recording
      if ($isRecording) {
        console.log('[open-mic] Already recording, ignoring trigger');
        return;
      }

      // Play sound cue if enabled
      if ($settings.audio.play_sound_on_open_mic_trigger) {
        playOpenMicTriggerSound();
      }

      // Trigger the same flow as pressing the hotkey to start recording
      await startRecordingFromOpenMic();
    });

    // Listen for voice-command-triggered events (e.g., "go go" detected in Vosk stream)
    unlistenVoiceCommandTriggered = await listen<{ command: string; cleanedTranscript: string; originalTranscript: string; commandType: VoiceCommandType }>(
      'voice-command-triggered',
      async (event) => {
        const commandType = event.payload?.commandType || 'send';
        console.log('[voice-command] Triggered:', event.payload?.command, 'type:', commandType);

        // Only process if currently recording
        if (!$isRecording) {
          console.log('[voice-command] Not recording, ignoring trigger');
          return;
        }

        // Play sound cue if enabled
        if ($settings.audio.play_sound_on_voice_command) {
          playVoiceCommandSound();
        }

        // Unregister hotkeys
        await unregisterTranscribeHotkey();
        await unregisterCycleRepoHotkey();
        await unregisterCycleModelHotkey();

        // Hide overlay
        await overlay.hide();
        overlay.clearSessionInfo();

        // Stop audio visualization listener
        if (unlistenAudioVisualization) {
          unlistenAudioVisualization();
          unlistenAudioVisualization = null;
        }

        // Use the cleaned transcript from the voice command (Vosk real-time)
        const cleanedVoskTranscript = event.payload.cleanedTranscript;

        // Handle transcribe-to-input command type
        if (commandType === 'transcribe') {
          console.log('[voice-command] Stopping recording and transcribing to input...');

          // Cancel the pending transcription session since we're pasting instead of sending
          if (pendingTranscriptionSessionId) {
            sdkSessions.cancelPendingTranscription(pendingTranscriptionSessionId);
            pendingTranscriptionSessionId = null;
          }

          // Reset recording-for-new-session flag
          isRecordingForNewSession = false;

          // Stop recording - don't await so user can start new recording while transcribing
          recording.stopRecording(true).then(async (whisperTranscript) => {
            // Use Whisper transcript if available (more accurate), but strip the voice command
            // If Whisper fails, fall back to the cleaned Vosk transcript
            const transcriptToUse = whisperTranscript
              ? processVoiceCommand(whisperTranscript).cleanedTranscript
              : cleanedVoskTranscript;

            if (transcriptToUse) {
              // Paste the transcript into the currently focused app
              await invoke('paste_text', { text: transcriptToUse });
            }
          });
          return;
        }

        // Handle cancel command type - discard the recording entirely
        if (commandType === 'cancel') {
          console.log('[voice-command] Cancel command detected, discarding recording...');

          // Cancel the pending transcription session
          if (pendingTranscriptionSessionId) {
            sdkSessions.cancelPendingTranscription(pendingTranscriptionSessionId);
            pendingTranscriptionSessionId = null;
          }

          // Reset recording-for-new-session flag
          isRecordingForNewSession = false;

          // Cancel recording - this discards all audio data
          await recording.cancelRecording();
          return;
        }

        // Handle send command type (default)
        console.log('[voice-command] Stopping recording and auto-sending...');

        // Update pending session to transcribing status
        const sessionIdToProcess = pendingTranscriptionSessionId;
        if (sessionIdToProcess) {
          sdkSessions.updatePendingTranscription(sessionIdToProcess, { status: 'transcribing' });
        }

        // Stop recording - this will also trigger Whisper transcription
        // But we'll use the Vosk transcript directly for the voice command flow
        recording.stopRecording(true).then(async (whisperTranscript) => {
          // Store audio data for retry capability
          if (sessionIdToProcess) {
            const audioData = get(recording).audioData;
            if (audioData) {
              sdkSessions.storeAudioData(sessionIdToProcess, audioData);
            }
          }

          // Use Whisper transcript if available (more accurate), but strip the voice command
          // If Whisper fails, fall back to the cleaned Vosk transcript
          if (whisperTranscript) {
            // Process the Whisper transcript to also strip the voice command
            await sendTranscriptDirectly(whisperTranscript, sessionIdToProcess, cleanedVoskTranscript);
          } else if (cleanedVoskTranscript) {
            // Fall back to Vosk transcript if Whisper failed
            await sendTranscriptDirectly(cleanedVoskTranscript, sessionIdToProcess);
          } else if (sessionIdToProcess) {
            // Both failed
            sdkSessions.updatePendingTranscription(sessionIdToProcess, {
              transcriptionError: 'No transcription available',
            });
          }

          // Only clear if still the same session (avoid orphaning sessions created by concurrent flows)
          if (pendingTranscriptionSessionId === sessionIdToProcess) {
            pendingTranscriptionSessionId = null;
          }
        }).catch((error) => {
          console.error('[voice-command] Error stopping recording:', error);
          if (sessionIdToProcess) {
            sdkSessions.updatePendingTranscription(sessionIdToProcess, {
              transcriptionError: error?.message || 'Recording stop failed',
            });
          }
          // Only clear if still the same session (avoid orphaning sessions created by concurrent flows)
          if (pendingTranscriptionSessionId === sessionIdToProcess) {
            pendingTranscriptionSessionId = null;
          }
        });
      }
    );

    // NOTE: Open mic is started by the $effect below, not here in onMount.
    // This avoids race conditions between onMount and the effect both calling start().
  });

  // Re-register hotkeys when the toggle_recording hotkey changes in settings
  $effect(() => {
    const currentHotkey = $settings.hotkeys.toggle_recording;

    // Skip if settings haven't loaded yet or hotkey hasn't changed
    if (!currentHotkey || currentHotkey === registeredToggleRecordingHotkey) {
      return;
    }

    // Only re-register if we've already done initial setup (registeredToggleRecordingHotkey is set)
    if (registeredToggleRecordingHotkey !== null) {
      console.log('[Hotkey] Detected hotkey change, re-registering...', { old: registeredToggleRecordingHotkey, new: currentHotkey });
      setupHotkeys();
    }
  });

  onDestroy(() => {
    window.removeEventListener('switch-to-sessions', showSessionsView);
    window.removeEventListener('open-settings', handleOpenSettings as EventListener);
    window.removeEventListener('close-settings', handleCloseSettings);
    window.removeEventListener('retry-transcription', handleRetryTranscription as unknown as EventListener);
    window.removeEventListener('approve-transcription', handleApproveTranscription as unknown as EventListener);
    window.removeEventListener('select-repo-for-session', handleSelectRepoForSessionEvent as unknown as EventListener);
    window.removeEventListener('focus-sdk-prompt', handleFocusSdkPrompt);

    // Cleanup audio visualization listener
    if (unlistenAudioVisualization) {
      unlistenAudioVisualization();
      unlistenAudioVisualization = null;
    }

    // Cleanup discard recording listener
    if (unlistenDiscardRecording) {
      unlistenDiscardRecording();
      unlistenDiscardRecording = null;
    }

    // Cleanup open mic listener
    if (unlistenOpenMicTriggered) {
      unlistenOpenMicTriggered();
      unlistenOpenMicTriggered = null;
    }

    // Cleanup voice command listener
    if (unlistenVoiceCommandTriggered) {
      unlistenVoiceCommandTriggered();
      unlistenVoiceCommandTriggered = null;
    }

    // Stop open mic listening and clear any pending restart
    if (openMicRestartTimeout) {
      clearTimeout(openMicRestartTimeout);
      openMicRestartTimeout = null;
    }
    openMic.stop();

    // Cleanup auto-save handlers
    if (cleanupAutoSave) cleanupAutoSave();
    if (cleanupPeriodicSave) cleanupPeriodicSave();

    // Cleanup sidebar resize listeners
    sidebar.cleanup();

    // Save sessions one final time on destroy
    saveSessionsToDisk();
  });

  // Manage open mic lifecycle based on settings changes and recording state.
  // This is the SINGLE place that controls open mic start/stop to avoid race conditions.
  // When recording stops, this effect will automatically restart open mic after a short delay.
  let openMicRestartTimeout: ReturnType<typeof setTimeout> | null = null;
  let prevRecording = false;

  $effect(() => {
    const openMicEnabled = $settings.audio.open_mic.enabled;
    const voskEnabled = $settings.vosk?.enabled ?? false;
    const currentlyRecording = $isRecording;
    const currentlyListening = $isOpenMicListening;

    // Detect recording state transition
    const recordingJustStopped = prevRecording && !currentlyRecording;
    prevRecording = currentlyRecording;

    // Clear any pending restart timeout if conditions change
    if (openMicRestartTimeout && (currentlyRecording || !openMicEnabled || !voskEnabled)) {
      clearTimeout(openMicRestartTimeout);
      openMicRestartTimeout = null;
    }

    if (openMicEnabled && voskEnabled) {
      if (currentlyRecording) {
        // Don't start while recording - open mic is stopped before recording starts
      } else if (recordingJustStopped) {
        // Recording just stopped - delay restart to ensure audio resources are released
        if (!currentlyListening && !openMicRestartTimeout) {
          console.log('[open-mic] Recording stopped, scheduling restart');
          openMicRestartTimeout = setTimeout(() => {
            openMicRestartTimeout = null;
            openMic.start();
          }, 500);
        }
      } else if (!currentlyListening) {
        // Not recording, not listening - start immediately (e.g., on app load or settings change)
        openMic.start();
      }
    } else {
      // Stop if currently listening
      if (currentlyListening) {
        openMic.stop();
      }
    }
  });

  async function sendTranscript() {
    if (!$recording.transcript) return;
    // Pass both Whisper and Vosk transcripts for potential dual-source cleanup
    await sendTranscriptDirectly($recording.transcript, null, $recording.realtimeTranscript);
    recording.clearTranscript();
  }

  // Start recording triggered by open mic wake command
  async function startRecordingFromOpenMic() {
    // Don't start if already recording or toggling
    if ($isRecording || isTogglingRecording) {
      return;
    }

    isTogglingRecording = true;

    try {
      // Temporarily stop open mic while recording to avoid mic conflicts
      await openMic.stop();

      // Check if main window is focused before starting
      const mainWindow = getCurrentWindow();
      wasAppFocusedOnRecordStart = await mainWindow.isFocused();

      const repoPath = $activeRepo?.path || '.';
      const model = $settings.default_model;
      const thinkingLevel = settingsToStoreThinking($settings.default_thinking_level);

      // Get current git branch for overlay display
      let branch: string | null = null;
      try {
        branch = await invoke<string>('get_git_branch', { repoPath });
      } catch (e) {
        console.error('Failed to get git branch:', e);
      }

      // Set overlay info
      overlay.setMode('session');
      overlay.setSessionInfo(branch, model, false);

      // Create pending transcription session immediately (SDK mode only)
      // Note: We don't switch the view here (via open mic) - user stays on their current view
      // This matches the hotkey path behavior to avoid jarring the user
      if ($settings.terminal_mode === 'Sdk') {
        pendingTranscriptionSessionId = sdkSessions.createPendingTranscriptionSession(model, thinkingLevel);

        // Set up audio visualization listener to capture waveform data
        unlistenAudioVisualization = await listen<{ data: number[] | null }>('audio-visualization', (event) => {
          if (pendingTranscriptionSessionId && event.payload.data) {
            sdkSessions.addAudioVisualizationSnapshot(pendingTranscriptionSessionId, event.payload.data);
          }
        });
      }

      await recording.startRecording($settings.audio.device_id || undefined);

      // Register hotkeys now that we're recording
      await registerTranscribeHotkey();
      await registerCycleRepoHotkey();
      await registerCycleModelHotkey();

      // Show overlay - always show when triggered by open mic
      await overlay.show();

      console.log('[open-mic] Recording started via wake command');
    } catch (error) {
      console.error('[open-mic] Failed to start recording:', error);
      // Restart open mic if recording failed
      if ($settings.audio.open_mic.enabled && $settings.vosk?.enabled) {
        await openMic.start();
      }
    } finally {
      setTimeout(() => {
        isTogglingRecording = false;
      }, 200);
    }
  }

  // Send a transcript directly (used by queued transcription flow)
  // If pendingSessionId is provided, processes the transcript for that pending session
  // voskTranscript is the real-time Vosk transcription for dual-source cleanup
  async function sendTranscriptDirectly(transcript: string, pendingSessionId?: string | null, voskTranscript?: string) {
    if (!transcript) return;

    // Step 0: Process voice commands - strip any trigger phrases from the transcript
    // This happens FIRST before any other processing
    const voiceCommandResult = processVoiceCommand(transcript);
    let processedTranscript = voiceCommandResult.cleanedTranscript;

    // Also process Vosk transcript if available
    let processedVoskTranscript = voskTranscript;
    if (voskTranscript && voiceCommandResult.commandDetected && voiceCommandResult.detectedCommand) {
      // Strip the same command from Vosk transcript for consistency
      const voskResult = processVoiceCommand(voskTranscript);
      processedVoskTranscript = voskResult.cleanedTranscript;
    }

    if (voiceCommandResult.commandDetected) {
      console.log('[voice-command] Detected:', voiceCommandResult.detectedCommand);
      console.log('[voice-command] Original:', transcript);
      console.log('[voice-command] Cleaned:', processedTranscript);
    }

    // If the cleaned transcript is empty, don't send
    if (!processedTranscript.trim()) {
      console.log('[voice-command] Transcript empty after removing voice command, skipping send');
      if (pendingSessionId) {
        sdkSessions.cancelPendingTranscription(pendingSessionId);
      }
      return;
    }

    // Update pending session status to processing if we have one
    // Store both Whisper transcript and Vosk transcript (if available) for display
    if (pendingSessionId) {
      sdkSessions.updatePendingTranscription(pendingSessionId, {
        status: 'processing',
        transcript: processedTranscript,
        voskTranscript: processedVoskTranscript || undefined,
      });
    }

    if ($settings.terminal_mode === 'Sdk') {
      // SDK mode: process pending session or create new one
      const model = $settings.default_model;
      const thinkingLevel = settingsToStoreThinking($settings.default_thinking_level);

      // Step 1: Clean up transcription FIRST (using all repos context)
      // Do cleanup before repo selection so repo recommendation uses the cleaned transcript
      let finalTranscript = processedTranscript;
      let wasCleanedUp = false;

      if (isTranscriptionCleanupEnabled()) {
        try {
          // Build context from ALL repos for better vocabulary recognition
          const repoContext = buildAllReposContextForCleanup($settings.repos);

          // Pass both Whisper and Vosk transcripts (with voice commands already stripped) for dual-source cleanup
          const cleanupResult = await cleanTranscription(processedTranscript, processedVoskTranscript, repoContext);
          finalTranscript = cleanupResult.text;
          wasCleanedUp = cleanupResult.wasCleanedUp;
          if (wasCleanedUp) {
            console.log('[llm] Transcription cleaned up:', cleanupResult.corrections, cleanupResult.usedDualSource ? '(dual-source)' : '');
          }
          // Update pending session with cleaned transcript and diff info
          if (pendingSessionId) {
            sdkSessions.updatePendingTranscription(pendingSessionId, {
              voskTranscript: processedVoskTranscript || undefined,
              cleanedTranscript: finalTranscript,
              wasCleanedUp,
              cleanupCorrections: cleanupResult.corrections,
              usedDualSource: cleanupResult.usedDualSource,
            });
          }
        } catch (error) {
          console.error('[llm] Transcription cleanup failed, using original:', error);
        }
      }

      // Step 2: Get repo recommendation using the CLEANED transcript
      let repoRecommendation: { repoIndex: number; reasoning: string; confidence: string } | null = null;
      if ($isAutoRepoSelected && isRepoAutoSelectEnabled() && $settings.repos.length > 1) {
        try {
          // Pass isTranscribed=true since this is from voice transcription
          // Use cleaned transcript for better repo matching
          repoRecommendation = await recommendRepo(finalTranscript, true);

          // If LLM couldn't make a recommendation, require user to select
          if (!repoRecommendation) {
            console.log('[llm] No repo recommendation - requiring user selection');
            if (pendingSessionId) {
              // Complete pending transcription with repo selection needed (no recommendation)
              await sdkSessions.completePendingTranscription(
                pendingSessionId,
                '', // No cwd yet
                finalTranscript,
                undefined,
                {
                  transcript: finalTranscript,
                  recommendedIndex: null,
                  reasoning: 'Not enough information to determine repository',
                  confidence: 'low',
                }
              );
              navigation.setView('sessions');
              return; // Exit here - continuation happens via SessionPendingView
            } else {
              // Create a pending session that shows repo selection in the main view
              sdkSessions.createPendingRepoSession(
                model,
                thinkingLevel,
                {
                  transcript: finalTranscript,
                  recommendedIndex: null,
                  reasoning: 'Not enough information to determine repository',
                  confidence: 'low',
                }
              );
              // Don't switch to the session - user can select repo from session list
              return; // Exit here - repo selection happens via SessionList
            }
          }

          // Update pending session with repo recommendation
          if (pendingSessionId) {
            const recommendedRepo = $settings.repos[repoRecommendation.repoIndex];
            sdkSessions.updatePendingTranscription(pendingSessionId, {
              repoRecommendation: {
                repoIndex: repoRecommendation.repoIndex,
                repoName: recommendedRepo?.name || 'Unknown',
                reasoning: repoRecommendation.reasoning,
                confidence: repoRecommendation.confidence,
              },
            });
          }

          // Check if we need user confirmation due to low confidence
          if (needsUserConfirmation(repoRecommendation.confidence)) {
            if (pendingSessionId) {
              // Complete pending transcription with repo selection needed
              await sdkSessions.completePendingTranscription(
                pendingSessionId,
                '', // No cwd yet
                finalTranscript,
                undefined,
                {
                  transcript: finalTranscript,
                  recommendedIndex: repoRecommendation.repoIndex,
                  reasoning: repoRecommendation.reasoning,
                  confidence: repoRecommendation.confidence,
                }
              );
              navigation.setView('sessions');
              return; // Exit here - continuation happens via SessionPendingView
            } else {
              // Create a pending session that shows repo selection in the main view
              sdkSessions.createPendingRepoSession(
                model,
                thinkingLevel,
                {
                  transcript: finalTranscript,
                  recommendedIndex: repoRecommendation.repoIndex,
                  reasoning: repoRecommendation.reasoning,
                  confidence: repoRecommendation.confidence,
                }
              );
              // Don't switch to the session - user can select repo from session list
              return; // Exit here - repo selection happens via SessionList
            }
          }

          // High confidence - use the recommended repo for this session
          // Note: We don't call setActiveRepo because that disables auto mode
          // Instead, we'll pass the repo directly to session creation
          const recommendedRepo = $settings.repos[repoRecommendation.repoIndex];
          if (recommendedRepo) {
            console.log('[llm] Auto selected repo:', recommendedRepo.name, '-', repoRecommendation.reasoning);
          }
        } catch (error) {
          console.error('[llm] Repo recommendation failed, requiring user selection:', error);
          // On error, also require user to select instead of using current repo
          if (pendingSessionId) {
            await sdkSessions.completePendingTranscription(
              pendingSessionId,
              '', // No cwd yet
              finalTranscript,
              undefined,
              {
                transcript: finalTranscript,
                recommendedIndex: null,
                reasoning: 'Failed to get recommendation',
                confidence: 'low',
              }
            );
            navigation.setView('sessions');
            return;
          } else {
            sdkSessions.createPendingRepoSession(
              model,
              thinkingLevel,
              {
                transcript: finalTranscript,
                recommendedIndex: null,
                reasoning: 'Failed to get recommendation',
                confidence: 'low',
              }
            );
            // Don't switch to the session - user can select repo from session list
            return;
          }
        }
      }

      // Determine the repo to use for this session
      // If auto-repo recommended one, use that; otherwise fall back to current activeRepo
      const sessionRepo = repoRecommendation
        ? $settings.repos[repoRecommendation.repoIndex]
        : $activeRepo;

      // Check if we need user approval before sending
      if ($settings.audio.require_transcription_approval) {
        const repoPath = sessionRepo?.path || '.';
        if (pendingSessionId) {
          // Set existing session to pending_approval
          sdkSessions.setPendingApproval(pendingSessionId, finalTranscript, repoPath);
        } else {
          // Create a new session in pending_approval state
          const newSessionId = sdkSessions.createPendingTranscriptionSession(
            $settings.default_model,
            settingsToStoreThinking($settings.default_thinking_level)
          );
          // Set it immediately to pending_approval
          sdkSessions.setPendingApproval(newSessionId, finalTranscript, repoPath);
          activeSdkSessionId.set(newSessionId);
          activeSessionId.set(null);
        }
        navigation.setView('sessions');
        return; // Wait for user approval
      }

      // Continue with session creation/completion
      if (pendingSessionId) {
        await completePendingTranscriptionSession(pendingSessionId, finalTranscript, sessionRepo);
      } else {
        await createSdkSessionWithPrompt(finalTranscript, sessionRepo);
      }
    } else {
      // PTY mode: create terminal session as before
      // For PTY mode, we can still clean up but without repo context
      // Use processedTranscript (voice commands already stripped) as starting point
      let finalTranscript = processedTranscript;
      if (isTranscriptionCleanupEnabled()) {
        try {
          const currentRepo = $activeRepo;
          const repoContext = currentRepo ? buildRepoContextForCleanup(currentRepo) : undefined;
          // Pass both Whisper and Vosk transcripts (with voice commands already stripped) for dual-source cleanup
          const cleanupResult = await cleanTranscription(processedTranscript, processedVoskTranscript, repoContext);
          finalTranscript = cleanupResult.text;
          if (cleanupResult.wasCleanedUp) {
            console.log('[llm] Transcription cleaned up:', cleanupResult.corrections, cleanupResult.usedDualSource ? '(dual-source)' : '');
          }
        } catch (error) {
          console.error('[llm] Transcription cleanup failed, using original:', error);
        }
      }

      // Clear pending session if it exists (PTY mode doesn't use pending sessions)
      if (pendingSessionId) {
        sdkSessions.cancelPendingTranscription(pendingSessionId);
      }
      const sessionId = await sessions.createSession(finalTranscript);
      activeSessionId.set(sessionId);
      activeSdkSessionId.set(null); // Clear SDK session selection
    }
  }

  // Complete a pending transcription session (SDK mode)
  // If overrideRepo is provided, use it instead of $activeRepo (for auto-repo selection)
  async function completePendingTranscriptionSession(sessionId: string, transcript: string, overrideRepo?: typeof $activeRepo) {
    const repo = overrideRepo ?? $activeRepo;
    const repoPath = repo?.path || '.';
    const repoName = repo?.name || '';
    let model = $settings.default_model;
    let thinkingLevel = settingsToStoreThinking($settings.default_thinking_level);

    // Get model recommendation if "Auto" is selected
    if (isAutoModel(model)) {
      if (isModelRecommendationEnabled()) {
        try {
          const recommendation = await recommendModel(transcript);
          if (recommendation) {
            // Update pending session with model recommendation
            sdkSessions.updatePendingTranscription(sessionId, {
              modelRecommendation: {
                modelId: recommendation.modelId,
                reasoning: recommendation.reasoning,
                thinkingLevel: recommendation.thinkingLevel ?? undefined,
              },
            });

            // Only use recommendation if the model is enabled
            if ($settings.enabled_models.includes(recommendation.modelId)) {
              model = recommendation.modelId;
              // Update the session's model
              await sdkSessions.updateSessionModel(sessionId, model);
              console.log('[llm] Auto selected model:', model, '-', recommendation.reasoning);
            } else {
              // Fall back to first enabled model if recommendation is not enabled
              model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
              console.log('[llm] Recommended model not enabled, falling back to:', model);
            }
            // Apply thinking level recommendation if provided
            if (recommendation.thinkingLevel) {
              thinkingLevel = recommendation.thinkingLevel as typeof thinkingLevel;
              await sdkSessions.updateSessionThinking(sessionId, thinkingLevel);
              console.log('[llm] Using recommended thinking level:', thinkingLevel);
            }
          } else {
            // Fallback if no recommendation returned
            model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
            console.log('[llm] No recommendation, falling back to:', model);
          }
        } catch (error) {
          console.error('[llm] Model recommendation failed, falling back to default:', error);
          model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
        }
      } else {
        // Auto model selected but LLM recommendation not enabled - fall back to first enabled model
        model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
        console.log('[llm] Auto model selected but recommendation disabled, falling back to:', model);
      }
    }

    // Build system prompt
    let systemPromptParts: string[] = [];

    // Add voice transcription notice if applicable
    const needsTranscriptionNotice = $settings.audio.include_transcription_notice && !isTranscriptionCleanupEnabled();
    if (needsTranscriptionNotice) {
      systemPromptParts.push(VOICE_TRANSCRIPTION_SYSTEM_PROMPT);
    }

    // Add repo confirmation prompt if applicable
    const otherRepoNames = $settings.repos
      .filter((r) => r.path !== repoPath)
      .map((r) => r.name);
    const repoConfirmationPrompt = getRepoConfirmationSystemPrompt(repoName, otherRepoNames);
    if (repoConfirmationPrompt) {
      systemPromptParts.push(repoConfirmationPrompt);
    }

    const systemPrompt = systemPromptParts.length > 0 ? systemPromptParts.join('\n\n') : undefined;

    // Complete the pending transcription session
    await sdkSessions.completePendingTranscription(sessionId, repoPath, transcript, systemPrompt);
    activeSessionId.set(null); // Clear PTY session selection
  }

  // Handle retry transcription request from SdkView
  async function handleRetryTranscription(event: CustomEvent<{ sessionId: string }>) {
    const sessionId = event.detail.sessionId;

    // Get the session to find the stored audio data
    let session: typeof $sdkSessions[0] | undefined;
    sdkSessions.subscribe(sessions => {
      session = sessions.find(s => s.id === sessionId);
    })();

    if (!session || !session.pendingTranscription?.audioData) {
      console.error('[retry] No audio data available for retry');
      return;
    }

    // Clear the error and set status to transcribing
    sdkSessions.updatePendingTranscription(sessionId, {
      status: 'transcribing',
      transcriptionError: undefined,
    });

    try {
      // Retry the transcription
      const transcript = await invoke<string>('transcribe_audio', {
        audioData: Array.from(session.pendingTranscription.audioData),
      });

      if (transcript) {
        // Process the transcript (no Vosk available on retry)
        await sendTranscriptDirectly(transcript, sessionId, undefined);
      } else {
        // Empty transcription
        sdkSessions.updatePendingTranscription(sessionId, {
          transcriptionError: 'No transcription returned',
        });
      }
    } catch (error) {
      console.error('[retry] Transcription failed:', error);
      sdkSessions.updatePendingTranscription(sessionId, {
        transcriptionError: error instanceof Error ? error.message : 'Transcription failed',
      });
    }
  }

  // Handle approve transcription request from SdkView
  async function handleApproveTranscription(event: CustomEvent<{ sessionId: string; editedPrompt?: string }>) {
    const { sessionId, editedPrompt } = event.detail;

    // Get the session to find its details
    let session: typeof $sdkSessions[0] | undefined;
    sdkSessions.subscribe(sessions => {
      session = sessions.find(s => s.id === sessionId);
    })();

    if (!session) {
      console.error('[approve] Session not found:', sessionId);
      return;
    }

    if (session.status !== 'pending_approval') {
      console.warn('[approve] Session is not pending approval:', session.status);
      return;
    }

    const prompt = editedPrompt || session.pendingApprovalPrompt;
    if (!prompt) {
      console.error('[approve] No prompt to send');
      return;
    }

    // Build system prompt for voice transcription
    let systemPrompt = '';
    if ($settings.audio.include_transcription_notice) {
      const repo = $settings.repos.find(r => r.path === session!.cwd);
      systemPrompt = `The following prompt was voice-transcribed and may contain minor errors or homophones. `;
      if (repo) {
        systemPrompt += `The user is working in the "${repo.name}" repository.`;
      }
    }

    // Call approveAndSend to complete the flow
    try {
      await sdkSessions.approveAndSend(sessionId, editedPrompt, systemPrompt || undefined);
    } catch (error) {
      console.error('[approve] Failed to approve and send:', error);
    }
  }

  // Helper function to create SDK session with the current active repo
  // If overrideRepo is provided, use it instead of $activeRepo (for auto-repo selection)
  async function createSdkSessionWithPrompt(transcript: string, overrideRepo?: typeof $activeRepo) {
    const repo = overrideRepo ?? $activeRepo;
    const repoPath = repo?.path || '.';
    const repoName = repo?.name || '';
    let model = $settings.default_model;
    let thinkingLevel = settingsToStoreThinking($settings.default_thinking_level);

    // Get model recommendation if "Auto" is selected
    if (isAutoModel(model)) {
      if (isModelRecommendationEnabled()) {
        try {
          const recommendation = await recommendModel(transcript);
          if (recommendation) {
            // Only use recommendation if the model is enabled
            if ($settings.enabled_models.includes(recommendation.modelId)) {
              model = recommendation.modelId;
              console.log('[llm] Auto selected model:', model, '-', recommendation.reasoning);
            } else {
              // Fall back to first enabled model if recommendation is not enabled
              model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
              console.log('[llm] Recommended model not enabled, falling back to:', model);
            }
            // Apply thinking level recommendation if provided
            if (recommendation.thinkingLevel) {
              thinkingLevel = recommendation.thinkingLevel as ThinkingLevel;
              console.log('[llm] Using recommended thinking level:', thinkingLevel);
            }
          } else {
            // Fallback if no recommendation returned
            model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
            console.log('[llm] No recommendation, falling back to:', model);
          }
        } catch (error) {
          console.error('[llm] Model recommendation failed, falling back to default:', error);
          model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
        }
      } else {
        // Auto model selected but LLM recommendation not enabled - fall back to first enabled model
        model = $settings.enabled_models[0] || 'claude-sonnet-4-5-20250929';
        console.log('[llm] Auto model selected but recommendation disabled, falling back to:', model);
      }
    }

    // Build system prompt - combine voice transcription notice and repo confirmation prompt
    let systemPromptParts: string[] = [];

    // Add voice transcription notice if applicable
    const needsTranscriptionNotice = $settings.audio.include_transcription_notice && !isTranscriptionCleanupEnabled();
    if (needsTranscriptionNotice) {
      systemPromptParts.push(VOICE_TRANSCRIPTION_SYSTEM_PROMPT);
    }

    // Add repo confirmation prompt if applicable
    const otherRepoNames = $settings.repos
      .filter((r) => r.path !== repoPath)
      .map((r) => r.name);
    const repoConfirmationPrompt = getRepoConfirmationSystemPrompt(repoName, otherRepoNames);
    if (repoConfirmationPrompt) {
      systemPromptParts.push(repoConfirmationPrompt);
    }

    const systemPrompt = systemPromptParts.length > 0 ? systemPromptParts.join('\n\n') : undefined;
    const sessionId = await sdkSessions.createSession(repoPath, model, thinkingLevel, systemPrompt);
    activeSdkSessionId.set(sessionId);

    // Send the prompt to the new SDK session
    await sdkSessions.sendPrompt(sessionId, transcript);
    activeSessionId.set(null); // Clear PTY session selection
  }

  // Handle repo selection for any session (not just active)
  async function handleRepoSelectionForSession(sessionId: string, repoIndex: number, editedPrompt?: string) {
    const session = $sdkSessions.find(s => s.id === sessionId);
    if (!session || session.status !== 'pending_repo') return;

    const selectedRepo = $settings.repos[repoIndex];
    if (!selectedRepo) return;

    // Use edited prompt if provided, otherwise capture the original transcript
    const rawTranscript = editedPrompt || session.pendingPrompt || session.pendingRepoSelection?.transcript || '';

    console.log('[llm] User selected repo for session:', selectedRepo.name);

    // Play confirmation sound if enabled
    if ($settings.audio.play_sound_on_repo_select) {
      playRepoSelectedSound();
    }

    // Update the active repo setting
    await settings.setActiveRepo(repoIndex);

    // Step 1: Clean up transcription with repo context (now that we know the repo)
    let finalTranscript = rawTranscript;
    if (isTranscriptionCleanupEnabled() && rawTranscript) {
      try {
        const repoContext = buildRepoContextForCleanup(selectedRepo);
        const cleanupResult = await cleanTranscription(rawTranscript, undefined, repoContext);
        finalTranscript = cleanupResult.text;
        if (cleanupResult.wasCleanedUp) {
          console.log('[llm] Transcription cleaned up:', cleanupResult.corrections);
        }
      } catch (error) {
        console.error('[llm] Transcription cleanup failed, using original:', error);
      }
    }

    // Build system prompt for the session
    const repoPath = selectedRepo.path;
    const repoName = selectedRepo.name;
    let systemPromptParts: string[] = [];

    // Add voice transcription notice if applicable
    const needsTranscriptionNotice = $settings.audio.include_transcription_notice && !isTranscriptionCleanupEnabled();
    if (needsTranscriptionNotice) {
      systemPromptParts.push(VOICE_TRANSCRIPTION_SYSTEM_PROMPT);
    }

    // Add repo confirmation prompt if applicable
    const otherRepoNames = $settings.repos
      .filter((r) => r.path !== repoPath)
      .map((r) => r.name);
    const repoConfirmationPrompt = getRepoConfirmationSystemPrompt(repoName, otherRepoNames);
    if (repoConfirmationPrompt) {
      systemPromptParts.push(repoConfirmationPrompt);
    }

    const systemPrompt = systemPromptParts.length > 0 ? systemPromptParts.join('\n\n') : undefined;

    // Complete the repo selection and initialize the session with the cleaned transcript
    await sdkSessions.completeRepoSelection(sessionId, repoPath, systemPrompt, finalTranscript);
  }

  // Handle repo selection from SessionPendingView (wrapper for active session)
  async function handlePendingRepoSelection(index: number, editedPrompt?: string) {
    const session = $activeSdkSession;
    if (!session || session.status !== 'pending_repo') return;
    await handleRepoSelectionForSession(session.id, index, editedPrompt);
  }

  // Handle cancel from SessionPendingView
  async function handlePendingSessionCancel() {
    if (!$activeSdkSessionId) return;

    console.log('[session] User cancelled pending session');
    await sdkSessions.closeSession($activeSdkSessionId);
    activeSdkSessionId.set(null);
  }

  // Handler for SDK session model change
  function handleSessionModelChange(newModel: string) {
    if ($activeSdkSessionId) {
      sdkSessions.updateSessionModel($activeSdkSessionId, newModel);
    }
  }

  // Handler for SDK session thinking change
  function handleSessionThinkingChange(newLevel: ThinkingLevel) {
    if ($activeSdkSessionId) {
      sdkSessions.updateSessionThinking($activeSdkSessionId, newLevel);
    }
  }

  // Handler for SDK session close
  function handleSessionClose() {
    if ($activeSdkSessionId) {
      sdkSessions.closeSession($activeSdkSessionId);
      activeSdkSessionId.set(null);
    }
  }

  // Register the transcribe-to-input hotkey (only while recording/overlay is open)
  async function registerTranscribeHotkey() {
    if (transcribeHotkeyRegistered) return;
    try {
      await register($settings.hotkeys.transcribe_to_input, async () => {
        // Only works while recording
        if (!$isRecording) return;
        if (isTogglingRecording) return;
        isTogglingRecording = true;

        try {
          // Stop recording and paste
          await unregisterTranscribeHotkey();
          await unregisterCycleRepoHotkey();
          await unregisterCycleModelHotkey();
          await overlay.hide();
          overlay.clearSessionInfo();

          // Stop audio visualization listener
          if (unlistenAudioVisualization) {
            unlistenAudioVisualization();
            unlistenAudioVisualization = null;
          }

          // Cancel the pending transcription session since we're pasting instead of sending
          if (pendingTranscriptionSessionId) {
            sdkSessions.cancelPendingTranscription(pendingTranscriptionSessionId);
            pendingTranscriptionSessionId = null;
          }

          // Reset recording-for-new-session flag
          isRecordingForNewSession = false;

          // Stop recording - don't await so user can start new recording while transcribing
          recording.stopRecording(true).then(async (transcript) => {
            if (transcript) {
              // Paste the transcript into the currently focused app
              await invoke('paste_text', { text: transcript });
            }
          });
        } finally {
          setTimeout(() => {
            isTogglingRecording = false;
          }, 200);
        }
      });
      transcribeHotkeyRegistered = true;
    } catch (error) {
      console.error('Failed to register transcribe hotkey:', error);
    }
  }

  // Unregister the transcribe-to-input hotkey (when overlay closes)
  async function unregisterTranscribeHotkey() {
    if (!transcribeHotkeyRegistered) return;
    try {
      await unregister($settings.hotkeys.transcribe_to_input);
      transcribeHotkeyRegistered = false;
    } catch (error) {
      console.error('Failed to unregister transcribe hotkey:', error);
    }
  }

  // Debounce flags for hotkeys that shouldn't repeat when held
  let isCyclingRepo = false;
  let isCyclingModel = false;

  // Register the cycle-repo hotkey (only while recording/overlay is open)
  async function registerCycleRepoHotkey() {
    if (cycleRepoHotkeyRegistered) {
      console.log('[Hotkey] Cycle repo hotkey already registered, skipping');
      return;
    }
    const currentSettings = get(settings);
    if (currentSettings.repos.length <= 1) {
      console.log('[Hotkey] Only', currentSettings.repos.length, 'repo(s) configured, skipping cycle repo hotkey');
      return;
    }

    const hotkeyString = currentSettings.hotkeys.cycle_repo;
    console.log('[Hotkey] Registering cycle repo hotkey:', hotkeyString);
    try {
      await register(hotkeyString, async () => {
        console.log('[Hotkey] Cycle repo hotkey pressed!');
        // Debounce to prevent rapid firing when key is held
        if (isCyclingRepo) {
          console.log('[Hotkey] Debouncing cycle repo');
          return;
        }
        isCyclingRepo = true;

        try {
          // Only works while recording
          if (!get(isRecording)) {
            console.log('[Hotkey] Not recording, ignoring cycle repo');
            return;
          }

          const s = get(settings);
          console.log('[Hotkey] Cycling repo from index', s.active_repo_index, 'to', (s.active_repo_index + 1) % s.repos.length);

          // Cycle to next repo
          const nextIndex = (s.active_repo_index + 1) % s.repos.length;
          await settings.setActiveRepo(nextIndex);

          // Update overlay with new repo info
          const newRepo = s.repos[nextIndex];
          if (newRepo) {
            let branch: string | null = null;
            try {
              branch = await invoke<string>('get_git_branch', { repoPath: newRepo.path });
            } catch (e) {
              console.error('Failed to get git branch:', e);
            }
            overlay.setSessionInfo(branch, get(settings).default_model, false);
          }
        } finally {
          setTimeout(() => {
            isCyclingRepo = false;
          }, 200);
        }
      });
      registeredCycleRepoHotkey = hotkeyString;
      cycleRepoHotkeyRegistered = true;
      console.log('[Hotkey] Successfully registered cycle repo hotkey:', hotkeyString);
    } catch (error) {
      console.error('Failed to register cycle repo hotkey:', error);
    }
  }

  // Unregister the cycle-repo hotkey (when overlay closes)
  async function unregisterCycleRepoHotkey() {
    if (!cycleRepoHotkeyRegistered || !registeredCycleRepoHotkey) return;
    try {
      await unregister(registeredCycleRepoHotkey);
      console.log('[Hotkey] Unregistered cycle repo hotkey:', registeredCycleRepoHotkey);
      cycleRepoHotkeyRegistered = false;
      registeredCycleRepoHotkey = null;
    } catch (error) {
      console.error('Failed to unregister cycle repo hotkey:', error);
    }
  }

  // Register the cycle-model hotkey (only while recording/overlay is open)
  async function registerCycleModelHotkey() {
    if (cycleModelHotkeyRegistered) return;

    const hotkeyString = get(settings).hotkeys.cycle_model;
    try {
      await register(hotkeyString, async () => {
        // Debounce to prevent rapid firing when key is held
        if (isCyclingModel) return;
        isCyclingModel = true;

        try {
          // Only works while recording
          if (!get(isRecording)) return;

          const currentSettings = get(settings);
          const currentOverlay = get(overlay);

          // Get enabled models for cycling (exclude 1M context variant)
          let cyclableModels = currentSettings.enabled_models.filter(
            (id: string) => !id.includes('[1m]')
          );

          // Add 'auto' to cyclable models if smart model selection is enabled
          if (isModelRecommendationEnabled()) {
            cyclableModels = ['auto', ...cyclableModels];
          }

          // Need at least 2 models to cycle
          if (cyclableModels.length < 2) return;

          // Find current model index and cycle to next
          const currentIndex = cyclableModels.indexOf(currentSettings.default_model);
          const nextIndex = (currentIndex + 1) % cyclableModels.length;
          const nextModel = cyclableModels[nextIndex];

          // Update the default model
          settings.update(s => ({ ...s, default_model: nextModel }));
          await settings.save({ ...currentSettings, default_model: nextModel });

          // Update overlay with new model
          overlay.setSessionInfo(currentOverlay.sessionInfo.branch, nextModel, false);
        } finally {
          setTimeout(() => {
            isCyclingModel = false;
          }, 200);
        }
      });
      registeredCycleModelHotkey = hotkeyString;
      cycleModelHotkeyRegistered = true;
      console.log('[Hotkey] Registered cycle model hotkey:', hotkeyString);
    } catch (error) {
      console.error('Failed to register cycle model hotkey:', error);
    }
  }

  // Unregister the cycle-model hotkey (when overlay closes)
  async function unregisterCycleModelHotkey() {
    if (!cycleModelHotkeyRegistered || !registeredCycleModelHotkey) return;
    try {
      await unregister(registeredCycleModelHotkey);
      console.log('[Hotkey] Unregistered cycle model hotkey:', registeredCycleModelHotkey);
      cycleModelHotkeyRegistered = false;
      registeredCycleModelHotkey = null;
    } catch (error) {
      console.error('Failed to unregister cycle model hotkey:', error);
    }
  }

  async function setupHotkeys() {
    try {
      console.log('[Hotkey] Unregistering all hotkeys...');
      await unregisterAll();
      transcribeHotkeyRegistered = false;
      cycleRepoHotkeyRegistered = false;
      cycleModelHotkeyRegistered = false;
      registeredCycleRepoHotkey = null;
      registeredCycleModelHotkey = null;
      registeredToggleRecordingHotkey = null;
      console.log('[Hotkey] All hotkeys unregistered, registering toggle_recording:', $settings.hotkeys.toggle_recording);

      // Start Recording / Send hotkey
      // - If not recording: starts recording
      // - If recording: stops, transcribes, and sends to Claude
      await register($settings.hotkeys.toggle_recording, async () => {
        // Prevent multiple rapid fires
        if (isTogglingRecording) return;
        isTogglingRecording = true;

        try {
          if ($isRecording) {
            // Unregister hotkeys so they pass through to other apps
            await unregisterTranscribeHotkey();
            await unregisterCycleRepoHotkey();
            await unregisterCycleModelHotkey();
            // Hide overlay immediately before processing starts
            await overlay.hide();
            overlay.clearSessionInfo();

            // Stop audio visualization listener
            if (unlistenAudioVisualization) {
              unlistenAudioVisualization();
              unlistenAudioVisualization = null;
            }

            // Update pending session to transcribing status
            const sessionIdToProcess = pendingTranscriptionSessionId;
            if (sessionIdToProcess) {
              sdkSessions.updatePendingTranscription(sessionIdToProcess, { status: 'transcribing' });
            }

            // Capture Vosk transcript before stopping recording (it may be cleared after)
            const capturedVoskTranscript = get(recording).realtimeTranscript;

            // Stop recording and get transcript (queued transcription)
            // This returns immediately but transcript comes via callback/promise
            // Note: we don't await here to allow starting a new recording while transcribing
            recording.stopRecording().then(async (transcript) => {
              // Store audio data for retry capability
              if (sessionIdToProcess) {
                const audioData = get(recording).audioData;
                if (audioData) {
                  sdkSessions.storeAudioData(sessionIdToProcess, audioData);
                }
              }

              if (transcript) {
                // Send the transcript to process the pending session (with captured Vosk transcript)
                await sendTranscriptDirectly(transcript, sessionIdToProcess, capturedVoskTranscript);
              } else if (sessionIdToProcess) {
                // Transcription failed or returned empty - set error
                sdkSessions.updatePendingTranscription(sessionIdToProcess, {
                  transcriptionError: 'No transcription returned',
                });
              }
              // Only clear if still the same session (avoid orphaning sessions created by concurrent flows)
              if (pendingTranscriptionSessionId === sessionIdToProcess) {
                pendingTranscriptionSessionId = null;
              }
            }).catch((error) => {
              // Handle transcription error - also try to store audio data for retry
              if (sessionIdToProcess) {
                const audioData = get(recording).audioData;
                if (audioData) {
                  sdkSessions.storeAudioData(sessionIdToProcess, audioData);
                }
                sdkSessions.updatePendingTranscription(sessionIdToProcess, {
                  transcriptionError: error?.message || 'Transcription failed',
                });
              }
              // Only clear if still the same session (avoid orphaning sessions created by concurrent flows)
              if (pendingTranscriptionSessionId === sessionIdToProcess) {
                pendingTranscriptionSessionId = null;
              }
            });
          } else {
            // Stop open mic to avoid two Vosk sessions running simultaneously
            await openMic.stop();

            // Check if main window is focused before starting
            const mainWindow = getCurrentWindow();
            wasAppFocusedOnRecordStart = await mainWindow.isFocused();

            const repoPath = $activeRepo?.path || '.';
            const model = $settings.default_model;
            const thinkingLevel = settingsToStoreThinking($settings.default_thinking_level);

            // Get current git branch for overlay display
            let branch: string | null = null;
            try {
              branch = await invoke<string>('get_git_branch', { repoPath });
            } catch (e) {
              console.error('Failed to get git branch:', e);
            }

            // Set overlay info
            overlay.setMode('session');
            overlay.setSessionInfo(branch, model, false);

            // Create pending transcription session immediately (SDK mode only)
            // Note: We don't switch the view here (via hotkey) - user stays on their current view
            // The UI button path (startRecordingNewSession) does switch the view
            if ($settings.terminal_mode === 'Sdk') {
              pendingTranscriptionSessionId = sdkSessions.createPendingTranscriptionSession(model, thinkingLevel);

              // Set up audio visualization listener to capture waveform data
              unlistenAudioVisualization = await listen<{ data: number[] | null }>('audio-visualization', (event) => {
                if (pendingTranscriptionSessionId && event.payload.data) {
                  sdkSessions.addAudioVisualizationSnapshot(pendingTranscriptionSessionId, event.payload.data);
                }
              });
            }

            await recording.startRecording($settings.audio.device_id || undefined);

            // Register hotkeys now that we're recording
            await registerTranscribeHotkey();
            await registerCycleRepoHotkey();
            await registerCycleModelHotkey();

            // Show overlay if app is not focused, or if show_when_focused is enabled
            if (!wasAppFocusedOnRecordStart || $settings.overlay.show_when_focused) {
              await overlay.show();
            }
          }
        } finally {
          // Small delay to prevent key repeat issues
          setTimeout(() => {
            isTogglingRecording = false;
          }, 200);
        }
      });

      // Note: transcribe_to_input, cycle_repo, and cycle_model hotkeys are registered dynamically when recording starts
      // and unregistered when recording stops, so they don't block other apps

      // Track that we successfully registered with this hotkey
      registeredToggleRecordingHotkey = $settings.hotkeys.toggle_recording;
      console.log('[Hotkey] Successfully registered toggle_recording:', registeredToggleRecordingHotkey);
    } catch (error) {
      console.error('Failed to register hotkeys:', error);
    }
  }

  function showSettingsView() {
    navigation.showSettings();
  }

  function showSessionsView() {
    navigation.setView('sessions');
  }

  function showStartView() {
    navigation.setView('start');
  }

  async function selectRepo(index: number) {
    await settings.setActiveRepo(index);
  }

  async function enableAutoRepo() {
    await settings.setAutoRepoMode(true);
  }

  async function changeModel(newModel: string) {
    // Update the default model (only affects new sessions)
    settings.update(s => ({ ...s, default_model: newModel }));
    await settings.save({ ...$settings, default_model: newModel });
  }

  async function changeThinking(newLevel: ThinkingLevel) {
    const settingsLevel = newLevel === null ? 'off' : newLevel;
    await settings.save({ ...$settings, default_thinking_level: settingsLevel });
  }

  function openSettingsTab(tab: string) {
    navigation.showSettings(tab);
  }

  // Start recording for a NEW session (header button)
  async function startRecordingNewSession() {
    if ($isRecording) return;
    isRecordingForNewSession = true;

    // Stop open mic to avoid two Vosk sessions running simultaneously
    await openMic.stop();

    const repoPath = $activeRepo?.path || '.';
    const model = $settings.default_model;
    const thinkingLevel = settingsToStoreThinking($settings.default_thinking_level);

    // Get current git branch for overlay display
    let branch: string | null = null;
    try {
      branch = await invoke<string>('get_git_branch', { repoPath });
    } catch (e) {
      console.error('Failed to get git branch:', e);
    }

    // Set overlay info
    overlay.setMode('session');
    overlay.setSessionInfo(branch, model, false);

    // Create pending transcription session immediately (SDK mode only)
    if ($settings.terminal_mode === 'Sdk') {
      pendingTranscriptionSessionId = sdkSessions.createPendingTranscriptionSession(model, thinkingLevel);
      activeSdkSessionId.set(pendingTranscriptionSessionId);
      activeSessionId.set(null);
      navigation.setView('sessions');

      // Set up audio visualization listener to capture waveform data
      unlistenAudioVisualization = await listen<{ data: number[] | null }>('audio-visualization', (event) => {
        if (pendingTranscriptionSessionId && event.payload.data) {
          sdkSessions.addAudioVisualizationSnapshot(pendingTranscriptionSessionId, event.payload.data);
        }
      });
    }

    await recording.startRecording($settings.audio.device_id || undefined);

    // Register hotkeys now that we're recording
    await registerTranscribeHotkey();
    await registerCycleRepoHotkey();
    await registerCycleModelHotkey();

    // Show overlay
    await overlay.show();
  }

  // Stop recording and always create a new session with the transcript
  async function stopRecordingNewSession() {
    if (!$isRecording) return;

    const wasRecordingForNew = isRecordingForNewSession;
    isRecordingForNewSession = false;

    // Unregister hotkeys so they pass through to other apps
    await unregisterTranscribeHotkey();
    await unregisterCycleRepoHotkey();
    await unregisterCycleModelHotkey();
    // Hide overlay immediately before processing starts
    await overlay.hide();
    overlay.clearSessionInfo();

    // Stop audio visualization listener
    if (unlistenAudioVisualization) {
      unlistenAudioVisualization();
      unlistenAudioVisualization = null;
    }

    // Update pending session to transcribing status
    const sessionIdToProcess = pendingTranscriptionSessionId;
    if (sessionIdToProcess) {
      sdkSessions.updatePendingTranscription(sessionIdToProcess, { status: 'transcribing' });
    }

    // Capture Vosk transcript before stopping recording (it may be cleared after)
    const capturedVoskTranscript = get(recording).realtimeTranscript;

    // Stop recording - don't await so user can start new recording while transcribing
    recording.stopRecording(true).then(async (transcript) => {
      // Store audio data for retry capability
      if (sessionIdToProcess) {
        const audioData = get(recording).audioData;
        if (audioData) {
          sdkSessions.storeAudioData(sessionIdToProcess, audioData);
        }
      }

      if (transcript) {
        // Send the transcript to process the pending session (with captured Vosk transcript)
        await sendTranscriptDirectly(transcript, sessionIdToProcess, capturedVoskTranscript);
      } else if (sessionIdToProcess) {
        // Transcription failed or returned empty - set error
        sdkSessions.updatePendingTranscription(sessionIdToProcess, {
          transcriptionError: 'No transcription returned',
        });
      }
      // Only clear if still the same session (avoid orphaning sessions created by concurrent flows)
      if (pendingTranscriptionSessionId === sessionIdToProcess) {
        pendingTranscriptionSessionId = null;
      }
    }).catch((error) => {
      // Handle transcription error - also try to store audio data for retry
      if (sessionIdToProcess) {
        const audioData = get(recording).audioData;
        if (audioData) {
          sdkSessions.storeAudioData(sessionIdToProcess, audioData);
        }
        sdkSessions.updatePendingTranscription(sessionIdToProcess, {
          transcriptionError: error?.message || 'Transcription failed',
        });
      }
      // Only clear if still the same session (avoid orphaning sessions created by concurrent flows)
      if (pendingTranscriptionSessionId === sessionIdToProcess) {
        pendingTranscriptionSessionId = null;
      }
    });
  }
</script>

<div class="app-container h-screen flex flex-col bg-background">
  <AppHeader
    repos={$settings.repos}
    activeRepoIndex={$settings.active_repo_index}
    activeRepo={$activeRepo}
    isAutoRepoSelected={$isAutoRepoSelected}
    defaultModel={$settings.default_model}
    defaultThinkingLevel={settingsToStoreThinking($settings.default_thinking_level)}
    isRecording={$isRecording}
    {isRecordingForNewSession}
    pendingTranscriptions={$pendingTranscriptions}
    {currentView}
    onShowStart={showStartView}
    onShowSettings={showSettingsView}
    onShowSessions={showSessionsView}
    onOpenSettingsTab={openSettingsTab}
    onSelectRepo={selectRepo}
    onEnableAutoRepo={enableAutoRepo}
    onChangeModel={changeModel}
    onChangeThinking={changeThinking}
    onStartRecording={startRecordingNewSession}
    onStopRecording={stopRecordingNewSession}
  />

  <div class="main-content flex-1 flex overflow-hidden">
    <aside class="sidebar border-r border-border bg-surface flex flex-col relative" style="width: {sidebar.width}px; min-width: {sidebar.minWidth}px; max-width: {sidebar.maxWidth}px;">
      <SessionSidebarHeader
        sessions={$sessions}
        sdkSessions={$sdkSessions}
        {currentView}
        markSessionsUnread={$settings.mark_sessions_unread}
        onShowSessions={showSessionsView}
      />
      <div class="flex-1 overflow-hidden">
        <SessionList {currentView} />
      </div>
      <!-- Resize handle -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-accent/50 transition-colors"
        class:bg-accent={sidebar.isResizing}
        onmousedown={sidebar.startResize}
      ></div>
    </aside>

    <main class="flex-1 flex flex-col overflow-hidden">
      {#if currentView === 'start'}
        <Start />
      {:else if currentView === 'settings'}
        <Settings initialTab={settingsTabFromNav} />
      {:else if $activeSdkSession}
        <!-- SDK Mode Session -->
        {@const isPendingState = $activeSdkSession.status === 'pending_repo' || $activeSdkSession.status === 'initializing'}

        <SdkSessionHeader
          createdAt={$activeSdkSession.createdAt}
          messages={$activeSdkSession.messages}
          isPending={isPendingState}
          repoName={activeSdkRepoName}
          branch={activeSdkSessionBranch}
          firstPrompt={activeSdkFirstPrompt()}
          onClose={handleSessionClose}
          onCancel={handlePendingSessionCancel}
        />

        {#if isPendingState}
          <div class="terminal-wrapper flex-1 overflow-hidden">
            <SessionPendingView
              status={$activeSdkSession.status as 'pending_repo' | 'initializing'}
              repos={$settings.repos}
              pendingSelection={$activeSdkSession.pendingRepoSelection}
              pendingPrompt={$activeSdkSession.pendingPrompt}
              onSelectRepo={handlePendingRepoSelection}
              onCancel={handlePendingSessionCancel}
            />
          </div>
        {:else}
          <div class="terminal-wrapper flex-1 overflow-hidden">
            {#key $activeSdkSession.id}
              <SdkView bind:this={sdkViewRef} sessionId={$activeSdkSession.id} />
            {/key}
          </div>
        {/if}
      {:else if $activeSession}
        <!-- PTY Mode Session -->
        <SessionHeader session={$activeSession} />
        <div class="terminal-wrapper flex-1 overflow-hidden">
          {#key $activeSession.id}
            <Terminal sessionId={$activeSession.id} />
          {/key}
        </div>
      {:else}
        <EmptySessionPlaceholder />
      {/if}
    </main>
  </div>
</div>

<style>
  .app-container {
    user-select: none;
  }

  .terminal-wrapper {
    min-height: 0;
  }

  .resize-handle {
    /* Extend the clickable area beyond the visible 4px width */
    padding-left: 3px;
    padding-right: 3px;
    margin-right: -3px;
    background-clip: content-box;
  }

  .resize-handle:hover,
  .resize-handle.bg-accent {
    background-color: var(--color-accent);
    opacity: 0.5;
  }

  .resize-handle.bg-accent {
    opacity: 1;
  }

  .sidebar {
    flex-shrink: 0;
  }
</style>
