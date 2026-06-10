import { prisma } from '../utils/prisma';
import { DocType, DocStatut, RefType, type Prisma } from '../generated/prisma/client';
import { canEditLicenceContent, canReadLicence, loadLicenceForAclById } from './licence.service';
import { canViewPvReunion } from './pv-reunion.service';
import { ProcessusService } from './processus.service';
import { ProjetService } from './projet.service';
import { EntiteService } from './entite.service';
import { clientFournisseurService } from './client-fournisseur.service';
import { promises as fs } from 'fs';
import * as path from 'path';
import { getEntiteDescendantIds, getUserDirectEntiteIds, keepMostSpecificEntiteIds } from '../utils/entiteScope';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

/** Include réutilisé pour la liste documents (typage du fallback [] si la requête échoue). */
const DOCUMENT_CONTRAT_LIST_INCLUDE = {
  contrat: {
    select: {
      id: true,
      nom: true,
      statut: true,
      createdById: true,
      createdBy: { select: { id: true, prenom: true, nom: true, email: true } },
      permissions: {
        include: { user: { select: { id: true, prenom: true, nom: true, email: true, role: true } } },
      },
      adminSansAcces: { select: { userId: true } },
    },
  },
} satisfies Prisma.ContratDocumentInclude;

type DocumentContratListRow = Prisma.ContratDocumentGetPayload<{
  include: typeof DOCUMENT_CONTRAT_LIST_INCLUDE;
}>;
const processusService = new ProcessusService();
const projetService = new ProjetService();
const entiteService = new EntiteService();

/**
 * Document confidentiel déposé sur une fiche métier (projet ou processus), avec ACL pilotée par l’auteur du dépôt
 * (liste explicite + exclusions administrateur). Les documents liés ou d’un autre type gardent les règles historiques.
 */
export function isNativeProjetUploadDocument(doc: {
  estConfidentiel: boolean;
  typeDocument: DocType | string;
  referenceType: RefType | string | null;
  referenceId: string | null;
}): boolean {
  const typeDoc = String(doc.typeDocument ?? '');
  const refType = String(doc.referenceType ?? '');
  if (!doc.estConfidentiel) {
    return false;
  }
  if (typeDoc === 'tache') return true;
  if (doc.referenceId == null || String(doc.referenceId).trim() === '') return false;
  const nativePairs: [string, string][] = [
    ['projet', 'projet'],
    ['processus', 'processus'],
    ['epic', 'epic'],
    ['user_story', 'userStory'],
  ];
  return nativePairs.some(([t, r]) => typeDoc === t && refType === r);
}

async function resolveEpicProjetId(epicId: string): Promise<string | null> {
  const ep = await prisma.epic.findFirst({
    where: { id: epicId, deletedAt: null },
    select: { projetId: true },
  });
  return ep?.projetId ?? null;
}

async function resolveUserStoryProjetId(userStoryId: string): Promise<string | null> {
  const us = await prisma.userStory.findFirst({
    where: { id: userStoryId, deletedAt: null },
    select: {
      epic: { select: { projetId: true } },
      taches: { where: { deletedAt: null }, take: 1, select: { projetId: true } },
    },
  });
  if (!us) return null;
  if (us.epic?.projetId) return us.epic.projetId;
  return us.taches[0]?.projetId ?? null;
}

