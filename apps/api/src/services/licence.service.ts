import { prisma } from '../utils/prisma';
import { NotificationService } from './notification.service';
import { Prisma } from '../generated/prisma/client';
import { promises as fs } from 'fs';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

const licenceInclude = {
  createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
  contratsLies: { include: { contrat: { select: { id: true, nom: true } } } },
  processusLies: { include: { processus: { select: { id: true, nom: true } } } },
  clientsFournisseursLies: {
    include: { clientFournisseur: { select: { id: true, nom: true } } },
  },
  permissions: {
    include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
  },
  documents: {
    include: {
      document: {
        include: {
          uploadedBy: { select: { id: true, nom: true, prenom: true } },
        },
      },
    },
  },
  commentaires: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      user: { select: { id: true, nom: true, prenom: true } },
      assigneUser: { select: { id: true, nom: true, prenom: true } },
    },
  },
  notifications: { orderBy: { createdAt: 'desc' as const } },
  _count: { select: { commentaires: true } },
};

export type LicenceAcl = {
  createdById: string | null;
  permissions: { userId: string; niveau: string }[];
  adminSansAcces?: { userId: string }[];
};

function adminImplicitAccessRefusedLicence(l: LicenceAcl, userId: string): boolean {
  return (l.adminSansAcces || []).some((x) => x.userId === userId);
}

/** Visibilité fiche licence (aligné logique contrat : admin exclu sans ligne de permission). */
export function canReadLicence(userId: string, role: string, licence: LicenceAcl) {
  if (licence.createdById === userId) return true;
  const hasPerm = licence.permissions.some((p) => p.userId === userId);
  if (role === 'admin') {
    if (adminImplicitAccessRefusedLicence(licence, userId)) return hasPerm;
    return true;
  }
  return hasPerm;
}

export function capabilitiesLicence(licence: LicenceAcl, userId: string, userRole: string) {
  const isAdmin = userRole === 'admin';
  const isCreator = licence.createdById === userId;
  const perm = licence.permissions.find((p) => p.userId === userId);
  const adminRefused = isAdmin && adminImplicitAccessRefusedLicence(licence, userId);

  if (isCreator) {
    return {
      canView: true,
      canModify: true,
      canDelete: true,
      canManagePermissions: true,
    };
  }

  if (perm) {
    const canView = true;
    const canModify = perm.niveau === 'modification' || perm.niveau === 'suppression';
    const canDelete = perm.niveau === 'suppression';
    return { canView, canModify, canDelete, canManagePermissions: false };
  }

  if (isAdmin && !adminRefused) {
    return {
      canView: true,
      canModify: true,
      canDelete: true,
      canManagePermissions: false,
    };
  }

  return { canView: false, canModify: false, canDelete: false, canManagePermissions: false };
}

export function canEditLicenceContent(userId: string, role: string, licence: LicenceAcl) {
  return capabilitiesLicence(licence, userId, role).canModify;
}

export function canSoftDeleteLicence(userId: string, role: string, licence: LicenceAcl) {
  return capabilitiesLicence(licence, userId, role).canDelete;
}

/** Seul le créateur gère les accès partagés (comme les contrats). */
export function canManagePermissions(userId: string, _role: string, licence: LicenceAcl) {
  return licence.createdById != null && licence.createdById === userId;
}

async function enrichNotifications(
  notifications: {
    id: string;
    mode: string;
    joursAvant: number;
    dateAlerte: Date | null;
    recurrence: string;
    active: boolean;
    destinataireIds: string[];
    lastSentAt: Date | null;
    createdAt: Date;
  }[],
) {
  const allIds = [...new Set(notifications.flatMap((n) => n.destinataireIds || []))];
  if (allIds.length === 0) {
    return notifications.map((n) => ({ ...n, destinataires: [] as { id: string; nom: string; prenom: string; email: string }[] }));
  }
  const users = await prisma.user.findMany({
    where: { id: { in: allIds } },
    select: { id: true, nom: true, prenom: true, email: true },
  });
  const map = new Map(users.map((u) => [u.id, u]));
  return notifications.map((n) => ({
    ...n,
    destinataires: (n.destinataireIds || []).map((id) => map.get(id)).filter(Boolean) as { id: string; nom: string; prenom: string; email: string }[],
  }));
}

