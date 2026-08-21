import "server-only";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { groupIncludedItems } from "@/components/estimate-document";
import { fillContract, lateContractValues, parseContract } from "@/lib/contracts/merge";
import {
  isPricelessKind,
  moneyCents,
  paymentPercentOfTotal,
  quantityIsMeaningful,
  signatureProgress,
  type Estimate,
  type EstimateGroup,
  type EstimateItem,
  type EstimatePayment,
  type EstimateSigner,
} from "@/lib/data/types";

/**
 * The estimate/contract document as a PDF, for the Drive backup.
 *
 * Renders the same sections in the same order and under the same
 * conditions as EstimateDocument -- change orders and completion
 * certificates keep their banners, priceless documents hide their
 * empty money tables, terms are re-merged with the same fillContract
 * the web document uses, and drawn signatures embed as images. It
 * will never be pixel-identical to the web page; what it must be is
 * substantively identical, because the copy in Drive is the copy
 * somebody reaches for when the app is not in front of them.
 */

export type DocumentPdfBundle = {
  estimate: Estimate;
  items: EstimateItem[];
  signers: EstimateSigner[];
  payments: EstimatePayment[];
  sections: EstimateGroup[];
  company: {
    name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    logo_url: string | null;
    license_number: string | null;
    license_state: string | null;
    license_type: string | null;
  } | null;
  customer: {
    first_name: string | null;
    last_name: string | null;
    company_name?: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  parent: { doc_number: string; total_cents: number; signed_at: string | null } | null;
};

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.44, 0.48);
const LINE = rgb(0.85, 0.85, 0.85);
const DANGER = rgb(0.72, 0.15, 0.15);

function longDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + "T00:00:00" : value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** ASCII-safe for WinAnsi standard fonts: smart punctuation folded down. */
function safe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/•/g, "-")
    .replace(/·/g, "-")
    .replace(/[^\x00-\xFF]/g, "");
}

class Writer {
  doc!: PDFDocument;
  page!: PDFPage;
  y = 0;
  font!: PDFFont;
  bold!: PDFFont;
  oblique!: PDFFont;

  static async create(): Promise<Writer> {
    const w = new Writer();
    w.doc = await PDFDocument.create();
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.oblique = await w.doc.embedFont(StandardFonts.HelveticaOblique);
    w.addPage();
    return w;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN) this.addPage();
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = safe(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        // A single word wider than the column is hard-broken.
        if (font.widthOfTextAtSize(word, size) > width) {
          let piece = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(piece + ch, size) > width) {
              lines.push(piece);
              piece = ch;
            } else piece += ch;
          }
          line = piece;
        } else {
          line = word;
        }
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  }

  text(
    text: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      x?: number;
      width?: number;
      gapAfter?: number;
      lineGap?: number;
    } = {}
  ) {
    const font = opts.font ?? this.font;
    const size = opts.size ?? 10;
    const width = opts.width ?? CONTENT_W - ((opts.x ?? MARGIN) - MARGIN);
    const lines = this.wrap(text, font, size, width);
    for (const line of lines) {
      this.ensure(size + 4);
      this.page.drawText(line, {
        x: opts.x ?? MARGIN,
        y: this.y - size,
        size,
        font,
        color: opts.color ?? INK,
      });
      this.y -= size + (opts.lineGap ?? 3);
    }
    this.y -= opts.gapAfter ?? 0;
  }

  /** One row: left text (wrapped) and a right-aligned figure on the first line. */
  row(left: string, right: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) {
    const font = opts.font ?? this.font;
    const size = opts.size ?? 10;
    this.ensure(size + 6);
    const startY = this.y;
    this.text(left, { font, size, color: opts.color, width: CONTENT_W - 120 });
    const rightWidth = font.widthOfTextAtSize(safe(right), size);
    this.page.drawText(safe(right), {
      x: PAGE_W - MARGIN - rightWidth,
      y: startY - size,
      size,
      font,
      color: opts.color ?? INK,
    });
  }

  rule(gap = 10) {
    this.ensure(gap + 2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 4 },
      end: { x: PAGE_W - MARGIN, y: this.y - 4 },
      thickness: 0.7,
      color: LINE,
    });
    this.y -= gap;
  }

  heading(text: string) {
    this.ensure(30);
    this.y -= 8;
    this.text(text, { font: this.bold, size: 12, gapAfter: 4 });
  }
}

