import { Request, Response } from 'express';
import { DocumentService, isNativeProjetUploadDocument } from '../services/document.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';

const documentService = new DocumentService();
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Configuration multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await documentService.ensureUploadDir();
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|xls|xlsx|ppt|pptx|jpg|jpeg|png|gif|txt|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype) || file.mimetype === 'application/octet-stream';
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé'));
    }
  },
});

export const uploadMiddleware = upload.single('file');

export const getAllDocuments = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const {
      typeDocument,
      referenceType,
      referenceId,
      linkType,
      linkId,
      statut,
      search,
      sortBy,
      sortOrder,
    } = req.query;
    const documents = await documentService.findAll({
      typeDocument: typeDocument as any,
      referenceType: referenceType as any,
      referenceId: referenceId as string,
      linkType: linkType as string,
      linkId: linkId as string,
      statut: statut as any,
      search: search as string,
      sortBy: sortBy as string,
      sortOrder: (sortOrder as 'asc' | 'desc') || 'asc',
      requesterId: req.user.userId,
      requesterRole: req.user.role,
    });

    const procRefId =
      (linkType === 'processus' && linkId) || (referenceType === 'processus' && referenceId)
        ? String(linkType === 'processus' ? linkId : referenceId)
        : null;
    if (procRefId) {
      await logAccess(req, res, 'lecture', 'processus', procRefId, undefined, {
        action: 'consultation_documents',
        nombreDocuments: documents.length,
      });
    }
    
    res.json(documents);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getDocument = async (req: AuthRequest, res: Response) => {
  try {
    const document = await documentService.findOne(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }
    await logAccess(req, res, 'lecture', 'document', document.id, document.nom, {
      processusId: document.referenceId,
    });
    res.json(document);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Fichier requis' });
    }
    
    // Vérifier les permissions pour les contributeurs si le document est lié à un processus
    if (req.user.role === 'contributeur' && req.body.referenceType === 'processus' && req.body.referenceId) {
      const { prisma } = await import('../utils/prisma');
      const processus = await prisma.processus.findUnique({
        where: { id: req.body.referenceId },
        select: { proprietaireId: true, createdById: true },
      });
      
      if (!processus) {
        return res.status(404).json({ error: 'Processus non trouvé' });
      }
      
      if (processus.proprietaireId !== req.user.userId && processus.createdById !== req.user.userId) {
        return res.status(403).json({ 
          error: 'Vous n\'avez pas les permissions pour ajouter un document à ce processus. Seuls le propriétaire ou le créateur du processus peuvent ajouter des documents.' 
        });
      }
    }

    const estConfidentiel = req.body.estConfidentiel === 'true' || req.body.estConfidentiel === true;
    // Gérer les permissionUserIds envoyés via FormData (peut être un tableau ou une chaîne)
    let permissionUserIds: string[] = [];
    if (req.body.permissionUserIds) {
      if (Array.isArray(req.body.permissionUserIds)) {
        permissionUserIds = req.body.permissionUserIds;
      } else if (typeof req.body.permissionUserIds === 'string') {
        permissionUserIds = req.body.permissionUserIds.split(',').filter((id: string) => id.trim() !== '');
      }
    }

    // Vérifier si l'utilisateur peut définir le document comme confidentiel
    if (estConfidentiel) {
      // Si le document est lié à un processus, vérifier si l'utilisateur est propriétaire ou créateur
      if (req.body.referenceType === 'processus' && req.body.referenceId) {
        const { prisma } = await import('../utils/prisma');
        const processus = await prisma.processus.findUnique({
          where: { id: req.body.referenceId },
          select: { proprietaireId: true, createdById: true },
        });
        
        if (!processus) {
          return res.status(404).json({ error: 'Processus non trouvé' });
        }
        
        if (processus.proprietaireId !== req.user!.userId && processus.createdById !== req.user!.userId) {
          return res.status(403).json({ error: 'Seul le propriétaire ou le créateur du processus peut définir un document comme confidentiel' });
        }
      } else {
        // Si le document n'est pas lié à un processus, seul l'utilisateur qui l'upload peut le rendre confidentiel
        // Cette vérification est implicite car uploadedById sera toujours l'utilisateur actuel
      }

      // Vérifier qu'au moins un utilisateur est sélectionné
      if (permissionUserIds.length === 0) {
        return res.status(400).json({ error: 'Au moins un utilisateur doit être sélectionné pour un document confidentiel' });
      }
    }

    const fichierUrl = req.file.filename;
    const document = await documentService.create({
      nom: req.body.nom || req.file.originalname,
      typeDocument: req.body.typeDocument || 'general',
      referenceType: req.body.referenceType || undefined,
      referenceId: req.body.referenceId || undefined,
      fichierUrl,
      fichierNomOriginal: req.file.originalname,
      fichierTaille: req.file.size,
      fichierType: req.file.mimetype,
      description: req.body.description,
      uploadedById: req.user!.userId,
      versionMajeure: parseInt(req.body.versionMajeure) || 1,
      versionMineure: parseInt(req.body.versionMineure) || 0,
      versionPatch: parseInt(req.body.versionPatch) || 0,
      tags: req.body.tags ? JSON.parse(req.body.tags) : undefined,
      estConfidentiel,
      permissionUserIds: estConfidentiel ? permissionUserIds : undefined,
    });

    await logAccess(req, res, 'creation', 'document', document.id, document.nom, {
      processusId: req.body.referenceId,
      version: `${req.body.versionMajeure || 1}.${req.body.versionMineure || 0}.${req.body.versionPatch || 0}`,
      estConfidentiel,
      nombreUtilisateursAutorises: estConfidentiel ? permissionUserIds.length : 0,
    });
    res.status(201).json(document);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const createVersion = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Fichier requis' });
    }

    // Récupérer l'ancienne version avant la création
    const oldDocument = await documentService.findOne(req.params.id);
    if (!oldDocument) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }
    
    // Vérifier les permissions pour les contributeurs
    if (req.user.role === 'contributeur') {
      // Si le document est lié à un processus, vérifier si l'utilisateur est propriétaire ou créateur
      if (oldDocument.referenceType === 'processus' && oldDocument.referenceId) {
        const { prisma } = await import('../utils/prisma');
        const processus = await prisma.processus.findUnique({
          where: { id: oldDocument.referenceId },
          select: { proprietaireId: true, createdById: true },
        });
        
        if (processus && processus.proprietaireId !== req.user.userId && processus.createdById !== req.user.userId) {
          return res.status(403).json({ 
            error: 'Vous n\'avez pas les permissions pour créer une nouvelle version de ce document. Seuls le propriétaire ou le créateur du processus peuvent créer une nouvelle version.' 
          });
        }
      } else if (oldDocument.referenceType === 'licence' && oldDocument.referenceId) {
        const { loadLicenceForAclById, canEditLicenceContent } = await import('../services/licence.service');
        const licence = await loadLicenceForAclById(oldDocument.referenceId);
        if (!licence || licence.deletedAt) {
          return res.status(404).json({ error: 'Licence non trouvée' });
        }
        if (!canEditLicenceContent(req.user.userId, req.user.role, licence)) {
          return res.status(403).json({
            error:
              'Vous n\'avez pas les permissions pour créer une nouvelle version de ce document. Un niveau Modification ou Suppression sur la licence est requis.',
          });
        }
      } else if (oldDocument.referenceType === 'projet' && oldDocument.referenceId) {
        if (isNativeProjetUploadDocument(oldDocument as any)) {
          const ok = await documentService.canUserDeleteOrAddVersion(
            oldDocument.id,
            req.user.userId,
            req.user.role
          );
          if (!ok) {
            return res.status(403).json({
              error:
                'Vous ne pouvez pas créer de version : seuls l’auteur ou un utilisateur explicitement autorisé sur cette pièce le peuvent.',
            });
          }
        } else {
          return res.status(403).json({
            error: 'Vous n\'avez pas les permissions pour créer une nouvelle version de ce document.',
          });
        }
      } else if (
        (oldDocument.referenceType === 'epic' || oldDocument.referenceType === 'userStory') &&
        oldDocument.referenceId
      ) {
        if (isNativeProjetUploadDocument(oldDocument as any)) {
          const ok = await documentService.canUserDeleteOrAddVersion(
            oldDocument.id,
            req.user.userId,
            req.user.role
          );
          if (!ok) {
            return res.status(403).json({
              error:
                'Vous ne pouvez pas créer de version : seuls l’auteur ou un utilisateur explicitement autorisé sur cette pièce le peuvent.',
            });
          }
        } else {
          return res.status(403).json({
            error: 'Vous n\'avez pas les permissions pour créer une nouvelle version de ce document.',
          });
        }
      } else {
        // Si le document n'est pas lié à un processus ni à une licence, seuls les admins peuvent créer une version
        return res.status(403).json({ 
          error: 'Vous n\'avez pas les permissions pour créer une nouvelle version de ce document.' 
        });
      }
    }

    // Vérifier les permissions pour les documents confidentiels
    // Pour ajouter une version, seuls les utilisateurs explicitement autorisés peuvent ajouter une version
    if (oldDocument.estConfidentiel) {
      const canAddVersion = await documentService.canUserDeleteOrAddVersion(oldDocument.id, req.user!.userId, req.user!.role);
      if (!canAddVersion) {
        return res.status(403).json({ error: 'Seuls les utilisateurs autorisés peuvent ajouter une version à ce document confidentiel' });
      }
    }

    const oldVersion = oldDocument.version || '1.0.0';

    const document = await documentService.createVersion(req.params.id, {
      fichierUrl: req.file.filename,
      fichierNomOriginal: req.file.originalname,
      fichierTaille: req.file.size,
      fichierType: req.file.mimetype,
      commentaireVersion: req.body.commentaireVersion,
      uploadedById: req.user!.userId,
    });

    await logAccess(req, res, 'modification', 'document', document.id, document.nom, {
      action: 'nouvelle_version',
      ancienneVersion: oldVersion,
      nouvelleVersion: document.version,
      commentaire: req.body.commentaireVersion,
    });
    res.json(document);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const viewDocument = async (req: AuthRequest, res: Response) => {
  try {
    const document = await documentService.findOne(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }

    // Vérifier les permissions pour les documents confidentiels
    const canAccess = await documentService.canUserAccessDocument(document.id, req.user!.userId, req.user!.role);
    if (!canAccess) {
      return res.status(403).json({ error: 'Accès non autorisé à ce document confidentiel' });
    }

    const filePath = path.join(UPLOAD_DIR, document.fichierUrl);
    
    // Vérifier que le fichier existe
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Fichier non trouvé sur le serveur' });
    }
    
    // Logger la visualisation (lecture)
    await logAccess(req, res, 'lecture', 'document', document.id, document.nom, {
      version: document.version,
      processusId: document.referenceId,
      typeAction: 'visualisation',
    });
    
    // Définir le type MIME correct
    const mimeType = document.fichierType || 'application/octet-stream';
    
    // Définir les headers appropriés pour la visualisation
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.fichierNomOriginal)}"`);
    
    // Lire et envoyer le fichier
    const fileBuffer = await fs.readFile(filePath);
    res.send(fileBuffer);
  } catch (error: any) {
    console.error('Erreur viewDocument:', error);
    res.status(500).json({ error: error.message });
  }
};