function formatLicenceRow(l: any) {
  return {
    ...l,
    permissions: (l.permissions || []).map((p: any) => ({
      id: p.id,
      userId: p.userId,
      niveau: p.niveau,
      user: p.user,
    })),
  };
}

/** Fusionne tableaux d’ids et ancienne clé unique (rétrocompat API). */
export function mergeLicenceLinkIds(arr: unknown, single: unknown): string[] {
  const out = new Set<string>();
  if (Array.isArray(arr)) {
    for (const x of arr) {
      if (typeof x === 'string' && x.trim()) out.add(x.trim());
    }
  }
  if (typeof single === 'string' && single.trim()) out.add(single.trim());
  return [...out];
}

function licenceLinksProvided(data: Record<string, unknown>) {
  return (
    data.contratIds !== undefined ||
    data.contratId !== undefined ||
    data.processusIds !== undefined ||
    data.processusId !== undefined ||
    data.clientFournisseurIds !== undefined ||
    data.clientFournisseurId !== undefined
  );
}

export async function formatLicenceFull(l: any) {
  const row = formatLicenceRow(l);
  const {
    contratsLies: _cl,
    processusLies: _pl,
    clientsFournisseursLies: _cfl,
    ...rest
  } = row;
  const notifs = await enrichNotifications(l.notifications || []);
  return {
    ...rest,
    contrats: (l.contratsLies || []).map((x: any) => x.contrat).filter(Boolean),
    processus: (l.processusLies || []).map((x: any) => x.processus).filter(Boolean),
    clientsFournisseurs: (l.clientsFournisseursLies || []).map((x: any) => x.clientFournisseur).filter(Boolean),
    notifications: notifs,
  };
}

const licenceAclInclude = {
  permissions: true,
} as const;

/** Chargé à part : si la table n’existe pas encore (migration non appliquée), ne fait pas échouer le GET /licences. */
async function fetchAdminSansAccesByLicenceIds(licenceIds: string[]): Promise<Map<string, { userId: string }[]>> {
  const map = new Map<string, { userId: string }[]>();
  const ids = [...new Set(licenceIds.filter(Boolean))];
  if (ids.length === 0) return map;
  try {
    const rows = await prisma.licenceAdminSansAcces.findMany({
      where: { licenceId: { in: ids } },
      select: { licenceId: true, userId: true },
    });
    for (const r of rows) {
      const arr = map.get(r.licenceId) ?? [];
      arr.push({ userId: r.userId });
      map.set(r.licenceId, arr);
    }
  } catch {
    /* ex. P2021 table absente */
  }
  return map;
}

function mergeAdminSansAcces<L extends { id: string }>(
  row: L,
  byLicence: Map<string, { userId: string }[]>,
): L & { adminSansAcces: { userId: string }[] } {
  return { ...row, adminSansAcces: byLicence.get(row.id) ?? [] };
}

async function withAdminSansAcces<T extends { id: string }>(row: T | null): Promise<(T & { adminSansAcces: { userId: string }[] }) | null> {
  if (!row) return null;
  const m = await fetchAdminSansAccesByLicenceIds([row.id]);
  return mergeAdminSansAcces(row, m);
}

/** Licence + permissions + exclusions admin (sans JOIN SQL sur LicenceAdminSansAcces — tolère table absente). */
export async function loadLicenceForAclById(id: string) {
  const row = await prisma.licence.findUnique({
    where: { id },
    include: { permissions: true },
  });
  if (!row) return null;
  return withAdminSansAcces(row);
}

