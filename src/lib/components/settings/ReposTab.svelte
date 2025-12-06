<script lang="ts">
  import { settings } from "$lib/stores/settings";
  import { invoke } from "@tauri-apps/api/core";

  interface RepoDescriptionResult {
    description: string;
    keywords: string[];
    vocabulary: string[];
  }

  let newRepoPath = $state("");
  let newRepoName = $state("");
  let generatingDescriptionForIndex: number | null = $state(null);

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
