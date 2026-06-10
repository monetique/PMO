import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { ResourceType } from '../generated/prisma/enums';
import {
  pvReunionService,
  parseIdArrayFromBody,
  LiensExplicites,
} from '../services/pv-reunion.service';
import { prisma } from '../utils/prisma';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

export const uploadPvPrincipal = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB (PV principal)
}).single('fichier');

export const uploadPvCommentaire = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single('fichier');

function parseLiensFromBody(body: Record<string, unknown>): LiensExplicites {
  return {
    projetIds: parseIdArrayFromBody(body.projetIds),
    tacheIds: parseIdArrayFromBody(body.tacheIds),
    userStoryIds: parseIdArrayFromBody(body.userStoryIds),
    epicIds: parseIdArrayFromBody(body.epicIds),
    contratIds: parseIdArrayFromBody(body.contratIds),
    processusIds: parseIdArrayFromBody(body.processusIds),
  };
}

function handleErr(res: Response, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'Non trouvé' });
  if (msg === 'FORBIDDEN') return res.status(403).json({ error: 'Accès refusé' });
  if (msg === 'Contenu vide' || msg === 'Contenu trop volumineux') {
    return res.status(400).json({ error: msg });
  }
  if (
    msg.startsWith('Les administrateurs') ||
    msg.startsWith('Le créateur') ||
    msg.startsWith('Seuls les comptes administrateur') ||
    msg.startsWith('Statut PV') ||
    msg === 'Utilisateur introuvable' ||
    msg === 'Utilisateur assigné introuvable'
  ) {
    return res.status(400).json({ error: msg });
  }
  return res.status(500).json({ error: msg });
}

