<script lang="ts">
  import { settings, type Theme } from "$lib/stores/settings";
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, onDestroy } from "svelte";
  import HotkeyInput from "$lib/components/HotkeyInput.svelte";
  import { ALL_MODELS } from "$lib/utils/models";
  import {
    getModelBadgeBgColor,
    getModelTextColor,
  } from "$lib/utils/modelColors";

  // Accept an initial tab from parent component
  interface Props {
    initialTab?: string;
  }
  let { initialTab = "general" }: Props = $props();

  let activeTab = $state(initialTab);

  // Update active tab when initialTab prop changes
  $effect(() => {
    activeTab = initialTab;
  });

  interface ConnectionTestResult {
    health_ok: boolean;
    health_error: string | null;
    transcription_ok: boolean;
    transcription_error: string | null;
  }

  let testingWhisper = $state(false);
  let whisperStatus: "idle" | "success" | "partial" | "error" = $state("idle");
  let whisperTestResult: ConnectionTestResult | null = $state(null);

  // Vosk state
  interface VoskConnectionTestResult {
    connected: boolean;
    error: string | null;
  }
  let testingVosk = $state(false);
  let voskStatus: "idle" | "success" | "error" = $state("idle");
  let voskTestResult: VoskConnectionTestResult | null = $state(null);
  let newRepoPath = $state("");
  let newRepoName = $state("");
  let audioDevices: MediaDeviceInfo[] = $state([]);
  let loadingDevices = $state(false);
  let saveStatus: "idle" | "saving" | "error" = $state("idle");
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  // LLM integration state
  interface LlmTestResult {
    success: boolean;
    error: string | null;
    model_info: string | null;
  }
  interface RepoDescriptionResult {
    description: string;
    keywords: string[];
    vocabulary: string[];
  }
  let geminiApiKey = $state("");
  let geminiApiKeySet = $state(false);
  let testingGemini = $state(false);
  let savingGeminiKey = $state(false);
  let geminiStatus: "idle" | "success" | "error" = $state("idle");
  let geminiTestResult: LlmTestResult | null = $state(null);

  // Repo description generation state
  let generatingDescriptionForIndex: number | null = $state(null);

  // Debounced auto-save
  async function autoSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    if (statusTimeout) clearTimeout(statusTimeout);

    saveTimeout = setTimeout(async () => {
      saveStatus = "saving";
      try {
        await invoke("save_config", { newConfig: $settings });
        saveStatus = "idle";
      } catch (error) {
        console.error("Failed to save settings:", error);
        saveStatus = "error";
        statusTimeout = setTimeout(() => (saveStatus = "idle"), 3000);
      }
    }, 500);
  }

  // Subscribe to settings changes for auto-save
  let isInitialLoad = true;
  const unsubscribe = settings.subscribe(() => {
    if (isInitialLoad) {
      isInitialLoad = false;
      return;
    }
    autoSave();
  });

  onMount(() => {
    loadAudioDevices();
    checkGeminiApiKey();
  });

  async function checkGeminiApiKey() {
    try {
      geminiApiKeySet = await invoke<boolean>("has_gemini_api_key");
    } catch (error) {
      console.error("Failed to check Gemini API key:", error);
      geminiApiKeySet = false;
    }
  }

  async function saveGeminiApiKey() {
    if (!geminiApiKey.trim()) return;
    savingGeminiKey = true;
    try {
      await invoke("save_gemini_api_key", { apiKey: geminiApiKey.trim() });
      geminiApiKeySet = true;
      geminiApiKey = "";
      geminiStatus = "idle";
    } catch (error) {
      console.error("Failed to save Gemini API key:", error);
    }
    savingGeminiKey = false;
  }

  async function deleteGeminiApiKey() {
    if (!confirm("Are you sure you want to remove your Gemini API key?"))
      return;
    try {
      await invoke("delete_gemini_api_key");
      geminiApiKeySet = false;
      geminiStatus = "idle";
      geminiTestResult = null;
      // Disable Gemini when key is removed
      settings.update((s) => ({ ...s, llm: { ...s.llm, enabled: false } }));
    } catch (error) {
      console.error("Failed to delete Gemini API key:", error);
    }
  }

  async function testGeminiConnection() {
    testingGemini = true;
    geminiStatus = "idle";
    geminiTestResult = null;
    try {
      const result = await invoke<LlmTestResult>("test_gemini_connection");
      geminiTestResult = result;
      geminiStatus = result.success ? "success" : "error";
    } catch (error) {
      console.error("Failed to test Gemini connection:", error);
      geminiStatus = "error";
      geminiTestResult = {
        success: false,
        error: String(error),
        model_info: null,
      };
    }
    testingGemini = false;
  }

  onDestroy(() => {
    unsubscribe();
    if (saveTimeout) clearTimeout(saveTimeout);
    if (statusTimeout) clearTimeout(statusTimeout);
  });

  async function loadAudioDevices() {
    loadingDevices = true;
    try {
      // Request permission first to get device labels
      await navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach((track) => track.stop());
        });
      const devices = await navigator.mediaDevices.enumerateDevices();
      audioDevices = devices.filter((d) => d.kind === "audioinput");
    } catch (error) {
      console.error("Failed to enumerate audio devices:", error);
    }
    loadingDevices = false;
  }

  const tabs = [
    { id: "general", label: "General" },
    { id: "themes", label: "Themes" },
    { id: "system", label: "System" },
    { id: "audio", label: "Audio" },
    { id: "whisper", label: "Whisper" },
    { id: "vosk", label: "Vosk" },
    { id: "llm", label: "LLM" },
    { id: "git", label: "Git" },
    { id: "hotkeys", label: "Hotkeys" },
    { id: "overlay", label: "Overlay" },
    { id: "repos", label: "Repositories" },
  ];

  async function testWhisperConnection() {
    testingWhisper = true;
    whisperStatus = "idle";
    whisperTestResult = null;
    try {
      const result = await invoke<ConnectionTestResult>(
        "test_whisper_connection"
      );
      whisperTestResult = result;
      if (result.health_ok && result.transcription_ok) {
        whisperStatus = "success";
      } else if (result.health_ok || result.transcription_ok) {
        whisperStatus = "partial";
      } else {
        whisperStatus = "error";
      }
    } catch {
      whisperStatus = "error";
    }
    testingWhisper = false;
  }

  async function testVoskConnection() {
    testingVosk = true;
    voskStatus = "idle";
    voskTestResult = null;
    try {
      const result = await invoke<VoskConnectionTestResult>(
        "test_vosk_connection"
      );
      voskTestResult = result;
      voskStatus = result.connected ? "success" : "error";
    } catch (error) {
      voskStatus = "error";
      voskTestResult = {
        connected: false,
        error: String(error),
      };
    }
    testingVosk = false;
  }

  async function addRepo() {
    console.log(
      "[addRepo] Called with path:",
      newRepoPath,
      "name:",
      newRepoName
    );
    if (!newRepoPath || !newRepoName) {
      console.log("[addRepo] Missing path or name, returning");
      return;
    }
    console.log("[addRepo] Calling settings.addRepo...");
    try {
      await settings.addRepo(newRepoPath, newRepoName);
      console.log("[addRepo] Successfully added repo");
      newRepoPath = "";
      newRepoName = "";
    } catch (error) {
      console.error("[addRepo] Failed to add repo:", error);
    }
  }

  async function removeRepo(index: number) {
    console.log("[removeRepo] Removing repo at index:", index);
    try {
      await settings.removeRepo(index);
      console.log("[removeRepo] Successfully removed repo");
    } catch (error) {
      console.error("[removeRepo] Failed to remove repo:", error);
    }
  }

  async function generateRepoDescription(index: number) {
    const repo = $settings.repos[index];
    if (!repo) return;

    generatingDescriptionForIndex = index;
    try {
      const result = await invoke<RepoDescriptionResult>(
        "generate_repo_description",
        {
          repoPath: repo.path,
          repoName: repo.name,
        }
      );

      // Update the repo's description, keywords, and vocabulary in settings
      const updatedRepos = [...$settings.repos];
      updatedRepos[index] = {
        ...updatedRepos[index],
        description: result.description,
        keywords: result.keywords,
        vocabulary: result.vocabulary,
      };
      settings.update((s) => ({ ...s, repos: updatedRepos }));
    } catch (error) {
      console.error("Failed to generate repo description:", error);
      alert(`Failed to generate description: ${error}`);
    }
    generatingDescriptionForIndex = null;
  }

  function toggleModel(modelId: string) {
    const currentEnabled = $settings.enabled_models || [];
    const isEnabled = currentEnabled.includes(modelId);

    if (isEnabled) {
      // Don't allow disabling if it would leave less than 1 model enabled
      if (currentEnabled.length <= 1) {
        return;
      }
      // Remove the model
      const newEnabled = currentEnabled.filter((id: string) => id !== modelId);
      settings.update((s) => ({ ...s, enabled_models: newEnabled }));

      // If the default model was disabled, switch to the first enabled model
      if ($settings.default_model === modelId && newEnabled.length > 0) {
        settings.update((s) => ({ ...s, default_model: newEnabled[0] }));
      }
    } else {
      // Add the model
      settings.update((s) => ({
        ...s,
        enabled_models: [...currentEnabled, modelId],
      }));
    }
  }

  function isModelEnabled(modelId: string): boolean {
    return ($settings.enabled_models || []).includes(modelId);
  }

  async function browseFolder() {
    console.log("[browseFolder] Opening folder dialog...");
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      console.log(
        "[browseFolder] Dialog plugin imported, calling openDialog..."
      );
      const selected = await openDialog({
        directory: true,
        multiple: false,
      });
      console.log("[browseFolder] Dialog result:", selected);
      if (selected) {
        newRepoPath = selected as string;
        console.log("[browseFolder] Set newRepoPath to:", newRepoPath);
        if (!newRepoName) {
          newRepoName = newRepoPath.split(/[/\\]/).pop() || "";
          console.log("[browseFolder] Auto-set newRepoName to:", newRepoName);
        }
      } else {
        console.log("[browseFolder] No folder selected (user cancelled)");
      }
    } catch (error) {
      console.error("[browseFolder] Failed to open folder dialog:", error);
    }
  }
