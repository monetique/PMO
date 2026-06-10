import express from "express";
import cors from "cors";
import helmet from "helmet";
import "dotenv/config";
import { authenticate, requireRole } from "./middleware/auth";
import { logger as loggerMiddleware } from "./middleware/logger";

// Controllers
import * as authController from "./controllers/auth.controller";
import * as entiteController from "./controllers/entite.controller";
import * as processusController from "./controllers/processus.controller";
import * as documentController from "./controllers/document.controller";
import * as documentCommentController from "./controllers/document-comment.controller";
import * as userController from "./controllers/user.controller";
import * as dashboardController from "./controllers/dashboard.controller";
import * as journalController from "./controllers/journal.controller";
import * as categorieController from "./controllers/categorie.controller";
import * as smtpController from "./controllers/smtp.controller";
import * as companyInfoController from "./controllers/company-info.controller";
import * as projetController from "./controllers/projet.controller";
import * as corbeilleController from "./controllers/corbeille.controller";
import * as favorisController from "./controllers/favoris.controller";
import * as contratController from "./controllers/contrat.controller";
import * as ocrController from "./controllers/ocr.controller";
import * as clientFournisseurController from "./controllers/client-fournisseur.controller";
import * as tacheController from "./controllers/tache.controller";
import * as epicController from "./controllers/epic.controller";
import * as notificationController from "./controllers/notification.controller";
import * as notificationEmailFailureController from "./controllers/notification-email-failure.controller";
import * as notificationSettingController from "./controllers/notification-setting.controller";
import * as jourFerieController from "./controllers/jour-ferie.controller";
import * as licenceController from "./controllers/licence.controller";
import * as typeLicenceController from "./controllers/type-licence.controller";
import * as typeContratController from "./controllers/type-contrat.controller";
import * as typeEntiteController from "./controllers/type-entite.controller";
import * as deviseController from "./controllers/devise.controller";
import * as pvReunionController from "./controllers/pv-reunion.controller";
import { runLicenceAlertDispatch } from "./services/licence-alert-dispatch.service";

const app = express();
app.use(helmet());
// Configuration CORS pour autoriser plusieurs origines
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:5173",
  "http://localhost:5173",
  "http://localhost:5175",
  "http://127.0.0.1:5175",
  "http://172.17.5.198:5173",
  "http://127.0.0.1:5173",
  "https://172.17.11.17",
  "https://pmo.monetiquetunisie.com",
];

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Autoriser les requêtes sans origine (ex: Postman, curl)
      if (!origin) {
        return callback(null, true);
      }
      // Vérifier si l'origine est autorisée
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        // En développement, autoriser toutes les origines
        if (process.env.NODE_ENV !== "production") {
          callback(null, true);
        } else {
          callback(new Error("Not allowed by CORS"));
        }
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "authorization", "Content-Type", "Accept"],
    exposedHeaders: ["Authorization"],
  })
);
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) return next();
  express.json()(req, res, next);
});

// Health check (sans auth)
app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok", service: "api", version: "0.1.0" });
});

// Routes publiques (auth)
app.post("/api/v1/auth/login", authController.login);
app.post("/api/v1/auth/refresh", authController.refresh);
app.post("/api/v1/auth/register", authController.register);
app.post("/api/v1/auth/forgot-password", authController.forgotPassword);
app.post("/api/v1/auth/reset-password", authController.resetPassword);

// Middleware d'authentification pour routes protégées
app.use(authenticate);
app.use(loggerMiddleware);

app.get("/api/v1/auth/me", authController.me);

// Dashboard
app.get("/api/v1/dashboard", dashboardController.getKPIs);
app.get("/api/v1/dashboard/taches-en-retard", dashboardController.getTachesEnRetard);

