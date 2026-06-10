import { Response } from 'express';
import { ProjetService } from '../services/projet.service';
import { pvReunionService } from '../services/pv-reunion.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { prisma } from '../utils/prisma';
import { PermissionType } from '../generated/prisma/enums';

const projetService = new ProjetService();

function authFromReq(req: AuthRequest): { userId: string; role: string } | null {
  if (!req.user?.userId || !req.user?.role) return null;
  return { userId: req.user.userId, role: req.user.role };
}

export const getAllProjets = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const { statut, entiteId, search, nom, sortBy, sortOrder, priorite, type, periodeDebut, periodeFin } = req.query;
    const searchVal = (search as string) || (nom as string) || undefined;

    const projets = await projetService.findAll(
      {
        statut: statut as string,
        entiteId: entiteId as string,
        search: searchVal,
        sortBy: sortBy as string,
        sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
        priorite: priorite as string,
        type: type as string,
        periodeDebut: periodeDebut as string,
        periodeFin: periodeFin as string,
      },
      auth
    );
    res.json(projets);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getProjetsCorbeille = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifi' });
    const rows = await projetService.listDeletedForCorbeilleScoped(auth);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getProjet = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const projet = await projetService.findOne(req.params.id, auth);
    if (!projet) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    const nombreConsultations = await projetService.getConsultationCount(req.params.id);

    await logAccess(req, res, 'lecture', 'projet', projet.id, projet.nom);
    res.json({
      ...projet,
      nombreConsultations,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getProjetScoring = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const scoring = await projetService.getProjetScoring(req.params.id, auth);
    res.json(scoring);
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const getProjetAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await projetService.getAccesDetail(req.params.id, auth);
    res.json(data);
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const addProjetPermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId, permission } = req.body;
    if (!userId || !permission) return res.status(400).json({ error: 'userId et permission requis' });
    const created = await projetService.addPermission(req.params.id, userId, permission as PermissionType, auth);
    await logAccess(req, res, 'modification', 'projet', req.params.id, undefined, {
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

export const removeProjetPermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await projetService.removePermission(req.params.id, req.params.permissionId, auth);
    await logAccess(req, res, 'modification', 'projet', req.params.id, undefined, { action: 'permission_retiree' });
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'FORBIDDEN' ? 403 : e.message === 'NOT_FOUND' ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const postProjetAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await projetService.blockAdminImplicitAccess(req.params.id, userId, auth);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const deleteProjetAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await projetService.restoreAdminImplicitAccess(req.params.id, req.params.userId, auth);
    res.status(204).end();
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const createProjet = async (req: AuthRequest, res: Response) => {
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
    if (req.body.tags !== undefined) {
      createData.tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    }

    const projet = await projetService.create(createData, auth);
    await logAccess(req, res, 'creation', 'projet', projet.id, projet.nom);
    res.status(201).json(projet);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateProjet = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const oldProjet = await projetService.findOne(req.params.id, auth);
    if (!oldProjet) {
      return res.status(404).json({ error: 'Projet non trouvé' });
    }

    const updateData: any = { ...req.body };
    if (req.body.entiteIds !== undefined) {
      updateData.entiteIds = Array.isArray(req.body.entiteIds)
        ? req.body.entiteIds
        : req.body.entiteIds
          ? [req.body.entiteIds]
          : [];
    }
    if (req.body.tags !== undefined) {
      updateData.tags = Array.isArray(req.body.tags) ? req.body.tags : [];
    }

    const projet = await projetService.update(req.params.id, updateData, auth);

    const details: any = {};
    if (req.body.tags && JSON.stringify(oldProjet?.tags || []) !== JSON.stringify(req.body.tags)) {
      details.anciensTags = oldProjet?.tags || [];
      details.nouveauxTags = req.body.tags;
    }
    const oldEntiteIds = oldProjet?.entites?.map((pe: any) => pe.entite?.id || pe.entiteId).sort() || [];
    const newEntiteIds = (updateData.entiteIds || []).sort();
    if (JSON.stringify(oldEntiteIds) !== JSON.stringify(newEntiteIds)) {
      details.changementEntites = true;
    }

    await logAccess(
      req,
      res,
      'modification',
      'projet',
      projet.id,
      projet.nom,
      Object.keys(details).length > 0 ? details : undefined
    );
    res.json(projet);
  } catch (error: any) {
    const code = error.message === 'Accès refusé' ? 403 : error.message === 'Projet non trouvé' ? 404 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const deleteProjet = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    await projetService.softDelete(req.params.id, auth);
    await logAccess(req, res, 'suppression', 'projet', req.params.id, undefined, { action: 'corbeille' });
    res.status(204).send();
  } catch (error: any) {
    const code = error.message === 'Accès refusé' ? 403 : error.message === 'Projet non trouvé' ? 404 : 400;
    res.status(code).json({ error: error.message });
  }
};

export const getProjetHistory = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });

    const projet = await prisma.projet.findFirst({
      where: { id: req.params.id, deletedAt: null },
      select: {
        id: true,
        createdById: true,
        responsableId: true,
        gestionnaireId: true,
        sponsors: { select: { userId: true } },
        chefsProjet: { select: { userId: true } },
        techLeads: { select: { userId: true } },
        equipe: { select: { userId: true } },
      },
    });
    if (!projet) return res.status(404).json({ error: 'Projet non trouvé' });

    const permRows = await prisma.permission.findMany({
      where: { ressourceType: 'projet', ressourceId: req.params.id, userId: auth.userId },
      select: { permission: true },
    });
    const permTypes = permRows.map((r) => r.permission);
    const sponsors = projet.sponsors ?? [];
    const chefsProjet = projet.chefsProjet ?? [];
    const techLeads = projet.techLeads ?? [];
    const equipe = projet.equipe ?? [];
    const gov =
      projet.responsableId === auth.userId ||
      projet.gestionnaireId === auth.userId ||
      sponsors.some((s) => s.userId === auth.userId) ||
      chefsProjet.some((c) => c.userId === auth.userId) ||
      techLeads.some((t) => t.userId === auth.userId) ||
      equipe.some((e) => e.userId === auth.userId);

    const canView =
      auth.role === 'admin' ||
      projet.createdById == null ||
      projet.createdById === auth.userId ||
      gov ||
      permTypes.length > 0;

    if (!canView) return res.status(403).json({ error: 'Accès refusé' });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const total = await prisma.journalAcces.count({
      where: {
        ressourceType: 'projet',
        ressourceId: req.params.id,
      },
    });

    const history = await prisma.journalAcces.findMany({
      where: {
        ressourceType: 'projet',
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

export const getProjetPvReunions = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const projet = await projetService.findOne(req.params.id, auth);
    if (!projet) return res.status(404).json({ error: 'Projet non trouvé' });
    const list = await pvReunionService.listLinkedToProjet(req.params.id, auth.userId, auth.role);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
