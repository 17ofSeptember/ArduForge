/**
 * Colour maths for the theme audit page (THEME.md Phase 6.1).
 *
 * The audit page has to show each token's OKLCH value and its computed contrast
 * against the surface it sits on, with a pass/fail badge. It reads the tokens
 * out of the live document with getComputedStyle, so the conversions have to
 * happen in the browser rather than in the Node-side generator.
 *
 * This deliberately holds no colour values — only pure functions. The numbers
 * still come from tokens.css, so there is nothing here that can drift out of
 * step with it.
 *
 * sRGB <-> OKLab per Björn Ottosson; contrast is WCAG 2.1 relative luminance.
 * These match scripts/generate-tokens.mjs and scripts/contrast-check.ts, which
 * is verified by client/src/styles/color.test.ts against known token values.
 */

export type Rgb = readonly [number, number, number];
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

const toLinear = (value: number): number =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

/**
 * Parses the forms tokens.css actually emits: 6- and 3-digit hex, and the
 * `rgb(r g b / a)` used by the scrim. Anything else returns null rather than
 * guessing — the audit page renders "—" instead of a wrong number.
 */
export function parseColor(input: string): Rgb | null {
  const text = input.trim();

  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text);
  if (hex !== null) {
    const body = hex[1] as string;
    const full =
      body.length === 3
        ? body
            .split('')
            .map((char) => char + char)
            .join('')
        : body;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as unknown as Rgb;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*[\d.%]+\s*)?\)$/.exec(text);
  if (rgb !== null) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255] as const;
  }

  return null;
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export function toOklch([r, g, b]: Rgb): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  let hue = (Math.atan2(bb, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;

  return { l: lightness, c: Math.hypot(a, bb), h: hue };
}

export function formatOklch(value: Oklch): string {
  return `oklch(${(value.l * 100).toFixed(1)}% ${value.c.toFixed(3)} ${value.h.toFixed(0)})`;
}

export function toHex([r, g, b]: Rgb): string {
  const channel = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

/** Grayscale stand-in for the Phase 6.2 desaturation test. */
export function toGrayHex(rgb: Rgb): string {
  const y = luminance(rgb);
  // Back through the sRGB transfer function so the swatch matches what a
  // desaturating filter would actually produce.
  const channel = y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
  return toHex([channel, channel, channel]);
}
