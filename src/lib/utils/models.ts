// All available models with metadata
export interface ModelInfo {
  id: string;
  label: string;
  title: string;
  isAuto?: boolean; // Special flag for auto model selection
}

// Special "Auto" model that uses LLM integration to recommend the best model
export const AUTO_MODEL: ModelInfo = {
  id: "auto",
  label: "Auto",
  title: "Automatically select the best model using LLM integration",
  isAuto: true,
};

export const ALL_MODELS: ModelInfo[] = [
  {
    id: "claude-opus-4-5-20251101",
    label: "Opus",
    title: "Claude Opus 4.5 - Most capable model",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    label: "Sonnet",
    title: "Claude Sonnet 4.5 - Balanced performance",
  },
  {
    id: "claude-sonnet-4-5-20250929[1m]",
    label: "Sonnet 1M",
    title: "Claude Sonnet 4.5 - 1M token context window",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku",
    title: "Claude Haiku 4.5 - Fastest model",
  },
];

// Check if a model ID is the auto model
export function isAutoModel(modelId: string): boolean {
  return modelId === AUTO_MODEL.id;
}

// Get enabled models filtered by the enabled_models setting
export function getEnabledModels(enabledModelIds: string[]): ModelInfo[] {
  return ALL_MODELS.filter((model) => enabledModelIds.includes(model.id));
}

// Get enabled models with Auto option always prepended
// The Auto option is always shown, but isAutoEnabled indicates if the feature is active
export function getEnabledModelsWithAuto(enabledModelIds: string[], _includeAuto?: boolean): ModelInfo[] {
  const models = getEnabledModels(enabledModelIds);
  // Always include Auto option - the component will handle navigation to settings if not enabled
  return [AUTO_MODEL, ...models];
}

// Get model info by ID
export function getModelById(id: string): ModelInfo | undefined {
  if (id === AUTO_MODEL.id) return AUTO_MODEL;
  return ALL_MODELS.find((model) => model.id === id);
}

// Default model to use when no other model is available
export const DEFAULT_MODEL_ID = "claude-sonnet-4-5-20250929";

/**
 * Resolve a model ID for use with the API.
 * If the model is "auto" and no recommendation was made, falls back to the first enabled model
 * or the default model.
 *
 * @param modelId The model ID to resolve
 * @param enabledModels Array of enabled model IDs
 * @returns A valid model ID that can be sent to the API
 */
export function resolveModelForApi(modelId: string, enabledModels: string[]): string {
  if (isAutoModel(modelId)) {
    // "auto" should never be sent to the API - fall back to first enabled model
    return enabledModels[0] || DEFAULT_MODEL_ID;
  }
  return modelId;
}
