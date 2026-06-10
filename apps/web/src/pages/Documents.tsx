import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import { DOCUMENT_TYPE_OPTIONS, documentTypeLabel } from '../constants/documentTypes';
import { getPaginationPageNumbers } from '../utils/pagination';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { DocumentAccesNatifModal } from '../components/DocumentAccesNatifModal';
import { PvReunionAccesModal } from '../components/PvReunionAccesModal';
import { isNativeAuthorControlledUploadDoc as isNativeProjetUploadDoc } from '../utils/documentNativeAcces';
import { canModifyModule } from '../utils/uiModuleRoute';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth';

const NIVEAUX_CONTRAT_DOC = [
  { value: 'lecture', label: '👁 Lecture' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression' },
] as const;

const DROITS_ADMIN_CONTRAT_DOC =
  'droits étendus — gestion des accès partagés réservée au créateur du contrat';

const DROITS_CREATEUR_LICENCE_DOC = 'gestion des accès + modification + suppression + lecture';
const DROITS_ADMIN_LICENCE_DOC =
  'modification + suppression + lecture (sans gestion des accès — réservée au créateur)';

const DROITS_ADMIN_DOC_PROJET_NATIF =
  'visualisation, modification statut, accès, suppression (admin non exclu de la pièce)';
const DROITS_CREATEUR_PV_DOC = 'gestion des accès + modification + suppression + lecture';
const DROITS_ADMIN_PV_DOC =
  'modification + suppression + lecture (sans gestion des accès — réservée au créateur du PV)';

const PMO_DOCUMENTS_ACCES_CHANGED = 'pmo-documents-acces-changed';

function notifyDocumentsListAccesSync() {
  try {
    window.dispatchEvent(new CustomEvent(PMO_DOCUMENTS_ACCES_CHANGED));
  } catch {
    /* ignore */
  }
}

function niveauSummaryContratDoc(niveau: string) {
  if (niveau === 'lecture') return 'lecture';
  if (niveau === 'modification') return 'modification + lecture';
  if (niveau === 'suppression') return 'suppression + modification + lecture';
  return niveau;
}

/** Avec `responseType: 'blob'`, les erreurs JSON arrivent en Blob : extraire `error` pour l’affichage. */
async function apiErrorMessageFromAxios(error: any): Promise<string | undefined> {
  const data = error.response?.data;
  if (data instanceof Blob) {
    try {
      const j = JSON.parse(await data.text()) as { error?: string };
      return typeof j.error === 'string' ? j.error : undefined;
    } catch {
      return undefined;
    }
  }
  if (data && typeof data.error === 'string') return data.error;
  return undefined;
}

export default function Documents() {
  const navigate = useNavigate();
  const location = useLocation();
  const prevPathRef = useRef<string | null>(null);
  const { user: currentUser } = useAuth();
  const isLecteur = currentUser?.role === 'lecteur';
  const isAdmin = currentUser?.role === 'admin';
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [showCommentsModalFor, setShowCommentsModalFor] = useState<any | null>(null);
  const [commentsModalItems, setCommentsModalItems] = useState<any[]>([]);
  const [viewingDocument, setViewingDocument] = useState<any | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [excelData, setExcelData] = useState<any[]>([]);
  const [excelSheetNames, setExcelSheetNames] = useState<string[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [loadingExcel, setLoadingExcel] = useState(false);
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [docxHtml, setDocxHtml] = useState('');
  const [loadingDocx, setLoadingDocx] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileNames, setFileNames] = useState<{ [key: string]: string }>({});
  const [uploadData, setUploadData] = useState({
    nom: '',
    description: '',
    estConfidentiel: false,
    versionMajeure: '1',
    versionMineure: '0',
    versionPatch: '0',
    processusId: '',
    typeDocument: 'general',
  });
  const [processusList, setProcessusList] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [permissionUserIds, setPermissionUserIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [showAccesModal, setShowAccesModal] = useState(false);
  const [showDocAccesContratModal, setShowDocAccesContratModal] = useState(false);
  const [pvReunionAccesModal, setPvReunionAccesModal] = useState<{ id: string; titre: string } | null>(null);
  const [acceDoc, setAcceDoc] = useState<any>(null);
  const [acceEstConfidentiel, setAcceEstConfidentiel] = useState(false);
  const [accePermissionUserIds, setAccePermissionUserIds] = useState<string[]>([]);
  type AttachmentFilterType =
    | ''
    | 'processus'
    | 'projet'
    | 'epic'
    | 'userStory'
    | 'tache'
    | 'clientFournisseur'
    | 'contrat'
    | 'pvReunion'
    | 'licence'
    | 'entite'
    | 'uploadedBy';

  const [filters, setFilters] = useState({
    search: '',
    typeDocument: '',
    statut: '',
    attachmentType: '' as AttachmentFilterType,
    attachmentId: '',
  });
  const [projetsList, setProjetsList] = useState<any[]>([]);
  const [epicsList, setEpicsList] = useState<any[]>([]);
  const [userStoriesList, setUserStoriesList] = useState<any[]>([]);
  const [tachesList, setTachesList] = useState<any[]>([]);
  const [clientsFournisseursList, setClientsFournisseursList] = useState<any[]>([]);
  const [contratsList, setContratsList] = useState<any[]>([]);
  const [pvReunionsList, setPvReunionsList] = useState<any[]>([]);
  const [licencesList, setLicencesList] = useState<any[]>([]);
  const [entitesList, setEntitesList] = useState<any[]>([]);
  const [showFiltres, setShowFiltres] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [favorisDocuments, setFavorisDocuments] = useState<Set<string>>(new Set());
  const [loadingFavoris, setLoadingFavoris] = useState<Record<string, boolean>>({});
  const [expandedDocumentIds, setExpandedDocumentIds] = useState<Set<string>>(() => new Set());
  const toggleDocumentRow = (id: string) => {
    setExpandedDocumentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isDocumentRowExpanded = (id: string) => expandedDocumentIds.has(id);

  useEffect(() => {
    loadDocuments();
    loadProcessus();
    loadUsers();
    loadFavorisStatus();
    loadAttachmentLists();
  }, []);

  /** Reprend les droits contrat / licence à jour après modification sur une autre page (autre onglet ou retour ici). */
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void loadDocuments();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  /** Retour depuis la fiche projet (ou autre) : recharger la liste pour refléter exclusions admin document, etc. */
  useEffect(() => {
    const prev = prevPathRef.current;
    prevPathRef.current = location.pathname;
    if (location.pathname === '/documents' && prev !== null && prev !== '/documents') {
      void loadDocuments();
    }
  }, [location.pathname]);

  useEffect(() => {
    const onAccesSync = () => void loadDocuments();
    window.addEventListener(PMO_DOCUMENTS_ACCES_CHANGED, onAccesSync);
    return () => window.removeEventListener(PMO_DOCUMENTS_ACCES_CHANGED, onAccesSync);
  }, []);

  const loadAttachmentLists = async () => {
    try {
      const [
        projRes,
        epRes,
        usRes,
        tachesRes,
        cfRes,
        contratsRes,
        pvRes,
        licRes,
        entRes,
      ] = await Promise.all([
        api.get('/projets').catch(() => ({ data: [] })),
        api.get('/epics').catch(() => ({ data: [] })),
        api.get('/user-stories').catch(() => ({ data: [] })),
        api.get('/taches').catch(() => ({ data: [] })),
        api.get('/clients-fournisseurs').catch(() => ({ data: [] })),
        api.get('/contrats').catch(() => ({ data: [] })),
        api.get('/pv-reunions').catch(() => ({ data: [] })),
        api.get('/licences').catch(() => ({ data: [] })),
        api.get('/entites').catch(() => ({ data: [] })),
      ]);
      setProjetsList(Array.isArray(projRes.data) ? projRes.data : []);
      setEpicsList(Array.isArray(epRes.data) ? epRes.data : []);
      setUserStoriesList(Array.isArray(usRes.data) ? usRes.data : []);
      setTachesList(Array.isArray(tachesRes.data) ? tachesRes.data : []);
      setClientsFournisseursList(Array.isArray(cfRes.data) ? cfRes.data : []);
      setContratsList(Array.isArray(contratsRes.data) ? contratsRes.data : []);
      setPvReunionsList(Array.isArray(pvRes.data) ? pvRes.data : []);
      setLicencesList(Array.isArray(licRes.data) ? licRes.data : []);
      setEntitesList(Array.isArray(entRes.data) ? entRes.data : []);
    } catch (e) {
      console.error('Erreur chargement listes filtres documents:', e);
    }
  };

  const loadFavorisStatus = async () => {
    if (!currentUser?.id) return;
    try {
      const response = await api.get('/favoris');
      const documents = response.data.documents || [];
      const favorisIds = new Set<string>(documents.map((d: any) => String(d.id)));
      setFavorisDocuments(favorisIds);
    } catch (error) {
      console.error('Erreur chargement statut favoris:', error);
    }
  };

  const handleToggleDocumentFavori = async (documentId: string) => {
    if (loadingFavoris[documentId]) return;
    setLoadingFavoris({ ...loadingFavoris, [documentId]: true });
    try {
      const estFavori = favorisDocuments.has(documentId);
      if (estFavori) {
        await api.delete(`/favoris/documents/${documentId}`);
        setFavorisDocuments((prev) => {
          const newSet = new Set(prev);
          newSet.delete(documentId);
          return newSet;
        });
      } else {
        await api.post(`/favoris/documents/${documentId}`);
        setFavorisDocuments((prev) => new Set([...prev, documentId]));
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erreur lors de la modification des favoris');
    } finally {
      setLoadingFavoris({ ...loadingFavoris, [documentId]: false });
    }
  };

  const loadUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsersList(response.data);
    } catch (error) {
      console.error('Erreur chargement utilisateurs:', error);
    }
  };

  useEffect(() => {
    loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filters.search,
    filters.typeDocument,
    filters.statut,
    filters.attachmentType,
    filters.attachmentId,
    sortConfig,
  ]);
  useEffect(() => {
    setPage(1);
  }, [
    filters.search,
    filters.typeDocument,
    filters.statut,
    filters.attachmentType,
    filters.attachmentId,
    sortConfig,
  ]);

  const loadProcessus = async () => {
    try {
      const response = await api.get('/processus');
      setProcessusList(response.data);
    } catch (error) {
      console.error('Erreur chargement processus:', error);
    }
  };

  useEffect(() => {
    // Nettoyer l'URL blob lors du démontage
    return () => {
      if (documentUrl) {
        window.URL.revokeObjectURL(documentUrl);
      }
    };
  }, [documentUrl]);

  const loadDocuments = async () => {
    try {
      const params: any = {};
      if (filters.search) params.search = filters.search;
      if (filters.typeDocument) params.typeDocument = filters.typeDocument;
      if (filters.statut) params.statut = filters.statut;
      if (filters.attachmentType && filters.attachmentId) {
        params.linkType = filters.attachmentType;
        params.linkId = filters.attachmentId;
      }
      if (sortConfig) {
        params.sortBy = sortConfig.key;
        params.sortOrder = sortConfig.direction;
      }
      const response = await api.get('/documents', { params });
      let sortedDocuments = response.data;
      
      // Tri côté client pour uploadedBy (car relation Prisma)
      if (sortConfig?.key === 'uploadedBy') {
        sortedDocuments = [...response.data].sort((a, b) => {
          const aName = a.uploadedBy ? `${a.uploadedBy.prenom} ${a.uploadedBy.nom}` : '';
          const bName = b.uploadedBy ? `${b.uploadedBy.prenom} ${b.uploadedBy.nom}` : '';
          if (sortConfig.direction === 'asc') {
            return aName.localeCompare(bName, 'fr', { sensitivity: 'base' });
          } else {
            return bName.localeCompare(aName, 'fr', { sensitivity: 'base' });
          }
        });
      }
      
      setDocuments(sortedDocuments);

      // Charger les compteurs de commentaires pour chaque document (affichage conditionnel du bouton)
      // On charge les commentaires de manière silencieuse, les erreurs ne bloquent pas l'affichage
      const counts: Record<string, number> = {};
      await Promise.allSettled(
        (response.data || []).map(async (d: any) => {
          try {
            const token = localStorage.getItem('token');
            const res = await api.get(`/documents/${d.id}/comments`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
            counts[d.id] = Array.isArray(res.data) ? res.data.length : 0;
          } catch (error) {
            // Erreur silencieuse : on met simplement le compteur à 0
            console.warn(`Impossible de charger les commentaires pour le document ${d.id}:`, error);
            counts[d.id] = 0;
          }
        })
      );
      setCommentCounts(counts);
    } catch (error) {
      console.error('Erreur:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const resetSort = () => {
    setSortConfig(null);
  };

  const openCommentsModal = async (doc: any) => {
    try {
      const token = localStorage.getItem('token');
      const res = await api.get(`/documents/${doc.id}/comments`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      setCommentsModalItems(Array.isArray(res.data) ? res.data : []);
      setShowCommentsModalFor(doc);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors du chargement des commentaires');
    }
  };

  const canAccessDocument = async (doc: any): Promise<boolean> => {
    // Si le document n'est pas confidentiel, tout le monde peut y accéder
    if (!doc.estConfidentiel) return true;

    // Récupérer l'utilisateur actuel
    const user = currentUser || JSON.parse(localStorage.getItem('user') || '{}');
    if (!user.id) return false;

    if (user.role === 'admin') return true;
    
    // L'utilisateur qui a uploadé peut toujours accéder
    if (doc.uploadedById === user.id) return true;

    // Vérifier si l'utilisateur est dans la liste des permissions
    if (doc.permissionsUtilisateurs && doc.permissionsUtilisateurs.length > 0) {
      const hasPermission = doc.permissionsUtilisateurs.some((perm: any) => perm.userId === user.id || perm.user?.id === user.id);
      if (hasPermission) return true;
    }

    // Pour les documents confidentiels liés à un processus, vérifier si l'utilisateur est propriétaire/créateur
    if (doc.referenceType === 'processus' && doc.referenceId) {
      try {
        const processusResponse = await api.get(`/processus/${doc.referenceId}`);
        const processus = processusResponse.data;
        if (processus && (processus.proprietaireId === user.id || processus.createdById === user.id)) {
          return true;
        }
      } catch (error) {
        // Si on ne peut pas charger le processus, on laisse le backend décider
        // On retourne true pour permettre la requête, le backend vérifiera
        return true;
      }
    }

    if (doc.referenceType === 'licence' && doc.referenceId) {
      try {
        const licRes = await api.get(`/licences/${doc.referenceId}`);
        const lic = licRes.data;
        if (!lic) return false;
        if (lic.createdById === user.id) return true;
        if (lic.permissions?.some((p: any) => p.userId === user.id)) return true;
      } catch {
        return false;
      }
    }

    return false;
  };

  const handleViewDocument = async (doc: any) => {
    // Vérifier les permissions avant de faire la requête
    const hasAccess = await canAccessDocument(doc);
    if (!hasAccess) {
      alert('Vous n\'avez pas accès à ce document confidentiel');
      return;
    }

    try {
      // Utiliser l'endpoint /view pour la visualisation (log 'lecture')
      const response = await api.get(`/documents/${doc.id}/view`, {
        responseType: 'blob',
      });
      
      const fileType = getFileType(doc.fichierType, doc.fichierNomOriginal || doc.nom);
      
      setDocxHtml('');
      // Si c'est un fichier Excel, parser le contenu
      if (fileType === 'excel') {
        setDocumentUrl(null);
        setLoadingExcel(true);
        const arrayBuffer = await response.data.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetNames = workbook.SheetNames;
        setExcelWorkbook(workbook);
        setExcelSheetNames(sheetNames);
        const firstSheetName = sheetNames[0] || '';
        setCurrentSheet(firstSheetName);
        
        // Convertir la première feuille en JSON
        const firstSheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
        setExcelData(jsonData);
        setLoadingExcel(false);
      } else if (fileType === 'word') {
        setDocumentUrl(null);
        setLoadingDocx(true);
        const arrayBuffer = await response.data.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        setDocxHtml(result.value || '<p>Document vide.</p>');
        setLoadingDocx(false);
      } else {
        // Créer un blob avec le type MIME correct pour une meilleure compatibilité
        const mimeType = doc.fichierType || response.headers['content-type'] || 'application/octet-stream';
        const blob = new Blob([response.data], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        setDocumentUrl(url);
      }
      
      setViewingDocument(doc);
      // Recharger les documents pour mettre à jour les statistiques
      loadDocuments();
    } catch (error: any) {
      console.error('Erreur lors du chargement du document:', error);
      const apiMsg = await apiErrorMessageFromAxios(error);
      if (error.response?.status === 403) {
        alert(apiMsg || 'Vous n\'avez pas accès à ce document confidentiel');
      } else if (error.response?.status === 404) {
        alert(
          apiMsg ||
            'Document ou fichier introuvable. Si le fichier a été uploadé sur un autre serveur, copiez le dossier uploads ou rechargez une version.'
        );
      } else {
        alert(`Erreur lors du chargement du document: ${apiMsg || error.message}`);
      }
      setLoadingExcel(false);
    }
  };

  const handleDownload = async (doc: any) => {
    // Vérifier les permissions avant de faire la requête
    const hasAccess = await canAccessDocument(doc);
    if (!hasAccess) {
      alert('Vous n\'avez pas accès à ce document confidentiel');
      return;
    }

    try {
      const response = await api.get(`/documents/${doc.id}/download`, {
        responseType: 'blob',
      });
      // Créer un blob avec le type MIME correct
      const blob = new Blob([response.data], { 
        type: doc.fichierType || response.headers['content-type'] || 'application/octet-stream' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.setAttribute('download', doc.fichierNomOriginal);
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      // Nettoyer le blob URL après un court délai
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
      // Recharger les documents pour mettre à jour les statistiques
      loadDocuments();
    } catch (error: any) {
      console.error('Erreur lors du téléchargement:', error);
      const apiMsg = await apiErrorMessageFromAxios(error);
      if (error.response?.status === 403) {
        alert(apiMsg || 'Vous n\'avez pas accès à ce document confidentiel');
      } else if (error.response?.status === 404) {
        alert(apiMsg || 'Fichier introuvable sur le serveur.');
      } else {
        alert(apiMsg || 'Erreur lors du téléchargement du document');
      }
    }
  };

  const closeViewer = () => {
    if (documentUrl) {
      window.URL.revokeObjectURL(documentUrl);
    }
    setViewingDocument(null);
    setDocumentUrl(null);
    setExcelData([]);
    setExcelSheetNames([]);
    setCurrentSheet('');
    setExcelWorkbook(null);
    setDocxHtml('');
    setLoadingDocx(false);
  };

  const handleSheetChange = (sheetName: string) => {
    if (!excelWorkbook) return;
    setCurrentSheet(sheetName);
    const sheet = excelWorkbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    setExcelData(jsonData);
  };

  const [editingDocument, setEditingDocument] = useState<any | null>(null);
  const [editData, setEditData] = useState({
    nom: '',
    description: '',
    statut: 'brouillon' as any,
    estConfidentiel: false,
    permissionUserIds: [] as string[],
  });

  const handleEdit = (doc: any) => {
    setEditingDocument(doc);
    setEditData({
      nom: doc.nom,
      description: doc.description || '',
      statut: doc.statut,
      estConfidentiel: doc.estConfidentiel || false,
      permissionUserIds: doc.permissionsUtilisateurs?.map((p: any) => p.userId || p.user?.id).filter(Boolean) || [],
    });
  };

  const handleSaveEdit = async () => {
    if (!editingDocument) return;
    
    try {
      const updateData: any = {
        nom: editData.nom,
        description: editData.description,
        statut: editData.statut,
        estConfidentiel: editData.estConfidentiel,
      };

      if (editData.estConfidentiel && editData.permissionUserIds.length > 0) {
        updateData.permissionUserIds = editData.permissionUserIds.join(',');
      }

      await api.put(`/documents/${editingDocument.id}`, updateData);
      setEditingDocument(null);
      loadDocuments();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la modification du document');
    }
  };

  const canModifierAcces = (doc: any) => {
    if (!currentUser) return false;
    if (isNativeProjetUploadDoc(doc)) {
      return doc.uploadedById === currentUser.id;
    }
    if (currentUser.role === 'admin') return true;
    if (doc.uploadedById === currentUser.id) return true;
    if (doc.permissionsUtilisateurs?.some((p: any) => p.userId === currentUser.id || p.user?.id === currentUser.id)) return true;
    return false;
  };

  /** Même règles que la liste PV : module + droits sur le PV (créateur, permissions, admin non exclu). */
  const canOpenPvReunionAccesModal = (linkedPv: any | null | undefined, pvIdFromRef: string | null) => {
    if (!currentUser || !canModifyModule(currentUser.uiModules, 'pv_reunion')) return false;
    const pv = linkedPv;
    const pvId = pv?.id || pvIdFromRef;
    if (!pvId) return false;
    if (isAdmin) {
      if (!pv) return true;
      const refused =
        pv.adminSansAccesUserIds?.includes(currentUser.id) ||
        (pv.adminSansAcces || []).some((x: { userId: string }) => x.userId === currentUser.id);
      return !refused;
    }
    if (!pv) return false;
    if (pv.createdById === currentUser.id) return true;
    const row = (pv.permissions || []).find(
      (p: any) => (p.userId || p.user?.id) === currentUser.id && ['gestion', 'suppression', 'modification'].includes(p.niveau)
    );
    return !!row;
  };

  const resolvePvReunionForDocumentAcces = (doc: any): { id: string; titre: string; linkedPv: any | null } | null => {
    const linkedPv = doc.pvReunion || doc.pvReunionsPrincipal?.[0] || doc.pvReunionCommentPieces?.[0]?.pvReunion || null;
    const id =
      doc.referenceType === 'pvReunion' && doc.referenceId
        ? String(doc.referenceId)
        : linkedPv?.id || null;
    if (!id) return null;
    const titre = linkedPv?.titre || doc.nom || 'PV de réunion';
    return { id, titre, linkedPv };
  };

  const handleOpenAccesModal = async (doc: any) => {
    if (isNativeProjetUploadDoc(doc)) {
      setAcceDoc(doc);
      setShowDocAccesContratModal(true);
      return;
    }

    const pvAcc = resolvePvReunionForDocumentAcces(doc);
    const isPvPrincipalOrRef =
      doc.typeDocument === 'pv_reunion' ||
      doc.referenceType === 'pvReunion' ||
      !!doc.pvReunionsPrincipal?.length ||
      !!pvAcc?.linkedPv;
    if (pvAcc && isPvPrincipalOrRef && canOpenPvReunionAccesModal(pvAcc.linkedPv, pvAcc.id)) {
      setPvReunionAccesModal({ id: pvAcc.id, titre: pvAcc.titre });
      return;
    }

    setAcceDoc(doc);
    setAcceEstConfidentiel(doc.estConfidentiel || false);
    setAccePermissionUserIds(
      doc.permissionsUtilisateurs?.map((p: any) => p.userId || p.user?.id).filter(Boolean) || []
    );
    setShowAccesModal(true);
  };

  const canShowAccesButton = (doc: any) => {
    if (isNativeProjetUploadDoc(doc)) return canModifierAcces(doc);
    const linkedPv = doc.pvReunion || doc.pvReunionsPrincipal?.[0] || doc.pvReunionCommentPieces?.[0]?.pvReunion || null;
    const pvAcc = resolvePvReunionForDocumentAcces(doc);
    const isPv =
      doc.typeDocument === 'pv_reunion' ||
      doc.referenceType === 'pvReunion' ||
      !!doc.pvReunionsPrincipal?.length ||
      !!linkedPv?.id;
    if (isPv && pvAcc && canOpenPvReunionAccesModal(pvAcc.linkedPv, pvAcc.id)) return true;
    return canModifierAcces(doc);
  };

  const handleSaveAcces = async () => {
    if (!acceDoc) return;
    try {
      await api.put(`/documents/${acceDoc.id}`, {
        estConfidentiel: acceEstConfidentiel,
        permissionUserIds: acceEstConfidentiel ? accePermissionUserIds : [],
      });
      setShowAccesModal(false);
      setAcceDoc(null);
      await loadDocuments();
      notifyDocumentsListAccesSync();
    } catch (err: any) {
      alert(err.response?.data?.error || "Erreur lors de la modification de l'accès");
    }
  };
  const handleDelete = async (doc: any) => {
    if (!window.confirm(`Êtes-vous sûr de vouloir supprimer le document "${doc.nom}" ?`)) {
      return;
    }

    try {
      await api.delete(`/documents/${doc.id}`);
      loadDocuments();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression du document');
    }
  };

  const getFileType = (mimeType: string, fileName?: string): string => {
    const lowerName = (fileName || '').toLowerCase();
    if (mimeType?.includes('wordprocessingml') || mimeType?.includes('msword') || lowerName.endsWith('.docx')) return 'word';
    if (mimeType?.includes('pdf')) return 'pdf';
    if (mimeType?.includes('image')) return 'image';
    if (mimeType?.includes('text')) return 'text';
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || 
        mimeType?.includes('vnd.ms-excel') || mimeType?.includes('vnd.openxmlformats-officedocument.spreadsheetml')) {
      return 'excel';
    }
    return 'other';
  };

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(selectedFiles);
      
      // Initialiser les noms de fichiers avec leurs noms originaux
      const names: { [key: string]: string } = {};
      selectedFiles.forEach((file) => {
        names[file.name] = file.name;
      });
      setFileNames(names);
      
      // Si un seul fichier et que le nom n'est pas défini, utiliser le nom du fichier
      if (selectedFiles.length === 1 && !uploadData.nom) {
        setUploadData((prev) => ({ 
          ...prev, 
          nom: selectedFiles[0].name,
        }));
      }
    }
  };

  const removeFile = (fileName: string) => {
    setFiles(files.filter(f => f.name !== fileName));
    const newNames = { ...fileNames };
    delete newNames[fileName];
    setFileNames(newNames);
  };

  const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // aligné sur Multer côté API

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Veuillez sélectionner au moins un fichier');
      return;
    }

    const tooBig = files.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) {
      setError(
        `Le fichier « ${tooBig.name} » dépasse 50 Mo (limite serveur). Réduisez la taille ou compressez le PDF.`
      );
      return;
    }

    setError('');
    setUploading(true);

    try {
      // Uploader tous les fichiers
      const uploadPromises = files.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('nom', fileNames[file.name] || file.name);
        formData.append('typeDocument', uploadData.processusId ? 'processus' : (uploadData.typeDocument || 'general'));
        if (uploadData.processusId) {
          formData.append('referenceType', 'processus');
          formData.append('referenceId', uploadData.processusId);
        }
        formData.append('description', uploadData.description || '');
        formData.append('estConfidentiel', uploadData.estConfidentiel.toString());
        if (uploadData.estConfidentiel && permissionUserIds.length > 0) {
          formData.append('permissionUserIds', permissionUserIds.join(','));
        }
        formData.append('versionMajeure', uploadData.versionMajeure);
        formData.append('versionMineure', uploadData.versionMineure);
        formData.append('versionPatch', uploadData.versionPatch);

        return api.post('/documents', formData, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });
      });

      await Promise.all(uploadPromises);

      setShowUploadModal(false);
      setFiles([]);
      setFileNames({});
      setUploadData({ nom: '', description: '', estConfidentiel: false, versionMajeure: '1', versionMineure: '0', versionPatch: '0', processusId: '', typeDocument: 'general' });
      setPermissionUserIds([]);
      loadDocuments();
    } catch (err: any) {
      const st = err.response?.status;
      if (st === 413) {
        setError(
          'Fichier trop volumineux (erreur 413) : le proxy web limite souvent les uploads à 1 Mo. Déployez la dernière image du front (nginx 64 Mo) ou demandez à l’administrateur d’augmenter cette limite.'
        );
      } else {
        setError(err.response?.data?.error || 'Erreur lors de l\'upload des fichiers');
      }
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-10 text-gray-400">Chargement...</div>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(documents.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pagedDocuments = documents.slice(startIdx, startIdx + pageSize);

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
          <p className="text-sm text-gray-500 mt-1">{documents.length} document(s)</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          {isAdmin && (
            <button
              type="button"
              onClick={() => navigate('/corbeille?tab=documents')}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              🗑 Corbeille
            </button>
          )}
          {!isLecteur && (
            <button
              type="button"
              onClick={() => {
                setShowUploadModal(true);
                setError('');
                setFiles([]);
                setFileNames({});
                setUploadData({
                  nom: '',
                  description: '',
                  estConfidentiel: false,
                  versionMajeure: '1',
                  versionMineure: '0',
                  versionPatch: '0',
                  processusId: '',
                  typeDocument: 'general',
                });
                setPermissionUserIds([]);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
            >
              + Nouveau document
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>
            Filtres
            {(filters.search ||
              filters.typeDocument ||
              filters.statut ||
              (filters.attachmentType && filters.attachmentId))
              ? ' ●'
              : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Recherche</label>
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  placeholder="Nom, description"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type de document</label>
                <select
                  value={filters.typeDocument}
                  onChange={(e) => setFilters({ ...filters, typeDocument: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select
                  value={filters.statut}
                  onChange={(e) => setFilters({ ...filters, statut: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  <option value="brouillon">Brouillon</option>
                  <option value="en_revision">En révision</option>
                  <option value="valide">Validé</option>
                  <option value="archive">Archivé</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rattachement (type)</label>
                <select
                  value={filters.attachmentType}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      attachmentType: e.target.value as AttachmentFilterType,
                      attachmentId: '',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">— Aucun —</option>
                  <option value="processus">Processus</option>
                  <option value="projet">Projet</option>
                  <option value="epic">Epic</option>
                  <option value="userStory">User story</option>
                  <option value="tache">Tâche</option>
                  <option value="clientFournisseur">Client / Fournisseur</option>
                  <option value="contrat">Contrat</option>
                  <option value="pvReunion">PV de réunion</option>
                  <option value="licence">Licence</option>
                  <option value="entite">Entité</option>
                  <option value="uploadedBy">Utilisateur (uploadé par)</option>
                </select>
              </div>
              <div className="md:col-span-2 lg:col-span-2 xl:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Rattachement (élément)</label>
                <select
                  value={filters.attachmentId}
                  onChange={(e) => setFilters({ ...filters, attachmentId: e.target.value })}
                  disabled={!filters.attachmentType}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">
                    {filters.attachmentType ? '— Choisir —' : 'Choisissez un type ci-dessus'}
                  </option>
                  {filters.attachmentType === 'processus' &&
                    processusList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nom} ({p.codeProcessus})
                      </option>
                    ))}
                  {filters.attachmentType === 'projet' &&
                    projetsList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nom} ({p.codeProjet || p.code || p.id})
                      </option>
                    ))}
                  {filters.attachmentType === 'epic' &&
                    epicsList.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nom}
                      </option>
                    ))}
                  {filters.attachmentType === 'userStory' &&
                    userStoriesList.map((us) => (
                      <option key={us.id} value={us.id}>
                        {(us.description || '').slice(0, 90)}
                        {(us.description || '').length > 90 ? '…' : ''}
                      </option>
                    ))}
                  {filters.attachmentType === 'tache' &&
                    tachesList.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nom}
                      </option>
                    ))}
                  {filters.attachmentType === 'clientFournisseur' &&
                    clientsFournisseursList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.raisonSociale || c.nom || c.id}
                      </option>
                    ))}
                  {filters.attachmentType === 'contrat' &&
                    contratsList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nom} {c.codeContrat ? `(${c.codeContrat})` : ''}
                      </option>
                    ))}
                  {filters.attachmentType === 'pvReunion' &&
                    pvReunionsList.map((pv) => (
                      <option key={pv.id} value={pv.id}>
                        {pv.titre || pv.id}
                      </option>
                    ))}
                  {filters.attachmentType === 'licence' &&
                    licencesList.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.nom} ({l.reference})
                      </option>
                    ))}
                  {filters.attachmentType === 'entite' &&
                    entitesList.map((en) => (
                      <option key={en.id} value={en.id}>
                        {en.nom} ({en.code})
                      </option>
                    ))}
                  {filters.attachmentType === 'uploadedBy' &&
                    [...usersList]
                      .sort((a, b) =>
                        `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, 'fr', {
                          sensitivity: 'base',
                        })
                      )
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.prenom} {u.nom} ({u.email})
                        </option>
                      ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() =>
                  setFilters({
                    search: '',
                    typeDocument: '',
                    statut: '',
                    attachmentType: '',
                    attachmentId: '',
                  })
                }
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Liste des documents</h2>
            {sortConfig && (
              <button
                type="button"
                onClick={resetSort}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                title="Réinitialiser le tri"
              >
                Réinitialiser le tri
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center text-xs text-gray-600">
            <span className="font-semibold text-gray-500 shrink-0">Trier par :</span>
            {(
              [
                ['nom', 'Nom'],
                ['typeDocument', 'Type'],
                ['statut', 'Statut'],
                ['uploadedBy', 'Uploadé par'],
                ['createdAt', "Date d'upload"],
                ['updatedAt', 'Modifié le'],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                onClick={() => handleSort(key)}
                className={`px-2 py-1 rounded-md border ${
                  sortConfig?.key === key
                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                {label}
                {sortConfig?.key === key ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4 space-y-4">
          {documents.length === 0 && (
            <div className="text-center py-10 text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
              Aucun document
            </div>
          )}
          {pagedDocuments.map((d) => {
            const isLicenceLinkedDoc = d.typeDocument === 'licence' || d.referenceType === 'licence';
            const linkedContrat = d.contrats?.[0]?.contrat;
            const isContratLinkedDoc = !!linkedContrat;
            const linkedPv = d.pvReunion || d.pvReunionsPrincipal?.[0] || d.pvReunionCommentPieces?.[0]?.pvReunion || null;
            const isPvLinkedDoc = !!linkedPv;
            const showRestrictedAccess = d.estConfidentiel || isLicenceLinkedDoc || isContratLinkedDoc || isPvLinkedDoc;
            const statut =
              isPvLinkedDoc && linkedPv?.statut
                ? linkedPv.statut
                : d.typeDocument === 'contrat' && d.contrats?.[0]?.contrat?.statut
                  ? d.contrats[0].contrat.statut
                  : d.statut;
            const statutColor =
              statut === 'valide' || statut === 'actif'
                ? 'bg-green-100 text-green-800'
                : statut === 'en_revision' || statut === 'suspendu'
                  ? 'bg-yellow-100 text-yellow-800'
                  : statut === 'expire' || statut === 'resilie'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-gray-100 text-gray-800';
            const typeLabel =
              d.typeDocument === 'autre' && d.tacheDocuments?.length > 0
                ? documentTypeLabel('tache')
                : documentTypeLabel(d.typeDocument);
            const rowOpen = isDocumentRowExpanded(d.id);
            return (
              <div key={d.id} className="bg-gray-50/80 rounded-lg border border-gray-100 overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleDocumentRow(d.id)}
                  className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-100/90 transition-colors"
                  aria-expanded={rowOpen}
                  aria-label={rowOpen ? 'Replier le détail du document' : 'Afficher le détail et les actions du document'}
                >
                  <span className={`px-2 py-0.5 text-xs rounded font-medium shrink-0 ${statutColor}`}>{statut}</span>
                  <span className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate text-left">{d.nom}</span>
                  <span className="text-xs text-gray-500 font-mono shrink-0">v{d.version || '—'}</span>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded text-xs font-medium shrink-0 hidden sm:inline">
                    {typeLabel}
                  </span>
                  {rowOpen && (
                    <span className="text-gray-400 shrink-0 ml-auto sm:ml-0" aria-hidden>
                      ▼
                    </span>
                  )}
                </button>

                {rowOpen && (
                  <div className="px-4 sm:px-5 pb-4 pt-0 border-t border-gray-200 bg-gray-50/50">
                    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 pt-3">
                      <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 sm:hidden">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-800 rounded text-xs font-medium">
                        {typeLabel}
                      </span>
                    </div>
                    <div className="text-sm text-gray-700 mb-2">
                      <span className="font-medium text-gray-600">Référence : </span>
                      {d.referenceType === 'processus' && d.referenceId ? (
                        d.processus ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/processus/${d.referenceId}`)}
                            className="text-blue-600 hover:underline"
                          >
                            {d.processus.nom} ({d.processus.codeProcessus})
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => navigate(`/processus/${d.referenceId}`)}
                            className="text-blue-600 hover:underline"
                          >
                            Voir le processus
                          </button>
                        )
                      ) : d.referenceType === 'projet' && d.referenceId ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/projets/${d.referenceId}`)}
                          className="text-blue-600 hover:underline"
                        >
                          {d.projet ? `${d.projet.nom} (${d.projet.codeProjet})` : 'Voir le projet'}
                        </button>
                      ) : d.typeDocument === 'contrat' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-medium">
                          📄 {d.contrats?.[0]?.contrat?.nom || 'Contrat lié'}
                        </span>
                      ) : d.referenceType === 'licence' && (d.licence || d.referenceId) ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-800 rounded text-xs font-medium">
                          🔑 {d.licence?.nom || 'Licence'}
                          {d.licence?.reference ? ` (#${d.licence.reference})` : ''}
                        </span>
                      ) : d.referenceType === 'entite' && d.referenceId ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/entites/${d.referenceId}`)}
                          className="text-blue-600 hover:underline"
                        >
                          Voir l&apos;entité
                        </button>
                      ) : d.referenceType === 'clientFournisseur' && d.referenceId ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 text-teal-800 rounded text-xs font-medium">
                          🏢 Client / Fournisseur
                        </span>
                      ) : (d.referenceType === 'pvReunion' && d.referenceId) || linkedPv?.id ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/pv-reunion/${d.referenceId || linkedPv?.id}`)}
                          className="text-blue-600 hover:underline"
                        >
                          PV de réunion
                        </button>
                      ) : d.epicDocuments?.length > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-800 rounded text-xs font-medium">
                          🎯 {d.epicDocuments[0]?.epic?.nom || 'Epic'}
                        </span>
                      ) : d.typeDocument === 'tache' || d.typeDocument === 'autre' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-700 rounded text-xs font-medium">
                          📋 {d.tacheDocuments?.[0]?.tache?.nom || 'Tâche'}
                        </span>
                      ) : (
                        <span className="text-gray-400 italic">N/A</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-600 mb-3">
                      <div>
                        <span className="font-medium text-gray-700">Uploadé par : </span>
                        {d.uploadedBy ? `${d.uploadedBy.prenom} ${d.uploadedBy.nom}` : '—'}
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Vues / Téléchargements : </span>
                        {d.nombreVisualisations || 0} / {d.nombreTelechargements || 0}
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Créé : </span>
                        {formatDate(d.createdAt)}
                      </div>
                      <div>
                        <span className="font-medium text-gray-700">Modifié : </span>
                        {formatDate(d.updatedAt)}
                      </div>
                    </div>
                    {showRestrictedAccess && (
                      <div className="text-xs text-gray-700 space-y-1 mb-2">
                        <span className="inline-block px-2 py-0.5 bg-red-100 text-red-800 rounded">
                          {isLicenceLinkedDoc ? 'Confidentiel (licence)' : isPvLinkedDoc ? 'Accès restreint (PV de réunion)' : 'Confidentiel'}
                        </span>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                      <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                        {showRestrictedAccess ? (
                          <div>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                              🔒 Accès restreint
                            </span>
                            {isLicenceLinkedDoc && !d.licence && (
                              <p className="mt-1 text-xs text-amber-700">
                                Document rattaché à une licence : les droits détaillés n’ont pas pu être chargés. Rechargez la
                                page ou rouvrez le détail.
                              </p>
                            )}
                            {isLicenceLinkedDoc && d.licence && (
                              <>
                                <p className="mt-1 text-xs text-amber-800">
                                  Aligné sur la fiche licence — actualisez la liste documents après un changement d’accès
                                  sur Licences / certifications.
                                </p>
                                <div className="mt-2 text-xs text-gray-700 space-y-1">
                                  <AccessContratLikeAdminLines
                                    keyPrefix={`doc-${d.id}-lic`}
                                    users={usersList}
                                    createdById={d.licence.createdById}
                                    createdBy={d.licence.createdBy}
                                    adminSansAccesUserIds={
                                      d.licence.adminSansAccesUserIds ??
                                      (d.licence.adminSansAcces || []).map((x: { userId: string }) => x.userId)
                                    }
                                    permissions={(d.licence.permissions || []).map((p: any) => ({
                                      userId: p.userId,
                                      niveau: p.niveau,
                                      user: p.user,
                                    }))}
                                    creatorRightsLabel={DROITS_CREATEUR_LICENCE_DOC}
                                    droitsAdminCompletLabel={DROITS_ADMIN_LICENCE_DOC}
                                    niveauLabel={(n) => NIVEAUX_CONTRAT_DOC.find((x) => x.value === n)?.label || n}
                                  />
                                  {(d.licence.permissions || []).map((lp: any) => (
                                    <div key={lp.id} className="min-w-0">
                                      <span className="font-medium text-gray-900">
                                        {lp.user?.prenom} {lp.user?.nom}
                                      </span>
                                      <span className="text-gray-500 italic ml-1">
                                        (
                                        {NIVEAUX_CONTRAT_DOC.find((x) => x.value === lp.niveau)?.label || lp.niveau} :{' '}
                                        {lp.niveau === 'lecture'
                                          ? 'lecture'
                                          : niveauSummaryContratDoc(lp.niveau)}
                                        )
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                            {isContratLinkedDoc && linkedContrat && !isLicenceLinkedDoc && (
                              <>
                                <p className="mt-1 text-xs text-purple-800">
                                  Aligné sur la fiche contrat — actualisez la liste documents après un changement d’accès
                                  sur Contrats.
                                </p>
                                <div className="mt-2 text-xs text-gray-700 space-y-1">
                                  <AccessContratLikeAdminLines
                                    keyPrefix={`doc-${d.id}-ct`}
                                    users={usersList}
                                    createdById={linkedContrat.createdById}
                                    createdBy={linkedContrat.createdBy}
                                    adminSansAccesUserIds={
                                      linkedContrat.adminSansAccesUserIds ??
                                      (linkedContrat.adminSansAcces || []).map((x: { userId: string }) => x.userId)
                                    }
                                    permissions={(linkedContrat.permissions || []).map((p: any) => ({
                                      userId: p.userId,
                                      niveau: p.niveau,
                                      user: p.user,
                                    }))}
                                    droitsAdminCompletLabel={DROITS_ADMIN_CONTRAT_DOC}
                                    niveauLabel={(n) => NIVEAUX_CONTRAT_DOC.find((x) => x.value === n)?.label || n}
                                  />
                                  {(linkedContrat.permissions || []).map((cp: any) => (
                                    <div key={cp.id} className="min-w-0">
                                      <span className="font-medium text-gray-900">
                                        {cp.user?.prenom} {cp.user?.nom}
                                      </span>
                                      <span className="text-gray-500 italic ml-1">
                                        (
                                        {NIVEAUX_CONTRAT_DOC.find((x) => x.value === cp.niveau)?.label || cp.niveau} :{' '}
                                        {cp.niveau === 'lecture'
                                          ? 'lecture'
                                          : niveauSummaryContratDoc(cp.niveau)}
                                        )
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                            {isPvLinkedDoc && linkedPv && !isLicenceLinkedDoc && !isContratLinkedDoc && (
                              <>
                                <p className="mt-1 text-xs text-indigo-800">
                                  Aligné sur la fiche PV de réunion — actualisez la liste documents après un changement
                                  d’accès sur la page PV.
                                </p>
                                <div className="mt-2 text-xs text-gray-700 space-y-1">
                                  <AccessContratLikeAdminLines
                                    keyPrefix={`doc-${d.id}-pv`}
                                    users={usersList}
                                    createdById={linkedPv.createdById}
                                    createdBy={linkedPv.createdBy}
                                    adminSansAccesUserIds={
                                      linkedPv.adminSansAccesUserIds ??
                                      (linkedPv.adminSansAcces || []).map((x: { userId: string }) => x.userId)
                                    }
                                    permissions={(linkedPv.permissions || []).map((p: any) => ({
                                      userId: p.userId,
                                      niveau: p.niveau,
                                      user: p.user,
                                    }))}
                                    creatorRightsLabel={DROITS_CREATEUR_PV_DOC}
                                    droitsAdminCompletLabel={DROITS_ADMIN_PV_DOC}
                                    niveauLabel={(n) => NIVEAUX_CONTRAT_DOC.find((x) => x.value === n)?.label || n}
                                  />
                                  {(linkedPv.permissions || []).map((pp: any) => (
                                    <div key={pp.id} className="min-w-0">
                                      <span className="font-medium text-gray-900">
                                        {pp.user?.prenom} {pp.user?.nom}
                                      </span>
                                      <span className="text-gray-500 italic ml-1">
                                        (
                                        {NIVEAUX_CONTRAT_DOC.find((x) => x.value === pp.niveau)?.label || pp.niveau} :{' '}
                                        {pp.niveau === 'lecture' ? 'lecture' : niveauSummaryContratDoc(pp.niveau)})
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                            {d.estConfidentiel && !isLicenceLinkedDoc && !isContratLinkedDoc && !isPvLinkedDoc && (
                              <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                                {isNativeProjetUploadDoc(d) ? (
                                  <>
                                    <p className="text-xs text-amber-800 mb-1">
                                      Pièce confidentielle pilotée par l&apos;auteur du dépôt (projet, processus, epic ou user
                                      story) — exclusions admin et accès explicites comme sur la fiche projet.
                                    </p>
                                    <div className="mt-2 text-xs text-gray-700 space-y-1">
                                      <AccessContratLikeAdminLines
                                        keyPrefix={`doc-list-${d.id}-proj`}
                                        users={usersList}
                                        createdById={d.uploadedById}
                                        createdBy={d.uploadedBy}
                                        adminSansAccesUserIds={d.adminSansAccesUserIds}
                                        permissions={(d.permissionsUtilisateurs || [])
                                          .filter((p: any) => p.user?.role === 'admin')
                                          .map((p: any) => ({
                                            userId: p.userId || p.user?.id,
                                            niveau: 'lecture',
                                            user: p.user,
                                          }))}
                                        droitsAdminCompletLabel={DROITS_ADMIN_DOC_PROJET_NATIF}
                                        creatorRightsLabel="auteur — tous les droits sur ce document"
                                        niveauLabel={() => 'Lecture'}
                                        limitedPrefix="Admin : accès limité —"
                                      />
                                      {(d.permissionsUtilisateurs || [])
                                        .filter((p: any) => p.user && p.user.role !== 'admin')
                                        .map((p: any) => (
                                          <div key={p.id} className="min-w-0">
                                            <span className="font-medium text-gray-900">
                                              {p.user.prenom} {p.user.nom}
                                            </span>
                                            <span className="text-gray-500 italic block sm:inline sm:ml-1">
                                              (Accès explicite : lecture)
                                            </span>
                                          </div>
                                        ))}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-xs text-gray-500 mb-1">Document confidentiel (hors contrat / licence)</p>
                                    {(() => {
                                      const ayantsDroit: { nom: string; roles: string[] }[] = [];
                                      const addPerson = (id: string, nom: string, role: string) => {
                                        const existing = ayantsDroit.find((a) => a.nom === nom);
                                        if (existing) {
                                          if (!existing.roles.includes(role)) existing.roles.push(role);
                                        } else ayantsDroit.push({ nom, roles: [role] });
                                      };
                                      usersList
                                        .filter((u) => u.role === 'admin')
                                        .forEach((u) => addPerson(u.id, `${u.prenom} ${u.nom}`, 'Admin'));
                                      if (d.uploadedBy)
                                        addPerson(d.uploadedBy.id, `${d.uploadedBy.prenom} ${d.uploadedBy.nom}`, 'Uploadeur');
                                      (d.permissionsUtilisateurs || []).forEach((p: any) => {
                                        if (p.user) addPerson(p.user.id, `${p.user.prenom} ${p.user.nom}`, 'Accès document');
                                      });
                                      if (ayantsDroit.length === 0)
                                        return <span className="italic text-gray-400">Aucun utilisateur défini</span>;
                                      return ayantsDroit.map((a, idx) => (
                                        <div key={idx}>
                                          <span className="font-medium">{a.nom}</span>{' '}
                                          <span className="text-gray-400">({a.roles.join(', ')})</span>
                                        </div>
                                      ));
                                    })()}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                              🌐 Accès libre
                            </span>
                            <div className="mt-1 text-xs text-gray-400 italic">Tous les utilisateurs authentifiés</div>
                          </div>
                        )}
                      </div>
                    </div>
                        </div>

                  <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                    <button
                      type="button"
                      onClick={() => handleViewDocument(d)}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                    >
                      👁 Consulter
                    </button>
                    <button
                      type="button"
                      onClick={() => openCommentsModal(d)}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                    >
                      💬 Commentaires
                      {typeof commentCounts[d.id] === 'number' ? ` (${commentCounts[d.id]})` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleDocumentFavori(d.id)}
                      disabled={loadingFavoris[d.id]}
                      className={`px-3 py-1.5 text-xs rounded hover:opacity-90 disabled:opacity-50 ${
                        favorisDocuments.has(d.id)
                          ? 'bg-amber-100 text-amber-900 border border-amber-200'
                          : 'bg-gray-100 text-gray-800 border border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      {favorisDocuments.has(d.id) ? '⭐ Retirer favori' : '☆ Ajouter favori'}
                    </button>
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleEdit(d)}
                          className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          ✏️ Modifier
                        </button>
                        {canShowAccesButton(d) && (
                          <button
                            type="button"
                            onClick={() => void handleOpenAccesModal(d)}
                            className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200"
                          >
                            🔐 Accès
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDelete(d)}
                          className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                        >
                          🗑 Mettre en corbeille
                        </button>
                      </>
                    )}
                    {!isAdmin && canShowAccesButton(d) && (
                      <button
                        type="button"
                        onClick={() => void handleOpenAccesModal(d)}
                        className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200"
                      >
                        🔐 Accès
                      </button>
                    )}
                  </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {documents.length > pageSize && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 px-4 pb-4 flex-wrap gap-3">
            <div className="text-sm text-gray-700">
              Affichage {startIdx + 1}-{Math.min(startIdx + pageSize, documents.length)} sur {documents.length}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className={`px-4 py-2 rounded text-sm font-medium ${
                  safePage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Précédent
              </button>
              <div className="flex gap-1 flex-wrap items-center">
                {getPaginationPageNumbers(safePage, totalPages).map((p, idx) =>
                  typeof p === 'string' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">
                      {p}
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={`px-3 py-2 rounded text-sm font-medium ${
                        safePage === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
              </div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className={`px-4 py-2 rounded text-sm font-medium ${
                  safePage === totalPages
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de visualisation */}
      {viewingDocument && (documentUrl || getFileType(viewingDocument.fichierType, viewingDocument.fichierNomOriginal || viewingDocument.nom) === 'excel' || getFileType(viewingDocument.fichierType, viewingDocument.fichierNomOriginal || viewingDocument.nom) === 'word') && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b">
              <div>
                <h2 className="text-xl font-bold">{viewingDocument.nom}</h2>
                <p className="text-sm text-gray-500">
                  Version: {viewingDocument.version || 'N/A'} | 
                  Taille: {(viewingDocument.fichierTaille / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleDownload(viewingDocument)}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Télécharger
                </button>
                <button
                  onClick={closeViewer}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Fermer
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden p-4">
              {getFileType(viewingDocument.fichierType, viewingDocument.fichierNomOriginal || viewingDocument.nom) === 'excel' ? (
                <div className="h-full flex flex-col">
                  {excelSheetNames.length > 1 && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Feuille de calcul:
                      </label>
                      <select
                        value={currentSheet}
                        onChange={(e) => handleSheetChange(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-2"
                      >
                        {excelSheetNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {loadingExcel ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-gray-500">Chargement du fichier Excel...</p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto border border-gray-300 rounded">
                      <table className="min-w-full divide-y divide-gray-200">
                        <tbody className="bg-white divide-y divide-gray-200">
                          {excelData.map((row: any[], rowIndex: number) => (
                            <tr key={rowIndex}>
                              {row.map((cell: any, cellIndex: number) => (
                                <td
                                  key={cellIndex}
                                  className={`px-4 py-2 whitespace-nowrap text-sm ${
                                    rowIndex === 0 ? 'font-semibold bg-gray-50' : ''
                                  } ${cellIndex === 0 && rowIndex > 0 ? 'bg-gray-50' : ''}`}
                                >
                                  {cell !== null && cell !== undefined ? String(cell) : ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : getFileType(viewingDocument.fichierType, viewingDocument.fichierNomOriginal || viewingDocument.nom) === 'word' ? (
                loadingDocx ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-gray-500">Chargement du document Word...</p>
                  </div>
                ) : (
                  <div className="h-full overflow-auto border border-gray-300 rounded p-6 bg-white">
                    <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: docxHtml }} />
                  </div>
                )
              ) : getFileType(viewingDocument.fichierType, viewingDocument.fichierNomOriginal || viewingDocument.nom) === 'pdf' ? (
                <iframe
                  src={documentUrl || undefined}
                  className="w-full h-full border border-gray-300 rounded"
                  title={viewingDocument.nom}
                />
              ) : getFileType(viewingDocument.fichierType, viewingDocument.fichierNomOriginal || viewingDocument.nom) === 'image' ? (
                <div className="flex justify-center items-center h-full overflow-auto">
                  <img
                    src={documentUrl || undefined}
                    alt={viewingDocument.nom}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : getFileType(viewingDocument.fichierType, viewingDocument.fichierNomOriginal || viewingDocument.nom) === 'text' ? (
                <iframe
                  src={documentUrl || undefined}
                  className="w-full h-full border border-gray-300 rounded"
                  title={viewingDocument.nom}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full">
                  <p className="text-gray-500 mb-4">
                    Aperçu non disponible pour ce type de fichier ({viewingDocument.fichierType})
                  </p>
                  <button
                    onClick={() => handleDownload(viewingDocument)}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Télécharger pour visualiser
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal commentaires */}
      {showCommentsModalFor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4">
            <div className="p-6 max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Commentaires — {showCommentsModalFor.nom}</h2>
                <button
                  onClick={() => { setShowCommentsModalFor(null); setCommentsModalItems([]); }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              {commentsModalItems.length === 0 ? (
                <div className="text-sm text-gray-500">Aucun commentaire</div>
              ) : (
                <div className="space-y-2">
                  {commentsModalItems.map((c) => (
                    <div key={c.id} className="text-sm bg-gray-50 border border-gray-200 rounded p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{c.user?.prenom} {c.user?.nom}</span>
                        <span className="text-xs text-gray-500">{new Date(c.createdAt).toLocaleString('fr-FR')}</span>
                      </div>
                      <p className="mt-1 text-gray-700 whitespace-pre-wrap">{c.contenu}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal d'upload */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-auto">
            <div className="p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Nouveau document</h2>
                <button
                    onClick={() => {
                      setShowUploadModal(false);
                      setError('');
                      setFiles([]);
                      setFileNames({});
                      setUploadData({ nom: '', description: '', estConfidentiel: false, versionMajeure: '1', versionMineure: '0', versionPatch: '0', processusId: '', typeDocument: 'general' });
                      setPermissionUserIds([]);
                    }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
                  {error}
                </div>
              )}

              <form onSubmit={handleUpload} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fichier(s) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                  {files.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {files.map((file) => (
                        <div key={file.name} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                          <div className="flex-1">
                            <input
                              type="text"
                              value={fileNames[file.name] || file.name}
                              onChange={(e) => setFileNames({ ...fileNames, [file.name]: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                              placeholder="Nom du document"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(file.name)}
                            className="ml-2 text-red-600 hover:text-red-800"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={uploadData.description}
                    onChange={(e) => setUploadData({ ...uploadData, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Description du document"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type de document</label>
                  <select
                    value={uploadData.typeDocument || 'general'}
                    onChange={(e) =>
                      setUploadData({
                        ...uploadData,
                        typeDocument: e.target.value,
                        processusId: e.target.value !== 'processus' ? '' : uploadData.processusId,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {uploadData.typeDocument === 'processus' && <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Processus (optionnel)
                  </label>
                  <select
                    value={uploadData.processusId}
                    onChange={(e) => setUploadData({ ...uploadData, processusId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Aucun processus</option>
                    {processusList.map((processus) => (
                      <option key={processus.id} value={processus.id}>
                        {processus.nom} ({processus.codeProcessus})
                      </option>
                    ))}
                  </select>
                </div>}

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Version majeure
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={uploadData.versionMajeure}
                      onChange={(e) => setUploadData({ ...uploadData, versionMajeure: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Version mineure
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={uploadData.versionMineure}
                      onChange={(e) => setUploadData({ ...uploadData, versionMineure: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Version patch
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={uploadData.versionPatch}
                      onChange={(e) => setUploadData({ ...uploadData, versionPatch: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={uploadData.estConfidentiel}
                      onChange={(e) => {
                        setUploadData({ ...uploadData, estConfidentiel: e.target.checked });
                        if (!e.target.checked) {
                          setPermissionUserIds([]);
                        }
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700">Document confidentiel</span>
                  </label>
                  {uploadData.estConfidentiel && (
                    <div className="mt-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Utilisateurs autorisés <span className="text-red-500">*</span>
                      </label>
                      <select
                        multiple
                        value={permissionUserIds}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, option => option.value);
                          setPermissionUserIds(selected);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        size={5}
                      >
                        {usersList.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.prenom} {user.nom} ({user.email})
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Maintenez Ctrl (ou Cmd sur Mac) pour sélectionner plusieurs utilisateurs
                      </p>
                      {uploadData.estConfidentiel && permissionUserIds.length === 0 && (
                        <p className="mt-1 text-xs text-red-500">
                          Au moins un utilisateur doit être sélectionné pour un document confidentiel
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUploadModal(false);
                      setError('');
                      setFiles([]);
                      setFileNames({});
                      setUploadData({ nom: '', description: '', estConfidentiel: false, versionMajeure: '1', versionMineure: '0', versionPatch: '0', processusId: '', typeDocument: 'general' });
                      setPermissionUserIds([]);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={uploading || files.length === 0 || (uploadData.estConfidentiel && permissionUserIds.length === 0)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {uploading ? 'Upload en cours...' : 'Uploader'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal de modification */}
      {editingDocument && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-auto">
            <div className="p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Modifier le document</h2>
                <button
                  onClick={() => {
                    setEditingDocument(null);
                    setEditData({ nom: '', description: '', statut: 'brouillon', estConfidentiel: false, permissionUserIds: [] });
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSaveEdit(); }} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editData.nom}
                    onChange={(e) => setEditData({ ...editData, nom: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Statut
                  </label>
                  <select
                    value={editData.statut}
                    onChange={(e) => setEditData({ ...editData, statut: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="brouillon">Brouillon</option>
                    <option value="en_revision">En révision</option>
                    <option value="valide">Validé</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editData.estConfidentiel}
                      onChange={(e) => {
                        setEditData({ ...editData, estConfidentiel: e.target.checked });
                        if (!e.target.checked) {
                          setEditData({ ...editData, estConfidentiel: false, permissionUserIds: [] });
                        }
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700">Document confidentiel</span>
                  </label>
                  {editData.estConfidentiel && (
                    <div className="mt-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Utilisateurs autorisés <span className="text-red-500">*</span>
                      </label>
                      <select
                        multiple
                        value={editData.permissionUserIds}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, option => option.value);
                          setEditData({ ...editData, permissionUserIds: selected });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        size={5}
                      >
                        {usersList.map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.prenom} {user.nom} ({user.email})
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Maintenez Ctrl (ou Cmd sur Mac) pour sélectionner plusieurs utilisateurs
                      </p>
                      {editData.estConfidentiel && editData.permissionUserIds.length === 0 && (
                        <p className="mt-1 text-xs text-red-500">
                          Au moins un utilisateur doit être sélectionné pour un document confidentiel
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingDocument(null);
                      setEditData({ nom: '', description: '', statut: 'brouillon', estConfidentiel: false, permissionUserIds: [] });
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={editData.estConfidentiel && editData.permissionUserIds.length === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      <DocumentAccesNatifModal
        open={showDocAccesContratModal && !!acceDoc}
        document={acceDoc ? { id: acceDoc.id, nom: acceDoc.nom } : null}
        users={usersList}
        onClose={() => {
          setShowDocAccesContratModal(false);
          setAcceDoc(null);
        }}
        onAfterMutation={() => loadDocuments()}
      />

      <PvReunionAccesModal
        open={!!pvReunionAccesModal}
        onClose={() => setPvReunionAccesModal(null)}
        pvId={pvReunionAccesModal?.id ?? null}
        titreFallback={pvReunionAccesModal?.titre ?? ''}
        onPermissionsChanged={() => {
          void loadDocuments();
          notifyDocumentsListAccesSync();
        }}
      />

      {/* Modal Modifier Accès (hors pièce confidentielle « natif projet ») */}
      {showAccesModal && acceDoc && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">🔑 Modifier l'accès — {acceDoc.nom}</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="acceConfidentielDocsPage"
                  checked={acceEstConfidentiel}
                  onChange={(e) => {
                    setAcceEstConfidentiel(e.target.checked);
                    if (!e.target.checked) setAccePermissionUserIds([]);
                  }}
                />
                <label htmlFor="acceConfidentielDocsPage" className="text-sm text-gray-700">
                  Accès restreint (document confidentiel)
                </label>
              </div>
              {acceEstConfidentiel && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Utilisateurs autorisés :</label>
                  <select
                    multiple
                    value={accePermissionUserIds}
                    onChange={(e) =>
                      setAccePermissionUserIds(Array.from(e.target.selectedOptions, (o) => o.value))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm h-40"
                  >
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.prenom} {u.nom}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Maintenez Ctrl (Cmd sur Mac) pour sélectionner plusieurs utilisateurs
                  </p>
                  {accePermissionUserIds.length > 0 && (
                    <p className="text-xs text-blue-600 mt-1">
                      {accePermissionUserIds.length} utilisateur(s) sélectionné(s)
                    </p>
                  )}
                </div>
              )}
              {!acceEstConfidentiel && (
                <p className="text-sm text-green-600">
                  {acceDoc?.referenceType === 'projet'
                    ? '🌐 Le document sera consultable par toute personne ayant accès au détail de ce projet.'
                    : "🌐 Sans restriction de confidentialité sur cette pièce, l'accès suit les règles du contexte auquel le document est rattaché."}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowAccesModal(false);
                  setAcceDoc(null);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleSaveAcces()}
                className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