async function maybeExcludeAdminAfterLicencePermissionRemoved(
  licenceId: string,
  licenceCreatedById: string | null,
  targetUserId: string,
) {
  if (!licenceCreatedById || targetUserId === licenceCreatedById) return;
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
  if (u?.role !== 'admin') return;
  try {
    await prisma.licenceAdminSansAcces.upsert({
      where: { licenceId_userId: { licenceId, userId: targetUserId } },
      create: { licenceId, userId: targetUserId },
      update: {},
    });
  } catch {
    /* table absente : migration non appliquée */
  }
}

export class LicenceService {
  private notificationService = new NotificationService();

  private async mapLicenceWithCaps(raw: any, userId: string, role: string) {
    const full = await formatLicenceFull(raw);
    const caps = capabilitiesLicence(raw as LicenceAcl, userId, role);
    return {
      ...full,
      capabilities: caps,
      adminSansAccesUserIds: (raw.adminSansAcces || []).map((x: { userId: string }) => x.userId),
      accesApercu: {
        delegations: (raw.permissions || []).map((p: any) => ({
          id: p.id,
          user: p.user,
          niveau: p.niveau,
        })),
      },
    };
  }

  async findAllActive(userId: string, role: string) {
    const list = await prisma.licence.findMany({
      where: { deletedAt: null },
      include: licenceInclude,
      orderBy: { updatedAt: 'desc' },
    });
    const byLic = await fetchAdminSansAccesByLicenceIds(list.map((l) => l.id));
    const merged = list.map((l) => mergeAdminSansAcces(l, byLic));
    const filtered = merged.filter((l) => canReadLicence(userId, role, l as LicenceAcl));
    return Promise.all(filtered.map((l) => this.mapLicenceWithCaps(l, userId, role)));
  }

  async findAllDeleted(userId: string, role: string) {
    const where: any = { deletedAt: { not: null } };
    if (role !== 'admin') {
      where.createdById = userId;
    }
    const list = await prisma.licence.findMany({
      where,
      include: licenceInclude,
      orderBy: { deletedAt: 'desc' },
    });
    const byLic = await fetchAdminSansAccesByLicenceIds(list.map((l) => l.id));
    return Promise.all(list.map((l) => formatLicenceFull(mergeAdminSansAcces(l, byLic))));
  }

  async findOne(id: string, userId: string, role: string) {
    const l = await prisma.licence.findUnique({
      where: { id },
      include: licenceInclude,
    });
    if (!l) return null;
    const m = await fetchAdminSansAccesByLicenceIds([l.id]);
    const merged = mergeAdminSansAcces(l, m);
    if (!canReadLicence(userId, role, merged as LicenceAcl)) return null;
    if (merged.deletedAt) {
      if (role !== 'admin' && merged.createdById !== userId) return null;
    }
    return this.mapLicenceWithCaps(merged, userId, role);
  }

  async create(data: any, createdById: string, actorRole: string) {
    const {
      nom,
      reference,
      typeLicence,
      statut,
      cout,
      devise,
      nombreSieges,
      dateDebut,
      dateFin,
      description,
      contratIds,
      contratId,
      processusIds,
      processusId,
      clientFournisseurIds,
      clientFournisseurId,
    } = data;

    const cIds = mergeLicenceLinkIds(contratIds, contratId);
    const pIds = mergeLicenceLinkIds(processusIds, processusId);
    const cfIds = mergeLicenceLinkIds(clientFournisseurIds, clientFournisseurId);

    const l = await prisma.licence.create({
      data: {
        nom,
        reference,
        typeLicence,
        statut: statut || 'active',
        cout: cout != null && cout !== '' ? new Prisma.Decimal(String(cout)) : null,
        devise: devise || null,
        nombreSieges: nombreSieges != null ? parseInt(String(nombreSieges), 10) : null,
        dateDebut: dateDebut ? new Date(dateDebut) : null,
        dateFin: dateFin ? new Date(dateFin) : null,
        description: description || null,
        createdById,
        contratsLies: { create: cIds.map((contratId) => ({ contratId })) },
        processusLies: { create: pIds.map((processusId) => ({ processusId })) },
        clientsFournisseursLies: {
          create: cfIds.map((clientFournisseurId) => ({ clientFournisseurId })),
        },
      },
      include: licenceInclude,
    });
    return this.findOne(l.id, createdById, actorRole)!;
  }

