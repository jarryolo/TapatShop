import { describe, expect, it } from "vitest";

/**
 * Contrast budget for the design tokens.
 *
 * docs/05 requires WCAG AA — 4.5:1 for body text. This test is the enforcement: change a
 * token to something that fails and the suite goes red, rather than someone noticing during
 * an accessibility audit after launch.
 *
 * The values are duplicated from app/globals.css on purpose. Parsing the stylesheet would
 * make the test pass whenever the CSS is self-consistent, which is not the property we want
 * — we want the numbers themselves pinned.
 */

const TOKENS = {
  brand50: "#e6f1fb",
  brand400: "#378add",
  brand600: "#185fa5",
  brand800: "#0c447c",

  page: "#f7f8fa",
  surface: "#ffffff",

  text: "#10151c",
  textMuted: "#5b6672",
  textSoft: "#68727f",

  success: "#1d9e75",
  successSoft: "#e7f6f1",
  successText: "#137055",
  warningSoft: "#fbf1e2",
  warningText: "#8a5510",
  danger: "#d14343",
  dangerSoft: "#fbeaea",
  dangerText: "#a82f2f",

  white: "#ffffff",
} as const;

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));

  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

describe("contrast helper", () => {
  it("matches the known extremes", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is order independent", () => {
    expect(contrast(TOKENS.text, TOKENS.surface)).toBeCloseTo(
      contrast(TOKENS.surface, TOKENS.text),
      5
    );
  });
});

describe("body text meets WCAG AA on both surfaces", () => {
  const pairs: [string, string, string][] = [
    ["text on page", TOKENS.text, TOKENS.page],
    ["text on surface", TOKENS.text, TOKENS.surface],
    ["text-muted on page", TOKENS.textMuted, TOKENS.page],
    ["text-muted on surface", TOKENS.textMuted, TOKENS.surface],
    ["text-soft on page", TOKENS.textSoft, TOKENS.page],
    ["text-soft on surface", TOKENS.textSoft, TOKENS.surface],
  ];

  it.each(pairs)("%s", (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("interactive and filled surfaces", () => {
  const pairs: [string, string, string][] = [
    ["brand-600 text on white", TOKENS.brand600, TOKENS.surface],
    ["white on brand-600 (primary button)", TOKENS.white, TOKENS.brand600],
    ["white on brand-800 (primary hover)", TOKENS.white, TOKENS.brand800],
    ["white on danger (danger button)", TOKENS.white, TOKENS.danger],
    ["brand-800 on brand-50 (brand badge, member price)", TOKENS.brand800, TOKENS.brand50],
  ];

  it.each(pairs)("%s", (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("badge text on its pale fill", () => {
  const pairs: [string, string, string][] = [
    ["success", TOKENS.successText, TOKENS.successSoft],
    ["warning", TOKENS.warningText, TOKENS.warningSoft],
    ["danger", TOKENS.dangerText, TOKENS.dangerSoft],
    ["neutral", TOKENS.textMuted, TOKENS.page],
  ];

  it.each(pairs)("%s badge", (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it("is why the semantic base colours are not used for badge text", () => {
    // Kept as a record of the problem: the palette in docs/05 does not clear AA on its own
    // pale fills, which is why -text variants exist.
    expect(contrast(TOKENS.success, TOKENS.successSoft)).toBeLessThan(4.5);
    expect(contrast(TOKENS.danger, TOKENS.dangerSoft)).toBeLessThan(4.5);
  });
});

describe("brand-400", () => {
  it("fails on white, which is why docs/05 forbids it for text", () => {
    expect(contrast(TOKENS.brand400, TOKENS.surface)).toBeLessThan(4.5);
  });

  it("is still fine as a non-text accent against the page", () => {
    // 3:1 is the AA threshold for UI component boundaries rather than text.
    expect(contrast(TOKENS.brand400, TOKENS.page)).toBeGreaterThanOrEqual(3);
  });
});
