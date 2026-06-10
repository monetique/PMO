/**
 * Rendu HTML → PDF via Chromium (Puppeteer) : tableaux, listes, styles proches du navigateur.
 * Repli possible sur l’implémentation PDFKit dans pv-pdf-from-html.ts.
 */
import type { PvPdfMeta } from './pv-pdf-meta';
import { PV_PDF_MAX_HTML_CHARS } from './pv-pdf-meta';
import puppeteer from 'puppeteer';

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtmlToText(html: string): string {
  const s = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function stripInnerTagsToText(s: string): string {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function sanitizeUserHtmlFragment(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
}

function buildPrintableHtml(meta: PvPdfMeta): string {
  const hasRattachementsMeta = !!(
    meta.liensProjets?.trim() ||
    meta.liensTaches?.trim() ||
    meta.liensUserStories?.trim() ||
    meta.liensEpics?.trim()
  );

  const allParticipants = [...meta.participantUserLines, ...meta.participantClientLines].filter((s) =>
    String(s || '').trim()
  );
  let participantsOl = '';
  if (!allParticipants.length) {
    participantsOl = '<li>—</li>';
  } else {
    participantsOl = allParticipants.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  }

  let rattHtml = '';
  if (hasRattachementsMeta) {
    const lines: string[] = [];
    if (meta.liensProjets?.trim()) lines.push(`<p><strong>Projets :</strong> ${escapeHtml(meta.liensProjets)}</p>`);
    if (meta.liensTaches?.trim()) lines.push(`<p><strong>Tâches :</strong> ${escapeHtml(meta.liensTaches)}</p>`);
    if (meta.liensUserStories?.trim())
      lines.push(`<p><strong>User stories :</strong> ${escapeHtml(meta.liensUserStories)}</p>`);
    if (meta.liensEpics?.trim()) lines.push(`<p><strong>Epics :</strong> ${escapeHtml(meta.liensEpics)}</p>`);
    rattHtml = `<h2>Rattachements</h2><div class="racc">${lines.join('')}</div>`;
  }

  const sections = extractH2Sections(meta.bodyHtml || '');
  const bodyParts: string[] = [];
  for (const sec of sections) {
    if (sec.heading && shouldSkipSectionHeading(sec.heading, hasRattachementsMeta)) continue;
    const plain = stripHtmlToText(sec.contentHtml);
    if (sec.heading && isPlaceholderOrEmptyBody(plain)) continue;
    if (!sec.heading && isPlaceholderOrEmptyBody(plain)) continue;
    const cleanHeading = stripHeadingNumberPrefix(sec.heading);
    const h = cleanHeading ? `<h2>${escapeHtml(cleanHeading)}</h2>` : '';
    bodyParts.push(`<section class="pv-sec">${h}<div class="sec-body">${sanitizeUserHtmlFragment(sec.contentHtml)}</div></section>`);
  }
  const bodyJoined = bodyParts.join('\n');

  const footerText = `Généré le ${meta.generatedAt.toLocaleString('fr-FR')}`;
  const hasLogo = !!meta.companyLogoDataUrl;
  const hasAddress = !!meta.companyAddress?.trim();
  const companyTopLine = [meta.companyName, meta.companyFormat, meta.companySize].filter((x) => String(x || '').trim()).join(' • ');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(meta.titre)}</title>
  <style>
    @page { size: A4; margin: 18mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.45;
      color: #111827;
      margin: 0;
      padding-top: ${hasLogo ? '48px' : '0'};
      padding-bottom: ${hasAddress ? '26px' : '0'};
    }
    .company-header {
      position: fixed;
      top: -2mm;
      left: 0;
      right: 0;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
      z-index: 10;
      background: white;
    }
    .company-header img {
      max-height: 34px;
      width: auto;
      object-fit: contain;
      display: block;
    }
    .company-meta {
      font-size: 8pt;
      color: #4b5563;
      text-align: right;
      margin-left: 10px;
    }
    .company-footer {
      position: fixed;
      bottom: -4mm;
      left: 0;
      right: 0;
      border-top: 1px solid #e5e7eb;
      padding-top: 5px;
      text-align: center;
      font-size: 8pt;
      color: #6b7280;
      background: white;
      z-index: 10;
    }
    h1.pv-main-title {
      text-align: center;
      font-size: 15pt;
      font-weight: 700;
      margin: 0 0 0.75em;
      letter-spacing: 0.02em;
    }
    h2.block-title { font-size: 11.5pt; margin: 0.9em 0 0.35em; font-weight: 700; }
    table.meta { width: 100%; border-collapse: collapse; margin-bottom: 1em; }
    table.meta td { border: 1px solid #c5cad3; padding: 7px 9px; vertical-align: top; }
    table.meta td.lab { background: #e8eaed; font-weight: 600; width: 28%; }
    .participants ol { margin: 0.25em 0 0.75em; padding-left: 1.35em; }
    .participants li { margin: 0.15em 0; }
    .racc p { margin: 0.2em 0; font-size: 9.5pt; color: #374151; }
    h2.contenu-title { font-size: 11.5pt; margin-top: 0.8em; }
    .pv-sec { margin-bottom: 0.45em; page-break-inside: avoid; }
    .pv-sec h2 { font-size: 1.05rem; margin: 0.65rem 0 0.3rem; font-weight: 700; }
    .sec-body :where(p, ul, ol) { margin: 0.35em 0; }
    .sec-body h3 { font-size: 0.95rem; margin: 0.5rem 0 0.25rem; font-weight: 600; }
    .sec-body table { border-collapse: collapse; width: 100%; margin: 0.4rem 0; font-size: 12px; }
    .sec-body th, .sec-body td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: top; }
    .sec-body th { background: #f3f4f6; font-weight: 600; }
    .sec-body ul, .sec-body ol { padding-left: 1.25em; }
  </style>
</head>
<body>
  ${hasLogo ? `<div class="company-header"><img src="${meta.companyLogoDataUrl}" alt="Logo entreprise" />${companyTopLine ? `<div class="company-meta">${escapeHtml(companyTopLine)}</div>` : ''}</div>` : ''}
  ${hasAddress ? `<div class="company-footer">${escapeHtml(meta.companyAddress || '')}</div>` : ''}
  <h1 class="pv-main-title">PROCÈS-VERBAL DE RÉUNION</h1>
  <h2 class="block-title">Informations générales</h2>
  <table class="meta" role="presentation">
    <tr><td class="lab">Titre</td><td>${escapeHtml(meta.titre)}</td></tr>
    <tr><td class="lab">Date</td><td>${escapeHtml(meta.dateReunionLabel)}</td></tr>
    <tr><td class="lab">Statut</td><td>${escapeHtml(meta.statutLabel)}</td></tr>
  </table>
  <h2 class="block-title">Participants</h2>
  <div class="participants"><ol>${participantsOl}</ol></div>
  ${rattHtml}
  <h2 class="block-title contenu-title">Détail du Procès Verbal</h2>
  ${bodyJoined}
  <div style="position:fixed;bottom:${hasAddress ? '4mm' : '0'};left:0;right:0;font-size:8pt;color:#6b7280;text-align:center;background:white;">${escapeHtml(footerText)}</div>
</body>
</html>`;
}

let browserLaunchPromise: Promise<import('puppeteer').Browser> | null = null;

async function getSharedBrowser(): Promise<import('puppeteer').Browser> {
  if (!browserLaunchPromise) {
    browserLaunchPromise = puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=medium',
      ],
    });
  }
  try {
    return await browserLaunchPromise;
  } catch (e) {
    browserLaunchPromise = null;
    throw e;
  }
}

/** Désactivé en test ou si PV_PDF_ENGINE=pdfkit */
export function isChromiumPdfDisabled(): boolean {
  if (process.env.PV_PDF_ENGINE === 'pdfkit') return true;
  if (process.env.NODE_ENV === 'test') return true;
  return false;
}

export async function generatePvPdfBufferChromium(meta: PvPdfMeta): Promise<Buffer> {
  const raw = meta.bodyHtml || '';
  if (raw.length > PV_PDF_MAX_HTML_CHARS) {
    throw new Error('Contenu HTML trop volumineux');
  }

  const html = buildPrintableHtml(meta);
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' },
      preferCSSPageSize: false,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}
