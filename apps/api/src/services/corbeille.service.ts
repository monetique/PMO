import { prisma } from '../utils/prisma';
import { LicenceService } from './licence.service';
import { clientFournisseurService, logCfHistory } from './client-fournisseur.service';
import { contratService } from './contrat.service';
import { EntiteService } from './entite.service';
import { ProjetService } from './projet.service';
import { TacheService } from './tache.service';
import { EpicService } from './epic.service';

const licenceService = new LicenceService();
const entiteService = new EntiteService();
const projetService = new ProjetService();
const tacheService = new TacheService();
const epicService = new EpicService();

export class CorbeilleService {
  // Récupérer tous les processus supprimés
  async getProcessusSupprimes() {
    return prisma.processus.findMany({
      where: {
        deletedAt: { not: null },
      },
      include: {
        proprietaire: { select: { id: true, nom: true, prenom: true, email: true } },
        createdBy: { select: { id: true, nom: true, prenom: true } },
        entites: {
          include: {
            entite: { select: { id: true, nom: true, code: true } },
          },
        },
        categories: {
          include: {
            categorie: { select: { id: true, nom: true, couleur: true } },
          },
        },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  // Récupérer tous les documents supprimés
  async getDocumentsSupprimes() {
    const documents = await prisma.document.findMany({
      where: {
        deletedAt: { not: null },
      },
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
      },
      orderBy: { deletedAt: 'desc' },
    });

    // Enrichir avec les informations du processus
    const documentsWithProcessus = await Promise.all(
      documents.map(async (doc) => {
        let processus = null;
        if (doc.referenceType === 'processus' && doc.referenceId) {
          processus = await prisma.processus.findUnique({
            where: { id: doc.referenceId },
            select: { id: true, nom: true, codeProcessus: true },
          });
        }
        return {
          ...doc,
          processus: processus || null,
        };
      })
    );

    return documentsWithProcessus;
  }

  async getLicencesSupprimees() {
    return licenceService.findAllDeletedAdmin();
  }

  async restaurerLicence(id: string, userId: string, role: string) {
    return licenceService.restore(id, userId, role);
  }

  async supprimerDefinitivementLicence(id: string) {
    return licenceService.deletePermanent(id);
  }

  // Restaurer un processus
  async restaurerProcessus(id: string) {
    return prisma.processus.update({
      where: { id },
      data: { deletedAt: null },
      include: {
        proprietaire: { select: { id: true, nom: true, prenom: true } },
        entites: {
          include: {
            entite: { select: { id: true, nom: true, code: true } },
          },
        },
        categories: {
          include: {
            categorie: { select: { id: true, nom: true, couleur: true } },
          },
        },
        createdBy: { select: { id: true, nom: true, prenom: true } },
      },
    });
  }

  // Restaurer un document
  async restaurerDocument(id: string) {
    return prisma.document.update({
      where: { id },
      data: { deletedAt: null },
      include: {
        uploadedBy: { select: { id: true, nom: true, prenom: true } },
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
      },
    });
  }

  // Supprimer définitivement un processus (hard delete)
  async supprimerDefinitivementProcessus(id: string) {
    await prisma.permission.deleteMany({
      where: { ressourceType: 'processus', ressourceId: id },
    });
    return prisma.processus.delete({ where: { id } });
  }

  // Supprimer définitivement un document (hard delete)
  async supprimerDefinitivementDocument(id: string) {
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const UPLOAD_DIR = path.default.join(process.cwd(), 'uploads');

    // Récupérer le document pour supprimer les fichiers
    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        versions: true,
      },
    });

    if (!document) {
      throw new Error('Document non trouvé');
    }

    // Supprimer le fichier principal
    try {
      const filePath = path.default.join(UPLOAD_DIR, document.fichierUrl);
      await fs.unlink(filePath);
    } catch (error) {
      console.warn(`Fichier principal non trouvé: ${document.fichierUrl}`);
    }

    // Supprimer les versions
    for (const version of document.versions) {
      try {
        const versionPath = path.default.join(UPLOAD_DIR, version.fichierUrl);
        await fs.unlink(versionPath);
      } catch (error) {
        console.warn(`Version non trouvée: ${version.fichierUrl}`);
      }
    }

    // Supprimer le document de la base de données
    return prisma.document.delete({ where: { id } });
  }

