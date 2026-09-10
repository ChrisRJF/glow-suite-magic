// Klantdossier P2a — server-side PDF generation.
//
// Deliberately small: a linear block builder on top of pdf-lib. No HTML, no
// headless browser, no template engine. Every document is rendered from an
// immutable snapshot that is passed in by the caller.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const LINE = 14;

const BRAND = rgb(0.482, 0.38, 1); // #7B61FF
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.45, 0.45, 0.5);
const HAIRLINE = rgb(0.87, 0.87, 0.9);

/**
 * pdf-lib's standard fonts use WinAnsi. Anything outside it (emoji, CJK) would
 * throw at draw time, so it is replaced instead of crashing the export.
 */
export function pdfSafe(input: unknown): string {
  const s = String(input ?? "");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code === 10 || code === 13 || code === 9) out += " ";
    else if (code < 32) continue;
    else if (code <= 255) out += ch;
    else if ("\u2018\u2019\u201A".includes(ch)) out += "'";
    else if ("\u201C\u201D\u201E".includes(ch)) out += '"';
    else if ("\u2013\u2014".includes(ch)) out += "-";
    else if (ch === "\u20AC") out += "\u20AC";
    else if (ch === "\u2026") out += "...";
    else out += "?";
  }
  return out;
}

export type Block =
  | { t: "title"; text: string }
  | { t: "subtitle"; text: string }
  | { t: "heading"; text: string }
  | { t: "kv"; label: string; value: string }
  | { t: "text"; text: string }
  | { t: "muted"; text: string }
  | { t: "rule" }
  | { t: "space"; size?: number }
  | { t: "image"; bytes: Uint8Array; mime: string; caption?: string };

export interface PdfMeta {
  salonName: string;
  documentRef: string;
  footerNote?: string;
}

class Writer {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private y = 0;
  private regular!: PDFFont;
  private bold!: PDFFont;
  private pageCount = 0;

  constructor(private meta: PdfMeta) {}

  async init() {
    this.doc = await PDFDocument.create();
    this.doc.setTitle(pdfSafe(this.meta.documentRef));
    this.doc.setProducer("GlowSuite");
    this.regular = await this.doc.embedFont(StandardFonts.Helvetica);
    this.bold = await this.doc.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
  }

  private newPage() {
    this.page = this.doc.addPage(A4);
    this.pageCount += 1;
    this.y = A4[1] - MARGIN;
    // Header band
    this.page.drawText(pdfSafe(this.meta.salonName), {
      x: MARGIN, y: A4[1] - 32, size: 9, font: this.bold, color: BRAND,
    });
    this.page.drawText(pdfSafe(this.meta.documentRef), {
      x: A4[0] - MARGIN - this.regular.widthOfTextAtSize(pdfSafe(this.meta.documentRef), 8),
      y: A4[1] - 32, size: 8, font: this.regular, color: MUTED,
    });
    this.y = A4[1] - 56;
  }

  private ensure(needed: number) {
    if (this.y - needed < MARGIN + 30) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = pdfSafe(text).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let current = "";
    for (const w of words) {
      const candidate = current ? `${current} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > width && current) {
        lines.push(current);
        current = w;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  private paragraph(text: string, font: PDFFont, size: number, color = INK, indent = 0) {
    const width = A4[0] - MARGIN * 2 - indent;
    for (const line of this.wrap(text, font, size, width)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color });
      this.y -= size + 4;
    }
  }

  async write(block: Block) {
    switch (block.t) {
      case "title":
        this.ensure(30);
        this.paragraph(block.text, this.bold, 17);
        this.y -= 4;
        break;
      case "subtitle":
        this.paragraph(block.text, this.regular, 10, MUTED);
        this.y -= 6;
        break;
      case "heading":
        this.ensure(26);
        this.y -= 8;
        this.paragraph(block.text, this.bold, 11.5, BRAND);
        this.y -= 2;
        break;
      case "kv": {
        this.ensure(LINE);
        const label = pdfSafe(block.label);
        this.page.drawText(label, { x: MARGIN, y: this.y, size: 9.5, font: this.bold, color: MUTED });
        const labelWidth = 150;
        const lines = this.wrap(block.value, this.regular, 9.5, A4[0] - MARGIN * 2 - labelWidth);
        let first = true;
        for (const line of lines) {
          if (!first) this.ensure(LINE);
          this.page.drawText(line, { x: MARGIN + labelWidth, y: this.y, size: 9.5, font: this.regular, color: INK });
          this.y -= 13;
          first = false;
        }
        break;
      }
      case "text":
        this.paragraph(block.text, this.regular, 10);
        break;
      case "muted":
        this.paragraph(block.text, this.regular, 8.5, MUTED);
        break;
      case "rule":
        this.ensure(12);
        this.y -= 4;
        this.page.drawLine({
          start: { x: MARGIN, y: this.y }, end: { x: A4[0] - MARGIN, y: this.y },
          thickness: 0.6, color: HAIRLINE,
        });
        this.y -= 10;
        break;
      case "space":
        this.y -= block.size ?? 8;
        break;
      case "image": {
        const img = block.mime === "image/png"
          ? await this.doc.embedPng(block.bytes)
          : await this.doc.embedJpg(block.bytes);
        const maxW = A4[0] - MARGIN * 2;
        const maxH = 260;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        this.ensure(h + 18);
        this.page.drawImage(img, { x: MARGIN, y: this.y - h, width: w, height: h });
        this.y -= h + 6;
        if (block.caption) this.paragraph(block.caption, this.regular, 8.5, MUTED);
        this.y -= 6;
        break;
      }
    }
  }

  finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = pdfSafe(`${this.meta.footerNote ? this.meta.footerNote + "  ·  " : ""}Pagina ${i + 1} van ${pages.length}`);
      p.drawText(label, { x: MARGIN, y: 26, size: 7.5, font: this.regular, color: MUTED });
      p.drawText("GlowSuite", {
        x: A4[0] - MARGIN - this.regular.widthOfTextAtSize("GlowSuite", 7.5),
        y: 26, size: 7.5, font: this.regular, color: MUTED,
      });
    });
    return this.doc.save();
  }
}

export async function renderPdf(meta: PdfMeta, blocks: Block[]): Promise<Uint8Array> {
  const writer = new Writer(meta);
  await writer.init();
  for (const block of blocks) await writer.write(block);
  return await writer.finish();
}

/** Compact human readable reference. Not a legal claim, only for support/audit. */
export function documentRef(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `GS-DOC-${out}${alphabet[Math.floor(Math.random() * alphabet.length)]}${alphabet[Math.floor(Math.random() * alphabet.length)]}${alphabet[Math.floor(Math.random() * alphabet.length)]}`;
}

export function nlDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" });
}

export function nlDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" })} om ${d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Amsterdam" })}`;
}

export function displayValue(value: unknown): string {
  if (value === true) return "Ja";
  if (value === false) return "Nee";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}
