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
      {#each [{ id: "Midnight" as Theme, label: "Midnight", desc: "Pure black", colors: ["#0f0f0f", "#1a1a1a", "#6366f1"] }, { id: "Slate" as Theme, label: "Slate", desc: "Blue-gray", colors: ["#1e293b", "#334155", "#3b82f6"] }, { id: "Void" as Theme, label: "Void", desc: "Cosmic purple", colors: ["#0d0a12", "#161222", "#9d4edd"] }, { id: "Ember" as Theme, label: "Ember", desc: "Warm fire", colors: ["#110a08", "#1a1210", "#e85d04"] }] as theme}
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
      {#each [{ id: "Pearl" as Theme, label: "Pearl", desc: "Clean silver", colors: ["#f8f9fc", "#e2e7ef", "#3b5fc1"] }, { id: "Latte" as Theme, label: "Latte", desc: "Warm cream", colors: ["#fcf8f4", "#ebe0d2", "#a0522d"] }] as theme}
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
