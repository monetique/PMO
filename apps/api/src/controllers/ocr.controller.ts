import { Response } from 'express';
import { prisma } from '../utils/prisma';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import PDFDocument from 'pdfkit';
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from 'docx';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { DocumentService } from '../services/document.service';
import { LogAction, ResourceType } from '../generated/prisma/enums';

const execFileAsync = promisify(execFile);
const documentService = new DocumentService();

/** Buffer sortie tesseract (pages denses). */
const TESSERACT_MAX_BUFFER = 32 * 1024 * 1024;

const DOCX_RUN_MAX = 8000;

function safeExportBasename(nom: string): string {
  const base = (nom || 'document').replace(/[/\\?%*:|"<>]/g, '_').replace(/\.[^.]+$/i, '');
  return (base.length > 0 ? base : 'document').slice(0, 120);
}

function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function chunkForDocxRuns(text: string): string[] {
  if (text.length <= DOCX_RUN_MAX) return [text];
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += DOCX_RUN_MAX) {
    parts.push(text.slice(i, i + DOCX_RUN_MAX));
  }
  return parts;
}

const UPLOADS_DIR = '/app/uploads';
const OCR_DIR = '/app/uploads/ocr';

// Créer les dossiers si inexistants
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OCR_DIR)) fs.mkdirSync(OCR_DIR, { recursive: true });

// Convertir PDF en images puis OCR (execFile async : ne bloque pas la boucle d’événements — autres routes restent servies)
async function ocrPdf(filePath: string, docId: string): Promise<string> {
  try {
    const outDir = path.join(OCR_DIR, docId);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const pagePrefix = path.join(outDir, 'page');
    await execFileAsync('pdftoppm', ['-r', '200', filePath, pagePrefix], {
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const images = (await fs.promises.readdir(outDir)).filter(
      (f) => f.endsWith('.ppm') || f.endsWith('.png') || f.endsWith('.jpg'),
    );
    let fullText = '';
    for (const img of images.sort()) {
      const imgPath = path.join(outDir, img);
      try {
        const { stdout } = await execFileAsync('tesseract', [imgPath, 'stdout', '-l', 'fra+eng+ara'], {
          timeout: 120_000,
          maxBuffer: TESSERACT_MAX_BUFFER,
          encoding: 'utf8',
        });
        fullText += String(stdout) + '\n';
      } catch {
        /* continuer si une page échoue */
      }
    }
    return fullText.trim();
  } catch (e: any) {
    throw new Error(`Erreur OCR PDF: ${e.message}`);
  }
}

// OCR sur image directe
async function ocrImage(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('tesseract', [filePath, 'stdout', '-l', 'fra+eng+ara'], {
      timeout: 120_000,
      maxBuffer: TESSERACT_MAX_BUFFER,
      encoding: 'utf8',
    });
    return String(stdout).trim();
  } catch (e: any) {
    throw new Error(`Erreur OCR image: ${e.message}`);
  }
}

// OCR sur DOCX via mammoth
async function ocrDocx(filePath: string): Promise<string> {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (e: any) {
    throw new Error(`Erreur extraction DOCX: ${e.message}`);
  }
}

// GET /api/v1/ocr/documents - Liste tous les documents avec statut OCR
export const getDocumentsOcr = async (req: AuthRequest, res: Response) => {
  try {
    const documents = await prisma.document.findMany({
      where: { deletedAt: null },
      select: {
        id: true, nom: true, fichierUrl: true, fichierType: true,
        fichierTaille: true, typeDocument: true, ocrTraite: true,
        ocrDate: true,
        /** Ne pas charger texteOcr ici : JSON énorme → timeout navigateur après OCR volumineux. */
        createdAt: true, estConfidentiel: true,
        uploadedBy: { select: { id: true, nom: true, prenom: true } },
        permissionsUtilisateurs: {
          include: { user: { select: { id: true, nom: true, prenom: true } } }
        },
        contrats: {
          include: {
            contrat: {
              select: {
                id: true, nom: true,
                permissions: {
                  include: { user: { select: { id: true, nom: true, prenom: true } } }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(documents);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// POST /api/v1/ocr/scan/:id - Scanner un document spécifique
export const scanDocument = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  try {
    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) return res.status(404).json({ error: 'Document non trouvé' });

    const filePath = path.join(UPLOADS_DIR, doc.fichierUrl);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier non trouvé sur le serveur' });

    let texte = '';
    const mime = doc.fichierType || '';
    const ext = path.extname(doc.fichierUrl).toLowerCase();

    if (mime === 'application/pdf' || ext === '.pdf') {
      texte = await ocrPdf(filePath, doc.id);
    } else if (mime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.tiff', '.bmp'].includes(ext)) {
      texte = await ocrImage(filePath);
    } else if (mime.includes('word') || ext === '.docx' || ext === '.doc') {
      texte = await ocrDocx(filePath);
    } else {
      return res.status(400).json({ error: `Type de fichier non supporté: ${mime}` });
    }

    // Sauvegarder en BDD
    await prisma.document.update({
      where: { id },
      data: { texteOcr: texte, ocrTraite: true, ocrDate: new Date() }
    });

    // Sauvegarder en fichier .txt
    const txtPath = path.join(OCR_DIR, `${doc.id}.txt`);
    await fs.promises.writeFile(txtPath, texte, 'utf8');

    res.json({ success: true, documentId: id, longueurTexte: texte.length, apercu: texte.substring(0, 300) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /api/v1/ocr/export/:id?format=pdf|docx|txt — texte OCR complet (Word / PDF / TXT)
export const exportOcrDocument = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const formatRaw = String(req.query.format || 'docx').toLowerCase();
  if (!['pdf', 'docx', 'txt'].includes(formatRaw)) {
    return res.status(400).json({ error: 'Paramètre format invalide (pdf, docx ou txt)' });
  }
  const format = formatRaw as 'pdf' | 'docx' | 'txt';

  try {
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    const row = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, nom: true, texteOcr: true, ocrTraite: true },
    });
    if (!row) return res.status(404).json({ error: 'Document non trouvé' });
    if (!row.ocrTraite || !row.texteOcr || !String(row.texteOcr).trim()) {
      return res.status(400).json({ error: 'Aucun texte OCR disponible. Lancez d’abord un scan.' });
    }

    const canAccess = await documentService.canUserAccessDocument(id, userId, role);
    if (!canAccess) {
      return res.status(403).json({ error: 'Accès non autorisé à ce document' });
    }

    const base = safeExportBasename(row.nom);
    const texte = row.texteOcr;

    await logAccess(req, res, LogAction.telechargement, ResourceType.document, row.id, row.nom, {
      typeAction: 'export_texte_ocr',
      format,
    });

    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', contentDispositionAttachment(`${base}_OCR.txt`));
      return res.send(texte);
    }

    if (format === 'docx') {
      const lines = texte.split(/\r?\n/);
      const bodyParas = lines.map(
        (line) =>
          new Paragraph({
            children: chunkForDocxRuns(line.length > 0 ? line : '\u00a0').map(
              (chunk) => new TextRun({ text: chunk }),
            ),
          }),
      );
      const wordDoc = new DocxDocument({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                heading: HeadingLevel.HEADING_1,
                children: [new TextRun({ text: row.nom })],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: 'Texte extrait par OCR. Recherche (Ctrl+F), copie et annotations possibles dans Word.',
                    italics: true,
                  }),
                ],
              }),
              new Paragraph({ children: [new TextRun({ text: '' })] }),
              ...bodyParas,
            ],
          },
        ],
      });
      const buffer = await Packer.toBuffer(wordDoc);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      res.setHeader('Content-Disposition', contentDispositionAttachment(`${base}_OCR.docx`));
      return res.send(buffer);
    }

    const pdfBuf = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const pdf = new PDFDocument({ margin: 50 });
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
      try {
        pdf.fontSize(10).fillColor('#000000').text(texte, { width: 500, align: 'left' });
        pdf.end();
      } catch (err) {
        reject(err);
      }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDispositionAttachment(`${base}_OCR.pdf`));
    return res.send(pdfBuf);
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
};