</script>

<div class="settings-panel flex flex-col h-full">
  <header
    class="flex items-center justify-between px-4 py-3 border-b border-border"
  >
    <div class="flex items-center gap-3">
      <button
        class="p-1.5 hover:bg-surface-elevated rounded transition-colors text-text-muted hover:text-text-primary"
        onclick={() => window.dispatchEvent(new CustomEvent("close-settings"))}
        title="Back to sessions"
      >
        <svg
          class="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 19l-7-7m0 0l7-7m-7 7h18"
          />
        </svg>
      </button>
      <h2 class="text-lg font-semibold text-text-primary">Settings</h2>
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden">
    <nav
      class="w-40 border-r border-border bg-surface-elevated p-2 overflow-y-auto"
    >
      {#each tabs as tab}
        <button
          class="w-full px-3 py-2 text-left text-sm rounded transition-colors"
          class:bg-accent={activeTab === tab.id}
          class:text-white={activeTab === tab.id}
          class:text-text-secondary={activeTab !== tab.id}
          class:hover:bg-border={activeTab !== tab.id}
          onclick={() => (activeTab = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    </nav>

    <div class="flex-1 p-4 overflow-y-auto">
      {#if activeTab === "general"}
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Terminal Mode</label
            >
            <select
              class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
              bind:value={$settings.terminal_mode}
            >
              <option value="Interactive">Interactive</option>
              <option value="Prompt">Prompt (-p flag)</option>
              <option value="Sdk">SDK (Agent SDK)</option>
            </select>
            <p class="text-xs text-text-muted mt-1">
              {#if $settings.terminal_mode === "Interactive"}
                Full terminal control with multi-turn conversations.
              {:else if $settings.terminal_mode === "Prompt"}
                Runs single prompt and exits. Good for one-shot tasks.
              {:else if $settings.terminal_mode === "Sdk"}
                Uses Claude Agent SDK for structured messages and tool
                visibility.
              {/if}
            </p>
          </div>
          {#if $settings.terminal_mode === "Interactive" || $settings.terminal_mode === "Prompt"}
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-secondary"
                  >Skip Permissions</label
                >
                <p class="text-xs text-text-muted">
                  Use --dangerously-skip-permissions flag
                </p>
              </div>
              <input
                type="checkbox"
                class="toggle"
                bind:checked={$settings.skip_permissions}
              />
            </div>
          {/if}

          <div class="border-t border-border pt-4 mt-4">
            <h3 class="text-sm font-medium text-text-primary mb-2">
              Enabled Models
            </h3>
            <p class="text-xs text-text-muted mb-3">
              Select which models are available in the model selector and for
              hotkey cycling. At least one model must remain enabled.
            </p>
            <div class="space-y-2">
              {#each ALL_MODELS as model}
                {@const enabled = isModelEnabled(model.id)}
                {@const isOnlyEnabled =
                  enabled && ($settings.enabled_models || []).length === 1}
                <button
                  class="w-full flex items-center justify-between p-3 rounded border-2 transition-all {enabled
                    ? 'border-accent bg-accent/10'
                    : 'border-border opacity-50'}"
                  class:cursor-not-allowed={isOnlyEnabled}
                  onclick={() => toggleModel(model.id)}
                  title={isOnlyEnabled
                    ? "At least one model must remain enabled"
                    : model.title}
                >
                  <div class="flex items-center gap-3">
                    <div
                      class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors"
                      class:border-accent={enabled}
                      class:bg-accent={enabled}
                      class:border-border={!enabled}
                    >
                      {#if enabled}
                        <svg
                          class="w-3 h-3 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="3"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      {/if}
                    </div>
                    <div class="text-left">
                      <div class="flex items-center gap-2">
                        <span
                          class="text-sm font-medium px-2 py-0.5 rounded {getModelBadgeBgColor(
                            model.id
                          )} {getModelTextColor(model.id)}">{model.label}</span
                        >
                      </div>
                      <p class="text-xs text-text-muted mt-0.5">
                        {model.title}
                      </p>
                    </div>
                  </div>
                  {#if isOnlyEnabled}
                    <span class="text-xs text-text-muted">Required</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Show Branch in Sessions</label
              >
              <p class="text-xs text-text-muted">
                Display git branch name in session list
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.show_branch_in_sessions}
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Session List Sort Order</label
            >
            <select
              class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
              bind:value={$settings.session_sort_order}
            >
              <option value="Chronological">Chronological (newest first)</option
              >
              <option value="StatusThenChronological"
                >Status, then chronological</option
              >
            </select>
            <p class="text-xs text-text-muted mt-1">
              {#if $settings.session_sort_order === "Chronological"}
                Sessions sorted by creation time, newest first.
              {:else}
                Active sessions first, then by creation time.
              {/if}
            </p>
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Mark Completed Sessions as Unread</label
              >
              <p class="text-xs text-text-muted">
                Highlight sessions that have completed until you click on them
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.mark_sessions_unread}
            />
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Show Latest Message Preview</label
              >
              <p class="text-xs text-text-muted">
                Display a snippet of the latest response in each SDK session
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.show_latest_message_preview}
            />
          </div>
          <div class="border-t border-border pt-4 mt-4">
            <h3 class="text-sm font-medium text-text-primary mb-3">
              Session List Row Limits
            </h3>
            <div class="space-y-4">
              <div>
                <label
                  class="block text-sm font-medium text-text-secondary mb-1"
                  >User Prompt Rows</label
                >
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    class="flex-1 accent-accent"
                    bind:value={$settings.session_prompt_rows}
                  />
                  <span class="text-sm text-text-primary w-8 text-right"
                    >{$settings.session_prompt_rows}</span
                  >
                </div>
                <p class="text-xs text-text-muted mt-1">
                  Maximum rows to show for user prompts in session list
                </p>
              </div>
              <div>
                <label
                  class="block text-sm font-medium text-text-secondary mb-1"
                  >Agent Response Rows</label
                >
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="1"
                    class="flex-1 accent-accent"
                    bind:value={$settings.session_response_rows}
                  />
                  <span class="text-sm text-text-primary w-8 text-right"
                    >{$settings.session_response_rows}</span
                  >
                </div>
                <p class="text-xs text-text-muted mt-1">
                  Maximum rows to show for agent responses in session list
                </p>
              </div>
            </div>
          </div>
        </div>
      {:else if activeTab === "themes"}
        <div class="space-y-4">
          <div>
            <p class="text-sm text-text-secondary mb-4">
              Choose a theme that suits your preference. Dark themes are easier
              on the eyes in low-light conditions.
            </p>

            <h3 class="text-sm font-medium text-text-primary mb-3">
              Dark Themes
            </h3>
            <div class="grid grid-cols-2 gap-2 mb-6">
              {#each [{ id: "Midnight" as Theme, label: "Midnight", desc: "Deep dark", colors: ["#0f0f0f", "#1a1a1a", "#6366f1"] }, { id: "Slate" as Theme, label: "Slate", desc: "Blue-gray dark", colors: ["#1e293b", "#334155", "#3b82f6"] }, { id: "Ocean" as Theme, label: "Ocean", desc: "Deep blue", colors: ["#0c1222", "#1a2744", "#0ea5e9"] }, { id: "Forest" as Theme, label: "Forest", desc: "Earthy green", colors: ["#0d1512", "#1a2820", "#22c55e"] }, { id: "Mocha" as Theme, label: "Mocha", desc: "Warm brown", colors: ["#1a1614", "#2a2420", "#c2956e"] }, { id: "Torch" as Theme, label: "Torch", desc: "Fiery orange", colors: ["#1a1210", "#2a1e18", "#f97316"] }] as theme}
                <button
                  class="flex items-center gap-3 p-3 rounded border-2 transition-all"
                  class:border-accent={$settings.theme === theme.id}
                  class:border-border={$settings.theme !== theme.id}
                  onclick={() => {
                    settings.update((s) => ({ ...s, theme: theme.id }));
                    document.documentElement.setAttribute(
                      "data-theme",
                      theme.id
                    );
                  }}
                >
                  <div class="flex gap-0.5">
                    {#each theme.colors as color}
                      <div
                        class="w-4 h-4 rounded-sm"
                        style="background-color: {color}"
                      ></div>
                    {/each}
                  </div>
                  <div class="text-left">
                    <div class="text-sm font-medium text-text-primary">
                      {theme.label}
                    </div>
                    <div class="text-xs text-text-muted">{theme.desc}</div>
                  </div>
                </button>
              {/each}
            </div>

            <h3 class="text-sm font-medium text-text-primary mb-3">
              Light Themes
            </h3>
            <div class="grid grid-cols-2 gap-2">
              {#each [{ id: "Snow" as Theme, label: "Snow", desc: "Clean white", colors: ["#ffffff", "#f1f5f9", "#6366f1"] }, { id: "Sand" as Theme, label: "Sand", desc: "Warm cream", colors: ["#fefdfb", "#f5f0e8", "#d97706"] }, { id: "Rose" as Theme, label: "Rose", desc: "Soft pink", colors: ["#fffbfc", "#fce7eb", "#e11d48"] }] as theme}
                <button
                  class="flex items-center gap-3 p-3 rounded border-2 transition-all"
                  class:border-accent={$settings.theme === theme.id}
                  class:border-border={$settings.theme !== theme.id}
                  onclick={() => {
                    settings.update((s) => ({ ...s, theme: theme.id }));
                    document.documentElement.setAttribute(
                      "data-theme",
                      theme.id
                    );
                  }}
                >
                  <div class="flex gap-0.5">
                    {#each theme.colors as color}
                      <div
                        class="w-4 h-4 rounded-sm border border-border/20"
                        style="background-color: {color}"
                      ></div>
                    {/each}
                  </div>
                  <div class="text-left">
                    <div class="text-sm font-medium text-text-primary">
                      {theme.label}
                    </div>
                    <div class="text-xs text-text-muted">{theme.desc}</div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        </div>
      {:else if activeTab === "system"}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Minimize to Tray</label
              >
              <p class="text-xs text-text-muted">
                Keep running in system tray when window is closed
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.system.minimize_to_tray}
            />
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Start Minimized</label
              >
              <p class="text-xs text-text-muted">
                Start app minimized to system tray
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.system.start_minimized}
            />
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Start on Login</label
              >
              <p class="text-xs text-text-muted">
                Automatically start when you log in to your computer
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              checked={$settings.system.autostart}
              onchange={async (e) => {
                const enabled = (e.target as HTMLInputElement).checked;
                try {
                  await invoke("toggle_autostart", { enabled });
                  settings.update((s) => ({
                    ...s,
                    system: { ...s.system, autostart: enabled },
                  }));
                } catch (error) {
                  console.error("Failed to toggle autostart:", error);
                  (e.target as HTMLInputElement).checked = !enabled;
                }
              }}
            />
          </div>

          <div class="border-t border-border pt-4 mt-4">
            <h3 class="text-sm font-medium text-text-primary mb-3">
              Session Persistence
            </h3>
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div>
                  <label class="text-sm font-medium text-text-secondary"
                    >Restore Sessions on Startup</label
                  >
                  <p class="text-xs text-text-muted">
                    Save and restore session history between app restarts
                  </p>
                </div>
                <input
                  type="checkbox"
                  class="toggle"
                  bind:checked={$settings.session_persistence.enabled}
                />
              </div>
              {#if $settings.session_persistence.enabled}
                <div>
                  <label
                    class="block text-sm font-medium text-text-secondary mb-1"
                    >Sessions to Restore on Startup</label
                  >
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      min="1"
                      max="50"
                      step="1"
                      class="flex-1 accent-accent"
                      bind:value={
                        $settings.session_persistence.restore_sessions
                      }
                    />
                    <span class="text-sm text-text-primary w-12 text-right"
                      >{$settings.session_persistence.restore_sessions}</span
                    >
                  </div>
                  <p class="text-xs text-text-muted mt-1">
                    Number of recent sessions to load when the app starts
                  </p>
                </div>
                <div>
                  <label
                    class="block text-sm font-medium text-text-secondary mb-1"
                    >Maximum Sessions to Keep</label
                  >
                  <div class="flex items-center gap-3">
                    <input
                      type="range"
                      min="10"
                      max="200"
                      step="10"
                      class="flex-1 accent-accent"
                      bind:value={$settings.session_persistence.max_sessions}
                    />
                    <span class="text-sm text-text-primary w-12 text-right"
                      >{$settings.session_persistence.max_sessions}</span
                    >
                  </div>
                  <p class="text-xs text-text-muted mt-1">
                    Older sessions will be automatically removed when the limit
                    is exceeded
                  </p>
                </div>
                <button
                  class="px-3 py-1.5 text-sm text-error border border-error/30 hover:bg-error/10 rounded transition-colors"
                  onclick={async () => {
                    if (
                      confirm(
                        "Are you sure you want to clear all saved sessions? This cannot be undone."
                      )
                    ) {
                      const { clearPersistedSessions } = await import(
                        "$lib/stores/sessionPersistence"
                      );
                      await clearPersistedSessions();
                    }
                  }}
                >
                  Clear Saved Sessions
                </button>
              {/if}
            </div>
          </div>
        </div>
      {:else if activeTab === "audio"}
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Microphone</label
            >
            <div class="flex gap-2">
              <select
                class="flex-1 px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.audio.device_id}
                disabled={loadingDevices}
              >
                <option value={null}>System Default</option>
                {#each audioDevices as device}
                  <option value={device.deviceId}
                    >{device.label ||
                      `Microphone ${device.deviceId.slice(0, 8)}`}</option
                  >
                {/each}
              </select>
              <button
                class="px-3 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors"
                onclick={loadAudioDevices}
                disabled={loadingDevices}
              >
                {#if loadingDevices}
                  <div
                    class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"
                  ></div>
                {:else}
                  Refresh
                {/if}
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary"
              >Use Hotkey</label
            >
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.audio.use_hotkey}
            />
          </div>
          <div class="border-t border-border pt-4 mt-4">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-secondary"
                  >Play Sound on Completion</label
                >
                <p class="text-xs text-text-muted mt-0.5">
                  Play a notification sound when SDK session completes
                </p>
              </div>
              <input
                type="checkbox"
                class="toggle"
                bind:checked={$settings.audio.play_sound_on_completion}
              />
            </div>
          </div>
          <div class="border-t border-border pt-4 mt-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1"
                >Recording Linger Time</label
              >
              <p class="text-xs text-text-muted mb-2">
                Delay before stopping recording to prevent audio cutoff (0 to
                disable)
              </p>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="50"
                  class="flex-1 accent-accent"
                  bind:value={$settings.audio.recording_linger_ms}
                />
                <span class="text-sm text-text-primary w-16 text-right"
                  >{$settings.audio.recording_linger_ms}ms</span
                >
              </div>
            </div>
          </div>
          <div class="border-t border-border pt-4 mt-4">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-sm font-medium text-text-secondary"
                  >Include Transcription Notice</label
                >
                <p class="text-xs text-text-muted mt-0.5">
                  Tell Claude the prompt was voice-transcribed and may contain
                  minor errors
                </p>
              </div>
              <input
                type="checkbox"
                class="toggle"
                bind:checked={$settings.audio.include_transcription_notice}
              />
            </div>
          </div>
        </div>
      {:else if activeTab === "whisper"}
        <div class="space-y-4">
          <!-- Provider Selection -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Provider</label
            >
            <select
              class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
              bind:value={$settings.whisper.provider}
              onchange={(e) => {
                const provider = (e.target as HTMLSelectElement).value;
                // Apply provider presets
                if (provider === "Local") {
                  $settings.whisper.endpoint =
                    "http://localhost:8000/v1/audio/transcriptions";
                  $settings.whisper.model =
                    "Systran/faster-whisper-large-v3-turbo";
                  $settings.whisper.api_key = null;
                } else if (provider === "OpenAI") {
                  $settings.whisper.endpoint =
                    "https://api.openai.com/v1/audio/transcriptions";
                  $settings.whisper.model = "whisper-1";
                } else if (provider === "Groq") {
                  $settings.whisper.endpoint =
                    "https://api.groq.com/openai/v1/audio/transcriptions";
                  $settings.whisper.model = "whisper-large-v3-turbo";
                }
              }}
            >
              <option value="Local">Local (faster-whisper-server)</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Groq">Groq (free tier available)</option>
              <option value="Custom">Custom OpenAI-compatible</option>
            </select>
            <p class="text-xs text-text-muted mt-1">
              {#if $settings.whisper.provider === "Local"}
                Run your own Whisper server locally using Docker
              {:else if $settings.whisper.provider === "OpenAI"}
                Official OpenAI Whisper API - <a
                  href="https://platform.openai.com/api-keys"
                  class="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer">Get API key</a
                >
              {:else if $settings.whisper.provider === "Groq"}
                Fast inference with free tier - <a
                  href="https://console.groq.com/keys"
                  class="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer">Get API key</a
                >
              {:else}
                Any OpenAI-compatible transcription endpoint
              {/if}
            </p>
          </div>

          <!-- API Key (only for non-Local providers) -->
          {#if $settings.whisper.provider !== "Local"}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1"
                >API Key</label
              >
              <input
                type="password"
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent font-mono"
                bind:value={$settings.whisper.api_key}
                placeholder="sk-..."
              />
            </div>
          {/if}

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Endpoint</label
            >
            <input
              type="text"
              class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
              bind:value={$settings.whisper.endpoint}
              placeholder="http://localhost:8000/v1/audio/transcriptions"
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Model</label
            >
            {#if $settings.whisper.provider === "Local"}
              <select
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.whisper.model}
              >
                <optgroup label="Standard Models">
                  <option value="Systran/faster-whisper-tiny"
                    >tiny (39M) - Fastest</option
                  >
                  <option value="Systran/faster-whisper-tiny.en"
                    >tiny.en (39M) - English only</option
                  >
                  <option value="Systran/faster-whisper-base"
                    >base (74M) - Very fast</option
                  >
                  <option value="Systran/faster-whisper-base.en"
                    >base.en (74M) - English only</option
                  >
                  <option value="Systran/faster-whisper-small"
                    >small (244M) - Fast</option
                  >
                  <option value="Systran/faster-whisper-small.en"
                    >small.en (244M) - English only</option
                  >
                  <option value="Systran/faster-whisper-medium"
                    >medium (769M) - Moderate</option
                  >
                  <option value="Systran/faster-whisper-medium.en"
                    >medium.en (769M) - English only</option
                  >
                </optgroup>
                <optgroup label="Large Models">
                  <option value="Systran/faster-whisper-large-v1"
                    >large-v1 (1550M) - Legacy</option
                  >
                  <option value="Systran/faster-whisper-large-v2"
                    >large-v2 (1550M) - Production</option
                  >
                  <option value="Systran/faster-whisper-large-v3"
                    >large-v3 (1550M) - Best accuracy</option
                  >
                  <option value="Systran/faster-whisper-large-v3-turbo"
                    >large-v3-turbo (809M) - Recommended</option
                  >
                </optgroup>
                <optgroup label="Distil Models (English only)">
                  <option value="Systran/faster-distil-whisper-small.en"
                    >distil-small.en (~166M) - Very fast</option
                  >
                  <option value="Systran/faster-distil-whisper-medium.en"
                    >distil-medium.en (~394M) - Fast, English only</option
                  >
                  <option value="Systran/faster-distil-whisper-large-v2"
                    >distil-large-v2 (~756M) - 6x faster</option
                  >
                  <option value="Systran/faster-distil-whisper-large-v3"
                    >distil-large-v3 (~756M) - Best distilled</option
                  >
                </optgroup>
              </select>
            {:else if $settings.whisper.provider === "OpenAI"}
              <select
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.whisper.model}
              >
                <option value="whisper-1">whisper-1 (default)</option>
              </select>
            {:else if $settings.whisper.provider === "Groq"}
              <select
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.whisper.model}
              >
                <option value="whisper-large-v3-turbo"
                  >whisper-large-v3-turbo (recommended)</option
                >
                <option value="whisper-large-v3">whisper-large-v3</option>
                <option value="distil-whisper-large-v3-en"
                  >distil-whisper-large-v3-en (English only)</option
                >
              </select>
            {:else}
              <input
                type="text"
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.whisper.model}
                placeholder="whisper-1"
              />
            {/if}
          </div>

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Language</label
            >
            <input
              type="text"
              class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
              bind:value={$settings.whisper.language}
              placeholder="en"
            />
          </div>

          <button
            class="px-4 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors flex items-center gap-2"
            onclick={testWhisperConnection}
            disabled={testingWhisper}
          >
            {#if testingWhisper}
              <div
                class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"
              ></div>
              Testing...
            {:else}
              Test Connection
            {/if}
          </button>
          {#if whisperStatus === "success"}
            <p class="text-sm text-success">Connection successful!</p>
          {:else if whisperStatus === "partial"}
            <p class="text-sm text-warning">
              Partial connection (transcription may still work)
            </p>
          {:else if whisperStatus === "error"}
            <p class="text-sm text-error">
              Connection failed. Check your endpoint and API key.
            </p>
          {/if}

          {#if whisperTestResult}
            <div class="space-y-1 text-xs">
              <div class="flex items-center gap-2">
                <div
                  class="w-2 h-2 rounded-full {whisperTestResult.health_ok
                    ? 'bg-success'
                    : 'bg-warning'}"
                ></div>
                <span class="text-text-secondary">Health:</span>
                <span class="text-text-muted"
                  >{whisperTestResult.health_ok
                    ? "OK"
                    : whisperTestResult.health_error ||
                      "N/A (some providers don't expose health endpoint)"}</span
                >
              </div>
              <div class="flex items-center gap-2">
                <div
                  class="w-2 h-2 rounded-full {whisperTestResult.transcription_ok
                    ? 'bg-success'
                    : 'bg-error'}"
                ></div>
                <span class="text-text-secondary">Transcription:</span>
                <span class="text-text-muted"
                  >{whisperTestResult.transcription_ok
                    ? "OK"
                    : whisperTestResult.transcription_error || "Failed"}</span
                >
              </div>
            </div>
          {/if}

          <!-- Docker Setup (only for Local provider) -->
          {#if $settings.whisper.provider === "Local"}
            {@const dockerCommand = (() => {
              const parts = ["docker run -d"];

              // Auto-restart option
              if ($settings.whisper.docker.auto_restart) {
                parts.push("--restart unless-stopped");
              }

              // Container name
              if ($settings.whisper.docker.container_name) {
                parts.push(`--name ${$settings.whisper.docker.container_name}`);
              }

              // GPU flag for CUDA
              if ($settings.whisper.docker.compute_type === "GPU") {
                parts.push("--gpus all");
              }

              // Port mapping and volume
              parts.push("-p 8000:8000");
              parts.push("-v ~/.cache/huggingface:/root/.cache/huggingface");

              // Image tag based on compute type
              const imageTag =
                $settings.whisper.docker.compute_type === "GPU"
                  ? "latest-cuda"
                  : "latest-cpu";
              parts.push(`fedirz/faster-whisper-server:${imageTag}`);

              return parts.join(" \\\n  ");
            })()}
            <div class="border-t border-border pt-4 mt-4">
              <label class="block text-sm font-medium text-text-secondary mb-3"
                >Docker Setup</label
              >

              <!-- Compute Type Selection -->
              <div class="mb-4">
                <label class="block text-xs font-medium text-text-muted mb-2"
                  >Compute Type</label
                >
                <div class="flex gap-2">
                  <button
                    class="flex-1 px-3 py-2 text-sm rounded border-2 transition-all flex items-center justify-center gap-2 {$settings
                      .whisper.docker.compute_type === 'CPU'
                      ? 'border-accent bg-accent/10'
                      : 'border-border'}"
                    onclick={() =>
                      settings.update((s) => ({
                        ...s,
                        whisper: {
                          ...s.whisper,
                          docker: { ...s.whisper.docker, compute_type: "CPU" },
                        },
                      }))}
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                      />
                    </svg>
                    <span class="font-medium">CPU</span>
                  </button>
                  <button
                    class="flex-1 px-3 py-2 text-sm rounded border-2 transition-all flex items-center justify-center gap-2 {$settings
                      .whisper.docker.compute_type === 'GPU'
                      ? 'border-accent bg-accent/10'
                      : 'border-border'}"
                    onclick={() =>
                      settings.update((s) => ({
                        ...s,
                        whisper: {
                          ...s.whisper,
                          docker: { ...s.whisper.docker, compute_type: "GPU" },
                        },
                      }))}
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                    <span class="font-medium">GPU</span>
                  </button>
                </div>
                <p class="text-xs text-text-muted mt-1.5">
                  {#if $settings.whisper.docker.compute_type === "CPU"}
                    Good for laptops and systems without NVIDIA GPUs. Slower but
                    works everywhere.
                  {:else}
                    Requires NVIDIA GPU with CUDA. Much faster transcription for
                    desktops.
                  {/if}
                </p>
              </div>

              <!-- Auto-restart Option -->
              <div class="flex items-center justify-between mb-4">
                <div>
                  <label class="text-sm font-medium text-text-secondary"
                    >Auto-start with Docker</label
                  >
                  <p class="text-xs text-text-muted">
                    Container starts automatically when Docker Engine starts
                  </p>
                </div>
                <input
                  type="checkbox"
                  class="toggle"
                  checked={$settings.whisper.docker.auto_restart}
                  onchange={(e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    settings.update((s) => ({
                      ...s,
                      whisper: {
                        ...s.whisper,
                        docker: { ...s.whisper.docker, auto_restart: checked },
                      },
                    }));
                  }}
                />
              </div>

              <!-- Container Name -->
              <div class="mb-4">
                <label class="block text-xs font-medium text-text-muted mb-1"
                  >Container Name</label
                >
                <input
                  type="text"
                  class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent font-mono"
                  value={$settings.whisper.docker.container_name}
                  oninput={(e) => {
                    const value = (e.target as HTMLInputElement).value;
                    settings.update((s) => ({
                      ...s,
                      whisper: {
                        ...s.whisper,
                        docker: { ...s.whisper.docker, container_name: value },
                      },
                    }));
                  }}
                  placeholder="whisper"
                />
              </div>

              <!-- Generated Command -->
              <div>
                <label class="block text-xs font-medium text-text-muted mb-2"
                  >Docker Command</label
                >
                <div class="relative group">
                  <pre
                    class="p-3 bg-background border border-border rounded text-xs font-mono text-text-primary overflow-x-auto whitespace-pre-wrap break-all">{dockerCommand}</pre>
                  <button
                    class="absolute top-2 right-2 p-1.5 bg-surface-elevated hover:bg-border rounded text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                    onclick={async () => {
                      // Copy as single line for easy pasting
                      const singleLine = dockerCommand.replace(/ \\\n  /g, " ");
                      await navigator.clipboard.writeText(singleLine);
                    }}
                    title="Copy to clipboard"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                </div>
                <button
                  class="mt-2 px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded transition-colors flex items-center gap-2"
                  onclick={async () => {
                    const singleLine = dockerCommand.replace(/ \\\n  /g, " ");
                    try {
                      await invoke("run_in_terminal", { command: singleLine });
                    } catch (e) {
                      console.error("Failed to run in terminal:", e);
                    }
                  }}
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run in Terminal
                </button>
              </div>
            </div>
          {/if}
        </div>
      {:else if activeTab === "vosk"}
        <div class="space-y-4">
          <div class="p-3 bg-surface rounded-lg border border-border/50">
            <p class="text-sm text-text-secondary">
              Vosk provides <strong>real-time transcription</strong> while you speak.
              It runs alongside Whisper:
            </p>
            <ul class="mt-2 text-sm text-text-muted list-disc list-inside">
              <li>Vosk shows live text in the overlay as you speak</li>
              <li>Whisper provides the final accurate transcription</li>
              <li>Requires a local Vosk server (Docker recommended)</li>
            </ul>
          </div>

          <!-- Enable toggle -->
          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              class="w-4 h-4 rounded border-border bg-background accent-accent"
              bind:checked={$settings.vosk.enabled}
            />
            <span class="text-sm text-text-secondary"
              >Enable Vosk real-time transcription</span
            >
          </label>

          {#if $settings.vosk.enabled}
            <!-- WebSocket Endpoint -->
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1"
                >WebSocket Endpoint</label
              >
              <input
                type="text"
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.vosk.endpoint}
                placeholder="ws://localhost:2700"
              />
              <p class="text-xs text-text-muted mt-1">
                Default Vosk server uses port 2700
              </p>
            </div>

            <!-- Sample Rate -->
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1"
                >Sample Rate</label
              >
              <select
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.vosk.sample_rate}
              >
                <option value={8000}>8000 Hz (telephony)</option>
                <option value={16000}>16000 Hz (recommended)</option>
                <option value={44100}>44100 Hz (CD quality)</option>
                <option value={48000}>48000 Hz (professional)</option>
              </select>
              <p class="text-xs text-text-muted mt-1">
                Must match the Vosk model's expected sample rate (usually 16kHz)
              </p>
            </div>

            <!-- Show in overlay toggle -->
            <label class="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                class="w-4 h-4 rounded border-border bg-background accent-accent"
                bind:checked={$settings.vosk.show_realtime_transcript}
              />
              <span class="text-sm text-text-secondary"
                >Show real-time transcript in overlay</span
              >
            </label>

            <!-- Accumulate transcript toggle -->
            <div>
              <label class="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  class="w-4 h-4 rounded border-border bg-background accent-accent"
                  bind:checked={$settings.vosk.accumulate_transcript}
                />
                <span class="text-sm text-text-secondary"
                  >Accumulate text across pauses</span
                >
              </label>
              <p class="text-xs text-text-muted mt-1 ml-7">
                When enabled, text accumulates as you speak with pauses. When
                disabled, the transcript resets after each pause.
              </p>
            </div>

            <!-- Connection test -->
            <div class="pt-4 border-t border-border/50">
              <button
                class="px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed"
                onclick={testVoskConnection}
                disabled={testingVosk}
              >
                {testingVosk ? "Testing..." : "Test Connection"}
              </button>
              {#if voskStatus === "success"}
                <span class="ml-2 text-success text-sm"
                  >Connected successfully!</span
                >
              {:else if voskStatus === "error" && voskTestResult}
                <span class="ml-2 text-error text-sm"
                  >{voskTestResult.error || "Connection failed"}</span
                >
              {/if}
            </div>

            <!-- Docker Setup -->
            {@const voskDockerCommand = (() => {
              const parts = ["docker run -d"];

              // Auto-restart option
              if ($settings.vosk.docker.auto_restart) {
                parts.push("--restart unless-stopped");
              }

              // Port mapping
              parts.push("-p 2700:2700");

              // Container name
              if ($settings.vosk.docker.container_name) {
                parts.push(`--name ${$settings.vosk.docker.container_name}`);
              }

              // Image (Vosk uses alphacep images, CPU only)
              parts.push("alphacep/kaldi-en:latest");

              return parts.join(" \\\n  ");
            })()}
            <div class="border-t border-border pt-4 mt-4">
              <label class="block text-sm font-medium text-text-secondary mb-3"
                >Docker Setup</label
              >

              <!-- Auto-restart Option -->
              <div class="flex items-center justify-between mb-4">
                <div>
                  <label class="text-sm font-medium text-text-secondary"
                    >Auto-start with Docker</label
                  >
                  <p class="text-xs text-text-muted">
                    Container starts automatically when Docker Engine starts
                  </p>
                </div>
                <input
                  type="checkbox"
                  class="toggle"
                  checked={$settings.vosk.docker.auto_restart}
                  onchange={(e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    settings.update((s) => ({
                      ...s,
                      vosk: {
                        ...s.vosk,
                        docker: { ...s.vosk.docker, auto_restart: checked },
                      },
                    }));
                  }}
                />
              </div>

              <!-- Container Name -->
              <div class="mb-4">
                <label class="block text-xs font-medium text-text-muted mb-2"
                  >Container Name</label
                >
                <input
                  type="text"
                  class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent font-mono"
                  value={$settings.vosk.docker.container_name}
                  oninput={(e) => {
                    const value = (e.target as HTMLInputElement).value;
                    settings.update((s) => ({
                      ...s,
                      vosk: {
                        ...s.vosk,
                        docker: { ...s.vosk.docker, container_name: value },
                      },
                    }));
                  }}
                  placeholder="claude-whisperer-vosk"
                />
              </div>

              <!-- Generated Command -->
              <div class="mb-3">
                <label class="block text-xs font-medium text-text-muted mb-2"
                  >Docker Command</label
                >
                <div class="relative group">
                  <pre
                    class="p-3 bg-background border border-border rounded text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre-wrap">{voskDockerCommand}</pre>
                  <button
                    class="absolute top-2 right-2 p-1.5 bg-surface-elevated hover:bg-border rounded text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                    onclick={async () => {
                      await navigator.clipboard.writeText(
                        voskDockerCommand.replace(/\s*\\\n\s*/g, " ")
                      );
                    }}
                    title="Copy to clipboard"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                </div>
                <button
                  class="mt-2 px-3 py-1.5 text-sm bg-accent hover:bg-accent/80 text-white rounded transition-colors flex items-center gap-2"
                  onclick={async () => {
                    const singleLine = voskDockerCommand.replace(/\s*\\\n\s*/g, " ");
                    try {
                      await invoke("run_in_terminal", { command: singleLine });
                    } catch (e) {
                      console.error("Failed to run in terminal:", e);
                    }
                  }}
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Run in Terminal
                </button>
              </div>

              <p class="text-xs text-text-muted">
                Other language models: <code class="bg-surface px-1 rounded"
                  >kaldi-cn</code
                >, <code class="bg-surface px-1 rounded">kaldi-ru</code>,
                <code class="bg-surface px-1 rounded">kaldi-fr</code>,
                <code class="bg-surface px-1 rounded">kaldi-de</code>
              </p>
            </div>
          {/if}
        </div>
      {:else if activeTab === "llm"}
        <div class="space-y-4">
          <div class="p-3 bg-surface-elevated rounded border border-border">
            <div class="flex items-center gap-2 mb-2">
              <svg
                class="w-5 h-5 text-accent"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                />
              </svg>
              <span class="text-sm font-medium text-text-primary"
                >LLM Integration</span
              >
            </div>
            <p class="text-xs text-text-muted">
              Use a lightweight LLM for auxiliary tasks like session naming,
              interaction detection, and note structuring. Supports Google
              Gemini, OpenAI, Groq, or local models (LM Studio, Ollama, etc.).
            </p>
          </div>

          <!-- Provider Selection -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Provider</label
            >
            <select
              class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
              bind:value={$settings.llm.provider}
              onchange={(e) => {
                const provider = (e.target as HTMLSelectElement).value;
                // Apply provider presets
                if (provider === "Gemini") {
                  $settings.llm.model = "gemini-2.0-flash";
                  $settings.llm.endpoint = null;
                } else if (provider === "OpenAI") {
                  $settings.llm.model = "gpt-4o-mini";
                  $settings.llm.endpoint = null;
                } else if (provider === "Groq") {
                  $settings.llm.model = "llama-3.3-70b-versatile";
                  $settings.llm.endpoint = null;
                } else if (provider === "Local") {
                  $settings.llm.model = "local-model";
                  $settings.llm.endpoint =
                    "http://localhost:1234/v1/chat/completions";
                }
              }}
            >
              <option value="Gemini">Google Gemini (free tier)</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Groq">Groq (free tier)</option>
              <option value="Local">Local (LM Studio, Ollama, etc.)</option>
              <option value="Custom">Custom OpenAI-compatible</option>
            </select>
            <p class="text-xs text-text-muted mt-1">
              {#if $settings.llm.provider === "Gemini"}
                Free tier: 1,500 requests/day - <a
                  href="https://aistudio.google.com/apikey"
                  class="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer">Get API key</a
                >
              {:else if $settings.llm.provider === "OpenAI"}
                Paid API - <a
                  href="https://platform.openai.com/api-keys"
                  class="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer">Get API key</a
                >
              {:else if $settings.llm.provider === "Groq"}
                Free tier available - <a
                  href="https://console.groq.com/keys"
                  class="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer">Get API key</a
                >
              {:else if $settings.llm.provider === "Local"}
                No API key needed for local models
              {:else}
                Any OpenAI-compatible chat completions endpoint
              {/if}
            </p>
          </div>

          <!-- Endpoint (for Local/Custom) -->
          {#if $settings.llm.provider === "Local" || $settings.llm.provider === "Custom"}
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1"
                >Endpoint</label
              >
              <input
                type="text"
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={$settings.llm.endpoint}
                placeholder="http://localhost:1234/v1/chat/completions"
              />
            </div>
          {/if}

          <!-- API Key (not for Local) -->
          {#if $settings.llm.provider !== "Local"}
            <div class="border-t border-border pt-4">
              <h3 class="text-sm font-medium text-text-primary mb-3">
                API Key
              </h3>
              {#if geminiApiKeySet}
                <div
                  class="flex items-center justify-between p-3 bg-success/10 border border-success/30 rounded"
                >
                  <div class="flex items-center gap-2">
                    <svg
                      class="w-4 h-4 text-success"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span class="text-sm text-text-primary"
                      >API key configured</span
                    >
                  </div>
                  <button
                    class="px-3 py-1.5 text-sm text-error border border-error/30 hover:bg-error/10 rounded transition-colors"
                    onclick={deleteGeminiApiKey}
                  >
                    Remove
                  </button>
                </div>
              {:else}
                <div class="space-y-2">
                  <input
                    type="password"
                    class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                    bind:value={geminiApiKey}
                    placeholder="Enter your API key"
                  />
                  <button
                    class="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded text-sm transition-colors flex items-center gap-2"
                    onclick={saveGeminiApiKey}
                    disabled={!geminiApiKey.trim() || savingGeminiKey}
                  >
                    {#if savingGeminiKey}
                      <div
                        class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                      ></div>
                      Saving...
                    {:else}
                      Save API Key
                    {/if}
                  </button>
                </div>
              {/if}
            </div>
          {/if}

          {#if geminiApiKeySet || $settings.llm.provider === "Local"}
            <div class="border-t border-border pt-4">
              <div class="flex items-center justify-between mb-4">
                <div>
                  <label class="text-sm font-medium text-text-secondary"
                    >Enable LLM Features</label
                  >
                  <p class="text-xs text-text-muted">
                    Use for session naming and interaction detection
                  </p>
                </div>
                <input
                  type="checkbox"
                  class="toggle"
                  bind:checked={$settings.llm.enabled}
                />
              </div>

              {#if $settings.llm.enabled}
                <div class="space-y-4">
                  <div>
                    <label
                      class="block text-sm font-medium text-text-secondary mb-1"
                      >Model</label
                    >
                    {#if $settings.llm.provider === "Gemini"}
                      <!-- Auto Model Toggle for Gemini -->
                      <div
                        class="flex items-center justify-between mb-3 p-3 bg-surface-elevated rounded border border-border"
                      >
                        <div>
                          <span class="text-sm font-medium text-text-primary"
                            >Auto Model Selection</span
                          >
                          <p class="text-xs text-text-muted">
                            Automatically select model with fallbacks
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          class="toggle"
                          checked={$settings.llm.auto_model}
                          onchange={() =>
                            settings.update((s) => ({
                              ...s,
                              llm: { ...s.llm, auto_model: !s.llm.auto_model },
                            }))}
                        />
                      </div>

                      {#if $settings.llm.auto_model}
                        <!-- Speed vs Accuracy Toggle -->
                        <div class="mb-3">
                          <label
                            class="block text-xs font-medium text-text-secondary mb-2"
                            >Priority</label
                          >
                          <div class="flex gap-2">
                            <button
                              class="flex-1 py-2 px-3 rounded text-sm font-medium transition-all {$settings
                                .llm.model_priority === 'speed'
                                ? 'bg-accent text-white'
                                : 'bg-surface-elevated text-text-secondary hover:bg-border'}"
                              onclick={() =>
                                settings.update((s) => ({
                                  ...s,
                                  llm: { ...s.llm, model_priority: "speed" },
                                }))}
                            >
                              <div
                                class="flex items-center justify-center gap-2"
                              >
                                <svg
                                  class="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M13 10V3L4 14h7v7l9-11h-7z"
                                  />
                                </svg>
                                Speed
                              </div>
                            </button>
                            <button
                              class="flex-1 py-2 px-3 rounded text-sm font-medium transition-all {$settings
                                .llm.model_priority === 'accuracy'
                                ? 'bg-accent text-white'
                                : 'bg-surface-elevated text-text-secondary hover:bg-border'}"
                              onclick={() =>
                                settings.update((s) => ({
                                  ...s,
                                  llm: { ...s.llm, model_priority: "accuracy" },
                                }))}
                            >
                              <div
                                class="flex items-center justify-center gap-2"
                              >
                                <svg
                                  class="w-4 h-4"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                Accuracy
                              </div>
                            </button>
                          </div>
                          <p class="text-xs text-text-muted mt-2">
                            {#if $settings.llm.model_priority === "speed"}
                              Prioritizes 2.5 Flash-Lite for faster responses,
                              falls back to 2.5 Flash then 2.0 Flash
                            {:else}
                              Prioritizes 2.5 Flash for better quality, falls
                              back to 2.5 Flash-Lite then 2.0 Flash
                            {/if}
                          </p>
                        </div>
                      {:else}
                        <!-- Manual Model Selection -->
                        <select
                          class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                          bind:value={$settings.llm.model}
                        >
                          <option value="gemini-2.5-flash"
                            >Gemini 2.5 Flash (Recommended)</option
                          >
                          <option value="gemini-2.5-flash-lite"
                            >Gemini 2.5 Flash-Lite</option
                          >
                          <option value="gemini-2.0-flash"
                            >Gemini 2.0 Flash</option
                          >
                        </select>
                        <p class="text-xs text-text-muted mt-1">
                          Gemini 2.5 Flash offers the best balance of speed and
                          quality
                        </p>
                      {/if}
                    {:else if $settings.llm.provider === "OpenAI"}
                      <select
                        class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                        bind:value={$settings.llm.model}
                      >
                        <option value="gpt-4o-mini"
                          >GPT-4o Mini (Recommended)</option
                        >
                        <option value="gpt-4o">GPT-4o</option>
                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                      </select>
                    {:else if $settings.llm.provider === "Groq"}
                      <select
                        class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                        bind:value={$settings.llm.model}
                      >
                        <option value="llama-3.3-70b-versatile"
                          >Llama 3.3 70B (Recommended)</option
                        >
                        <option value="llama-3.1-8b-instant"
                          >Llama 3.1 8B Instant</option
                        >
                        <option value="mixtral-8x7b-32768">Mixtral 8x7B</option>
                        <option value="gemma2-9b-it">Gemma 2 9B</option>
                      </select>
                    {:else}
                      <input
                        type="text"
                        class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                        bind:value={$settings.llm.model}
                        placeholder="model-name"
                      />
                      <p class="text-xs text-text-muted mt-1">
                        Enter the model name as expected by your endpoint
                      </p>
                    {/if}
                  </div>

                  <button
                    class="px-4 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors flex items-center gap-2"
                    onclick={testGeminiConnection}
                    disabled={testingGemini}
                  >
                    {#if testingGemini}
                      <div
                        class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"
                      ></div>
                      Testing...
                    {:else}
                      Test Connection
                    {/if}
                  </button>

                  {#if geminiStatus === "success"}
                    <p class="text-sm text-success">Connection successful!</p>
                  {:else if geminiStatus === "error"}
                    <p class="text-sm text-error">
                      Connection failed: {geminiTestResult?.error ||
                        "Unknown error"}
                    </p>
                  {/if}

                  <div class="border-t border-border pt-4">
                    <h3 class="text-sm font-medium text-text-primary mb-2">
                      Features
                    </h3>
                    <p class="text-xs text-text-muted mb-3">
                      Choose which LLM-powered features to enable. Each feature
                      uses API calls against your provider quota.
                    </p>
                    <div class="space-y-2">
                      <button
                        class="w-full flex items-center justify-between p-3 rounded border-2 transition-all text-left {$settings
                          .llm.features.auto_name_sessions
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-border/80'}"
                        onclick={() =>
                          settings.update((s) => ({
                            ...s,
                            llm: {
                              ...s.llm,
                              features: {
                                ...s.llm.features,
                                auto_name_sessions:
                                  !s.llm.features.auto_name_sessions,
                              },
                            },
                          }))}
                      >
                        <div class="flex items-center gap-3">
                          <div
                            class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0"
                            class:border-accent={$settings.llm.features
                              .auto_name_sessions}
                            class:bg-accent={$settings.llm.features
                              .auto_name_sessions}
                            class:border-border={!$settings.llm.features
                              .auto_name_sessions}
                          >
                            {#if $settings.llm.features.auto_name_sessions}
                              <svg
                                class="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="3"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            {/if}
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <svg
                                class="w-4 h-4 text-text-secondary"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                                />
                              </svg>
                              <span
                                class="text-sm font-medium text-text-primary"
                                >Auto-name Sessions</span
                              >
                            </div>
                            <p class="text-xs text-text-muted mt-0.5">
                              Generate descriptive names and categories for
                              sessions based on the conversation content
                            </p>
                          </div>
                        </div>
                      </button>

                      <button
                        class="w-full flex items-center justify-between p-3 rounded border-2 transition-all text-left {$settings
                          .llm.features.detect_interaction_needed
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-border/80'}"
                        onclick={() =>
                          settings.update((s) => ({
                            ...s,
                            llm: {
                              ...s.llm,
                              features: {
                                ...s.llm.features,
                                detect_interaction_needed:
                                  !s.llm.features.detect_interaction_needed,
                              },
                            },
                          }))}
                      >
                        <div class="flex items-center gap-3">
                          <div
                            class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0"
                            class:border-accent={$settings.llm.features
                              .detect_interaction_needed}
                            class:bg-accent={$settings.llm.features
                              .detect_interaction_needed}
                            class:border-border={!$settings.llm.features
                              .detect_interaction_needed}
                          >
                            {#if $settings.llm.features.detect_interaction_needed}
                              <svg
                                class="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="3"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            {/if}
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <svg
                                class="w-4 h-4 text-text-secondary"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                                />
                              </svg>
                              <span
                                class="text-sm font-medium text-text-primary"
                                >Detect Interaction Needed</span
                              >
                            </div>
                            <p class="text-xs text-text-muted mt-0.5">
                              Analyze Claude's responses to detect when your
                              input is required (questions, approvals,
                              decisions)
                            </p>
                          </div>
                        </div>
                      </button>

                      <button
                        class="w-full flex items-center justify-between p-3 rounded border-2 transition-all text-left {$settings
                          .llm.features.clean_transcription
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-border/80'}"
                        onclick={() =>
                          settings.update((s) => ({
                            ...s,
                            llm: {
                              ...s.llm,
                              features: {
                                ...s.llm.features,
                                clean_transcription:
                                  !s.llm.features.clean_transcription,
                              },
                            },
                          }))}
                      >
                        <div class="flex items-center gap-3">
                          <div
                            class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0"
                            class:border-accent={$settings.llm.features
                              .clean_transcription}
                            class:bg-accent={$settings.llm.features
                              .clean_transcription}
                            class:border-border={!$settings.llm.features
                              .clean_transcription}
                          >
                            {#if $settings.llm.features.clean_transcription}
                              <svg
                                class="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="3"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            {/if}
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <svg
                                class="w-4 h-4 text-text-secondary"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                                />
                              </svg>
                              <span
                                class="text-sm font-medium text-text-primary"
                                >Clean Transcription</span
                              >
                            </div>
                            <p class="text-xs text-text-muted mt-0.5">
                              Fix homophones, technical terms, and punctuation
                              in voice transcriptions before sending to Claude
                            </p>
                          </div>
                        </div>
                      </button>

                      <!-- Dual-source transcription sub-option (only visible when both Clean Transcription and Vosk are enabled) -->
                      {#if $settings.llm.features.clean_transcription && $settings.vosk?.enabled}
                        <button
                          class="w-full flex items-center justify-between p-3 pl-8 rounded border-2 transition-all text-left {$settings
                            .llm.features.use_dual_transcription
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'border-border hover:border-border/80'}"
                          onclick={() =>
                            settings.update((s) => ({
                              ...s,
                              llm: {
                                ...s.llm,
                                features: {
                                  ...s.llm.features,
                                  use_dual_transcription:
                                    !s.llm.features.use_dual_transcription,
                                },
                              },
                            }))}
                        >
                          <div class="flex items-center gap-3">
                            <div
                              class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0"
                              class:border-purple-500={$settings.llm.features
                                .use_dual_transcription}
                              class:bg-purple-500={$settings.llm.features
                                .use_dual_transcription}
                              class:border-border={!$settings.llm.features
                                .use_dual_transcription}
                            >
                              {#if $settings.llm.features.use_dual_transcription}
                                <svg
                                  class="w-3 h-3 text-white"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="3"
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                              {/if}
                            </div>
                            <div>
                              <div class="flex items-center gap-2">
                                <svg
                                  class="w-4 h-4 text-text-secondary"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                                  />
                                </svg>
                                <span
                                  class="text-sm font-medium text-text-primary"
                                  >Use Dual-Source Cleanup</span
                                >
                              </div>
                              <p class="text-xs text-text-muted mt-0.5">
                                Compare both Vosk (real-time) and Whisper
                                (accurate) transcriptions for maximum accuracy
                              </p>
                            </div>
                          </div>
                        </button>
                      {/if}

                      <button
                        class="w-full flex items-center justify-between p-3 rounded border-2 transition-all text-left {$settings
                          .llm.features.recommend_model
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-border/80'}"
                        onclick={() =>
                          settings.update((s) => ({
                            ...s,
                            llm: {
                              ...s.llm,
                              features: {
                                ...s.llm.features,
                                recommend_model:
                                  !s.llm.features.recommend_model,
                              },
                            },
                          }))}
                      >
                        <div class="flex items-center gap-3">
                          <div
                            class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0"
                            class:border-accent={$settings.llm.features
                              .recommend_model}
                            class:bg-accent={$settings.llm.features
                              .recommend_model}
                            class:border-border={!$settings.llm.features
                              .recommend_model}
                          >
                            {#if $settings.llm.features.recommend_model}
                              <svg
                                class="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="3"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            {/if}
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <svg
                                class="w-4 h-4 text-text-secondary"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                                />
                              </svg>
                              <span
                                class="text-sm font-medium text-text-primary"
                                >Smart Model Selection</span
                              >
                            </div>
                            <p class="text-xs text-text-muted mt-0.5">
                              Automatically choose the best Claude model
                              (Haiku/Sonnet/Opus) based on prompt complexity to
                              optimize cost
                            </p>
                          </div>
                        </div>
                      </button>

                      <button
                        class="w-full flex items-center justify-between p-3 rounded border-2 transition-all text-left {$settings
                          .llm.features.auto_select_repo
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-border/80'}"
                        onclick={() =>
                          settings.update((s) => ({
                            ...s,
                            llm: {
                              ...s.llm,
                              features: {
                                ...s.llm.features,
                                auto_select_repo:
                                  !s.llm.features.auto_select_repo,
                              },
                            },
                          }))}
                      >
                        <div class="flex items-center gap-3">
                          <div
                            class="w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0"
                            class:border-accent={$settings.llm.features
                              .auto_select_repo}
                            class:bg-accent={$settings.llm.features
                              .auto_select_repo}
                            class:border-border={!$settings.llm.features
                              .auto_select_repo}
                          >
                            {#if $settings.llm.features.auto_select_repo}
                              <svg
                                class="w-3 h-3 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="3"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            {/if}
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <svg
                                class="w-4 h-4 text-text-secondary"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                                />
                              </svg>
                              <span
                                class="text-sm font-medium text-text-primary"
                                >Auto-select Repository</span
                              >
                            </div>
                            <p class="text-xs text-text-muted mt-0.5">
                              Automatically select the best repository based on
                              prompt content. Requires repo descriptions to be
                              generated.
                            </p>
                          </div>
                        </div>
                      </button>
                    </div>

                    <!-- Sub-options for auto-select repo -->
                    {#if $settings.llm.features.auto_select_repo}
                      <div
                        class="mt-3 ml-8 pl-3 border-l-2 border-border space-y-3"
                      >
                        <div>
                          <label
                            class="block text-sm font-medium text-text-secondary mb-1"
                            >Minimum Confidence for Auto-Select</label
                          >
                          <p class="text-xs text-text-muted mb-2">
                            Only auto-select repos when LLM confidence meets
                            this threshold
                          </p>
                          <select
                            class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                            bind:value={
                              $settings.llm.min_auto_select_confidence
                            }
                          >
                            <option value="high"
                              >High only (most prompts)</option
                            >
                            <option value="medium">Medium or higher</option>
                            <option value="low"
                              >Any confidence (fewest prompts)</option
                            >
                          </select>
                        </div>
                        <div class="flex items-center justify-between">
                          <div>
                            <label
                              class="text-sm font-medium text-text-secondary"
                              >Confirm Repo Selection</label
                            >
                            <p class="text-xs text-text-muted">
                              Claude will question the repo selection if it
                              seems wrong
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            class="toggle"
                            bind:checked={$settings.llm.confirm_repo_selection}
                          />
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          {#if $settings.llm.provider === "Gemini"}
            <div class="border-t border-border pt-4 mt-4">
              <h3 class="text-sm font-medium text-text-secondary mb-2">
                Free Tier Limits
              </h3>
              <div class="text-xs text-text-muted space-y-1">
                <p>
                  <strong>Gemini 2.0 Flash:</strong> 15 RPM, 1M TPM, 1,500 requests/day
                </p>
                <p>
                  <strong>Gemini 2.5 Flash:</strong> 10 RPM, 250K TPM, 250 requests/day
                </p>
                <p>
                  <strong>Gemini 2.5 Flash-Lite:</strong> 15 RPM, 250K TPM, 1,000
                  requests/day
                </p>
                <p class="mt-2 text-text-muted">
                  Limits reset at midnight Pacific Time. No credit card
                  required.
                </p>
              </div>
            </div>
          {:else if $settings.llm.provider === "Groq"}
            <div class="border-t border-border pt-4 mt-4">
              <h3 class="text-sm font-medium text-text-secondary mb-2">
                Free Tier Limits
              </h3>
              <div class="text-xs text-text-muted space-y-1">
                <p><strong>Llama 3.3 70B:</strong> 30 RPM, 6,000 RPD</p>
                <p><strong>Llama 3.1 8B:</strong> 30 RPM, 14,400 RPD</p>
                <p><strong>Mixtral 8x7B:</strong> 30 RPM, 14,400 RPD</p>
                <p class="mt-2 text-text-muted">
                  Generous free tier with no credit card required.
                </p>
              </div>
            </div>
          {:else if $settings.llm.provider === "Local"}
            <div class="border-t border-border pt-4 mt-4">
              <h3 class="text-sm font-medium text-text-secondary mb-2">
                Local Setup
              </h3>
              <div class="text-xs text-text-muted space-y-1">
                <p>
                  <strong>LM Studio:</strong> Download from
                  <a
                    href="https://lmstudio.ai"
                    class="text-accent hover:underline"
                    target="_blank">lmstudio.ai</a
                  >, load a model, and start the server
                </p>
                <p>
                  <strong>Ollama:</strong> Install from
                  <a
                    href="https://ollama.ai"
                    class="text-accent hover:underline"
                    target="_blank">ollama.ai</a
                  >
                  and run
                  <code class="bg-background px-1 rounded">ollama serve</code>
                </p>
                <p class="mt-2 text-text-muted">
                  Recommended models: Llama 3.1 8B, Mistral 7B, Qwen 2.5
                </p>
              </div>
            </div>
          {/if}
        </div>
      {:else if activeTab === "git"}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <label class="text-sm font-medium text-text-secondary"
              >Create New Branch</label
            >
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.git.create_branch}
            />
          </div>
          {#if $settings.git.create_branch}
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-secondary"
                >Use Git Worktrees</label
              >
              <input
                type="checkbox"
                class="toggle"
                bind:checked={$settings.git.use_worktrees}
              />
            </div>
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-secondary"
                >Auto-merge to Main</label
              >
              <input
                type="checkbox"
                class="toggle"
                bind:checked={$settings.git.auto_merge}
              />
            </div>
            <div class="flex items-center justify-between">
              <label class="text-sm font-medium text-text-secondary"
                >Create Pull Request</label
              >
              <input
                type="checkbox"
                class="toggle"
                bind:checked={$settings.git.create_pr}
              />
            </div>
          {/if}
        </div>
      {:else if activeTab === "hotkeys"}
        <div class="space-y-4">
          <div class="p-3 bg-surface-elevated rounded border border-border">
            <p class="text-xs text-text-muted">
              <strong class="text-text-secondary">Recording flow:</strong> Press
              the Record hotkey to start recording. While recording, press either
              hotkey to stop:
            </p>
            <ul class="text-xs text-text-muted mt-1 ml-4 list-disc">
              <li>
                <strong>Record & Send</strong> — transcribes and sends to Claude
              </li>
              <li>
                <strong>Transcribe Only</strong> — transcribes and pastes to current
                app
              </li>
            </ul>
            <p
              class="text-xs text-text-muted mt-2 pt-2 border-t border-border/50"
            >
              <strong class="text-text-secondary">Tip:</strong> Click a hotkey field
              and press your desired key combination to set it.
            </p>
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Record & Send</label
            >
            <p class="text-xs text-text-muted mb-2">
              Starts recording. Press again to transcribe and send to Claude.
            </p>
            <HotkeyInput bind:value={$settings.hotkeys.toggle_recording} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Transcribe Only</label
            >
            <p class="text-xs text-text-muted mb-2">
              While recording, transcribes and pastes into current app (does not
              send to Claude)
            </p>
            <HotkeyInput bind:value={$settings.hotkeys.transcribe_to_input} />
          </div>
          <div class="border-t border-border pt-4">
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Cycle Repository</label
            >
            <p class="text-xs text-text-muted mb-2">
              While recording, cycles through repositories
            </p>
            <HotkeyInput bind:value={$settings.hotkeys.cycle_repo} />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Cycle Model</label
            >
            <p class="text-xs text-text-muted mb-2">
              While recording, cycles through models (Opus → Sonnet → Haiku)
            </p>
            <HotkeyInput bind:value={$settings.hotkeys.cycle_model} />
          </div>
        </div>
      {:else if activeTab === "overlay"}
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Show Overlay When Focused</label
              >
              <p class="text-xs text-text-muted mt-0.5">
                Show the recording overlay even when the app is in focus
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.overlay.show_when_focused}
            />
          </div>
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-text-secondary"
                >Show Hotkey Hints</label
              >
              <p class="text-xs text-text-muted mt-0.5">
                Display keyboard shortcuts in the overlay while recording
              </p>
            </div>
            <input
              type="checkbox"
              class="toggle"
              bind:checked={$settings.overlay.show_hotkey_hints}
            />
          </div>
        </div>
      {:else if activeTab === "repos"}
        <div class="space-y-4">
          <div class="space-y-3">
            {#each $settings.repos as repo, index}
              <div class="p-3 bg-surface-elevated rounded space-y-2">
                <div class="flex items-start gap-2">
                  <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm text-text-primary">
                      {repo.name}
                    </div>
                    <div class="text-xs text-text-muted truncate">
                      {repo.path}
                    </div>
                  </div>
                  <div class="flex gap-1 shrink-0">
                    <!-- Generate description button -->
                    <button
                      class="p-1.5 text-text-muted hover:text-accent transition-colors rounded hover:bg-border disabled:opacity-50"
                      onclick={() => generateRepoDescription(index)}
                      disabled={!$settings.llm.enabled ||
                        generatingDescriptionForIndex !== null}
                      title={!$settings.llm.enabled
                        ? "Enable LLM integration in LLM settings to generate descriptions"
                        : "Generate description from CLAUDE.md or README"}
                    >
                      {#if generatingDescriptionForIndex === index}
                        <svg
                          class="w-4 h-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            class="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            stroke-width="4"
                          ></circle>
                          <path
                            class="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                      {:else}
                        <!-- Sparkle/AI icon -->
                        <svg
                          class="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                          />
                        </svg>
                      {/if}
                    </button>
                    <!-- Remove button -->
                    <button
                      class="p-1.5 text-text-muted hover:text-error transition-colors rounded hover:bg-border"
                      onclick={() => removeRepo(index)}
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <!-- Description, keywords, and vocabulary area -->
                {#if repo.description || repo.keywords?.length || repo.vocabulary?.length}
                  <div
                    class="text-xs bg-background/50 p-2 rounded border border-border/50 space-y-2"
                  >
                    {#if repo.description}
                      <div class="text-text-secondary">{repo.description}</div>
                    {/if}
                    {#if repo.keywords?.length}
                      <div>
                        <span class="text-text-muted text-[10px]">Keywords:</span>
                        <div class="flex flex-wrap gap-1 mt-0.5">
                          {#each repo.keywords as keyword}
                            <span
                              class="px-1.5 py-0.5 bg-accent/10 text-accent text-[10px] rounded"
                              >{keyword}</span
                            >
                          {/each}
                        </div>
                      </div>
                    {/if}
                    {#if repo.vocabulary?.length}
                      <div>
                        <span class="text-text-muted text-[10px]">Vocabulary:</span>
                        <div class="flex flex-wrap gap-1 mt-0.5">
                          {#each repo.vocabulary as term}
                            <span
                              class="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 text-[10px] rounded font-mono"
                              >{term}</span
                            >
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div class="text-xs text-text-muted italic">
                    No description. {#if $settings.llm.enabled}Click ✨ to
                      generate from CLAUDE.md/README.{:else}Enable LLM
                      integration to auto-generate.{/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>

          <div class="border-t border-border pt-4">
            <h3 class="text-sm font-medium text-text-secondary mb-2">
              Add Repository
            </h3>
            <div class="space-y-2">
              <div class="flex gap-2">
                <input
                  type="text"
                  class="flex-1 px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                  bind:value={newRepoPath}
                  placeholder="Path to repository"
                />
                <button
                  class="px-3 py-2 bg-surface-elevated hover:bg-border rounded text-sm transition-colors"
                  onclick={browseFolder}>Browse</button
                >
              </div>
              <input
                type="text"
                class="w-full px-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:border-accent"
                bind:value={newRepoName}
                placeholder="Display name"
              />
              <button
                class="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded text-sm transition-colors"
                onclick={addRepo}
                disabled={!newRepoPath || !newRepoName}>Add Repository</button
              >
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  {#if saveStatus !== "idle"}
    <footer
      class="flex justify-end items-center gap-2 px-4 py-2 border-t border-border"
    >
      {#if saveStatus === "saving"}
        <div
          class="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin"
        ></div>
        <span class="text-xs text-text-muted">Saving...</span>
      {:else if saveStatus === "error"}
        <svg
          class="w-3 h-3 text-error"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
        <span class="text-xs text-error">Failed to save</span>
      {/if}
    </footer>
  {/if}
</div>

<style>
  .toggle {
    appearance: none;
    width: 36px;
    height: 20px;
    background: var(--color-border);
    border-radius: 10px;
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
  }

  .toggle:checked {
    background: var(--color-accent);
  }

  .toggle::before {
    content: "";
    position: absolute;
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
  }

  .toggle:checked::before {
    transform: translateX(16px);
  }
</style>
