import { Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { ResourceType } from '../generated/prisma/enums';
import { parseTacheAssignPermission, TacheService } from '../services/tache.service';
import { pvReunionService } from '../services/pv-reunion.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { prisma } from '../utils/prisma';

const tacheService = new TacheService();

// ── Upload pièces jointes commentaires ────────────────────────────────────────
const uploadDir = path.join(process.cwd(), 'uploads', 'taches');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

export const uploadMiddleware = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }).single('fichier');

// ── CRUD Tâches ───────────────────────────────────────────────────────────────

export const getAllTaches = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { statut, projetId } = req.query;
    const taches = await tacheService.findAll({
      statut: statut as string,
      projetId: projetId as string,
      requesterId: req.user.userId,
      requesterRole: req.user.role,
    });
    res.json(taches);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTache = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const ok = await tacheService.canUserViewTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    const tache = await tacheService.findOne(req.params.id);
    if (!tache) return res.status(404).json({ error: 'Tâche non trouvée' });
    await logAccess(req, res, 'lecture', ResourceType.tache, tache.id, tache.nom, { action: 'consultation_tache' });
    res.json(tache);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createTache = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const tache = await tacheService.create(req.body, req.user.userId);
    await logAccess(req, res, 'creation', ResourceType.tache, tache.id, tache.nom);
    res.status(201).json(tache);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateTache = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });

    const ok = await tacheService.canUserModifyTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });

    const before = await tacheService.findOne(req.params.id);
    const tache = await tacheService.update(req.params.id, req.body);
    if (!tache) return res.status(404).json({ error: 'Tâche non trouvée' });
    const nouveauStatut = req.body?.statut;
    const ancienStatut = before?.statut;
    const modifications: Array<{ champ: string; avant: any; apres: any }> = [];
    const pushIfChanged = (champ: string, avant: any, apres: any) => {
      const a = avant ?? null;
      const b = apres ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b)) modifications.push({ champ, avant: a, apres: b });
    };
    if (before) {
      if ('nom' in req.body) pushIfChanged('nom', before.nom, tache.nom);
      if ('description' in req.body) pushIfChanged('description', before.description, tache.description);
      if ('scenarioExecution' in req.body) pushIfChanged('scenarioExecution', before.scenarioExecution, tache.scenarioExecution);
      if ('critereAcceptation' in req.body) pushIfChanged('critereAcceptation', before.critereAcceptation, tache.critereAcceptation);
      if ('statut' in req.body) pushIfChanged('statut', before.statut, tache.statut);
      if ('priorite' in req.body) pushIfChanged('priorite', before.priorite || null, tache.priorite || null);
      if ('complexite' in req.body) pushIfChanged('complexite', before.complexite || null, tache.complexite || null);
      if ('dateDebut' in req.body) pushIfChanged('dateDebut', before.dateDebut || null, tache.dateDebut || null);
      if ('dateFinApprox' in req.body) pushIfChanged('dateFinApprox', before.dateFinApprox || null, tache.dateFinApprox || null);
      if ('projetId' in req.body) pushIfChanged('projetId', before.projetId || null, tache.projetId || null);
      if ('userStoryId' in req.body) pushIfChanged('userStoryId', before.userStory?.id || null, tache.userStory?.id || null);
      if ('assignesUtilisateurIds' in req.body) {
        const avantIds = (before.assignesUtilisateurs || []).map((u: any) => u.id).sort();
        const apresIds = (tache.assignesUtilisateurs || []).map((u: any) => u.id).sort();
        pushIfChanged('assignesUtilisateurIds', avantIds, apresIds);
      }
      if ('assignesEntiteIds' in req.body) {
        const avantIds = (before.assignesEntites || []).map((e: any) => e.id).sort();
        const apresIds = (tache.assignesEntites || []).map((e: any) => e.id).sort();
        pushIfChanged('assignesEntiteIds', avantIds, apresIds);
      }
      if ('assignesClientFournisseurIds' in req.body) {
        const avantIds = (before.assignesClientsFournisseurs || []).map((c: any) => c.id).sort();
        const apresIds = (tache.assignesClientsFournisseurs || []).map((c: any) => c.id).sort();
        pushIfChanged('assignesClientFournisseurIds', avantIds, apresIds);
      }
      if ('liaisons' in req.body) {
        const avantL = (before.liaisons || [])
          .map((l: any) => `${l.tacheLiee?.id || l.tacheLieeId}:${l.type || 'simple'}`)
          .sort();
        const apresL = (tache.liaisons || [])
          .map((l: any) => `${l.tacheLiee?.id || l.tacheLieeId}:${l.type || 'simple'}`)
          .sort();
        pushIfChanged('liaisons', avantL, apresL);
      }
    }
    await logAccess(req, res, 'modification', ResourceType.tache, tache.id, tache.nom, {
      action: typeof nouveauStatut === 'string' && ancienStatut && ancienStatut !== nouveauStatut
        ? 'changement_statut'
        : 'mise_a_jour_tache',
      champ: typeof nouveauStatut === 'string' && ancienStatut && ancienStatut !== nouveauStatut ? 'statut' : undefined,
      ancienStatut: typeof nouveauStatut === 'string' && ancienStatut && ancienStatut !== nouveauStatut ? ancienStatut : undefined,
      nouveauStatut: typeof nouveauStatut === 'string' && ancienStatut && ancienStatut !== nouveauStatut ? nouveauStatut : undefined,
      modifications,
    });
    res.json(tache);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteTache = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await tacheService.softDelete(req.params.id, req.user.userId, req.user.role);
    await logAccess(req, res, 'suppression', ResourceType.tache, req.params.id, undefined, { action: 'corbeille_tache' });
    res.status(204).end();
  } catch (error: any) {
    const code =
      error.message === 'Accès refusé' ? 403 : error.message === 'Tâche non trouvée' ? 404 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const getTachesCorbeille = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const list = await tacheService.listCorbeille(req.user.userId, req.user.role);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTacheAcces = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const ok = await tacheService.canUserViewTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    const data = await tacheService.getAccesDetail(req.params.id, req.user.role, req.user.userId);
    if (!data) return res.status(404).json({ error: 'Tâche non trouvée' });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const postTacheAssigne = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const ok = await tacheService.canUserViewTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    const permission = parseTacheAssignPermission(req.body.permission);
    const data = await tacheService.addTacheAssigne(
      req.params.id,
      userId,
      permission,
      req.user.userId,
      req.user.role
    );
    res.json(data);
  } catch (error: any) {
    const code = error.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const patchTacheAssignePermission = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const ok = await tacheService.canUserViewTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    const permission = parseTacheAssignPermission(req.body.permission);
    const data = await tacheService.updateTacheAssignePermission(
      req.params.id,
      req.params.assignId,
      permission,
      req.user.userId,
      req.user.role
    );
    res.json(data);
  } catch (error: any) {
    const code =
      error.message === 'Accès refusé'
        ? 403
        : error.message === 'Assignation introuvable'
          ? 404
          : 400;
    res.status(code).json({ error: error.message });
  }
};

