import { prisma } from '../utils/prisma';
import { ResourceType } from '../generated/prisma/enums';
import { PermissionType } from '../generated/prisma/enums';
import { NotificationService } from './notification.service';
import { ProjetService } from './projet.service';

const epicInclude = {
  projet: { select: { id: true, nom: true } },
  assignesEntites: {
    include: { entite: { select: { id: true, nom: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  assignesClientsFournisseurs: {
    include: { clientFournisseur: { select: { id: true, nom: true, type: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  createdBy: { select: { id: true, nom: true, prenom: true } },
  permissions: {
    include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
  },
  adminSansAcces: { select: { userId: true } },
  documents: {
    include: {
      document: {
        select: {
          id: true,
          nom: true,
          typeDocument: true,
          fichierType: true,
          statut: true,
          estConfidentiel: true,
          referenceType: true,
          referenceId: true,
          uploadedById: true,
          uploadedBy: { select: { id: true, nom: true, prenom: true } },
          permissionsUtilisateurs: {
            include: { user: { select: { id: true, nom: true, prenom: true, role: true } } },
          },
          adminSansAcces: { select: { userId: true } },
        },
      },
    },
  },
  userStories: {
    include: {
      taches: { select: { id: true, nom: true, statut: true, projetId: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

const userStoryInclude = {
  createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
  permissions: {
    include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
  },
  adminSansAcces: { select: { userId: true } },
  epic: {
    include: {
      projet: { select: { id: true, nom: true } },
      assignesEntites: {
        include: { entite: { select: { id: true, nom: true } } },
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
  taches: {
    select: { id: true, nom: true, statut: true, projetId: true },
    orderBy: { createdAt: 'desc' as const },
  },
};

const ERR_ACCES_ASSIGNE_TACHE =
  "Impossible de retirer cet accès : l'utilisateur est assigné à une tâche liée à cet élément. Retirez d'abord l'assignation sur la tâche concernée.";

export class EpicService {
  private notificationService = new NotificationService();
  private projetService = new ProjetService();

  /**
   * Synchronise les accès des documents liés aux tâches d'un epic avec les règles d'accès de l'epic.
   * - Permissions explicites documents = permissions explicites epic + uploadeur du document.
   * - Admin sans accès document = admin sans accès epic.
   */
  private async syncEpicAccessToTaskDocuments(epicId: string): Promise<void> {
    const [epicPerms, epicAdminSansAcces, taskDocs] = await Promise.all([
      prisma.epicPermission.findMany({
        where: { epicId },
        select: { userId: true },
      }),
      prisma.epicAdminSansAcces.findMany({
        where: { epicId },
        select: { userId: true },
      }),
      prisma.tacheDocument.findMany({
        where: {
          tache: {
            deletedAt: null,
            userStory: {
              is: {
                deletedAt: null,
                epicId,
              },
            },
          },
          document: { deletedAt: null },
        },
        select: {
          documentId: true,
          document: {
            select: {
              uploadedById: true,
            },
          },
        },
      }),
    ]);

    const adminExcludedIds = [...new Set(epicAdminSansAcces.map((x) => x.userId).filter(Boolean))];
    const explicitEpicUserIds = [...new Set(epicPerms.map((x) => x.userId).filter(Boolean))];
    const byDoc = new Map<string, { uploadedById?: string | null }>();
    for (const row of taskDocs) {
      if (!byDoc.has(row.documentId)) byDoc.set(row.documentId, { uploadedById: row.document?.uploadedById });
    }

    for (const [documentId, info] of byDoc.entries()) {
      const desiredUsers = new Set<string>(explicitEpicUserIds);
      if (info.uploadedById) desiredUsers.add(info.uploadedById);
      const desiredUserIds = [...desiredUsers];

      await prisma.documentPermission.deleteMany({
        where: {
          documentId,
          ...(desiredUserIds.length > 0 ? { userId: { notIn: desiredUserIds } } : {}),
        },
      });
      for (const userId of desiredUserIds) {
        await prisma.documentPermission.upsert({
          where: { documentId_userId: { documentId, userId } },
          create: { documentId, userId },
          update: {},
        });
      }

      await prisma.documentAdminSansAcces.deleteMany({
        where: {
          documentId,
          ...(adminExcludedIds.length > 0 ? { userId: { notIn: adminExcludedIds } } : {}),
        },
      });
      for (const userId of adminExcludedIds) {
        await prisma.documentAdminSansAcces.upsert({
          where: { documentId_userId: { documentId, userId } },
          create: { documentId, userId },
          update: {},
        });
      }
    }
  }

  /** Utilisateur encore présent comme assigné sur au moins une tâche (non supprimée) rattachée à l'epic. */
  private async isUserAssignedToTaskUnderEpic(epicId: string, userId: string): Promise<boolean> {
    const t = await prisma.tache.findFirst({
      where: {
        deletedAt: null,
        userStory: { epicId, deletedAt: null },
        assignesUtilisateurs: { some: { userId } },
      },
      select: { id: true },
    });
    return !!t;
  }

  private async isUserAssignedToTaskUnderUserStory(userStoryId: string, userId: string): Promise<boolean> {
    const t = await prisma.tache.findFirst({
      where: {
        deletedAt: null,
        userStoryId,
        assignesUtilisateurs: { some: { userId } },
      },
      select: { id: true },
    });
    return !!t;
  }

  private async getInheritedEntitesByEpicIds(epicIds: string[]) {
    const map = new Map<string, { id: string; nom: string }[]>();
    if (epicIds.length === 0) return map;

    const rows = await prisma.tache.findMany({
      where: {
        deletedAt: null,
        userStory: {
          is: {
            deletedAt: null,
            epicId: { in: epicIds },
          },
        },
      },
      select: {
        userStory: { select: { epicId: true } },
        assignesEntites: {
          select: {
            entite: { select: { id: true, nom: true } },
          },
        },
      },
    });

    const dedupe = new Map<string, Set<string>>();
    for (const row of rows) {
      const epicId = row.userStory?.epicId;
      if (!epicId) continue;
      if (!dedupe.has(epicId)) dedupe.set(epicId, new Set<string>());
      if (!map.has(epicId)) map.set(epicId, []);

      const seen = dedupe.get(epicId)!;
      const list = map.get(epicId)!;
      for (const ae of row.assignesEntites || []) {
        const ent = ae.entite;
        if (!ent?.id || seen.has(ent.id)) continue;
        seen.add(ent.id);
        list.push({ id: ent.id, nom: ent.nom });
      }
    }

    return map;
  }

  private withEpicInheritedEntites<T extends { id: string; assignesEntites?: any[] }>(
    epics: T[],
    inheritedByEpic: Map<string, { id: string; nom: string }[]>
  ): Array<T & { entitesHeritees: { id: string; nom: string }[]; assignesEntitesEffectives: { entite: { id: string; nom: string } }[] }> {
    return epics.map((ep) => {
      const direct = (ep.assignesEntites || []).map((ae: any) => ({
        id: ae.entite?.id ?? ae.entiteId,
        nom: ae.entite?.nom,
      }));
      const inherited = inheritedByEpic.get(ep.id) || [];
      const seen = new Set<string>();
      const merged: { entite: { id: string; nom: string } }[] = [];

      for (const ent of [...direct, ...inherited]) {
        if (!ent?.id || seen.has(ent.id)) continue;
        seen.add(ent.id);
        merged.push({ entite: { id: ent.id, nom: ent.nom || '—' } });
      }

      return {
        ...ep,
        entitesHeritees: inherited,
        assignesEntitesEffectives: merged,
      };
    });
  }

  private async collectUserIdsPourTachesUserStories(userStoryIds: string[], authorId: string) {
    if (userStoryIds.length === 0) return new Set<string>();
    const taches = await prisma.tache.findMany({
      where: { userStoryId: { in: userStoryIds }, deletedAt: null },
      select: {
        createurId: true,
        assignesUtilisateurs: { include: { user: { select: { id: true } } } },
      },
    });
    const ids = new Set<string>();
    for (const t of taches) {
      if (t.createurId && t.createurId !== authorId) ids.add(t.createurId);
      for (const tu of t.assignesUtilisateurs) {
        if (tu.user.id !== authorId) ids.add(tu.user.id);
      }
    }
    return ids;
  }

  private async destinatairesCommentaireEpic(epicId: string, authorId: string) {
    const epic = await prisma.epic.findUnique({
      where: { id: epicId },
      select: { nom: true, createdById: true },
    });
    if (!epic) throw new Error('Epic introuvable');
    const uss = await prisma.userStory.findMany({
      where: { epicId },
      select: { id: true },
    });
    const usIds = uss.map((u) => u.id);
    const userIds = await this.collectUserIdsPourTachesUserStories(usIds, authorId);
    if (epic.createdById && epic.createdById !== authorId) userIds.add(epic.createdById);
    if (userIds.size === 0) return { destinataires: [] as { id: string; email: string; nom: string }[], cibleNom: epic.nom };
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, email: true, nom: true, prenom: true },
    });
    return {
      cibleNom: epic.nom,
      destinataires: users.map((u) => ({ id: u.id, email: u.email, nom: `${u.prenom} ${u.nom}` })),
    };
  }

  private async destinatairesCommentaireUserStory(userStoryId: string, authorId: string) {
    const us = await prisma.userStory.findUnique({
      where: { id: userStoryId },
      select: { description: true },
    });
    if (!us) throw new Error('User story introuvable');
    const titre =
      us.description.length > 120 ? `${us.description.slice(0, 117)}…` : us.description;
    const userIds = await this.collectUserIdsPourTachesUserStories([userStoryId], authorId);
    if (userIds.size === 0) return { destinataires: [] as { id: string; email: string; nom: string }[], cibleNom: titre };
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, email: true, nom: true, prenom: true },
    });
    return {
      cibleNom: titre,
      destinataires: users.map((u) => ({ id: u.id, email: u.email, nom: `${u.prenom} ${u.nom}` })),
    };
  }

  async listEpics(filters: { projetId?: string; requesterId?: string; requesterRole?: string }) {
    const where: any = { deletedAt: null };
    if (filters.projetId) where.projetId = filters.projetId;
    const rows = await prisma.epic.findMany({
      where,
      include: epicInclude,
      orderBy: { updatedAt: 'desc' },
    });
    let scopedRows = rows;
    if (filters.requesterId && filters.requesterRole) {
      const visible: typeof rows = [];
      for (const row of rows) {
        if (await this.canViewEpicByProjet(row.id, filters.requesterId, filters.requesterRole)) {
          visible.push(row);
        }
      }
      scopedRows = visible;
    }
    const inherited = await this.getInheritedEntitesByEpicIds(scopedRows.map((r) => r.id));
    return this.withEpicInheritedEntites(scopedRows as any[], inherited) as any;
  }

  async getEpic(id: string) {
    const epic = await prisma.epic.findFirst({
      where: { id, deletedAt: null },
      include: epicInclude,
    });
    if (!epic) return null;
    const inherited = await this.getInheritedEntitesByEpicIds([epic.id]);
    return this.withEpicInheritedEntites([epic as any], inherited)[0] as any;
  }

  async updateEpic(
    id: string,
    data: {
      nom?: string;
      description?: string | null;
      projetId?: string;
      entiteIds?: string[];
      assignesClientFournisseurIds?: string[];
    }
  ) {
    const ep = await prisma.epic.findFirst({ where: { id, deletedAt: null } });
    if (!ep) throw new Error('Epic introuvable');

    const dataEpic: { nom?: string; description?: string | null; projetId?: string } = {};
    if (data.nom !== undefined) dataEpic.nom = data.nom.trim();
    if (data.description !== undefined) dataEpic.description = data.description?.trim() || null;
    if (data.projetId !== undefined) dataEpic.projetId = data.projetId;

    await prisma.$transaction(async (tx) => {
      if (Object.keys(dataEpic).length > 0) {
        await tx.epic.update({ where: { id }, data: dataEpic });
      }
      if (data.entiteIds !== undefined) {
        await tx.epicEntite.deleteMany({ where: { epicId: id } });
        const unique = [...new Set(data.entiteIds.map((e) => e.trim()).filter(Boolean))];
        if (unique.length > 0) {
          await tx.epicEntite.createMany({
            data: unique.map((entiteId) => ({ epicId: id, entiteId })),
          });
        }
      }
      if (data.assignesClientFournisseurIds !== undefined) {
        await tx.epicClientFournisseur.deleteMany({ where: { epicId: id } });
        const uniqueCf = [...new Set(data.assignesClientFournisseurIds.map((c) => c.trim()).filter(Boolean))];
        if (uniqueCf.length > 0) {
          await tx.epicClientFournisseur.createMany({
            data: uniqueCf.map((clientFournisseurId) => ({ epicId: id, clientFournisseurId })),
            skipDuplicates: true,
          });
        }
      }
    });

    return this.getEpic(id);
  }

  async createEpic(data: {
    nom: string;
    description?: string | null;
    projetId: string;
    entiteIds?: string[];
    entiteId?: string | null;
    createdById?: string | null;
    documentIds?: string[];
    userStoryIdsToAttach?: string[];
    assignesClientFournisseurIds?: string[];
  }) {
    const {
      documentIds = [],
      userStoryIdsToAttach = [],
      entiteIds = [],
      entiteId,
      assignesClientFournisseurIds = [],
      ...rest
    } = data;
    const entiteIdSet = new Set<string>();
    for (const id of entiteIds) {
      if (id?.trim()) entiteIdSet.add(id.trim());
    }
    if (entiteId?.trim()) entiteIdSet.add(entiteId.trim());

    const epic = await prisma.epic.create({
      data: {
        nom: rest.nom.trim(),
        description: rest.description?.trim() || null,
        projetId: rest.projetId,
        createdById: rest.createdById || null,
        ...(entiteIdSet.size > 0
          ? {
              assignesEntites: {
                create: [...entiteIdSet].map((eid) => ({ entiteId: eid })),
              },
            }
          : {}),
        ...(documentIds.length > 0
          ? {
              documents: {
                create: documentIds.map((documentId) => ({ documentId })),
              },
            }
          : {}),
        ...(assignesClientFournisseurIds.length > 0
          ? {
              assignesClientsFournisseurs: {
                create: [...new Set(assignesClientFournisseurIds.map((c) => c.trim()).filter(Boolean))].map(
                  (clientFournisseurId) => ({ clientFournisseurId })
                ),
              },
            }
          : {}),
      },
      include: epicInclude,
    });

    if (userStoryIdsToAttach.length > 0) {
      await prisma.userStory.updateMany({
        where: { id: { in: userStoryIdsToAttach }, deletedAt: null },
        data: { epicId: epic.id },
      });
    }

    return this.getEpic(epic.id);
  }

  async lierDocumentEpic(epicId: string, documentId: string) {
    const ep = await prisma.epic.findFirst({ where: { id: epicId, deletedAt: null } });
    if (!ep) throw new Error('Epic introuvable');
    return prisma.epicDocument.upsert({
      where: { epicId_documentId: { epicId, documentId } },
      create: { epicId, documentId },
      update: {},
    });
  }

  async delierDocumentEpic(epicId: string, documentId: string) {
    const ep = await prisma.epic.findFirst({ where: { id: epicId, deletedAt: null } });
    if (!ep) throw new Error('Epic introuvable');
    await prisma.epicDocument.deleteMany({ where: { epicId, documentId } });
  }

  async uploadDocumentEpic(
    epicId: string,
    userId: string,
    fichier: Express.Multer.File,
    nom: string,
    description?: string,
    permissionUserIds?: string[]
  ) {
    const ep = await prisma.epic.findFirst({ where: { id: epicId, deletedAt: null } });
    if (!ep) throw new Error('Epic introuvable');
    const permSet = new Set<string>();
    for (const id of permissionUserIds || []) {
      if (id?.trim()) permSet.add(id.trim());
    }
    const explicitPerms = [...permSet].filter((uid) => uid !== userId);
    const document = await prisma.document.create({
      data: {
        nom: nom || fichier.originalname,
        typeDocument: 'epic',
        referenceType: 'epic',
        referenceId: epicId,
        fichierUrl: fichier.path,
        fichierNomOriginal: fichier.originalname,
        fichierTaille: fichier.size,
        fichierType: fichier.mimetype,
        description: description || null,
        statut: 'valide',
        uploadedById: userId,
        estConfidentiel: true,
        ...(explicitPerms.length > 0
          ? {
              permissionsUtilisateurs: {
                create: explicitPerms.map((uid) => ({ userId: uid })),
              },
            }
          : {}),
      },
    });
    await prisma.epicDocument.create({
      data: { epicId, documentId: document.id },
    });
    return document;
  }

  async uploadDocumentUserStory(
    userStoryId: string,
    userId: string,
    fichier: Express.Multer.File,
    nom: string,
    description?: string,
    permissionUserIds?: string[]
  ) {
    const us = await prisma.userStory.findFirst({ where: { id: userStoryId, deletedAt: null } });
    if (!us) throw new Error('User story introuvable');
    const permSet = new Set<string>();
    for (const id of permissionUserIds || []) {
      if (id?.trim()) permSet.add(id.trim());
    }
    const explicitPerms = [...permSet].filter((uid) => uid !== userId);
    return prisma.document.create({
      data: {
        nom: nom || fichier.originalname,
        typeDocument: 'user_story',
        referenceType: 'userStory',
        referenceId: userStoryId,
        fichierUrl: fichier.path,
        fichierNomOriginal: fichier.originalname,
        fichierTaille: fichier.size,
        fichierType: fichier.mimetype,
        description: description || null,
        statut: 'valide',
        uploadedById: userId,
        estConfidentiel: true,
        ...(explicitPerms.length > 0
          ? {
              permissionsUtilisateurs: {
                create: explicitPerms.map((uid) => ({ userId: uid })),
              },
            }
          : {}),
      },
    });
  }

  async listUserStories(filters: {
    epicId?: string;
    projetId?: string;
    orphelines?: boolean;
    requesterId?: string;
    requesterRole?: string;
  }) {
    const parts: object[] = [
      { deletedAt: null },
      { OR: [{ epicId: null }, { epic: { deletedAt: null } }] },
    ];
    if (filters.epicId) parts.push({ epicId: filters.epicId });
    if (filters.orphelines) parts.push({ epicId: null });
    if (filters.projetId) {
      parts.push({
        OR: [
          { epic: { projetId: filters.projetId, deletedAt: null } },
          {
            AND: [
              { epicId: null },
              { taches: { some: { projetId: filters.projetId, deletedAt: null } } },
            ],
          },
        ],
      });
    }
    const where = parts.length === 1 ? parts[0] : { AND: parts };
    let rows = await prisma.userStory.findMany({
      where,
      include: userStoryInclude,
      orderBy: { updatedAt: 'desc' },
    });
    if (filters.requesterId && filters.requesterRole) {
      const vis: typeof rows = [];
      for (const r of rows) {
        if (r.epicId) {
          if (await this.canViewEpicByProjet(r.epicId, filters.requesterId, filters.requesterRole)) vis.push(r);
        } else if (filters.requesterRole === 'admin' || r.createdById === filters.requesterId) {
          vis.push(r);
        }
      }
      rows = vis;
    }
    if (rows.length === 0) return rows;
    const usIds = rows.map((r) => r.id);
    const natifs = await prisma.document.findMany({
      where: { deletedAt: null, referenceType: 'userStory', referenceId: { in: usIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nom: true,
        typeDocument: true,
        fichierType: true,
        statut: true,
        estConfidentiel: true,
        referenceType: true,
        referenceId: true,
        uploadedById: true,
        uploadedBy: { select: { id: true, nom: true, prenom: true } },
        permissionsUtilisateurs: {
          include: { user: { select: { id: true, nom: true, prenom: true, role: true } } },
        },
        adminSansAcces: { select: { userId: true } },
      },
    });
    const byUs = new Map<string, typeof natifs>();
    for (const d of natifs) {
      const rid = d.referenceId;
      if (!rid) continue;
      const arr = byUs.get(rid) ?? [];
      arr.push(d);
      byUs.set(rid, arr);
    }
    const epicIds = rows.map((r) => r.epic?.id).filter(Boolean) as string[];
    const inheritedByEpic = await this.getInheritedEntitesByEpicIds([...new Set(epicIds)]);
    return rows.map((r) => {
      if (!r.epic) return { ...r, documentsNatifs: byUs.get(r.id) ?? [] };
      const enrichedEpic = this.withEpicInheritedEntites([r.epic as any], inheritedByEpic)[0];
      return { ...r, epic: enrichedEpic, documentsNatifs: byUs.get(r.id) ?? [] };
    });
  }

  async getUserStory(id: string) {
    const us = await prisma.userStory.findFirst({
      where: { id, deletedAt: null },
      include: userStoryInclude,
    });
    if (!us) return null;
    const documentsNatifs = await prisma.document.findMany({
      where: { deletedAt: null, referenceType: 'userStory', referenceId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        nom: true,
        typeDocument: true,
        fichierType: true,
        statut: true,
        estConfidentiel: true,
        referenceType: true,
        referenceId: true,
        uploadedById: true,
        uploadedBy: { select: { id: true, nom: true, prenom: true } },
        permissionsUtilisateurs: {
          include: { user: { select: { id: true, nom: true, prenom: true, role: true } } },
        },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!us.epic) return { ...us, documentsNatifs };
    const inheritedByEpic = await this.getInheritedEntitesByEpicIds([us.epic.id]);
    const enrichedEpic = this.withEpicInheritedEntites([us.epic as any], inheritedByEpic)[0];
    return { ...us, epic: enrichedEpic, documentsNatifs };
  }

  async createUserStory(data: {
    description: string;
    epicId: string;
    createdById: string;
    tacheIds?: string[];
  }) {
    const epic = await prisma.epic.findFirst({
      where: { id: data.epicId, deletedAt: null },
    });
    if (!epic) throw new Error('Epic introuvable ou supprimé');

    const tacheIds = data.tacheIds || [];
    const us = await prisma.userStory.create({
      data: {
        description: data.description.trim(),
        epicId: data.epicId,
        createdById: data.createdById,
      },
    });
    if (tacheIds.length > 0) {
      await prisma.tache.updateMany({
        where: { id: { in: tacheIds }, deletedAt: null },
        data: { userStoryId: us.id },
      });
    }
    return this.getUserStory(us.id);
  }

  private async canViewEpicByProjet(epicId: string, userId: string, role: string): Promise<boolean> {
    const epic = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      select: { projetId: true },
    });
    if (!epic) return false;
    if (role === 'admin') {
      const excluded = await prisma.epicAdminSansAcces.findFirst({ where: { epicId, userId } });
      if (!excluded) return true;
      const explicit = await prisma.epicPermission.findFirst({ where: { epicId, userId } });
      return !!explicit;
    }
    const { canAccess } = await this.projetService.canAccess(epic.projetId, userId, role);
    if (canAccess) return true;
    return !!(await prisma.epicPermission.findFirst({ where: { epicId, userId } }));
  }

  async getEpicAccesDetail(epicId: string, requesterId: string, requesterRole: string) {
    const epic = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        permissions: {
          include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
        },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!epic) return null;
    const canView = await this.canViewEpicByProjet(epicId, requesterId, requesterRole);
    if (!canView) throw new Error('Accès refusé');
    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
    return {
      admins,
      creator: epic.createdBy,
      delegations: epic.permissions.map((p) => ({
        id: p.id,
        user: p.user,
        permission: p.permission,
      })),
      adminSansAccesUserIds: epic.adminSansAcces.map((x) => x.userId),
      canManagePermissions: epic.createdById === requesterId,
    };
  }

  async addEpicPermission(epicId: string, targetUserId: string, permission: PermissionType, actorId: string) {
    const epic = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!epic) throw new Error('Epic introuvable');
    if (epic.createdById !== actorId) throw new Error('Accès refusé');
    if (targetUserId === epic.createdById) throw new Error("Le créateur dispose déjà de tous les droits");
    await prisma.epicAdminSansAcces.deleteMany({ where: { epicId, userId: targetUserId } });
    await prisma.epicPermission.upsert({
      where: { epicId_userId: { epicId, userId: targetUserId } },
      create: { epicId, userId: targetUserId, permission },
      update: { permission },
    });
    await this.syncEpicAccessToTaskDocuments(epicId);
  }

  async updateEpicPermission(epicId: string, permissionId: string, permission: PermissionType, actorId: string) {
    const epic = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!epic) throw new Error('Epic introuvable');
    if (epic.createdById !== actorId) throw new Error('Accès refusé');
    const row = await prisma.epicPermission.findFirst({ where: { id: permissionId, epicId } });
    if (!row) throw new Error('Permission introuvable');
    await prisma.epicPermission.update({ where: { id: permissionId }, data: { permission } });
    await this.syncEpicAccessToTaskDocuments(epicId);
  }

  async removeEpicPermission(epicId: string, permissionId: string, actorId: string) {
    const epic = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!epic) throw new Error('Epic introuvable');
    if (epic.createdById !== actorId) throw new Error('Accès refusé');
    const row = await prisma.epicPermission.findFirst({
      where: { id: permissionId, epicId },
      include: { user: { select: { role: true } } },
    });
    if (!row) throw new Error('Permission introuvable');
    if (await this.isUserAssignedToTaskUnderEpic(epicId, row.userId)) {
      throw new Error(ERR_ACCES_ASSIGNE_TACHE);
    }
    await prisma.epicPermission.delete({ where: { id: permissionId } });
    if (row.user.role === 'admin') {
      await prisma.epicAdminSansAcces.upsert({
        where: { epicId_userId: { epicId, userId: row.userId } },
        create: { epicId, userId: row.userId },
        update: {},
      });
    }
    await this.syncEpicAccessToTaskDocuments(epicId);
  }

  async blockEpicAdminImplicit(epicId: string, targetUserId: string, actorId: string) {
    const epic = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!epic) throw new Error('Epic introuvable');
    if (epic.createdById !== actorId) throw new Error('Accès refusé');
    if (epic.createdById === targetUserId) throw new Error("Le créateur ne peut pas être exclu");
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
    if (!target || target.role !== 'admin') throw new Error("Seuls les administrateurs peuvent être exclus");
    if (await this.isUserAssignedToTaskUnderEpic(epicId, targetUserId)) {
      throw new Error(ERR_ACCES_ASSIGNE_TACHE);
    }
    await prisma.epicPermission.deleteMany({ where: { epicId, userId: targetUserId } });
    await prisma.epicAdminSansAcces.upsert({
      where: { epicId_userId: { epicId, userId: targetUserId } },
      create: { epicId, userId: targetUserId },
      update: {},
    });
    await this.syncEpicAccessToTaskDocuments(epicId);
  }

  async restoreEpicAdminImplicit(epicId: string, targetUserId: string, actorId: string) {
    const epic = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!epic) throw new Error('Epic introuvable');
    if (epic.createdById !== actorId) throw new Error('Accès refusé');
    await prisma.epicAdminSansAcces.deleteMany({ where: { epicId, userId: targetUserId } });
    await this.syncEpicAccessToTaskDocuments(epicId);
  }

  async getUserStoryAccesDetail(userStoryId: string, requesterId: string, requesterRole: string) {
    const us = await prisma.userStory.findFirst({
      where: { id: userStoryId, deletedAt: null },
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        permissions: {
          include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
        },
        adminSansAcces: { select: { userId: true } },
        epic: { select: { id: true, projetId: true } },
      },
    });
    if (!us) return null;
    const canView = us.epic?.id
      ? await this.canViewEpicByProjet(us.epic.id, requesterId, requesterRole)
      : requesterRole === 'admin' || us.createdById === requesterId;
    if (!canView) throw new Error('Accès refusé');
    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
    return {
      admins,
      creator: us.createdBy,
      delegations: us.permissions.map((p) => ({
        id: p.id,
        user: p.user,
        permission: p.permission,
      })),
      adminSansAccesUserIds: us.adminSansAcces.map((x) => x.userId),
      canManagePermissions: us.createdById === requesterId,
    };
  }

  async addUserStoryPermission(
    userStoryId: string,
    targetUserId: string,
    permission: PermissionType,
    actorId: string
  ) {
    const us = await prisma.userStory.findFirst({
      where: { id: userStoryId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!us) throw new Error('User story introuvable');
    if (us.createdById !== actorId) throw new Error('Accès refusé');
    if (targetUserId === us.createdById) throw new Error("Le créateur dispose déjà de tous les droits");
    await prisma.userStoryAdminSansAcces.deleteMany({ where: { userStoryId, userId: targetUserId } });
    await prisma.userStoryPermission.upsert({
      where: { userStoryId_userId: { userStoryId, userId: targetUserId } },
      create: { userStoryId, userId: targetUserId, permission },
      update: { permission },
    });
  }

  async updateUserStoryPermission(
    userStoryId: string,
    permissionId: string,
    permission: PermissionType,
    actorId: string
  ) {
    const us = await prisma.userStory.findFirst({
      where: { id: userStoryId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!us) throw new Error('User story introuvable');
    if (us.createdById !== actorId) throw new Error('Accès refusé');
    const row = await prisma.userStoryPermission.findFirst({ where: { id: permissionId, userStoryId } });
    if (!row) throw new Error('Permission introuvable');
    await prisma.userStoryPermission.update({ where: { id: permissionId }, data: { permission } });
  }

  async removeUserStoryPermission(userStoryId: string, permissionId: string, actorId: string) {
    const us = await prisma.userStory.findFirst({
      where: { id: userStoryId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!us) throw new Error('User story introuvable');
    if (us.createdById !== actorId) throw new Error('Accès refusé');
    const row = await prisma.userStoryPermission.findFirst({
      where: { id: permissionId, userStoryId },
      include: { user: { select: { role: true } } },
    });
    if (!row) throw new Error('Permission introuvable');
    if (await this.isUserAssignedToTaskUnderUserStory(userStoryId, row.userId)) {
      throw new Error(ERR_ACCES_ASSIGNE_TACHE);
    }
    await prisma.userStoryPermission.delete({ where: { id: permissionId } });
    if (row.user.role === 'admin') {
      await prisma.userStoryAdminSansAcces.upsert({
        where: { userStoryId_userId: { userStoryId, userId: row.userId } },
        create: { userStoryId, userId: row.userId },
        update: {},
      });
    }
  }

  async blockUserStoryAdminImplicit(userStoryId: string, targetUserId: string, actorId: string) {
    const us = await prisma.userStory.findFirst({
      where: { id: userStoryId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!us) throw new Error('User story introuvable');
    if (us.createdById !== actorId) throw new Error('Accès refusé');
    if (us.createdById === targetUserId) throw new Error("Le créateur ne peut pas être exclu");
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
    if (!target || target.role !== 'admin') throw new Error("Seuls les administrateurs peuvent être exclus");
    if (await this.isUserAssignedToTaskUnderUserStory(userStoryId, targetUserId)) {
      throw new Error(ERR_ACCES_ASSIGNE_TACHE);
    }
    await prisma.userStoryPermission.deleteMany({ where: { userStoryId, userId: targetUserId } });
    await prisma.userStoryAdminSansAcces.upsert({
      where: { userStoryId_userId: { userStoryId, userId: targetUserId } },
      create: { userStoryId, userId: targetUserId },
      update: {},
    });
  }

  async restoreUserStoryAdminImplicit(userStoryId: string, targetUserId: string, actorId: string) {
    const us = await prisma.userStory.findFirst({
      where: { id: userStoryId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!us) throw new Error('User story introuvable');
    if (us.createdById !== actorId) throw new Error('Accès refusé');
    await prisma.userStoryAdminSansAcces.deleteMany({ where: { userStoryId, userId: targetUserId } });
  }

  async updateUserStory(
    id: string,
    data: {
      description?: string;
      epicId?: string | null;
      tacheIds?: string[];
    }
  ) {
    const existing = await prisma.userStory.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new Error('User story introuvable');

    if (data.epicId !== undefined && data.epicId !== null) {
      const ep = await prisma.epic.findFirst({
        where: { id: data.epicId, deletedAt: null },
      });
      if (!ep) throw new Error('Epic introuvable ou supprimé');
    }

    if (data.description !== undefined || data.epicId !== undefined) {
      await prisma.userStory.update({
        where: { id },
        data: {
          ...(data.description !== undefined && { description: data.description.trim() }),
          ...(data.epicId !== undefined && { epicId: data.epicId }),
        },
      });
    }
    if (data.tacheIds !== undefined) {
      await prisma.tache.updateMany({
        where: { userStoryId: id, deletedAt: null },
        data: { userStoryId: null },
      });
      if (data.tacheIds.length > 0) {
        await prisma.tache.updateMany({
          where: { id: { in: data.tacheIds }, deletedAt: null },
          data: { userStoryId: id },
        });
      }
    }
    return this.getUserStory(id);
  }

  // ── Commentaires epic ───────────────────────────────────────────────────────
  async getCommentairesEpic(epicId: string) {
    return prisma.epicCommentaire
      .findMany({
        where: { epicId },
        include: { user: { select: { id: true, nom: true, prenom: true } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((list) => list.map((c) => ({ ...c, auteur: c.user })));
  }

  async addCommentaireEpic(epicId: string, userId: string, contenu: string, fichier?: Express.Multer.File) {
    const ep = await prisma.epic.findFirst({
      where: { id: epicId, deletedAt: null },
      select: { nom: true },
    });
    if (!ep) throw new Error('Epic introuvable');

    const commentaire = await prisma.epicCommentaire.create({
      data: {
        epicId,
        userId,
        contenu,
        pieceJointeNom: fichier?.originalname || null,
        pieceJointePath: fichier?.path || null,
        pieceJointeType: fichier?.mimetype || null,
      },
      include: { user: { select: { id: true, nom: true, prenom: true } } },
    });

    const auteurNom = `${commentaire.user.prenom} ${commentaire.user.nom}`;
    const appUrl = process.env.FRONTEND_URL || 'http://172.17.5.198:5173';

    this.notificationService
      .traiterMentions({
        contenu,
        auteurId: userId,
        auteurNom,
        appUrl,
        context: { type: 'epic', id: epicId, titre: ep.nom },
      })
      .catch((err: unknown) => console.error('[MENTIONS epic]', err));

    const { destinataires, cibleNom } = await this.destinatairesCommentaireEpic(epicId, userId);
    if (destinataires.length > 0) {
      const auteurUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { nom: true, prenom: true },
      });
      const nomAuteur = auteurUser ? `${auteurUser.prenom} ${auteurUser.nom}` : 'Un utilisateur';
      this.notificationService
        .notifierCommentaireSurCible({
          cibleType: 'epic',
          cibleId: epicId,
          cibleNom,
          commentaire: contenu,
          destinataires,
          auteurNom: nomAuteur,
          appUrl,
        })
        .catch(() => {});
    }

    return { ...commentaire, auteur: commentaire.user };
  }

  async getEpicCommentaireFichier(commentaireId: string) {
    return prisma.epicCommentaire.findUnique({
      where: { id: commentaireId },
      select: { pieceJointePath: true, pieceJointeNom: true, pieceJointeType: true },
    });
  }

  // ── Commentaires user story ────────────────────────────────────────────────
  async getCommentairesUserStory(userStoryId: string) {
    return prisma.userStoryCommentaire
      .findMany({
        where: { userStoryId },
        include: { user: { select: { id: true, nom: true, prenom: true } } },
        orderBy: { createdAt: 'asc' },
      })
      .then((list) => list.map((c) => ({ ...c, auteur: c.user })));
  }

  async addCommentaireUserStory(
    userStoryId: string,
    userId: string,
    contenu: string,
    fichier?: Express.Multer.File
  ) {
    const usRow = await prisma.userStory.findFirst({
      where: { id: userStoryId, deletedAt: null },
      select: { description: true },
    });
    if (!usRow) throw new Error('User story introuvable');
    const titreCourt =
      usRow.description.length > 120
        ? `${usRow.description.slice(0, 117)}…`
        : usRow.description;

    const commentaire = await prisma.userStoryCommentaire.create({
      data: {
        userStoryId,
        userId,
        contenu,
        pieceJointeNom: fichier?.originalname || null,
        pieceJointePath: fichier?.path || null,
        pieceJointeType: fichier?.mimetype || null,
      },
      include: { user: { select: { id: true, nom: true, prenom: true } } },
    });

    const auteurNom = `${commentaire.user.prenom} ${commentaire.user.nom}`;
    const appUrl = process.env.FRONTEND_URL || 'http://172.17.5.198:5173';

    this.notificationService
      .traiterMentions({
        contenu,
        auteurId: userId,
        auteurNom,
        appUrl,
        context: { type: 'userStory', id: userStoryId, titre: titreCourt },
      })
      .catch((err: unknown) => console.error('[MENTIONS user story]', err));

    const { destinataires, cibleNom } = await this.destinatairesCommentaireUserStory(userStoryId, userId);
    if (destinataires.length > 0) {
      const auteurUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { nom: true, prenom: true },
      });
      const nomAuteur = auteurUser ? `${auteurUser.prenom} ${auteurUser.nom}` : 'Un utilisateur';
      this.notificationService
        .notifierCommentaireSurCible({
          cibleType: 'userStory',
          cibleId: userStoryId,
          cibleNom,
          commentaire: contenu,
          destinataires,
          auteurNom: nomAuteur,
          appUrl,
        })
        .catch(() => {});
    }

    return { ...commentaire, auteur: commentaire.user };
  }

  async getUserStoryCommentaireFichier(commentaireId: string) {
    return prisma.userStoryCommentaire.findUnique({
      where: { id: commentaireId },
      select: { pieceJointePath: true, pieceJointeNom: true, pieceJointeType: true },
    });
  }

  // ── Corbeille (soft delete / restauration) ─────────────────────────────────
  async softDeleteEpic(id: string, _userId: string, role: string) {
    const ep = await prisma.epic.findFirst({ where: { id, deletedAt: null } });
    if (!ep) throw new Error('Epic introuvable');
    if (role === 'lecteur') throw new Error('Accès refusé');
    if (role !== 'admin' && role !== 'contributeur') throw new Error('Accès refusé');
    await prisma.epic.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restoreEpic(id: string, userId: string, role: string) {
    const ep = await prisma.epic.findUnique({ where: { id } });
    if (!ep || !ep.deletedAt) throw new Error('Epic introuvable dans la corbeille');
    if (role !== 'admin' && ep.createdById !== userId) throw new Error('Accès refusé');
    await prisma.epic.update({ where: { id }, data: { deletedAt: null } });
    return this.getEpic(id);
  }

  async listEpicsCorbeille(userId: string, role: string) {
    if (role === 'lecteur') return [];
    const where: Record<string, unknown> = { deletedAt: { not: null } };
    if (role === 'contributeur') (where as any).createdById = userId;
    return prisma.epic.findMany({
      where,
      include: {
        projet: { select: { id: true, nom: true } },
        createdBy: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async deleteEpicPermanent(id: string) {
    const ep = await prisma.epic.findUnique({ where: { id } });
    if (!ep || !ep.deletedAt) throw new Error('Epic introuvable ou non en corbeille');
    await prisma.epic.delete({ where: { id } });
  }

  async softDeleteUserStory(id: string, _userId: string, role: string) {
    const us = await prisma.userStory.findFirst({ where: { id, deletedAt: null } });
    if (!us) throw new Error('User story introuvable');
    if (role === 'lecteur') throw new Error('Accès refusé');
    if (role !== 'admin' && role !== 'contributeur') throw new Error('Accès refusé');
    await prisma.userStory.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async userStoryRestoreAllowed(userId: string, role: string, usId: string) {
    if (role === 'admin') return true;
    if (role !== 'contributeur') return false;
    const us = await prisma.userStory.findUnique({
      where: { id: usId },
      include: {
        epic: { select: { createdById: true, deletedAt: true } },
        taches: {
          where: { deletedAt: null },
          select: {
            createurId: true,
            assignesUtilisateurs: { select: { userId: true } },
          },
        },
      },
    });
    if (!us) return false;
    if (us.epic && !us.epic.deletedAt && us.epic.createdById === userId) return true;
    return us.taches.some(
      (t) =>
        t.createurId === userId || t.assignesUtilisateurs.some((a) => a.userId === userId)
    );
  }

  async restoreUserStory(id: string, userId: string, role: string) {
    const us = await prisma.userStory.findUnique({ where: { id } });
    if (!us || !us.deletedAt) throw new Error('User story introuvable dans la corbeille');
    if (!(await this.userStoryRestoreAllowed(userId, role, id))) throw new Error('Accès refusé');
    await prisma.userStory.update({ where: { id }, data: { deletedAt: null } });
    return this.getUserStory(id);
  }

  async listUserStoriesCorbeille(userId: string, role: string) {
    if (role === 'lecteur') return [];
    if (role === 'admin') {
      return prisma.userStory.findMany({
        where: { deletedAt: { not: null } },
        include: {
          epic: { select: { id: true, nom: true, projetId: true, projet: { select: { nom: true } } } },
        },
        orderBy: { deletedAt: 'desc' },
      });
    }
    return prisma.userStory.findMany({
      where: {
        deletedAt: { not: null },
        OR: [
          { epic: { is: { createdById: userId, deletedAt: null } } },
          {
            taches: {
              some: {
                deletedAt: null,
                OR: [
                  { createurId: userId },
                  { assignesUtilisateurs: { some: { userId } } },
                ],
              },
            },
          },
        ],
      },
      include: {
        epic: { select: { id: true, nom: true, projetId: true, projet: { select: { nom: true } } } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async deleteUserStoryPermanent(id: string) {
    const us = await prisma.userStory.findUnique({ where: { id } });
    if (!us || !us.deletedAt) throw new Error('User story introuvable ou non en corbeille');
    await prisma.userStory.delete({ where: { id } });
  }

  async getEpicJournalHistory(epicId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = {
      OR: [
        { ressourceType: ResourceType.epic, ressourceId: epicId },
        {
          ressourceType: ResourceType.projet,
          ressourceId: epicId,
          details: { path: ['type'], equals: 'epic' },
        },
      ],
    };
    const [total, data] = await Promise.all([
      prisma.journalAcces.count({ where }),
      prisma.journalAcces.findMany({
        where,
        include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return {
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  async getUserStoryJournalHistory(userStoryId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = {
      OR: [
        { ressourceType: ResourceType.userStory, ressourceId: userStoryId },
        {
          ressourceType: ResourceType.projet,
          ressourceId: userStoryId,
          details: { path: ['type'], equals: 'user_story' },
        },
      ],
    };
    const [total, data] = await Promise.all([
      prisma.journalAcces.count({ where }),
      prisma.journalAcces.findMany({
        where,
        include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return {
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }
}
