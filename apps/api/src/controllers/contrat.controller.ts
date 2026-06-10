import { Request, Response } from 'express';
import { contratService } from '../services/contrat.service';
import { pvReunionService } from '../services/pv-reunion.service';
import { prisma } from '../utils/prisma';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = '/app/uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
export const uploadContrat = multer({ storage }).array('documents', 10);

function handleContratErr(res: Response, e: any) {
  const msg = e?.message || String(e);
  if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'Non trouvé' });
  if (msg === 'FORBIDDEN') return res.status(403).json({ error: 'Accès refusé' });
  if (
    msg.startsWith('Les administrateurs') ||
    msg.startsWith('Le créateur') ||
    msg.startsWith('Seuls les comptes administrateur') ||
    msg.startsWith('Le type de contrat') ||
    msg.startsWith('Type de contrat') ||
    msg.startsWith('Ce code contrat') ||
    msg.startsWith('Code contrat') ||
    msg.startsWith('Le code contrat') ||
    msg.startsWith('Le nom du contrat') ||
    msg === 'Utilisateur introuvable'
  ) {
    return res.status(400).json({ error: msg });
  }
  if (e?.code === 'P2002') {
    return res.status(400).json({ error: 'Ce code contrat est déjà utilisé' });
  }
  return res.status(500).json({ error: msg });
}