export const deleteTacheAssigne = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const ok = await tacheService.canUserViewTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    const data = await tacheService.removeTacheAssigne(
      req.params.id,
      req.params.assignId,
      req.user.userId,
      req.user.role
    );
    res.json(data);
  } catch (error: any) {
    const code =
      error.message === 'Accès refusé'
        ? 403
        : error.message === 'Assignation introuvable'
          ? 404
          : 400;
    res.status(code).json({ error: error.message });
  }
};

export const postTacheAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const data = await tacheService.blockTacheAdminImplicit(
      req.params.id,
      userId,
      req.user.userId,
      req.user.role
    );
    res.json(data);
  } catch (error: any) {
    const code = error.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const deleteTacheAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const data = await tacheService.restoreTacheAdminImplicit(
      req.params.id,
      req.params.userId,
      req.user.userId,
      req.user.role
    );
    res.json(data);
  } catch (error: any) {
    const code = error.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const getTacheHistory = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const ok = await tacheService.canUserViewTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 80, 200);
    const out = await tacheService.getJournalHistory(req.params.id, page, limit);
    res.json(out);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const restoreTache = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const t = await tacheService.restore(req.params.id, req.user.userId, req.user.role);
    await logAccess(req, res, 'modification', ResourceType.tache, t!.id, t!.nom, { action: 'restauration' });
    res.json(t);
  } catch (error: any) {
    const code =
      error.message === 'Accès refusé' ? 403 : error.message?.includes('non trouvée') ? 404 : 400;
    res.status(code).json({ error: error.message });
  }
};

