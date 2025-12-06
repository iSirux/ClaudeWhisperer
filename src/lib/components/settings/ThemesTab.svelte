<script lang="ts">
  import { settings, type Theme } from "$lib/stores/settings";
</script>

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
