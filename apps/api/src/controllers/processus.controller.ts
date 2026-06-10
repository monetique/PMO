import { Response } from 'express';
import { ProcessusService } from '../services/processus.service';
import { pvReunionService } from '../services/pv-reunion.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { prisma } from '../utils/prisma';
import { PermissionType } from '../generated/prisma/enums';

const processusService = new ProcessusService();

function authFromReq(req: AuthRequest): { userId: string; role: string } | null {
  if (!req.user?.userId || !req.user?.role) return null;
  return { userId: req.user.userId, role: req.user.role };
}

export const getProcessusCorbeille = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const rows = await processusService.listDeletedForCorbeilleScoped(auth);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getAllProcessus = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const { statut, entiteId, categorieId, search, sortBy, sortOrder } = req.query;
    const processus = await processusService.findAll(
      {
        statut: statut as any,
        entiteId: entiteId as string,
        categorieId: categorieId as string,
        search: search as string,
        sortBy: sortBy as string,
        sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
      },
      auth
    );
    res.json(processus);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getProcessus = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const processus = await processusService.findOne(req.params.id, auth);
    if (!processus) {
      return res.status(404).json({ error: 'Processus non trouvé' });
    }

    const nombreConsultations = await processusService.getConsultationCount(req.params.id);

    await logAccess(req, res, 'lecture', 'processus', processus.id, processus.nom);
    res.json({
      ...processus,
      nombreConsultations,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getProcessusAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await processusService.getAccesDetail(req.params.id, auth);
    res.json(data);
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const addProcessusPermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId, permission } = req.body;
    if (!userId || !permission) return res.status(400).json({ error: 'userId et permission requis' });
    const created = await processusService.addPermission(req.params.id, userId, permission as PermissionType, auth);
    await logAccess(req, res, 'modification', 'processus', req.params.id, undefined, {
      action: 'permission_ajoutee',
      userId,
      permission,
    });
    res.status(201).json(created);
  } catch (e: any) {
    const code = e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const removeProcessusPermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await processusService.removePermission(req.params.id, req.params.permissionId, auth);
    await logAccess(req, res, 'modification', 'processus', req.params.id, undefined, { action: 'permission_retiree' });
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'FORBIDDEN' ? 403 : e.message === 'NOT_FOUND' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const postProcessusAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await processusService.blockAdminImplicitAccess(req.params.id, userId, auth);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const deleteProcessusAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await processusService.restoreAdminImplicitAccess(req.params.id, req.params.userId, auth);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const createProcessus = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const createData: any = { ...req.body };
    if (req.body.entiteIds !== undefined) {
      createData.entiteIds = Array.isArray(req.body.entiteIds)
        ? req.body.entiteIds
        : req.body.entiteIds
          ? [req.body.entiteIds]
          : [];
    }
    if (req.body.categorieIds !== undefined) {
      createData.categorieIds = Array.isArray(req.body.categorieIds)
        ? req.body.categorieIds
        : req.body.categorieIds
          ? [req.body.categorieIds]
          : [];
    }

    let initialPermissions: { userId: string; permission: PermissionType }[] = [];
    if (Array.isArray(req.body.initialPermissions)) {
      initialPermissions = req.body.initialPermissions
        .filter((x: any) => x && typeof x.userId === 'string' && typeof x.permission === 'string')
        .map((x: any) => ({ userId: x.userId, permission: x.permission as PermissionType }));
    }

    const processus = await processusService.create(
      {
        ...createData,
        createdById: req.user!.userId,
        initialPermissions,
      },
      auth
    );
    await logAccess(req, res, 'creation', 'processus', (processus as any).id, (processus as any).nom);
    res.status(201).json(processus);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateProcessus = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    if (auth.role === 'lecteur') {
      return res.status(403).json({ error: 'Les lecteurs ne peuvent pas modifier un processus.' });
    }

    const oldProcessus = await processusService.findOne(req.params.id, auth);
    if (!oldProcessus) {
      return res.status(404).json({ error: 'Processus non trouvé' });
    }

    if (req.body.codeProcessus !== undefined && req.body.codeProcessus !== oldProcessus?.codeProcessus) {
      const canModifyCode = await processusService.canModifyCode(req.params.id, auth.userId, auth.role);
      if (!canModifyCode) {
        return res.status(403).json({
          error:
            'Vous n\'avez pas les permissions pour modifier le code processus. Seuls le super admin, le propriétaire ou le créateur peuvent modifier le code processus.',
        });
      }
    }

    const updateData: any = { ...req.body };
    if (req.body.entiteIds !== undefined) {
      updateData.entiteIds = Array.isArray(req.body.entiteIds)
        ? req.body.entiteIds
        : req.body.entiteIds
          ? [req.body.entiteIds]
          : [];
    }
    if (req.body.categorieIds !== undefined) {
      updateData.categorieIds = Array.isArray(req.body.categorieIds)
        ? req.body.categorieIds
        : req.body.categorieIds
          ? [req.body.categorieIds]
          : [];
    }

    let processus;
    try {
      processus = await processusService.update(req.params.id, updateData, auth);
    } catch (e: any) {
      if (e.message === 'Accès refusé') {
        return res.status(403).json({ error: e.message });
      }
      throw e;
    }

    const details: any = {};
    if (req.body.codeProcessus && oldProcessus?.codeProcessus !== req.body.codeProcessus) {
      details.changementCodeProcessus = {
        ancien: oldProcessus?.codeProcessus,
        nouveau: req.body.codeProcessus,
      };
    }
    const oldTags = (oldProcessus?.tags || []).sort();
    const newTags = (req.body.tags || []).sort();
    if (JSON.stringify(oldTags) !== JSON.stringify(newTags)) {
      details.changementTags = true;
    }
    if (req.body.proprietaireId && oldProcessus?.proprietaireId !== req.body.proprietaireId) {
      details.changementProprietaire = true;
    }
    const oldEntiteIds =
      oldProcessus?.entites?.map((pe: any) => pe.entite?.id || pe.entiteId).sort() || [];
    const newEntiteIds = (updateData.entiteIds || []).sort();
    if (JSON.stringify(oldEntiteIds) !== JSON.stringify(newEntiteIds)) {
      details.changementEntites = true;
    }
    const oldCategorieIds =
      oldProcessus?.categories?.map((pc: any) => pc.categorie?.id || pc.categorieId).sort() || [];
    const newCategorieIds = (updateData.categorieIds || []).sort();
    if (JSON.stringify(oldCategorieIds) !== JSON.stringify(newCategorieIds)) {
      details.changementCategories = true;
    }

    await logAccess(
      req,
      res,
      'modification',
      'processus',
      processus.id,
      processus.nom,
      Object.keys(details).length > 0 ? details : undefined
    );
    res.json(processus);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateProcessusStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { statut } = req.body;
    const processus = await processusService.updateStatus(req.params.id, statut, req.user!.userId);
    await logAccess(req, res, 'modification', 'processus', processus.id, processus.nom, {
      changementStatut: statut,
    });
    res.json(processus);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteProcessus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const canDelete = await processusService.canDelete(req.params.id, req.user.userId, req.user.role);

    if (!canDelete) {
      return res.status(403).json({
        error:
          'Vous n\'avez pas les permissions pour mettre ce processus en corbeille.',
      });
    }

    await processusService.delete(req.params.id);
    await logAccess(req, res, 'suppression', 'processus', req.params.id, undefined, { action: 'corbeille' });
    res.status(204).send();
  } catch (error: any) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Processus non trouvé' });
    }
    res.status(400).json({ error: error.message });
  }
};