  async update(id: string, data: any, userId: string, role: string) {
    const existingRaw = await prisma.licence.findUnique({
      where: { id },
      include: licenceAclInclude,
    });
    if (!existingRaw || existingRaw.deletedAt) throw new Error('Licence non trouvée');
    const existing = await withAdminSansAcces(existingRaw);
    if (!existing) throw new Error('Licence non trouvée');
    if (!canEditLicenceContent(userId, role, existing as LicenceAcl)) throw new Error('Accès refusé');

    const {
      nom,
      reference,
      typeLicence,
      statut,
      cout,
      devise,
      nombreSieges,
      dateDebut,
      dateFin,
      description,
      contratIds,
      contratId,
      processusIds,
      processusId,
      clientFournisseurIds,
      clientFournisseurId,
    } = data;

    await prisma.$transaction(async (tx) => {
      await tx.licence.update({
        where: { id },
        data: {
          ...(nom !== undefined && { nom }),
          ...(reference !== undefined && { reference }),
          ...(typeLicence !== undefined && { typeLicence }),
          ...(statut !== undefined && { statut }),
          ...(cout !== undefined && { cout: cout != null && cout !== '' ? new Prisma.Decimal(String(cout)) : null }),
          ...(devise !== undefined && { devise: devise || null }),
          ...(nombreSieges !== undefined && {
            nombreSieges: nombreSieges != null && nombreSieges !== '' ? parseInt(String(nombreSieges), 10) : null,
          }),
          ...(dateDebut !== undefined && { dateDebut: dateDebut ? new Date(dateDebut) : null }),
          ...(dateFin !== undefined && { dateFin: dateFin ? new Date(dateFin) : null }),
          ...(description !== undefined && { description: description || null }),
        },
      });

      if (licenceLinksProvided(data)) {
        const cIds = mergeLicenceLinkIds(contratIds, contratId);
        const pIds = mergeLicenceLinkIds(processusIds, processusId);
        const cfIds = mergeLicenceLinkIds(clientFournisseurIds, clientFournisseurId);

        await tx.licenceContrat.deleteMany({ where: { licenceId: id } });
        if (cIds.length) {
          await tx.licenceContrat.createMany({
            data: cIds.map((contratId) => ({ licenceId: id, contratId })),
          });
        }

        await tx.licenceProcessus.deleteMany({ where: { licenceId: id } });
        if (pIds.length) {
          await tx.licenceProcessus.createMany({
            data: pIds.map((processusId) => ({ licenceId: id, processusId })),
          });
        }

        await tx.licenceClientFournisseur.deleteMany({ where: { licenceId: id } });
        if (cfIds.length) {
          await tx.licenceClientFournisseur.createMany({
            data: cfIds.map((clientFournisseurId) => ({ licenceId: id, clientFournisseurId })),
          });
        }
      }
    });

    return this.findOne(id, userId, role)!;
  }