export const downloadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const document = await documentService.findOne(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }

    // Vérifier les permissions pour les documents confidentiels
    const canAccess = await documentService.canUserAccessDocument(document.id, req.user!.userId, req.user!.role);
    if (!canAccess) {
      return res.status(403).json({ error: 'Accès non autorisé à ce document confidentiel' });
    }

    const dlPath = await documentService.resolveExistingFilePath(document);
    if (!dlPath) {
      return res.status(404).json({ error: 'Fichier non trouvé sur le serveur' });
    }

    await logAccess(req, res, 'telechargement', 'document', document.id, document.nom, {
      version: document.version,
      processusId: document.referenceId,
    });

    res.download(dlPath, document.fichierNomOriginal);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const downloadVersion = async (req: AuthRequest, res: Response) => {
  try {
    const { id, versionId } = req.params;
    const document = await documentService.findOne(id);
    if (!document) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }

    // Vérifier les permissions pour les documents confidentiels
    const canAccess = await documentService.canUserAccessDocument(document.id, req.user!.userId, req.user!.role);
    if (!canAccess) {
      return res.status(403).json({ error: 'Accès non autorisé à ce document confidentiel' });
    }

    const version = document.versions?.find((v: any) => v.id === versionId);
    if (!version) {
      return res.status(404).json({ error: 'Version non trouvée' });
    }

    const filePath = path.join(UPLOAD_DIR, version.fichierUrl);
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ error: 'Fichier de cette version introuvable sur le serveur' });
    }

    await logAccess(req, res, 'telechargement', 'document', document.id, document.nom, {
      version: version.version,
      typeTelechargement: 'version_ancienne',
      processusId: document.referenceId,
    });

    res.download(filePath, `${document.fichierNomOriginal}_v${version.version}`);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    const oldDocument = await documentService.findOne(req.params.id);
    if (!oldDocument) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }
    
    // Vérifier les permissions pour les contributeurs
    if (req.user.role === 'contributeur') {
      // Si le document est lié à un processus, vérifier si l'utilisateur est propriétaire ou créateur
      if (oldDocument.referenceType === 'processus' && oldDocument.referenceId) {
        const { prisma } = await import('../utils/prisma');
        const processus = await prisma.processus.findUnique({
          where: { id: oldDocument.referenceId },
          select: { proprietaireId: true, createdById: true },
        });
        
        if (processus && processus.proprietaireId !== req.user.userId && processus.createdById !== req.user.userId) {
          return res.status(403).json({ 
            error: 'Vous n\'avez pas les permissions pour modifier ce document. Seuls le propriétaire ou le créateur du processus peuvent modifier un document.' 
          });
        }
      } else if (oldDocument.referenceType === 'licence' && oldDocument.referenceId) {
        const { loadLicenceForAclById, canEditLicenceContent } = await import('../services/licence.service');
        const licence = await loadLicenceForAclById(oldDocument.referenceId);
        if (!licence || licence.deletedAt) {
          return res.status(404).json({ error: 'Licence non trouvée' });
        }
        if (!canEditLicenceContent(req.user.userId, req.user.role, licence)) {
          return res.status(403).json({
            error:
              'Vous n\'avez pas les permissions pour modifier ce document. Un niveau Modification ou Suppression sur la licence est requis.',
          });
        }
      } else if (oldDocument.referenceType === 'projet' && oldDocument.referenceId) {
        if (
          isNativeProjetUploadDocument(oldDocument as any) &&
          oldDocument.uploadedById === req.user.userId
        ) {
          /* auteur d’une pièce confidentielle déposée sur le projet */
        } else {
          return res.status(403).json({
            error:
              'Modification non autorisée : document lié ou non auteur — utilisez le contexte d’origine ou contactez l’auteur de la pièce.',
          });
        }
      } else {
        // Si le document n'est pas lié à un processus ni à une licence, seuls les admins peuvent le modifier
        return res.status(403).json({ 
          error: 'Vous n\'avez pas les permissions pour modifier ce document.' 
        });
      }
    }

    const estConfidentiel = req.body.estConfidentiel !== undefined 
      ? (req.body.estConfidentiel === 'true' || req.body.estConfidentiel === true)
      : oldDocument.estConfidentiel;
    const permissionUserIds = req.body.permissionUserIds 
      ? (Array.isArray(req.body.permissionUserIds) ? req.body.permissionUserIds : req.body.permissionUserIds.split(','))
      : undefined;

    // Vérifier si l'utilisateur essaie de définir/retirer confidentiel
    if (req.body.estConfidentiel !== undefined) {
      // Si le document est lié à un processus, vérifier si l'utilisateur est propriétaire ou créateur
      if (oldDocument.referenceType === 'processus' && oldDocument.referenceId) {
        const { prisma } = await import('../utils/prisma');
        const processus = await prisma.processus.findUnique({
          where: { id: oldDocument.referenceId },
          select: { proprietaireId: true, createdById: true },
        });
        
        if (processus && (processus.proprietaireId !== req.user!.userId && processus.createdById !== req.user!.userId)) {
          return res.status(403).json({ error: 'Seul le propriétaire ou le créateur du processus peut définir un document comme confidentiel' });
        }
      }

      // Si on définit comme confidentiel, vérifier qu'au moins un utilisateur est sélectionné
      if (estConfidentiel && (!permissionUserIds || permissionUserIds.length === 0)) {
        return res.status(400).json({ error: 'Au moins un utilisateur doit être sélectionné pour un document confidentiel' });
      }
    }

    // Vérifier les permissions pour modifier un document confidentiel
    if (oldDocument.estConfidentiel) {
      const canModify = await documentService.canUserModifyConfidentialDocument(
        oldDocument.id,
        req.user!.userId,
        req.user!.role,
      );
      if (!canModify) {
        return res.status(403).json({ error: 'Seuls les utilisateurs autorisés peuvent modifier ce document confidentiel' });
      }
    }
    
    const document = await documentService.update(req.params.id, {
      ...req.body,
      estConfidentiel: req.body.estConfidentiel !== undefined ? estConfidentiel : undefined,
      permissionUserIds,
    });
    
    // Détails des modifications
    const details: any = {};
    if (req.body.statut && oldDocument?.statut !== req.body.statut) {
      details.changementStatut = `${oldDocument?.statut} → ${req.body.statut}`;
    }
    if (req.body.nom && oldDocument?.nom !== req.body.nom) {
      details.changementNom = `${oldDocument?.nom} → ${req.body.nom}`;
    }
    if (req.body.estConfidentiel !== undefined && oldDocument?.estConfidentiel !== req.body.estConfidentiel) {
      details.changementConfidentiel = req.body.estConfidentiel;
    }
    
    await logAccess(req, res, 'modification', 'document', document.id, document.nom, Object.keys(details).length > 0 ? details : undefined);
    res.json(document);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    
    const document = await documentService.findOne(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Document non trouvé' });
    }
    
    // Vérifier les permissions pour les contributeurs
    if (req.user.role === 'contributeur') {
      // Si le document est lié à un processus, vérifier si l'utilisateur est propriétaire ou créateur
      if (document.referenceType === 'processus' && document.referenceId) {
        const { prisma } = await import('../utils/prisma');
        const processus = await prisma.processus.findUnique({
          where: { id: document.referenceId },
          select: { proprietaireId: true, createdById: true },
        });
        
        if (processus && processus.proprietaireId !== req.user.userId && processus.createdById !== req.user.userId) {
          return res.status(403).json({ 
            error: 'Vous n\'avez pas les permissions pour supprimer ce document. Seuls le propriétaire ou le créateur du processus peuvent supprimer un document.' 
          });
        }
      } else if (document.referenceType === 'licence' && document.referenceId) {
        const { loadLicenceForAclById, canEditLicenceContent } = await import('../services/licence.service');
        const licence = await loadLicenceForAclById(document.referenceId);
        if (!licence || licence.deletedAt) {
          return res.status(404).json({ error: 'Licence non trouvée' });
        }
        if (!canEditLicenceContent(req.user.userId, req.user.role, licence as any)) {
          return res.status(403).json({
            error:
              'Vous n\'avez pas les permissions pour supprimer ce document. Un niveau Modification ou Suppression sur la licence est requis.',
          });
        }
      } else if (document.referenceType === 'projet' && document.referenceId) {
        if (isNativeProjetUploadDocument(document as any)) {
          const ok = await documentService.canUserDeleteOrAddVersion(
            document.id,
            req.user.userId,
            req.user.role
          );
          if (!ok) {
            return res.status(403).json({
              error:
                'Suppression non autorisée : seuls l’auteur ou un utilisateur explicitement autorisé sur cette pièce peuvent supprimer.',
            });
          }
        } else {
          return res.status(403).json({
            error: 'Vous n\'avez pas les permissions pour supprimer ce document.',
          });
        }
      } else if (
        (document.referenceType === 'epic' || document.referenceType === 'userStory') &&
        document.referenceId
      ) {
        if (isNativeProjetUploadDocument(document as any)) {
          const ok = await documentService.canUserDeleteOrAddVersion(
            document.id,
            req.user.userId,
            req.user.role
          );
          if (!ok) {
            return res.status(403).json({
              error:
                'Suppression non autorisée : seuls l’auteur ou un utilisateur explicitement autorisé sur cette pièce peuvent supprimer.',
            });
          }
        } else {
          return res.status(403).json({
            error: 'Vous n\'avez pas les permissions pour supprimer ce document.',
          });
        }
      } else {
        // Si le document n'est pas lié à un processus ni à une licence, seuls les admins peuvent le supprimer
        return res.status(403).json({ 
          error: 'Vous n\'avez pas les permissions pour supprimer ce document.' 
        });
      }
    }

    // Vérifier les permissions pour les documents confidentiels
    // Pour la suppression, seuls les utilisateurs explicitement autorisés peuvent supprimer
    if (document.estConfidentiel) {
      const canDelete = await documentService.canUserDeleteOrAddVersion(document.id, req.user!.userId, req.user!.role);
      if (!canDelete) {
        return res.status(403).json({ error: 'Seuls les utilisateurs autorisés peuvent supprimer ce document confidentiel' });
      }
    }

    await documentService.delete(req.params.id);
    await logAccess(req, res, 'suppression', 'document', req.params.id);
    res.status(204).send();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const getDocumentAcces = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId || !req.user?.role) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const data = await documentService.getDocumentAccesDetail(req.params.id, req.user.userId, req.user.role);
    res.json(data);
  } catch (e: any) {
    const code =
      e.message === 'NOT_FOUND'
        ? 404
        : e.message === 'FORBIDDEN'
          ? 403
          : e.message === 'ACCES_DETAIL_UNAVAILABLE'
            ? 400
            : 500;
    const msg =
      e.message === 'ACCES_DETAIL_UNAVAILABLE'
        ? "Le détail d'accès avancé n'est disponible que pour un document confidentiel déposé depuis la fiche projet ou la fiche processus (type métier aligné sur la fiche)."
        : e.message;
    res.status(code).json({ error: msg });
  }
};

