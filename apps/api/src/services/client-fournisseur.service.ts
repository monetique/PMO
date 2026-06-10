import { prisma } from '../utils/prisma';
import { PermissionType } from '../generated/prisma/enums';
import {
  capabilitiesFor,
  canManageCfPermissions,
  canModifyCf,
  canDeleteCf,
  canViewCf,
  CfAuth,
  isAdminRole,
  isLegacyOpen,
} from './client-fournisseur-access';
import { fetchCfAdminExcludedByCfIds, fetchCfAdminExcludedForUser } from '../utils/resourceAdminSansAcces';

function parseRepresentantDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const iso = s.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00.000Z` : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function optionalTrimmedString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function isCfAdminImplicitRefused(cfId: string, viewerUserId: string): Promise<boolean> {
  const s = await fetchCfAdminExcludedForUser(viewerUserId, [cfId]);
  return s.has(cfId);
}

async function maybeExcludeAdminAfterCfPermissionRemoved(
  cfId: string,
  cfCreatedById: string | null,
  targetUserId: string
) {
  if (targetUserId === cfCreatedById) return;
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
  if (u?.role !== 'admin') return;
  const remaining = await prisma.permission.count({
    where: { ressourceType: 'clientFournisseur', ressourceId: cfId, userId: targetUserId },
  });
  if (remaining > 0) return;
  try {
    await prisma.clientFournisseurAdminSansAcces.upsert({
      where: { clientFournisseurId_userId: { clientFournisseurId: cfId, userId: targetUserId } },
      create: { clientFournisseurId: cfId, userId: targetUserId },
      update: {},
    });
  } catch {
    /* table absente */
  }
}

async function assertRepresentantBelongsToClient(repId: string, clientFournisseurId: string) {
  const rep = await prisma.representantLegal.findFirst({
    where: { id: repId, clientFournisseurId },
    select: { id: true },
  });
  if (!rep) throw new Error('Représentant introuvable pour cette fiche');
}

const cfAclSelect = { id: true, createdById: true, deletedAt: true } as const;

async function getCfAclRow(id: string) {
  return prisma.clientFournisseur.findFirst({
    where: { id, deletedAt: null },
    select: cfAclSelect,
  });
}

async function getCfAclRowAllowDeleted(id: string) {
  return prisma.clientFournisseur.findUnique({
    where: { id },
    select: cfAclSelect,
  });
}

async function myPermTypesForCf(cfId: string, userId: string): Promise<PermissionType[]> {
  const rows = await prisma.permission.findMany({
    where: {
      ressourceType: 'clientFournisseur',
      ressourceId: cfId,
      userId,
    },
    select: { permission: true },
  });
  return rows.map((r) => r.permission);
}

async function myPermTypesForCfs(cfIds: string[], userId: string): Promise<Map<string, PermissionType[]>> {
  const map = new Map<string, PermissionType[]>();
  if (cfIds.length === 0) return map;
  const rows = await prisma.permission.findMany({
    where: {
      ressourceType: 'clientFournisseur',
      ressourceId: { in: cfIds },
      userId,
    },
    select: { ressourceId: true, permission: true },
  });
  for (const r of rows) {
    const arr = map.get(r.ressourceId) ?? [];
    arr.push(r.permission);
    map.set(r.ressourceId, arr);
  }
  return map;
}

/** Tous les utilisateurs ayant au moins une permission explicite sur chaque fiche (pour affichage liste). */
async function allDelegationsByCf(cfIds: string[]) {
  type Entry = {
    user: { id: string; nom: string; prenom: string; email: string; role: string };
    permissions: PermissionType[];
  };
  const map = new Map<string, Map<string, Entry>>();
  if (cfIds.length === 0) return map;
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'clientFournisseur', ressourceId: { in: cfIds } },
    include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const r of rows) {
    const cfId = r.ressourceId;
    let um = map.get(cfId);
    if (!um) {
      um = new Map();
      map.set(cfId, um);
    }
    const ex = um.get(r.userId);
    if (ex) {
      if (!ex.permissions.includes(r.permission)) ex.permissions.push(r.permission);
    } else {
      um.set(r.userId, { user: r.user, permissions: [r.permission] });
    }
  }
  return map;
}

export async function logCfHistory(
  clientFournisseurId: string,
  userId: string,
  typeEvenement: string,
  libelle?: string | null,
  details?: object
) {
  await prisma.clientFournisseurHistorique.create({
    data: {
      clientFournisseurId,
      userId,
      typeEvenement,
      libelle: libelle ?? null,
      details: details === undefined ? undefined : (details as object),
    },
  });
}

export const typeSocieteService = {
  async findAll() {
    return prisma.typeSociete.findMany({ orderBy: { nom: 'asc' } });
  },
  async create(data: { nom: string; description?: string }) {
    return prisma.typeSociete.create({ data });
  },
  async update(id: string, data: { nom?: string; description?: string; actif?: boolean }) {
    return prisma.typeSociete.update({ where: { id }, data });
  },
  async delete(id: string) {
    return prisma.typeSociete.delete({ where: { id } });
  },
};

async function attachContratsLies<T extends { id: string }>(clients: T[]) {
  if (clients.length === 0) return clients as (T & { contratsLies: { id: string; nom: string; statut: string }[] })[];
  const ids = clients.map((c) => c.id);
  const liens = await prisma.contratPartiePrenante.findMany({
    where: { clientFournisseurId: { in: ids } },
    include: { contrat: { select: { id: true, nom: true, statut: true } } },
  });
  const map = new Map<string, { id: string; nom: string; statut: string }[]>();
  for (const l of liens) {
    const cfId = l.clientFournisseurId;
    if (!cfId || !l.contrat) continue;
    const arr = map.get(cfId) ?? [];
    arr.push({ id: l.contrat.id, nom: l.contrat.nom, statut: l.contrat.statut });
    map.set(cfId, arr);
  }
  return clients.map((c) => ({
    ...c,
    contratsLies: map.get(c.id) ?? [],
  })) as (T & { contratsLies: { id: string; nom: string; statut: string }[] })[];
}

function enrichWithCapabilities<T extends { id: string; createdById: string | null }>(
  rows: T[],
  auth: CfAuth,
  permMap: Map<string, PermissionType[]>,
  adminExcludedForViewer: Set<string>,
  adminExclAll: Map<string, string[]>
) {
  return rows
    .filter((row) => {
      const perms = permMap.get(row.id) ?? [];
      return canViewCf(row, auth, perms, adminExcludedForViewer.has(row.id));
    })
    .map((row) => {
      const perms = permMap.get(row.id) ?? [];
      return {
        ...row,
        adminSansAccesUserIds: adminExclAll.get(row.id) ?? [],
        capabilities: capabilitiesFor(row, auth, perms, adminExcludedForViewer.has(row.id)),
      };
    });
}

export const clientFournisseurService = {
  async findAll(type: string | undefined, search: string | undefined, auth: CfAuth) {
    const rows = await prisma.clientFournisseur.findMany({
      where: {
        deletedAt: null,
        ...(type ? { type } : {}),
        ...(search ? { nom: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: {
        typeSociete: true,
        representants: { orderBy: { createdAt: 'asc' } },
        projets: { include: { projet: { select: { id: true, nom: true, codeProjet: true } } } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
      },
      orderBy: { nom: 'asc' },
    });
    const permMap = await myPermTypesForCfs(
      rows.map((r) => r.id),
      auth.userId
    );
    const adminExcludedViewer = await fetchCfAdminExcludedForUser(
      auth.userId,
      rows.map((r) => r.id)
    );
    const adminExclAll = await fetchCfAdminExcludedByCfIds(rows.map((r) => r.id));
    const filtered = enrichWithCapabilities(
      rows.map((r) => ({ ...r, createdById: r.createdById })),
      auth,
      permMap,
      adminExcludedViewer,
      adminExclAll
    );
    const delMap = await allDelegationsByCf(filtered.map((r) => r.id));
    const withAcces = filtered.map((r) => ({
      ...r,
      accesApercu: {
        delegations: Array.from(delMap.get(r.id)?.values() ?? []).map((d) => ({
          user: d.user,
          permissions: d.permissions,
        })),
      },
    }));
    return attachContratsLies(withAcces);
  },

  async findOne(id: string, auth: CfAuth) {
    const row = await prisma.clientFournisseur.findFirst({
      where: { id, deletedAt: null },
      include: {
        typeSociete: true,
        representants: { orderBy: { createdAt: 'asc' } },
        projets: { include: { projet: { select: { id: true, nom: true, codeProjet: true } } } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
      },
    });
    if (!row) return null;
    const perms = await myPermTypesForCf(id, auth.userId);
    const acl = { id: row.id, createdById: row.createdById };
    const adminExcl = await fetchCfAdminExcludedForUser(auth.userId, [id]);
    const adminImplicitRefused = adminExcl.has(id);
    if (!canViewCf(acl, auth, perms, adminImplicitRefused)) return null;
    const delMap = await allDelegationsByCf([row.id]);
    const delegations = Array.from(delMap.get(row.id)?.values() ?? []).map((d) => ({
      user: d.user,
      permissions: d.permissions,
    }));
    const adminExclAll = await fetchCfAdminExcludedByCfIds([id]);
    const [withContrats] = await attachContratsLies([
      {
        ...row,
        adminSansAccesUserIds: adminExclAll.get(id) ?? [],
        capabilities: capabilitiesFor(acl, auth, perms, adminImplicitRefused),
        accesApercu: { delegations },
      },
    ]);
    return withContrats;
  },

  async create(data: any, auth: CfAuth) {
    const { representants, projetIds, ...rest } = data;
    const row = await prisma.clientFournisseur.create({
      data: {
        ...rest,
        createdById: auth.userId,
        representants: representants?.length ? { create: representants } : undefined,
        projets: projetIds?.length ? { create: projetIds.map((pid: string) => ({ projetId: pid })) } : undefined,
      },
      include: { typeSociete: true, representants: true, projets: { include: { projet: true } }, createdBy: true },
    });
    await logCfHistory(row.id, auth.userId, 'creation', `Fiche créée : ${row.nom}`);
    const [out] = await attachContratsLies([
      {
        ...row,
        capabilities: capabilitiesFor({ id: row.id, createdById: row.createdById }, auth, [], false),
      },
    ]);
    return out;
  },

  async update(id: string, data: any, auth: CfAuth) {
    const existing = await prisma.clientFournisseur.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        createdById: true,
        type: true,
        nom: true,
        typeSocieteId: true,
        matriculeFiscale: true,
        adresse: true,
        pays: true,
      },
    });
    if (!existing) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(id, auth.userId);
    const excl = await fetchCfAdminExcludedForUser(auth.userId, [id]);
    if (!canModifyCf(existing, auth, perms, excl.has(id))) throw new Error('FORBIDDEN');

    const { representants, projetIds, ...rest } = data;
    if (projetIds !== undefined) {
      await prisma.clientFournisseurProjet.deleteMany({ where: { clientFournisseurId: id } });
      if (projetIds.length > 0) {
        await prisma.clientFournisseurProjet.createMany({
          data: projetIds.map((projetId: string) => ({ clientFournisseurId: id, projetId })),
          skipDuplicates: true,
        });
      }
    }
    const row = await prisma.clientFournisseur.update({
      where: { id },
      data: rest,
      include: { typeSociete: true, representants: true, projets: { include: { projet: true } }, createdBy: true },
    });

    const changes: Record<string, { avant: unknown; apres: unknown }> = {};
    const keys = ['type', 'nom', 'typeSocieteId', 'matriculeFiscale', 'adresse', 'pays'] as const;
    for (const k of keys) {
      if (rest[k] !== undefined && (existing as any)[k] !== rest[k]) {
        changes[k] = { avant: (existing as any)[k], apres: rest[k] };
      }
    }
    if (Object.keys(changes).length > 0) {
      await logCfHistory(id, auth.userId, 'modification_champs', 'Champs de la fiche modifiés', { changes });
    }

    const [out] = await attachContratsLies([
      {
        ...row,
        capabilities: capabilitiesFor({ id: row.id, createdById: row.createdById }, auth, perms, excl.has(id)),
      },
    ]);
    return out;
  },

  /** Mise en corbeille (soft delete). */
  async softDelete(id: string, auth: CfAuth) {
    const existing = await getCfAclRow(id);
    if (!existing) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(id, auth.userId);
    const exclDel = await fetchCfAdminExcludedForUser(auth.userId, [id]);
    if (!canDeleteCf(existing, auth, perms, exclDel.has(id))) throw new Error('FORBIDDEN');
    const row = await prisma.clientFournisseur.findUnique({
      where: { id },
      select: { nom: true },
    });
    await prisma.clientFournisseur.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await logCfHistory(id, auth.userId, 'soft_delete', `Fiche mise en corbeille : ${row?.nom ?? id}`);
  },

  async addRepresentant(clientFournisseurId: string, raw: any, auth: CfAuth) {
    const cf = await getCfAclRow(clientFournisseurId);
    if (!cf) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(clientFournisseurId, auth.userId);
    if (!canModifyCf(cf, auth, perms, await isCfAdminImplicitRefused(clientFournisseurId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }

    const nom = String(raw?.nom ?? '').trim();
    const prenom = String(raw?.prenom ?? '').trim();
    if (!nom || !prenom) {
      throw new Error('Le nom et le prénom sont obligatoires');
    }

    const statut = raw?.statut === 'fin_exercice' ? 'fin_exercice' : 'en_exercice';
    const fonctionRaw = raw?.fonction;
    const fonction =
      fonctionRaw === null || fonctionRaw === undefined || String(fonctionRaw).trim() === ''
        ? null
        : String(fonctionRaw).trim();

    const rep = await prisma.representantLegal.create({
      data: {
        clientFournisseurId,
        nom,
        prenom,
        fonction,
        email: optionalTrimmedString(raw?.email),
        telephone: optionalTrimmedString(raw?.telephone),
        statut,
        dateDebut: parseRepresentantDate(raw?.dateDebut),
        dateFin: parseRepresentantDate(raw?.dateFin),
      },
    });
    await logCfHistory(clientFournisseurId, auth.userId, 'representant_ajout', `Représentant ajouté : ${prenom} ${nom}`);
    return rep;
  },

  async updateRepresentant(clientFournisseurId: string, repId: string, raw: any, auth: CfAuth) {
    const cf = await getCfAclRow(clientFournisseurId);
    if (!cf) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(clientFournisseurId, auth.userId);
    if (!canModifyCf(cf, auth, perms, await isCfAdminImplicitRefused(clientFournisseurId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }
    await assertRepresentantBelongsToClient(repId, clientFournisseurId);

    const data: {
      nom?: string;
      prenom?: string;
      fonction?: string | null;
      email?: string | null;
      telephone?: string | null;
      statut?: string;
      dateDebut?: Date | null;
      dateFin?: Date | null;
    } = {};

    if (raw.nom !== undefined) data.nom = String(raw.nom).trim();
    if (raw.prenom !== undefined) data.prenom = String(raw.prenom).trim();
    if (raw.fonction !== undefined) {
      const f = String(raw.fonction ?? '').trim();
      data.fonction = f === '' ? null : f;
    }
    if (raw.email !== undefined) data.email = optionalTrimmedString(raw.email);
    if (raw.telephone !== undefined) data.telephone = optionalTrimmedString(raw.telephone);
    if (raw.statut !== undefined) {
      data.statut = raw.statut === 'fin_exercice' ? 'fin_exercice' : 'en_exercice';
    }
    if (raw.dateDebut !== undefined) data.dateDebut = parseRepresentantDate(raw.dateDebut);
    if (raw.dateFin !== undefined) data.dateFin = parseRepresentantDate(raw.dateFin);

    if (
      (data.nom !== undefined && data.nom === '') ||
      (data.prenom !== undefined && data.prenom === '')
    ) {
      throw new Error('Le nom et le prénom ne peuvent pas être vides');
    }

    const updated = await prisma.representantLegal.update({ where: { id: repId }, data });
    await logCfHistory(clientFournisseurId, auth.userId, 'representant_modification', `Représentant modifié : ${updated.prenom} ${updated.nom}`, { representantId: repId });
    return updated;
  },

  async deleteRepresentant(clientFournisseurId: string, repId: string, auth: CfAuth) {
    const cf = await getCfAclRow(clientFournisseurId);
    if (!cf) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(clientFournisseurId, auth.userId);
    if (!canModifyCf(cf, auth, perms, await isCfAdminImplicitRefused(clientFournisseurId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }
    await assertRepresentantBelongsToClient(repId, clientFournisseurId);
    const rep = await prisma.representantLegal.findUnique({ where: { id: repId } });
    await prisma.representantLegal.delete({ where: { id: repId } });
    if (rep) {
      await logCfHistory(clientFournisseurId, auth.userId, 'representant_suppression', `Représentant supprimé : ${rep.prenom} ${rep.nom}`);
    }
  },

  async linkContrat(clientFournisseurId: string, contratId: string, auth: CfAuth) {
    const cf = await getCfAclRow(clientFournisseurId);
    if (!cf) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(clientFournisseurId, auth.userId);
    if (!canModifyCf(cf, auth, perms, await isCfAdminImplicitRefused(clientFournisseurId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }

    const cfRow = await prisma.clientFournisseur.findUnique({ where: { id: clientFournisseurId } });
    if (!cfRow) throw new Error('Client / fournisseur introuvable');
    const existing = await prisma.contratPartiePrenante.findFirst({
      where: { contratId, clientFournisseurId },
    });
    if (existing) return existing;
    const row = await prisma.contratPartiePrenante.create({
      data: {
        contratId,
        nom: cfRow.nom,
        clientFournisseurId,
      },
    });
    const c = await prisma.contrat.findUnique({ where: { id: contratId }, select: { nom: true } });
    await logCfHistory(clientFournisseurId, auth.userId, 'contrat_lie', `Contrat lié : ${c?.nom ?? contratId}`);
    return row;
  },

  async unlinkContrat(clientFournisseurId: string, contratId: string, auth: CfAuth) {
    const cf = await getCfAclRow(clientFournisseurId);
    if (!cf) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(clientFournisseurId, auth.userId);
    if (!canModifyCf(cf, auth, perms, await isCfAdminImplicitRefused(clientFournisseurId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }
    const c = await prisma.contrat.findUnique({ where: { id: contratId }, select: { nom: true } });
    await prisma.contratPartiePrenante.deleteMany({
      where: { contratId, clientFournisseurId },
    });
    await logCfHistory(clientFournisseurId, auth.userId, 'contrat_delie', `Contrat retiré : ${c?.nom ?? contratId}`);
  },

  async addProjet(clientFournisseurId: string, projetId: string, auth: CfAuth) {
    const cf = await getCfAclRow(clientFournisseurId);
    if (!cf) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(clientFournisseurId, auth.userId);
    if (!canModifyCf(cf, auth, perms, await isCfAdminImplicitRefused(clientFournisseurId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }
    const data = await prisma.clientFournisseurProjet.create({
      data: { clientFournisseurId, projetId },
      include: { projet: { select: { nom: true, codeProjet: true } } },
    });
    await logCfHistory(
      clientFournisseurId,
      auth.userId,
      'projet_lie',
      `Projet lié : ${data.projet?.nom ?? projetId}`
    );
    return data;
  },

  async removeProjet(clientFournisseurId: string, projetId: string, auth: CfAuth) {
    const cf = await getCfAclRow(clientFournisseurId);
    if (!cf) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(clientFournisseurId, auth.userId);
    if (!canModifyCf(cf, auth, perms, await isCfAdminImplicitRefused(clientFournisseurId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }
    const p = await prisma.projet.findUnique({ where: { id: projetId }, select: { nom: true } });
    await prisma.clientFournisseurProjet.deleteMany({
      where: { clientFournisseurId, projetId },
    });
    await logCfHistory(clientFournisseurId, auth.userId, 'projet_delie', `Projet retiré : ${p?.nom ?? projetId}`);
  },

  async getAccesDetail(cfId: string, auth: CfAuth) {
    const row = await prisma.clientFournisseur.findFirst({
      where: { id: cfId, deletedAt: null },
      select: { id: true, createdById: true, nom: true },
    });
    if (!row) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(cfId, auth.userId);
    const ar = await isCfAdminImplicitRefused(cfId, auth.userId);
    if (!canViewCf(row, auth, perms, ar)) throw new Error('FORBIDDEN');

    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });

    const creator = row.createdById
      ? await prisma.user.findUnique({
          where: { id: row.createdById },
          select: { id: true, nom: true, prenom: true, email: true, role: true },
        })
      : null;

    const delegations = await prisma.permission.findMany({
      where: { ressourceType: 'clientFournisseur', ressourceId: cfId },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let adminSansAccesUserIds: string[] = [];
    try {
      adminSansAccesUserIds = (
        await prisma.clientFournisseurAdminSansAcces.findMany({
          where: { clientFournisseurId: cfId },
          select: { userId: true },
        })
      ).map((x) => x.userId);
    } catch {
      /* table absente */
    }

    return {
      ficheNom: row.nom,
      admins,
      creator,
      delegations: delegations.map((d) => ({
        id: d.id,
        permission: d.permission,
        user: d.user,
        grantedBy: d.grantedBy,
        createdAt: d.createdAt,
      })),
      canManagePermissions: canManageCfPermissions(row, auth, perms, ar),
      adminSansAccesUserIds,
    };
  },

  async addDelegation(cfId: string, targetUserId: string, permission: PermissionType, auth: CfAuth) {
    const row = await getCfAclRow(cfId);
    if (!row) throw new Error('NOT_FOUND');
    const actorPerms = await myPermTypesForCf(cfId, auth.userId);
    const ar = await isCfAdminImplicitRefused(cfId, auth.userId);
    if (!canManageCfPermissions(row, auth, actorPerms, ar)) throw new Error('FORBIDDEN');
    if (targetUserId === auth.userId && !isAdminRole(auth.role)) {
      // créateur se donne un droit explicite : inutile mais autorisé si admin
    }
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, nom: true, prenom: true } });
    if (!target) throw new Error('Utilisateur introuvable');
    if (row.createdById === targetUserId) {
      throw new Error('Le créateur de la fiche a déjà tous les droits');
    }

    try {
      await prisma.clientFournisseurAdminSansAcces.deleteMany({
        where: { clientFournisseurId: cfId, userId: targetUserId },
      });
    } catch {
      /* table absente */
    }

    const created = await prisma.permission.create({
      data: {
        userId: targetUserId,
        ressourceType: 'clientFournisseur',
        ressourceId: cfId,
        permission,
        grantedById: auth.userId,
      },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
    });
    await logCfHistory(cfId, auth.userId, 'droit_ajoute', `Droit « ${permission} » accordé à ${target.prenom} ${target.nom}`, {
      permission,
      cibleUserId: targetUserId,
    });
    return created;
  },

  async removeDelegation(cfId: string, permissionId: string, auth: CfAuth) {
    const row = await getCfAclRow(cfId);
    if (!row) throw new Error('NOT_FOUND');
    const actorPerms = await myPermTypesForCf(cfId, auth.userId);
    const ar = await isCfAdminImplicitRefused(cfId, auth.userId);
    if (!canManageCfPermissions(row, auth, actorPerms, ar)) throw new Error('FORBIDDEN');
    const perm = await prisma.permission.findFirst({
      where: { id: permissionId, ressourceType: 'clientFournisseur', ressourceId: cfId },
      include: { user: { select: { nom: true, prenom: true } } },
    });
    if (!perm) throw new Error('NOT_FOUND');
    const targetUserId = perm.userId;
    await prisma.permission.delete({ where: { id: permissionId } });
    await logCfHistory(cfId, auth.userId, 'droit_retire', `Droit « ${perm.permission} » retiré à ${perm.user.prenom} ${perm.user.nom}`, {
      permission: perm.permission,
      cibleUserId: perm.userId,
    });
    await maybeExcludeAdminAfterCfPermissionRemoved(cfId, row.createdById, targetUserId);
  },

  async blockAdminImplicitAccess(cfId: string, targetUserId: string, auth: CfAuth) {
    const row = await getCfAclRow(cfId);
    if (!row) throw new Error('NOT_FOUND');
    const actorPerms = await myPermTypesForCf(cfId, auth.userId);
    const ar = await isCfAdminImplicitRefused(cfId, auth.userId);
    if (!canManageCfPermissions(row, auth, actorPerms, ar)) throw new Error('FORBIDDEN');
    if (row.createdById === targetUserId) throw new Error('Le créateur de la fiche ne peut pas être exclu');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (target.role !== 'admin') {
      throw new Error("Seuls les comptes administrateur peuvent être privés de l'accès implicite à la fiche");
    }
    await prisma.permission.deleteMany({
      where: { ressourceType: 'clientFournisseur', ressourceId: cfId, userId: targetUserId },
    });
    try {
      await prisma.clientFournisseurAdminSansAcces.upsert({
        where: { clientFournisseurId_userId: { clientFournisseurId: cfId, userId: targetUserId } },
        create: { clientFournisseurId: cfId, userId: targetUserId },
        update: {},
      });
    } catch {
      throw new Error(
        "Impossible d'enregistrer l'exclusion admin : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  },

  async restoreAdminImplicitAccess(cfId: string, targetUserId: string, auth: CfAuth) {
    const row = await getCfAclRow(cfId);
    if (!row) throw new Error('NOT_FOUND');
    const actorPerms = await myPermTypesForCf(cfId, auth.userId);
    const ar = await isCfAdminImplicitRefused(cfId, auth.userId);
    if (!canManageCfPermissions(row, auth, actorPerms, ar)) throw new Error('FORBIDDEN');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    try {
      await prisma.clientFournisseurAdminSansAcces.deleteMany({
        where: { clientFournisseurId: cfId, userId: targetUserId },
      });
    } catch {
      throw new Error(
        "Impossible de restaurer l'accès : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  },

  async getHistorique(cfId: string, auth: CfAuth) {
    const row = await prisma.clientFournisseur.findFirst({
      where: { id: cfId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!row) throw new Error('NOT_FOUND');
    const perms = await myPermTypesForCf(cfId, auth.userId);
    if (!canViewCf(row, auth, perms, await isCfAdminImplicitRefused(cfId, auth.userId))) {
      throw new Error('FORBIDDEN');
    }

    const events = await prisma.clientFournisseurHistorique.findMany({
      where: { clientFournisseurId: cfId },
      include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return events;
  },

  async listDeletedForCorbeille() {
    return prisma.clientFournisseur.findMany({
      where: { deletedAt: { not: null } },
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  },

  /** Corbeille : tout pour l’admin, sinon uniquement les fiches créées par l’utilisateur (aligné projets). */
  async listDeletedForCorbeilleScoped(auth: CfAuth) {
    const where: { deletedAt: { not: null }; createdById?: string } = { deletedAt: { not: null } };
    if (!isAdminRole(auth.role)) {
      where.createdById = auth.userId;
    }
    return prisma.clientFournisseur.findMany({
      where,
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  },

  async restoreFromCorbeille(id: string) {
    const row = await getCfAclRowAllowDeleted(id);
    if (!row || !row.deletedAt) throw new Error('Élément introuvable ou non supprimé');
    return prisma.clientFournisseur.update({
      where: { id },
      data: { deletedAt: null },
      include: { createdBy: true, typeSociete: true },
    });
  },

  async deletePermanent(id: string) {
    await prisma.permission.deleteMany({
      where: { ressourceType: 'clientFournisseur', ressourceId: id },
    });
    try {
      await prisma.clientFournisseurAdminSansAcces.deleteMany({ where: { clientFournisseurId: id } });
    } catch {
      /* table absente */
    }
    await prisma.contratPartiePrenante.updateMany({
      where: { clientFournisseurId: id },
      data: { clientFournisseurId: null },
    });
    await prisma.clientFournisseur.delete({ where: { id } });
  },

  async canAccess(cfId: string, userId: string, userRole: string): Promise<{ canAccess: boolean; reason?: string }> {
    const row = await prisma.clientFournisseur.findFirst({
      where: { id: cfId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!row) return { canAccess: false, reason: 'Fiche introuvable' };
    const perms = await myPermTypesForCf(cfId, userId);
    const ar = await isCfAdminImplicitRefused(cfId, userId);
    if (!canViewCf(row, { userId, role: userRole as CfAuth['role'] }, perms, ar)) {
      return { canAccess: false, reason: 'Accès refusé à cette fiche' };
    }
    return { canAccess: true };
  },
};