export const getPvReunions = async (req: AuthRequest, res: Response) => {
  try {
    const list = await pvReunionService.findAll(req.user!.userId, req.user!.role);
    res.json(list);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const getPvReunionsCorbeille = async (req: AuthRequest, res: Response) => {
  try {
    const list = await pvReunionService.listDeletedForCorbeilleScoped(
      req.user!.userId,
      req.user!.role
    );
    res.json(list);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const getPvReunionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const pv = await pvReunionService.findOne(req.params.id, req.user!.userId, req.user!.role);
    if (!pv) return res.status(404).json({ error: 'Non trouvé' });

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const skip = (page - 1) * limit;

    const total = await prisma.journalAcces.count({
      where: { ressourceType: ResourceType.pvReunion, ressourceId: req.params.id },
    });
    const history = await prisma.journalAcces.findMany({
      where: { ressourceType: ResourceType.pvReunion, ressourceId: req.params.id },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true } },
      },
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit,
    });

    res.json({
      data: history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
};

export const getPvReunionAcces = async (req: AuthRequest, res: Response) => {
  try {
    const data = await pvReunionService.getAccesDetail(
      req.params.id,
      req.user!.userId,
      req.user!.role
    );
    res.json(data);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const getPvReunion = async (req: AuthRequest, res: Response) => {
  try {
    const pv = await pvReunionService.findOne(req.params.id, req.user!.userId, req.user!.role);
    if (!pv) return res.status(404).json({ error: 'Non trouvé' });
    res.json(pv);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const createPvReunion = async (req: AuthRequest, res: Response) => {
  try {
    const file = req.file as Express.Multer.File | undefined;
    const contenuHtmlRaw =
      req.body.contenuHtml != null && String(req.body.contenuHtml).trim() !== ''
        ? String(req.body.contenuHtml)
        : '';
    const contenuHtml = contenuHtmlRaw.trim() ? contenuHtmlRaw : undefined;

    if (!file && !contenuHtml) {
      return res.status(400).json({ error: 'Fichier du PV ou contenu rédigé requis' });
    }
    const titre = String(req.body.titre || '').trim();
    if (!titre) return res.status(400).json({ error: 'Titre requis' });

    let dateReunion: Date | null = null;
    if (req.body.dateReunion) {
      const d = new Date(req.body.dateReunion);
      if (!Number.isNaN(d.getTime())) dateReunion = d;
    }

    const liens = parseLiensFromBody(req.body);
    const pv = await pvReunionService.create(req.user!.userId, req.user!.role, {
      titre,
      statut: req.body.statut != null ? String(req.body.statut) : undefined,
      dateReunion,
      presentUserIds: parseIdArrayFromBody(req.body.presentUserIds),
      presentClientFournisseurIds: parseIdArrayFromBody(req.body.presentClientFournisseurIds),
      modificationDelegueIds: parseIdArrayFromBody(req.body.modificationDelegueIds),
      liens,
      fichier: file,
      contenuHtml: contenuHtml ?? null,
    });
    await logAccess(req, res, 'creation', ResourceType.pvReunion, pv!.id, pv!.titre);
    res.status(201).json(pv);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const updatePvReunion = async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const data: {
      titre?: string;
      statut?: string | null;
      dateReunion?: Date | null;
      presentUserIds?: string[];
      presentClientFournisseurIds?: string[];
      modificationDelegueIds?: string[];
      liens?: LiensExplicites;
      contenuHtml?: string | null;
    } = {};
    if (body.titre != null) data.titre = String(body.titre).trim();
    if (body.statut !== undefined) {
      data.statut = body.statut === null || body.statut === '' ? null : String(body.statut);
    }
    if (body.dateReunion !== undefined) {
      data.dateReunion =
        body.dateReunion === null || body.dateReunion === ''
          ? null
          : new Date(String(body.dateReunion));
      if (data.dateReunion && Number.isNaN(data.dateReunion.getTime())) {
        return res.status(400).json({ error: 'Date de réunion invalide' });
      }
    }
    if (body.presentUserIds !== undefined) {
      data.presentUserIds = parseIdArrayFromBody(body.presentUserIds);
    }
    if (body.presentClientFournisseurIds !== undefined) {
      data.presentClientFournisseurIds = parseIdArrayFromBody(body.presentClientFournisseurIds);
    }
    if (body.modificationDelegueIds !== undefined) {
      data.modificationDelegueIds = parseIdArrayFromBody(body.modificationDelegueIds);
    }
    const lienKeys = [
      'projetIds',
      'tacheIds',
      'userStoryIds',
      'epicIds',
      'contratIds',
      'processusIds',
    ] as const;
    if (body.contenuHtml !== undefined) {
      data.contenuHtml =
        body.contenuHtml === null || body.contenuHtml === ''
          ? null
          : String(body.contenuHtml);
    }
    if (lienKeys.some((k) => body[k] !== undefined)) {
      const existingPv = await pvReunionService.findOne(
        req.params.id,
        req.user!.userId,
        req.user!.role
      );
      if (!existingPv) return res.status(404).json({ error: 'Non trouvé' });
      const base = existingPv.liensExplicites as LiensExplicites;
      data.liens = {
        projetIds: body.projetIds !== undefined ? parseIdArrayFromBody(body.projetIds) : base.projetIds,
        tacheIds: body.tacheIds !== undefined ? parseIdArrayFromBody(body.tacheIds) : base.tacheIds,
        userStoryIds:
          body.userStoryIds !== undefined ? parseIdArrayFromBody(body.userStoryIds) : base.userStoryIds,
        epicIds: body.epicIds !== undefined ? parseIdArrayFromBody(body.epicIds) : base.epicIds,
        contratIds:
          body.contratIds !== undefined ? parseIdArrayFromBody(body.contratIds) : base.contratIds,
        processusIds:
          body.processusIds !== undefined
            ? parseIdArrayFromBody(body.processusIds)
            : base.processusIds,
      };
    }

    const pv = await pvReunionService.update(req.params.id, req.user!.userId, req.user!.role, data);
    await logAccess(req, res, 'modification', ResourceType.pvReunion, pv!.id, pv!.titre);
    res.json(pv);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const patchPvReunionContenu = async (req: AuthRequest, res: Response) => {
  try {
    const contenuHtml = req.body?.contenuHtml != null ? String(req.body.contenuHtml) : '';
    if (!contenuHtml.trim()) return res.status(400).json({ error: 'Contenu requis' });
    const pv = await pvReunionService.saveContenuBrouillon(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      contenuHtml
    );
    await logAccess(req, res, 'modification', ResourceType.pvReunion, pv!.id, pv!.titre, {
      action: 'pv_contenu_version',
    });
    res.json(pv);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const getPvReunionContenuVersions = async (req: AuthRequest, res: Response) => {
  try {
    const list = await pvReunionService.listContenuVersions(
      req.params.id,
      req.user!.userId,
      req.user!.role
    );
    res.json(list);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const getPvReunionContenuVersion = async (req: AuthRequest, res: Response) => {
  try {
    const row = await pvReunionService.getContenuVersion(
      req.params.id,
      req.params.versionId,
      req.user!.userId,
      req.user!.role
    );
    res.json(row);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const deletePvReunion = async (req: AuthRequest, res: Response) => {
  try {
    await pvReunionService.softDelete(req.params.id, req.user!.userId, req.user!.role);
    await logAccess(req, res, 'suppression', ResourceType.pvReunion, req.params.id);
    res.status(204).send();
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const addPvCommentaire = async (req: AuthRequest, res: Response) => {
  try {
    const contenu = String(req.body.contenu || '').trim();
    if (!contenu) return res.status(400).json({ error: 'Contenu requis' });
    const assigneAId = req.body.assigneAId ? String(req.body.assigneAId) : null;
    const file = req.file as Express.Multer.File | undefined;

    const c = await pvReunionService.addCommentaire(
      req.params.id,
      req.user!.userId,
      req.user!.role,
      contenu,
      assigneAId,
      file
    );
    await logAccess(req, res, 'creation', ResourceType.pvReunion, req.params.id, undefined, {
      action: 'commentaire_pv',
    });
    res.status(201).json(c);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const downloadPvCommentairePiece = async (req: AuthRequest, res: Response) => {
  try {
    const doc = await pvReunionService.getCommentairePieceDocument(
      req.params.commentId,
      req.user!.userId,
      req.user!.role
    );
    if (!doc) return res.status(404).json({ error: 'Pièce jointe introuvable' });
    const filePath = path.join(uploadDir, doc.fichierUrl);
    res.download(filePath, doc.fichierNomOriginal);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const postPvReunionPermission = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, niveau } = req.body as { userId?: string; niveau?: string };
    if (!userId || !niveau) return res.status(400).json({ error: 'userId et niveau requis' });
    const perm = await pvReunionService.addPermission(
      req.params.id,
      userId,
      niveau,
      req.user!.userId,
      req.user!.role
    );
    res.status(201).json(perm);
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const deletePvReunionPermission = async (req: AuthRequest, res: Response) => {
  try {
    await pvReunionService.removePermission(
      req.params.id,
      req.params.userId,
      req.user!.userId,
      req.user!.role
    );
    res.json({ success: true });
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const deletePvReunionPermissionEntry = async (req: AuthRequest, res: Response) => {
  try {
    await pvReunionService.removePermissionByEntryId(
      req.params.id,
      req.params.permissionEntryId,
      req.user!.userId,
      req.user!.role
    );
    res.json({ success: true });
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const postPvReunionAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = (req.body || {}) as { userId?: string };
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await pvReunionService.blockAdminImplicitAccess(req.params.id, userId, req.user!.userId);
    res.status(204).send();
  } catch (e: unknown) {
    handleErr(res, e);
  }
};

export const deletePvReunionAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    await pvReunionService.restoreAdminImplicitAccess(
      req.params.id,
      req.params.userId,
      req.user!.userId
    );
    res.status(204).send();
  } catch (e: unknown) {
    handleErr(res, e);
  }
};
