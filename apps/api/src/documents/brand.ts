import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * FB-20: the Pretium brand for generated Word documents, in one place. From the Pretium Design System
 * (1.5.2, the plugin standard) and its `pretium-branding` application notes. Colours are the approved hex
 * values (no others); the renderer never names a colour, font or size of its own.
 *
 * Fonts: the design system's `.docx` fallbacks. Value Serif Pro (display) and Basis Grotesque Pro (body)
 * are not on a standard Word install, and the brand fonts are licensed for Pretium's internal outputs, so
 * a customer letter uses Georgia for display and Arial for body: what every recipient's Word has.
 */

export const BRAND = {
  color: {
    /** Pretium Green (PMS 330 C): dominant. Titles, headings, table header rows, rules. */
    green: '225651',
    /** Pretium Copper (PMS 7580 C): small doses. Eyebrows, list arrows, the DRAFT warning. */
    copper: 'C05131',
    black: '000000',
    white: 'FFFFFF',
    /** Secondary text, labels, footer. */
    gray: '454545',
    /** Green tints (design system ten-step range). */
    tint20: 'C7D5D3',
    tint10: 'DFE6E5',
    tint5: 'F5F7F6',
  },
  font: {
    display: 'Georgia',
    body: 'Arial',
  },
  /** Half-points (Word's unit for font size): 21 = 10.5 pt. */
  size: {
    title: 56,
    subtitle: 22,
    heading: 28,
    body: 20,
    table: 18,
    tableHeader: 16,
    label: 15,
    eyebrow: 16,
    small: 15,
    detailValue: 22,
  },
  /** Twentieths of a point (twips): 1440 = 1 inch. */
  page: {
    width: 12240,
    height: 15840,
    marginTop: 1300,
    marginBottom: 1080,
    marginX: 1152,
    header: 560,
    footer: 500,
  },
  logo: {
    file: 'pretium-primary-fullcolor.png',
    /** Pixels at 96 dpi: 156 px ≈ 1.63 in wide (the file is 1200 × 227). */
    width: 156,
    height: 30,
  },
} as const;

/** The content width between the side margins, in twips. */
export const CONTENT_WIDTH = BRAND.page.width - 2 * BRAND.page.marginX;

let logo: Buffer | null = null;

/**
 * The approved primary logo (full colour), from `apps/api/assets/brand` (copied from the design
 * system's `assets/logos/primary-fullcolor.png`). In the built API it sits in `dist/assets`.
 */
export function brandLogo(): Buffer {
  if (logo) return logo;
  const candidates = [
    // src/documents/brand.ts → apps/api/assets
    new URL(`../../assets/brand/${BRAND.logo.file}`, import.meta.url),
    // dist/server.js → dist/assets
    new URL(`./assets/brand/${BRAND.logo.file}`, import.meta.url),
    new URL(`../assets/brand/${BRAND.logo.file}`, import.meta.url),
  ];
  for (const url of candidates) {
    const path = fileURLToPath(url);
    if (existsSync(path)) {
      logo = readFileSync(path);
      return logo;
    }
  }
  throw new Error(`The Pretium logo (${BRAND.logo.file}) is missing from the API's assets`);
}
