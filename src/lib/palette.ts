import type { SwatchColor } from '../types';

// 8 hue families × 4 lightness tiers, matching Whimsical's palette structure.
// Tier 1–2: light pastels (dark text). Tier 4: deep fills (white text).
// Tier 3 is saturated and sits near the luminance threshold; `isDarkFill`
// decides per swatch (e.g. yellow-3 keeps dark text, blue-3 gets white).
export const PALETTE: SwatchColor[] = [
  // ── Tier 1: lightest pastels ──────────────────────────────────────
  { id: 'gray-1',   fill: '#F3F4F6', stroke: '#D1D5DB' },
  { id: 'blue-1',   fill: '#DBEAFE', stroke: '#93C5FD' },
  { id: 'violet-1', fill: '#EDE9FE', stroke: '#C4B5FD' },
  { id: 'pink-1',   fill: '#FCE7F3', stroke: '#F9A8D4' },
  { id: 'green-1',  fill: '#D1FAE5', stroke: '#6EE7B7' },
  { id: 'teal-1',   fill: '#CCFBF1', stroke: '#5EEAD4' },
  { id: 'yellow-1', fill: '#FEF3C7', stroke: '#FCD34D' },
  { id: 'orange-1', fill: '#FFEDD5', stroke: '#FDBA74' },

  // ── Tier 2: medium pastels ────────────────────────────────────────
  { id: 'gray-2',   fill: '#E5E7EB', stroke: '#9CA3AF' },
  { id: 'blue-2',   fill: '#BFDBFE', stroke: '#60A5FA' },
  { id: 'violet-2', fill: '#DDD6FE', stroke: '#A78BFA' },
  { id: 'pink-2',   fill: '#FBCFE8', stroke: '#F472B6' },
  { id: 'green-2',  fill: '#A7F3D0', stroke: '#34D399' },
  { id: 'teal-2',   fill: '#99F6E4', stroke: '#2DD4BF' },
  { id: 'yellow-2', fill: '#FDE68A', stroke: '#FBBF24' },
  { id: 'orange-2', fill: '#FED7AA', stroke: '#FB923C' },

  // ── Tier 3: saturated fills (white text) ──────────────────────────
  { id: 'gray-3',   fill: '#6B7280', stroke: '#4B5563' },
  { id: 'blue-3',   fill: '#3B82F6', stroke: '#2563EB' },
  { id: 'violet-3', fill: '#8B5CF6', stroke: '#7C3AED' },
  { id: 'pink-3',   fill: '#EC4899', stroke: '#DB2777' },
  { id: 'green-3',  fill: '#10B981', stroke: '#059669' },
  { id: 'teal-3',   fill: '#14B8A6', stroke: '#0D9488' },
  { id: 'yellow-3', fill: '#F59E0B', stroke: '#D97706' },
  { id: 'orange-3', fill: '#F97316', stroke: '#EA580C' },

  // ── Tier 4: deep fills (white text) ───────────────────────────────
  { id: 'gray-4',   fill: '#374151', stroke: '#1F2937' },
  { id: 'blue-4',   fill: '#1D4ED8', stroke: '#1E40AF' },
  { id: 'violet-4', fill: '#6D28D9', stroke: '#5B21B6' },
  { id: 'pink-4',   fill: '#BE185D', stroke: '#9D174D' },
  { id: 'green-4',  fill: '#047857', stroke: '#065F46' },
  { id: 'teal-4',   fill: '#0F766E', stroke: '#115E59' },
  { id: 'yellow-4', fill: '#92400E', stroke: '#78350F' },
  { id: 'orange-4', fill: '#C2410C', stroke: '#9A3412' },
];

export const DEFAULT_SWATCH = PALETTE[1]; // blue-1 light pastel

export const COLS = 8;

/**
 * Returns true if the fill is dark enough to warrant white text.
 * Uses the W3C relative luminance formula.
 */
export function isDarkFill(fill: string): boolean {
  if (!fill || fill === 'transparent') return false;
  const hex = fill.replace('#', '');
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 0.5;
}
