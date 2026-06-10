import { Response } from 'express';
import multer from 'multer';
import path from 'path';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { LicenceService } from '../services/licence.service';

const licenceService = new LicenceService();

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});
export const licenceUploadMiddleware = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (pièces jointes licences)
}).array('documents', 20);

export const getLicencesCorbeille = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const list = await licenceService.findAllDeleted(req.user.userId, req.user.role);
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getLicences = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const list = await licenceService.findAllActive(req.user.userId, req.user.role);
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getLicence = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const l = await licenceService.findOne(req.params.id, req.user.userId, req.user.role);
    if (!l) return res.status(404).json({ error: 'Licence non trouvée' });
    await logAccess(req, res, 'lecture', 'licence', l.id, l.nom);
    res.json(l);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getLicenceHistory = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const hist = await licenceService.getHistory(req.params.id, req.user.userId, req.user.role);
    if (hist === null) return res.status(404).json({ error: 'Licence non trouvée' });
    res.json(hist);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const createLicence = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const l = await licenceService.create(req.body, req.user.userId, req.user.role);
    await logAccess(req, res, 'creation', 'licence', l.id, l.nom);
    res.status(201).json(l);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

export const updateLicence = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const l = await licenceService.update(req.params.id, req.body, req.user.userId, req.user.role);
    await logAccess(req, res, 'modification', 'licence', l.id, l.nom);
    res.json(l);
  } catch (e: any) {
    const code = e.message === 'Licence non trouvée' ? 404 : e.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const deleteLicence = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await licenceService.softDelete(req.params.id, req.user.userId, req.user.role);
    await logAccess(req, res, 'suppression', 'licence', req.params.id, undefined, { action: 'corbeille' });
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'Licence non trouvée' ? 404 : e.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const restoreLicence = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const l = await licenceService.restore(req.params.id, req.user.userId, req.user.role);
    await logAccess(req, res, 'modification', 'licence', l.id, l.nom, { action: 'restauration' });
    res.json(l);
  } catch (e: any) {
    const code = e.message.includes('Accès') ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const deleteLicencePermanent = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Seul un administrateur peut supprimer définitivement une licence.' });
    }
    await licenceService.deletePermanent(req.params.id);
    await logAccess(req, res, 'suppression', 'licence', req.params.id, undefined, { action: 'suppression_definitive' });
    res.status(204).end();
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

export const getLicenceAcces = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const data = await licenceService.getAccesDetail(req.params.id, req.user.userId, req.user.role);
    res.json(data);
  } catch (e: any) {
    if (e.message === 'NOT_FOUND') return res.status(404).json({ error: 'Licence non trouvée' });
    if (e.message === 'FORBIDDEN') return res.status(403).json({ error: 'Accès refusé' });
    res.status(500).json({ error: e.message });
  }
};

export const addPermission = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { userId, niveau } = req.body;
    if (!userId || !niveau) return res.status(400).json({ error: 'userId et niveau requis' });
    const l = await licenceService.addPermission(req.params.id, userId, niveau, req.user.userId, req.user.role);
    if (!l) return res.status(404).json({ error: 'Licence non trouvée' });
    await logAccess(req, res, 'modification', 'licence', l.id, l.nom, { action: 'permission_ajoutee', userId, niveau });
    res.json(l);
  } catch (e: any) {
    const code =
      e.message === 'Accès refusé' ? 403 : e.message === 'Utilisateur introuvable' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const removePermission = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const l = await licenceService.removePermission(req.params.id, req.params.userId, req.user.userId, req.user.role);
    if (!l) return res.status(404).json({ error: 'Licence non trouvée' });
    await logAccess(req, res, 'modification', 'licence', l.id, l.nom, { action: 'permission_retiree', userId: req.params.userId });
    res.json(l);
  } catch (e: any) {
    const code =
      e.message === 'Accès refusé'
        ? 403
        : e.message === 'Permission introuvable'
          ? 404
          : 400;
    res.status(code).json({ error: e.message });
  }
};

