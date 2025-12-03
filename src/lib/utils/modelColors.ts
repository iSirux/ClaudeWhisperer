// Model color utilities for consistent color coding across the app
// Each model has a distinct color that follows the current theme

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

// Background colors for selected/active state - uses theme model colors
export function getModelBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'bg-model-opus';
    case 'sonnet': return 'bg-model-sonnet';
    case 'haiku': return 'bg-model-haiku';
    default: return 'bg-accent';
  }
}

// Lighter background colors for badges/pills - uses theme model colors
export function getModelBadgeBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'bg-model-opus/20';
    case 'sonnet': return 'bg-model-sonnet/20';
    case 'haiku': return 'bg-model-haiku/20';
    default: return 'bg-accent/20';
  }
}

// Text colors for badges/labels - uses theme model colors
export function getModelTextColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'text-model-opus';
    case 'sonnet': return 'text-model-sonnet';
    case 'haiku': return 'text-model-haiku';
    default: return 'text-accent';
  }
}

// Ring/border colors for focus states - uses theme model colors
export function getModelRingColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'ring-model-opus';
    case 'sonnet': return 'ring-model-sonnet';
    case 'haiku': return 'ring-model-haiku';
    default: return 'ring-accent';
  }
}

// Hover background colors for unselected buttons - uses theme model colors
export function getModelHoverBgColor(modelId: string): string {
  const type = getModelType(modelId);
  switch (type) {
    case 'opus': return 'hover:bg-model-opus/10';
    case 'sonnet': return 'hover:bg-model-sonnet/10';
    case 'haiku': return 'hover:bg-model-haiku/10';
    default: return 'hover:bg-accent/10';
  }
}