// Entités
app.get("/api/v1/entites", entiteController.getAllEntites);
app.get("/api/v1/entites/tree", entiteController.getEntiteTree);
app.get("/api/v1/entites/corbeille", entiteController.getEntitesCorbeille);
app.get("/api/v1/entites/:id/acces", entiteController.getEntiteAcces);
app.post("/api/v1/entites/:id/admin-sans-acces", entiteController.postEntiteAdminSansAcces);
app.delete("/api/v1/entites/:id/admin-sans-acces/:userId", entiteController.deleteEntiteAdminSansAcces);
app.get("/api/v1/entites/:id/history", entiteController.getEntiteHistory);
app.post("/api/v1/entites/:id/permissions", entiteController.addEntitePermission);
app.delete("/api/v1/entites/:id/permissions/:permissionId", entiteController.removeEntitePermission);
app.get("/api/v1/entites/:id", entiteController.getEntite);
app.post("/api/v1/entites", entiteController.createEntite);
app.put("/api/v1/entites/:id", entiteController.updateEntite);
app.delete("/api/v1/entites/:id", entiteController.deleteEntite);

// Processus (routes spécifiques avant :id)
app.get("/api/v1/processus", processusController.getAllProcessus);
app.get("/api/v1/processus/corbeille", processusController.getProcessusCorbeille);
app.get("/api/v1/processus/:id/acces", processusController.getProcessusAcces);
app.post("/api/v1/processus/:id/admin-sans-acces", processusController.postProcessusAdminSansAcces);
app.delete(
  "/api/v1/processus/:id/admin-sans-acces/:userId",
  processusController.deleteProcessusAdminSansAcces
);
app.post("/api/v1/processus/:id/permissions", processusController.addProcessusPermission);
app.delete(
  "/api/v1/processus/:id/permissions/:permissionId",
  processusController.removeProcessusPermission
);
app.get("/api/v1/processus/:id/history", processusController.getProcessusHistory);
app.get("/api/v1/processus/:id/pv-reunions", processusController.getProcessusPvReunions);
app.get("/api/v1/processus/:id", processusController.getProcessus);
app.post("/api/v1/processus", processusController.createProcessus);
app.put("/api/v1/processus/:id", processusController.updateProcessus);
app.patch("/api/v1/processus/:id/status", processusController.updateProcessusStatus);
app.delete("/api/v1/processus/:id", processusController.deleteProcessus);

// Projets
app.get("/api/v1/projets", projetController.getAllProjets);
app.get("/api/v1/projets/corbeille", projetController.getProjetsCorbeille);
app.get("/api/v1/projets/:id/acces", projetController.getProjetAcces);
app.post("/api/v1/projets/:id/admin-sans-acces", projetController.postProjetAdminSansAcces);
app.delete("/api/v1/projets/:id/admin-sans-acces/:userId", projetController.deleteProjetAdminSansAcces);
app.get("/api/v1/projets/:id/history", projetController.getProjetHistory);
app.post("/api/v1/projets/:id/permissions", projetController.addProjetPermission);
app.delete("/api/v1/projets/:id/permissions/:permissionId", projetController.removeProjetPermission);
app.get("/api/v1/projets/:id/scoring", projetController.getProjetScoring);
app.get("/api/v1/projets/:id/pv-reunions", projetController.getProjetPvReunions);
app.get("/api/v1/projets/:id", projetController.getProjet);
app.post("/api/v1/projets", projetController.createProjet);
app.put("/api/v1/projets/:id", projetController.updateProjet);
app.delete("/api/v1/projets/:id", projetController.deleteProjet);