  async softDelete(id: string, userId: string, role: string) {
    const existingRaw = await prisma.licence.findUnique({
      where: { id },
      include: licenceAclInclude,
    });
    if (!existingRaw || existingRaw.deletedAt) throw new Error('Licence non trouvée');
    const existing = await withAdminSansAcces(existingRaw);
    if (!existing) throw new Error('Licence non trouvée');
    if (!canSoftDeleteLicence(userId, role, existing as LicenceAcl)) throw new Error('Accès refusé');
    return prisma.licence.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: licenceInclude,
    });
  }

  async restore(id: string, userId: string, role: string) {
    const existing = await prisma.licence.findUnique({ where: { id } });
    if (!existing || !existing.deletedAt) throw new Error('Licence non trouvée dans la corbeille');
    if (role !== 'admin' && existing.createdById !== userId) throw new Error('Accès refusé');
    await prisma.licence.update({
      where: { id },
      data: { deletedAt: null },
    });
    const l = await prisma.licence.findUnique({ where: { id }, include: licenceInclude });
    if (!l) throw new Error('Licence non trouvée dans la corbeille');
    const m = await fetchAdminSansAccesByLicenceIds([l.id]);
    return this.mapLicenceWithCaps(mergeAdminSansAcces(l, m), userId, role);
  }

  async deletePermanent(id: string) {
    const existing = await prisma.licence.findUnique({
      where: { id },
      include: { documents: { include: { document: true } } },
    });
    if (!existing) throw new Error('Licence non trouvée');

    for (const ld of existing.documents) {
      const doc = ld.document;
      try {
        const fp = path.join(UPLOAD_DIR, doc.fichierUrl);
        await fs.unlink(fp);
      } catch {
        /* ignore */
      }
      await prisma.licenceDocument.deleteMany({ where: { documentId: doc.id } });
      await prisma.document.delete({ where: { id: doc.id } }).catch(() => {});
    }

    await prisma.licence.delete({ where: { id } });
  }

  async addPermission(licenceId: string, userId: string, niveau: string, actorId: string, role: string) {
    const licence = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licence || licence.deletedAt) throw new Error('Licence non trouvée');
    if (licence.createdById !== actorId) throw new Error('Accès refusé');
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (licence.createdById === userId) throw new Error('Le créateur de la licence a déjà tous les droits');

    try {
      await prisma.licenceAdminSansAcces.deleteMany({ where: { licenceId, userId } });
    } catch {
      /* table absente */
    }

    await prisma.licencePermission.upsert({
      where: { licenceId_userId: { licenceId, userId } },
      create: { licenceId, userId, niveau },
      update: { niveau },
    });
    await this.syncDocumentsPermissionsFromLicence(licenceId);
    return this.findOne(licenceId, actorId, role);
  }

  async removePermission(licenceId: string, targetUserId: string, actorId: string, role: string) {
    const licence = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licence || licence.deletedAt) throw new Error('Licence non trouvée');
    if (licence.createdById !== actorId) throw new Error('Accès refusé');
    const perm = licence.permissions.find((p) => p.userId === targetUserId);
    if (!perm) throw new Error('Permission introuvable');
    await prisma.licencePermission.deleteMany({ where: { licenceId, userId: targetUserId } });
    await maybeExcludeAdminAfterLicencePermissionRemoved(licenceId, licence.createdById, targetUserId);
    await this.syncDocumentsPermissionsFromLicence(licenceId);
    return this.findOne(licenceId, actorId, role);
  }

  async removePermissionByEntryId(licenceId: string, permissionEntryId: string, actorId: string, role: string) {
    const licence = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licence || licence.deletedAt) throw new Error('Licence non trouvée');
    if (licence.createdById !== actorId) throw new Error('Accès refusé');
    const perm = await prisma.licencePermission.findFirst({
      where: { id: permissionEntryId, licenceId },
      include: { user: { select: { nom: true, prenom: true } } },
    });
    if (!perm) throw new Error('Permission introuvable');
    await prisma.licencePermission.delete({ where: { id: permissionEntryId } });
    await maybeExcludeAdminAfterLicencePermissionRemoved(licenceId, licence.createdById, perm.userId);
    await this.syncDocumentsPermissionsFromLicence(licenceId);
    return this.findOne(licenceId, actorId, role);
  }

  async blockAdminImplicitAccess(licenceId: string, targetUserId: string, actorId: string) {
    const licence = await prisma.licence.findFirst({
      where: { id: licenceId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!licence) throw new Error('Licence non trouvée');
    if (licence.createdById !== actorId) throw new Error('Accès refusé');
    if (licence.createdById === targetUserId) throw new Error('Le créateur de la licence ne peut pas être exclu');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (target.role !== 'admin') {
      throw new Error("Seuls les comptes administrateur peuvent être privés de l'accès implicite à la licence");
    }
    await prisma.licencePermission.deleteMany({ where: { licenceId, userId: targetUserId } });
    try {
      await prisma.licenceAdminSansAcces.upsert({
        where: { licenceId_userId: { licenceId, userId: targetUserId } },
        create: { licenceId, userId: targetUserId },
        update: {},
      });
    } catch {
      throw new Error(
        "Impossible d'enregistrer l'exclusion admin : table LicenceAdminSansAcces absente. Exécutez « prisma migrate deploy » sur l'API.",
      );
    }
    await this.syncDocumentsPermissionsFromLicence(licenceId);
  }

  async restoreAdminImplicitAccess(licenceId: string, targetUserId: string, actorId: string) {
    const licence = await prisma.licence.findFirst({
      where: { id: licenceId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!licence) throw new Error('Licence non trouvée');
    if (licence.createdById !== actorId) throw new Error('Accès refusé');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    try {
      await prisma.licenceAdminSansAcces.deleteMany({ where: { licenceId, userId: targetUserId } });
    } catch {
      throw new Error(
        "Impossible de restaurer l'accès : table LicenceAdminSansAcces absente. Exécutez « prisma migrate deploy » sur l'API.",
      );
    }
    await this.syncDocumentsPermissionsFromLicence(licenceId);
  }

  async getAccesDetail(licenceId: string, userId: string, userRole: string) {
    const licence = await prisma.licence.findFirst({
      where: { id: licenceId, deletedAt: null },
      include: licenceInclude,
    });
    if (!licence) throw new Error('NOT_FOUND');
    const admMap = await fetchAdminSansAccesByLicenceIds([licence.id]);
    const merged = mergeAdminSansAcces(licence, admMap);
    if (!canReadLicence(userId, userRole, merged as LicenceAcl)) throw new Error('FORBIDDEN');

    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
    const creator = merged.createdById
      ? await prisma.user.findUnique({
          where: { id: merged.createdById },
          select: { id: true, nom: true, prenom: true, email: true, role: true },
        })
      : null;

    const delegations = merged.permissions.map((p) => ({
      id: p.id,
      permission: p.niveau,
      user: p.user,
      grantedBy: null as null,
      createdAt: p.createdAt,
    }));

    return {
      ficheNom: merged.nom,
      admins,
      creator,
      delegations,
      canManagePermissions: merged.createdById === userId,
      adminSansAccesUserIds: (merged.adminSansAcces || []).map((x) => x.userId),
    };
  }

  async addCommentaire(licenceId: string, auteurId: string, role: string, contenu: string, assigneA: string | null) {
    const licenceRaw = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licenceRaw || licenceRaw.deletedAt) throw new Error('Licence non trouvée');
    const licence = await withAdminSansAcces(licenceRaw);
    if (!licence) throw new Error('Licence non trouvée');
    if (!canReadLicence(auteurId, role, licence as LicenceAcl)) throw new Error('Accès refusé');
    await prisma.licenceCommentaire.create({
      data: {
        licenceId,
        userId: auteurId,
        contenu,
        assigneAId: assigneA || null,
      },
    });

    const auteur = await prisma.user.findUnique({
      where: { id: auteurId },
      select: { nom: true, prenom: true },
    });
    const auteurNom = auteur ? `${auteur.prenom} ${auteur.nom}` : 'Un utilisateur';
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    this.notificationService
      .traiterMentions({
        contenu: contenu.trim(),
        auteurId,
        auteurNom,
        appUrl,
        context: { type: 'licence', id: licenceId, titre: licence.nom },
      })
      .catch((err: unknown) => console.error('[LICENCE] Mentions commentaire:', err));

    return this.findOne(licenceId, auteurId, role);
  }

  async setNotification(
    licenceId: string,
    actorId: string,
    role: string,
    body: {
      mode?: string;
      joursAvant?: number;
      dateAlerte?: string | null;
      recurrence?: string;
      destinataires: string[];
    },
  ) {
    const licenceRaw = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licenceRaw || licenceRaw.deletedAt) throw new Error('Licence non trouvée');
    const licence = await withAdminSansAcces(licenceRaw);
    if (!licence) throw new Error('Licence non trouvée');
    if (!canEditLicenceContent(actorId, role, licence as LicenceAcl)) throw new Error('Accès refusé');

    const mode = body.mode === 'date_recurrence' ? 'date_recurrence' : 'before_end';
    const dest = Array.isArray(body.destinataires) ? body.destinataires.filter((x) => typeof x === 'string' && x.trim()) : [];
    if (dest.length === 0) throw new Error('Sélectionnez au moins un destinataire.');

    if (mode === 'before_end') {
      if (!licence.dateFin) {
        throw new Error('Une date de fin est requise pour une alerte « X jours avant échéance ».');
      }
      const j = Math.max(1, parseInt(String(body.joursAvant ?? 30), 10));
      await prisma.licenceNotification.create({
        data: {
          licenceId,
          mode: 'before_end',
          joursAvant: j,
          dateAlerte: null,
          recurrence: 'none',
          active: true,
          destinataireIds: dest,
        },
      });
    } else {
      if (!body.dateAlerte || !String(body.dateAlerte).trim()) {
        throw new Error('La date de l’alerte est requise pour le mode date / récurrence.');
      }
      const recRaw = (body.recurrence || 'none').toLowerCase();
      const recurrence = ['none', 'weekly', 'monthly', 'yearly'].includes(recRaw) ? recRaw : 'none';
      const d = new Date(body.dateAlerte);
      if (Number.isNaN(d.getTime())) throw new Error('Date d’alerte invalide.');
      await prisma.licenceNotification.create({
        data: {
          licenceId,
          mode: 'date_recurrence',
          joursAvant: 0,
          dateAlerte: d,
          recurrence,
          active: true,
          destinataireIds: dest,
        },
      });
    }
    return this.findOne(licenceId, actorId, role);
  }

  async deleteNotification(licenceId: string, notificationId: string, actorId: string, role: string) {
    const licenceRaw = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licenceRaw || licenceRaw.deletedAt) throw new Error('Licence non trouvée');
    const licence = await withAdminSansAcces(licenceRaw);
    if (!licence) throw new Error('Licence non trouvée');
    if (!canEditLicenceContent(actorId, role, licence as LicenceAcl)) throw new Error('Accès refusé');
    const n = await prisma.licenceNotification.findFirst({
      where: { id: notificationId, licenceId },
    });
    if (!n) throw new Error('Alerte introuvable');
    await prisma.licenceNotification.delete({ where: { id: notificationId } });
    return this.findOne(licenceId, actorId, role);
  }

  /** Aligne DocumentPermission de tous les documents liés sur créateur + utilisateurs autorisés sur la licence. */
  async syncDocumentsPermissionsFromLicence(licenceId: string) {
    await prisma.document.updateMany({
      where: { referenceType: 'licence', referenceId: licenceId, deletedAt: null },
      data: { estConfidentiel: true },
    });

    const licence = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licence || licence.deletedAt) return;
    const userIds = new Set<string>();
    if (licence.createdById) userIds.add(licence.createdById);
    for (const p of licence.permissions) userIds.add(p.userId);
    const ids = [...userIds];
    const docs = await prisma.document.findMany({
      where: { referenceType: 'licence', referenceId: licenceId, deletedAt: null },
      select: { id: true },
    });
    for (const d of docs) {
      await prisma.documentPermission.deleteMany({ where: { documentId: d.id } });
      if (ids.length > 0) {
        await prisma.documentPermission.createMany({
          data: ids.map((userId) => ({ documentId: d.id, userId })),
          skipDuplicates: true,
        });
      }
    }
  }

  async attachUploadedFile(
    licenceId: string,
    actorId: string,
    role: string,
    file: Express.Multer.File,
    nom: string,
  ) {
    const licenceRaw = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licenceRaw || licenceRaw.deletedAt) throw new Error('Licence non trouvée');
    const licence = await withAdminSansAcces(licenceRaw);
    if (!licence) throw new Error('Licence non trouvée');
    if (!canEditLicenceContent(actorId, role, licence as LicenceAcl)) throw new Error('Accès refusé');

    try {
      await fs.access(UPLOAD_DIR);
    } catch {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
    }

    const doc = await prisma.document.create({
      data: {
        nom: nom || file.originalname,
        typeDocument: 'licence',
        referenceType: 'licence',
        referenceId: licenceId,
        fichierUrl: file.filename,
        fichierNomOriginal: file.originalname,
        fichierTaille: file.size,
        fichierType: file.mimetype,
        uploadedById: actorId,
        statut: 'valide',
        estConfidentiel: true,
        version: '1.0.0',
        versionMajeure: 1,
        versionMineure: 0,
      },
    });

    await prisma.licenceDocument.create({
      data: { licenceId, documentId: doc.id },
    });

    await this.syncDocumentsPermissionsFromLicence(licenceId);

    return this.findOne(licenceId, actorId, role);
  }

  /** Rattache un document déjà présent sur la plateforme (mêmes règles d’accès que l’upload). */
  async attachExistingDocument(
    licenceId: string,
    documentId: string,
    actorId: string,
    role: string,
  ) {
    const licenceRaw = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licenceRaw || licenceRaw.deletedAt) throw new Error('Licence non trouvée');
    const licence = await withAdminSansAcces(licenceRaw);
    if (!licence) throw new Error('Licence non trouvée');
    if (!canEditLicenceContent(actorId, role, licence as LicenceAcl)) throw new Error('Accès refusé');

    const { DocumentService } = await import('./document.service');
    const documentService = new DocumentService();
    const canSee = await documentService.canUserAccessDocument(documentId, actorId, role);
    if (!canSee) throw new Error('Accès au document refusé');

    const doc = await prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!doc) throw new Error('Document non trouvé');

    const existingLink = await prisma.licenceDocument.findFirst({
      where: { documentId },
    });
    if (existingLink && existingLink.licenceId !== licenceId) {
      throw new Error('Ce document est déjà lié à une autre licence ou certification');
    }

    await prisma.document.update({
      where: { id: documentId },
      data: {
        typeDocument: 'licence',
        referenceType: 'licence',
        referenceId: licenceId,
        estConfidentiel: true,
      },
    });

    if (!existingLink) {
      await prisma.licenceDocument.create({
        data: { licenceId, documentId },
      });
    }

    await this.syncDocumentsPermissionsFromLicence(licenceId);
    return this.findOne(licenceId, actorId, role);
  }

  async getHistory(licenceId: string, userId: string, role: string) {
    const licenceRaw = await prisma.licence.findUnique({
      where: { id: licenceId },
      include: licenceAclInclude,
    });
    if (!licenceRaw) return null;
    const licence = await withAdminSansAcces(licenceRaw);
    if (!licence) return null;
    if (!canReadLicence(userId, role, licence as LicenceAcl)) return null;
    if (licence.deletedAt && role !== 'admin' && licence.createdById !== userId) return null;

    const entries = await prisma.journalAcces.findMany({
      where: { ressourceType: 'licence', ressourceId: licenceId },
      include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
      orderBy: { timestamp: 'desc' },
      take: 200,
    });
    return entries;
  }

  /** Pour la corbeille admin : toutes les licences supprimées */
  async findAllDeletedAdmin() {
    const list = await prisma.licence.findMany({
      where: { deletedAt: { not: null } },
      include: licenceInclude,
      orderBy: { deletedAt: 'desc' },
    });
    const byLic = await fetchAdminSansAccesByLicenceIds(list.map((l) => l.id));
    return Promise.all(list.map((l) => formatLicenceFull(mergeAdminSansAcces(l, byLic))));
  }
}
