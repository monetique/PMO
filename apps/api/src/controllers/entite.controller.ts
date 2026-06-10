import { Request, Response } from 'express';
import { EntiteService } from '../services/entite.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { prisma } from '../utils/prisma';
import { PermissionType } from '../generated/prisma/enums';

const entiteService = new EntiteService();

function authFromReq(req: AuthRequest): { userId: string; role: string } | null {
  if (!req.user?.userId || !req.user?.role) return null;
  return { userId: req.user.userId, role: req.user.role };
}

export const getAllEntites = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { parentId, typeEntiteId, search, responsableId, sortBy, sortOrder } = req.query;
    const entites = await entiteService.findAll(auth, {
      parentId: parentId as string,
      typeEntiteId: typeEntiteId as string,
      search: search as string,
      responsableId: responsableId as string,
      sortBy: sortBy as string,
      sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
    });
    res.json(entites);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getEntiteTree = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const tree = await entiteService.getTree(auth);
    res.json(tree);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getEntitesCorbeille = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const rows = await entiteService.listDeletedForCorbeilleScoped(auth);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getEntite = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const entite = await entiteService.findOne(req.params.id, auth);
    if (!entite) {
      return res.status(404).json({ error: 'Entité non trouvée' });
    }
    res.json(entite);
    logAccess(req, res, 'lecture', 'entite', entite.id, entite.nom).catch((logError) => {
      console.error('Erreur lors du logging (non bloquant):', logError);
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getEntiteAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await entiteService.getAccesDetail(req.params.id, auth);
    res.json(data);
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const addEntitePermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId, permission } = req.body;
    if (!userId || !permission) return res.status(400).json({ error: 'userId et permission requis' });
    const created = await entiteService.addPermission(req.params.id, userId, permission as PermissionType, auth);
    await logAccess(req, res, 'modification', 'entite', req.params.id, undefined, { action: 'permission_ajoutee', userId, permission });
    res.status(201).json(created);
  } catch (e: any) {
    const code = e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const removeEntitePermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await entiteService.removePermission(req.params.id, req.params.permissionId, auth);
    await logAccess(req, res, 'modification', 'entite', req.params.id, undefined, { action: 'permission_retiree' });
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'FORBIDDEN' ? 403 : e.message === 'NOT_FOUND' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const postEntiteAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await entiteService.blockAdminImplicitAccess(req.params.id, userId, auth);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const deleteEntiteAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await entiteService.restoreAdminImplicitAccess(req.params.id, req.params.userId, auth);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const createEntite = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const createData: any = { ...req.body };
    if (req.body.membreIds !== undefined) {
      createData.membreIds = Array.isArray(req.body.membreIds)
        ? req.body.membreIds
        : req.body.membreIds
          ? [req.body.membreIds]
          : [];
    }

    const entite = await entiteService.create(createData, auth);
    await logAccess(req, res, 'creation', 'entite', entite.id, entite.nom);
    res.status(201).json(entite);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateEntite = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const oldEntite = await entiteService.findOne(req.params.id, auth);

    const updateData: any = { ...req.body };
    if (req.body.membreIds !== undefined) {
      updateData.membreIds = Array.isArray(req.body.membreIds)
        ? req.body.membreIds
        : req.body.membreIds
          ? [req.body.membreIds]
          : [];
    }

    const entite = await entiteService.update(req.params.id, updateData, auth);

    const details: any = {};
    if (oldEntite) {
      if (updateData.nom && updateData.nom !== oldEntite.nom) {
        details.changementNom = updateData.nom;
      }
      if (updateData.typeEntiteId && updateData.typeEntiteId !== oldEntite.typeEntiteId) {
        details.changementType = true;
      }
      if (updateData.responsableId !== undefined && updateData.responsableId !== oldEntite.responsableId) {
        details.changementResponsable = true;
      }
      if (updateData.parentId !== undefined && updateData.parentId !== oldEntite.parentId) {
        details.changementParent = true;
      }
      const oldMembreIds = oldEntite.membres?.map((m: any) => m.user?.id || m.userId).sort() || [];
      const newMembreIds = (updateData.membreIds || []).sort();
      if (JSON.stringify(oldMembreIds) !== JSON.stringify(newMembreIds)) {
        details.changementMembres = true;
      }
    }

    await logAccess(req, res, 'modification', 'entite', entite.id, entite.nom, Object.keys(details).length > 0 ? details : undefined);
    res.json(entite);
  } catch (error: any) {
    const code = error.message === 'Entité non trouvée' ? 404 : error.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const deleteEntite = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await entiteService.softDelete(req.params.id, auth);
    await logAccess(req, res, 'suppression', 'entite', req.params.id, undefined, { action: 'corbeille' });
    res.status(204).send();
  } catch (error: any) {
    const code = error.message === 'Entité non trouvée' ? 404 : error.message === 'Accès refusé' ? 403 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const getEntiteHistory = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const entite = await prisma.entite.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: { id: true, createdById: true, responsableId: true },
    });
    if (!entite) return res.status(404).json({ error: 'Entité non trouvée' });

    const permRows = await prisma.permission.findMany({
      where: { ressourceType: 'entite', ressourceId: req.params.id, userId: auth.userId },
      select: { permission: true },
    });
    const permTypes = permRows.map((r) => r.permission);
    const isMembre = await prisma.userEntite.findFirst({ where: { entiteId: req.params.id, userId: auth.userId } });
    const canView =
      auth.role === 'admin' ||
      entite.createdById == null ||
      entite.createdById === auth.userId ||
      entite.responsableId === auth.userId ||
      !!isMembre ||
      permTypes.length > 0;
    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const total = await prisma.journalAcces.count({
      where: {
        ressourceType: 'entite',
        ressourceId: req.params.id,
      },
    });

    const history = await prisma.journalAcces.findMany({
      where: {
        ressourceType: 'entite',
        ressourceId: req.params.id,
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