// PV de réunion
app.get("/api/v1/pv-reunions", pvReunionController.getPvReunions);
app.get("/api/v1/pv-reunions/corbeille", pvReunionController.getPvReunionsCorbeille);
app.get("/api/v1/pv-reunions/:id/history", pvReunionController.getPvReunionHistory);
app.get("/api/v1/pv-reunions/:id/acces", pvReunionController.getPvReunionAcces);
app.post("/api/v1/pv-reunions/:id/admin-sans-acces", pvReunionController.postPvReunionAdminSansAcces);
app.delete(
  "/api/v1/pv-reunions/:id/admin-sans-acces/:userId",
  pvReunionController.deletePvReunionAdminSansAcces
);
app.delete(
  "/api/v1/pv-reunions/:id/permissions/entry/:permissionEntryId",
  pvReunionController.deletePvReunionPermissionEntry
);
app.post("/api/v1/pv-reunions/:id/permissions", pvReunionController.postPvReunionPermission);
app.delete("/api/v1/pv-reunions/:id/permissions/:userId", pvReunionController.deletePvReunionPermission);
app.get(
  "/api/v1/pv-reunions/:id/commentaires/:commentId/piece",
  pvReunionController.downloadPvCommentairePiece
);
app.patch("/api/v1/pv-reunions/:id/contenu", pvReunionController.patchPvReunionContenu);
app.get("/api/v1/pv-reunions/:id/contenu-versions", pvReunionController.getPvReunionContenuVersions);
app.get(
  "/api/v1/pv-reunions/:id/contenu-versions/:versionId",
  pvReunionController.getPvReunionContenuVersion
);
app.get("/api/v1/pv-reunions/:id", pvReunionController.getPvReunion);
app.post(
  "/api/v1/pv-reunions",
  pvReunionController.uploadPvPrincipal,
  pvReunionController.createPvReunion
);
app.put("/api/v1/pv-reunions/:id", pvReunionController.updatePvReunion);
app.delete("/api/v1/pv-reunions/:id", pvReunionController.deletePvReunion);
app.post(
  "/api/v1/pv-reunions/:id/commentaires",
  pvReunionController.uploadPvCommentaire,
  pvReunionController.addPvCommentaire
);

// Documents — routes plus spécifiques avant /documents/:id pour éviter toute ambiguïté Express
app.get("/api/v1/documents", documentController.getAllDocuments);
app.post("/api/v1/documents", documentController.uploadMiddleware, documentController.createDocument);
app.post("/api/v1/documents/:id/versions", documentController.uploadMiddleware, documentController.createVersion);
app.get("/api/v1/documents/:id/view", documentController.viewDocument);
app.get("/api/v1/documents/:id/download", documentController.downloadDocument);
app.get("/api/v1/documents/:id/versions/:versionId/download", documentController.downloadVersion);
app.get("/api/v1/documents/:id/comments", documentCommentController.listComments);
app.get("/api/v1/documents/:id/acces", documentController.getDocumentAcces);
app.post("/api/v1/documents/:id/permissions", documentController.addDocumentPermissionRow);
app.delete(
  "/api/v1/documents/:id/permissions/:permissionId",
  documentController.removeDocumentPermissionRow
);
app.post("/api/v1/documents/:id/admin-sans-acces", documentController.blockDocumentAdminImplicit);
app.delete(
  "/api/v1/documents/:id/admin-sans-acces/:userId",
  documentController.restoreDocumentAdminImplicit
);
app.get("/api/v1/documents/:id", documentController.getDocument);
app.put("/api/v1/documents/:id", documentController.updateDocument);
app.delete("/api/v1/documents/:id", documentController.deleteDocument);
// Commentaires de documents (POST avec fichier)
app.post("/api/v1/documents/:id/comments", documentCommentController.uploadMiddleware, documentCommentController.addComment);
app.get("/api/v1/comments/:commentId/attachment", documentCommentController.downloadAttachment);

// Utilisateurs
app.get("/api/v1/users", userController.getAllUsers);
app.get(
  "/api/v1/users/:id/acces-synthese",
  requireRole("admin"),
  userController.getUserAccessSynthese
);
app.patch("/api/v1/users/:id/ui-module", requireRole("admin"), userController.patchUserUiModule);
app.delete(
  "/api/v1/users/:id/permissions-deleguees/:permId",
  requireRole("admin"),
  userController.deleteUserPermissionDelegation
);
app.delete(
  "/api/v1/users/:id/document-permissions/:permId",
  requireRole("admin"),
  userController.deleteUserDocumentPermission
);
app.get("/api/v1/users/:id", userController.getUser);
app.post("/api/v1/users", userController.createUser);
app.put("/api/v1/users/:id", userController.updateUser);
app.patch("/api/v1/users/:id/password", userController.updateUserPassword);
app.delete("/api/v1/users/:id", userController.deleteUser);

// Catégories
app.get("/api/v1/categories", categorieController.getAllCategories);
app.get("/api/v1/categories/:id", categorieController.getCategorie);
app.post("/api/v1/categories", categorieController.createCategorie);
app.put("/api/v1/categories/:id", categorieController.updateCategorie);
app.delete("/api/v1/categories/:id", categorieController.deleteCategorie);

// Journal d'accès
app.get("/api/v1/journal", journalController.getJournal);

