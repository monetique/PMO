import { prisma } from '../utils/prisma';
import { PermissionType } from '../generated/prisma/enums';
import { fetchEntiteAdminExcludedByEntiteIds, fetchEntiteAdminExcludedForUser } from '../utils/resourceAdminSansAcces';
import { getEntiteDescendantIds, getUserDirectEntiteIds, keepMostSpecificEntiteIds } from '../utils/entiteScope';

const entiteIncludeList = {
  typeEntite: { select: { id: true, code: true, libelle: true } },
  responsable: {
    select: { id: true, email: true, nom: true, prenom: true, fonction: true },
  },
  parent: {
    select: {
      id: true,
      nom: true,
      code: true,
      typeEntite: { select: { id: true, code: true, libelle: true } },
    },
  },
  createdBy: { select: { id: true, email: true, nom: true, prenom: true } },
  membres: {
    include: {
      user: {
        select: { id: true, email: true, nom: true, prenom: true, role: true, fonction: true },
      },
    },
  },
  _count: {
    select: { membres: true, processus: true },
  },
} as const;

function isAdminRole(role: string) {
  return role === 'admin';
}

async function permissionEntiteIdsForUser(userId: string): Promise<string[]> {
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'entite', userId },
    select: { ressourceId: true },
  });
  return [...new Set(rows.map((r) => r.ressourceId).filter(Boolean))];
}

async function myPermTypesForEntite(entiteId: string, userId: string): Promise<PermissionType[]> {
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'entite', ressourceId: entiteId, userId },
    select: { permission: true },
  });
  return rows.map((r) => r.permission);
}

function canViewEntite(
  row: { id: string; createdById: string | null; responsableId: string | null },
  auth: { userId: string; role: string },
  permTypes: PermissionType[],
  isMembre: boolean,
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.createdById === auth.userId) return true;
    if (row.responsableId === auth.userId) return true;
    if (isMembre) return true;
    if (adminImplicitRefused && permTypes.length === 0) return false;
    return true;
  }
  if (row.createdById == null) return true;
  if (row.createdById === auth.userId) return true;
  if (row.responsableId === auth.userId) return true;
  if (isMembre) return true;
  return permTypes.length > 0;
}

function canModifyEntite(
  row: { createdById: string | null; responsableId: string | null },
  auth: { userId: string; role: string },
  permTypes: PermissionType[],
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.createdById === auth.userId) return true;
    if (row.responsableId === auth.userId) return true;
    if (adminImplicitRefused) {
      return permTypes.some((p) => ['modification', 'suppression', 'gestion'].includes(p));
    }
    return true;
  }
  if (row.createdById === auth.userId) return true;
  if (row.responsableId === auth.userId) return true;
  return permTypes.some((p) => ['modification', 'suppression', 'gestion'].includes(p));
}

function canSoftDeleteEntite(
  row: { createdById: string | null },
  auth: { userId: string; role: string },
  permTypes: PermissionType[],
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.createdById === auth.userId) return true;
    if (adminImplicitRefused) {
      return permTypes.includes('suppression');
    }
    return true;
  }
  if (row.createdById === auth.userId) return true;
  return permTypes.includes('suppression');
}

/** Créateur ou délégation « gestion » uniquement. */
function canManageEntitePermissions(
  row: { createdById: string | null },
  auth: { userId: string; role: string },
  permTypes: PermissionType[]
) {
  if (row.createdById === auth.userId) return true;
  return permTypes.includes('gestion');
}

async function maybeExcludeAdminAfterEntitePermissionRemoved(
  entiteId: string,
  entiteCreatedById: string | null,
  entiteResponsableId: string | null,
  targetUserId: string
) {
  if (targetUserId === entiteCreatedById || targetUserId === entiteResponsableId) return;
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
  if (u?.role !== 'admin') return;
  const remaining = await prisma.permission.count({
    where: { ressourceType: 'entite', ressourceId: entiteId, userId: targetUserId },
  });
  if (remaining > 0) return;
  try {
    await prisma.entiteAdminSansAcces.upsert({
      where: { entiteId_userId: { entiteId, userId: targetUserId } },
      create: { entiteId, userId: targetUserId },
      update: {},
    });
  } catch {
    /* table absente */
  }
}

