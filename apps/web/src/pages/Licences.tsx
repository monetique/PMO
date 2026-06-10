import { useState, useEffect, useRef, useMemo } from 'react';
import { api, API_BASE_URL } from '../services/api';
import { useAuth } from '../store/auth';
import { getPaginationPageNumbers } from '../utils/pagination';
import { documentTypeLabel } from '../constants/documentTypes';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import axios from 'axios';

/** Documents qu’on peut encore rattacher à une licence (pas déjà liés à une fiche licence). */
function isDocumentLinkableForLicence(d: any, alreadyLinkedIds: Set<string>) {
  if (alreadyLinkedIds.has(d.id)) return false;
  if (d.referenceType === 'licence' && d.referenceId) return false;
  return true;
}

const uploadApi = axios.create({ baseURL: API_BASE_URL });
uploadApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const STATUTS = [
  { value: 'active', label: '✅ Active', color: 'bg-green-100 text-green-700' },
  { value: 'expiree', label: '⏰ Expirée', color: 'bg-red-100 text-red-700' },
  { value: 'suspendue', label: '⏸ Suspendue', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'cloturee', label: '🔒 Clôturée', color: 'bg-slate-200 text-slate-800' },
];

const RECURRENCE_ALERTE_LABELS: Record<string, string> = {
  none: 'Une seule fois',
  weekly: 'Chaque semaine',
  monthly: 'Chaque mois',
  yearly: 'Chaque année',
};

const NIVEAUX = [
  { value: 'lecture', label: '👁 Lecture' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression' },
];

const LABEL_PERM_MODAL: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
};

const ACTION_JOURNAL: Record<string, string> = {
  connexion: 'Connexion',
  deconnexion: 'Déconnexion',
  lecture: 'Lecture / consultation',
  creation: 'Création',
  modification: 'Modification',
  suppression: 'Suppression',
  telechargement: 'Téléchargement',
  export: 'Export',
};

const LABEL_NIVEAU_ROW: Record<string, string> = {
  lecture: 'lecture',
  modification: 'modification',
  suppression: 'suppression',
};

function niveauSummaryLicence(n: string) {
  if (n === 'suppression') return 'modification + suppression + lecture';
  if (n === 'modification') return 'modification + lecture';
  return LABEL_NIVEAU_ROW[n] || n;
}

function isAccesRestreintLicence(l: any) {
  const exclusions = (l.adminSansAccesUserIds?.length ?? 0) > 0;
  return !!l.createdById || (l.permissions?.length ?? 0) > 0 || exclusions;
}

const droitsCreateurLicence = 'gestion des accès + modification + suppression + lecture';
const droitsAdminLigneLicence = 'modification + suppression + lecture (sans gestion des accès — réservée au créateur)';