// Configuration SMTP
app.get("/api/v1/smtp", smtpController.getAllSMTPConfigs);
app.get("/api/v1/smtp/:id", smtpController.getSMTPConfig);
app.post("/api/v1/smtp", smtpController.createSMTPConfig);
app.put("/api/v1/smtp/:id", smtpController.updateSMTPConfig);
app.delete("/api/v1/smtp/:id", smtpController.deleteSMTPConfig);
app.post("/api/v1/smtp/:id/test", smtpController.testSMTPConfig);
app.post("/api/v1/smtp/test-notification", authenticate, smtpController.testNotification);

// Informations entreprise (logo + adresse pour PDF PV)
app.get("/api/v1/company-info", companyInfoController.getCompanyInfo);
app.get("/api/v1/company-info/logo", companyInfoController.getCompanyLogo);
app.put(
  "/api/v1/company-info",
  companyInfoController.uploadCompanyLogo,
  companyInfoController.saveCompanyInfo
);

// Corbeille (accessible uniquement au super admin)
app.get("/api/v1/corbeille", corbeilleController.getCorbeille);
app.post("/api/v1/corbeille/processus/:id/restaurer", corbeilleController.restaurerProcessus);
app.post("/api/v1/corbeille/documents/:id/restaurer", corbeilleController.restaurerDocument);
app.delete("/api/v1/corbeille/processus/:id", corbeilleController.supprimerDefinitivementProcessus);
app.delete("/api/v1/corbeille/documents/:id", corbeilleController.supprimerDefinitivementDocument);
app.post("/api/v1/corbeille/licences/:id/restaurer", corbeilleController.restaurerLicence);
app.delete("/api/v1/corbeille/licences/:id", corbeilleController.supprimerDefinitivementLicence);
app.post("/api/v1/corbeille/clients-fournisseurs/:id/restaurer", corbeilleController.restaurerClientFournisseur);
app.delete("/api/v1/corbeille/clients-fournisseurs/:id", corbeilleController.supprimerDefinitivementClientFournisseur);
app.post("/api/v1/corbeille/contrats/:id/restaurer", corbeilleController.restaurerContrat);
app.delete("/api/v1/corbeille/contrats/:id", corbeilleController.supprimerDefinitivementContrat);
app.post("/api/v1/corbeille/entites/:id/restaurer", corbeilleController.restaurerEntite);
app.delete("/api/v1/corbeille/entites/:id", corbeilleController.supprimerDefinitivementEntite);
app.post("/api/v1/corbeille/projets/:id/restaurer", corbeilleController.restaurerProjet);
app.delete("/api/v1/corbeille/projets/:id", corbeilleController.supprimerDefinitivementProjet);
app.post("/api/v1/corbeille/pv-reunions/:id/restaurer", corbeilleController.restaurerPvReunion);
app.delete("/api/v1/corbeille/pv-reunions/:id", corbeilleController.supprimerDefinitivementPvReunion);
app.post("/api/v1/corbeille/taches-agile/:id/restaurer", corbeilleController.restaurerTacheAgile);
app.delete("/api/v1/corbeille/taches-agile/:id", corbeilleController.supprimerDefinitivementTacheAgile);
app.post("/api/v1/corbeille/epics-agile/:id/restaurer", corbeilleController.restaurerEpicAgile);
app.delete("/api/v1/corbeille/epics-agile/:id", corbeilleController.supprimerDefinitivementEpicAgile);
app.post("/api/v1/corbeille/user-stories-agile/:id/restaurer", corbeilleController.restaurerUserStoryAgile);
app.delete("/api/v1/corbeille/user-stories-agile/:id", corbeilleController.supprimerDefinitivementUserStoryAgile);