async function delegationsGrouped(entiteId: string) {
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'entite', ressourceId: entiteId },
    include: {
      user: { select: { id: true, nom: true, prenom: true, email: true, fonction: true } },
      grantedBy: { select: { id: true, nom: true, prenom: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const map = new Map<string, { user: (typeof rows)[0]['user']; permissions: PermissionType[]; ids: string[] }>();
  for (const r of rows) {
    const k = r.userId;
    if (!map.has(k)) {
      map.set(k, { user: r.user, permissions: [], ids: [] });
    }
    const e = map.get(k)!;
    e.permissions.push(r.permission);
    e.ids.push(r.id);
  }
  return Array.from(map.values()).map((v) => ({
    user: v.user,
    permissions: v.permissions,
    /** Première entrée id pour retrait (supprime toutes les permissions de l’utilisateur via boucle côté API si besoin) */
    permissionEntryIds: v.ids,
  }));
}

function capabilitiesFor(
  row: any,
  auth: { userId: string; role: string },
  permTypes: PermissionType[],
  isMembre: boolean,
  adminImplicitRefused: boolean
) {
  const view = canViewEntite(row, auth, permTypes, isMembre, adminImplicitRefused);
  return {
    canView: view,
    canModify: view && canModifyEntite(row, auth, permTypes, adminImplicitRefused),
    canDelete: view && canSoftDeleteEntite(row, auth, permTypes, adminImplicitRefused),
    canManagePermissions: view && canManageEntitePermissions(row, auth, permTypes),
  };
}

export type EntiteAuth = { userId: string; role: string };

export class EntiteService {
  private async getUserEntiteIds(userId: string): Promise<string[]> {
    const direct = await getUserDirectEntiteIds(userId);
    return keepMostSpecificEntiteIds(direct);
  }

  private async getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
    return getEntiteDescendantIds([...new Set((rootIds || []).filter(Boolean))]);
  }

  private async getScopedEntiteIdsForUser(userId: string): Promise<string[]> {
    const own = await this.getUserEntiteIds(userId);
    return this.getEntiteDescendantIds(own);
  }

  private async canAccessEntiteScope(entiteId: string, auth: EntiteAuth): Promise<boolean> {
    if (isAdminRole(auth.role)) return true;
    const scoped = await this.getScopedEntiteIdsForUser(auth.userId);
    return scoped.includes(entiteId);
  }

  private async buildVisibilityWhere(auth: EntiteAuth) {
    if (isAdminRole(auth.role)) {
      return {};
    }
    const scopedIds = await this.getScopedEntiteIdsForUser(auth.userId);
    if (!scopedIds.length) {
      return { id: '__NO_ENTITE_SCOPE__' };
    }
    return {
      id: { in: scopedIds },
    };
  }

  async findAll(
    auth: EntiteAuth,
    filters?: {
      parentId?: string;
      typeEntiteId?: string;
      search?: string;
      responsableId?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }
  ) {
    const extraWhere = await this.buildVisibilityWhere(auth);
    const where: any = { deletedAt: null, ...extraWhere };
    if (filters?.parentId !== undefined && filters.parentId !== '') where.parentId = filters.parentId;
    if (filters?.typeEntiteId) where.typeEntiteId = filters.typeEntiteId;
    if (filters?.responsableId) where.responsableId = filters.responsableId;
    if (filters?.search) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { nom: { contains: filters.search, mode: 'insensitive' } },
            { code: { contains: filters.search, mode: 'insensitive' } },
            { description: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    let orderBy: any = { nom: 'asc' };
    if (filters?.sortBy) {
      const sortOrder = filters.sortOrder || 'asc';
      switch (filters.sortBy) {
        case 'nom':
          orderBy = { nom: sortOrder };
          break;
        case 'code':
          orderBy = { code: sortOrder };
          break;
        case 'type':
          orderBy = { typeEntite: { libelle: sortOrder } };
          break;
        case 'responsable':
          orderBy = { responsable: { nom: sortOrder } };
          break;
        case 'parent':
          orderBy = { parent: { nom: sortOrder } };
          break;
        default:
          orderBy = { nom: 'asc' };
      }
    }

    const list = await prisma.entite.findMany({
      where,
      include: entiteIncludeList,
      orderBy,
    });

    const ids = list.map((e) => e.id);
    const byEntiteUser = new Map<string, Map<string, { user: { id: string; nom: string; prenom: string; email: string }; permissions: PermissionType[] }>>();
    if (ids.length > 0) {
      const allPermRows = await prisma.permission.findMany({
        where: { ressourceType: 'entite', ressourceId: { in: ids } },
        include: { user: { select: { id: true, nom: true, prenom: true, email: true, fonction: true } } },
      });
      for (const r of allPermRows) {
        if (!byEntiteUser.has(r.ressourceId)) byEntiteUser.set(r.ressourceId, new Map());
        const m = byEntiteUser.get(r.ressourceId)!;
        if (!m.has(r.userId)) {
          m.set(r.userId, { user: r.user, permissions: [] });
        }
        m.get(r.userId)!.permissions.push(r.permission);
      }
    }

    const myPermsByEntite = new Map<string, PermissionType[]>();
    if (ids.length > 0) {
      const mine = await prisma.permission.findMany({
        where: { ressourceType: 'entite', ressourceId: { in: ids }, userId: auth.userId },
        select: { ressourceId: true, permission: true },
      });
      for (const p of mine) {
        if (!myPermsByEntite.has(p.ressourceId)) myPermsByEntite.set(p.ressourceId, []);
        myPermsByEntite.get(p.ressourceId)!.push(p.permission);
      }
    }

    const adminExclViewer = await fetchEntiteAdminExcludedForUser(auth.userId, ids);
    const adminExclAll = await fetchEntiteAdminExcludedByEntiteIds(ids);

    return list
      .map((e) => {
        const permTypes = myPermsByEntite.get(e.id) || [];
        const isMembre = e.membres?.some((m) => m.userId === auth.userId) ?? false;
        const delegMap = byEntiteUser.get(e.id);
        const delegations = delegMap ? Array.from(delegMap.values()) : [];
        const adminImplicitRefused = adminExclViewer.has(e.id);
        return {
          ...e,
          adminSansAccesUserIds: adminExclAll.get(e.id) ?? [],
          capabilities: capabilitiesFor(
            { id: e.id, createdById: e.createdById, responsableId: e.responsableId },
            auth,
            permTypes,
            isMembre,
            adminImplicitRefused
          ),
          accesApercu: { delegations },
        };
      })
      .filter((row) => row.capabilities.canView);
  }

  async findOne(id: string, auth: EntiteAuth) {
    if (!(await this.canAccessEntiteScope(id, auth))) return null;
    const e = await prisma.entite.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...entiteIncludeList,
        children: {
          where: { deletedAt: null },
          include: {
            typeEntite: { select: { id: true, code: true, libelle: true } },
            responsable: { select: { id: true, nom: true, prenom: true, fonction: true } },
            _count: { select: { membres: true } },
          },
        },
      },
    });
    if (!e) return null;
    const permTypes = await myPermTypesForEntite(id, auth.userId);
    const isMembre = e.membres?.some((m) => m.userId === auth.userId) ?? false;
    const adminExcl = await fetchEntiteAdminExcludedForUser(auth.userId, [id]);
    const air = adminExcl.has(id);
    if (!canViewEntite({ id: e.id, createdById: e.createdById, responsableId: e.responsableId }, auth, permTypes, isMembre, air)) {
      return null;
    }
    const dels = await delegationsGrouped(id);
    const adminExclAll = await fetchEntiteAdminExcludedByEntiteIds([id]);
    return {
      ...e,
      adminSansAccesUserIds: adminExclAll.get(id) ?? [],
      capabilities: capabilitiesFor(
        { id: e.id, createdById: e.createdById, responsableId: e.responsableId },
        auth,
        permTypes,
        isMembre,
        air
      ),
      accesApercu: {
        delegations: dels.map((d) => ({ user: d.user, permissions: d.permissions })),
      },
    };
  }

  async getAccesDetail(entiteId: string, auth: EntiteAuth) {
    if (!(await this.canAccessEntiteScope(entiteId, auth))) throw new Error('FORBIDDEN');
    const e = await prisma.entite.findFirst({
      where: { id: entiteId, deletedAt: null },
      select: { id: true, createdById: true, responsableId: true },
    });
    if (!e) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForEntite(entiteId, auth.userId);
    const membreRow = await prisma.userEntite.findFirst({ where: { entiteId, userId: auth.userId } });
    const adminExcl = await fetchEntiteAdminExcludedForUser(auth.userId, [entiteId]);
    const air = adminExcl.has(entiteId);
    if (!canViewEntite(e, auth, permTypes, !!membreRow, air)) throw new Error('FORBIDDEN');
    const canManage = canManageEntitePermissions(e, auth, permTypes);
    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true, fonction: true },
    });
    const creator = e.createdById
      ? await prisma.user.findUnique({
          where: { id: e.createdById },
          select: { id: true, nom: true, prenom: true, email: true, fonction: true },
        })
      : null;
    const raw = await prisma.permission.findMany({
      where: { ressourceType: 'entite', ressourceId: entiteId },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true, fonction: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let adminSansAccesUserIds: string[] = [];
    try {
      adminSansAccesUserIds = (
        await prisma.entiteAdminSansAcces.findMany({
          where: { entiteId },
          select: { userId: true },
        })
      ).map((x) => x.userId);
    } catch {
      /* table absente */
    }

    return {
      canManagePermissions: canManage,
      admins,
      creator,
      delegations: raw.map((r) => ({
        id: r.id,
        user: r.user,
        permission: r.permission,
        grantedBy: r.grantedBy,
      })),
      adminSansAccesUserIds,
    };
  }

  async addPermission(entiteId: string, targetUserId: string, permission: PermissionType, auth: EntiteAuth) {
    const e = await prisma.entite.findFirst({ where: { id: entiteId, deletedAt: null } });
    if (!e) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForEntite(entiteId, auth.userId);
    if (!canManageEntitePermissions({ createdById: e.createdById }, auth, permTypes)) throw new Error('FORBIDDEN');
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true, nom: true, prenom: true } });
    if (!target) throw new Error('Utilisateur introuvable');
    if (e.createdById === targetUserId) throw new Error('Le créateur a déjà tous les droits');
    try {
      await prisma.entiteAdminSansAcces.deleteMany({ where: { entiteId, userId: targetUserId } });
    } catch {
      /* table absente */
    }
    const created = await prisma.permission.create({
      data: {
        userId: targetUserId,
        ressourceType: 'entite',
        ressourceId: entiteId,
        permission,
        grantedById: auth.userId,
      },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true, fonction: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
    });
    return created;
  }

  async removePermission(entiteId: string, permissionId: string, auth: EntiteAuth) {
    const e = await prisma.entite.findFirst({ where: { id: entiteId, deletedAt: null } });
    if (!e) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForEntite(entiteId, auth.userId);
    if (!canManageEntitePermissions({ createdById: e.createdById }, auth, permTypes)) throw new Error('FORBIDDEN');
    const perm = await prisma.permission.findFirst({
      where: { id: permissionId, ressourceType: 'entite', ressourceId: entiteId },
    });
    if (!perm) throw new Error('NOT_FOUND');
    const targetUserId = perm.userId;
    await prisma.permission.delete({ where: { id: permissionId } });
    await maybeExcludeAdminAfterEntitePermissionRemoved(entiteId, e.createdById, e.responsableId, targetUserId);
  }

  async blockAdminImplicitAccess(entiteId: string, targetUserId: string, auth: EntiteAuth) {
    const e = await prisma.entite.findFirst({
      where: { id: entiteId, deletedAt: null },
      select: { id: true, createdById: true, responsableId: true },
    });
    if (!e) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForEntite(entiteId, auth.userId);
    if (!canManageEntitePermissions({ createdById: e.createdById }, auth, permTypes)) throw new Error('FORBIDDEN');
    if (targetUserId === e.createdById || targetUserId === e.responsableId) {
      throw new Error('Le créateur ou le responsable ne peut pas être exclu');
    }
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (target.role !== 'admin') {
      throw new Error("Seuls les comptes administrateur peuvent être privés de l'accès implicite à l'entité");
    }
    await prisma.permission.deleteMany({
      where: { ressourceType: 'entite', ressourceId: entiteId, userId: targetUserId },
    });
    try {
      await prisma.entiteAdminSansAcces.upsert({
        where: { entiteId_userId: { entiteId, userId: targetUserId } },
        create: { entiteId, userId: targetUserId },
        update: {},
      });
    } catch {
      throw new Error(
        "Impossible d'enregistrer l'exclusion admin : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }

  async restoreAdminImplicitAccess(entiteId: string, targetUserId: string, auth: EntiteAuth) {
    const e = await prisma.entite.findFirst({
      where: { id: entiteId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!e) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForEntite(entiteId, auth.userId);
    if (!canManageEntitePermissions({ createdById: e.createdById }, auth, permTypes)) throw new Error('FORBIDDEN');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    try {
      await prisma.entiteAdminSansAcces.deleteMany({ where: { entiteId, userId: targetUserId } });
    } catch {
      throw new Error(
        "Impossible de restaurer l'accès : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }

  async canAccess(entiteId: string, userId: string, userRole: string): Promise<{ canAccess: boolean; reason?: string }> {
    if (userRole !== 'admin') {
      const scoped = await this.getScopedEntiteIdsForUser(userId);
      if (!scoped.includes(entiteId)) {
        return { canAccess: false, reason: 'Accès refusé à cette entité' };
      }
    }
    const e = await prisma.entite.findFirst({
      where: { id: entiteId, deletedAt: null },
      select: { id: true, createdById: true, responsableId: true },
    });
    if (!e) return { canAccess: false, reason: 'Entité introuvable' };
    const permTypes = await myPermTypesForEntite(entiteId, userId);
    const membreRow = await prisma.userEntite.findFirst({ where: { entiteId, userId } });
    const excl = await fetchEntiteAdminExcludedForUser(userId, [entiteId]);
    const ok = canViewEntite(e, { userId, role: userRole }, permTypes, !!membreRow, excl.has(entiteId));
    if (!ok) return { canAccess: false, reason: 'Accès refusé à cette entité' };
    return { canAccess: true };
  }

  async create(
    data: {
      nom: string;
      typeEntiteId: string;
      code: string;
      parentId?: string;
      responsableId?: string;
      description?: string;
      membreIds?: string[];
    },
    auth: EntiteAuth
  ) {
    const te = await prisma.typeEntite.findFirst({
      where: { id: data.typeEntiteId, actif: true },
      select: { id: true },
    });
    if (!te) throw new Error("Type d'entité invalide ou inactif");

    const { membreIds, typeEntiteId, ...rest } = data;
    return prisma.entite.create({
      data: {
        ...rest,
        typeEntiteId,
        createdById: auth.userId,
        membres:
          membreIds && membreIds.length > 0
            ? {
                create: membreIds.map((userId) => ({
                  userId,
                })),
              }
            : undefined,
      },
      include: {
        typeEntite: { select: { id: true, code: true, libelle: true } },
        responsable: { select: { id: true, nom: true, prenom: true, fonction: true } },
        parent: { select: { id: true, nom: true } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        membres: {
          include: {
            user: { select: { id: true, nom: true, prenom: true, email: true, fonction: true } },
          },
        },
      },
    });
  }

  async update(
    id: string,
    data: {
      nom?: string;
      typeEntiteId?: string;
      code?: string;
      parentId?: string;
      responsableId?: string;
      description?: string;
      membreIds?: string[];
    },
    auth: EntiteAuth
  ) {
    const existing = await prisma.entite.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new Error('Entité non trouvée');
    const permTypes = await myPermTypesForEntite(id, auth.userId);
    const excl = await fetchEntiteAdminExcludedForUser(auth.userId, [id]);
    if (
      !canModifyEntite(
        { createdById: existing.createdById, responsableId: existing.responsableId },
        auth,
        permTypes,
        excl.has(id)
      )
    ) {
      throw new Error('Accès refusé');
    }
    const { membreIds, typeEntiteId, ...updateData } = data;
    if (typeEntiteId !== undefined) {
      const te = await prisma.typeEntite.findUnique({
        where: { id: typeEntiteId },
        select: { id: true, actif: true },
      });
      if (!te) throw new Error("Type d'entité introuvable");
      if (!te.actif && te.id !== existing.typeEntiteId) {
        throw new Error("Ce type n'est plus actif ; sélectionnez un autre type d'entité");
      }
      (updateData as any).typeEntiteId = typeEntiteId;
    }
    if (membreIds !== undefined) {
      await prisma.userEntite.deleteMany({ where: { entiteId: id } });
      if (membreIds.length > 0) {
        await prisma.userEntite.createMany({
          data: membreIds.map((userId) => ({ entiteId: id, userId })),
        });
      }
    }
    return prisma.entite.update({
      where: { id },
      data: updateData,
      include: {
        typeEntite: { select: { id: true, code: true, libelle: true } },
        responsable: { select: { id: true, nom: true, prenom: true, fonction: true } },
        parent: { select: { id: true, nom: true } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        membres: {
          include: {
            user: { select: { id: true, nom: true, prenom: true, email: true, fonction: true } },
          },
        },
      },
    });
  }

  async softDelete(id: string, auth: EntiteAuth) {
    const existing = await prisma.entite.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new Error('Entité non trouvée');
    const permTypes = await myPermTypesForEntite(id, auth.userId);
    const exclSd = await fetchEntiteAdminExcludedForUser(auth.userId, [id]);
    if (!canSoftDeleteEntite({ createdById: existing.createdById }, auth, permTypes, exclSd.has(id))) {
      throw new Error('Accès refusé');
    }
    const children = await prisma.entite.findMany({ where: { parentId: id, deletedAt: null } });
    if (children.length > 0) {
      throw new Error('Impossible de mettre en corbeille : des sous-entités actives existent encore');
    }
    return prisma.entite.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: {
        responsable: { select: { id: true, nom: true, prenom: true, fonction: true } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
      },
    });
  }

  async restoreFromCorbeille(id: string) {
    const row = await prisma.entite.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!row) throw new Error('Élément introuvable ou non supprimé');
    return prisma.entite.update({
      where: { id },
      data: { deletedAt: null },
      include: { responsable: true, parent: true, createdBy: true },
    });
  }

  async deletePermanent(id: string) {
    const row = await prisma.entite.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!row) throw new Error('Élément introuvable ou non en corbeille');
    const children = await prisma.entite.findMany({ where: { parentId: id, deletedAt: null } });
    if (children.length > 0) {
      throw new Error('Supprimez ou mettez en corbeille les sous-entités actives avant suppression définitive');
    }
    await prisma.permission.deleteMany({ where: { ressourceType: 'entite', ressourceId: id } });
    try {
      await prisma.entiteAdminSansAcces.deleteMany({ where: { entiteId: id } });
    } catch {
      /* table absente */
    }
    return prisma.entite.delete({ where: { id } });
  }

  async listDeletedForCorbeille() {
    return prisma.entite.findMany({
      where: { deletedAt: { not: null } },
      include: {
        responsable: { select: { id: true, nom: true, prenom: true } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        parent: { select: { id: true, nom: true, code: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  /** Corbeille : tout pour l’admin, sinon entités dont l’utilisateur est créateur ou responsable (aligné processus). */
  async listDeletedForCorbeilleScoped(auth: EntiteAuth) {
    const where: any = { deletedAt: { not: null } };
    if (!isAdminRole(auth.role)) {
      where.OR = [{ createdById: auth.userId }, { responsableId: auth.userId }];
    }
    return prisma.entite.findMany({
      where,
      include: {
        responsable: { select: { id: true, nom: true, prenom: true } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        parent: { select: { id: true, nom: true, code: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async getTree(auth: EntiteAuth) {
    const all = await this.findAll(auth);
    const root = all.filter((e) => !e.parentId);
    const buildTree = (parentId: string | null): any[] => {
      return all
        .filter((e) => e.parentId === parentId)
        .map((e) => ({
          ...e,
          children: buildTree(e.id),
        }));
    };
    return root.map((e) => ({
      ...e,
      children: buildTree(e.id),
    }));
  }
}
