// Model color utilities for consistent color coding across the app

export type ModelType = 'opus' | 'sonnet' | 'haiku' | 'unknown';

export function getModelType(modelId: string): ModelType {
  if (modelId.includes('opus')) return 'opus';
  if (modelId.includes('sonnet')) return 'sonnet';
  if (modelId.includes('haiku')) return 'haiku';
  return 'unknown';
}

export function getShortModelName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) {
    if (model.includes('1m') || model.includes('extended')) return 'Sonnet 1M';
    return 'Sonnet';
  }
  if (model.includes('haiku')) return 'Haiku';
  const parts = model.split('-');
  return parts[parts.length - 1] || model;
}

// Background colors for selected/active state
export function getModelBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'bg-purple-600';
    case 'sonnet': return 'bg-amber-600';
    case 'haiku': return 'bg-emerald-600';
    default: return 'bg-accent';
  }
}

// Lighter background colors for badges/pills
export function getModelBadgeBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'bg-purple-500/20';
    case 'sonnet': return 'bg-amber-500/20';
    case 'haiku': return 'bg-emerald-500/20';
    default: return 'bg-accent/20';
  }
}

// Text colors for badges/labels
export function getModelTextColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'text-purple-400';
    case 'sonnet': return 'text-amber-400';
    case 'haiku': return 'text-emerald-400';
    default: return 'text-accent';
  }
}

// Ring/border colors for focus states
export function getModelRingColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'ring-purple-600';
    case 'sonnet': return 'ring-amber-600';
    case 'haiku': return 'ring-emerald-600';
    default: return 'ring-accent';
  }
}

// Hover background colors for unselected buttons
export function getModelHoverBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'hover:bg-purple-500/10';
    case 'sonnet': return 'hover:bg-amber-500/10';
    case 'haiku': return 'hover:bg-emerald-500/10';
    default: return 'hover:bg-border';
  }
}