// Favoris
app.get("/api/v1/favoris", favorisController.getFavoris);
app.post("/api/v1/favoris/processus/:id", favorisController.ajouterProcessusFavori);
app.delete("/api/v1/favoris/processus/:id", favorisController.retirerProcessusFavori);
app.post("/api/v1/favoris/documents/:id", favorisController.ajouterDocumentFavori);
app.delete("/api/v1/favoris/documents/:id", favorisController.retirerDocumentFavori);
app.get("/api/v1/favoris/processus/:id/check", favorisController.estProcessusFavori);
app.get("/api/v1/favoris/documents/:id/check", favorisController.estDocumentFavori);
// Types de société
app.get("/api/v1/types-societe", clientFournisseurController.getTypesSociete);
app.post("/api/v1/types-societe", clientFournisseurController.createTypeSociete);
app.put("/api/v1/types-societe/:id", clientFournisseurController.updateTypeSociete);
app.delete("/api/v1/types-societe/:id", clientFournisseurController.deleteTypeSociete);
// Clients / Fournisseurs
app.get("/api/v1/clients-fournisseurs", clientFournisseurController.getClientsFournisseurs);
app.get(
  "/api/v1/clients-fournisseurs/corbeille",
  clientFournisseurController.getClientsFournisseursCorbeille
);
app.get("/api/v1/clients-fournisseurs/:id/acces", clientFournisseurController.getClientFournisseurAcces);
app.post(
  "/api/v1/clients-fournisseurs/:id/admin-sans-acces",
  clientFournisseurController.postClientFournisseurAdminSansAcces
);
app.delete(
  "/api/v1/clients-fournisseurs/:id/admin-sans-acces/:userId",
  clientFournisseurController.deleteClientFournisseurAdminSansAcces
);
app.get("/api/v1/clients-fournisseurs/:id/historique", clientFournisseurController.getClientFournisseurHistorique);
app.post("/api/v1/clients-fournisseurs/:id/permissions", clientFournisseurController.addClientFournisseurPermission);
app.delete(
  "/api/v1/clients-fournisseurs/:id/permissions/:permissionId",
  clientFournisseurController.removeClientFournisseurPermission
);
app.get("/api/v1/clients-fournisseurs/:id", clientFournisseurController.getClientFournisseur);
app.post("/api/v1/clients-fournisseurs", clientFournisseurController.createClientFournisseur);
app.put("/api/v1/clients-fournisseurs/:id", clientFournisseurController.updateClientFournisseur);
app.delete("/api/v1/clients-fournisseurs/:id", clientFournisseurController.deleteClientFournisseur);
// Représentants légaux
app.post("/api/v1/clients-fournisseurs/:id/representants", clientFournisseurController.addRepresentant);
app.put("/api/v1/clients-fournisseurs/:id/representants/:repId", clientFournisseurController.updateRepresentant);
app.delete("/api/v1/clients-fournisseurs/:id/representants/:repId", clientFournisseurController.deleteRepresentant);
app.post("/api/v1/clients-fournisseurs/:id/contrats", clientFournisseurController.linkContratClientFournisseur);
app.delete("/api/v1/clients-fournisseurs/:id/contrats/:contratId", clientFournisseurController.unlinkContratClientFournisseur);
app.post("/api/v1/clients-fournisseurs/:id/projets", clientFournisseurController.addProjet);
app.delete("/api/v1/clients-fournisseurs/:id/projets/:projetId", clientFournisseurController.removeProjet);

// Routes Contrats (chemins statiques avant :id)
app.get("/api/v1/contrats", contratController.getContrats);
app.get("/api/v1/contrats/corbeille", contratController.getContratsCorbeille);
app.get("/api/v1/contrats/stats-vues-pj", contratController.getContratsStatsVuesPj);
app.get("/api/v1/contrats/:id/acces", contratController.getContratAcces);
app.get("/api/v1/contrats/:id/historique", contratController.getContratHistorique);
app.get("/api/v1/contrats/:id/pv-reunions", contratController.getContratPvReunions);
app.post("/api/v1/contrats/:id/admin-sans-acces", contratController.blockAdminImplicitAccess);
app.delete(
  "/api/v1/contrats/:id/admin-sans-acces/:userId",
  contratController.restoreAdminImplicitAccess
);
app.delete(
  "/api/v1/contrats/:id/permissions/entry/:permissionEntryId",
  contratController.removePermissionEntry
);
app.get("/api/v1/contrats/:id", contratController.getContrat);
app.post("/api/v1/contrats", contratController.uploadContrat, contratController.createContrat);
app.put("/api/v1/contrats/:id", contratController.updateContrat);
app.delete("/api/v1/contrats/:id", contratController.deleteContrat);
app.post("/api/v1/contrats/:id/permissions", contratController.addPermission);
app.delete("/api/v1/contrats/:id/permissions/:userId", contratController.removePermission);
app.post("/api/v1/contrats/:id/documents", contratController.addDocumentToContrat);
app.post("/api/v1/contrats/:id/link-document", contratController.linkDocument);
// Routes OCR
app.get("/api/v1/ocr/documents", authenticate, ocrController.getDocumentsOcr);
app.get("/api/v1/ocr/export/:id", authenticate, ocrController.exportOcrDocument);
app.post("/api/v1/ocr/scan/:id", authenticate, ocrController.scanDocument);
app.post("/api/v1/ocr/scan-all", authenticate, ocrController.scanAll);
app.get("/api/v1/ocr/search", authenticate, ocrController.searchOcr);