// POST /api/v1/ocr/scan-all - Scanner tous les documents non traités
export const scanAll = async (req: AuthRequest, res: Response) => {
  try {
    const documents = await prisma.document.findMany({
      where: { deletedAt: null, ocrTraite: false }
    });
    res.json({ message: `${documents.length} documents en attente de traitement`, ids: documents.map(d => d.id) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// GET /api/v1/ocr/search?q= - Recherche full-text dans les textes OCR
export const searchOcr = async (req: AuthRequest, res: Response) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    return res.status(400).json({ error: 'Terme de recherche trop court (min 2 caractères)' });
  }
  try {
    const documents = await prisma.document.findMany({
      where: {
        deletedAt: null,
        ocrTraite: true,
        texteOcr: { contains: q, mode: 'insensitive' }
      },
      select: {
        id: true, nom: true, fichierUrl: true, fichierType: true,
        typeDocument: true, ocrDate: true, texteOcr: true, createdAt: true,
        uploadedBy: { select: { nom: true, prenom: true } }
      },
      orderBy: { ocrDate: 'desc' }
    });

    // Extraire les extraits pertinents
    const results = documents.map(doc => {
      const texte = doc.texteOcr || '';
      const idx = texte.toLowerCase().indexOf(q.toLowerCase());
      const extrait = idx >= 0
        ? '...' + texte.substring(Math.max(0, idx - 100), idx + 200) + '...'
        : texte.substring(0, 200) + '...';
      return { ...doc, texteOcr: undefined, extrait, occurrences: (texte.toLowerCase().match(new RegExp(q.toLowerCase(), 'g')) || []).length };
    });

    res.json({ query: q, total: results.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