export const getProcessusHistory = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const accessCheck = await processusService.canAccess(req.params.id, auth.userId, auth.role);
    if (!accessCheck.canAccess) {
      return res.status(403).json({ error: accessCheck.reason || 'Accès refusé' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const documents = await prisma.document.findMany({
      where: {
        referenceType: 'processus',
        referenceId: req.params.id,
      },
      select: { id: true },
    });
    const documentIds = documents.map((d) => d.id);

    const total = await prisma.journalAcces.count({
      where: {
        OR: [
          {
            ressourceType: 'processus',
            ressourceId: req.params.id,
          },
          {
            ressourceType: 'document',
            ressourceId: { in: documentIds },
          },
        ],
      },
    });

    const history = await prisma.journalAcces.findMany({
      where: {
        OR: [
          {
            ressourceType: 'processus',
            ressourceId: req.params.id,
          },
          {
            ressourceType: 'document',
            ressourceId: { in: documentIds },
          },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
          },
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
      skip,
      take: limit,
    });

    res.json({
      data: history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getProcessusPvReunions = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const processus = await processusService.findOne(req.params.id, auth);
    if (!processus) return res.status(404).json({ error: 'Processus non trouvé' });
    const list = await pvReunionService.listLinkedToProcessus(req.params.id, auth.userId, auth.role);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
