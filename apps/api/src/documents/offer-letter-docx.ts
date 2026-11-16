import type { OfferLetterModel } from '@ccq/domain';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from 'docx';

import { BRAND, CONTENT_WIDTH, brandLogo } from './brand';

/**
 * FB-20 (F-070): the offer letter as a Word document, laid out in the Pretium brand (`brand.ts`). It
 * takes the domain's plain model and returns the bytes; every word comes from the model. Text is
 * always written through `TextRun` (the library escapes it), never as markup. US Letter, editable in
 * Word: the KAM may adjust it before sending.
 */

const C = BRAND.color;
const S = BRAND.size;
const BULLETS = 'offer-letter-bullets';

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'auto' };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const NO_TABLE_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };
const hairline = (color: string = C.tint10, size = 4): IBorderOptions => ({
  style: BorderStyle.SINGLE,
  size,
  color,
});

const run = (
  text: string,
  o: {
    size?: number;
    color?: string;
    bold?: boolean;
    font?: string;
    caps?: boolean;
    spacing?: number;
    italics?: boolean;
  } = {},
) =>
  new TextRun({
    text,
    size: o.size ?? S.body,
    color: o.color ?? C.black,
    bold: o.bold ?? false,
    italics: o.italics ?? false,
    font: o.font ?? BRAND.font.body,
    allCaps: o.caps ?? false,
    ...(o.spacing ? { characterSpacing: o.spacing } : {}),
  });

/** A small spaced-caps label ("QUOTE #", "TO"), the design system's eyebrow style in gray. */
const label = (text: string, after = 20) =>
  new Paragraph({
    spacing: { before: 0, after },
    children: [run(text, { size: S.label, color: C.gray, bold: true, caps: true, spacing: 30 })],
  });

const heading = (text: string) =>
  new Paragraph({
    keepNext: true,
    keepLines: true,
    spacing: { before: 360, after: 140 },
    border: { bottom: hairline(C.tint20, 4) },
    children: [run(text, { font: BRAND.font.display, size: S.heading, color: C.green })],
  });

const body = (text: string, after = 160) =>
  new Paragraph({
    spacing: { before: 0, after, line: 288 },
    children: [run(text, { size: S.body })],
  });

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

function cell(
  children: Paragraph[],
  o: {
    width: number;
    fill?: string;
    borders?: Record<string, IBorderOptions>;
    margins?: number;
  } = {
    width: 0,
  },
) {
  const m = o.margins ?? 100;
  return new TableCell({
    width: { size: o.width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: m, bottom: m, left: 120, right: 120 },
    ...(o.fill ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } } : {}),
    borders: { ...NO_BORDERS, ...(o.borders ?? {}) },
    children,
  });
}

const cellText = (
  text: string,
  o: { align?: Align; bold?: boolean; color?: string; size?: number; keepNext?: boolean } = {},
) =>
  new Paragraph({
    alignment: o.align ?? AlignmentType.LEFT,
    keepNext: o.keepNext ?? false,
    spacing: { before: 0, after: 0 },
    children: [
      run(text, { size: o.size ?? S.table, bold: o.bold ?? false, color: o.color ?? C.black }),
    ],
  });

interface Column {
  header: string;
  width: number;
  align?: Align;
}

/**
 * A data table in the brand: a Pretium Green header row with white bold text (repeated on each page),
 * white / green-5 banding, green-10 hairlines between rows only, numbers right-aligned. Flat: no
 * accent borders (design system 1.5.2).
 */