  async getClientsFournisseursSupprimes() {
    return clientFournisseurService.listDeletedForCorbeille();
  }

  async restaurerClientFournisseur(id: string, userId: string) {
    const row = await clientFournisseurService.restoreFromCorbeille(id);
    await logCfHistory(id, userId, 'restauration', 'Fiche restaurée depuis la corbeille');
    return row;
  }

  async supprimerDefinitivementClientFournisseur(id: string) {
    return clientFournisseurService.deletePermanent(id);
  }

  async getContratsSupprimes() {
    return contratService.listDeletedForCorbeille();
  }

  async restaurerContrat(id: string, userId: string) {
    return contratService.restoreFromCorbeille(id, userId);
  }

  async supprimerDefinitivementContrat(id: string) {
    return contratService.deletePermanent(id);
  }

  async getEntitesSupprimees() {
    return entiteService.listDeletedForCorbeille();
  }

  async restaurerEntite(id: string) {
    return entiteService.restoreFromCorbeille(id);
  }

  async supprimerDefinitivementEntite(id: string) {
    return entiteService.deletePermanent(id);
  }

  async getProjetsSupprimes() {
    return projetService.listDeletedForCorbeille();
  }

  async restaurerProjet(id: string) {
    return projetService.restoreFromCorbeille(id);
  }

  async supprimerDefinitivementProjet(id: string) {
    return projetService.deletePermanent(id);
  }

  async getTachesAgileSupprimees() {
    return prisma.tache.findMany({
      where: { deletedAt: { not: null } },
      select: {
        id: true,
        nom: true,
        deletedAt: true,
        projetId: true,
        projet: { select: { nom: true } },
        createur: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async restaurerTacheAgile(id: string) {
    return tacheService.restore(id, '', 'admin');
  }

  async supprimerDefinitivementTacheAgile(id: string) {
    return tacheService.deletePermanent(id);
  }

  async getEpicsAgileSupprimes() {
    return prisma.epic.findMany({
      where: { deletedAt: { not: null } },
      select: {
        id: true,
        nom: true,
        deletedAt: true,
        projetId: true,
        projet: { select: { nom: true } },
        createdBy: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async restaurerEpicAgile(id: string) {
    return epicService.restoreEpic(id, '', 'admin');
  }

  async supprimerDefinitivementEpicAgile(id: string) {
    return epicService.deleteEpicPermanent(id);
  }

  async getUserStoriesAgileSupprimees() {
    return prisma.userStory.findMany({
      where: { deletedAt: { not: null } },
      select: {
        id: true,
        description: true,
        deletedAt: true,
        epicId: true,
        epic: { select: { id: true, nom: true, projet: { select: { nom: true } } } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async restaurerUserStoryAgile(id: string) {
    return epicService.restoreUserStory(id, '', 'admin');
  }

  async supprimerDefinitivementUserStoryAgile(id: string) {
    return epicService.deleteUserStoryPermanent(id);
  }

  async getPvReunionsSupprimes() {
    return prisma.pvReunion.findMany({
      where: { deletedAt: { not: null } },
      include: {
        document: { select: { id: true, nom: true, fichierNomOriginal: true } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  /** Suppression définitive d’un PV en corbeille : enregistrement + documents principal et pièces des commentaires. */
  async supprimerDefinitivementPvReunion(id: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: { not: null } },
      include: { commentaires: { select: { documentId: true } } },
    });
    if (!pv) throw new Error('PV non trouvé ou non en corbeille');

    const docIds = new Set<string>();
    docIds.add(pv.documentId);
    for (const c of pv.commentaires) {
      if (c.documentId) docIds.add(c.documentId);
    }

    await prisma.pvReunion.delete({ where: { id } });

    for (const docId of docIds) {
      try {
        await this.supprimerDefinitivementDocument(docId);
      } catch {
        // Document déjà supprimé ou fichier manquant : continuer
      }
    }
  }
}