export const addDocumentPermissionRow = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    const row = await documentService.addDocumentExplicitPermission(req.params.id, userId, req.user.userId);
    await logAccess(req, res, 'modification', 'document', req.params.id, undefined, {
      action: 'document_permission_ajoutee',
      userId,
    });
    res.status(201).json(row);
  } catch (e: any) {
    const code =
      e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const removeDocumentPermissionRow = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await documentService.removeDocumentPermissionEntry(req.params.id, req.params.permissionId, req.user.userId);
    await logAccess(req, res, 'modification', 'document', req.params.id, undefined, {
      action: 'document_permission_retiree',
      permissionId: req.params.permissionId,
    });
    res.status(204).send();
  } catch (e: any) {
    const code = e.message === 'NOT_FOUND' ? 404 : e.message === 'FORBIDDEN' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const blockDocumentAdminImplicit = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requis' });
    await documentService.blockDocumentAdminImplicit(req.params.id, userId, req.user.userId);
    await logAccess(req, res, 'modification', 'document', req.params.id, undefined, {
      action: 'document_admin_sans_acces',
      userId,
    });
    res.status(204).send();
  } catch (e: any) {
    const code = e.message === 'FORBIDDEN' || e.message === 'NOT_FOUND' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};

export const restoreDocumentAdminImplicit = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await documentService.restoreDocumentAdminImplicit(req.params.id, req.params.userId, req.user.userId);
    await logAccess(req, res, 'modification', 'document', req.params.id, undefined, {
      action: 'document_admin_acces_retabli',
      userId: req.params.userId,
    });
    res.status(204).send();
  } catch (e: any) {
    const code = e.message === 'FORBIDDEN' || e.message === 'NOT_FOUND' ? 403 : 400;
    res.status(code).json({ error: e.message });
  }
};