function dataTable(
  columns: Column[],
  rows: { values: (string | null)[]; bold?: boolean[] }[],
  firstColumnLabel = false,
) {
  const total = columns.reduce((s, c) => s + c.width, 0);
  const scale = CONTENT_WIDTH / total;
  const widths = columns.map((c) => Math.round(c.width * scale));
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: columns.map((c, i) =>
      cell(
        [
          new Paragraph({
            alignment: c.align ?? AlignmentType.LEFT,
            keepNext: true,
            spacing: { before: 0, after: 0 },
            children: [
              run(c.header, {
                size: S.tableHeader,
                color: C.white,
                bold: true,
                caps: true,
                spacing: 10,
              }),
            ],
          }),
        ],
        { width: widths[i]!, fill: C.green, margins: 110 },
      ),
    ),
  });
  const bodyRows = rows.map(
    (r, ri) =>
      new TableRow({
        cantSplit: true,
        children: r.values.map((v, i) =>
          cell(
            [
              cellText(v ?? '', {
                align: columns[i]!.align ?? AlignmentType.LEFT,
                bold: r.bold?.[i] ?? (firstColumnLabel && i === 0),
                color: firstColumnLabel && i === 0 ? C.gray : C.black,
                // Keep a short table on one page (Word moves it whole when it can).
                keepNext: ri < rows.length - 1,
              }),
            ],
            {
              width: widths[i]!,
              ...(ri % 2 === 1 ? { fill: C.tint5 } : {}),
              borders: { bottom: hairline(C.tint10, 4) },
            },
          ),
        ),
      }),
  );
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: { ...NO_TABLE_BORDERS, bottom: hairline(C.green, 6) },
    rows: [header, ...bodyRows],
  });
}

/** The header on every page: the logo left; the DRAFT flag and the letter's reference right. */
function pageHeader(m: OfferLetterModel): Header {
  const logoWidth = Math.round(CONTENT_WIDTH * 0.42);
  const right: Paragraph[] = [];
  if (m.draftText) {
    right.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 0, after: 40 },
        children: [run(m.draftText, { size: S.small, color: C.copper, bold: true })],
      }),
    );
  }
  right.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 0, after: 0 },
      children: [run(`${m.title}  ·  ${m.header.quoteNumber}`, { size: S.small, color: C.gray })],
    }),
  );
  return new Header({
    children: [
      new Table({
        width: { size: CONTENT_WIDTH, type: WidthType.DXA },
        columnWidths: [logoWidth, CONTENT_WIDTH - logoWidth],
        layout: TableLayoutType.FIXED,
        borders: NO_TABLE_BORDERS,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: logoWidth, type: WidthType.DXA },
                verticalAlign: VerticalAlign.BOTTOM,
                margins: { top: 0, bottom: 60, left: 0, right: 0 },
                borders: NO_BORDERS,
                children: [
                  new Paragraph({
                    spacing: { before: 0, after: 0 },
                    children: [
                      new ImageRun({
                        type: 'png',
                        data: brandLogo(),
                        transformation: { width: BRAND.logo.width, height: BRAND.logo.height },
                        altText: {
                          name: 'Pretium',
                          title: 'Pretium',
                          description: 'Pretium logo',
                        },
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: { size: CONTENT_WIDTH - logoWidth, type: WidthType.DXA },
                verticalAlign: VerticalAlign.BOTTOM,
                margins: { top: 0, bottom: 60, left: 0, right: 0 },
                borders: NO_BORDERS,
                children: right,
              }),
            ],
          }),
        ],
      }),
      new Paragraph({
        spacing: { before: 60, after: 0 },
        border: { top: hairline(C.green, 6) },
        children: [],
      }),
    ],
  });
}

/** The footer on every page: the legal entity and address (once Legal gives them), the note, the page. */
function pageFooter(m: OfferLetterModel): Footer {
  const left = [m.footer.legalEntity ?? m.signer.company, m.footer.address]
    .filter((x): x is string => !!x)
    .join('  ·  ');
  const children: ParagraphChild[] = [run(left, { size: S.small, color: C.gray })];
  children.push(run('\t', { size: S.small }));
  if (m.footer.note) {
    children.push(run(m.footer.note, { size: S.small, color: C.gray, caps: true, spacing: 20 }));
  }
  children.push(
    new TextRun({
      children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
      size: S.small,
      color: C.gray,
      font: BRAND.font.body,
    }),
  );
  return new Footer({
    children: [
      new Paragraph({
        border: { top: hairline(C.tint20, 4) },
        spacing: { before: 0, after: 0 },
        tabStops: [
          { type: TabStopType.CENTER, position: Math.round(CONTENT_WIDTH / 2) },
          { type: TabStopType.RIGHT, position: CONTENT_WIDTH },
        ],
        children,
      }),
    ],
  });
}