export const getContrats = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const contrats = await contratService.findAll(user.userId, user.role);
    res.json(contrats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getContratsCorbeille = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const rows = await contratService.listDeletedForCorbeilleScoped(user.userId, user.role);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

/** Carte contratId → nombre de vues (journal « lecture ») sur les pièces jointes liées. */
export const getContratsStatsVuesPj = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const map = await contratService.getVuesPiecesJointesByContratId(user.userId, user.role);
    res.json(map);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getContrat = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const contrat = await contratService.findOne(req.params.id, user.userId, user.role);
    if (!contrat) return res.status(404).json({ error: 'Non trouvé ou accès refusé' });
    res.json(contrat);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getContratAcces = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const data = await contratService.getAccesDetail(req.params.id, user.userId, user.role);
    res.json(data);
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const getContratPvReunions = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const contrat = await contratService.findOne(req.params.id, user.userId, user.role);
    if (!contrat) return res.status(404).json({ error: 'Non trouvé ou accès refusé' });
    const list = await pvReunionService.listLinkedToContrat(req.params.id, user.userId, user.role);
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getContratHistorique = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const data = await contratService.getHistorique(req.params.id, user.userId, user.role);
    res.json(data);
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const createContrat = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const data = { ...req.body };
    if (data.partiesPrenantes && typeof data.partiesPrenantes === 'string')
      data.partiesPrenantes = JSON.parse(data.partiesPrenantes);
    if (data.projetIds && typeof data.projetIds === 'string') data.projetIds = JSON.parse(data.projetIds);
    if (data.tags && typeof data.tags === 'string') data.tags = JSON.parse(data.tags);
    if (data.dateSignature) data.dateSignature = new Date(data.dateSignature);
    if (data.dateEnregistrement) data.dateEnregistrement = new Date(data.dateEnregistrement);
    if (data.dateExpiration) data.dateExpiration = new Date(data.dateExpiration);
    if (!user?.userId) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const contrat = await contratService.create(data, user.userId, user.role);
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files as Express.Multer.File[]) {
        const doc = await prisma.document.create({
          data: {
            nom: file.originalname,
            fichierUrl: file.filename,
            fichierNomOriginal: file.originalname,
            fichierTaille: file.size,
            fichierType: file.mimetype,
            typeDocument: 'contrat',
            estConfidentiel: true,
            uploadedById: user.userId,
          },
        });
        await contratService.addDocument(contrat.id, doc.id, user.userId, user.role);
      }
    }
    const refreshed = await contratService.findOne(contrat.id, user.userId, user.role);
    res.status(201).json(refreshed || contrat);
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const updateContrat = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const data = { ...req.body };
    if (data.partiesPrenantes && typeof data.partiesPrenantes === 'string')
      data.partiesPrenantes = JSON.parse(data.partiesPrenantes);
    if (data.projetIds && typeof data.projetIds === 'string') data.projetIds = JSON.parse(data.projetIds);
    if (data.tags && typeof data.tags === 'string') data.tags = JSON.parse(data.tags);
    if (data.dateSignature) data.dateSignature = new Date(data.dateSignature);
    if (data.dateEnregistrement) data.dateEnregistrement = new Date(data.dateEnregistrement);
    if (data.dateExpiration) data.dateExpiration = new Date(data.dateExpiration);
    const updated = await contratService.update(req.params.id, data, user.userId, user.role);
    res.json(updated);
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const deleteContrat = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await contratService.softDelete(req.params.id, user.userId, user.role);
    res.json({ success: true });
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const addPermission = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { userId, niveau } = req.body;
    if (!userId || !niveau) return res.status(400).json({ error: 'userId et niveau requis' });
    const perm = await contratService.addPermission(req.params.id, userId, niveau, user.userId, user.role);
    res.status(201).json(perm);
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const removePermission = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await contratService.removePermission(req.params.id, req.params.userId, user.userId, user.role);
    res.json({ success: true });
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const removePermissionEntry = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await contratService.removePermissionByEntryId(
      req.params.id,
      req.params.permissionEntryId,
      user.userId,
      user.role
    );
    res.json({ success: true });
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const blockAdminImplicitAccess = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await contratService.blockAdminImplicitAccess(req.params.id, userId, user.userId);
    res.status(204).send();
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const restoreAdminImplicitAccess = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await contratService.restoreAdminImplicitAccess(req.params.id, req.params.userId, user.userId);
    res.status(204).send();
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const addDocumentToContrat = async (req: Request, res: Response) => {
  uploadContrat(req, res, async (err) => {
    if (err) return res.status(500).json({ error: err.message });
    try {
      const user = (req as any).user;
      if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        const docs = [];
        for (const file of req.files as Express.Multer.File[]) {
          const doc = await prisma.document.create({
            data: {
              nom: file.originalname,
              fichierUrl: file.filename,
              fichierNomOriginal: file.originalname,
              fichierTaille: file.size,
              fichierType: file.mimetype,
              typeDocument: 'contrat',
              estConfidentiel: true,
              uploadedById: user.userId,
            },
          });
          await contratService.addDocument(req.params.id, doc.id, user.userId, user.role);
          docs.push(doc);
        }
        res.json(docs);
      } else if (req.body.documentId) {
        await contratService.addDocument(req.params.id, req.body.documentId, user.userId, user.role);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Aucun document fourni' });
      }
    } catch (e: any) {
      return handleContratErr(res, e);
    }
  });
};

export const uploadAndLinkDocument = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }
    const docs = [];
    for (const file of req.files as Express.Multer.File[]) {
      const doc = await prisma.document.create({
        data: {
          nom: file.originalname,
          fichierUrl: file.filename,
          fichierNomOriginal: file.originalname,
          fichierTaille: file.size,
          fichierType: file.mimetype,
          typeDocument: 'contrat',
          estConfidentiel: true,
          uploadedById: user.userId,
        },
      });
      await contratService.addDocument(req.params.id, doc.id, user.userId, user.role);
      docs.push(doc);
    }
    res.json(docs);
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const linkDocument = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: 'documentId requis' });
    await contratService.addDocument(req.params.id, documentId, user.userId, user.role);
    res.json({ success: true });
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};

export const removeDocumentFromContrat = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    await contratService.removeDocument(req.params.id, req.params.documentId, user.userId, user.role);
    res.json({ success: true });
  } catch (e: any) {
    return handleContratErr(res, e);
  }
};