app.post("/api/v1/contrats/:id/upload", contratController.uploadContrat, contratController.uploadAndLinkDocument);
app.delete("/api/v1/contrats/:id/documents/:documentId", contratController.removeDocumentFromContrat);


// Tâches
app.get("/api/v1/taches", tacheController.getAllTaches);
app.get("/api/v1/taches/corbeille", tacheController.getTachesCorbeille);
// Documents de tâches
app.get("/api/v1/taches/documents-liables", tacheController.getDocumentsLiables);
app.get("/api/v1/taches/:id/acces", tacheController.getTacheAcces);
app.post("/api/v1/taches/:id/assignes", tacheController.postTacheAssigne);
app.patch("/api/v1/taches/:id/assignes/:assignId", tacheController.patchTacheAssignePermission);
app.delete("/api/v1/taches/:id/assignes/:assignId", tacheController.deleteTacheAssigne);
app.post("/api/v1/taches/:id/admin-sans-acces", tacheController.postTacheAdminSansAcces);
app.delete("/api/v1/taches/:id/admin-sans-acces/:userId", tacheController.deleteTacheAdminSansAcces);
app.get("/api/v1/taches/:id/history", tacheController.getTacheHistory);
app.get("/api/v1/taches/:id/pv-reunions", tacheController.getTachePvReunions);
app.post("/api/v1/taches/:id/restaurer", tacheController.restoreTache);
app.get("/api/v1/taches/:id", tacheController.getTache);
app.post("/api/v1/taches", tacheController.createTache);
app.put("/api/v1/taches/:id", tacheController.updateTache);
app.delete("/api/v1/taches/:id", tacheController.deleteTache);
app.get("/api/v1/taches/:id/commentaires", tacheController.getCommentaires);
app.post("/api/v1/taches/:id/commentaires", tacheController.uploadMiddleware, tacheController.addCommentaire);
app.get("/api/v1/taches/:id/commentaires/:commentaireId/fichier", tacheController.downloadCommentaireFichier);
app.post("/api/v1/taches/:id/documents/lier", tacheController.lierDocument);
app.delete("/api/v1/taches/:id/documents/:documentId", tacheController.delierDocument);
app.post("/api/v1/taches/:id/documents", tacheController.uploadMiddleware, tacheController.uploadDocument);