async function fetchDocumentAdminSansAccesUserIds(documentId: string): Promise<string[]> {
  try {
    const rows = await prisma.documentAdminSansAcces.findMany({
      where: { documentId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  } catch {
    return [];
  }
}

async function maybeExcludeAdminAfterDocumentPermissionRemoved(
  documentId: string,
  documentUploadedById: string,
  targetUserId: string
) {
  if (targetUserId === documentUploadedById) return;
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
  if (u?.role !== 'admin') return;
  const remaining = await prisma.documentPermission.count({
    where: { documentId, userId: targetUserId },
  });
  if (remaining > 0) return;
  try {
    await prisma.documentAdminSansAcces.upsert({
      where: { documentId_userId: { documentId, userId: targetUserId } },
      create: { documentId, userId: targetUserId },
      update: {},
    });
  } catch {
    /* table absente */
  }
}

/**
 * Noms de fichiers à essayer sur disque : versions du plus récent au plus ancien, puis fichier courant sur Document.
 * (Les anciennes versions n’avaient pas toujours mis à jour `Document.fichierUrl`.)
 */
function documentStorageFileNames(doc: {
  fichierUrl: string;
  versions?: { fichierUrl: string; createdAt: Date }[];
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u: string | null | undefined) => {
    if (u == null || String(u).trim() === '') return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  if (doc.versions?.length) {
    const sorted = [...doc.versions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    for (const v of sorted) add(v.fichierUrl);
  }
  add(doc.fichierUrl);
  return out;
}

/** Filtre documents par rattachement métier (query linkType + linkId). */
function buildDocumentLinkClause(linkType: string, linkId: string): Record<string, unknown> | null {
  if (!linkType?.trim() || !linkId?.trim()) return null;
  switch (linkType) {
    case 'processus':
    case 'entite':
    case 'clientFournisseur':
      return { referenceType: linkType as RefType, referenceId: linkId };
    case 'projet':
      return {
        OR: [
          { referenceType: 'projet' as RefType, referenceId: linkId },
          { tacheDocuments: { some: { tache: { projetId: linkId, deletedAt: null } } } },
          { epicDocuments: { some: { epic: { projetId: linkId, deletedAt: null } } } },
          {
            AND: [
              { referenceType: 'epic' as RefType },
              { epicDocuments: { some: { epic: { projetId: linkId, deletedAt: null } } } },
            ],
          },
          {
            pvReunionsPrincipal: {
              some: {
                deletedAt: null,
                projets: { some: { projetId: linkId } },
              },
            },
          },
        ],
      };
    case 'uploadedBy':
      return { uploadedById: linkId };
    case 'contrat':
      return { contrats: { some: { contratId: linkId } } };
    case 'tache':
      return {
        tacheDocuments: { some: { tacheId: linkId, tache: { deletedAt: null } } },
      };
    case 'epic':
      return {
        epicDocuments: { some: { epicId: linkId, epic: { deletedAt: null } } },
      };
    case 'userStory':
      return {
        OR: [
          { AND: [{ referenceType: 'userStory' as RefType }, { referenceId: linkId }] },
          { tacheDocuments: { some: { tache: { userStoryId: linkId, deletedAt: null } } } },
          {
            epicDocuments: {
              some: {
                epic: {
                  deletedAt: null,
                  userStories: { some: { id: linkId, deletedAt: null } },
                },
              },
            },
          },
        ],
      };
    case 'licence':
      return {
        OR: [
          { AND: [{ referenceType: 'licence' as RefType }, { referenceId: linkId }] },
          { licenceDocuments: { some: { licenceId: linkId } } },
        ],
      };
    case 'pvReunion':
      return {
        OR: [
          { AND: [{ referenceType: 'pvReunion' as RefType }, { referenceId: linkId }] },
          { pvReunionsPrincipal: { some: { id: linkId, deletedAt: null } } },
          { pvReunionCommentPieces: { some: { pvReunionId: linkId } } },
        ],
      };
    default:
      return null;
  }
}

export class DocumentService {
  private async getUserEntiteIds(userId: string): Promise<string[]> {
    const direct = await getUserDirectEntiteIds(userId);
    return keepMostSpecificEntiteIds(direct);
  }

  private async getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
    return getEntiteDescendantIds([...new Set((rootIds || []).filter(Boolean))]);
  }

  private async isUserWithinViewerEntiteScope(viewerUserId: string, candidateUserId: string): Promise<boolean> {
    const viewerDirectEntites = await this.getUserEntiteIds(viewerUserId);
    const scopeIds = await this.getEntiteDescendantIds(viewerDirectEntites);
    if (!scopeIds.length) return false;
    const membership = await prisma.userEntite.findFirst({
      where: { userId: candidateUserId, entiteId: { in: scopeIds } },
      select: { userId: true },
    });
    return !!membership;
  }

  async ensureUploadDir() {
    try {
      await fs.access(UPLOAD_DIR);
    } catch {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
    }
  }

  async findAll(filters?: {
    typeDocument?: DocType;
    referenceType?: RefType;
    referenceId?: string;
    linkType?: string;
    linkId?: string;
    statut?: DocStatut;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    requesterId?: string;
    requesterRole?: string;
  }) {
    const where: any = { deletedAt: null };
    if (filters?.typeDocument) where.typeDocument = filters.typeDocument;
    if (filters?.statut) where.statut = filters.statut;

    const andParts: any[] = [];
    if (filters?.search) {
      andParts.push({
        OR: [
          { nom: { contains: filters.search, mode: 'insensitive' } },
          { description: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
    }

    let linkClause: Record<string, unknown> | null = null;
    if (filters?.linkType && filters?.linkId) {
      linkClause = buildDocumentLinkClause(filters.linkType, filters.linkId);
    } else if (filters?.referenceType && filters?.referenceId) {
      linkClause = buildDocumentLinkClause(String(filters.referenceType), filters.referenceId);
    }
    if (linkClause) andParts.push(linkClause);
    if (andParts.length > 0) where.AND = andParts;

    // Définir l'ordre de tri
    let orderBy: any = { createdAt: 'desc' }; // Par défaut, tri par date de création décroissante
    
    if (filters?.sortBy) {
      const sortOrder = filters.sortOrder || 'asc';
      
      switch (filters.sortBy) {
        case 'nom':
          orderBy = { nom: sortOrder };
          break;
        case 'typeDocument':
          orderBy = { typeDocument: sortOrder };
          break;
        case 'statut':
          orderBy = { statut: sortOrder };
          break;
        case 'createdAt':
          orderBy = { createdAt: sortOrder };
          break;
        case 'updatedAt':
          orderBy = { updatedAt: sortOrder };
          break;
        case 'uploadedBy':
          // Pour uploadedBy, on trie par nom de l'utilisateur (via relation)
          orderBy = { uploadedBy: { nom: sortOrder } };
          break;
        default:
          orderBy = { createdAt: 'desc' };
      }
    }

    // Pièces liées à une licence : toujours confidentielles (rattrapage + cohérence métier)
    try {
      await prisma.document.updateMany({
        where: {
          deletedAt: null,
          estConfidentiel: false,
          OR: [{ typeDocument: 'licence' }, { referenceType: 'licence' }],
        },
        data: { estConfidentiel: true },
      });
    } catch {
      /* ne pas faire échouer GET /documents si cette synchro optionnelle échoue (verrou, droits, etc.) */
    }

    const documents = await prisma.document.findMany({
      where,
      include: {
        uploadedBy: { select: { id: true, nom: true, prenom: true, email: true } },
        valideBy: { select: { id: true, nom: true, prenom: true } },
        versions: {
          orderBy: { createdAt: 'desc' },
          include: {
            uploadedBy: { select: { id: true, nom: true, prenom: true } },
          },
        },
        permissionsUtilisateurs: {
          include: {
            user: { select: { id: true, nom: true, prenom: true, email: true } },
          },
        },
        tacheDocuments: {
          include: {
            tache: { select: { id: true, nom: true } },
          },
        },
        epicDocuments: {
          include: {
            epic: { select: { id: true, nom: true } },
          },
        },
        pvReunionsPrincipal: {
          where: { deletedAt: null },
          select: {
            id: true,
            titre: true,
            statut: true,
            createdById: true,
            createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
            permissions: {
              include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
            },
            adminSansAcces: { select: { userId: true } },
          },
        },
        pvReunionCommentPieces: {
          include: {
            pvReunion: {
              select: {
                id: true,
                titre: true,
                statut: true,
                createdById: true,
                createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
                permissions: {
                  include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
                },
                adminSansAcces: { select: { userId: true } },
              },
            },
          },
        },
        _count: { select: { versions: true } },
      },
      orderBy,
    });

    // Enrichir avec les informations du processus et les statistiques
    /** Données licence pour la liste documents — exclusions admin chargées à part (table parfois absente si migrate non appliqué). */
    const licenceCache = new Map<
      string,
      {
        id: string;
        nom: string;
        reference: string;
        createdById: string | null;
        createdBy: { id: string; prenom: string; nom: string; email: string } | null;
        permissions: {
          id: string;
          userId: string;
          niveau: string;
          user: { id: string; prenom: string; nom: string; email: string };
        }[];
        adminSansAccesUserIds: string[];
      } | null
    >();
    const documentsWithProcessus = await Promise.all(
      documents.map(async (doc) => {
        let processus = null;
        if (doc.referenceType === 'processus' && doc.referenceId) {
          processus = await prisma.processus.findUnique({
            where: { id: doc.referenceId },
            select: { id: true, nom: true, codeProcessus: true },
          });
        }
        let projet = null;
        if (doc.referenceType === 'projet' && doc.referenceId) {
          projet = await prisma.projet.findUnique({
            where: { id: doc.referenceId },
            select: { id: true, nom: true, codeProjet: true },
          });
        }
        let licence = null;
        const licenceRefId =
          doc.referenceId && (doc.referenceType === 'licence' || doc.typeDocument === 'licence')
            ? doc.referenceId
            : null;
        if (licenceRefId) {
          if (!licenceCache.has(licenceRefId)) {
            const rawLic = await prisma.licence.findUnique({
              where: { id: licenceRefId },
              select: {
                id: true,
                nom: true,
                reference: true,
                createdById: true,
                createdBy: { select: { id: true, prenom: true, nom: true, email: true } },
                permissions: {
                  include: { user: { select: { id: true, prenom: true, nom: true, email: true } } },
                },
              },
            });
            let adminSansAccesUserIds: string[] = [];
            if (rawLic) {
              try {
                const excl = await prisma.licenceAdminSansAcces.findMany({
                  where: { licenceId: licenceRefId },
                  select: { userId: true },
                });
                adminSansAccesUserIds = excl.map((x) => x.userId);
              } catch {
                /* ex. table LicenceAdminSansAcces absente — migrate deploy requis pour persister les exclusions */
              }
            }
            licenceCache.set(
              licenceRefId,
              rawLic
                ? {
                    id: rawLic.id,
                    nom: rawLic.nom,
                    reference: rawLic.reference,
                    createdById: rawLic.createdById,
                    createdBy: rawLic.createdBy,
                    permissions: rawLic.permissions,
                    adminSansAccesUserIds,
                  }
                : null,
            );
          }
          licence = licenceCache.get(licenceRefId) ?? null;
        }
        // Contrats liés + droits (affichage page Documents aligné sur la fiche contrat)
        let contratsRaw: DocumentContratListRow[] = [];
        try {
          contratsRaw = await prisma.contratDocument.findMany({
            where: { documentId: doc.id },
            include: DOCUMENT_CONTRAT_LIST_INCLUDE,
          });
        } catch {
          /* schéma / table en retard ou requête incluse incompatible — liste documents reste utilisable */
        }
        const contrats = contratsRaw.map((cd) => ({
          ...cd,
          contrat: cd.contrat
            ? {
                ...cd.contrat,
                adminSansAccesUserIds: (cd.contrat.adminSansAcces || []).map((x) => x.userId),
              }
            : cd.contrat,
        }));

        // Compter les téléchargements et visualisations
        let telechargements = 0;
        let visualisations = 0;
        try {
          [telechargements, visualisations] = await Promise.all([
            prisma.journalAcces.count({
              where: {
                ressourceType: 'document',
                ressourceId: doc.id,
                action: 'telechargement',
              },
            }),
            prisma.journalAcces.count({
              where: {
                ressourceType: 'document',
                ressourceId: doc.id,
                action: 'lecture',
              },
            }),
          ]);
        } catch {
          /* JournalAcces indisponible — compteurs à 0 */
        }

        let docAdminSansAccesUserIds: string[] | undefined;
        if (isNativeProjetUploadDocument(doc as any)) {
          docAdminSansAccesUserIds = await fetchDocumentAdminSansAccesUserIds(doc.id);
        }

        const pvDirect = doc.pvReunionsPrincipal?.[0];
        const pvFromComment = doc.pvReunionCommentPieces?.find((x: any) => !!x.pvReunion)?.pvReunion;
        const pv = pvDirect || pvFromComment || null;
        const pvReunion = pv
          ? {
              ...pv,
              adminSansAccesUserIds: (pv.adminSansAcces || []).map((x: { userId: string }) => x.userId),
            }
          : null;

        return {
          ...doc,
          processus: processus || null,
          projet: projet || null,
          licence: licence || null,
          contrats: contrats || [],
          pvReunion,
          nombreTelechargements: telechargements,
          nombreVisualisations: visualisations,
          adminSansAccesUserIds: docAdminSansAccesUserIds,
        };
      })
    );

    if (!filters?.requesterId || !filters?.requesterRole) return documentsWithProcessus;
    const visible: typeof documentsWithProcessus = [];
    for (const doc of documentsWithProcessus) {
      const ok = await this.canUserAccessDocument(doc.id, filters.requesterId, filters.requesterRole);
      if (ok) visible.push(doc);
    }
    return visible;
  }

  async findOne(id: string) {
    const document = await prisma.document.findFirst({
      where: { 
        id,
        deletedAt: null, // Exclure les documents supprimés
      },
      include: {
        uploadedBy: true,
        valideBy: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          include: {
            uploadedBy: { select: { id: true, nom: true, prenom: true } },
          },
        },
        permissionsUtilisateurs: {
          include: {
            user: { select: { id: true, nom: true, prenom: true, email: true } },
          },
        },
      },
    });

    if (!document) {
      return null;
    }

    // Compter les téléchargements et visualisations
    const [telechargements, visualisations] = await Promise.all([
      prisma.journalAcces.count({
        where: {
          ressourceType: 'document',
          ressourceId: id,
          action: 'telechargement',
        },
      }),
      prisma.journalAcces.count({
        where: {
          ressourceType: 'document',
          ressourceId: id,
          action: 'lecture',
        },
      }),
    ]);

    let oneAdminSans: string[] | undefined;
    if (isNativeProjetUploadDocument(document as any)) {
      oneAdminSans = await fetchDocumentAdminSansAccesUserIds(id);
    }

    return {
      ...document,
      nombreTelechargements: telechargements,
      nombreVisualisations: visualisations,
      adminSansAccesUserIds: oneAdminSans,
    };
  }

  /** Premier chemin absolu existant parmi les fichiers connus pour ce document (versions + courant). */
  async resolveExistingFilePath(document: {
    fichierUrl: string;
    versions?: { fichierUrl: string; createdAt: Date }[];
  }): Promise<string | null> {
    for (const name of documentStorageFileNames(document)) {
      const fp = path.join(UPLOAD_DIR, name);
      try {
        await fs.access(fp);
        return fp;
      } catch {
        continue;
      }
    }
    return null;
  }

  async canUserAccessDocument(documentId: string, userId: string, role?: string): Promise<boolean> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        permissionsUtilisateurs: true,
        uploadedBy: { select: { id: true } },
      },
    });

    if (!document) return false;

    const r = role || 'lecteur';

    const pvCommentLink =
      document.referenceType === 'pvReunion' || document.typeDocument === 'pv_reunion'
        ? true
        : !!(await prisma.pvReunionCommentaire.findFirst({
            where: { documentId },
            select: { id: true },
          }));
    const shouldCheckPvAcl = document.referenceType === 'pvReunion' || document.typeDocument === 'pv_reunion' || pvCommentLink;
    if (shouldCheckPvAcl) {
      const pv = await prisma.pvReunion.findFirst({
        where: {
          deletedAt: null,
          OR: [{ documentId }, { commentaires: { some: { documentId } } }],
        },
        select: {
          id: true,
          createdById: true,
          permissions: { select: { userId: true, niveau: true } },
          adminSansAcces: { select: { userId: true } },
        },
      });
      if (!pv) return false;
      return canViewPvReunion(
        {
          id: pv.id,
          createdById: pv.createdById,
          permissions: pv.permissions,
          adminSansAcces: pv.adminSansAcces,
        } as any,
        userId,
        r
      );
    }

    // Licence confidentielle : administrateurs « exclus » n’ont pas le raccourci global
    if (document.estConfidentiel && document.referenceType === 'licence' && document.referenceId && r === 'admin') {
      if (document.uploadedById === userId) return true;
      const licence = await loadLicenceForAclById(document.referenceId);
      if (licence && !licence.deletedAt && canReadLicence(userId, r, licence as any)) {
        return true;
      }
      return false;
    }

    if (document.referenceType === 'processus' && document.referenceId) {
      const procAccess = await processusService.canAccess(document.referenceId, userId, r);
      if (!procAccess.canAccess) return false;
    }
    if (document.referenceType === 'projet' && document.referenceId) {
      const projAccess = await projetService.canAccess(document.referenceId, userId, r);
      if (!projAccess.canAccess) return false;
    }
    if (document.referenceType === 'entite' && document.referenceId) {
      const entAccess = await entiteService.canAccess(document.referenceId, userId, r);
      if (!entAccess.canAccess) return false;
    }
    if (document.referenceType === 'clientFournisseur' && document.referenceId) {
      const cfAccess = await clientFournisseurService.canAccess(document.referenceId, userId, r);
      if (!cfAccess.canAccess) return false;
    }
    if (document.referenceType === 'epic' && document.referenceId) {
      const pid = await resolveEpicProjetId(document.referenceId);
      if (pid) {
        const projAccess = await projetService.canAccess(pid, userId, r);
        if (!projAccess.canAccess) return false;
      }
    }
    if (document.referenceType === 'userStory' && document.referenceId) {
      const pid = await resolveUserStoryProjetId(document.referenceId);
      if (pid) {
        const projAccess = await projetService.canAccess(pid, userId, r);
        if (!projAccess.canAccess) return false;
      }
    }
    if (document.typeDocument === 'tache') {
      const tacheLink = await prisma.tacheDocument.findFirst({
        where: {
          documentId,
          tache: { deletedAt: null, projetId: { not: null } },
        },
        select: { tache: { select: { projetId: true } } },
      });
      const pid = tacheLink?.tache?.projetId;
      if (pid) {
        const projAccess = await projetService.canAccess(pid, userId, r);
        if (!projAccess.canAccess) return false;
      }
    }

    if (!document.estConfidentiel) {
      if (r === 'contributeur' || r === 'lecteur') {
        if (document.uploadedById === userId) return true;
        const hasExplicitPermission = await prisma.documentPermission.findFirst({
          where: { documentId, userId },
          select: { id: true },
        });
        if (hasExplicitPermission) return true;
        return this.isUserWithinViewerEntiteScope(userId, document.uploadedById);
      }
      return true;
    }

    /** Pièce confidentielle déposée sur le projet : accès = auteur + liste explicite + admins non exclus (pas de passe-droit gouvernance). */
    if (isNativeProjetUploadDocument(document)) {
      if (document.uploadedById === userId) return true;
      const inList = document.permissionsUtilisateurs.some((p) => p.userId === userId);
      if (inList) return true;
      if (r === 'admin') {
        const excluded = new Set(await fetchDocumentAdminSansAccesUserIds(documentId));
        if (!excluded.has(userId)) return true;
      }
      return false;
    }

    if (r === 'admin') return true;

    // L'utilisateur qui a uploadé peut toujours accéder
    if (document.uploadedById === userId) return true;

    if (document.referenceType === 'licence' && document.referenceId) {
      const licence = await loadLicenceForAclById(document.referenceId);
      if (licence && !licence.deletedAt && canReadLicence(userId, role || 'lecteur', licence as any)) {
        return true;
      }
    }

    // Vérifier si le document est lié à un processus et si l'utilisateur est propriétaire ou créateur
    if (document.referenceType === 'processus' && document.referenceId) {
      const processus = await prisma.processus.findUnique({
        where: { id: document.referenceId },
        select: { proprietaireId: true, createdById: true },
      });
      if (processus && (processus.proprietaireId === userId || processus.createdById === userId)) {
        return true;
      }
    }
    // Document lié au projet (type autre que « projet ») : gouvernance et règles historiques inchangées
    if (document.referenceType === 'projet' && document.referenceId) {
      const projet = await prisma.projet.findUnique({
        where: { id: document.referenceId },
        include: {
          sponsors: true,
          chefsProjet: true,
          techLeads: true,
          equipe: true,
        },
      });
      if (projet) {
        if (projet.createdById === userId) return true;
        if (projet.responsableId === userId) return true;
        if (projet.gestionnaireId === userId) return true;
        const gouvernanceIds = [
          ...(projet.sponsors ?? []).map((s: any) => s.userId),
          ...(projet.chefsProjet ?? []).map((s: any) => s.userId),
          ...(projet.techLeads ?? []).map((s: any) => s.userId),
          ...(projet.equipe ?? []).map((s: any) => s.userId),
        ];
        if (gouvernanceIds.includes(userId)) return true;
      }
    }

    // Vérifier si l'utilisateur est dans la liste des permissions
    const hasPermission = await prisma.documentPermission.findFirst({
      where: {
        documentId,
        userId,
      },
    });

    return !!hasPermission;
  }

  /** Métadonnées d'un document confidentiel : licence = droit de modification sur la fiche licence ; sinon = accès lecture du document. */
  async canUserModifyConfidentialDocument(documentId: string, userId: string, role?: string): Promise<boolean> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        estConfidentiel: true,
        referenceType: true,
        referenceId: true,
        typeDocument: true,
        uploadedById: true,
      },
    });
    if (!document) return false;
    if (!document.estConfidentiel) return true;
    if (isNativeProjetUploadDocument(document as any)) {
      if (document.uploadedById === userId) return true;
      const hasPerm = await prisma.documentPermission.findFirst({ where: { documentId, userId } });
      return !!hasPerm;
    }
    if (document.referenceType === 'licence' && document.referenceId) {
      const licence = await loadLicenceForAclById(document.referenceId);
      return !!(licence && !licence.deletedAt && canEditLicenceContent(userId, role || 'lecteur', licence as any));
    }
    return this.canUserAccessDocument(documentId, userId, role);
  }

  async canUserDeleteOrAddVersion(documentId: string, userId: string, role?: string): Promise<boolean> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        permissionsUtilisateurs: true,
        uploadedBy: { select: { id: true } },
      },
    });

    if (!document) return false;

    if (document.estConfidentiel && document.referenceType === 'licence' && document.referenceId) {
      const licence = await loadLicenceForAclById(document.referenceId);
      if (!licence || licence.deletedAt) return false;
      if (document.uploadedById === userId) return true;
      return canEditLicenceContent(userId, role || 'lecteur', licence as any);
    }

    if (isNativeProjetUploadDocument(document)) {
      if (document.uploadedById === userId) return true;
      const hasPerm = await prisma.documentPermission.findFirst({ where: { documentId, userId } });
      return !!hasPerm;
    }

    if (role === 'admin') return true;

    const canVoir = await this.canUserAccessDocument(documentId, userId, role);
    if (!canVoir) return false;

    // Si le document n'est pas confidentiel, l'accès lecture (incl. droit sur projet/processus) suffit pour la suite
    if (!document.estConfidentiel) return true;

    // L'utilisateur qui a uploadé peut toujours supprimer/ajouter version
    if (document.uploadedById === userId) return true;

    // Pour les documents confidentiels, seuls les utilisateurs explicitement dans la liste des permissions peuvent supprimer/ajouter version
    // (le propriétaire/créateur du processus n'a pas automatiquement ce droit, sauf s'il est dans la liste)
    const hasPermission = await prisma.documentPermission.findFirst({
      where: {
        documentId,
        userId,
      },
    });

    return !!hasPermission;
  }

  async create(data: {
    nom: string;
    typeDocument: DocType;
    referenceType?: RefType;
    referenceId?: string;
    fichierUrl: string;
    fichierNomOriginal: string;
    fichierTaille: number;
    fichierType: string;
    description?: string;
    uploadedById: string;
    versionMajeure?: number;
    versionMineure?: number;
    versionPatch?: number;
    tags?: any;
    estConfidentiel?: boolean;
    permissionUserIds?: string[];
  }) {
    const version = `${data.versionMajeure || 1}.${data.versionMineure || 0}.${data.versionPatch || 0}`;
    
    // Extraire versionPatch et permissionUserIds car ils n'existent pas dans le schéma Prisma directement
    const { versionPatch, permissionUserIds, ...documentData } = data;
    
    const document = await prisma.document.create({
      data: {
        ...documentData,
        version,
        statut: 'brouillon',
      },
      include: {
        uploadedBy: { select: { id: true, nom: true, prenom: true } },
      },
    });

    // Créer les permissions si le document est confidentiel et qu'il y a des utilisateurs sélectionnés
    if (data.estConfidentiel && permissionUserIds && permissionUserIds.length > 0) {
      await prisma.documentPermission.createMany({
        data: permissionUserIds.map(userId => ({
          documentId: document.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }
    
    return document;
  }

  async createVersion(
    documentId: string,
    data: {
      fichierUrl: string;
      fichierNomOriginal: string;
      fichierTaille: number;
      fichierType: string;
      commentaireVersion?: string;
      uploadedById: string;
    }
  ) {
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new Error('Document non trouvé');

    const versionParts = (document.version || '1.0.0').split('.');
    const newMinor = parseInt(versionParts[1] || '0') + 1;
    const newVersion = `${versionParts[0]}.${newMinor}.0`;

    const { fichierNomOriginal, fichierTaille, fichierType, ...versionRow } = data;

    await prisma.versionDocument.create({
      data: {
        documentId,
        version: newVersion,
        fichierUrl: versionRow.fichierUrl,
        commentaireVersion: versionRow.commentaireVersion,
        uploadedById: versionRow.uploadedById,
      },
    });

    return prisma.document.update({
      where: { id: documentId },
      data: {
        version: newVersion,
        versionMineure: newMinor,
        fichierUrl: data.fichierUrl,
        fichierNomOriginal,
        fichierTaille,
        fichierType,
      },
    });
  }

  async update(id: string, data: {
    nom?: string;
    description?: string;
    statut?: DocStatut;
    estConfidentiel?: boolean;
    tags?: any;
    valideById?: string;
    permissionUserIds?: string[];
  }) {
    const { permissionUserIds, ...rest } = data;
    const updateData: typeof rest & { dateValidation?: Date } = { ...rest };
    if (data.statut === 'valide' && data.valideById) {
      updateData.dateValidation = new Date();
    }

    const before = await prisma.document.findFirst({
      where: { id, deletedAt: null },
      select: {
        estConfidentiel: true,
        typeDocument: true,
        referenceType: true,
        referenceId: true,
        uploadedById: true,
      },
    });
    if (!before) throw new Error('Document non trouvé');

    let previousPermUserIds: string[] = [];
    const willTouchPerms = data.estConfidentiel !== undefined || permissionUserIds !== undefined;
    if (willTouchPerms) {
      const existing = await prisma.documentPermission.findMany({
        where: { documentId: id },
        select: { userId: true },
      });
      previousPermUserIds = existing.map((e) => e.userId);
    }

    const document = await prisma.document.update({
      where: { id },
      data: updateData,
      include: {
        uploadedBy: { select: { id: true, nom: true, prenom: true } },
      },
    });

    const afterEstConf =
      data.estConfidentiel !== undefined ? data.estConfidentiel : before.estConfidentiel;
    const mergedForNative = {
      estConfidentiel: afterEstConf,
      typeDocument: document.typeDocument,
      referenceType: document.referenceType,
      referenceId: document.referenceId,
    };

    let newPermUserIds: string[] = [];
    // Gérer les permissions si le document est confidentiel
    if (data.estConfidentiel !== undefined) {
      await prisma.documentPermission.deleteMany({
        where: { documentId: id },
      });

      if (data.estConfidentiel && permissionUserIds && permissionUserIds.length > 0) {
        newPermUserIds = permissionUserIds;
        await prisma.documentPermission.createMany({
          data: permissionUserIds.map((userId) => ({
            documentId: id,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    } else if (permissionUserIds !== undefined) {
      await prisma.documentPermission.deleteMany({
        where: { documentId: id },
      });

      if (permissionUserIds.length > 0) {
        newPermUserIds = permissionUserIds;
        await prisma.documentPermission.createMany({
          data: permissionUserIds.map((userId) => ({
            documentId: id,
            userId,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (willTouchPerms && isNativeProjetUploadDocument(mergedForNative as any)) {
      const newSet = new Set(newPermUserIds);
      const removed = previousPermUserIds.filter((uid) => !newSet.has(uid));
      const added = newPermUserIds.filter((uid) => !previousPermUserIds.includes(uid));
      try {
        for (const uid of removed) {
          const u = await prisma.user.findUnique({ where: { id: uid }, select: { role: true } });
          if (u?.role === 'admin') {
            await prisma.documentAdminSansAcces.upsert({
              where: { documentId_userId: { documentId: id, userId: uid } },
              create: { documentId: id, userId: uid },
              update: {},
            });
          }
        }
        for (const uid of added) {
          await prisma.documentAdminSansAcces.deleteMany({ where: { documentId: id, userId: uid } });
        }
      } catch {
        /* table absente */
      }
    }

    if (data.estConfidentiel === false) {
      try {
        await prisma.documentAdminSansAcces.deleteMany({ where: { documentId: id } });
      } catch {
        /* table absente */
      }
    }

    return document;
  }

  async delete(id: string) {
    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) throw new Error('Document non trouvé');

    // Supprimer le fichier physique
    try {
      const filePath = path.join(UPLOAD_DIR, document.fichierUrl);
      await fs.unlink(filePath);
    } catch (error) {
      // Ignorer si le fichier n'existe pas
      console.warn(`Fichier non trouvé: ${document.fichierUrl}`);
    }

    // Soft delete : marquer comme supprimé au lieu de supprimer réellement
    // Les fichiers physiques seront supprimés lors d'une suppression définitive depuis la corbeille
    return prisma.document.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async assertCanManageNativeProjetDocument(documentId: string, actorUserId: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: {
        uploadedById: true,
        estConfidentiel: true,
        typeDocument: true,
        referenceType: true,
        referenceId: true,
      },
    });
    if (!doc) throw new Error('NOT_FOUND');
    if (!isNativeProjetUploadDocument(doc as any)) throw new Error('FORBIDDEN');
    if (doc.uploadedById !== actorUserId) throw new Error('FORBIDDEN');
  }

  async getDocumentAccesDetail(documentId: string, actorUserId: string, actorRole: string) {
    const doc = await prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
      select: {
        id: true,
        nom: true,
        estConfidentiel: true,
        typeDocument: true,
        referenceType: true,
        referenceId: true,
        uploadedById: true,
      },
    });
    if (!doc) throw new Error('NOT_FOUND');
    if (!isNativeProjetUploadDocument(doc as any)) throw new Error('ACCES_DETAIL_UNAVAILABLE');

    const canView = await this.canUserAccessDocument(documentId, actorUserId, actorRole);
    if (!canView) throw new Error('FORBIDDEN');

    const full = await prisma.document.findFirst({
      where: { id: documentId },
      include: {
        uploadedBy: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
        permissionsUtilisateurs: {
          include: {
            user: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
          },
        },
      },
    });
    if (!full) throw new Error('NOT_FOUND');

    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
    const adminSansAccesUserIds = await fetchDocumentAdminSansAccesUserIds(documentId);
    const delegations = (full.permissionsUtilisateurs || []).map((p) => ({
      id: p.id,
      permission: 'lecture' as const,
      user: p.user,
      grantedBy: null as null,
      createdAt: p.createdAt,
    }));

    return {
      ficheNom: full.nom,
      admins,
      creator: full.uploadedBy,
      delegations,
      canManagePermissions: full.uploadedById === actorUserId,
      adminSansAccesUserIds,
    };
  }

  async addDocumentExplicitPermission(documentId: string, targetUserId: string, actorUserId: string) {
    await this.assertCanManageNativeProjetDocument(documentId, actorUserId);
    const meta = await prisma.document.findUnique({
      where: { id: documentId },
      select: { uploadedById: true },
    });
    if (!meta) throw new Error('NOT_FOUND');
    if (meta.uploadedById === targetUserId) {
      throw new Error("L'auteur du document a déjà tous les droits");
    }
    try {
      await prisma.documentAdminSansAcces.deleteMany({ where: { documentId, userId: targetUserId } });
    } catch {
      /* table absente */
    }
    return prisma.documentPermission.upsert({
      where: { documentId_userId: { documentId, userId: targetUserId } },
      create: { documentId, userId: targetUserId },
      update: {},
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
      },
    });
  }

  async removeDocumentPermissionEntry(documentId: string, permissionId: string, actorUserId: string) {
    await this.assertCanManageNativeProjetDocument(documentId, actorUserId);
    const perm = await prisma.documentPermission.findFirst({
      where: { id: permissionId, documentId },
    });
    if (!perm) throw new Error('NOT_FOUND');
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { uploadedById: true },
    });
    if (!doc) throw new Error('NOT_FOUND');
    await prisma.documentPermission.delete({ where: { id: permissionId } });
    await maybeExcludeAdminAfterDocumentPermissionRemoved(documentId, doc.uploadedById, perm.userId);
  }

  async blockDocumentAdminImplicit(documentId: string, targetUserId: string, actorUserId: string) {
    await this.assertCanManageNativeProjetDocument(documentId, actorUserId);
    const doc = await prisma.document.findUnique({
      where: { id: documentId },
      select: { uploadedById: true },
    });
    if (!doc) throw new Error('NOT_FOUND');
    if (doc.uploadedById === targetUserId) {
      throw new Error("L'auteur du document ne peut pas être exclu");
    }
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (target.role !== 'admin') {
      throw new Error("Seuls les comptes administrateur peuvent être privés de l'accès implicite au document");
    }
    await prisma.documentPermission.deleteMany({ where: { documentId, userId: targetUserId } });
    try {
      await prisma.documentAdminSansAcces.upsert({
        where: { documentId_userId: { documentId, userId: targetUserId } },
        create: { documentId, userId: targetUserId },
        update: {},
      });
    } catch {
      throw new Error(
        "Impossible d'enregistrer l'exclusion : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }

  async restoreDocumentAdminImplicit(documentId: string, targetUserId: string, actorUserId: string) {
    await this.assertCanManageNativeProjetDocument(documentId, actorUserId);
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    try {
      await prisma.documentAdminSansAcces.deleteMany({ where: { documentId, userId: targetUserId } });
    } catch {
      throw new Error(
        "Impossible de restaurer l'accès : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }
}