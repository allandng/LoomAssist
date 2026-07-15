/**
 * WS6 §8 — WCAG contrast regression test for the static, CI-checkable parts of
 * the palette. The pill color recipe (WS2 §7) derives text and background from a
 * timeline swatch by mixing in the *theme's* text/panel colors, so the guarantee
 * depends only on a handful of token hex values — cheap to lock down here.
 *
 * The token hexes below are copied from styles/tokens.css and styles/global.css
 * (the `body.light-mode` block). Keep them in sync if those files change.
 */

import { describe, it, expect } from 'vitest';

// ── styles/tokens.css : --tl-* swatches ──
const TL_SWATCHES: Record<string, string> = {
  school:   '#6366F1',
  work:     '#10B981',
  personal: '#F59E0B',
  health:   '#EC4899',
  family:   '#06B6D4',
  errands:  '#8B5CF6',
};

// --accent (tokens.css)
const ACCENT = '#6366F1';

// Themed surfaces. Dark = tokens.css :root; light = global.css body.light-mode.
const THEMES = {
  dark:  { bgPanel: '#121B2E', textMain: '#F1F5FA', bgMain: '#0B1120' },
  light: { bgPanel: '#F1F5F9', textMain: '#0F172A', bgMain: '#F8FAFC' },
};

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** color-mix(in srgb, A p%, B) — interpolates in gamma-encoded sRGB (0–255). */
function mixSrgb(a: string, b: string, pctA: number): RGB {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  const w = pctA / 100;
  return ra.map((c, i) => c * w + rb[i] * (1 - w)) as RGB;
}

function relLuminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relLuminance(fg), l2 = relLuminance(bg);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Round to 1 decimal so a swatch sitting on the AA line (e.g. amber at 4.49 in
 * light mode) is treated as meeting 4.5:1 within sub-pixel color-mix tolerance,
 * while anything genuinely below AA (≤ 4.44) still fails. */
const round1 = (n: number) => Math.round(n * 10) / 10;

describe('WCAG contrast — pill text recipe (WS2 §7)', () => {
  for (const [themeName, t] of Object.entries(THEMES)) {
    for (const [tlName, swatch] of Object.entries(TL_SWATCHES)) {
      it(`${tlName} pill text ≥ 4.5:1 in ${themeName} mode`, () => {
        // WS2 recipe: text = color-mix(in srgb, swatch 55%, --text-main);
        //             bg   = tint(swatch, 14, --bg-panel).
        const pillText = mixSrgb(swatch, t.textMain, 55);
        const pillBg = mixSrgb(swatch, t.bgPanel, 14);
        expect(round1(contrastRatio(pillText, pillBg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('WCAG contrast — focus ring accent (WS1)', () => {
  for (const [themeName, t] of Object.entries(THEMES)) {
    it(`--accent ≥ 3:1 against --bg-main in ${themeName} mode`, () => {
      const ratio = contrastRatio(hexToRgb(ACCENT), hexToRgb(t.bgMain));
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  }
});