export const removePermissionEntry = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await licenceService.removePermissionByEntryId(
      req.params.id,
      req.params.permissionEntryId,
      req.user.userId,
      req.user.role,
    );
    res.json({ success: true });
  } catch (e: any) {
    const code =
      e.message === 'Accès refusé'
        ? 403
        : e.message === 'Permission introuvable'
          ? 404
          : 400;
    res.status(code).json({ error: e.message });
  }
};

export const blockAdminImplicitAccessLicence = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await licenceService.blockAdminImplicitAccess(req.params.id, userId, req.user.userId);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'Accès refusé' ? 403 : e.message === 'Licence non trouvée' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const restoreAdminImplicitAccessLicence = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await licenceService.restoreAdminImplicitAccess(req.params.id, req.params.userId, req.user.userId);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'Accès refusé' ? 403 : e.message === 'Licence non trouvée' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const addCommentaire = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { contenu, assigneA } = req.body;
    if (!contenu?.trim()) return res.status(400).json({ error: 'Contenu requis' });
    const l = await licenceService.addCommentaire(req.params.id, req.user.userId, req.user.role, contenu.trim(), assigneA || null);
    if (!l) return res.status(404).json({ error: 'Licence non trouvée' });
    await logAccess(req, res, 'creation', 'licence', l.id, l.nom, { action: 'commentaire' });
    res.json(l);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
};

export const setNotification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const body = req.body || {};
    const mode = body.mode === 'date_recurrence' ? 'date_recurrence' : 'before_end';
    const l = await licenceService.setNotification(req.params.id, req.user.userId, req.user.role, {
      mode,
      joursAvant: body.joursAvant != null ? Number(body.joursAvant) : undefined,
      dateAlerte: body.dateAlerte ?? null,
      recurrence: body.recurrence,
      destinataires: Array.isArray(body.destinataires) ? body.destinataires : [],
    });
    if (!l) return res.status(404).json({ error: 'Licence non trouvée' });
    await logAccess(req, res, 'modification', 'licence', l.id, l.nom, { action: 'notification_expiration' });
    res.json(l);
  } catch (e: any) {
    const code = e.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const deleteLicenceNotification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const l = await licenceService.deleteNotification(
      req.params.id,
      req.params.notificationId,
      req.user.userId,
      req.user.role,
    );
    if (!l) return res.status(404).json({ error: 'Licence non trouvée' });
    await logAccess(req, res, 'modification', 'licence', l.id, l.nom, { action: 'notification_suppression' });
    res.json(l);
  } catch (e: any) {
    const code =
      e.message === 'Accès refusé' ? 403 : e.message === 'Alerte introuvable' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const linkExistingDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const documentId = req.body?.documentId;
    if (!documentId || typeof documentId !== 'string') {
      return res.status(400).json({ error: 'documentId requis' });
    }
    const l = await licenceService.attachExistingDocument(
      req.params.id,
      documentId,
      req.user.userId,
      req.user.role,
    );
    await logAccess(req, res, 'modification', 'licence', l.id, l.nom, {
      action: 'document_lie',
      documentId,
    });
    res.json(l);
  } catch (e: any) {
    const msg = e.message || '';
    const code =
      msg === 'Accès refusé' || msg === 'Accès au document refusé'
        ? 403
        : msg === 'Licence non trouvée' || msg === 'Document non trouvé'
          ? 404
          : 400;
    res.status(code).json({ error: msg || 'Erreur' });
  }
};

export const uploadDocuments = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const files = req.files as Express.Multer.File[];
    if (!files?.length) return res.status(400).json({ error: 'Fichier requis' });
    let last: any = null;
    for (const file of files) {
      last = await licenceService.attachUploadedFile(req.params.id, req.user.userId, req.user.role, file, file.originalname);
    }
    if (last) await logAccess(req, res, 'creation', 'licence', last.id, last.nom, { action: 'document_upload', count: files.length });
    res.json(last);
  } catch (e: any) {
    const code = e.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};
