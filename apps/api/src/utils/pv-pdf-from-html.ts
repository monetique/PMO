/**
 * Génération PDF pour un PV rédigé en HTML.
 * Par défaut : Chromium (Puppeteer) pour un rendu proche du navigateur (tableaux, listes, styles).
 * Repli : PDFKit (texte) si PV_PDF_ENGINE=pdfkit ou si Chromium échoue.
 */
import PDFDocument from 'pdfkit';
import type { PvPdfMeta } from './pv-pdf-meta';
import { PV_PDF_MAX_HTML_CHARS } from './pv-pdf-meta';
import { generatePvPdfBufferChromium, isChromiumPdfDisabled } from './pv-pdf-html-chromium';

export type { PvPdfMeta } from './pv-pdf-meta';

function stripHtmlToText(html: string): string {
  const s = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return s;
}

function stripInnerTagsToText(s: string): string {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!w) continue;
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function extractH2Sections(html: string): { heading: string; contentHtml: string }[] {
  const clean = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  const matches = [...clean.matchAll(re)] as RegExpMatchArray[];
  if (!matches.length) {
    return [{ heading: '', contentHtml: clean }];
  }
  const out: { heading: string; contentHtml: string }[] = [];
  for (let i = 0; i < matches.length; i++) {
    const heading = stripInnerTagsToText(matches[i][1]);
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? clean.length) : clean.length;
    out.push({ heading, contentHtml: clean.slice(start, end) });
  }
  return out;
}