// ── Commentaires ──────────────────────────────────────────────────────────────

export const getCommentaires = async (req: AuthRequest, res: Response) => {
  try {
    const commentaires = await tacheService.getCommentaires(req.params.id);
    res.json(commentaires);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const addCommentaire = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { contenu } = req.body;
    if (!contenu?.trim() && !req.file) {
      return res.status(400).json({ error: 'Contenu ou fichier requis' });
    }
    const commentaire = await tacheService.addCommentaire(
      req.params.id,
      req.user.userId,
      contenu?.trim() || '',
      req.file,
    );
    await logAccess(req, res, 'modification', ResourceType.tache, req.params.id, undefined, {
      action: 'commentaire_ajoute_tache',
      commentaireId: commentaire.id,
      apercu:
        contenu?.trim()?.slice(0, 200) || (req.file ? '[Pièce jointe]' : ''),
    });
    res.status(201).json(commentaire);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const downloadCommentaireFichier = async (req: AuthRequest, res: Response) => {
  try {
    const { commentaireId } = req.params;
    const commentaire = await tacheService.getCommentaireFichier(commentaireId);
    if (!commentaire?.pieceJointePath) {
      return res.status(404).json({ error: 'Fichier non trouvé' });
    }
    res.download(commentaire.pieceJointePath, commentaire.pieceJointeNom || 'fichier');
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

// ── Documents ─────────────────────────────────────────────────────────────────

export const uploadDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const mod = await tacheService.canUserModifyTache(req.params.id, req.user.userId, req.user.role);
    if (!mod) return res.status(403).json({ error: 'Accès refusé' });
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
    const { nom, description } = req.body;
    const document = await tacheService.uploadDocument(
      req.params.id,
      req.user.userId,
      req.file,
      nom || req.file.originalname,
      description,
    );
    await logAccess(req, res, 'modification', ResourceType.tache, req.params.id, undefined, {
      action: 'document_ajoute_tache',
      documentId: document.id,
      documentNom: document.nom,
    });
    res.status(201).json(document);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const lierDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const mod = await tacheService.canUserModifyTache(req.params.id, req.user.userId, req.user.role);
    if (!mod) return res.status(403).json({ error: 'Accès refusé' });
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: 'documentId requis' });
    await tacheService.lierDocument(req.params.id, documentId);
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, nom: true },
    });
    await logAccess(req, res, 'modification', ResourceType.tache, req.params.id, undefined, {
      action: 'document_lie_tache',
      documentId,
      documentNom: doc?.nom,
    });
    res.status(201).json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const delierDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const mod = await tacheService.canUserModifyTache(req.params.id, req.user.userId, req.user.role);
    if (!mod) return res.status(403).json({ error: 'Accès refusé' });
    const doc = await prisma.document.findUnique({
      where: { id: req.params.documentId },
      select: { id: true, nom: true },
    });
    await tacheService.delierDocument(req.params.id, req.params.documentId);
    await logAccess(req, res, 'modification', ResourceType.tache, req.params.id, undefined, {
      action: 'document_delie_tache',
      documentId: req.params.documentId,
      documentNom: doc?.nom,
    });
    res.status(204).end();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const getDocumentsLiables = async (req: AuthRequest, res: Response) => {
  try {
    const { search } = req.query;
    const documents = await tacheService.getDocumentsLiables(search as string);
    res.json(documents);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTachePvReunions = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const ok = await tacheService.canUserViewTache(req.params.id, req.user.userId, req.user.role);
    if (!ok) return res.status(403).json({ error: 'Accès refusé' });
    const list = await pvReunionService.listLinkedToTache(
      req.params.id,
      req.user.userId,
      req.user.role
    );
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
