// Model color utilities for consistent color coding across the app
// Each model has a distinct color that follows the current theme

export type ModelType =
  | 'fable'
  | 'opus'
  | 'sonnet'
  | 'haiku'
  | 'auto'
  | 'astra'
  | 'sol'
  | 'terra'
  | 'luna'
  | 'codex'
  | 'spark'
  | 'mini'
  | 'unknown';

export function getModelType(modelId: string): ModelType {
  if (modelId === 'auto') return 'auto';
  if (modelId.includes('fable')) return 'fable';
  if (modelId.includes('opus')) return 'opus';
  if (modelId.includes('sonnet')) return 'sonnet';
  if (modelId.includes('haiku')) return 'haiku';
  // OpenAI/Codex models. Keep the order from most specific to most general so
  // variants such as Spark and Mini retain their own colors.
  if (modelId.startsWith('gpt-6-astra')) return 'astra';
  if (modelId.startsWith('gpt-5.6-sol')) return 'sol';
  if (modelId.startsWith('gpt-5.6-terra')) return 'terra';
  if (modelId.startsWith('gpt-5.6-luna')) return 'luna';
  if (modelId.includes('spark')) return 'spark';
  if (modelId.includes('mini')) return 'mini';
  if (modelId.startsWith('codex') || modelId.startsWith('gpt-')) return 'codex';
  return 'unknown';
}

export function getShortModelName(model: string): string {
  if (model === 'auto') return 'Auto';
  if (model.includes('fable')) {
    if (model.includes('fable-5-1')) return 'Fable 5.1';
    return 'Fable 5';
  }
  if (model.includes('opus')) {
    if (model.includes('opus-5')) return 'Opus 5';
    if (model.includes('opus-4-8')) return 'Opus 4.8';
    if (model.includes('opus-4-7')) return 'Opus 4.7';
    if (model.includes('opus-4-6')) return 'Opus 4.6';
    return 'Opus';
  }
  if (model.includes('sonnet')) {
    if (model.includes('sonnet-5')) return 'Sonnet 5';
    return 'Sonnet';
  }
  if (model.includes('haiku')) return 'Haiku';
  // OpenAI models
  if (model.startsWith('codex-mini')) return 'Codex Mini';
  if (model.startsWith('codex')) return 'Codex';
  if (model === 'gpt-6-astra') return '6 Astra';
  if (model === 'gpt-5.6-sol') return '5.6 Sol';
  if (model === 'gpt-5.6-terra') return '5.6 Terra';
  if (model === 'gpt-5.6-luna') return '5.6 Luna';
  if (model === 'gpt-5.5') return '5.5';
  if (model === 'gpt-5.4' || model === 'gpt-5.4-codex') return '5.4';
  if (model === 'gpt-5-mini' || model === 'gpt-5.4-mini') return '5.4 Mini';
  if (model === 'gpt-5.3-codex-spark') return '5.3 Spark';
  if (model === 'gpt-5.3-codex') return '5.3 Codex';
  if (model === 'gpt-5.2-codex') return '5.2 Codex';
  if (model === 'gpt-5-codex') return '5 Codex';
  if (model.startsWith('gpt-')) return model;
  const parts = model.split('-');
  return parts[parts.length - 1] || model;
}

// Background colors for selected/active state - uses theme model colors
export function getModelBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'auto': return 'bg-gradient-to-r from-purple-500 to-amber-500';
    case 'fable': return 'bg-model-fable';
    case 'opus': return 'bg-model-opus';
    case 'sonnet': return 'bg-model-sonnet';
    case 'haiku': return 'bg-model-haiku';
    case 'astra': return 'bg-model-astra';
    case 'sol': return 'bg-model-sol';
    case 'terra': return 'bg-model-terra';
    case 'luna': return 'bg-model-luna';
    case 'codex': return 'bg-model-codex';
    case 'spark': return 'bg-model-spark';
    case 'mini': return 'bg-model-mini';
    default: return 'bg-accent';
  }
}

// Lighter background colors for badges/pills - uses theme model colors
export function getModelBadgeBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'auto': return 'bg-gradient-to-r from-purple-500/20 to-amber-500/20';
    case 'fable': return 'bg-model-fable/20';
    case 'opus': return 'bg-model-opus/20';
    case 'sonnet': return 'bg-model-sonnet/20';
    case 'haiku': return 'bg-model-haiku/20';
    case 'astra': return 'bg-model-astra/20';
    case 'sol': return 'bg-model-sol/20';
    case 'terra': return 'bg-model-terra/20';
    case 'luna': return 'bg-model-luna/20';
    case 'codex': return 'bg-model-codex/20';
    case 'spark': return 'bg-model-spark/20';
    case 'mini': return 'bg-model-mini/20';
    default: return 'bg-accent/20';
  }
}

// Text colors for badges/labels - uses theme model colors
export function getModelTextColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'auto': return 'text-purple-400';
    case 'fable': return 'text-model-fable';
    case 'opus': return 'text-model-opus';
    case 'sonnet': return 'text-model-sonnet';
    case 'haiku': return 'text-model-haiku';
    case 'astra': return 'text-model-astra';
    case 'sol': return 'text-model-sol';
    case 'terra': return 'text-model-terra';
    case 'luna': return 'text-model-luna';
    case 'codex': return 'text-model-codex';
    case 'spark': return 'text-model-spark';
    case 'mini': return 'text-model-mini';
    default: return 'text-accent';
  }
}

// Ring/border colors for focus states - uses theme model colors
export function getModelRingColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'auto': return 'ring-purple-400';
    case 'fable': return 'ring-model-fable';
    case 'opus': return 'ring-model-opus';
    case 'sonnet': return 'ring-model-sonnet';
    case 'haiku': return 'ring-model-haiku';
    case 'astra': return 'ring-model-astra';
    case 'sol': return 'ring-model-sol';
    case 'terra': return 'ring-model-terra';
    case 'luna': return 'ring-model-luna';
    case 'codex': return 'ring-model-codex';
    case 'spark': return 'ring-model-spark';
    case 'mini': return 'ring-model-mini';
    default: return 'ring-accent';
  }
}

// Hover background colors for unselected buttons - uses theme model colors
export function getModelHoverBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'auto': return 'hover:bg-purple-500/10';
    case 'fable': return 'hover:bg-model-fable/10';
    case 'opus': return 'hover:bg-model-opus/10';
    case 'sonnet': return 'hover:bg-model-sonnet/10';
    case 'haiku': return 'hover:bg-model-haiku/10';
    case 'astra': return 'hover:bg-model-astra/10';
    case 'sol': return 'hover:bg-model-sol/10';
    case 'terra': return 'hover:bg-model-terra/10';
    case 'luna': return 'hover:bg-model-luna/10';
    case 'codex': return 'hover:bg-model-codex/10';
    case 'spark': return 'hover:bg-model-spark/10';
    case 'mini': return 'hover:bg-model-mini/10';
    default: return 'hover:bg-accent/10';
  }
}