/** The title block: eyebrow, title and the quote line. */
function titleBlock(m: OfferLetterModel): Paragraph[] {
  const out: Paragraph[] = [];
  if (m.eyebrow) {
    out.push(
      new Paragraph({
        spacing: { before: 120, after: 60 },
        children: [
          run(m.eyebrow, { size: S.eyebrow, color: C.copper, bold: true, caps: true, spacing: 80 }),
        ],
      }),
    );
  }
  out.push(
    new Paragraph({
      spacing: { before: m.eyebrow ? 0 : 120, after: 60, line: 240 },
      children: [run(m.title, { font: BRAND.font.display, size: S.title, color: C.green })],
    }),
    new Paragraph({
      spacing: { before: 0, after: 280 },
      children: [
        run(`Quote ${m.header.quoteNumber}`, { size: S.subtitle, color: C.gray }),
        run('   ·   ', { size: S.subtitle, color: C.copper, bold: true }),
        run(m.header.dateText, { size: S.subtitle, color: C.gray }),
      ],
    }),
  );
  return out;
}

/** The details panel: who it is for (left) and the quote's references (right), on a green-5 fill. */
function detailsPanel(m: OfferLetterModel): Table {
  const half = Math.round(CONTENT_WIDTH * 0.56);
  const value = (text: string, after = 160) =>
    new Paragraph({
      spacing: { before: 0, after },
      children: [run(text, { size: S.detailValue, bold: true })],
    });
  const left: Paragraph[] = [label('To'), value(m.header.to, m.header.attention ? 160 : 0)];
  if (m.header.attention) left.push(label('Attention'), value(m.header.attention, 0));
  const right: Paragraph[] = [label('Quote #'), value(m.header.quoteNumber)];
  right.push(label('Date'), value(m.header.dateText, m.header.validUntilText ? 160 : 0));
  if (m.header.validUntilText) right.push(label('Valid until'), value(m.header.validUntilText, 0));
  const pad = { top: 220, bottom: 220, left: 260, right: 200 };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [half, CONTENT_WIDTH - half],
    layout: TableLayoutType.FIXED,
    borders: NO_TABLE_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: half, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.tint5 },
            margins: pad,
            borders: NO_BORDERS,
            children: left,
          }),
          new TableCell({
            width: { size: CONTENT_WIDTH - half, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.tint5 },
            margins: pad,
            borders: NO_BORDERS,
            children: right,
          }),
        ],
      }),
    ],
  });
}

function itemsTable(m: OfferLetterModel): Table {
  return dataTable(
    [
      { header: 'Item', width: 900 },
      { header: 'Part description', width: 5200 },
      { header: 'Part #', width: 2000 },
    ],
    m.items.map((i) => ({
      values: [String(i.itemNo), i.partDescription, i.partNumber ?? ''],
    })),
  );
}

function pricingTable(m: OfferLetterModel): Table {
  const p = m.pricing;
  const right = AlignmentType.RIGHT;
  const cols: (Column & {
    pick: (r: OfferLetterModel['pricing']['rows'][number]) => string | null;
  })[] = [
    { header: 'Item', width: 700, pick: (r) => String(r.itemNo) },
    { header: 'Place of manufacture', width: 2300, pick: (r) => r.placeOfManufacture },
    { header: 'Est. annual volume', width: 1700, align: right, pick: (r) => r.annualVolumeText },
    {
      header: p.labels.piecePrice,
      width: 1900,
      align: right,
      pick: (r) => r.piecePricePer1000Text,
    },
  ];
  if (p.showMolds) {
    cols.push({ header: p.labels.molds, width: 1500, align: right, pick: (r) => r.moldChargeText });
  }
  if (p.showChangeParts) {
    cols.push({
      header: p.labels.changeParts,
      width: 1500,
      align: right,
      pick: (r) => r.changePartsChargeText,
    });
  }
  return dataTable(
    cols,
    p.rows.map((r) => ({
      values: cols.map((c) => c.pick(r)),
      // The piece price is the figure the customer reads first.
      bold: cols.map((_, i) => i === 3),
    })),
  );
}

