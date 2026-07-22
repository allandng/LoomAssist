/**
 * Single source of truth for timeline color defaults and tinting.
 *
 * Replaces six divergent `'#6366F1'` fallbacks scattered across the app and the
 * `` `${color}22` `` hex-suffix alpha hack (which silently breaks on any color
 * that isn't a 6-digit hex). `tint()` uses `color-mix`, which works for every
 * CSS color and, when the base is a themed token, follows light/dark mode.
 */

export const DEFAULT_TIMELINE_COLOR = '#6366F1';

/** Timeline swatch palette — must match the `--tl-*` tokens in tokens.css. */
export const TIMELINE_PALETTE = [
  '#6366F1', // school
  '#10B981', // work
  '#F59E0B', // personal
  '#EC4899', // health
  '#06B6D4', // family
  '#8B5CF6', // errands
  '#EF4444', // (extra)
];

/**
 * Mix `color` `pct`% over `base` (default transparent → a soft translucent tint).
 * Pass a token like `var(--bg-panel)` as `base` for an opaque themed surface.
 */
export const tint = (color: string, pct: number, base = 'transparent'): string =>
  `color-mix(in srgb, ${color} ${pct}%, ${base})`;