async function embedRemoteImage(doc: PDFDocument, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Sniff: PNG signature, else try JPEG.
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
    return await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

async function embedDataUrlPng(doc: PDFDocument, dataUrl: string) {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const bytes = Uint8Array.from(Buffer.from(dataUrl.slice(comma + 1), "base64"));
    if (dataUrl.includes("image/png")) return await doc.embedPng(bytes);
    return await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

export async function renderDocumentPdf(bundle: DocumentPdfBundle): Promise<Uint8Array> {
  const { estimate, items, signers, payments, sections, company, customer, parent } = bundle;
  const w = await Writer.create();

  const isChangeOrder = estimate.kind === "change_order";
  const priceless = isPricelessKind(estimate.kind);

  // 1. Company header
  if (company?.logo_url) {
    const img = await embedRemoteImage(w.doc, company.logo_url);
    if (img) {
      const h = 36;
      const scale = h / img.height;
      w.page.drawImage(img, { x: MARGIN, y: w.y - h, width: img.width * scale, height: h });
      w.y -= h + 8;
    }
  }
  const metaTop = w.y;
  w.text(company?.name || "Estimate", { font: w.bold, size: 16 });
  if (company?.address) w.text(company.address, { size: 9, color: MUTED });
  const contact = [company?.phone, company?.email, company?.website].filter(Boolean).join(" - ");
  if (contact) w.text(contact, { size: 9, color: MUTED });
  const licence = [company?.license_type, company?.license_number].filter(Boolean).join(" ");
  if (licence) {
    w.text(
      `Lic. ${licence}${company?.license_state ? ` (${company.license_state})` : ""}`,
      { size: 9, color: MUTED }
    );
  }

  // Right-side meta, aligned to the top of the header block
  const metaLines: { text: string; bold?: boolean; danger?: boolean }[] = [];
  if (isChangeOrder) metaLines.push({ text: "CHANGE ORDER", bold: true });
  if (priceless) metaLines.push({ text: "CERTIFICATE OF COMPLETION", bold: true });
  metaLines.push({ text: estimate.doc_number, bold: true });
  metaLines.push({ text: `Issued ${longDate(estimate.issued_at ?? estimate.created_at)}` });
  if ((isChangeOrder || priceless) && parent) {
    metaLines.push({
      text: `To contract ${parent.doc_number}${parent.signed_at ? `, signed ${longDate(parent.signed_at)}` : ""}`,
    });
  }
  if (estimate.expires_at && estimate.status !== "Signed") {
    metaLines.push({ text: `Valid until ${longDate(estimate.expires_at)}` });
  }
  let metaY = metaTop;
  for (const line of metaLines) {
    const font = line.bold ? w.bold : w.font;
    const size = line.bold ? 11 : 9;
    const width = font.widthOfTextAtSize(safe(line.text), size);
    w.page.drawText(safe(line.text), {
      x: PAGE_W - MARGIN - width,
      y: metaY - size,
      size,
      font,
      color: line.bold ? INK : MUTED,
    });
    metaY -= size + 4;
  }
  w.y = Math.min(w.y, metaY);
  w.rule(14);

  // 2. Void banner
  if (estimate.status === "Void") {
    w.text(
      `This document has been cancelled${estimate.voided_at ? ` on ${longDate(estimate.voided_at)}` : ""}. It is no longer an offer and nothing on it is owed.`,
      { font: w.bold, size: 10, color: DANGER, gapAfter: 8 }
    );
  }

  // 3. Parties
  const customerName =
    customer?.company_name ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    "Customer";
  w.text("PREPARED FOR", { size: 8, color: MUTED });
  w.text(customerName, { font: w.bold, size: 11 });
  if (customer?.address) w.text(customer.address, { size: 9, color: MUTED });
  const custContact = [customer?.phone, customer?.email].filter(Boolean).join(" - ");
  if (custContact) w.text(custContact, { size: 9, color: MUTED });
  w.y -= 6;
  w.text("PROJECT", { size: 8, color: MUTED });
  w.text(estimate.title || "Estimate", { font: w.bold, size: 11, gapAfter: 6 });

  // 4. Customer message
  if (estimate.customer_message) {
    w.text(estimate.customer_message, { size: 9.5, color: MUTED, gapAfter: 6 });
  }

  // 5. Line items
  if (!priceless) {
    w.heading("Scope of work");
    const groups = groupIncludedItems(items);
    const showMeasures = groups.some((g) => quantityIsMeaningful(g.parent.quantity, g.parent.unit));
    const groupById = new Map(sections.map((s) => [s.id, s]));
    let lastSection: string | null = "__start__";
    if (groups.length === 0) {
      w.text("No line items yet.", { size: 9.5, color: MUTED, gapAfter: 6 });
    }
    for (const g of groups) {
      const sectionId = g.parent.group_id ?? null;
      if (sectionId !== lastSection) {
        const section = sectionId ? groupById.get(sectionId) : null;
        if (section) {
          w.ensure(24);
          w.y -= 4;
          w.text(section.name, { font: w.bold, size: 10.5 });
          if (section.description) w.text(section.description, { size: 9, color: MUTED });
        }
        lastSection = sectionId;
      }
      const measured = quantityIsMeaningful(g.parent.quantity, g.parent.unit);
      const qtyLabel =
        showMeasures && measured
          ? `  (${g.parent.quantity} ${g.parent.unit ?? ""} @ ${moneyCents(g.parent.unit_price_cents)})`
          : "";
      w.row(
        g.parent.name + qtyLabel,
        g.parent.line_total_cents ? moneyCents(g.parent.line_total_cents) : "",
        { font: w.bold, size: 10 }
      );
      if (g.parent.description) {
        w.text(g.parent.description, { size: 9, color: MUTED, x: MARGIN + 10, width: CONTENT_W - 120 });
      }
      for (const inc of g.included) {
        w.text(
          `Includes: ${inc.name}${inc.description ? ` - ${inc.description}` : ""}`,
          { size: 9, color: MUTED, x: MARGIN + 10, width: CONTENT_W - 120 }
        );
      }
      w.y -= 3;
    }
    w.rule(10);

    // 7. Totals
    w.row("Subtotal", moneyCents(estimate.subtotal_cents), { size: 10 });
    if (estimate.tax_cents > 0) w.row("Sales tax", moneyCents(estimate.tax_cents), { size: 10 });
    w.row(isChangeOrder ? "This change order" : "Total", moneyCents(estimate.total_cents), {
      font: w.bold,
      size: 12,
    });
  }
  if ((isChangeOrder || priceless) && parent) {
    w.row(`Original contract ${parent.doc_number}`, moneyCents(parent.total_cents), { size: 10 });
    w.row("Revised contract total", moneyCents(parent.total_cents + estimate.total_cents), {
      font: w.bold,
      size: 10,
    });
  }

  // 8. Payment schedule
  if (!isChangeOrder && (estimate.deposit_cents || payments.length > 0)) {
    w.heading("Payment schedule");
    if (estimate.deposit_cents) {
      w.row(
        `Deposit - due upon contract signing (${paymentPercentOfTotal(estimate.deposit_cents, estimate.total_cents)})`,
        moneyCents(estimate.deposit_cents),
        { size: 10 }
      );
    }
    for (const p of payments) {
      w.row(
        `${p.name}${p.description ? ` - ${p.description}` : ""} (${paymentPercentOfTotal(p.amount_cents, estimate.total_cents)})`,
        moneyCents(p.amount_cents),
        { size: 10 }
      );
    }
  }

  // 9. Terms
  if (estimate.terms) {
    w.heading("Terms");
    const blocks = parseContract(fillContract(estimate.terms, lateContractValues(estimate)));
    for (const block of blocks) {
      if (block.kind === "heading") {
        w.ensure(22);
        w.y -= 3;
        w.text(block.text ?? "", { font: w.bold, size: 9.5 });
      } else if (block.kind === "bullet") {
        for (const item of block.items ?? []) {
          w.text(`- ${item}`, { size: 8.5, x: MARGIN + 8, lineGap: 2 });
        }
        w.y -= 2;
      } else {
        w.text(block.text ?? "", { size: 8.5, lineGap: 2, gapAfter: 3 });
      }
    }
  }

  // 10. Completion punch lists
  if (priceless) {
    const punch = (raw: string | null | undefined) =>
      (raw ?? "")
        .split("\n")
        .map((line) => line.replace(/^[-•*]\s*/, "").trim())
        .filter(Boolean);
    w.heading("Outstanding items");
    const contractor = punch(estimate.completion_notes);
    if (contractor.length) for (const item of contractor) w.text(`- ${item}`, { size: 9.5 });
    else w.text("None recorded by the contractor.", { size: 9.5, color: MUTED });
    w.heading("Raised by the owner on signing");
    const owner = punch(estimate.completion_customer_items);
    if (owner.length) for (const item of owner) w.text(`- ${item}`, { size: 9.5 });
    else
      w.text(
        estimate.status === "Signed"
          ? "None. The Owner accepted the work without raising any items."
          : "To be completed by the Owner when signing.",
        { size: 9.5, color: MUTED }
      );
  }

  // 11. Signatures
  if (signers.length > 0) {
    const sig = signatureProgress(signers);
    w.heading(`Signatures (${sig.signed} of ${sig.total})`);
    for (const s of signers) {
      w.ensure(64);
      if (s.signature_image) {
        const img = await embedDataUrlPng(w.doc, s.signature_image);
        if (img) {
          const h = 34;
          const scale = h / img.height;
          w.page.drawImage(img, { x: MARGIN, y: w.y - h, width: img.width * scale, height: h });
          w.y -= h + 4;
        } else if (s.signature_name) {
          w.text(s.signature_name, { font: w.oblique, size: 13 });
        }
      } else if (s.signature_name) {
        w.text(s.signature_name, { font: w.oblique, size: 13 });
      } else {
        w.text("Awaiting signature", { size: 10, color: MUTED });
      }
      w.page.drawLine({
        start: { x: MARGIN, y: w.y - 2 },
        end: { x: MARGIN + 220, y: w.y - 2 },
        thickness: 0.7,
        color: LINE,
      });
      w.y -= 8;
      w.text(
        `${s.name} - ${s.party === "company" ? "Contractor" : "Customer"}${
          s.signed_at ? ` - signed ${new Date(s.signed_at).toLocaleDateString("en-US")}` : ""
        }`,
        { size: 9, color: MUTED, gapAfter: 8 }
      );
    }
  }

  return w.doc.save();
}