function specificationsTable(m: OfferLetterModel): Table | null {
  const s = m.specifications;
  if (!s) return null;
  const itemWidth = Math.max(1400, Math.round(6000 / s.itemNames.length));
  return dataTable(
    [
      { header: 'Specification', width: 2600 },
      ...s.itemNames.map((n) => ({ header: n, width: itemWidth })),
    ],
    s.rows.map((r) => ({ values: [r.label, ...r.values.map((v) => v ?? '')] })),
    true,
  );
}

function assumptionsList(m: OfferLetterModel): Paragraph[] {
  const out: Paragraph[] = [];
  m.assumptions.items.forEach((a, i) => {
    out.push(
      new Paragraph({
        numbering: { reference: BULLETS, level: 0 },
        // Never leave the heading with one line under it at the foot of a page.
        keepNext: i < 2,
        keepLines: true,
        spacing: { before: 0, after: 70, line: 276 },
        children: [run(a.text, { size: S.table + 1 })],
      }),
    );
    for (const p of a.points) {
      out.push(
        new Paragraph({
          numbering: { reference: BULLETS, level: 1 },
          spacing: { before: 0, after: 50, line: 276 },
          children: [run(p, { size: S.table, color: C.gray })],
        }),
      );
    }
  });
  return out;
}

function signOff(m: OfferLetterModel): Paragraph[] {
  const out: Paragraph[] = [];
  if (m.closing)
    out.push(
      new Paragraph({ spacing: { before: 280, after: 0 }, children: [] }),
      body(m.closing, 240),
    );
  out.push(
    new Paragraph({
      keepNext: true,
      spacing: { before: m.closing ? 0 : 280, after: 520 },
      children: [run(m.signOff)],
    }),
  );
  if (m.signer.name) {
    out.push(
      new Paragraph({
        keepNext: true,
        spacing: { before: 0, after: 20 },
        children: [run(m.signer.name, { bold: true, color: C.green, size: S.body + 2 })],
      }),
    );
  }
  out.push(
    new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [run(m.signer.company, { size: S.table, color: C.gray })],
    }),
  );
  return out;
}

const spacer = (after = 0) => new Paragraph({ spacing: { before: 0, after }, children: [] });

/** Render the letter. */
export async function renderOfferLetterDocx(m: OfferLetterModel): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [...titleBlock(m), detailsPanel(m)];
  if (m.introduction) children.push(spacer(220), body(m.introduction, 0));
  children.push(heading(m.itemsHeading), itemsTable(m));
  children.push(heading(m.pricing.heading), pricingTable(m));
  const specs = specificationsTable(m);
  if (specs) children.push(heading(m.specifications!.heading), specs);
  if (m.assumptions.items.length) {
    children.push(heading(m.assumptions.heading), ...assumptionsList(m));
  }
  children.push(...signOff(m));

  const doc = new Document({
    creator: 'QuoteFlow',
    lastModifiedBy: 'QuoteFlow',
    title: `${m.title} ${m.header.quoteNumber}`,
    subject: m.title,
    description: `Generated by QuoteFlow (template ${m.templateVersion}).`,
    styles: {
      default: {
        document: {
          run: { font: BRAND.font.body, size: S.body, color: C.black },
          paragraph: { spacing: { after: 120 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '→',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 340, hanging: 340 } },
                run: { color: C.copper, font: BRAND.font.body, bold: true },
              },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '–',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 700, hanging: 260 } },
                run: { color: C.green, font: BRAND.font.body },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: BRAND.page.width, height: BRAND.page.height },
            margin: {
              top: BRAND.page.marginTop,
              bottom: BRAND.page.marginBottom,
              left: BRAND.page.marginX,
              right: BRAND.page.marginX,
              header: BRAND.page.header,
              footer: BRAND.page.footer,
            },
          },
        },
        headers: { default: pageHeader(m) },
        footers: { default: pageFooter(m) },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
