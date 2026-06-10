import { prisma } from '../utils/prisma';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { NotificationService } from './notification.service';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const COMMENTS_DIR = path.join(UPLOAD_DIR, 'comments');

export class DocumentCommentService {
  private notificationService = new NotificationService();

  async ensureCommentsDir() {
    try {
      await fs.access(COMMENTS_DIR);
    } catch {
      await fs.mkdir(COMMENTS_DIR, { recursive: true });
    }
  }

  async list(documentId: string) {
    return prisma.documentComment.findMany({
      where: { documentId },
      include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async add(
    documentId: string,
    userId: string,
    contenu: string,
    file?: Express.Multer.File
  ) {
    if (!contenu || !contenu.trim()) {
      throw new Error('Le contenu du commentaire est requis');
    }

    let pieceJointeNom: string | undefined;
    let pieceJointePath: string | undefined;
    let pieceJointeType: string | undefined;
    let pieceJointeTaille: number | undefined;

    if (file) {
      await this.ensureCommentsDir();
      const fileExtension = path.extname(file.originalname);
      const fileName = `${uuidv4()}${fileExtension}`;
      const filePath = path.join(COMMENTS_DIR, fileName);

      await fs.writeFile(filePath, file.buffer);

      pieceJointeNom = file.originalname;
      pieceJointePath = `comments/${fileName}`;
      pieceJointeType = file.mimetype;
      pieceJointeTaille = file.size;
    }

    const created = await prisma.documentComment.create({
      data: {
        documentId,
        userId,
        contenu: contenu.trim(),
        pieceJointeNom,
        pieceJointePath,
        pieceJointeType,
        pieceJointeTaille,
      },
      include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
    });

    const [doc, auteur] = await Promise.all([
      prisma.document.findUnique({
        where: { id: documentId },
        select: {
          id: true,
          nom: true,
          fichierNomOriginal: true,
          referenceType: true,
          referenceId: true,
          contrats: {
            select: { contrat: { select: { id: true, nom: true } } },
            take: 1,
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { nom: true, prenom: true },
      }),
    ]);
    const auteurNom = auteur ? `${auteur.prenom} ${auteur.nom}` : 'Un utilisateur';
    let contextType: 'document' | 'processus' | 'projet' | 'licence' | 'contrat' = 'document';
    let contextId = documentId;
    let contextTitre = String(doc?.nom || doc?.fichierNomOriginal || 'Document').trim();
    if (doc?.referenceType === 'processus' && doc.referenceId) {
      contextType = 'processus';
      contextId = doc.referenceId;
      const proc = await prisma.processus.findUnique({
        where: { id: doc.referenceId },
        select: { nom: true },
      });
      contextTitre = String(proc?.nom || contextTitre);
    } else if (doc?.referenceType === 'projet' && doc.referenceId) {
      contextType = 'projet';
      contextId = doc.referenceId;
      const proj = await prisma.projet.findUnique({
        where: { id: doc.referenceId },
        select: { nom: true },
      });
      contextTitre = String(proj?.nom || contextTitre);
    } else if (doc?.referenceType === 'licence' && doc.referenceId) {
      contextType = 'licence';
      contextId = doc.referenceId;
      const lic = await prisma.licence.findUnique({
        where: { id: doc.referenceId },
        select: { nom: true },
      });
      contextTitre = String(lic?.nom || contextTitre);
    } else {
      const linkedContrat = doc?.contrats?.[0]?.contrat;
      if (linkedContrat?.id) {
        contextType = 'contrat';
        contextId = linkedContrat.id;
        contextTitre = String(linkedContrat.nom || contextTitre);
      }
    }
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    this.notificationService
      .traiterMentions({
        contenu: contenu.trim(),
        auteurId: userId,
        auteurNom,
        appUrl,
        context: { type: contextType, id: contextId, titre: contextTitre },
      })
      .catch((err: unknown) => console.error('[DOCUMENT] Mentions commentaire:', err));

    return created;
  }

  async downloadAttachment(commentId: string) {
    const comment = await prisma.documentComment.findUnique({
      where: { id: commentId },
      select: { pieceJointePath: true, pieceJointeNom: true, pieceJointeType: true },
    });

    if (!comment || !comment.pieceJointePath) {
      throw new Error('Pièce jointe non trouvée');
    }

    const filePath = path.join(UPLOAD_DIR, comment.pieceJointePath);
    const fileBuffer = await fs.readFile(filePath);

    return {
      buffer: fileBuffer,
      originalName: comment.pieceJointeNom || 'attachment',
      mimeType: comment.pieceJointeType || 'application/octet-stream',
    };
  }
}