// Epics & user stories (routes spécifiques avant :id)
app.get("/api/v1/epics", epicController.getEpics);
app.get("/api/v1/epics/corbeille", epicController.getEpicsCorbeille);
app.post("/api/v1/epics", epicController.createEpic);
app.post("/api/v1/epics/:id/documents/lier", epicController.lierDocumentEpic);
app.delete("/api/v1/epics/:id/documents/:documentId", epicController.delierDocumentEpic);
app.post("/api/v1/epics/:id/documents", epicController.epicUploadMiddleware, epicController.uploadDocumentEpic);
app.get("/api/v1/epics/:id/acces", epicController.getEpicAcces);
app.post("/api/v1/epics/:id/permissions", epicController.postEpicPermission);
app.patch("/api/v1/epics/:id/permissions/:permissionId", epicController.patchEpicPermission);
app.delete("/api/v1/epics/:id/permissions/:permissionId", epicController.deleteEpicPermission);
app.post("/api/v1/epics/:id/admin-sans-acces", epicController.postEpicAdminSansAcces);
app.delete("/api/v1/epics/:id/admin-sans-acces/:userId", epicController.deleteEpicAdminSansAcces);
app.get("/api/v1/epics/:id/commentaires", epicController.getEpicCommentaires);
app.post(
  "/api/v1/epics/:id/commentaires",
  epicController.epicCommentUploadMiddleware,
  epicController.addEpicCommentaire,
);
app.get(
  "/api/v1/epics/:id/commentaires/:commentaireId/fichier",
  epicController.downloadEpicCommentaireFichier,
);
app.post("/api/v1/epics/:id/restaurer", epicController.restoreEpic);
app.get("/api/v1/epics/:id/history", epicController.getEpicHistory);
app.get("/api/v1/epics/:id/pv-reunions", epicController.getEpicPvReunions);
app.delete("/api/v1/epics/:id", epicController.softDeleteEpic);
app.get("/api/v1/epics/:id", epicController.getEpic);
app.put("/api/v1/epics/:id", epicController.updateEpic);
app.get("/api/v1/user-stories", epicController.getUserStories);
app.get("/api/v1/user-stories/corbeille", epicController.getUserStoriesCorbeille);
app.post("/api/v1/user-stories", epicController.createUserStory);
app.post(
  "/api/v1/user-stories/:id/documents",
  epicController.userStoryDocumentUploadMiddleware,
  epicController.uploadDocumentUserStory,
);
app.get("/api/v1/user-stories/:id/acces", epicController.getUserStoryAcces);
app.post("/api/v1/user-stories/:id/permissions", epicController.postUserStoryPermission);
app.patch("/api/v1/user-stories/:id/permissions/:permissionId", epicController.patchUserStoryPermission);
app.delete("/api/v1/user-stories/:id/permissions/:permissionId", epicController.deleteUserStoryPermission);
app.post("/api/v1/user-stories/:id/admin-sans-acces", epicController.postUserStoryAdminSansAcces);
app.delete("/api/v1/user-stories/:id/admin-sans-acces/:userId", epicController.deleteUserStoryAdminSansAcces);
app.get("/api/v1/user-stories/:id/commentaires", epicController.getUserStoryCommentaires);
app.post(
  "/api/v1/user-stories/:id/commentaires",
  epicController.userStoryCommentUploadMiddleware,
  epicController.addUserStoryCommentaire,
);
app.get(
  "/api/v1/user-stories/:id/commentaires/:commentaireId/fichier",
  epicController.downloadUserStoryCommentaireFichier,
);
app.post("/api/v1/user-stories/:id/restaurer", epicController.restoreUserStory);
app.get("/api/v1/user-stories/:id/history", epicController.getUserStoryHistory);
app.get("/api/v1/user-stories/:id/pv-reunions", epicController.getUserStoryPvReunions);
app.delete("/api/v1/user-stories/:id", epicController.softDeleteUserStory);
app.get("/api/v1/user-stories/:id", epicController.getUserStory);
app.put("/api/v1/user-stories/:id", epicController.updateUserStory);

// Licences (routes spécifiques avant :id)
app.get("/api/v1/licences/corbeille", licenceController.getLicencesCorbeille);
app.get("/api/v1/licences", licenceController.getLicences);
app.post("/api/v1/licences", licenceController.createLicence);
// Détail accès : route plate en premier (même handler) — certains reverse-proxy / anciennes API ne servent pas …/licences/:id/acces
app.get("/api/v1/licence-acces/:id", licenceController.getLicenceAcces);
app.get("/api/v1/licences/:id/history", licenceController.getLicenceHistory);
app.get("/api/v1/licences/:id/acces", licenceController.getLicenceAcces);
app.get("/api/v1/licences/:id", licenceController.getLicence);
app.put("/api/v1/licences/:id", licenceController.updateLicence);
app.delete("/api/v1/licences/:id", licenceController.deleteLicence);
app.post("/api/v1/licences/:id/restaurer", licenceController.restoreLicence);
app.delete("/api/v1/licences/:id/definitif", licenceController.deleteLicencePermanent);
app.post("/api/v1/licences/:id/permissions", licenceController.addPermission);
app.delete(
  "/api/v1/licences/:id/permissions/entry/:permissionEntryId",
  licenceController.removePermissionEntry,
);
app.delete("/api/v1/licences/:id/permissions/:userId", licenceController.removePermission);
app.post("/api/v1/licences/:id/admin-sans-acces", licenceController.blockAdminImplicitAccessLicence);
app.delete(
  "/api/v1/licences/:id/admin-sans-acces/:userId",
  licenceController.restoreAdminImplicitAccessLicence,
);
app.post("/api/v1/licences/:id/commentaires", licenceController.addCommentaire);
app.post("/api/v1/licences/:id/notifications", licenceController.setNotification);
app.post("/api/v1/licences/:id/documents/link", licenceController.linkExistingDocument);
app.post("/api/v1/licences/:id/upload", licenceController.licenceUploadMiddleware, licenceController.uploadDocuments);
app.get("/api/v1/types-licence", typeLicenceController.getTypesLicence);
app.post("/api/v1/types-licence", typeLicenceController.createTypeLicence);
app.put("/api/v1/types-licence/:id", typeLicenceController.updateTypeLicence);
app.delete("/api/v1/types-licence/:id", typeLicenceController.deleteTypeLicence);

