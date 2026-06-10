import { Response } from 'express';
import { UserService } from '../services/user.service';
import { UserAccessSyntheseService } from '../services/userAccessSynthese.service';
import { setUserUiModuleOverride } from '../services/userUiModule.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import { prisma } from '../utils/prisma';
import { ResourceType, UiModule, UiModuleLevel } from '../generated/prisma/enums';

const userService = new UserService();
const userAccessSyntheseService = new UserAccessSyntheseService();

const UI_MODULE_VALUES = new Set<string>(Object.values(UiModule));
const UI_LEVEL_VALUES = new Set<string>(Object.values(UiModuleLevel));

export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const { role, entiteId, statut, search, nom, email, sortBy, sortOrder } = req.query;
    const users = await userService.findAll({
      role: role as any,
      entiteId: entiteId as string,
      statut: statut as any,
      search: search as string,
      nom: nom as string,
      email: email as string,
      sortBy: sortBy as string,
      sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
      requesterId: req.user.userId,
      requesterRole: req.user.role,
    });
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getUser = async (req: AuthRequest, res: Response) => {
  try {
    const user = await userService.findOne(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    // Log de consultation (non bloquant)
    logAccess(req, res, 'lecture', 'utilisateur', user.id, `${user.prenom} ${user.nom}`).catch(() => {});
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  try {
    const user = await userService.create(req.body);
    await logAccess(req, res, 'creation', 'utilisateur', user.id, `${user.prenom} ${user.nom}`);
    res.status(201).json(user);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const user = await userService.update(req.params.id, req.body);
    await logAccess(req, res, 'modification', 'utilisateur', user.id, `${user.prenom} ${user.nom}`);
    res.json(user);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateUserPassword = async (req: AuthRequest, res: Response) => {
  try {
    await userService.updatePassword(req.params.id, req.body.password);
    await logAccess(req, res, 'modification', 'utilisateur', req.params.id, undefined, {
      action: 'changement_mot_de_passe',
    });
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    await userService.delete(req.params.id);
    await logAccess(req, res, 'suppression', 'utilisateur', req.params.id);
    res.status(204).send();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const getUserAccessSynthese = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    const data = await userAccessSyntheseService.build(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const patchUserUiModule = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    const { module, level } = req.body as { module?: string; level?: string | null };
    if (!module || !UI_MODULE_VALUES.has(module)) {
      return res.status(400).json({ error: 'Module invalide' });
    }
    if (level !== null && level !== undefined && !UI_LEVEL_VALUES.has(level)) {
      return res.status(400).json({ error: 'Niveau invalide' });
    }
    const lvl =
      level === null || level === undefined || level === ''
        ? null
        : (level as UiModuleLevel);
    await setUserUiModuleOverride(req.params.id, module as UiModule, lvl);
    await logAccess(req, res, 'modification', ResourceType.utilisateur, req.params.id, undefined, {
      action: 'ui_module',
      module,
      level: lvl,
    });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteUserPermissionDelegation = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    const { id: userId, permId } = req.params;
    const row = await prisma.permission.findFirst({
      where: { id: permId, userId },
    });
    if (!row) {
      return res.status(404).json({ error: 'Délégation introuvable' });
    }
    await prisma.permission.delete({ where: { id: permId } });
    await logAccess(req, res, 'suppression', ResourceType.utilisateur, userId, undefined, {
      action: 'retrait_permission_deleguee',
      permissionId: permId,
      ressourceType: row.ressourceType,
      ressourceId: row.ressourceId,
    });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteUserDocumentPermission = async (req: AuthRequest, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    const { id: userId, permId } = req.params;
    const row = await prisma.documentPermission.findFirst({
      where: { id: permId, userId },
    });
    if (!row) {
      return res.status(404).json({ error: 'Permission document introuvable' });
    }
    await prisma.documentPermission.delete({ where: { id: permId } });
    await logAccess(req, res, 'suppression', ResourceType.document, row.documentId, undefined, {
      action: 'retrait_acces_utilisateur',
      userId,
    });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