function normalizeHeadingKey(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldSkipSectionHeading(heading: string, metaRattachementsPrinted: boolean): boolean {
  const k = normalizeHeadingKey(heading);
  if (/^(\d+\.?\s*)?informations generales/.test(k)) return true;
  if (/^(\d+\.?\s*)?participants$/.test(k)) return true;
  if (metaRattachementsPrinted && /rattachements/.test(k)) return true;
  return false;
}

function stripHeadingNumberPrefix(heading: string): string {
  return String(heading || '').replace(/^\s*\d+\.\s*/, '').trim();
}

function isPlaceholderOrEmptyBody(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (/^à compléter[.…\s]*$/i.test(t)) return true;
  if (/^—$/.test(t)) return true;
  return false;
}

function generatePvPdfBufferPdfKit(meta: PvPdfMeta): Promise<Buffer> {
  const html = meta.bodyHtml || '';
  const hasRattachementsMeta = !!(
    meta.liensProjets?.trim() ||
    meta.liensTaches?.trim() ||
    meta.liensUserStories?.trim() ||
    meta.liensEpics?.trim()
  );

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const margin = 48;
    const contentWidth = pageWidth - margin * 2;
    const footerY = doc.page.height - 40;
    const rowH = 22;
    const labelColW = contentWidth * 0.28;
    const valueColW = contentWidth - labelColW;
    const maxChars = 88;
    const lineHeight = 12;

    const drawFooter = (pageIndex: number, totalPages: number) => {
      const footerTop = meta.companyAddress?.trim()
        ? `${meta.companyAddress.trim()}`
        : '';
      if (footerTop) {
        doc
          .fontSize(8)
          .fillColor('#6b7280')
          .font('Helvetica')
          .text(footerTop, margin, footerY - 10, { width: contentWidth, align: 'center' });
      }
      doc
        .fontSize(8)
        .fillColor('#666666')
        .font('Helvetica')
        .text(
          `Généré le ${meta.generatedAt.toLocaleString('fr-FR')} — page ${pageIndex}/${totalPages}`,
          margin,
          footerY + 2,
          { width: contentWidth, align: 'center' }
        );
    };

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > footerY - 16) doc.addPage();
    };

    const moveDownGap = (u = 0.35) => doc.moveDown(u);

    doc.y = margin;
    if (meta.companyName?.trim() || meta.companyFormat?.trim() || meta.companySize?.trim()) {
      const head = [meta.companyName, meta.companyFormat, meta.companySize]
        .filter((x) => String(x || '').trim())
        .join(' • ');
      doc.font('Helvetica').fontSize(8.5).fillColor('#4b5563').text(head, margin, doc.y, {
        width: contentWidth,
        align: 'right',
      });
      moveDownGap(0.2);
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#111827')
      .text('PROCÈS-VERBAL DE RÉUNION', margin, doc.y, { width: contentWidth, align: 'center' });
    moveDownGap(1);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Informations générales', margin, doc.y, {
      width: contentWidth,
    });
    moveDownGap(0.35);

    const infoRows: [string, string][] = [
      ['Titre', meta.titre],
      ['Date', meta.dateReunionLabel],
      ['Statut', meta.statutLabel],
    ];
    for (const [label, value] of infoRows) {
      ensureSpace(rowH + 6);
      const y = doc.y;
      doc.fillColor('#e5e7eb').rect(margin, y, labelColW, rowH).fill();
      doc.fillColor('#111827');
      doc.font('Helvetica-Bold').fontSize(9).text(label, margin + 6, y + 6, { width: labelColW - 12 });
      doc.font('Helvetica').fontSize(9).text(value || '—', margin + labelColW + 6, y + 6, { width: valueColW - 12 });
      doc.y = y + rowH;
    }
    moveDownGap(0.75);

    doc.font('Helvetica-Bold').fontSize(11).text('Participants', margin, doc.y, { width: contentWidth });
    moveDownGap(0.25);
    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    let n = 1;
    const allParticipants = [...meta.participantUserLines, ...meta.participantClientLines].filter((s) =>
      String(s || '').trim()
    );
    if (!allParticipants.length) {
      ensureSpace(lineHeight + 4);
      doc.text('—', { width: contentWidth });
    } else {
      for (const line of allParticipants) {
        ensureSpace(lineHeight + 4);
        doc.text(`${n}. ${line}`, { width: contentWidth, lineGap: 2 });
        n += 1;
      }
    }
    moveDownGap(0.65);

    if (hasRattachementsMeta) {
      doc.font('Helvetica-Bold').fontSize(11).text('Rattachements', margin, doc.y, { width: contentWidth });
      moveDownGap(0.25);
      doc.font('Helvetica').fontSize(9).fillColor('#374151');
      if (meta.liensProjets?.trim()) {
        ensureSpace(lineHeight + 4);
        doc.text(`Projets : ${meta.liensProjets}`, { width: contentWidth });
      }
      if (meta.liensTaches?.trim()) {
        ensureSpace(lineHeight + 4);
        doc.text(`Tâches : ${meta.liensTaches}`, { width: contentWidth });
      }
      if (meta.liensUserStories?.trim()) {
        ensureSpace(lineHeight + 4);
        doc.text(`User stories : ${meta.liensUserStories}`, { width: contentWidth });
      }
      if (meta.liensEpics?.trim()) {
        ensureSpace(lineHeight + 4);
        doc.text(`Epics : ${meta.liensEpics}`, { width: contentWidth });
      }
      moveDownGap(0.65);
    }

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Détail du Procès Verbal', margin, doc.y, {
      width: contentWidth,
    });
    moveDownGap(0.35);

    const sections = extractH2Sections(html);
    for (const sec of sections) {
      if (sec.heading && shouldSkipSectionHeading(sec.heading, hasRattachementsMeta)) {
        continue;
      }
      const bodyText = stripHtmlToText(sec.contentHtml);
      if (!sec.heading && !bodyText) continue;
      if (sec.heading && isPlaceholderOrEmptyBody(bodyText)) {
        continue;
      }
      if (!sec.heading && isPlaceholderOrEmptyBody(bodyText)) {
        continue;
      }
      if (sec.heading) {
        const cleanHeading = stripHeadingNumberPrefix(sec.heading);
        if (!cleanHeading) continue;
        ensureSpace(16);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#111827').text(cleanHeading, {
          width: contentWidth,
          lineGap: 2,
        });
        moveDownGap(0.15);
      }
      if (bodyText) {
        doc.font('Helvetica').fontSize(9.5).fillColor('#1f2937');
        const lines = wrapLines(bodyText, maxChars);
        for (const line of lines) {
          ensureSpace(lineHeight + 4);
          doc.text(line, { width: contentWidth, lineGap: 2 });
        }
        moveDownGap(0.35);
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      drawFooter(i + 1, range.count);
    }

    doc.end();
  });
}

export async function generatePvPdfBuffer(meta: PvPdfMeta): Promise<Buffer> {
  const html = meta.bodyHtml || '';
  if (html.length > PV_PDF_MAX_HTML_CHARS) {
    throw new Error('Contenu HTML trop volumineux');
  }

  if (!isChromiumPdfDisabled()) {
    try {
      return await generatePvPdfBufferChromium(meta);
    } catch (e) {
      console.warn('[pv-pdf] Chromium/Puppeteer indisponible ou erreur, repli PDFKit:', e);
    }
  }

  return generatePvPdfBufferPdfKit(meta);
}