app.get("/api/v1/types-contrat", typeContratController.getTypesContrat);
app.post("/api/v1/types-contrat", typeContratController.createTypeContrat);
app.put("/api/v1/types-contrat/:id", typeContratController.updateTypeContrat);
app.delete("/api/v1/types-contrat/:id", typeContratController.deleteTypeContrat);

app.get("/api/v1/types-entite", typeEntiteController.getTypesEntite);
app.post("/api/v1/types-entite", typeEntiteController.createTypeEntite);
app.put("/api/v1/types-entite/:id", typeEntiteController.updateTypeEntite);
app.delete("/api/v1/types-entite/:id", typeEntiteController.deleteTypeEntite);

// Devises (configuration licences)
app.get("/api/v1/devises", deviseController.getDevises);
app.post("/api/v1/devises", deviseController.createDevise);
app.put("/api/v1/devises/:id", deviseController.updateDevise);
app.delete("/api/v1/devises/:id", deviseController.deleteDevise);

// Notifications
app.get("/api/v1/notifications", notificationController.getNotifications);
app.get("/api/v1/notifications/count", notificationController.countNonLues);
app.patch("/api/v1/notifications/:id/lue", notificationController.marquerLue);
app.patch("/api/v1/notifications/toutes-lues", notificationController.marquerToutesLues);

// Échecs d’envoi d’emails de notification (admin — Configuration)
app.get(
  "/api/v1/admin/notification-email-failures",
  requireRole("admin"),
  notificationEmailFailureController.listNotificationEmailFailures
);
app.delete(
  "/api/v1/admin/notification-email-failures/:id",
  requireRole("admin"),
  notificationEmailFailureController.deleteNotificationEmailFailure
);
app.post(
  "/api/v1/admin/notification-email-failures/:id/resend",
  requireRole("admin"),
  notificationEmailFailureController.resendNotificationEmailFailure
);
app.get(
  "/api/v1/admin/notification-settings",
  requireRole("admin"),
  notificationSettingController.listNotificationSettings
);
app.patch(
  "/api/v1/admin/notification-settings/:key",
  requireRole("admin"),
  notificationSettingController.patchNotificationSetting
);
app.get(
  "/api/v1/jours-feries",
  jourFerieController.listJoursFeries
);
app.get(
  "/api/v1/admin/jours-feries",
  requireRole("admin"),
  jourFerieController.listJoursFeries
);
app.post(
  "/api/v1/admin/jours-feries",
  requireRole("admin"),
  jourFerieController.createJourFerie
);
app.delete(
  "/api/v1/admin/jours-feries/:id",
  requireRole("admin"),
  jourFerieController.deleteJourFerie
);

// Gestion des erreurs
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Erreur serveur",
  });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

const LICENCE_ALERT_MS = 60 * 60 * 1000;
setInterval(() => {
  runLicenceAlertDispatch().catch((err) => console.error("[LICENCE_ALERT]", err));
}, LICENCE_ALERT_MS);
setTimeout(() => {
  runLicenceAlertDispatch().catch(() => {});
}, 25_000);