function joursRestants(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

const genRef = () => `LIC-${Date.now().toString(36).toUpperCase()}`;

const getStatutAuto = (dateDebut: string, dateFin: string) => {
  const now = new Date();
  if (dateFin && new Date(dateFin) < now) return 'expiree';
  if (dateDebut && new Date(dateDebut) > now) return 'suspendue';
  return 'active';
};

const emptyForm = {
  nom: '', reference: '', typeLicence: '', cout: '', devise: '',
  statut: 'active', dateDebut: '', dateFin: '', description: '',
  nombreSieges: '',
  contratIds: [] as string[],
  processusIds: [] as string[],
  clientFournisseurIds: [] as string[],
};

const defaultFormNotif = () => ({
  mode: 'before_end' as 'before_end' | 'date_recurrence',
  joursAvant: 30,
  dateAlerte: '',
  recurrence: 'none' as 'none' | 'weekly' | 'monthly' | 'yearly',
  destinataires: [] as string[],
});

export default function Licences() {
  const { user } = useAuth();
  const [licences, setLicences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('');
  const [showFiltres, setShowFiltres] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [users, setUsers] = useState<any[]>([]);
  const [contrats, setContrats] = useState<any[]>([]);
  const [processus, setProcessus] = useState<any[]>([]);
  const [clientsFournisseurs, setCF] = useState<any[]>([]);
  const [typesLicence, setTypesLicence] = useState<any[]>([]);
  const [devises, setDevises] = useState<any[]>([]);
  const [accesModalLicence, setAccesModalLicence] = useState<any | null>(null);
  const [accesDetail, setAccesDetail] = useState<any | null>(null);
  const [accesLoading, setAccesLoading] = useState(false);
  const [newPermUserId, setNewPermUserId] = useState('');
  const [newPermNiveau, setNewPermNiveau] = useState('lecture');
  const [adminLimitNiveau, setAdminLimitNiveau] = useState<Record<string, string>>({});
  const [showDetailModal, setShowDetailModal] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'info'|'historique'|'docs'|'comments'|'notifs'|'acces'>('info');
  const [commentForm, setCommentForm] = useState({ contenu: '', assigneA: '' });
  const [notifForm, setNotifForm] = useState(defaultFormNotif());
  /** Alertes à créer depuis le modal Nouvelle / Modifier licence */
  const [formNotif, setFormNotif] = useState(defaultFormNotif());
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [showCorbeilleModal, setShowCorbeilleModal] = useState(false);
  const [corbeilleLicences, setCorbeilleLicences] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [histModalLicence, setHistModalLicence] = useState<any | null>(null);
  const [histoListRow, setHistoListRow] = useState<any[]>([]);
  const [histoLoadingRow, setHistoLoadingRow] = useState(false);
  const detailFileRef = useRef<HTMLInputElement>(null);
  const pickContratRef = useRef<HTMLSelectElement>(null);
  const pickProcessusRef = useRef<HTMLSelectElement>(null);
  const pickCfRef = useRef<HTMLSelectElement>(null);
  const [detailDocUploading, setDetailDocUploading] = useState(false);
  const [docsForLink, setDocsForLink] = useState<any[]>([]);
  const [docsForLinkLoading, setDocsForLinkLoading] = useState(false);
  const [docsLinkSearch, setDocsLinkSearch] = useState('');
  const [existingDocIds, setExistingDocIds] = useState<string[]>([]);
  const [detailLinkDocId, setDetailLinkDocId] = useState('');
  const [detailLinking, setDetailLinking] = useState(false);
  const [expandedLicenceIds, setExpandedLicenceIds] = useState<Set<string>>(() => new Set());
  const toggleLicenceRow = (id: string) => {
    setExpandedLicenceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isLicenceRowExpanded = (id: string) => expandedLicenceIds.has(id);

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    const needDocs = showForm || (showDetailModal && detailTab === 'docs');
    if (!needDocs) return;
    let cancelled = false;
    (async () => {
      setDocsForLinkLoading(true);
      try {
        const r = await api.get('/documents');
        if (!cancelled) setDocsForLink(Array.isArray(r.data) ? r.data : []);
      } catch {
        if (!cancelled) setDocsForLink([]);
      } finally {
        if (!cancelled) setDocsForLinkLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showForm, showDetailModal?.id, detailTab]);

  const formLinkedDocIds = useMemo(() => {
    if (!editing?.documents?.length) return new Set<string>();
    return new Set(
      (editing.documents as any[]).map((x) => x.document?.id).filter(Boolean) as string[],
    );
  }, [editing]);

  const detailLinkedDocIds = useMemo(() => {
    if (!showDetailModal?.documents?.length) return new Set<string>();
    return new Set(
      (showDetailModal.documents as any[]).map((x) => x.document?.id).filter(Boolean) as string[],
    );
  }, [showDetailModal?.documents]);

  const linkableDocsFiltered = useMemo(() => {
    const q = docsLinkSearch.trim().toLowerCase();
    const linked = showForm ? formLinkedDocIds : detailLinkedDocIds;
    return docsForLink.filter((d) => {
      if (!isDocumentLinkableForLicence(d, linked)) return false;
      if (!q) return true;
      const nom = (d.nom || '').toLowerCase();
      const td = (d.typeDocument || '').toLowerCase();
      return nom.includes(q) || td.includes(q);
    });
  }, [docsForLink, docsLinkSearch, showForm, editing?.id, showDetailModal?.id, detailTab, formLinkedDocIds, detailLinkedDocIds]);

  useEffect(() => {
    if (!showDetailModal || detailTab !== 'historique') return;
    let cancelled = false;
    (async () => {
      setHistoryLoading(true);
      try {
        const r = await api.get(`/licences/${showDetailModal.id}/history`);
        if (!cancelled) setHistory(r.data || []);
      } catch {
        if (!cancelled) setHistory([]);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showDetailModal?.id, detailTab]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [l, u, c, p, cf, tl, dv] = await Promise.all([
        api.get('/licences'), api.get('/users'),
        api.get('/contrats'), api.get('/processus'),
        api.get('/clients-fournisseurs'), api.get('/types-licence'),
        api.get('/devises'),
      ]);
      setLicences(l.data); setUsers(u.data); setContrats(c.data);
      setProcessus(p.data); setCF(cf.data); setTypesLicence(tl.data);
      setDevises(dv.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const openAccesModal = async (l: any) => {
    setAccesModalLicence(l);
    setAccesDetail(null);
    setNewPermUserId('');
    setNewPermNiveau('lecture');
    setAdminLimitNiveau({});
    setAccesLoading(true);
    try {
      const { data } = await api.get(`/licence-acces/${l.id}`);
      setAccesDetail(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
      setAccesModalLicence(null);
    } finally {
      setAccesLoading(false);
    }
  };

  const onAccesButtonClick = (l: any) => {
    void openAccesModal(l);
  };

  const refreshAccesDetail = async (licenceId: string) => {
    const { data } = await api.get(`/licence-acces/${licenceId}`);
    setAccesDetail(data);
    try {
      const res = await api.get(`/licences/${licenceId}`);
      setShowDetailModal((prev: any) => (prev?.id === licenceId ? res.data : prev));
    } catch {
      /* ignore */
    }
  };

  const handleAddPermission = async () => {
    if (!accesModalLicence || !newPermUserId) return;
    try {
      await api.post(`/licences/${accesModalLicence.id}/permissions`, {
        userId: newPermUserId,
        niveau: newPermNiveau,
      });
      setNewPermUserId('');
      await refreshAccesDetail(accesModalLicence.id);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRemovePermissionEntry = async (permissionEntryId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit sur cette licence. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès » ci-dessous."
      : 'Retirer ce droit ?';
    if (!accesModalLicence || !window.confirm(msg)) return;
    try {
      await api.delete(`/licences/${accesModalLicence.id}/permissions/entry/${permissionEntryId}`);
      await refreshAccesDetail(accesModalLicence.id);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRevokeAdminImplicitAccess = async (userId: string) => {
    if (!accesModalLicence) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus la licence tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous.",
      )
    )
      return;
    try {
      await api.post(`/licences/${accesModalLicence.id}/admin-sans-acces`, { userId });
      await refreshAccesDetail(accesModalLicence.id);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRestoreAdminDefaultAccess = async (userId: string) => {
    if (!accesModalLicence) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/licences/${accesModalLicence.id}/admin-sans-acces/${userId}`);
      await refreshAccesDetail(accesModalLicence.id);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const patchPermissionLevel = async (targetUserId: string, niveau: string) => {
    if (!accesModalLicence) return;
    try {
      await api.post(`/licences/${accesModalLicence.id}/permissions`, { userId: targetUserId, niveau });
      await refreshAccesDetail(accesModalLicence.id);
      await loadAll();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const quickLimitAdminAccess = async (adminId: string) => {
    if (!accesModalLicence) return;
    const niveau = adminLimitNiveau[adminId] || 'lecture';
    try {
      await api.post(`/licences/${accesModalLicence.id}/permissions`, { userId: adminId, niveau });
      await refreshAccesDetail(accesModalLicence.id);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const openHistoriqueRowModal = async (l: any) => {
    setHistModalLicence(l);
    setHistoListRow([]);
    setHistoLoadingRow(true);
    try {
      const r = await api.get(`/licences/${l.id}/history`);
      setHistoListRow(Array.isArray(r.data) ? r.data : []);
    } catch {
      setHistoListRow([]);
      alert('Impossible de charger l’historique.');
      setHistModalLicence(null);
    } finally {
      setHistoLoadingRow(false);
    }
  };

  const canEditLicence = (l: any) => {
    if (l?.capabilities) return !!l.capabilities.canModify;
    if (user?.role === 'admin' || l.createdById === user?.id) return true;
    return l.permissions?.some((p: any) => p.userId === user?.id && ['modification', 'suppression'].includes(p.niveau));
  };
  const canSoftDelete = (l: any) => {
    if (l?.capabilities) return !!l.capabilities.canDelete;
    if (user?.role === 'admin' || l.createdById === user?.id) return true;
    return l.permissions?.some((p: any) => p.userId === user?.id && p.niveau === 'suppression');
  };

  const openDetail = async (l: any) => {
    try {
      const res = await api.get(`/licences/${l.id}`);
      setShowDetailModal(res.data);
      setDetailTab('info');
      setHistory([]);
    } catch {
      setShowDetailModal(l);
      setDetailTab('info');
    }
  };

  const loadCorbeilleLicences = async () => {
    try {
      const r = await api.get('/licences/corbeille');
      setCorbeilleLicences(r.data || []);
    } catch {
      setCorbeilleLicences([]);
    }
  };

  const handleRestoreFromCorbeille = async (id: string) => {
    try {
      await api.post(`/licences/${id}/restaurer`);
      setShowCorbeilleModal(false);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur restauration');
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm, devise: devises[0]?.code || '' });
    setNewFiles([]);
    setExistingDocIds([]);
    setDocsLinkSearch('');
    setFormNotif(defaultFormNotif());
    setShowForm(true);
  };
  const openEdit = (l: any) => {
    setEditing(l);
    setForm({
      nom: l.nom, reference: l.reference || '', typeLicence: l.typeLicence,
      cout: l.cout || '', devise: l.devise || devises[0]?.code || '', statut: l.statut,
      dateDebut: l.dateDebut ? l.dateDebut.split('T')[0] : '',
      dateFin: l.dateFin ? l.dateFin.split('T')[0] : '',
      description: l.description || '', nombreSieges: l.nombreSieges || '',
      contratIds: (l.contrats || []).map((c: any) => c.id),
      processusIds: (l.processus || []).map((p: any) => p.id),
      clientFournisseurIds: (l.clientsFournisseurs || []).map((c: any) => c.id),
    });
    setNewFiles([]);
    setExistingDocIds([]);
    setDocsLinkSearch('');
    setFormNotif(defaultFormNotif());
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      let statutFinal = form.statut;
      if (form.statut !== 'cloturee' && (form.dateDebut || form.dateFin)) {
        statutFinal = getStatutAuto(form.dateDebut, form.dateFin);
      }
      const data: any = {
        ...form,
        reference: form.reference || genRef(),
        statut: statutFinal,
        nombreSieges: form.nombreSieges ? parseInt(form.nombreSieges as string) : null,
        cout: form.cout ? parseFloat(form.cout as string) : null,
        dateDebut: form.dateDebut || null, dateFin: form.dateFin || null,
        contratIds: form.contratIds,
        processusIds: form.processusIds,
        clientFournisseurIds: form.clientFournisseurIds,
      };

      if (formNotif.destinataires.length > 0) {
        if (formNotif.mode === 'before_end' && !data.dateFin) {
          alert('Pour une alerte « X jours avant fin », renseignez la date de fin de la licence.');
          return;
        }
        if (formNotif.mode === 'date_recurrence' && !formNotif.dateAlerte?.trim()) {
          alert('Pour une alerte à date fixe, choisissez une date d’alerte.');
          return;
        }
      }

      let licenceId: string;
      if (editing) {
        await api.put(`/licences/${editing.id}`, data);
        licenceId = editing.id;
      } else {
        const res = await api.post('/licences', data);
        licenceId = res.data.id;
      }
      for (const file of newFiles) {
        const fd = new FormData();
        fd.append('documents', file, file.name);
        await uploadApi.post(`/licences/${licenceId}/upload`, fd);
      }

      const linkErrors: string[] = [];
      for (const docId of existingDocIds) {
        try {
          await api.post(`/licences/${licenceId}/documents/link`, { documentId: docId });
        } catch (le: any) {
          linkErrors.push(le?.response?.data?.error || le?.message || docId);
        }
      }
      if (linkErrors.length > 0) {
        alert(
          'Licence enregistrée, mais certains documents n’ont pas pu être liés :\n' + linkErrors.join('\n'),
        );
      }

      if (formNotif.destinataires.length > 0) {
        try {
          await api.post(`/licences/${licenceId}/notifications`, {
            mode: formNotif.mode,
            joursAvant: formNotif.mode === 'before_end' ? formNotif.joursAvant : undefined,
            dateAlerte:
              formNotif.mode === 'date_recurrence' && formNotif.dateAlerte
                ? new Date(formNotif.dateAlerte + 'T12:00:00').toISOString()
                : undefined,
            recurrence: formNotif.mode === 'date_recurrence' ? formNotif.recurrence : undefined,
            destinataires: formNotif.destinataires,
          });
        } catch (ne: any) {
          alert(
            'Licence enregistrée, mais l’alerte n’a pas pu être créée : ' +
              (ne?.response?.data?.error || ne?.message || 'Erreur'),
          );
        }
      }

      setShowForm(false);
      setExistingDocIds([]);
      setDocsLinkSearch('');
      setFormNotif(defaultFormNotif());
      loadAll();
    } catch (e: any) {
      alert('Erreur: ' + (e?.response?.data?.error || e.message));
    }
  };

  const handleDelete = async (id: string, nom: string) => {
    if (!confirm(`Mettre la licence « ${nom} » en corbeille ? Vous pourrez la restaurer depuis la corbeille.`)) return;
    try {
      await api.delete(`/licences/${id}`);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const handleAddComment = async () => {
    if (!commentForm.contenu.trim()) return;
    await api.post(`/licences/${showDetailModal.id}/commentaires`, {
      contenu: commentForm.contenu, assigneA: commentForm.assigneA || null
    });
    setCommentForm({ contenu: '', assigneA: '' });
    const res = await api.get(`/licences/${showDetailModal.id}`);
    setShowDetailModal(res.data); loadAll();
  };

  const handleSetNotif = async () => {
    try {
      await api.post(`/licences/${showDetailModal.id}/notifications`, {
        mode: notifForm.mode,
        joursAvant: notifForm.mode === 'before_end' ? notifForm.joursAvant : undefined,
        dateAlerte:
          notifForm.mode === 'date_recurrence' && notifForm.dateAlerte
            ? new Date(notifForm.dateAlerte + 'T12:00:00').toISOString()
            : undefined,
        recurrence: notifForm.mode === 'date_recurrence' ? notifForm.recurrence : undefined,
        destinataires: notifForm.destinataires,
      });
      setNotifForm(defaultFormNotif());
      const res = await api.get(`/licences/${showDetailModal.id}`);
      setShowDetailModal(res.data);
      loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleDeleteNotif = async (nid: string) => {
    if (!showDetailModal?.id || !window.confirm('Supprimer cette alerte ?')) return;
    try {
      await api.delete(`/licences/${showDetailModal.id}/notifications/${nid}`);
      const res = await api.get(`/licences/${showDetailModal.id}`);
      setShowDetailModal(res.data);
      loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const uploadDetailDocs = async (fileList: FileList | null) => {
    if (!showDetailModal?.id || !fileList?.length) return;
    setDetailDocUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const fd = new FormData();
        fd.append('documents', file, file.name);
        await uploadApi.post(`/licences/${showDetailModal.id}/upload`, fd);
      }
      const res = await api.get(`/licences/${showDetailModal.id}`);
      setShowDetailModal(res.data);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur upload');
    } finally {
      setDetailDocUploading(false);
      if (detailFileRef.current) detailFileRef.current.value = '';
    }
  };

  const linkDetailExistingDoc = async () => {
    if (!showDetailModal?.id || !detailLinkDocId) return;
    setDetailLinking(true);
    try {
      await api.post(`/licences/${showDetailModal.id}/documents/link`, { documentId: detailLinkDocId });
      const res = await api.get(`/licences/${showDetailModal.id}`);
      setShowDetailModal(res.data);
      setDetailLinkDocId('');
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur lors du lien du document');
    } finally {
      setDetailLinking(false);
    }
  };

  const filtered = licences.filter(l => {
    const matchSearch = l.nom.toLowerCase().includes(search.toLowerCase()) ||
      (l.reference || '').toLowerCase().includes(search.toLowerCase());
    const matchStatut = !filtreStatut || l.statut === filtreStatut;
    return matchSearch && matchStatut;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pagedFiltered = filtered.slice(startIdx, startIdx + pageSize);

  const alertes = licences.filter(
    (l) =>
      l.statut !== 'cloturee' &&
      l.dateFin &&
      joursRestants(l.dateFin) <= 30 &&
      joursRestants(l.dateFin) > 0,
  );

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Licences / Certifications</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length} fiche(s) affichée(s) sur {licences.length} au total
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={async () => {
              await loadCorbeilleLicences();
              setShowCorbeilleModal(true);
            }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            🗑 Corbeille
          </button>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
          >
            + Nouvelle licence / certification
          </button>
        </div>
      </div>

      {alertes.length > 0 && (
        <div className="mb-6 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <p className="text-sm font-medium text-orange-700 mb-1">⚠️ Licences expirant bientôt :</p>
          <div className="flex flex-wrap gap-2">
            {alertes.map((l) => (
              <span key={l.id} className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">
                {l.nom} — dans {joursRestants(l.dateFin)} jour(s)
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>
            Filtres
            {(search || filtreStatut) ? ' ●' : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom / recherche</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select
                  value={filtreStatut}
                  onChange={(e) => setFiltreStatut(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous les statuts</option>
                  {STATUTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setFiltreStatut('');
                }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? <div className="text-center py-10 text-gray-400">Chargement...</div> : (
        <div className="space-y-4">
          {filtered.length === 0 && <div className="text-center py-10 text-gray-400">Aucune licence</div>}
          {pagedFiltered.map((l) => {
            const statut = STATUTS.find(s => s.value === l.statut);
            const jours = l.dateFin ? joursRestants(l.dateFin) : null;
            const rowOpen = isLicenceRowExpanded(l.id);
            return (
              <div
                key={l.id}
                className={`bg-white rounded-lg shadow overflow-hidden ${jours !== null && jours <= 30 && jours > 0 ? 'ring-1 ring-orange-300' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => toggleLicenceRow(l.id)}
                  className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  aria-expanded={rowOpen}
                  aria-label={rowOpen ? 'Replier le détail de la licence' : 'Afficher le détail et les actions de la licence'}
                >
                  <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${statut?.color}`}>{statut?.label}</span>
                  <span className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate text-left">{l.nom}</span>
                  <span className="text-sm text-gray-500 font-mono shrink-0">{l.reference || '—'}</span>
                  {rowOpen && (
                    <span className="text-gray-400 shrink-0 ml-auto" aria-hidden>
                      ▼
                    </span>
                  )}
                </button>

                {rowOpen && (
                  <div className="px-4 sm:px-5 pb-4 pt-0 border-t border-gray-100">
                    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 pt-3">
                      <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {l.typeLicence && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{l.typeLicence}</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-2">
                      {l.nombreSieges && <span>👥 {l.nombreSieges} utilisateurs</span>}
                      {l.cout && <span>💰 {l.cout} {l.devise}</span>}
                      {l.dateDebut && <span>📅 Début : {new Date(l.dateDebut).toLocaleDateString('fr-FR')}</span>}
                      {l.dateFin && <span className={jours !== null && jours <= 30 ? 'text-orange-600 font-medium' : ''}>
                        📅 Fin : {new Date(l.dateFin).toLocaleDateString('fr-FR')} {jours !== null && jours > 0 ? `(dans ${jours}j)` : jours !== null && jours <= 0 ? '⚠️ Expirée' : ''}
                      </span>}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {(l.contrats || []).map((c: any) => (
                        <span key={c.id} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded">📄 {c.nom}</span>
                      ))}
                      {(l.processus || []).map((p: any) => (
                        <span key={p.id} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded">⚙️ {p.nom}</span>
                      ))}
                      {(l.clientsFournisseurs || []).map((cf: any) => (
                        <span key={cf.id} className="px-2 py-0.5 bg-green-50 text-green-700 rounded">🏢 {cf.nom}</span>
                      ))}
                    </div>
                    {l.documents?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-gray-500 uppercase mb-1">Pièces jointes :</p>
                        <div className="flex flex-wrap gap-1">
                          {l.documents.map((d: any) => (
                            <a
                              key={d.id}
                              href={`${API_BASE_URL}/documents/${d.document?.id}/view?token=${localStorage.getItem('token')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs text-blue-600 hover:bg-gray-200 hover:underline"
                            >
                              📎 {d.document?.nom || 'Document'}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="mt-2 text-sm text-gray-600">
                      <span className="font-medium text-gray-700">Créé par : </span>
                      {l.createdBy ? (
                        <span>{l.createdBy.prenom} {l.createdBy.nom}</span>
                      ) : (
                        <span className="text-amber-600">Non renseigné</span>
                      )}
                    </p>
                    {l._count?.commentaires > 0 && (
                      <p className="text-xs text-gray-400 mt-1">💬 {l._count.commentaires} commentaire(s)</p>
                    )}

                    <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                      <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                        {isAccesRestreintLicence(l) ? (
                          <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                            <span className="text-sm leading-none" aria-hidden>🔒</span>
                            <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">Accès restreint</span>
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                            <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                            <span className="text-[10px] text-green-800/90 text-center mt-0.5">Visibilité selon droits</span>
                          </div>
                        )}
                        <AccessContratLikeAdminLines
                          keyPrefix={l.id}
                          users={users}
                          createdById={l.createdById}
                          createdBy={l.createdBy}
                          adminSansAccesUserIds={l.adminSansAccesUserIds}
                          permissions={(l.permissions || []).map((p: any) => ({
                            userId: p.userId,
                            niveau: p.niveau,
                            user: p.user,
                          }))}
                          creatorRightsLabel={droitsCreateurLicence}
                          droitsAdminCompletLabel={droitsAdminLigneLicence}
                          niveauLabel={(n) => NIVEAUX.find((x) => x.value === n)?.label || n}
                          limitedPrefix="Admin : accès limité —"
                        />
                        {(l.permissions || []).map((p: any) => (
                          <div key={p.id} className="min-w-0">
                            <span className="font-medium text-gray-900">{p.user?.prenom} {p.user?.nom}</span>
                            <span className="text-gray-500 italic block sm:inline sm:ml-1">
                              {p.niveau === 'lecture' ? (
                                <>👁 ({NIVEAUX.find((n) => n.value === p.niveau)?.label} : {LABEL_NIVEAU_ROW[p.niveau] || p.niveau})</>
                              ) : (
                                <> ({NIVEAUX.find((n) => n.value === p.niveau)?.label} : {niveauSummaryLicence(p.niveau)})</>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                        </div>

                    <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                    <button type="button" onClick={() => openDetail(l)} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">👁 Détails</button>
                    {canEditLicence(l) && (
                      <button
                        type="button"
                        onClick={() => openEdit(l)}
                        className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        ✏️ Modifier Licence / Certification
                      </button>
                    )}
                    <button type="button" onClick={() => onAccesButtonClick(l)} className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200">🔐 Accès</button>
                    <button type="button" onClick={() => openHistoriqueRowModal(l)} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200">📜 Historique</button>
                    {canSoftDelete(l) && (
                      <button type="button" onClick={() => handleDelete(l.id, l.nom)} className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">🗑 Mettre en corbeille</button>
                    )}
                    </div>
                      </div>
                    </div>
                )}
              </div>
            );
          })}
          {filtered.length > pageSize && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 flex-wrap gap-3">
              <div className="text-sm text-gray-700">
                Affichage {startIdx + 1}-{Math.min(startIdx + pageSize, filtered.length)} sur {filtered.length}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className={`px-4 py-2 rounded text-sm font-medium ${safePage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
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
                        className={`px-3 py-2 rounded text-sm font-medium ${safePage === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
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
                  className={`px-4 py-2 rounded text-sm font-medium ${safePage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Création/Édition */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center px-6 py-5 border-b">
              <h2 className="text-lg font-semibold">
                {editing ? 'Modifier la licence / certification' : 'Nouvelle licence / certification'}
              </h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1">✕</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom *</label>
                  <input value={form.nom} onChange={e => setForm({...form, nom: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Référence (auto si vide)</label>
                  <input value={form.reference} onChange={e => setForm({...form, reference: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="Auto-généré" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type *</label>
                  <select value={form.typeLicence} onChange={e => setForm({...form, typeLicence: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                    <option value="">Sélectionner un type</option>
                    {typesLicence.map((t: any) => <option key={t.id} value={t.nom}>{t.nom}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nombre d'utilisateurs</label>
                  <input type="number" value={form.nombreSieges} onChange={e => setForm({...form, nombreSieges: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="Optionnel" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Montant (coût)</label>
                  <input type="number" value={form.cout} onChange={e => setForm({...form, cout: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="Optionnel" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Devise</label>
                  <select
                    value={form.devise}
                    onChange={(e) => setForm({ ...form, devise: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                  >
                    <option value="">{devises.length ? 'Sélectionner une devise' : 'Aucune — voir Configuration'}</option>
                    {devises.map((d: any) => (
                      <option key={d.id} value={d.code}>
                        {d.libelle ? `${d.code} — ${d.libelle}` : d.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
                  <input
                    type="date"
                    value={form.dateDebut}
                    onChange={(e) => {
                      const dateDebut = e.target.value;
                      const next: any = { ...form, dateDebut };
                      if (form.statut !== 'cloturee') {
                        next.statut = getStatutAuto(dateDebut, form.dateFin);
                      }
                      setForm(next);
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin</label>
                  <input
                    type="date"
                    value={form.dateFin}
                    onChange={(e) => {
                      const dateFin = e.target.value;
                      const next: any = { ...form, dateFin };
                      if (form.statut !== 'cloturee') {
                        next.statut = getStatutAuto(form.dateDebut, dateFin);
                      }
                      setForm(next);
                    }}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Statut (auto selon dates, sauf si « Clôturée » — les alertes email s’arrêtent en clôturé)
                  </label>
                  <select value={form.statut} onChange={e => setForm({...form, statut: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                    {STATUTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} rows={3} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </div>
              <div className="space-y-4 border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-500">
                  Vous pouvez lier <span className="font-medium text-gray-700">plusieurs</span> contrats, processus et clients / fournisseurs. Ajoutez-les un par un via les listes ci-dessous.
                </p>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contrats liés</label>
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      ref={pickContratRef}
                      defaultValue=""
                      className="flex-1 min-w-[12rem] border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                    >
                      <option value="">Choisir un contrat…</option>
                      {contrats
                        .filter((c: any) => !form.contratIds.includes(c.id))
                        .map((c: any) => (
                          <option key={c.id} value={c.id}>{c.nom}</option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const v = pickContratRef.current?.value;
                        if (!v) return;
                        if (!form.contratIds.includes(v)) {
                          setForm({ ...form, contratIds: [...form.contratIds, v] });
                        }
                        if (pickContratRef.current) pickContratRef.current.value = '';
                      }}
                      className="px-3 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 shrink-0"
                    >
                      + Ajouter
                    </button>
                  </div>
                  {form.contratIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {form.contratIds.map((cid) => {
                        const c = contrats.find((x: any) => x.id === cid);
                        return (
                          <span
                            key={cid}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-800 rounded text-xs"
                          >
                            {c?.nom || cid}
                            <button
                              type="button"
                              className="text-purple-600 hover:text-purple-900"
                              onClick={() => setForm({ ...form, contratIds: form.contratIds.filter((id) => id !== cid) })}
                              aria-label="Retirer"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Processus liés</label>
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      ref={pickProcessusRef}
                      defaultValue=""
                      className="flex-1 min-w-[12rem] border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                    >
                      <option value="">Choisir un processus…</option>
                      {processus
                        .filter((p: any) => !form.processusIds.includes(p.id))
                        .map((p: any) => (
                          <option key={p.id} value={p.id}>{p.nom}</option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const v = pickProcessusRef.current?.value;
                        if (!v) return;
                        if (!form.processusIds.includes(v)) {
                          setForm({ ...form, processusIds: [...form.processusIds, v] });
                        }
                        if (pickProcessusRef.current) pickProcessusRef.current.value = '';
                      }}
                      className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 shrink-0"
                    >
                      + Ajouter
                    </button>
                  </div>
                  {form.processusIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {form.processusIds.map((pid) => {
                        const p = processus.find((x: any) => x.id === pid);
                        return (
                          <span
                            key={pid}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-800 rounded text-xs"
                          >
                            {p?.nom || pid}
                            <button
                              type="button"
                              className="text-blue-600 hover:text-blue-900"
                              onClick={() => setForm({ ...form, processusIds: form.processusIds.filter((id) => id !== pid) })}
                              aria-label="Retirer"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Clients / fournisseurs liés</label>
                  <div className="flex flex-wrap gap-2 items-center">
                    <select
                      ref={pickCfRef}
                      defaultValue=""
                      className="flex-1 min-w-[12rem] border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                    >
                      <option value="">Choisir un client ou fournisseur…</option>
                      {clientsFournisseurs
                        .filter((cf: any) => !form.clientFournisseurIds.includes(cf.id))
                        .map((cf: any) => (
                          <option key={cf.id} value={cf.id}>{cf.nom}</option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const v = pickCfRef.current?.value;
                        if (!v) return;
                        if (!form.clientFournisseurIds.includes(v)) {
                          setForm({ ...form, clientFournisseurIds: [...form.clientFournisseurIds, v] });
                        }
                        if (pickCfRef.current) pickCfRef.current.value = '';
                      }}
                      className="px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 shrink-0"
                    >
                      + Ajouter
                    </button>
                  </div>
                  {form.clientFournisseurIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {form.clientFournisseurIds.map((cfid) => {
                        const cf = clientsFournisseurs.find((x: any) => x.id === cfid);
                        return (
                          <span
                            key={cfid}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-800 rounded text-xs"
                          >
                            {cf?.nom || cfid}
                            <button
                              type="button"
                              className="text-green-600 hover:text-green-900"
                              onClick={() =>
                                setForm({
                                  ...form,
                                  clientFournisseurIds: form.clientFournisseurIds.filter((id) => id !== cfid),
                                })
                              }
                              aria-label="Retirer"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4 border-t border-amber-100 pt-4 bg-amber-50/40 -mx-6 px-6 py-4 rounded-lg">
                <p className="text-sm font-semibold text-gray-800">🔔 Alertes e-mail (optionnel)</p>
                <p className="text-xs text-gray-600">
                  Si vous cochez au moins un destinataire, une alerte sera créée à l’enregistrement (même logique que dans le détail licence → onglet Alertes). Laissez les cases vides pour ne pas créer d’alerte.
                </p>
                {editing?.notifications?.length > 0 && (
                  <div className="text-xs text-gray-700 space-y-1">
                    <span className="font-medium">Alertes déjà configurées ({editing.notifications.length}) :</span>
                    <ul className="list-disc list-inside text-gray-600">
                      {(editing.notifications as any[]).map((n: any) => (
                        <li key={n.id}>
                          {n.mode === 'date_recurrence'
                            ? `Date / récurrence — ${n.dateAlerte ? new Date(n.dateAlerte).toLocaleDateString('fr-FR') : '—'} (${RECURRENCE_ALERTE_LABELS[n.recurrence] || n.recurrence})`
                            : `${n.joursAvant} j. avant fin`}
                          {' · '}
                          {n.destinataires?.length ?? 0} destinataire(s)
                        </li>
                      ))}
                    </ul>
                    <p className="text-gray-500 italic">Vous pouvez ajouter une alerte supplémentaire ci-dessous.</p>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="form-alerte-mode"
                      checked={formNotif.mode === 'before_end'}
                      onChange={() => setFormNotif((f) => ({ ...f, mode: 'before_end' }))}
                    />
                    Avant fin de validité (nécessite une date de fin)
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="form-alerte-mode"
                      checked={formNotif.mode === 'date_recurrence'}
                      onChange={() => setFormNotif((f) => ({ ...f, mode: 'date_recurrence' }))}
                    />
                    Date fixe avec récurrence éventuelle
                  </label>
                </div>
                {formNotif.mode === 'before_end' && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <label className="text-sm text-gray-700">Notifier</label>
                    <input
                      type="number"
                      value={formNotif.joursAvant}
                      onChange={(e) =>
                        setFormNotif((f) => ({
                          ...f,
                          joursAvant: Math.max(1, parseInt(e.target.value, 10) || 30),
                        }))
                      }
                      className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
                      min={1}
                    />
                    <span className="text-sm text-gray-700">jour(s) avant la date de fin</span>
                  </div>
                )}
                {formNotif.mode === 'date_recurrence' && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Date de l’alerte</label>
                      <input
                        type="date"
                        value={formNotif.dateAlerte}
                        onChange={(e) => setFormNotif((f) => ({ ...f, dateAlerte: e.target.value }))}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Récurrence</label>
                      <select
                        value={formNotif.recurrence}
                        onChange={(e) =>
                          setFormNotif((f) => ({
                            ...f,
                            recurrence: e.target.value as 'none' | 'weekly' | 'monthly' | 'yearly',
                          }))
                        }
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                      >
                        {(Object.keys(RECURRENCE_ALERTE_LABELS) as (keyof typeof RECURRENCE_ALERTE_LABELS)[]).map((k) => (
                          <option key={k} value={k}>
                            {RECURRENCE_ALERTE_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-2">Destinataires</p>
                  <div className="border border-gray-300 rounded-md max-h-36 overflow-y-auto p-2 space-y-1 bg-white">
                    {users.map((u: any) => (
                      <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                        <input
                          type="checkbox"
                          checked={formNotif.destinataires.includes(u.id)}
                          onChange={(e) =>
                            setFormNotif((f) => ({
                              ...f,
                              destinataires: e.target.checked
                                ? [...f.destinataires, u.id]
                                : f.destinataires.filter((id) => id !== u.id),
                            }))
                          }
                        />
                        {u.prenom} {u.nom} ({u.email})
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <span className="block text-xs font-medium text-gray-600 mb-1">Nouveaux fichiers</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor="licence-form-files"
                      className="inline-flex px-3 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="file"
                        multiple
                        id="licence-form-files"
                        className="sr-only"
                        onChange={(e) => setNewFiles(Array.from(e.target.files || []))}
                      />
                      Sélectionner fichier(s)
                    </label>
                    <span className="text-xs text-gray-500">PDF, Office, images…</span>
                  </div>
                  {newFiles.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {newFiles.map((f, i) => (
                        <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                          📎 {f.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <span className="block text-xs font-medium text-gray-600 mb-1">
                    Lier un document déjà enregistré (liste Documents)
                  </span>
                  <input
                    type="search"
                    value={docsLinkSearch}
                    onChange={(e) => setDocsLinkSearch(e.target.value)}
                    placeholder="Filtrer par nom ou type…"
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm mb-2"
                  />
                  {docsForLinkLoading && <p className="text-xs text-gray-500 mb-2">Chargement de la liste…</p>}
                  <div className="border border-gray-200 rounded-md max-h-44 overflow-y-auto p-2 space-y-1 bg-gray-50/80">
                    {linkableDocsFiltered.length === 0 && !docsForLinkLoading && (
                      <p className="text-xs text-gray-500">Aucun document disponible (ou déjà lié à une licence).</p>
                    )}
                    {linkableDocsFiltered.map((d: any) => (
                      <label
                        key={d.id}
                        className="flex items-start gap-2 text-xs cursor-pointer hover:bg-white px-2 py-1 rounded"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded"
                          checked={existingDocIds.includes(d.id)}
                          onChange={(e) =>
                            setExistingDocIds((prev) =>
                              e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id),
                            )
                          }
                        />
                        <span>
                          <span className="font-medium text-gray-800">{d.nom}</span>
                          <span className="text-gray-500"> · {documentTypeLabel(d.typeDocument)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {existingDocIds.length > 0 && (
                    <p className="text-xs text-blue-700 mt-2">{existingDocIds.length} document(s) seront liés à l’enregistrement.</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50/80">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Annuler</button>
              <button onClick={handleSubmit} disabled={!form.nom || !form.typeLicence} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {editing ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {accesModalLicence && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {accesModalLicence.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              <span className="font-medium">Seul le créateur de la licence / certification</span> peut gérer les accès. Pour un
              administrateur : sans ligne dans « Accès partagés » et sans exclusion, il a un accès complet ; une ligne dans « Accès
              partagés » limite ses droits ; « Retirer l&apos;accès » le prive totalement de la fiche jusqu&apos;à ce qu&apos;un accès
              lui soit accordé via « Accorder un accès ». « Rétablir l&apos;accès admin par défaut » annule une exclusion et restaure
              l&apos;accès complet implicite (sans ligne).
            </p>
            {accesDetail && !accesDetail.canManagePermissions && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant que créateur de la licence.
              </p>
            )}
            {accesLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : accesDetail ? (
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
                  <p className="text-xs text-gray-500 mb-2">
                    Limitez un admin avec « Limiter l&apos;accès », retirez-le entièrement avec « Retirer l&apos;accès », ou rétablissez
                    l&apos;accès complet implicite s&apos;il était exclu.
                  </p>
                  <ul className="space-y-3 text-gray-700 text-sm">
                    {(accesDetail.admins || []).map((a: any) => {
                      const delegation = (accesDetail.delegations || []).find((d: any) => d.user?.id === a.id);
                      const explicite = !!delegation;
                      const isCreatorAdmin = accesDetail.creator?.id === a.id;
                      const refuse = (accesDetail.adminSansAccesUserIds || []).includes(a.id);
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
                          {accesDetail.canManagePermissions && !isCreatorAdmin && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {refuse && !explicite ? (
                                <button
                                  type="button"
                                  onClick={() => handleRestoreAdminDefaultAccess(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !explicite ? (
                                <>
                                  <select
                                    value={adminLimitNiveau[a.id] ?? 'lecture'}
                                    onChange={(e) =>
                                      setAdminLimitNiveau((prev) => ({ ...prev, [a.id]: e.target.value }))
                                    }
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {NIVEAUX.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => quickLimitAdminAccess(a.id)}
                                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                  >
                                    Limiter l’accès
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeAdminImplicitAccess(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Retirer l&apos;accès
                                  </button>
                                </>
                              ) : (
                                <>
                                  <select
                                    value={delegation.permission}
                                    onChange={async (e) => {
                                      const niveau = e.target.value;
                                      if (!accesModalLicence || niveau === delegation.permission) return;
                                      await patchPermissionLevel(a.id, niveau);
                                    }}
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {NIVEAUX.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePermissionEntry(delegation.id, true)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Révoquer l&apos;accès
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {accesDetail.canManagePermissions && isCreatorAdmin && (
                            <span className="text-xs text-gray-500">Créateur : accès complet, non modérable ici.</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Créateur</p>
                  {accesDetail.creator ? (
                    <p>
                      <span className="font-medium">
                        {accesDetail.creator.prenom} {accesDetail.creator.nom}
                      </span>
                      <span className="text-gray-400">
                        {' '}
                        — seul habilité à gérer les accès partagés ; modification et mise en corbeille selon ses autres droits sur la
                        fiche
                      </span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Créateur non résolu.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès partagés</p>
                  {(accesDetail.delegations || []).length === 0 ? (
                    <p className="text-gray-400 text-xs italic">Aucun accès délégué</p>
                  ) : (
                    <ul className="space-y-2">
                      {(accesDetail.delegations || []).map((d: any) => (
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
                          {accesDetail.canManagePermissions ? (
                            <>
                              <select
                                value={d.permission}
                                onChange={async (e) => {
                                  const niveau = e.target.value;
                                  if (!accesModalLicence || niveau === d.permission) return;
                                  await patchPermissionLevel(d.user.id, niveau);
                                }}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {NIVEAUX.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handleRemovePermissionEntry(d.id, d.user?.role === 'admin')}
                                className="text-xs text-red-600 hover:underline ml-auto"
                              >
                                {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-500">
                              — {LABEL_PERM_MODAL[d.permission] || d.permission}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {accesDetail.canManagePermissions && (
                  <div className="border-t border-gray-200 pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accorder un accès</p>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end">
                      <select
                        value={newPermUserId}
                        onChange={(e) => setNewPermUserId(e.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">— Utilisateur —</option>
                        {(() => {
                          const actifs = users.filter(
                            (u: any) => (!u.statut || u.statut === 'actif') && u.id !== accesDetail.creator?.id,
                          );
                          const adminsPick = actifs.filter((u: any) => u.role === 'admin');
                          const autresPick = actifs.filter((u: any) => u.role !== 'admin');
                          return (
                            <>
                              {adminsPick.length > 0 && (
                                <optgroup label="Administrateurs (modifiables par le créateur)">
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
                        value={newPermNiveau}
                        onChange={(e) => setNewPermNiveau(e.target.value)}
                        className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        {NIVEAUX.map((n) => (
                          <option key={n.value} value={n.value}>
                            {n.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleAddPermission}
                        disabled={!newPermUserId}
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
                onClick={() => setAccesModalLicence(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {histModalLicence && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {histModalLicence.nom}</h3>
            <p className="text-xs text-gray-500 mb-3">Consultations, modifications et autres actions enregistrées dans le journal.</p>
            {histoLoadingRow ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : histoListRow.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucune entrée pour le moment.</p>
            ) : (
              <ul className="space-y-3 text-sm max-h-[min(60vh,480px)] overflow-y-auto">
                {histoListRow.map((h: any) => (
                  <li key={h.id} className="border-b border-gray-100 pb-2">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500">
                      <span>{h.timestamp ? new Date(h.timestamp).toLocaleString('fr-FR') : ''}</span>
                      <span>{h.user ? `${h.user.prenom} ${h.user.nom}` : 'Utilisateur'}</span>
                    </div>
                    <p className="font-medium text-gray-800">{ACTION_JOURNAL[h.action] || h.action}</p>
                    {h.ressourceNom && <p className="text-gray-600 text-xs mt-0.5">{h.ressourceNom}</p>}
                    {h.details && typeof h.details === 'object' && Object.keys(h.details).length > 0 && (
                      <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-x-auto max-h-32">{JSON.stringify(h.details, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setHistModalLicence(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Détails */}
      {showDetailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-screen overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-semibold">🔑 {showDetailModal.nom}</h2>
              <button onClick={() => setShowDetailModal(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="flex border-b overflow-x-auto">
              {[{k:'info',l:'ℹ️ Infos'},{k:'historique',l:'📜 Historique'},{k:'docs',l:`📎 Docs (${showDetailModal.documents?.length||0})`},{k:'comments',l:`💬 (${showDetailModal.commentaires?.length||0})`},{k:'notifs',l:'🔔 Alertes'},{k:'acces',l:'🔑 Accès'}].map(t => (
                <button key={t.k} type="button" onClick={() => setDetailTab(t.k as any)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${detailTab === t.k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {t.l}
                </button>
              ))}
            </div>
            <div className="p-5">
              {detailTab === 'info' && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['Type', showDetailModal.typeLicence],
                    ['Référence', showDetailModal.reference],
                    ['Utilisateurs', showDetailModal.nombreSieges],
                    ['Coût', showDetailModal.cout ? `${showDetailModal.cout} ${showDetailModal.devise}` : null],
                    ['Début', showDetailModal.dateDebut ? new Date(showDetailModal.dateDebut).toLocaleDateString('fr-FR') : null],
                    ['Fin', showDetailModal.dateFin ? new Date(showDetailModal.dateFin).toLocaleDateString('fr-FR') : null],
                    [
                      'Contrats',
                      (showDetailModal.contrats || []).length
                        ? (showDetailModal.contrats || []).map((c: any) => c.nom).join(', ')
                        : null,
                    ],
                    [
                      'Processus',
                      (showDetailModal.processus || []).length
                        ? (showDetailModal.processus || []).map((p: any) => p.nom).join(', ')
                        : null,
                    ],
                    [
                      'Clients / Fournisseurs',
                      (showDetailModal.clientsFournisseurs || []).length
                        ? (showDetailModal.clientsFournisseurs || []).map((c: any) => c.nom).join(', ')
                        : null,
                    ],
                  ].filter(([,v]) => v).map(([k, v]) => (
                    <div key={k as string}><span className="text-gray-500">{k} :</span> <span className="font-medium">{v as string}</span></div>
                  ))}
                  {showDetailModal.description && <div className="col-span-2"><span className="text-gray-500">Description :</span><p className="mt-1">{showDetailModal.description}</p></div>}
                  <div className="col-span-2 border-t pt-3 mt-2">
                    <p className="text-gray-500 text-xs font-medium mb-1">Créé par</p>
                    {showDetailModal.createdBy ? (
                      <p className="text-sm">{showDetailModal.createdBy.prenom} {showDetailModal.createdBy.nom} ({showDetailModal.createdBy.email})</p>
                    ) : (
                      <p className="text-sm text-amber-600">Non renseigné</p>
                    )}
                  </div>
                </div>
              )}
              {detailTab === 'historique' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">Journal des lectures, modifications, suppressions et autres actions enregistrées pour cette licence.</p>
                  {historyLoading && <p className="text-sm text-gray-400">Chargement…</p>}
                  {!historyLoading && history.length === 0 && <p className="text-sm text-gray-400">Aucune entrée pour le moment.</p>}
                  <ul className="space-y-2 max-h-80 overflow-y-auto">
                    {history.map((h: any) => (
                      <li key={h.id} className="text-sm border border-gray-100 rounded-lg p-3 bg-gray-50">
                        <div className="flex justify-between gap-2 flex-wrap">
                          <span className="font-medium text-gray-800">{ACTION_JOURNAL[h.action] || h.action}</span>
                          <span className="text-xs text-gray-500">{h.timestamp ? new Date(h.timestamp).toLocaleString('fr-FR') : ''}</span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {h.user ? `${h.user.prenom} ${h.user.nom}` : 'Utilisateur'} {h.ressourceNom ? `· ${h.ressourceNom}` : ''}
                        </p>
                        {h.details && Object.keys(h.details).length > 0 && (
                          <pre className="text-xs text-gray-500 mt-2 whitespace-pre-wrap break-all">{JSON.stringify(h.details, null, 2)}</pre>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detailTab === 'docs' && (
                <div className="space-y-4">
                  {canEditLicence(showDetailModal) && (
                    <div className="space-y-3">
                      <div className={`flex flex-wrap items-center gap-2 ${detailDocUploading ? 'pointer-events-none opacity-60' : ''}`}>
                        <label
                          htmlFor="licence-detail-files"
                          className="inline-flex px-3 py-2 text-sm font-medium rounded-md border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 cursor-pointer shrink-0"
                        >
                          <input
                            ref={detailFileRef}
                            type="file"
                            multiple
                            id="licence-detail-files"
                            className="sr-only"
                            onChange={(e) => uploadDetailDocs(e.target.files)}
                          />
                          {detailDocUploading ? 'Envoi en cours…' : 'Sélectionner fichier(s)'}
                        </label>
                        <span className="text-xs text-gray-500">
                          Les fichiers apparaissent ici et dans Documents (type Licence), avec les mêmes accès que la fiche.
                        </span>
                      </div>
                      <div className="border border-dashed border-gray-200 rounded-lg p-3 bg-slate-50/80 space-y-2">
                        <p className="text-xs font-medium text-gray-700">Lier un document existant</p>
                        <input
                          type="search"
                          value={docsLinkSearch}
                          onChange={(e) => setDocsLinkSearch(e.target.value)}
                          placeholder="Filtrer par nom ou type…"
                          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                        />
                        {docsForLinkLoading && <p className="text-xs text-gray-500">Chargement…</p>}
                        <div className="flex flex-wrap gap-2 items-end">
                          <select
                            value={detailLinkDocId}
                            onChange={(e) => setDetailLinkDocId(e.target.value)}
                            className="flex-1 min-w-[12rem] border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
                          >
                            <option value="">— Choisir un document —</option>
                            {linkableDocsFiltered.map((d: any) => (
                              <option key={d.id} value={d.id}>
                                {d.nom} ({documentTypeLabel(d.typeDocument)})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            disabled={!detailLinkDocId || detailLinking}
                            onClick={() => void linkDetailExistingDoc()}
                            className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {detailLinking ? 'Liaison…' : 'Lier'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {!showDetailModal.documents?.length && <p className="text-gray-400 text-sm">Aucun document</p>}
                  {showDetailModal.documents?.map((d: any) => (
                    <div key={d.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <a href={`${API_BASE_URL}/documents/${d.document?.id}/view?token=${localStorage.getItem('token')}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline text-sm">
                        📎 {d.document?.nom}
                      </a>
                    </div>
                  ))}
                </div>
              )}
              {detailTab === 'comments' && (
                <div className="space-y-4">
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {showDetailModal.commentaires?.map((c: any) => (
                      <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-xs font-medium text-gray-700">{c.user?.prenom} {c.user?.nom}</span>
                          <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString('fr-FR')}</span>
                        </div>
                        {c.assigneUser && <span className="text-xs text-indigo-600 mb-1 block">👤 Assigné à : {c.assigneUser.prenom} {c.assigneUser.nom}</span>}
                        <p className="text-sm text-gray-700">{c.contenu}</p>
                      </div>
                    ))}
                  </div>
                  <div className="border-t pt-3 space-y-2">
                    <textarea value={commentForm.contenu} onChange={e => setCommentForm({...commentForm, contenu: e.target.value})} placeholder="Ajouter un commentaire..." rows={3} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                    <div className="flex gap-2">
                      <select value={commentForm.assigneA} onChange={e => setCommentForm({...commentForm, assigneA: e.target.value})} className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm">
                        <option value="">Assigner à (optionnel)</option>
                        {users.map((u: any) => <option key={u.id} value={u.id}>{u.prenom} {u.nom}</option>)}
                      </select>
                      <button onClick={handleAddComment} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">Envoyer</button>
                    </div>
                  </div>
                </div>
              )}
              {detailTab === 'notifs' && (
                <div className="space-y-4">
                  <p className="text-xs text-gray-500">
                    Les emails partent selon le modèle défini en Configuration → Notifications (alerte licence). Les envois
                    s’arrêtent si le statut de la licence est <strong>Clôturée</strong>.
                  </p>
                  {showDetailModal.statut === 'cloturee' && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                      Cette licence est clôturée : aucune alerte ne sera envoyée.
                    </p>
                  )}
                  {showDetailModal.notifications?.map((n: any) => {
                    const mode = n.mode === 'date_recurrence' ? 'date_recurrence' : 'before_end';
                    const desc =
                      mode === 'before_end'
                        ? `${n.joursAvant} jour(s) avant la date de fin`
                        : `Date / récurrence : ${n.dateAlerte ? new Date(n.dateAlerte).toLocaleDateString('fr-FR') : '—'} — ${RECURRENCE_ALERTE_LABELS[n.recurrence] || n.recurrence || '—'}`;
                    return (
                      <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg text-sm">
                        <div className="min-w-0">
                          <span className="font-medium text-gray-800">🔔 {desc}</span>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {n.destinataires?.length || 0} destinataire(s)
                            {n.lastSentAt ? ` · Dernier envoi : ${new Date(n.lastSentAt).toLocaleString('fr-FR')}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded text-xs ${n.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {n.active ? 'Actif' : 'Inactif'}
                          </span>
                          {canEditLicence(showDetailModal) && (
                            <button
                              type="button"
                              onClick={() => handleDeleteNotif(n.id)}
                              className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
                            >
                              Supprimer
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {canEditLicence(showDetailModal) && showDetailModal.statut !== 'cloturee' && (
                    <div className="border-t pt-4 space-y-4">
                      <p className="text-sm font-medium text-gray-800">Nouvelle alerte</p>
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="alerte-mode"
                            checked={notifForm.mode === 'before_end'}
                            onChange={() => setNotifForm((f) => ({ ...f, mode: 'before_end' }))}
                          />
                          Avant fin de validité (si la date de fin est renseignée)
                        </label>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="radio"
                            name="alerte-mode"
                            checked={notifForm.mode === 'date_recurrence'}
                            onChange={() => setNotifForm((f) => ({ ...f, mode: 'date_recurrence' }))}
                          />
                          Date fixe avec récurrence éventuelle
                        </label>
                      </div>
                      {notifForm.mode === 'before_end' && (
                        <div className="flex flex-wrap gap-2 items-center">
                          <label className="text-sm text-gray-600">Notifier</label>
                          <input
                            type="number"
                            value={notifForm.joursAvant}
                            onChange={(e) =>
                              setNotifForm((f) => ({ ...f, joursAvant: Math.max(1, parseInt(e.target.value, 10) || 30) }))
                            }
                            className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm"
                            min={1}
                          />
                          <span className="text-sm text-gray-600">jour(s) avant la date de fin</span>
                          {!showDetailModal.dateFin && (
                            <span className="text-xs text-amber-600 w-full">Renseignez une date de fin sur la licence pour utiliser ce mode.</span>
                          )}
                        </div>
                      )}
                      {notifForm.mode === 'date_recurrence' && (
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Date de l’alerte</label>
                            <input
                              type="date"
                              value={notifForm.dateAlerte}
                              onChange={(e) => setNotifForm((f) => ({ ...f, dateAlerte: e.target.value }))}
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Récurrence</label>
                            <select
                              value={notifForm.recurrence}
                              onChange={(e) =>
                                setNotifForm((f) => ({
                                  ...f,
                                  recurrence: e.target.value as 'none' | 'weekly' | 'monthly' | 'yearly',
                                }))
                              }
                              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                            >
                              {(Object.keys(RECURRENCE_ALERTE_LABELS) as (keyof typeof RECURRENCE_ALERTE_LABELS)[]).map((k) => (
                                <option key={k} value={k}>
                                  {RECURRENCE_ALERTE_LABELS[k]}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-medium text-gray-600 mb-2">Destinataires (email)</p>
                        <div className="border border-gray-300 rounded-md max-h-40 overflow-y-auto p-2 space-y-1">
                          {users.map((u: any) => (
                            <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                              <input
                                type="checkbox"
                                checked={notifForm.destinataires.includes(u.id)}
                                onChange={(e) =>
                                  setNotifForm((f) => ({
                                    ...f,
                                    destinataires: e.target.checked
                                      ? [...f.destinataires, u.id]
                                      : f.destinataires.filter((id) => id !== u.id),
                                  }))
                                }
                              />
                              {u.prenom} {u.nom} ({u.email})
                            </label>
                          ))}
                        </div>
                      </div>
                      <button type="button" onClick={handleSetNotif} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm">
                        Enregistrer l’alerte
                      </button>
                    </div>
                  )}
                </div>
              )}
              {detailTab === 'acces' && (
                <div className="space-y-4 text-sm">
                  <p className="text-gray-600">
                    La gestion détaillée des droits (administrateurs, accès partagés, exclusions) utilise le même écran que depuis
                    la liste : ouvrez la fenêtre « Accès ».
                  </p>
                  <button
                    type="button"
                    onClick={() => void openAccesModal(showDetailModal)}
                    className="px-4 py-2 bg-slate-100 text-slate-800 rounded-md text-sm font-medium hover:bg-slate-200"
                  >
                    🔐 Ouvrir la gestion des accès
                  </button>
                  <div className="border-t border-gray-100 pt-3 space-y-2 text-xs text-gray-500">
                    <p>
                      <span className="font-medium text-gray-700">Créateur :</span>{' '}
                      {showDetailModal.createdBy
                        ? `${showDetailModal.createdBy.prenom} ${showDetailModal.createdBy.nom}`
                        : '—'}
                    </p>
                    <p>
                      {(showDetailModal.permissions || []).length} utilisateur(s) avec accès partagé sur cette fiche.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showCorbeilleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-semibold">🗑 Licences en corbeille</h2>
              <button type="button" onClick={() => setShowCorbeilleModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="p-5 space-y-3">
              {corbeilleLicences.length === 0 && <p className="text-sm text-gray-500">Aucune licence supprimée.</p>}
              {corbeilleLicences.map((cl: any) => (
                <div key={cl.id} className="flex justify-between items-center gap-3 p-3 border rounded-lg bg-gray-50">
                  <div>
                    <p className="font-medium text-gray-900">{cl.nom}</p>
                    <p className="text-xs text-gray-500">
                      Supprimée le {cl.deletedAt ? new Date(cl.deletedAt).toLocaleString('fr-FR') : '—'}
                      {cl.createdBy && ` · Créée par ${cl.createdBy.prenom} ${cl.createdBy.nom}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestoreFromCorbeille(cl.id)}
                    className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                  >
                    Restaurer
                  </button>
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-2">
                La suppression définitive est réservée aux administrateurs (menu Corbeille global).
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
