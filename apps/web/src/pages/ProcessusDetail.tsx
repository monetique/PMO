import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import { PvReunionsLieesBlock } from '../components/PvReunionsLieesBlock';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import * as XLSX from 'xlsx';

const PROC_PERM_LABELS: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des accès',
};

const PROC_PERM_OPTIONS = [
  { value: 'lecture', label: '👁 Lecture' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression' },
  { value: 'gestion', label: '🔐 Gestion des accès' },
];

const PMO_DOCUMENTS_ACCES_CHANGED = 'pmo-documents-acces-changed';
const PMO_PROCESSUS_ACCES_CHANGED = 'pmo-processus-acces-changed';

function notifyDocumentsListAccesSync() {
  try {
    window.dispatchEvent(new CustomEvent(PMO_DOCUMENTS_ACCES_CHANGED));
  } catch {
    /* ignore */
  }
}

function notifyProcessusAccesChanged(processusId?: string) {
  try {
    window.dispatchEvent(new CustomEvent(PMO_PROCESSUS_ACCES_CHANGED, { detail: { processusId } }));
  } catch {
    /* ignore */
  }
}

type DelegationRow = { key: string; userId?: string; nom: string; label: string };

function processusAccesDelegationsRows(p: any): DelegationRow[] {
  const d = p?.accesApercu?.delegations;
  if (d?.length) {
    return d.map((row: any) => ({
      key: `${row.user?.id}-${(row.permissions || []).join(',')}`,
      userId: row.user?.id,
      nom: row.user ? `${row.user.prenom} ${row.user.nom}` : '—',
      label: (row.permissions || []).map((x: string) => PROC_PERM_LABELS[x] || x).join(' + '),
    }));
  }
  return (p?.permissions || []).map((perm: any) => ({
    key: perm.id,
    userId: perm.userId ?? perm.user?.id,
    nom: perm.user ? `${perm.user.prenom} ${perm.user.nom}` : '—',
    label: PROC_PERM_LABELS[perm.permission] || perm.permission,
  }));
}

type ProcessusRecapUserRow = { userId: string; utilisateur: string; roles: string };

function buildProcessusRecapAccessRows(
  p: any,
  delegRows: DelegationRow[],
  usersList: any[],
  droitsAdmin: string
): ProcessusRecapUserRow[] {
  const byId = new Map<string, { utilisateur: string; roles: Set<string> }>();

  const add = (userId: string | undefined, utilisateur: string, roleLine: string) => {
    if (!userId) return;
    if (!byId.has(userId)) {
      byId.set(userId, { utilisateur: utilisateur || '—', roles: new Set() });
    }
    byId.get(userId)!.roles.add(roleLine);
    if (utilisateur && utilisateur !== '—') {
      byId.get(userId)!.utilisateur = utilisateur;
    }
  };

  const excluded = new Set(p?.adminSansAccesUserIds || []);
  const permAgg = processusPermissionsForAdminLinesDetail(p?.permissions || []);
  const permByUserId = new Map(permAgg.map((x) => [x.userId, x]));

  (usersList || [])
    .filter((u: any) => u.role === 'admin' && (!u.statut || u.statut === 'actif'))
    .forEach((a: any) => {
      const creatorId = p?.createdById || p?.createdBy?.id;
      const isCreator = creatorId === a.id;
      const perm = permByUserId.get(a.id);
      const nom = `${a.prenom} ${a.nom}`;
      if (isCreator) {
        add(a.id, nom, `Administrateur et créateur : ${droitsAdmin}`);
        return;
      }
      if (excluded.has(a.id) && !perm) {
        add(
          a.id,
          nom,
          'Administrateur exclu (aucun accès implicite ; réintégration via « Accès »)'
        );
        return;
      }
      if (perm) {
        add(a.id, nom, `Admin : accès limité — ${perm.niveau}`);
        return;
      }
      add(a.id, nom, `Administrateur : ${droitsAdmin}`);
    });

  if (p?.createdBy && (p.createdById || p.createdBy.id)) {
    const cid = p.createdById || p.createdBy.id;
    if (!byId.has(cid)) {
      add(
        cid,
        `${p.createdBy.prenom} ${p.createdBy.nom}`,
        `Créateur du processus : ${droitsAdmin}`
      );
    }
  }

  if (p?.proprietaire && p.proprietaireId && p.proprietaireId !== p.createdById) {
    add(
      p.proprietaireId,
      `${p.proprietaire.prenom} ${p.proprietaire.nom}`,
      'Propriétaire du processus (fiche et documents confidentiels)'
    );
  }

  delegRows.forEach((r) => {
    if (!r.userId) return;
    add(r.userId, r.nom, `Droit délégué sur le processus : ${r.label}`);
  });

  return Array.from(byId.entries()).map(([userId, v]) => ({
    userId,
    utilisateur: v.utilisateur,
    roles: Array.from(v.roles).join(' ; '),
  }));
}

type HabilitatorRow = { id: string; line: string; email?: string };

function collectHabilitatorsForProcessusAccess(p: any | null, usersList: any[]): HabilitatorRow[] {
  const out: HabilitatorRow[] = [];
  const seen = new Set<string>();
  const add = (u: any | null | undefined, role: string) => {
    if (!u?.id || seen.has(u.id)) return;
    seen.add(u.id);
    const mail = u.email ? ` — ${u.email}` : '';
    out.push({
      id: u.id,
      line: `${u.prenom} ${u.nom}${mail} (${role})`,
      email: u.email,
    });
  };
  (usersList || []).forEach((u: any) => {
    if (u.role === 'admin' && (!u.statut || u.statut === 'actif')) {
      add(u, 'administrateur');
    }
  });
  if (p?.proprietaire) add(p.proprietaire, 'propriétaire du processus');
  if (p?.createdBy) add(p.createdBy, 'créateur du processus');
  (p?.permissions || []).forEach((perm: any) => {
    if (perm.permission === 'gestion' && perm.user) {
      add(perm.user, 'gestion des accès sur le processus');
    }
  });
  return out;
}

function collectHabilitatorsForDocumentAccess(
  p: any | null,
  usersList: any[],
  doc: any | null
): HabilitatorRow[] {
  const rows = collectHabilitatorsForProcessusAccess(p, usersList);
  const seen = new Set(rows.map((r) => r.id));
  const u = doc?.uploadedBy;
  if (u?.id && !seen.has(u.id)) {
    const mail = u.email ? ` — ${u.email}` : '';
    rows.push({
      id: u.id,
      line: `${u.prenom} ${u.nom}${mail} (auteur du document — peut étendre la liste d’accès)`,
      email: u.email,
    });
  }
  return rows;
}

/** Même règle métier que l’API `isNativeProjetUploadDocument` pour les pièces processus. */
function isNativeProcessusConfidentialUploadDoc(d: any) {
  return (
    !!d?.estConfidentiel &&
    d?.typeDocument === 'processus' &&
    d?.referenceType === 'processus' &&
    !!d?.referenceId
  );
}

const DROITS_ADMIN_DOC_NATIF_PROCESSUS =
  'visualisation, modification statut, accès, suppression (admin non exclu de la pièce)';

function processusPermissionsForAdminLinesDetail(perms: any[]) {
  const m = new Map<string, { userId: string; niveau: string; user?: any }>();
  for (const r of perms || []) {
    const uid = r.userId || r.user?.id;
    if (!uid) continue;
    const ex = m.get(uid);
    const part = PROC_PERM_LABELS[r.permission] || r.permission;
    m.set(uid, {
      userId: uid,
      niveau: ex ? `${ex.niveau} + ${part}` : part,
      user: r.user,
    });
  }
  return Array.from(m.values());
}

function permSummaryDelegProcessus(perms: string[]) {
  return perms.map((p) => PROC_PERM_LABELS[p] || p).join(' + ');
}

export default function ProcessusDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser } = useAuth();
  const isLecteur = currentUser?.role === 'lecteur';
  const isContributeur = currentUser?.role === 'contributeur';

  // Vérifier si l'utilisateur peut modifier le processus (capabilities API + repli)
  const canModifyProcessus = () => {
    if (!currentUser || !processus) return false;
    if (processus.capabilities?.canModify != null) return !!processus.capabilities.canModify;
    if (currentUser.role === 'admin') return true;
    if (isContributeur) {
      return processus.proprietaireId === currentUser.id || processus.createdById === currentUser.id;
    }
    return !isLecteur;
  };
  const [processus, setProcessus] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [historyPagination, setHistoryPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [updatingDocStatus, setUpdatingDocStatus] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState<string | null>(null);
  const [editingDocument, setEditingDocument] = useState<any>(null);
  const [editDocumentData, setEditDocumentData] = useState({
    nom: '',
    description: '',
    estConfidentiel: false,
  });
  const [editPermissionUserIds, setEditPermissionUserIds] = useState<string[]>([]);
  const [uploadData, setUploadData] = useState({
    nom: '',
    description: '',
    estConfidentiel: false,
    versionMajeure: '1',
    versionMineure: '0',
    versionPatch: '0',
  });
  const [permissionUserIds, setPermissionUserIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [fileNames, setFileNames] = useState<{ [key: string]: string }>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entitesList, setEntitesList] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [categoriesList, setCategoriesList] = useState<any[]>([]);
  const [canSetConfidentiel, setCanSetConfidentiel] = useState(false);
  const [editData, setEditData] = useState({
    codeProcessus: '',
    statut: '',
    proprietaireId: '',
    entiteIds: [] as string[],
    categorieIds: [] as string[],
    tags: [] as string[],
    description: '',
  });
  const [showProcAccesModal, setShowProcAccesModal] = useState(false);
  const [procAccesDetail, setProcAccesDetail] = useState<any>(null);
  const [procAccesLoading, setProcAccesLoading] = useState(false);
  const [procAccesAdminLimitPerm, setProcAccesAdminLimitPerm] = useState<Record<string, string>>({});
  const [procAccesNewUserId, setProcAccesNewUserId] = useState('');
  const [procAccesNewPermType, setProcAccesNewPermType] = useState('lecture');
  const [docAccesModalDoc, setDocAccesModalDoc] = useState<any>(null);
  const [docAccesEstConfidentiel, setDocAccesEstConfidentiel] = useState(false);
  const [docAccesPermissionUserIds, setDocAccesPermissionUserIds] = useState<string[]>([]);
  const [showProcDocContratAccesModal, setShowProcDocContratAccesModal] = useState(false);
  const [procDocContratAcces, setProcDocContratAcces] = useState<any>(null);
  const [procDocContratAccesDetail, setProcDocContratAccesDetail] = useState<any>(null);
  const [procDocContratAccesLoading, setProcDocContratAccesLoading] = useState(false);
  const [procDocContratNewPermUserId, setProcDocContratNewPermUserId] = useState('');
  const [viewingDocument, setViewingDocument] = useState<any | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [excelData, setExcelData] = useState<any[]>([]);
  const [excelSheetNames, setExcelSheetNames] = useState<string[]>([]);
  const [currentSheet, setCurrentSheet] = useState<string>('');
  const [loadingExcel, setLoadingExcel] = useState(false);
  const [excelWorkbook, setExcelWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [docComments, setDocComments] = useState<Record<string, any[]>>({});
  const [newComment, setNewComment] = useState<Record<string, string>>({});
  const [commentAttachments, setCommentAttachments] = useState<Record<string, File | null>>({});
  const [tagsInput, setTagsInput] = useState('');
  const [estFavori, setEstFavori] = useState(false);
  const [loadingFavori, setLoadingFavori] = useState(false);
  const [accessBlockedModal, setAccessBlockedModal] = useState<{
    context: 'process' | 'document';
    documentLabel?: string;
    documentRef?: any;
  } | null>(null);

  useEffect(() => {
    if (id) {
      loadProcessus();
      loadDocuments();
      loadEntites();
      loadUsers();
      loadCategories();
      loadHistory(1);
      checkFavori();
    }
  }, [id, currentUser]);

  useEffect(() => {
    const st = location.state as { openEdit?: boolean } | null;
    if (st?.openEdit && processus && canModifyProcessus()) {
      setIsEditing(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ouverture unique depuis la liste
  }, [processus?.id]);

  const checkFavori = async () => {
    if (!id || !currentUser?.id) return;
    try {
      const response = await api.get(`/favoris/processus/${id}/check`);
      setEstFavori(response.data.estFavori);
    } catch (error) {
      console.error('Erreur vérification favori:', error);
    }
  };

  const handleToggleFavori = async () => {
    if (!id || !currentUser?.id || loadingFavori) return;
    setLoadingFavori(true);
    try {
      if (estFavori) {
        await api.delete(`/favoris/processus/${id}`);
        setEstFavori(false);
      } else {
        await api.post(`/favoris/processus/${id}`);
        setEstFavori(true);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erreur lors de la modification des favoris');
    } finally {
      setLoadingFavori(false);
    }
  };

  useEffect(() => {
    if (processus) {
      const tags = processus.tags || [];
      setEditData({
        codeProcessus: processus.codeProcessus || '',
        statut: processus.statut || 'brouillon',
        proprietaireId: processus.proprietaireId || '',
        entiteIds: processus.entites?.map((pe: any) => pe.entite?.id || pe.entiteId).filter(Boolean) || [],
        categorieIds: processus.categories?.map((pc: any) => pc.categorie?.id || pc.categorieId).filter(Boolean) || [],
        tags: tags,
        description: processus.description ?? '',
      });
      setTagsInput(tags.join(', '));
      
      // Vérifier si l'utilisateur peut définir confidentiel (propriétaire ou créateur)
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const canSet = processus.proprietaireId === currentUser.id || processus.createdById === currentUser.id;
      setCanSetConfidentiel(canSet);
    }
  }, [processus]);

  useEffect(() => {
    // Nettoyer l'URL blob lors du démontage
    return () => {
      if (documentUrl) {
        window.URL.revokeObjectURL(documentUrl);
      }
    };
  }, [documentUrl]);

  const loadProcessus = async () => {
    try {
      const response = await api.get(`/processus/${id}`);
      setProcessus(response.data);
    } catch (error: any) {
      console.error('Erreur:', error);
      if (error.response?.status === 404) {
        setError('Processus non trouvé');
      } else if (error.response?.status === 403) {
        // Message d'erreur spécifique pour les processus archivés/obsolètes
        setError(error.response?.data?.error || 'Vous n\'avez pas accès à ce processus');
      } else {
        setError('Erreur lors du chargement du processus');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    const onSync = (e: Event) => {
      const pid = (e as CustomEvent<{ processusId?: string }>).detail?.processusId;
      if (pid != null && pid !== id) return;
      void loadProcessus();
    };
    window.addEventListener(PMO_PROCESSUS_ACCES_CHANGED, onSync);
    return () => window.removeEventListener(PMO_PROCESSUS_ACCES_CHANGED, onSync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadDocuments = async () => {
    try {
      const response = await api.get(`/documents?referenceType=processus&referenceId=${id}`);
      setDocuments(response.data);
      // Charger les commentaires pour chaque document
      const commentsByDoc: Record<string, any[]> = {};
      await Promise.all(
        (response.data || []).map(async (d: any) => {
          try {
            const token = localStorage.getItem('token');
            const res = await api.get(`/documents/${d.id}/comments`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
            commentsByDoc[d.id] = res.data || [];
          } catch {
            commentsByDoc[d.id] = [];
          }
        })
      );
      setDocComments(commentsByDoc);
    } catch (error) {
      console.error('Erreur chargement documents:', error);
    }
  };

  const handleAddComment = async (documentId: string) => {
    const content = (newComment[documentId] || '').trim();
    const attachment = commentAttachments[documentId];
    
    if (!content && !attachment) {
      alert('Veuillez saisir un commentaire ou joindre un fichier');
      return;
    }
    
    try {
      const formData = new FormData();
      formData.append('contenu', content || '');
      if (attachment) {
        formData.append('pieceJointe', attachment);
      }

      const res = await api.post(`/documents/${documentId}/comments`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      setDocComments({
        ...docComments,
        [documentId]: [...(docComments[documentId] || []), res.data],
      });
      setNewComment({ ...newComment, [documentId]: '' });
      setCommentAttachments({ ...commentAttachments, [documentId]: null });
      loadHistory(1);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur ajout commentaire');
    }
  };

  const handleDownloadAttachment = async (commentId: string, fileName: string) => {
    try {
      const response = await api.get(`/comments/${commentId}/attachment`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
    } catch (error: any) {
      console.error('Erreur lors du téléchargement:', error);
      alert('Erreur lors du téléchargement de la pièce jointe');
    }
  };

  const loadEntites = async () => {
    try {
      const response = await api.get('/entites');
      setEntitesList(response.data);
    } catch (error) {
      console.error('Erreur chargement entités:', error);
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

  const loadCategories = async () => {
    try {
      const response = await api.get('/categories');
      setCategoriesList(response.data);
    } catch (error) {
      console.error('Erreur chargement catégories:', error);
    }
  };

  const loadHistory = async (page: number = 1) => {
    try {
      const response = await api.get(`/processus/${id}/history?page=${page}&limit=10`);
      setHistory(response.data.data);
      setHistoryPagination(response.data.pagination);
    } catch (error) {
      console.error('Erreur chargement historique:', error);
    }
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
        setUploadData({ ...uploadData, nom: selectedFiles[0].name });
      }
    }
  };

  const removeFile = (fileName: string) => {
    setFiles(files.filter(f => f.name !== fileName));
    const newNames = { ...fileNames };
    delete newNames[fileName];
    setFileNames(newNames);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) {
      setError('Veuillez sélectionner au moins un fichier');
      return;
    }

    // Validation : si confidentiel est coché, au moins un utilisateur doit être sélectionné
    if (uploadData.estConfidentiel && permissionUserIds.length === 0) {
      setError('Au moins un utilisateur doit être sélectionné pour un document confidentiel');
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
        formData.append('typeDocument', 'processus');
        formData.append('referenceType', 'processus');
        formData.append('referenceId', id!);
        formData.append('description', uploadData.description || '');
        formData.append('estConfidentiel', uploadData.estConfidentiel.toString());
        if (uploadData.estConfidentiel && permissionUserIds.length > 0) {
          permissionUserIds.forEach(userId => {
            formData.append('permissionUserIds', userId);
          });
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
      setPermissionUserIds([]);
      setUploadData({ nom: '', description: '', estConfidentiel: false, versionMajeure: '1', versionMineure: '0', versionPatch: '0' });
      loadDocuments();
      loadHistory(1);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de l\'upload des fichiers');
    } finally {
      setUploading(false);
    }
  };

  const handleVersionUpload = async (documentId: string, e: React.FormEvent) => {
    e.preventDefault();
    const versionFile = (e.target as HTMLFormElement).querySelector('input[type="file"]') as HTMLInputElement;
    const commentaire = (e.target as HTMLFormElement).querySelector('textarea') as HTMLTextAreaElement;

    if (!versionFile?.files?.[0]) {
      alert('Veuillez sélectionner un fichier');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', versionFile.files[0]);
      if (commentaire?.value) {
        formData.append('commentaireVersion', commentaire.value);
      }

      await api.post(`/documents/${documentId}/versions`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setShowVersionModal(null);
      loadDocuments();
      loadHistory(1);
    } catch (err: any) {
      if (err.response?.status === 403) {
        const d = documents.find((x: any) => x.id === documentId);
        setAccessBlockedModal({
          context: 'document',
          documentLabel: d?.nom,
          documentRef: d,
        });
      } else {
        alert(err.response?.data?.error || 'Erreur lors de l\'ajout de version');
      }
    }
  };

  const hasProcessViewForDocuments = (): boolean => {
    if (!currentUser || !processus) return false;
    if (processus.capabilities?.canView != null) return !!processus.capabilities.canView;
    if (currentUser.role === 'admin') return true;
    if (processus.proprietaireId === currentUser.id || processus.createdById === currentUser.id) return true;
    if (processus.createdById == null) return true;
    return (processus.permissions || []).some((perm: any) => perm.userId === currentUser.id);
  };

  const whyCannotAccessDocument = (doc: any): 'ok' | 'process' | 'document' => {
    if (!hasProcessViewForDocuments()) return 'process';
    if (!doc.estConfidentiel) return 'ok';
    const uid = currentUser?.id;
    if (!uid) return 'document';
    if (doc.uploadedById === uid) return 'ok';
    if (processus && (processus.proprietaireId === uid || processus.createdById === uid)) return 'ok';
    if (
      doc.permissionsUtilisateurs?.some(
        (perm: any) => perm.userId === uid || perm.user?.id === uid
      )
    ) {
      return 'ok';
    }
    return 'document';
  };

  const canAccessDocument = (doc: any): boolean => whyCannotAccessDocument(doc) === 'ok';

  const openDocumentAccessDenied = (context: 'process' | 'document', doc?: any) => {
    setAccessBlockedModal({
      context,
      documentLabel: doc?.nom,
      documentRef: doc,
    });
  };

  const handleViewDocument = async (doc: any) => {
    const why = whyCannotAccessDocument(doc);
    if (why !== 'ok') {
      openDocumentAccessDenied(why, doc);
      return;
    }

    try {
      // Utiliser l'endpoint /view pour la visualisation (log 'lecture')
      const response = await api.get(`/documents/${doc.id}/view`, {
        responseType: 'blob',
      });
      
      const fileType = getFileType(doc.fichierType);
      
      // Si c'est un fichier Excel, parser le contenu
      if (fileType === 'excel') {
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
      if (error.response?.status === 403) {
        openDocumentAccessDenied('document', doc);
      } else if (error.response?.status === 404) {
        alert('Document non trouvé. Veuillez vérifier que l\'API est à jour.');
        console.error('Endpoint non trouvé:', error.config?.url);
      } else {
        alert(`Erreur lors du chargement du document: ${error.response?.data?.error || error.message}`);
      }
      setLoadingExcel(false);
    }
  };

  const handleDownload = async (document: any) => {
    const why = whyCannotAccessDocument(document);
    if (why !== 'ok') {
      openDocumentAccessDenied(why, document);
      return;
    }

    try {
      // Utiliser l'API avec le token dans les headers pour télécharger le fichier
      const response = await api.get(`/documents/${document.id}/download`, {
        responseType: 'blob',
      });
      
      // Créer un blob URL et déclencher le téléchargement
      const blob = new Blob([response.data], { 
        type: document.fichierType || response.headers['content-type'] || 'application/octet-stream' 
      });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.setAttribute('download', document.fichierNomOriginal);
      link.style.display = 'none';
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      // Nettoyer le blob URL après un court délai
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
    } catch (error: any) {
      console.error('Erreur lors du téléchargement:', error);
      if (error.response?.status === 403) {
        openDocumentAccessDenied('document', document);
      } else {
        alert('Erreur lors du téléchargement');
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
  };

  const handleSheetChange = (sheetName: string) => {
    if (!excelWorkbook) return;
    setCurrentSheet(sheetName);
    const sheet = excelWorkbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    setExcelData(jsonData);
  };

  const getFileType = (mimeType: string): string => {
    if (mimeType?.includes('pdf')) return 'pdf';
    if (mimeType?.includes('image')) return 'image';
    if (mimeType?.includes('text')) return 'text';
    if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || 
        mimeType?.includes('vnd.ms-excel') || mimeType?.includes('vnd.openxmlformats-officedocument.spreadsheetml')) {
      return 'excel';
    }
    return 'other';
  };

  const handleDownloadVersion = async (documentId: string, versionId: string, version: string, originalName: string) => {
    const doc = documents.find((d: any) => d.id === documentId);
    if (!doc) {
      alert('Document introuvable');
      return;
    }
    const why = whyCannotAccessDocument(doc);
    if (why !== 'ok') {
      openDocumentAccessDenied(why, doc);
      return;
    }
    try {
      const response = await api.get(`/documents/${documentId}/versions/${versionId}/download`, {
        responseType: 'blob',
      });
      // Spécifier le type MIME correct
      const blob = new Blob([response.data], { type: response.headers['content-type'] || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${originalName}_v${version}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Nettoyer le blob URL après un court délai
      setTimeout(() => window.URL.revokeObjectURL(url), 100);
    } catch (error: any) {
      console.error('Erreur lors du téléchargement de la version:', error);
      if (error.response?.status === 403) {
        openDocumentAccessDenied('document', doc);
      } else {
        alert('Erreur lors du téléchargement de la version');
      }
    }
  };

  const handleDocumentStatusChange = async (documentId: string, newStatus: string) => {
    setUpdatingDocStatus(documentId);
    try {
      await api.put(`/documents/${documentId}`, { statut: newStatus });
      loadDocuments();
      loadHistory(1);
    } catch (err: any) {
      if (err.response?.status === 403) {
        const d = documents.find((x: any) => x.id === documentId);
        openDocumentAccessDenied('document', d);
      } else {
        alert(err.response?.data?.error || 'Erreur lors de la mise à jour du statut');
      }
    } finally {
      setUpdatingDocStatus(null);
    }
  };

  const canModifyDocument = (doc: any): boolean => {
    if (!currentUser || !processus) return false;
    if (!hasProcessViewForDocuments()) return false;

    // Les lecteurs ne peuvent jamais modifier
    if (isLecteur) return false;
    
    // Les admins peuvent toujours modifier
    if (currentUser.role === 'admin') return true;
    
    // Pour les contributeurs, seuls le propriétaire ou le créateur du processus peuvent modifier
    if (isContributeur) {
      return processus.proprietaireId === currentUser.id || processus.createdById === currentUser.id;
    }
    
    // Si le document n'est pas confidentiel, les autres rôles peuvent le modifier
    if (!doc.estConfidentiel) return true;
    
    // L'utilisateur qui a uploadé peut toujours modifier
    if (doc.uploadedById === currentUser.id) return true;

    // Pour les documents confidentiels, seuls les utilisateurs explicitement dans la liste des permissions peuvent modifier
    if (doc.permissionsUtilisateurs && doc.permissionsUtilisateurs.length > 0) {
      return doc.permissionsUtilisateurs.some((perm: any) => perm.userId === currentUser.id || perm.user?.id === currentUser.id);
    }

    return false;
  };

  const canDeleteOrAddVersion = (doc: any): boolean => {
    if (!currentUser || !processus) return false;
    if (!hasProcessViewForDocuments()) return false;

    // Les lecteurs ne peuvent jamais supprimer/ajouter version
    if (isLecteur) return false;
    
    // Les admins peuvent toujours supprimer/ajouter version
    if (currentUser.role === 'admin') return true;
    
    // Pour les contributeurs, seuls le propriétaire ou le créateur du processus peuvent supprimer/ajouter version
    if (isContributeur) {
      return processus.proprietaireId === currentUser.id || processus.createdById === currentUser.id;
    }
    
    // Si le document n'est pas confidentiel, les autres rôles peuvent supprimer/ajouter version
    if (!doc.estConfidentiel) return true;
    
    // L'utilisateur qui a uploadé peut toujours supprimer/ajouter version
    if (doc.uploadedById === currentUser.id) return true;

    // Pour les documents confidentiels, seuls les utilisateurs explicitement dans la liste des permissions peuvent supprimer/ajouter version
    if (doc.permissionsUtilisateurs && doc.permissionsUtilisateurs.length > 0) {
      return doc.permissionsUtilisateurs.some((perm: any) => perm.userId === currentUser.id || perm.user?.id === currentUser.id);
    }

    return false;
  };

  const canModifyCodeProcessus = (): boolean => {
    if (!currentUser || !processus) return false;
    
    // Le super admin peut toujours modifier le code
    if (currentUser.role === 'admin') {
      return true;
    }

    // Le propriétaire ou le créateur peut modifier le code
    return processus.proprietaireId === currentUser.id || processus.createdById === currentUser.id;
  };

  const canModifyTags = (): boolean => {
    if (!currentUser || !processus) return false;
    
    // Le super admin peut toujours modifier les tags
    if (currentUser.role === 'admin') {
      return true;
    }

    // Le propriétaire ou le créateur peut modifier les tags
    return processus.proprietaireId === currentUser.id || processus.createdById === currentUser.id;
  };

  const documentStatuts = [
    { value: 'brouillon', label: 'Brouillon', color: 'bg-gray-100 text-gray-800' },
    { value: 'en_revision', label: 'En révision', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'valide', label: 'Validé', color: 'bg-green-100 text-green-800' },
    { value: 'archive', label: 'Archivé', color: 'bg-purple-100 text-purple-800' },
  ];

  const handleEditDocument = (doc: any) => {
    setEditingDocument(doc);
    setEditDocumentData({
      nom: doc.nom,
      description: doc.description || '',
      estConfidentiel: doc.estConfidentiel || false,
    });
    // Initialiser les utilisateurs autorisés depuis le document
    const initialPermissionIds = doc.permissionsUtilisateurs 
      ? doc.permissionsUtilisateurs.map((perm: any) => perm.userId || perm.user?.id).filter(Boolean)
      : [];
    setEditPermissionUserIds(initialPermissionIds);
    setShowEditModal(doc.id);
  };

  const handleSaveDocumentEdit = async () => {
    if (!editingDocument) return;

    // Validation : si confidentiel est coché, au moins un utilisateur doit être sélectionné
    if (editDocumentData.estConfidentiel && editPermissionUserIds.length === 0) {
      alert('Au moins un utilisateur doit être sélectionné pour un document confidentiel');
      return;
    }

    try {
      await api.put(`/documents/${editingDocument.id}`, {
        nom: editDocumentData.nom,
        description: editDocumentData.description,
        estConfidentiel: editDocumentData.estConfidentiel,
        permissionUserIds: editDocumentData.estConfidentiel ? editPermissionUserIds : [],
      });

      setShowEditModal(null);
      setEditingDocument(null);
      setEditDocumentData({ nom: '', description: '', estConfidentiel: false });
      setEditPermissionUserIds([]);
      loadDocuments();
      loadHistory(1);
      notifyDocumentsListAccesSync();
    } catch (err: any) {
      if (err.response?.status === 403) {
        alert('Vous n\'avez pas accès à ce document confidentiel');
      } else {
        alert(err.response?.data?.error || 'Erreur lors de la modification');
      }
    }
  };

  const canModifierAccesDocument = (doc: any): boolean => {
    if (!currentUser || !processus) return false;
    if (!hasProcessViewForDocuments()) return false;
    if (isLecteur) return false;
    if (currentUser.role === 'admin') return true;
    if (doc.uploadedById === currentUser.id) return true;
    return !!doc.permissionsUtilisateurs?.some(
      (p: any) => p.userId === currentUser.id || p.user?.id === currentUser.id
    );
  };

  const openDocumentAccesModal = async (doc: any) => {
    if (isNativeProcessusConfidentialUploadDoc(doc)) {
      setProcDocContratAcces(doc);
      setShowProcDocContratAccesModal(true);
      setProcDocContratAccesDetail(null);
      setProcDocContratNewPermUserId('');
      setProcDocContratAccesLoading(true);
      try {
        const { data } = await api.get(`/documents/${doc.id}/acces`);
        setProcDocContratAccesDetail(data);
      } catch (e: any) {
        alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
        setShowProcDocContratAccesModal(false);
        setProcDocContratAcces(null);
      } finally {
        setProcDocContratAccesLoading(false);
      }
      return;
    }
    setDocAccesModalDoc(doc);
    setDocAccesEstConfidentiel(!!doc.estConfidentiel);
    setDocAccesPermissionUserIds(
      doc.permissionsUtilisateurs?.map((p: any) => p.userId || p.user?.id).filter(Boolean) || []
    );
  };

  const closeDocumentAccesModal = () => {
    setDocAccesModalDoc(null);
    setDocAccesEstConfidentiel(false);
    setDocAccesPermissionUserIds([]);
  };

  const closeProcDocContratAccesModal = () => {
    setShowProcDocContratAccesModal(false);
    setProcDocContratAcces(null);
    setProcDocContratAccesDetail(null);
  };

  const refreshProcDocContratAccesDetail = async (documentId: string) => {
    const { data } = await api.get(`/documents/${documentId}/acces`);
    setProcDocContratAccesDetail(data);
  };

  const handleProcDocRestoreAdmin = async (userId: string) => {
    if (!procDocContratAcces) return;
    if (!window.confirm("Rétablir l'accès administrateur implicite (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/documents/${procDocContratAcces.id}/admin-sans-acces/${userId}`);
      await refreshProcDocContratAccesDetail(procDocContratAcces.id);
      loadDocuments();
      loadHistory(1);
      notifyDocumentsListAccesSync();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleProcDocRevokeAdminImplicit = async (userId: string) => {
    if (!procDocContratAcces) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur sur ce document ? Il ne le verra plus tant que vous ne lui accorderez pas un accès explicite."
      )
    ) {
      return;
    }
    try {
      await api.post(`/documents/${procDocContratAcces.id}/admin-sans-acces`, { userId });
      await refreshProcDocContratAccesDetail(procDocContratAcces.id);
      loadDocuments();
      loadHistory(1);
      notifyDocumentsListAccesSync();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleProcDocQuickLimitAdmin = async (userId: string) => {
    if (!procDocContratAcces) return;
    try {
      await api.post(`/documents/${procDocContratAcces.id}/permissions`, { userId });
      await refreshProcDocContratAccesDetail(procDocContratAcces.id);
      loadDocuments();
      loadHistory(1);
      notifyDocumentsListAccesSync();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleProcDocRemovePermissionRow = async (permissionId: string, targetIsAdmin?: boolean) => {
    if (!procDocContratAcces) return;
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus de droit explicite ; sans rétablissement il pourra être totalement exclu."
      : 'Retirer cet accès ?';
    if (!window.confirm(msg)) return;
    try {
      await api.delete(`/documents/${procDocContratAcces.id}/permissions/${permissionId}`);
      await refreshProcDocContratAccesDetail(procDocContratAcces.id);
      loadDocuments();
      loadHistory(1);
      notifyDocumentsListAccesSync();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleProcDocAddSharedPermission = async () => {
    if (!procDocContratAcces || !procDocContratNewPermUserId) return;
    try {
      await api.post(`/documents/${procDocContratAcces.id}/permissions`, { userId: procDocContratNewPermUserId });
      setProcDocContratNewPermUserId('');
      await refreshProcDocContratAccesDetail(procDocContratAcces.id);
      loadDocuments();
      loadHistory(1);
      notifyDocumentsListAccesSync();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleSaveDocumentAccesModal = async () => {
    if (!docAccesModalDoc) return;
    if (docAccesEstConfidentiel && docAccesPermissionUserIds.length === 0) {
      alert('Au moins un utilisateur doit être sélectionné pour un document confidentiel');
      return;
    }
    try {
      await api.put(`/documents/${docAccesModalDoc.id}`, {
        estConfidentiel: docAccesEstConfidentiel,
        permissionUserIds: docAccesEstConfidentiel ? docAccesPermissionUserIds : [],
      });
      closeDocumentAccesModal();
      loadDocuments();
      loadHistory(1);
      notifyDocumentsListAccesSync();
    } catch (err: any) {
      alert(err.response?.data?.error || "Erreur lors de la modification de l'accès");
    }
  };

  const refreshProcAccesDetail = async () => {
    if (!id) return;
    const { data } = await api.get(`/processus/${id}/acces`);
    setProcAccesDetail(data);
  };

  const openProcessusAccesModal = async () => {
    if (!id || !processus) return;
    setShowProcAccesModal(true);
    setProcAccesDetail(null);
    setProcAccesNewUserId('');
    setProcAccesNewPermType('lecture');
    setProcAccesAdminLimitPerm({});
    setProcAccesLoading(true);
    try {
      const { data } = await api.get(`/processus/${id}/acces`);
      setProcAccesDetail(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
      setShowProcAccesModal(false);
    } finally {
      setProcAccesLoading(false);
    }
  };

  const handleProcAddPermission = async () => {
    if (!id || !procAccesNewUserId) return;
    try {
      await api.post(`/processus/${id}/permissions`, {
        userId: procAccesNewUserId,
        permission: procAccesNewPermType,
      });
      setProcAccesNewUserId('');
      await refreshProcAccesDetail();
      await loadProcessus();
      notifyProcessusAccesChanged(id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleProcRemovePermissionEntry = async (permissionEntryId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit explicite sur ce processus. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès »."
      : 'Retirer ce droit ?';
    if (!id || !window.confirm(msg)) return;
    try {
      await api.delete(`/processus/${id}/permissions/${permissionEntryId}`);
      await refreshProcAccesDetail();
      await loadProcessus();
      notifyProcessusAccesChanged(id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const revokeAllProcDelegationsForUser = async (userId: string) => {
    if (!id || !procAccesDetail) return;
    const rows = (procAccesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    if (rows.length === 0) return;
    if (!window.confirm('Révoquer tous les droits explicites pour cet utilisateur sur ce processus ?')) return;
    try {
      for (const r of rows) {
        await api.delete(`/processus/${id}/permissions/${r.id}`);
      }
      await refreshProcAccesDetail();
      await loadProcessus();
      notifyProcessusAccesChanged(id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleProcRestoreAdminDefault = async (userId: string) => {
    if (!id) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/processus/${id}/admin-sans-acces/${userId}`);
      await refreshProcAccesDetail();
      await loadProcessus();
      notifyProcessusAccesChanged(id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleProcRevokeAdminImplicit = async (userId: string) => {
    if (!id) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus le processus tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous."
      )
    ) {
      return;
    }
    try {
      await api.post(`/processus/${id}/admin-sans-acces`, { userId });
      await refreshProcAccesDetail();
      await loadProcessus();
      notifyProcessusAccesChanged(id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const quickLimitProcAdmin = async (userId: string) => {
    if (!id) return;
    const permission = procAccesAdminLimitPerm[userId] || 'lecture';
    try {
      await api.post(`/processus/${id}/permissions`, { userId, permission });
      await refreshProcAccesDetail();
      await loadProcessus();
      notifyProcessusAccesChanged(id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const replaceProcAdminPermissionLevel = async (userId: string, permission: string) => {
    if (!id || !procAccesDetail) return;
    const rows = (procAccesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    try {
      for (const r of rows) {
        await api.delete(`/processus/${id}/permissions/${r.id}`);
      }
      await api.post(`/processus/${id}/permissions`, { userId, permission });
      await refreshProcAccesDetail();
      await loadProcessus();
      notifyProcessusAccesChanged(id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleDeleteDocument = async (documentId: string, documentName: string) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer le document "${documentName}" ?`)) {
      return;
    }

    try {
      await api.delete(`/documents/${documentId}`);
      loadDocuments();
      loadHistory(1);
    } catch (err: any) {
      if (err.response?.status === 403) {
        alert('Vous n\'avez pas accès à ce document confidentiel');
      } else {
        alert(err.response?.data?.error || 'Erreur lors de la suppression');
      }
    }
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const updateData: any = {};
      
      // Mettre à jour le statut séparément si nécessaire
      if (editData.statut !== processus.statut) {
        await api.patch(`/processus/${id}/status`, { statut: editData.statut });
      }
      
      // Préparer les données à mettre à jour
      // Mettre à jour le code processus si modifié et si l'utilisateur a les droits
      if (canModifyCodeProcessus() && editData.codeProcessus !== processus.codeProcessus) {
        updateData.codeProcessus = editData.codeProcessus;
      }
      if (editData.proprietaireId !== (processus.proprietaireId || '')) {
        updateData.proprietaireId = editData.proprietaireId || null;
      }
      const currentEntiteIds = processus.entites?.map((pe: any) => pe.entite?.id || pe.entiteId).filter(Boolean).sort() || [];
      const newEntiteIds = (editData.entiteIds || []).sort();
      if (JSON.stringify(currentEntiteIds) !== JSON.stringify(newEntiteIds)) {
        updateData.entiteIds = editData.entiteIds || [];
      }
      const currentCategorieIds = processus.categories?.map((pc: any) => pc.categorie?.id || pc.categorieId).filter(Boolean).sort() || [];
      const newCategorieIds = (editData.categorieIds || []).sort();
      if (JSON.stringify(currentCategorieIds) !== JSON.stringify(newCategorieIds)) {
        updateData.categorieIds = editData.categorieIds || [];
      }
      const currentTags = (processus.tags || []).sort();
      const newTags = (editData.tags || []).sort();
      if (JSON.stringify(currentTags) !== JSON.stringify(newTags)) {
        updateData.tags = editData.tags || [];
      }
      const curDesc = processus.description ?? '';
      const newDesc = editData.description ?? '';
      if (curDesc !== newDesc) {
        updateData.description = newDesc;
      }

      // Mettre à jour les autres champs seulement s'il y a des changements
      if (Object.keys(updateData).length > 0) {
        await api.put(`/processus/${id}`, updateData);
      }

      setIsEditing(false);
      loadProcessus();
      loadHistory(1);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  const statuts = [
    { value: 'brouillon', label: 'Brouillon', color: 'bg-gray-100 text-gray-800' },
    { value: 'en_revision', label: 'En révision', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'valide', label: 'Validé', color: 'bg-blue-100 text-blue-800' },
    { value: 'actif', label: 'Actif', color: 'bg-green-100 text-green-800' },
    { value: 'archive', label: 'Archivé', color: 'bg-purple-100 text-purple-800' },
    { value: 'obsolete', label: 'Obsolète', color: 'bg-red-100 text-red-800' },
  ];

  const droitsAdminProcessus = 'consultation, modification, mise en corbeille, gestion des accès';

  const buildDocumentAccessRows = (doc: any) => {
    const map = new Map<string, { nom: string; role: string }>();
    const setRow = (userId: string | undefined, nom: string, role: string) => {
      if (!userId) return;
      map.set(userId, { nom, role });
    };
    (usersList || []).forEach((u: any) => {
      if (u.role === 'admin' && (!u.statut || u.statut === 'actif')) {
        setRow(
          u.id,
          `${u.prenom} ${u.nom}`,
          `Administrateur : ${droitsAdminProcessus}`
        );
      }
    });
    if (doc.uploadedBy?.id) {
      setRow(
        doc.uploadedBy.id,
        `${doc.uploadedBy.prenom} ${doc.uploadedBy.nom}`,
        'Auteur du document : dépôt, métadonnées et consultation'
      );
    }
    if (processus?.proprietaire?.id) {
      setRow(
        processus.proprietaire.id,
        `${processus.proprietaire.prenom} ${processus.proprietaire.nom}`,
        'Propriétaire du processus : accès au document confidentiel'
      );
    }
    if (processus?.createdBy?.id) {
      setRow(
        processus.createdBy.id,
        `${processus.createdBy.prenom} ${processus.createdBy.nom}`,
        'Créateur du processus : accès au document confidentiel'
      );
    }
    (doc.permissionsUtilisateurs || []).forEach((p: any) => {
      if (p.user?.id) {
        setRow(
          p.user.id,
          `${p.user.prenom} ${p.user.nom}`,
          'Accès explicite : consultation du document (confidentiel)'
        );
      }
    });
    return Array.from(map.entries()).map(([id, v]) => ({ id, nom: v.nom, role: v.role }));
  };

  const delegRowsProcessus = processus ? processusAccesDelegationsRows(processus) : [];
  const recapProcessusRows = processus
    ? buildProcessusRecapAccessRows(processus, delegRowsProcessus, usersList, droitsAdminProcessus)
    : [];

  if (loading) return <div className="p-6">Chargement...</div>;
  if (error && !processus) {
    return (
      <div className="p-6">
        <button
          onClick={() => navigate('/processus')}
          className="text-blue-600 hover:text-blue-800 mb-4"
        >
          ← Retour à la liste
        </button>
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-lg">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800 mb-2">
                Accès refusé
              </h3>
              <p className="text-sm text-yellow-700 whitespace-pre-line">
          {error}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!processus) return <div className="p-6">Processus non trouvé</div>;

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/processus')}
          className="text-blue-600 hover:text-blue-800 mb-4"
        >
          ← Retour à la liste
        </button>
        <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{processus.nom}</h1>
          <button
            onClick={handleToggleFavori}
            disabled={loadingFavori}
            className={`px-4 py-2 rounded-md transition-colors flex items-center gap-2 ${
              estFavori
                ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border border-yellow-300'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-300'
            } disabled:opacity-50`}
            title={estFavori ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          >
            <svg className="w-5 h-5" fill={estFavori ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <span className="text-sm font-medium">
              {estFavori ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            </span>
          </button>
        </div>
        <div className="text-gray-600 mt-2 space-y-1">
          <p>
            Code: {processus.codeProcessus}
            {canModifyCodeProcessus() && (
              <span className="ml-2 text-xs text-gray-500">(Modifiable)</span>
            )}
          </p>
          <p className="text-sm">
            Nombre de consultations: <span className="font-semibold text-blue-600">{processus.nombreConsultations || 0}</span>
          </p>
        </div>
      </div>

      {id && (
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <PvReunionsLieesBlock apiPath={`/processus/${id}/pv-reunions`} />
        </div>
      )}

      {/* Informations générales */}
      <div className="bg-white rounded-lg shadow mb-6 p-6">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold">Informations générales</h2>
          {!isEditing ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void openProcessusAccesModal()}
                className="px-4 py-2 bg-slate-100 text-slate-800 rounded hover:bg-slate-200 text-sm border border-slate-200"
              >
                🔐 Accès
              </button>
              {canModifyProcessus() && (
                <button
                  onClick={() => {
                    setIsEditing(true);
                    setTagsInput(editData.tags.join(', '));
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                >
                  Modifier
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsEditing(false);
                  if (processus) {
                    const tags = processus.tags || [];
                    setEditData({
                      codeProcessus: processus.codeProcessus || '',
                      statut: processus.statut || 'brouillon',
                      proprietaireId: processus.proprietaireId || '',
                      entiteIds: processus.entites?.map((pe: any) => pe.entite?.id || pe.entiteId).filter(Boolean) || [],
                      categorieIds: processus.categories?.map((pc: any) => pc.categorie?.id || pc.categorieId).filter(Boolean) || [],
                      tags: tags,
                      description: processus.description ?? '',
                    });
                    setTagsInput(tags.join(', '));
                  }
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {canModifyCodeProcessus() && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code processus</label>
                <input
                  type="text"
                  value={editData.codeProcessus}
                  onChange={(e) => setEditData({ ...editData, codeProcessus: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="PROC-001"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
              <select
                value={editData.statut}
                onChange={(e) => setEditData({ ...editData, statut: e.target.value })}
                disabled={isLecteur}
                className={`w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
                  isLecteur ? 'opacity-50 cursor-not-allowed bg-gray-100' : ''
                }`}
                title={isLecteur ? 'Les lecteurs ne peuvent pas modifier le statut' : ''}
              >
                {statuts.map((statut) => (
                  <option key={statut.value} value={statut.value}>
                    {statut.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Propriétaire</label>
              <select
                value={editData.proprietaireId}
                onChange={(e) => setEditData({ ...editData, proprietaireId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Sélectionner un propriétaire</option>
                {usersList
                  .filter((u) => u.role === 'admin' || u.role === 'contributeur')
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.prenom} {user.nom} ({user.email})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Entités</label>
              <select
                multiple
                value={editData.entiteIds}
                onChange={(e) => {
                  const selectedIds = Array.from(e.target.selectedOptions, option => option.value);
                  setEditData({ ...editData, entiteIds: selectedIds });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 min-h-[100px]"
                size={5}
              >
                {entitesList.map((entite) => (
                  <option key={entite.id} value={entite.id}>
                    {entite.nom} ({entite.code})
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Maintenez Ctrl (ou Cmd sur Mac) pour sélectionner plusieurs entités</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Catégories</label>
              <select
                multiple
                value={editData.categorieIds}
                onChange={(e) => {
                  const selectedIds = Array.from(e.target.selectedOptions, option => option.value);
                  setEditData({ ...editData, categorieIds: selectedIds });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 min-h-[100px]"
                size={5}
              >
                {categoriesList.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.nom}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Maintenez Ctrl (ou Cmd sur Mac) pour sélectionner plusieurs catégories</p>
            </div>
            {canModifyProcessus() && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={editData.description}
                  onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Description du processus…"
                />
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Statut</label>
              <div className="mt-1">
                <span className={`px-3 py-1 text-sm rounded ${
                  processus.statut === 'actif' ? 'bg-green-100 text-green-800' :
                  processus.statut === 'valide' ? 'bg-blue-100 text-blue-800' :
                  processus.statut === 'en_revision' ? 'bg-yellow-100 text-yellow-800' :
                  processus.statut === 'archive' ? 'bg-purple-100 text-purple-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {statuts.find(s => s.value === processus.statut)?.label || processus.statut}
                </span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Entités</label>
              <div className="mt-1">
                {processus.entites && processus.entites.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {processus.entites.map((pe: any) => (
                      <span
                        key={pe.entite?.id || pe.entiteId}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded"
                      >
                        {pe.entite?.nom || pe.entite?.code || 'N/A'}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">N/A</p>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Propriétaire</label>
              <p className="mt-1 text-sm">
                {processus.proprietaire ? `${processus.proprietaire.prenom} ${processus.proprietaire.nom}` : 'Non assigné'}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Catégories</label>
              <div className="mt-1">
                {processus.categories && processus.categories.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {processus.categories.map((pc: any) => (
                      <span
                        key={pc.categorie?.id || pc.categorieId}
                        className="px-2 py-1 text-xs rounded flex items-center gap-1"
                        style={{ 
                          backgroundColor: pc.categorie?.couleur ? `${pc.categorie.couleur}20` : '#E5E7EB',
                          color: pc.categorie?.couleur || '#374151',
                        }}
                      >
                        {pc.categorie?.icone && <span>{pc.categorie.icone}</span>}
                        <span>{pc.categorie?.nom || 'N/A'}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">N/A</p>
                )}
              </div>
            </div>
            {processus.createdBy && (
              <div>
                <label className="text-sm font-medium text-gray-500">Créé par</label>
                <p className="mt-1 text-sm">
                  {processus.createdBy.prenom} {processus.createdBy.nom}
                </p>
              </div>
            )}
            {processus.dateValidation && (
              <div>
                <label className="text-sm font-medium text-gray-500">Date de validation</label>
                <p className="mt-1 text-sm">
                  {new Date(processus.dateValidation).toLocaleDateString('fr-FR')}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-gray-200 pt-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">Accès au processus</h3>
          <div className="flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
            <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Qui a accès :</span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
              {(() => {
                const restreint = delegRowsProcessus.length > 0 || !!processus.createdById;
                return restreint ? (
                  <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                    <span className="text-sm leading-none" aria-hidden>
                      🔒
                    </span>
                    <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">
                      Accès restreint ou délégué
                    </span>
                  </div>
                ) : (
                  <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                    <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                  </div>
                );
              })()}
              <AccessContratLikeAdminLines
                users={usersList}
                createdById={processus.createdById}
                createdBy={processus.createdBy}
                adminSansAccesUserIds={processus.adminSansAccesUserIds}
                permissions={processusPermissionsForAdminLinesDetail(processus.permissions || [])}
                droitsAdminCompletLabel={droitsAdminProcessus}
                niveauLabel={(n) => n}
                keyPrefix={`proc-detail-${processus.id}`}
                creatorRightsLabel={droitsAdminProcessus}
              />
              {(processus.accesApercu?.delegations || []).map((d: any) => (
                <div
                  key={`${d.user?.id}-${(d.permissionEntryIds || []).join('-')}`}
                  className="min-w-0"
                >
                  <span className="font-medium text-gray-900">
                    {d.user.prenom} {d.user.nom}
                  </span>
                  <span className="text-gray-500 italic block sm:inline sm:ml-1">
                    ({permSummaryDelegProcessus(d.permissions || [])})
                  </span>
                </div>
              ))}
              {processus.proprietaire &&
                processus.proprietaireId &&
                processus.proprietaireId !== processus.createdById && (
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">
                      {processus.proprietaire.prenom} {processus.proprietaire.nom}
                    </span>
                    <span className="text-gray-500 italic block sm:inline sm:ml-1">
                      (Propriétaire du processus)
                    </span>
                  </div>
                )}
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Pour ajouter ou retirer des droits délégués, utilisez le bouton « Accès » ci-dessus ou sur la liste des
            processus.
          </p>
        </div>

        {/* Zone Description (lecture seule ; édition dans « Modifier ») */}
        {!isEditing && (
          <div className="mt-6">
            <label className="text-sm font-medium text-gray-500 block mb-2">Description</label>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 min-h-[100px]">
              {processus.description ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{processus.description}</p>
              ) : (
                <p className="text-sm text-gray-400 italic">Aucune description</p>
              )}
            </div>
          </div>
        )}

        {/* Zone Tags */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-500">Tags (mots-clés)</label>
            {canModifyTags() && !isEditing && (
              <button
                onClick={() => {
                  setIsEditing(true);
                  // Initialiser tagsInput avec les tags existants
                  setTagsInput(editData.tags.join(', '));
                }}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Modifier
              </button>
            )}
          </div>
          {isEditing && canModifyTags() ? (
            <div>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => {
                  setTagsInput(e.target.value);
                }}
                onBlur={() => {
                  // Traiter les tags quand on perd le focus
                  const tagsArray = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                  setEditData({ ...editData, tags: tagsArray });
                  setTagsInput(tagsArray.join(', '));
                }}
                onKeyDown={(e) => {
                  // Traiter les tags quand on appuie sur Entrée
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const tagsArray = tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
                    setEditData({ ...editData, tags: tagsArray });
                    setTagsInput(tagsArray.join(', '));
                  }
                }}
                placeholder="Saisir les tags séparés par des virgules (ex: qualité, ISO, sécurité)"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Séparez les tags par des virgules. Appuyez sur Entrée ou cliquez ailleurs pour valider.</p>
              {editData.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {editData.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded flex items-center gap-1"
                    >
                      {tag}
                      <button
                        onClick={() => {
                          const newTags = editData.tags.filter((_, i) => i !== index);
                          setEditData({ ...editData, tags: newTags });
                          setTagsInput(newTags.join(', '));
                        }}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              {processus.tags && processus.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {processus.tags.map((tag: string, index: number) => (
                    <span
                      key={index}
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">Aucun tag</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow mb-6">
        <div className="border-b border-gray-200">
          <div className="flex">
            <button className="px-6 py-3 border-b-2 border-blue-500 text-blue-600 font-medium">
              Documents
            </button>
          </div>
        </div>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Documents du processus</h2>
            {canModifyProcessus() && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                + Ajouter un document
              </button>
            )}
          </div>

          <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 leading-relaxed">
            <p className="font-semibold text-slate-800 mb-1">Deux niveaux d&apos;accès</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>
                <span className="font-medium">Processus</span> : droit d&apos;accéder au détail du processus
                (lecture, modification, suppression, gestion des accès selon les droits délégués).
              </li>
              <li>
                <span className="font-medium">Documents</span> : seuls les utilisateurs habilités sur le processus
                peuvent ouvrir ou télécharger un fichier ; les documents confidentiels imposent en plus une liste
                d&apos;accès au niveau du document.
              </li>
            </ul>
          </div>

          {documents.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Aucun document pour ce processus</p>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <div key={doc.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-medium">{doc.nom}</h3>
                      <p className="text-sm text-gray-600 mt-1">{doc.description || 'Pas de description'}</p>
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                        <span>Version: {doc.version || '1.0.0'}</span>
                        <span>Taille: {(doc.fichierTaille / 1024).toFixed(2)} Ko</span>
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          {doc.nombreVisualisations || 0} vue{doc.nombreVisualisations !== 1 ? 's' : ''}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          {doc.nombreTelechargements || 0} téléchargement{doc.nombreTelechargements !== 1 ? 's' : ''}
                        </span>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-600">Statut:</label>
                          <select
                            value={doc.statut || 'brouillon'}
                            onChange={(e) => handleDocumentStatusChange(doc.id, e.target.value)}
                            disabled={isLecteur || updatingDocStatus === doc.id || !canModifyDocument(doc)}
                            className={`px-2 py-1 rounded text-xs border border-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                              doc.statut === 'valide' ? 'bg-green-100 text-green-800' :
                              doc.statut === 'en_revision' ? 'bg-yellow-100 text-yellow-800' :
                              doc.statut === 'archive' ? 'bg-purple-100 text-purple-800' :
                              'bg-gray-100 text-gray-800'
                            } ${(isLecteur || updatingDocStatus === doc.id || !canModifyDocument(doc)) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                            title={isLecteur ? 'Les lecteurs ne peuvent pas modifier le statut' : (!canModifyDocument(doc) && doc.estConfidentiel ? 'Vous n\'avez pas accès à ce document confidentiel' : '')}
                          >
                            {documentStatuts.map((statut) => (
                              <option key={statut.value} value={statut.value}>
                                {statut.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {doc.estConfidentiel ? (
                          <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-xs font-medium">
                            🔒 Confidentiel
                          </span>
                        ) : (
                          <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-medium">
                            🌐 Non confidentiel
                          </span>
                        )}
                      </div>
                      <div className="mt-3 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                          Accès au document
                        </p>
                        <div className="flex flex-wrap items-start gap-3">
                          {doc.estConfidentiel ? (
                            <>
                              <div className="flex flex-col items-center shrink-0">
                                <div className="w-12 h-12 bg-red-100 border border-red-200 rounded-lg flex items-center justify-center text-lg">
                                  🔒
                                </div>
                                <span className="text-[10px] font-semibold text-red-700 mt-1 text-center">
                                  Restreint
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-gray-600 mb-2 leading-relaxed">
                                  {isNativeProcessusConfidentialUploadDoc(doc) ? (
                                    <>
                                      Pièce déposée sur le processus — alignée sur la modale « Accès » (exclusions admin,
                                      accès explicites). La liste ci-dessous se met à jour après enregistrement.
                                    </>
                                  ) : (
                                    <>
                                      Document confidentiel : personnes habilitées à consulter ce fichier et rôle indiqué
                                      (aligné sur la fiche projet / les tâches).
                                    </>
                                  )}
                                </p>
                                <div className="space-y-1.5 text-xs text-gray-700">
                                  {isNativeProcessusConfidentialUploadDoc(doc) ? (
                                    <>
                                      <AccessContratLikeAdminLines
                                        keyPrefix={`proc-doc-${doc.id}-natif`}
                                        users={usersList}
                                        createdById={doc.uploadedById}
                                        createdBy={doc.uploadedBy}
                                        adminSansAccesUserIds={doc.adminSansAccesUserIds}
                                        permissions={(doc.permissionsUtilisateurs || [])
                                          .filter((p: any) => p.user?.role === 'admin')
                                          .map((p: any) => ({
                                            userId: p.userId || p.user?.id,
                                            niveau: 'lecture',
                                            user: p.user,
                                          }))}
                                        droitsAdminCompletLabel={DROITS_ADMIN_DOC_NATIF_PROCESSUS}
                                        creatorRightsLabel="auteur — tous les droits sur ce document"
                                        niveauLabel={() => 'Lecture'}
                                        limitedPrefix="Admin : accès limité —"
                                      />
                                      {(doc.permissionsUtilisateurs || [])
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
                                    </>
                                  ) : (
                                    buildDocumentAccessRows(doc).map((row) => (
                                      <div
                                        key={row.id}
                                        className="flex flex-wrap items-baseline gap-x-1 border-b border-gray-200/80 pb-1.5 last:border-0"
                                      >
                                        <span className="font-medium text-gray-900">{row.nom}</span>
                                        <span className="text-gray-500 italic">({row.role})</span>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex flex-col items-center shrink-0">
                                <div className="w-12 h-12 bg-green-100 border border-green-200 rounded-lg flex items-center justify-center text-lg">
                                  🌐
                                </div>
                                <span className="text-[10px] font-semibold text-green-800 mt-1 text-center">
                                  Libre
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 flex-1 leading-relaxed">
                                Ce document n&apos;est pas confidentiel : l&apos;accès en lecture suit les règles du
                                processus (statut, droits délégués sur le processus, rôle applicatif). Les
                                administrateurs conservent un accès technique étendu.
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 border-t border-gray-200 pt-3">
                        <p className="text-sm font-medium text-gray-700 mb-3">Historique des versions:</p>
                        <div className="space-y-2">
                          {/* Version actuelle */}
                          <div className="flex items-center justify-between bg-blue-50 p-2 rounded border border-blue-200">
                            <div className="flex-1">
                              <span className="text-sm font-medium text-blue-800">
                                Version actuelle: {doc.version || '1.0.0'}
                              </span>
                              <span className="text-xs text-gray-500 ml-2">
                                ({new Date(doc.createdAt).toLocaleDateString('fr-FR')})
                              </span>
                              <p className="text-xs text-gray-500 mt-1">
                                Par {doc.uploadedBy?.prenom} {doc.uploadedBy?.nom}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDownload(doc)}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                              Télécharger
                            </button>
                          </div>
                          {/* Anciennes versions */}
                          {doc.versions && doc.versions.length > 0 && doc.versions.map((version: any) => (
                            <div key={version.id} className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200">
                              <div className="flex-1">
                                <span className="text-sm font-medium text-gray-700">
                                  Version {version.version}
                                </span>
                                <span className="text-xs text-gray-500 ml-2">
                                  ({new Date(version.createdAt).toLocaleDateString('fr-FR')})
                                </span>
                                {version.commentaireVersion && (
                                  <p className="text-xs text-gray-600 mt-1 italic">
                                    {version.commentaireVersion}
                                  </p>
                                )}
                                <p className="text-xs text-gray-500 mt-1">
                                  Par {version.uploadedBy?.prenom} {version.uploadedBy?.nom}
                                </p>
                              </div>
                              <button
                                onClick={() => handleDownloadVersion(doc.id, version.id, version.version, doc.fichierNomOriginal)}
                                className="px-2 py-1 text-xs bg-gray-600 text-white rounded hover:bg-gray-700"
                              >
                                Télécharger
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleViewDocument(doc)}
                        className="px-3 py-1 text-sm bg-blue-100 hover:bg-blue-200 rounded text-blue-700"
                        title="Visualiser le document"
                      >
                        Visualiser
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                        title="Télécharger la version actuelle"
                      >
                        Télécharger
                      </button>
                      {canModifierAccesDocument(doc) && (
                        <button
                          type="button"
                          onClick={() => void openDocumentAccesModal(doc)}
                          className="px-3 py-1 text-sm bg-purple-100 hover:bg-purple-200 rounded text-purple-800"
                          title="Gérer les accès au document"
                        >
                          🔐 Accès
                        </button>
                      )}
                      {!isLecteur && (
                        <button
                          onClick={() => handleEditDocument(doc)}
                          disabled={!canModifyDocument(doc)}
                          className={`px-3 py-1 text-sm rounded ${
                            canModifyDocument(doc)
                              ? 'bg-yellow-100 hover:bg-yellow-200'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                          title={canModifyDocument(doc) ? 'Modifier le document' : 'Vous n\'avez pas accès à ce document confidentiel'}
                        >
                          Modifier
                        </button>
                      )}
                      {!isLecteur && (
                        <button
                          onClick={() => setShowVersionModal(doc.id)}
                          disabled={!canDeleteOrAddVersion(doc)}
                          className={`px-3 py-1 text-sm rounded ${
                            canDeleteOrAddVersion(doc)
                              ? 'bg-blue-100 hover:bg-blue-200'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                          title={canDeleteOrAddVersion(doc) ? 'Ajouter une nouvelle version' : 'Seuls les utilisateurs autorisés peuvent ajouter une version à ce document confidentiel'}
                        >
                          Nouvelle version
                        </button>
                      )}
                      {!isLecteur && (
                        <button
                          onClick={() => handleDeleteDocument(doc.id, doc.nom)}
                          disabled={!canDeleteOrAddVersion(doc)}
                          className={`px-3 py-1 text-sm rounded ${
                            canDeleteOrAddVersion(doc)
                              ? 'bg-red-100 hover:bg-red-200'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                          title={canDeleteOrAddVersion(doc) ? 'Supprimer le document' : 'Seuls les utilisateurs autorisés peuvent supprimer ce document confidentiel'}
                        >
                          Supprimer
                        </button>
                      )}
                    </div>
                  </div>
              {/* Commentaires */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-sm font-semibold mb-2">Commentaires</p>
                {(docComments[doc.id] || []).length === 0 ? (
                  <p className="text-sm text-gray-500">Aucun commentaire</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {(docComments[doc.id] || []).map((c) => (
                      <div key={c.id} className="text-sm bg-gray-50 border border-gray-200 rounded p-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{c.user?.prenom} {c.user?.nom}</span>
                          <span className="text-xs text-gray-500">{new Date(c.createdAt).toLocaleString('fr-FR')}</span>
                        </div>
                        {c.contenu && (
                        <p className="mt-1 text-gray-700 whitespace-pre-wrap">{c.contenu}</p>
                        )}
                        {c.pieceJointeNom && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-gray-600">📎 Pièce jointe:</span>
                            <button
                              onClick={() => handleDownloadAttachment(c.id, c.pieceJointeNom)}
                              className="text-xs text-blue-600 hover:text-blue-800 underline"
                            >
                              {c.pieceJointeNom}
                              {c.pieceJointeTaille && (
                                <span className="ml-1 text-gray-500">
                                  ({(c.pieceJointeTaille / 1024).toFixed(1)} KB)
                                </span>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!isLecteur && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                  <input
                    type="text"
                    value={newComment[doc.id] || ''}
                    onChange={(e) => setNewComment({ ...newComment, [doc.id]: e.target.value })}
                    placeholder="Écrire un commentaire..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded"
                  />
                      <label className="px-3 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 cursor-pointer text-sm flex items-center">
                        📎
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            setCommentAttachments({ ...commentAttachments, [doc.id]: file });
                          }}
                        />
                      </label>
                  <button
                    onClick={() => handleAddComment(doc.id)}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Publier
                  </button>
                </div>
                    {commentAttachments[doc.id] && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span>📎 {commentAttachments[doc.id]?.name}</span>
                        <button
                          onClick={() => setCommentAttachments({ ...commentAttachments, [doc.id]: null })}
                          className="text-red-600 hover:text-red-800"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal upload document */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-auto">
            <div className="p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Ajouter des documents</h2>
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    setError('');
                    setFiles([]);
                    setFileNames({});
                    setUploadData({ nom: '', description: '', estConfidentiel: false, versionMajeure: '1', versionMineure: '0', versionPatch: '0' });
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
                    Fichiers <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="file"
                    required
                    multiple
                    onChange={handleFileChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                  <p className="text-xs text-gray-500 mt-1">Vous pouvez sélectionner plusieurs fichiers</p>
                  
                  {files.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm font-medium text-gray-700">Fichiers sélectionnés ({files.length})</p>
                      {files.map((file) => (
                        <div key={file.name} className="flex items-center justify-between bg-gray-50 p-2 rounded border border-gray-200">
                          <div className="flex-1">
                            <input
                              type="text"
                              value={fileNames[file.name] || file.name}
                              onChange={(e) => setFileNames({ ...fileNames, [file.name]: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                              placeholder="Nom du document"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                              {(file.size / 1024).toFixed(2)} Ko - {file.type || 'Type inconnu'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(file.name)}
                            className="ml-2 text-red-600 hover:text-red-800"
                            title="Retirer ce fichier"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="1"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="0"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  Version complète: {uploadData.versionMajeure}.{uploadData.versionMineure}.{uploadData.versionPatch}
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={uploadData.estConfidentiel}
                      disabled={!canSetConfidentiel}
                      onChange={(e) => {
                        setUploadData({ ...uploadData, estConfidentiel: e.target.checked });
                        if (!e.target.checked) {
                          setPermissionUserIds([]);
                        }
                      }}
                      className="mr-2"
                    />
                    <span className={`text-sm ${!canSetConfidentiel ? 'text-gray-400' : 'text-gray-700'}`}>
                      Document confidentiel
                      {!canSetConfidentiel && ' (Seul le propriétaire ou le créateur du processus peut définir un document comme confidentiel)'}
                    </span>
                  </label>
                </div>

                {uploadData.estConfidentiel && canSetConfidentiel && (
                  <div>
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
                      required={uploadData.estConfidentiel}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md min-h-[120px]"
                      size={5}
                    >
                      {usersList.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.prenom} {user.nom} ({user.email})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Sélectionnez un ou plusieurs utilisateurs autorisés à visualiser ce document. Utilisez Ctrl (Cmd sur Mac) pour sélectionner plusieurs utilisateurs.
                    </p>
                    {permissionUserIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {permissionUserIds.map((userId) => {
                          const user = usersList.find(u => u.id === userId);
                          return user ? (
                            <span
                              key={userId}
                              className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs flex items-center gap-1"
                            >
                              {user.prenom} {user.nom}
                              <button
                                type="button"
                                onClick={() => setPermissionUserIds(permissionUserIds.filter(id => id !== userId))}
                                className="text-blue-600 hover:text-blue-800"
                              >
                                ×
                              </button>
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                    {uploadData.estConfidentiel && permissionUserIds.length === 0 && (
                      <p className="text-xs text-red-500 mt-1">
                        Au moins un utilisateur doit être sélectionné pour un document confidentiel
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowUploadModal(false);
                      setError('');
                      setFiles([]);
                      setFileNames({});
                      setPermissionUserIds([]);
                      setUploadData({ nom: '', description: '', estConfidentiel: false, versionMajeure: '1', versionMineure: '0', versionPatch: '0' });
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {uploading ? `Upload en cours... (${files.length} fichier${files.length > 1 ? 's' : ''})` : `Ajouter ${files.length > 0 ? `${files.length} document${files.length > 1 ? 's' : ''}` : 'document'}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal nouvelle version */}
      {showVersionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Nouvelle version</h2>
                <button
                  onClick={() => setShowVersionModal(null)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={(e) => handleVersionUpload(showVersionModal, e)} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nouveau fichier <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="file"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Commentaire de version
                  </label>
                  <textarea
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Décrivez les changements de cette version..."
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowVersionModal(null)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Ajouter version
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal modification document */}
      {showEditModal && editingDocument && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-auto">
            <div className="p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Modifier le document</h2>
                <button
                  onClick={() => {
                    setShowEditModal(null);
                    setEditingDocument(null);
                    setEditDocumentData({ nom: '', description: '', estConfidentiel: false });
                    setEditPermissionUserIds([]);
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handleSaveDocumentEdit(); }} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editDocumentData.nom}
                    onChange={(e) => setEditDocumentData({ ...editDocumentData, nom: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={editDocumentData.description}
                    onChange={(e) => setEditDocumentData({ ...editDocumentData, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editDocumentData.estConfidentiel}
                      disabled={!canSetConfidentiel}
                      onChange={(e) => {
                        setEditDocumentData({ ...editDocumentData, estConfidentiel: e.target.checked });
                        if (!e.target.checked) {
                          setEditPermissionUserIds([]);
                        }
                      }}
                      className="mr-2"
                    />
                    <span className={`text-sm ${!canSetConfidentiel ? 'text-gray-400' : 'text-gray-700'}`}>
                      Document confidentiel
                      {!canSetConfidentiel && ' (Seul le propriétaire ou le créateur du processus peut définir un document comme confidentiel)'}
                    </span>
                  </label>
                </div>

                {editDocumentData.estConfidentiel && canSetConfidentiel && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Utilisateurs autorisés <span className="text-red-500">*</span>
                    </label>
                    <select
                      multiple
                      value={editPermissionUserIds}
                      onChange={(e) => {
                        const selected = Array.from(e.target.selectedOptions, option => option.value);
                        setEditPermissionUserIds(selected);
                      }}
                      required={editDocumentData.estConfidentiel}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md min-h-[120px]"
                      size={5}
                    >
                      {usersList.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.prenom} {user.nom} ({user.email})
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Sélectionnez un ou plusieurs utilisateurs autorisés à visualiser ce document. Utilisez Ctrl (Cmd sur Mac) pour sélectionner plusieurs utilisateurs.
                    </p>
                    {editPermissionUserIds.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {editPermissionUserIds.map((userId) => {
                          const user = usersList.find(u => u.id === userId);
                          return user ? (
                            <span
                              key={userId}
                              className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs flex items-center gap-1"
                            >
                              {user.prenom} {user.nom}
                              <button
                                type="button"
                                onClick={() => setEditPermissionUserIds(editPermissionUserIds.filter(id => id !== userId))}
                                className="text-blue-600 hover:text-blue-800"
                              >
                                ×
                              </button>
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                    {editDocumentData.estConfidentiel && editPermissionUserIds.length === 0 && (
                      <p className="text-xs text-red-500 mt-1">
                        Au moins un utilisateur doit être sélectionné pour un document confidentiel
                      </p>
                    )}
                  </div>
                )}

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                  onClick={() => {
                    setShowEditModal(null);
                    setEditingDocument(null);
                    setEditDocumentData({ nom: '', description: '', estConfidentiel: false });
                    setEditPermissionUserIds([]);
                  }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showProcAccesModal && processus && id && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {processus.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Le <span className="font-medium">créateur</span>, le <span className="font-medium">propriétaire</span> du
              processus et les utilisateurs avec la permission <span className="font-medium">« Gestion des accès »</span>{' '}
              peuvent gérer les droits. Pour un administrateur : sans ligne dans « Accès partagés » et sans exclusion, accès
              complet ; une ligne limite les droits ; « Retirer l&apos;accès » retire tout accès jusqu&apos;à octroi via «
              Accorder un accès » ; « Rétablir l&apos;accès admin par défaut » annule une exclusion.
            </p>
            {procAccesDetail && !procAccesDetail.canManagePermissions && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant que créateur,
                propriétaire ou avec la permission « Gestion des accès ».
              </p>
            )}
            {procAccesLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : procAccesDetail ? (
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
                  <p className="text-xs text-gray-500 mb-2">
                    Limitez un admin avec « Limiter l&apos;accès », retirez-le entièrement avec « Retirer l&apos;accès », ou
                    rétablissez l&apos;accès complet implicite s&apos;il était exclu.
                  </p>
                  <ul className="space-y-3 text-gray-700 text-sm">
                    {(procAccesDetail.admins || []).map((a: any) => {
                      const userDelegations = (procAccesDetail.delegations || []).filter((d: any) => d.user?.id === a.id);
                      const primaryDelegation = userDelegations[0];
                      const explicite = userDelegations.length > 0;
                      const isPrivilegedAdmin =
                        procAccesDetail.creator?.id === a.id || processus.proprietaireId === a.id;
                      const refuse = (procAccesDetail.adminSansAccesUserIds || []).includes(a.id);
                      return (
                        <li
                          key={a.id}
                          className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 bg-white"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-base">
                              {a.prenom} {a.nom}
                            </span>
                            <span className="text-gray-500 ml-1">({a.email})</span>
                            {refuse && !explicite && (
                              <span className="text-red-700 block sm:inline sm:ml-1 text-xs font-medium">
                                — aucun accès (exclu ; accorder un accès via la liste ci-dessous pour le réintégrer)
                              </span>
                            )}
                            {!refuse && !explicite && (
                              <span className="text-gray-400 block sm:inline sm:ml-1">
                                — accès complet (défaut administrateur)
                              </span>
                            )}
                            {explicite && (
                              <span className="text-amber-800 block sm:inline sm:ml-1 text-xs font-medium">
                                — accès limité (ligne « Accès partagés »)
                              </span>
                            )}
                          </div>
                          {procAccesDetail.canManagePermissions && !isPrivilegedAdmin && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {refuse && !explicite ? (
                                <button
                                  type="button"
                                  onClick={() => void handleProcRestoreAdminDefault(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !explicite ? (
                                <>
                                  <select
                                    value={procAccesAdminLimitPerm[a.id] ?? 'lecture'}
                                    onChange={(e) =>
                                      setProcAccesAdminLimitPerm((prev) => ({ ...prev, [a.id]: e.target.value }))
                                    }
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {PROC_PERM_OPTIONS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void quickLimitProcAdmin(a.id)}
                                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                  >
                                    Limiter l&apos;accès
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleProcRevokeAdminImplicit(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Retirer l&apos;accès
                                  </button>
                                </>
                              ) : (
                                <>
                                  <select
                                    value={primaryDelegation?.permission ?? 'lecture'}
                                    onChange={(e) => {
                                      const permission = e.target.value;
                                      if (!id || permission === primaryDelegation?.permission) return;
                                      void replaceProcAdminPermissionLevel(a.id, permission);
                                    }}
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {PROC_PERM_OPTIONS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void revokeAllProcDelegationsForUser(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Révoquer l&apos;accès
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {procAccesDetail.canManagePermissions && isPrivilegedAdmin && (
                            <span className="text-xs text-gray-500">
                              Créateur ou propriétaire : accès complet, non modérable ici.
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Créateur</p>
                  {procAccesDetail.creator ? (
                    <p>
                      <span className="font-medium">
                        {procAccesDetail.creator.prenom} {procAccesDetail.creator.nom}
                      </span>
                      <span className="text-gray-400"> — droits étendus et gestion des accès (si habilité)</span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Créateur non résolu (processus système ou sans créateur).</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès partagés</p>
                  {(procAccesDetail.delegations || []).length === 0 ? (
                    <p className="text-gray-400 text-xs italic">Aucun accès délégué</p>
                  ) : (
                    <ul className="space-y-2">
                      {(procAccesDetail.delegations || []).map((d: any) => (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
                        >
                          <span className="font-medium">
                            {d.user.prenom} {d.user.nom}
                            {d.user.role === 'admin' && (
                              <span className="text-xs font-normal text-gray-500 ml-1">(admin)</span>
                            )}
                          </span>
                          {d.grantedBy && (
                            <span className="text-xs text-gray-400">
                              par {d.grantedBy.prenom} {d.grantedBy.nom}
                            </span>
                          )}
                          {procAccesDetail.canManagePermissions ? (
                            <>
                              <select
                                value={d.permission}
                                onChange={(e) => {
                                  const permission = e.target.value;
                                  if (!id || permission === d.permission) return;
                                  void replaceProcAdminPermissionLevel(d.user.id, permission);
                                }}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {PROC_PERM_OPTIONS.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => void handleProcRemovePermissionEntry(d.id, d.user?.role === 'admin')}
                                className="text-xs text-red-600 hover:underline ml-auto"
                              >
                                {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-500">
                              — {PROC_PERM_LABELS[d.permission] || d.permission}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {procAccesDetail.canManagePermissions && (
                  <div className="border-t border-gray-200 pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accorder un accès</p>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end">
                      <select
                        value={procAccesNewUserId}
                        onChange={(e) => setProcAccesNewUserId(e.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">— Utilisateur —</option>
                        {(() => {
                          const actifs = usersList.filter(
                            (u: any) =>
                              (!u.statut || u.statut === 'actif') &&
                              u.id !== procAccesDetail.creator?.id &&
                              u.id !== processus.proprietaireId
                          );
                          const adminsPick = actifs.filter((u: any) => u.role === 'admin');
                          const autresPick = actifs.filter((u: any) => u.role !== 'admin');
                          return (
                            <>
                              {adminsPick.length > 0 && (
                                <optgroup label="Administrateurs">
                                  {adminsPick.map((u: any) => (
                                    <option key={u.id} value={u.id}>
                                      {u.prenom} {u.nom} — {u.email}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {autresPick.length > 0 && (
                                <optgroup label="Autres utilisateurs">
                                  {autresPick.map((u: any) => (
                                    <option key={u.id} value={u.id}>
                                      {u.prenom} {u.nom} — {u.email}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </>
                          );
                        })()}
                      </select>
                      <select
                        value={procAccesNewPermType}
                        onChange={(e) => setProcAccesNewPermType(e.target.value)}
                        className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        {PROC_PERM_OPTIONS.map((n) => (
                          <option key={n.value} value={n.value}>
                            {n.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleProcAddPermission()}
                        disabled={!procAccesNewUserId}
                        className="w-full lg:w-auto px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0"
                      >
                        Ajouter
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowProcAccesModal(false);
                  setProcAccesDetail(null);
                }}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {showProcDocContratAccesModal && procDocContratAcces && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {procDocContratAcces.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              <span className="font-medium">Seul l&apos;auteur du dépôt</span> peut gérer les accès. Pour un administrateur
              : sans ligne dans « Accès partagés » et sans exclusion, accès complet sur la pièce ; une ligne limite à la
              lecture ; « Retirer l&apos;accès » le prive totalement jusqu&apos;à un accès explicite ou « Rétablir l&apos;accès
              admin par défaut » (identique à la gestion sur la liste des processus).
            </p>
            {procDocContratAccesDetail && !procDocContratAccesDetail.canManagePermissions && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant qu&apos;auteur du
                document.
              </p>
            )}
            {procDocContratAccesLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : procDocContratAccesDetail ? (
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
                  <ul className="space-y-3 text-gray-700 text-sm">
                    {(procDocContratAccesDetail.admins || []).map((a: any) => {
                      const userDelegations = (procDocContratAccesDetail.delegations || []).filter(
                        (d: any) => d.user?.id === a.id
                      );
                      const primaryDelegation = userDelegations[0];
                      const explicite = userDelegations.length > 0;
                      const isCreatorAdmin = procDocContratAccesDetail.creator?.id === a.id;
                      const refuse = (procDocContratAccesDetail.adminSansAccesUserIds || []).includes(a.id);
                      return (
                        <li
                          key={a.id}
                          className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 bg-white"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-base">
                              {a.prenom} {a.nom}
                            </span>
                            <span className="text-gray-500 ml-1">({a.email})</span>
                            {refuse && !explicite && (
                              <span className="text-red-700 block sm:inline sm:ml-1 text-xs font-medium">
                                — aucun accès (exclu ; accorder un accès via la liste ci-dessous pour le réintégrer)
                              </span>
                            )}
                            {!refuse && !explicite && (
                              <span className="text-gray-400 block sm:inline sm:ml-1">
                                — accès complet (défaut administrateur)
                              </span>
                            )}
                            {explicite && (
                              <span className="text-amber-800 block sm:inline sm:ml-1 text-xs font-medium">
                                — accès limité (liste explicite — lecture)
                              </span>
                            )}
                          </div>
                          {procDocContratAccesDetail.canManagePermissions && !isCreatorAdmin && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {refuse && !explicite ? (
                                <button
                                  type="button"
                                  onClick={() => void handleProcDocRestoreAdmin(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !explicite ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleProcDocQuickLimitAdmin(a.id)}
                                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                  >
                                    Limiter l&apos;accès (lecture)
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleProcDocRevokeAdminImplicit(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Retirer l&apos;accès
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleProcDocRemovePermissionRow(primaryDelegation.id, a.role === 'admin')
                                  }
                                  className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                >
                                  Révoquer l&apos;accès
                                </button>
                              )}
                            </div>
                          )}
                          {procDocContratAccesDetail.canManagePermissions && isCreatorAdmin && (
                            <span className="text-xs text-gray-500">
                              Auteur du document : accès complet, non modérable ici.
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Auteur du document</p>
                  {procDocContratAccesDetail.creator ? (
                    <p>
                      <span className="font-medium">
                        {procDocContratAccesDetail.creator.prenom} {procDocContratAccesDetail.creator.nom}
                      </span>
                      <span className="text-gray-400">
                        {' '}
                        — seul habilité à gérer les accès de cette pièce
                      </span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Auteur non résolu.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès partagés</p>
                  {(procDocContratAccesDetail.delegations || []).length === 0 ? (
                    <p className="text-gray-400 text-xs italic">Aucun accès délégué</p>
                  ) : (
                    <ul className="space-y-2">
                      {(procDocContratAccesDetail.delegations || []).map((d: any) => (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
                        >
                          <span className="font-medium">
                            {d.user.prenom} {d.user.nom}
                            {d.user.role === 'admin' && (
                              <span className="text-xs font-normal text-gray-500 ml-1">(admin)</span>
                            )}
                          </span>
                          <span className="text-gray-500 text-sm">— lecture</span>
                          {procDocContratAccesDetail.canManagePermissions && (
                            <button
                              type="button"
                              onClick={() => void handleProcDocRemovePermissionRow(d.id, d.user?.role === 'admin')}
                              className="text-xs text-red-600 hover:underline ml-auto"
                            >
                              {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {procDocContratAccesDetail.canManagePermissions && (
                  <div className="border-t border-gray-200 pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accorder un accès</p>
                    <div className="flex flex-wrap items-end gap-3">
                      <select
                        value={procDocContratNewPermUserId}
                        onChange={(e) => setProcDocContratNewPermUserId(e.target.value)}
                        className="min-w-[12rem] border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">— Utilisateur —</option>
                        {usersList
                          .filter(
                            (u: any) =>
                              (!u.statut || u.statut === 'actif') && u.id !== procDocContratAccesDetail.creator?.id
                          )
                          .map((u: any) => (
                            <option key={u.id} value={u.id}>
                              {u.prenom} {u.nom} {u.role === 'admin' ? '(admin)' : ''}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleProcDocAddSharedPermission()}
                        disabled={!procDocContratNewPermUserId}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        Ajouter
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Impossible de charger le détail.</p>
            )}
            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={closeProcDocContratAccesModal}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {docAccesModalDoc && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 my-auto p-6">
            <h2 className="text-lg font-semibold mb-1">🔑 Modifier l&apos;accès — {docAccesModalDoc.nom}</h2>
            <p className="text-xs text-gray-500 mb-4">
              Document rattaché au processus : les utilisateurs doivent déjà avoir accès au processus pour ouvrir le
              fichier.
            </p>
            <div className="space-y-4">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={docAccesEstConfidentiel}
                  disabled={!canSetConfidentiel}
                  onChange={(e) => {
                    setDocAccesEstConfidentiel(e.target.checked);
                    if (!e.target.checked) setDocAccesPermissionUserIds([]);
                  }}
                  className="mt-1"
                />
                <span className={`text-sm ${!canSetConfidentiel ? 'text-gray-400' : 'text-gray-700'}`}>
                  Accès restreint (document confidentiel)
                  {!canSetConfidentiel &&
                    ' (Seul le propriétaire ou le créateur du processus peut activer ou désactiver la confidentialité.)'}
                </span>
              </label>
              {docAccesEstConfidentiel && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Utilisateurs autorisés</label>
                  <select
                    multiple
                    value={docAccesPermissionUserIds}
                    onChange={(e) =>
                      setDocAccesPermissionUserIds(Array.from(e.target.selectedOptions, (o) => o.value))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm min-h-[140px]"
                    size={6}
                  >
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.prenom} {u.nom}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">
                    Ctrl (Cmd sur Mac) pour sélectionner plusieurs utilisateurs
                  </p>
                  {docAccesPermissionUserIds.length === 0 && (
                    <p className="text-xs text-red-500 mt-1">Au moins un utilisateur requis si le document est confidentiel</p>
                  )}
                </div>
              )}
              {!docAccesEstConfidentiel && (
                <p className="text-sm text-green-600">
                  Sans confidentialité au niveau document, l&apos;accès lecture suit les règles du processus.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={closeDocumentAccesModal}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDocumentAccesModal()}
                disabled={docAccesEstConfidentiel && docAccesPermissionUserIds.length === 0}
                className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700 disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recap accès — au-dessus de l'historique */}
      {processus && (
        <div className="bg-white rounded-lg shadow mb-6 print:hidden">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-1 text-gray-900">Recap Accès</h2>
            <p className="text-xs text-gray-500 mb-5">
              Synthèse des habilitations sur ce processus et sur les fichiers rattachés. La gestion des droits délégués
              sur le processus se fait via le bouton « Accès » en haut de la fiche ou depuis la liste des processus.
            </p>

            <h3 className="text-sm font-semibold text-gray-800 mb-2">Accès au processus</h3>
            {recapProcessusRows.length === 0 ? (
              <p className="text-sm text-gray-500 mb-6">
                Aucune entrée (processus sans restriction explicite côté utilisateurs chargés).
              </p>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-lg mb-6">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Utilisateur</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">Rôles / droits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recapProcessusRows.map((row) => (
                      <tr key={row.userId} className="bg-white">
                        <td className="px-3 py-2 font-medium text-gray-900 align-top">{row.utilisateur}</td>
                        <td className="px-3 py-2 text-gray-700 align-top">{row.roles}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className="text-sm font-semibold text-gray-800 mb-2">Accès aux documents</h3>
            {documents.length === 0 ? (
              <p className="text-sm text-gray-500">Aucun document rattaché à ce processus.</p>
            ) : (
              <div className="space-y-4">
                {documents.map((doc) => {
                  const docRows = buildDocumentAccessRows(doc);
                  const nativeProcDoc = isNativeProcessusConfidentialUploadDoc(doc);
                  return (
                    <div key={doc.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h4 className="font-medium text-gray-900 text-sm">{doc.nom}</h4>
                        {doc.estConfidentiel ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                            Confidentiel
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Non confidentiel
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 mb-3">
                        {doc.estConfidentiel
                          ? nativeProcDoc
                            ? 'Document natif processus : exclusions administrateur et accès explicites (comme la section Documents du processus).'
                            : 'Liste des personnes pouvant consulter ce fichier (et rôles effectifs affichés dans la fiche document).'
                          : 'Accès en lecture aligné sur les habilitations processus ; la liste ci-dessous reprend notamment administrateurs, auteur et gouvernance sur la fiche.'}
                      </p>
                      {nativeProcDoc ? (
                        <div className="border border-gray-100 rounded-md bg-white p-3 text-xs text-gray-700 space-y-1">
                          <AccessContratLikeAdminLines
                            keyPrefix={`recap-doc-${doc.id}`}
                            users={usersList}
                            createdById={doc.uploadedById}
                            createdBy={doc.uploadedBy}
                            adminSansAccesUserIds={doc.adminSansAccesUserIds}
                            permissions={(doc.permissionsUtilisateurs || [])
                              .filter((p: any) => p.user?.role === 'admin')
                              .map((p: any) => ({
                                userId: p.userId || p.user?.id,
                                niveau: 'lecture',
                                user: p.user,
                              }))}
                            droitsAdminCompletLabel={DROITS_ADMIN_DOC_NATIF_PROCESSUS}
                            creatorRightsLabel="auteur — tous les droits sur ce document"
                            niveauLabel={() => 'Lecture'}
                            limitedPrefix="Admin : accès limité —"
                          />
                          {(doc.permissionsUtilisateurs || [])
                            .filter((p: any) => p.user && p.user.role !== 'admin')
                            .map((p: any) => (
                              <div key={p.id}>
                                <span className="font-medium text-gray-900">
                                  {p.user.prenom} {p.user.nom}
                                </span>
                                <span className="text-gray-500 italic ml-1">(Accès explicite : lecture)</span>
                              </div>
                            ))}
                        </div>
                      ) : docRows.length === 0 ? (
                        <p className="text-xs text-gray-500 italic">Aucune ligne d&apos;accès détaillée.</p>
                      ) : (
                        <div className="overflow-x-auto border border-gray-100 rounded-md bg-white">
                          <table className="min-w-full text-xs">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium text-gray-600">Utilisateur</th>
                                <th className="px-3 py-2 text-left font-medium text-gray-600">Rôle / droits</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {docRows.map((dr) => (
                                <tr key={dr.id}>
                                  <td className="px-3 py-2 font-medium text-gray-900 align-top">{dr.nom}</td>
                                  <td className="px-3 py-2 text-gray-700 align-top">{dr.role}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Historique */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="p-6">
          <h2 className="text-lg font-semibold mb-4">Historique des modifications</h2>
          {history.length === 0 ? (
            <p className="text-gray-500 text-center py-8">Aucun historique disponible</p>
          ) : (
            <div className="space-y-4">
              {history.map((entry) => {
                const getActionLabel = (action: string) => {
                  const labels: { [key: string]: string } = {
                    creation: 'Création',
                    modification: 'Modification',
                    suppression: 'Suppression',
                    consultation: 'Consultation',
                    lecture: 'Consultation',
                    telechargement: 'Téléchargement',
                  };
                  return labels[action] || action;
                };

                const getActionIcon = (action: string) => {
                  if (action === 'creation') return '➕';
                  if (action === 'modification') return '✏️';
                  if (action === 'suppression') return '🗑️';
                  if (action === 'telechargement') return '⬇️';
                  if (action === 'consultation' || action === 'lecture') return '👁️';
                  return '📝';
                };

                const getActionColor = (action: string) => {
                  if (action === 'creation') return 'bg-green-100 text-green-800';
                  if (action === 'modification') return 'bg-blue-100 text-blue-800';
                  if (action === 'suppression') return 'bg-red-100 text-red-800';
                  if (action === 'telechargement') return 'bg-purple-100 text-purple-800';
                  if (action === 'consultation' || action === 'lecture') return 'bg-indigo-100 text-indigo-800';
                  return 'bg-gray-100 text-gray-800';
                };

                return (
                  <div key={entry.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <div className={`text-2xl ${getActionColor(entry.action)} rounded-full w-10 h-10 flex items-center justify-center`}>
                          {getActionIcon(entry.action)}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`px-2 py-1 text-xs rounded ${getActionColor(entry.action)}`}>
                              {getActionLabel(entry.action)}
                            </span>
                          </div>
                          {entry.details && typeof entry.details === 'object' && (
                            <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                              {entry.details.changementStatut && (
                                <div>Statut: {entry.details.changementStatut}</div>
                              )}
                              {entry.details.changementNom && (
                                <div>Nom: {entry.details.changementNom}</div>
                              )}
                              {entry.details.changementProprietaire && (
                                <div>Propriétaire modifié</div>
                              )}
                              {entry.details.changementEntite && (
                                <div>Entité modifiée</div>
                              )}
                              {entry.details.changementCategorie && (
                                <div>Catégorie modifiée</div>
                              )}
                              {entry.details.changementCategories && (
                                <div>Catégories modifiées</div>
                              )}
                              {entry.details.version && (
                                <div>Version: {entry.details.version}</div>
                              )}
                              {entry.details.ancienneVersion && entry.details.nouvelleVersion && (
                                <div>Version: {entry.details.ancienneVersion} → {entry.details.nouvelleVersion}</div>
                              )}
                              {entry.details.commentaire && (
                                <div className="italic">Commentaire: {entry.details.commentaire}</div>
                              )}
                              {entry.details.action === 'nouvelle_version' && (
                                <div className="text-blue-600">Nouvelle version ajoutée</div>
                              )}
                            </div>
                          )}
                          <p className="text-sm text-gray-700 mt-2">
                            {entry.user?.prenom} {entry.user?.nom}
                            {entry.ressourceNom && (
                              <span className="text-gray-500"> - {entry.ressourceNom}</span>
                            )}
                            {entry.ressourceType === 'document' && (
                              <span className="text-xs text-gray-400 ml-2">(Document)</span>
                            )}
                            {entry.ressourceType === 'processus' && (
                              <span className="text-xs text-gray-400 ml-2">(Processus)</span>
                            )}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(entry.timestamp).toLocaleString('fr-FR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Pagination */}
          {historyPagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
              <div className="text-sm text-gray-700">
                Affichage de {(historyPagination.page - 1) * historyPagination.limit + 1} à{' '}
                {Math.min(historyPagination.page * historyPagination.limit, historyPagination.total)} sur{' '}
                {historyPagination.total} entrées
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => loadHistory(historyPagination.page - 1)}
                  disabled={historyPagination.page === 1}
                  className={`px-4 py-2 rounded text-sm font-medium ${
                    historyPagination.page === 1
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  Précédent
                </button>
                <div className="flex gap-1">
                  {Array.from({ length: historyPagination.totalPages }, (_, i) => i + 1)
                    .filter((pageNum) => {
                      // Afficher la première page, la dernière page, la page actuelle et les pages adjacentes
                      return (
                        pageNum === 1 ||
                        pageNum === historyPagination.totalPages ||
                        (pageNum >= historyPagination.page - 1 && pageNum <= historyPagination.page + 1)
                      );
                    })
                    .map((pageNum, index, array) => {
                      // Ajouter des ellipses si nécessaire
                      const showEllipsisBefore = index > 0 && pageNum - array[index - 1] > 1;
                      return (
                        <div key={pageNum} className="flex items-center gap-1">
                          {showEllipsisBefore && (
                            <span className="px-2 text-gray-500">...</span>
                          )}
                          <button
                            onClick={() => loadHistory(pageNum)}
                            className={`px-3 py-2 rounded text-sm font-medium ${
                              historyPagination.page === pageNum
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {pageNum}
                          </button>
                        </div>
                      );
                    })}
                </div>
                <button
                  onClick={() => loadHistory(historyPagination.page + 1)}
                  disabled={historyPagination.page === historyPagination.totalPages}
                  className={`px-4 py-2 rounded text-sm font-medium ${
                    historyPagination.page === historyPagination.totalPages
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
      </div>

      {accessBlockedModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="access-blocked-title"
          onClick={() => setAccessBlockedModal(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="access-blocked-title" className="text-lg font-semibold text-gray-900 mb-2">
              Accès au document refusé
            </h3>
            {accessBlockedModal.context === 'process' ? (
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Vous n&apos;avez pas accès au détail de ce processus : vous ne pouvez donc pas consulter ou
                télécharger les documents associés. Veuillez contacter l&apos;une des personnes suivantes pour
                obtenir une habilitation sur le processus :
              </p>
            ) : (
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Vous n&apos;avez pas la possibilité d&apos;accéder à ce document
                {accessBlockedModal.documentLabel ? (
                  <>
                    {' '}
                    « <span className="font-medium">{accessBlockedModal.documentLabel}</span> »
                  </>
                ) : (
                  ''
                )}
                . Vous avez accès au processus, mais pas à ce fichier confidentiel ou son accès a été refusé par
                le serveur. Veuillez contacter l&apos;une des personnes suivantes pour qu&apos;elle puisse vous
                habiliter :
              </p>
            )}
            {(() => {
              const rows =
                accessBlockedModal.context === 'process'
                  ? collectHabilitatorsForProcessusAccess(processus, usersList)
                  : collectHabilitatorsForDocumentAccess(
                      processus,
                      usersList,
                      accessBlockedModal.documentRef || null
                    );
              if (rows.length === 0) {
                return (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md p-3">
                    Aucun contact nominatif n&apos;a pu être déterminé automatiquement. Veuillez vous adresser à
                    votre administrateur applicatif.
                  </p>
                );
              }
              return (
                <ul className="text-sm text-gray-800 space-y-2 border border-gray-100 rounded-md p-3 bg-gray-50 max-h-56 overflow-y-auto">
                  {rows.map((h) => (
                    <li key={h.id} className="leading-snug">
                      • {h.line}
                    </li>
                  ))}
                </ul>
              );
            })()}
            <div className="flex justify-end mt-5">
              <button
                type="button"
                onClick={() => setAccessBlockedModal(null)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de visualisation */}
      {viewingDocument && (documentUrl || getFileType(viewingDocument.fichierType) === 'excel') && (
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
              {getFileType(viewingDocument.fichierType) === 'excel' ? (
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
              ) : getFileType(viewingDocument.fichierType) === 'pdf' ? (
                <embed
                  src={documentUrl || undefined}
                  type="application/pdf"
                  className="w-full h-full border border-gray-300 rounded"
                  title={viewingDocument.nom}
                />
              ) : getFileType(viewingDocument.fichierType) === 'image' ? (
                <div className="flex justify-center items-center h-full overflow-auto">
                  <img
                    src={documentUrl || undefined}
                    alt={viewingDocument.nom}
                    className="max-w-full max-h-full object-contain"
                    loading="lazy"
                    crossOrigin="anonymous"
                  />
                </div>
              ) : getFileType(viewingDocument.fichierType) === 'text' ? (
                <embed
                  src={documentUrl || undefined}
                  type="text/plain"
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
    </div>
  );
}
