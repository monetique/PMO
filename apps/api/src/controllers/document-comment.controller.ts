import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { DocumentCommentService } from '../services/document-comment.service';
import { logAccess } from '../middleware/logger';
import multer from 'multer';

const service = new DocumentCommentService();

// Configuration multer pour les pièces jointes des commentaires (mémoire)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max pour les pièces jointes
  fileFilter: (req, file, cb) => {
    // Accepter tous les types de fichiers pour les pièces jointes
    cb(null, true);
  },
});

export const uploadMiddleware = upload.single('pieceJointe');

export const listComments = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params; // documentId
    const comments = await service.list(id);
    res.json(comments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const addComment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) return res.status(401).json({ error: 'Non authentifié' });
    
    // Les lecteurs ne peuvent pas ajouter de commentaires
    if (req.user.role === 'lecteur') {
      return res.status(403).json({ error: 'Les lecteurs ne peuvent pas ajouter de commentaires' });
    }
    
    const { id } = req.params; // documentId
    const { contenu } = req.body;
    const file = req.file;

    const comment = await service.add(id, req.user.userId, contenu, file);
    await logAccess(req, res, 'modification', 'document', id, 'Ajout commentaire');
    res.status(201).json(comment);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
export const downloadAttachment = async (req: AuthRequest, res: Response) => {
  try {
    const { commentId } = req.params;
    const attachment = await service.downloadAttachment(commentId);

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.originalName)}"`);
    res.send(attachment.buffer);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
};
