import { Response } from 'express';
import { Role } from '../generated/prisma/enums';
import { typeSocieteService, clientFournisseurService } from '../services/client-fournisseur.service';
import { contratService } from '../services/contrat.service';
import { AuthRequest } from '../middleware/auth';

function authFromReq(req: AuthRequest): { userId: string; role: Role } | null {
  if (!req.user?.userId || !req.user.role) return null;
  return { userId: req.user.userId, role: req.user.role as Role };
}

function handleCfError(res: Response, e: any) {
  const msg = e?.message || String(e);
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'Non trouvé' });
    if (msg === 'FORBIDDEN') return res.status(403).json({ error: 'Accès refusé' });
    if (
      msg === 'BAD_INPUT' ||
      msg.startsWith('Les administrateurs') ||
      msg.startsWith('Le créateur') ||
      msg.startsWith('Impossible')
    ) {
      return res.status(400).json({ error: msg });
    }
  if (e?.code === 'P2002') return res.status(409).json({ error: 'Ce droit est déjà accordé pour cet utilisateur' });
  return res.status(500).json({ error: msg });
}

// Types de société
export const getTypesSociete = async (req: AuthRequest, res: Response) => {
  try {
    const types = await typeSocieteService.findAll();
    res.json(types);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
export const createTypeSociete = async (req: AuthRequest, res: Response) => {
  try {
    const type = await typeSocieteService.create(req.body);
    res.status(201).json(type);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
export const updateTypeSociete = async (req: AuthRequest, res: Response) => {
  try {
    const type = await typeSocieteService.update(req.params.id, req.body);
    res.json(type);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
export const deleteTypeSociete = async (req: AuthRequest, res: Response) => {
  try {
    await typeSocieteService.delete(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

// Clients / Fournisseurs
export const getClientsFournisseurs = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { type, search } = req.query;
    const data = await clientFournisseurService.findAll(type as string, search as string, auth);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getClientsFournisseursCorbeille = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const rows = await clientFournisseurService.listDeletedForCorbeilleScoped(auth);
    res.json(rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getClientFournisseur = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await clientFournisseurService.findOne(req.params.id, auth);
    if (!data) return res.status(404).json({ error: 'Non trouvé' });
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const getClientFournisseurAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await clientFournisseurService.getAccesDetail(req.params.id, auth);
    res.json(data);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const getClientFournisseurHistorique = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await clientFournisseurService.getHistorique(req.params.id, auth);
    res.json(data);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

const PERMISSION_TYPES = ['lecture', 'modification', 'suppression', 'gestion'] as const;

export const addClientFournisseurPermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId: targetUserId, permission } = req.body as { userId?: string; permission?: string };
    if (!targetUserId || !permission) return res.status(400).json({ error: 'userId et permission requis' });
    if (!PERMISSION_TYPES.includes(permission as any)) {
      return res.status(400).json({ error: 'permission invalide' });
    }
    const created = await clientFournisseurService.addDelegation(req.params.id, targetUserId, permission as any, auth);
    res.status(201).json(created);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const removeClientFournisseurPermission = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await clientFournisseurService.removeDelegation(req.params.id, req.params.permissionId, auth);
    res.json({ success: true });
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const postClientFournisseurAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await clientFournisseurService.blockAdminImplicitAccess(req.params.id, userId, auth);
    res.status(204).end();
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const deleteClientFournisseurAdminSansAcces = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await clientFournisseurService.restoreAdminImplicitAccess(req.params.id, req.params.userId, auth);
    res.status(204).end();
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const createClientFournisseur = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await clientFournisseurService.create(req.body, auth);
    res.status(201).json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const updateClientFournisseur = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await clientFournisseurService.update(req.params.id, req.body, auth);
    res.json(data);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const deleteClientFournisseur = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await clientFournisseurService.softDelete(req.params.id, auth);
    res.json({ success: true });
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

// Représentants légaux
export const addRepresentant = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await clientFournisseurService.addRepresentant(req.params.id, req.body, auth);
    res.status(201).json(data);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const updateRepresentant = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const data = await clientFournisseurService.updateRepresentant(req.params.id, req.params.repId, req.body, auth);
    res.json(data);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const deleteRepresentant = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await clientFournisseurService.deleteRepresentant(req.params.id, req.params.repId, auth);
    res.json({ success: true });
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const linkContratClientFournisseur = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { contratId } = req.body as { contratId?: string };
    if (!contratId) return res.status(400).json({ error: 'contratId requis' });
    const user = req.user!;
    const contrat = await contratService.findOne(contratId, user.userId!, user.role!);
    if (!contrat) return res.status(403).json({ error: 'Contrat introuvable ou accès refusé' });
    const row = await clientFournisseurService.linkContrat(req.params.id, contratId, auth);
    res.status(201).json(row);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const unlinkContratClientFournisseur = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const user = req.user!;
    const contrat = await contratService.findOne(req.params.contratId, user.userId!, user.role!);
    if (!contrat) return res.status(403).json({ error: 'Contrat introuvable ou accès refusé' });
    await clientFournisseurService.unlinkContrat(req.params.id, req.params.contratId, auth);
    res.json({ success: true });
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const addProjet = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    const { projetId } = req.body as { projetId?: string };
    if (!projetId) return res.status(400).json({ error: 'projetId requis' });
    const data = await clientFournisseurService.addProjet(req.params.id, projetId, auth);
    res.status(201).json(data);
  } catch (e: any) {
    return handleCfError(res, e);
  }
};

export const removeProjet = async (req: AuthRequest, res: Response) => {
  try {
    const auth = authFromReq(req);
    if (!auth) return res.status(401).json({ error: 'Non authentifié' });
    await clientFournisseurService.removeProjet(req.params.id, req.params.projetId, auth);
    res.json({ success: true });
  } catch (e: any) {
    return handleCfError(res, e);
  }
};
