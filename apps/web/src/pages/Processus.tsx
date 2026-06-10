import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { api, API_BASE_URL } from '../services/api';
import { useAuth } from '../store/auth';
import { getPaginationPageNumbers } from '../utils/pagination';

const PAGE_SIZE = 15;

const PMO_PROCESSUS_ACCES_CHANGED = 'pmo-processus-acces-changed';

const PERMISSION_LABELS: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des accès',
};

const PERM_OPTIONS = [
  { value: 'lecture', label: '👁 Lecture' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression' },
  { value: 'gestion', label: '🔐 Gestion des accès' },
];

const LABEL_LOG_ACTION: Record<string, string> = {
  connexion: 'Connexion',
  deconnexion: 'Déconnexion',
  lecture: 'Consultation',
  creation: 'Création',
  modification: 'Modification',
  suppression: 'Suppression',
  telechargement: 'Téléchargement',
  export: 'Export',
};

const LABEL_RESSOURCE: Record<string, string> = {
  processus: 'Processus',
  document: 'Document',
  projet: 'Projet',
  entite: 'Entité',
  utilisateur: 'Utilisateur',
  licence: 'Licence',
  clientFournisseur: 'Client / fournisseur',
  contrat: 'Contrat',
};

function isAccesRestreintProcessus(p: any) {
  const dels = p.accesApercu?.delegations?.length ?? p.permissions?.length ?? 0;
  return dels > 0 || !!p.createdById;
}

function permSummaryLineProcessus(perms: string[]) {
  return perms.map((p) => PERMISSION_LABELS[p] || p).join(' + ');
}

function processusPermissionsForAdminLines(perms: any[]) {
  const m = new Map<string, { userId: string; niveau: string; user?: any }>();
  for (const r of perms || []) {
    const uid = r.userId || r.user?.id;
    if (!uid) continue;
    const ex = m.get(uid);
    const part = PERMISSION_LABELS[r.permission] || r.permission;
    m.set(uid, {
      userId: uid,
      niveau: ex ? `${ex.niveau} + ${part}` : part,
      user: r.user,
    });
  }
  return Array.from(m.values());
}

export default function Processus() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser } = useAuth();
  const isLecteur = currentUser?.role === 'lecteur';

  const [processusList, setProcessusList] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [entites, setEntites] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    search: '',
    statut: '',
    entiteId: '',
    categorieId: '',
  });
  const [formData, setFormData] = useState({
    nom: '',
    codeProcessus: '',
    description: '',
    entiteIds: [] as string[],
    categorieIds: [] as string[],
    proprietaireId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [showFiltres, setShowFiltres] = useState(false);
  /** Lignes de processus dépliées (par défaut tout est replié). */
  const [expandedProcessusIds, setExpandedProcessusIds] = useState<Set<string>>(() => new Set());
  const [showCorbeilleModal, setShowCorbeilleModal] = useState(false);
  const [corbeilleProcessus, setCorbeilleProcessus] = useState<any[]>([]);

  const [accesModalProc, setAccesModalProc] = useState<any | null>(null);
  const [accesDetail, setAccesDetail] = useState<any | null>(null);
  const [accesLoading, setAccesLoading] = useState(false);
  const [adminLimitPerm, setAdminLimitPerm] = useState<Record<string, string>>({});
  const [newPermUserId, setNewPermUserId] = useState('');
  const [newPermType, setNewPermType] = useState('lecture');

  const [histModalProc, setHistModalProc] = useState<any | null>(null);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);

  const [createPermDraftUserId, setCreatePermDraftUserId] = useState('');
  const [createPermDraftType, setCreatePermDraftType] = useState('lecture');
  const [createInitialPermissions, setCreateInitialPermissions] = useState<{ userId: string; permission: string }[]>(
    []
  );

  const firstProcessusLoad = useRef(true);

  const toggleProcessusRow = (id: string) => {
    setExpandedProcessusIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isProcessusRowExpanded = (id: string) => expandedProcessusIds.has(id);

  const resetCreateModal = () => {
    setFormData({
      nom: '',
      codeProcessus: '',
      description: '',
      entiteIds: [],
      categorieIds: [],
      proprietaireId: '',
    });
    setCreateInitialPermissions([]);
    setCreatePermDraftUserId('');
    setCreatePermDraftType('lecture');
    setError('');
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const qStatut = params.get('statut');
    if (qStatut) {
      setFilters((prev) => ({ ...prev, statut: qStatut }));
    }
    void loadUsersOnce();
    loadEntites();
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onProcAccesSync = () => {
      void loadProcessus();
    };
    window.addEventListener(PMO_PROCESSUS_ACCES_CHANGED, onProcAccesSync);
    return () => window.removeEventListener(PMO_PROCESSUS_ACCES_CHANGED, onProcAccesSync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadProcessus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.statut, filters.entiteId, filters.categorieId, sortConfig, location.search]);

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.statut, filters.entiteId, filters.categorieId, sortConfig]);

  const loadUsersOnce = async () => {
    try {
      const u = await api.get('/users');
      setUsers(u.data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadProcessus = async () => {
    const showFullLoading = firstProcessusLoad.current;
    if (showFullLoading) setLoading(true);
    try {
      const urlStatut = new URLSearchParams(location.search).get('statut') || '';
      const statutEff = filters.statut || urlStatut;

      const params: Record<string, string> = {};
      if (filters.search) params.search = filters.search;
      if (statutEff) params.statut = statutEff;
      if (filters.entiteId) params.entiteId = filters.entiteId;
      if (filters.categorieId) params.categorieId = filters.categorieId;
      if (sortConfig && !['proprietaire', 'entites', 'categories'].includes(sortConfig.key)) {
        params.sortBy = sortConfig.key;
        params.sortOrder = sortConfig.direction;
      }
      const response = await api.get('/processus', { params });
      let sortedProcessus = response.data as any[];

      if (sortConfig?.key === 'proprietaire') {
        sortedProcessus = [...sortedProcessus].sort((a, b) => {
          const aName = a.proprietaire ? `${a.proprietaire.prenom} ${a.proprietaire.nom}` : '';
          const bName = b.proprietaire ? `${b.proprietaire.prenom} ${b.proprietaire.nom}` : '';
          return sortConfig.direction === 'asc'
            ? aName.localeCompare(bName, 'fr', { sensitivity: 'base' })
            : bName.localeCompare(aName, 'fr', { sensitivity: 'base' });
        });
      } else if (sortConfig?.key === 'entites') {
        sortedProcessus = [...sortedProcessus].sort((a, b) => {
          const aEntites =
            a.entites?.map((pe: any) => pe.entite?.nom || '').filter(Boolean).join(', ') || 'N/A';
          const bEntites =
            b.entites?.map((pe: any) => pe.entite?.nom || '').filter(Boolean).join(', ') || 'N/A';
          return sortConfig.direction === 'asc'
            ? aEntites.localeCompare(bEntites, 'fr', { sensitivity: 'base' })
            : bEntites.localeCompare(aEntites, 'fr', { sensitivity: 'base' });
        });
      } else if (sortConfig?.key === 'categories') {
        sortedProcessus = [...sortedProcessus].sort((a, b) => {
          const aCat =
            a.categories?.map((pc: any) => pc.categorie?.nom || '').filter(Boolean).join(', ') || 'N/A';
          const bCat =
            b.categories?.map((pc: any) => pc.categorie?.nom || '').filter(Boolean).join(', ') || 'N/A';
          return sortConfig.direction === 'asc'
            ? aCat.localeCompare(bCat, 'fr', { sensitivity: 'base' })
            : bCat.localeCompare(aCat, 'fr', { sensitivity: 'base' });
        });
      }

      setProcessusList(sortedProcessus);
    } catch (error) {
      console.error('Erreur:', error);
    } finally {
      if (showFullLoading) {
        setLoading(false);
        firstProcessusLoad.current = false;
      }
    }
  };

  const notifyProcessusAccesChangedFromList = (processusId: string) => {
    try {
      window.dispatchEvent(new CustomEvent(PMO_PROCESSUS_ACCES_CHANGED, { detail: { processusId } }));
    } catch {
      /* ignore */
    }
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const resetSort = () => setSortConfig(null);

  const loadEntites = async () => {
    try {
      const response = await api.get('/entites');
      setEntites(response.data);
    } catch (error) {
      console.error('Erreur chargement entités:', error);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await api.get('/categories');
      setCategories(response.data);
    } catch (error) {
      console.error('Erreur chargement catégories:', error);
    }
  };

  const capModify = (p: any) =>
    p.capabilities?.canModify ??
    (currentUser?.role === 'admin' ||
      p.proprietaireId === currentUser?.id ||
      p.createdById === currentUser?.id);

  const capDelete = (p: any) =>
    p.capabilities?.canDelete ??
    (currentUser?.role === 'admin' ||
      p.proprietaireId === currentUser?.id ||
      p.createdById === currentUser?.id);

  const loadCorbeilleProcessus = async () => {
    try {
      const r = await api.get('/processus/corbeille');
      setCorbeilleProcessus(Array.isArray(r.data) ? r.data : []);
    } catch {
      setCorbeilleProcessus([]);
    }
  };

  const handleRestoreProcessusFromCorbeille = async (id: string) => {
    try {
      await api.post(`/corbeille/processus/${id}/restaurer`);
      setShowCorbeilleModal(false);
      await loadProcessus();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur lors de la restauration');
    }
  };

  const canRestoreProcessusCorbeille = (row: any) =>
    currentUser?.role === 'admin' ||
    row.createdById === currentUser?.id ||
    row.createdBy?.id === currentUser?.id ||
    row.proprietaireId === currentUser?.id ||
    row.proprietaire?.id === currentUser?.id;

  const handleDelete = async (processusId: string, processusNom: string) => {
    if (
      !window.confirm(
        `Mettre le processus « ${processusNom} » en corbeille ? (restauration possible ; suppression définitive depuis la corbeille)`
      )
    ) {
      return;
    }
    setDeletingId(processusId);
    try {
      await api.delete(`/processus/${processusId}`);
      await loadProcessus();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la mise en corbeille');
    } finally {
      setDeletingId(null);
    }
  };

  const onAccesButtonClick = (p: any) => {
    void openAccesModal(p);
  };

  const openAccesModal = async (p: any) => {
    setAccesModalProc(p);
    setAccesDetail(null);
    setNewPermUserId('');
    setNewPermType('lecture');
    setAdminLimitPerm({});
    setAccesLoading(true);
    try {
      const { data } = await api.get(`/processus/${p.id}/acces`);
      setAccesDetail(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
      setAccesModalProc(null);
    } finally {
      setAccesLoading(false);
    }
  };

  const refreshAccesDetail = async (processusId: string) => {
    const { data } = await api.get(`/processus/${processusId}/acces`);
    setAccesDetail(data);
  };

  const handleAddPermission = async () => {
    if (!accesModalProc || !newPermUserId) return;
    try {
      await api.post(`/processus/${accesModalProc.id}/permissions`, {
        userId: newPermUserId,
        permission: newPermType,
      });
      setNewPermUserId('');
      await refreshAccesDetail(accesModalProc.id);
      await loadProcessus();
      notifyProcessusAccesChangedFromList(accesModalProc.id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRemovePermissionEntry = async (permissionEntryId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit explicite sur ce processus. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès »."
      : 'Retirer ce droit ?';
    if (!accesModalProc || !window.confirm(msg)) return;
    try {
      await api.delete(`/processus/${accesModalProc.id}/permissions/${permissionEntryId}`);
      await refreshAccesDetail(accesModalProc.id);
      await loadProcessus();
      notifyProcessusAccesChangedFromList(accesModalProc.id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const revokeAllProcessusDelegationsForUser = async (userId: string) => {
    if (!accesModalProc || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    if (rows.length === 0) return;
    if (!window.confirm('Révoquer tous les droits explicites pour cet utilisateur sur ce processus ?')) return;
    try {
      for (const r of rows) {
        await api.delete(`/processus/${accesModalProc.id}/permissions/${r.id}`);
      }
      await refreshAccesDetail(accesModalProc.id);
      await loadProcessus();
      notifyProcessusAccesChangedFromList(accesModalProc.id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRestoreAdminDefaultProcessus = async (userId: string) => {
    if (!accesModalProc) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/processus/${accesModalProc.id}/admin-sans-acces/${userId}`);
      await refreshAccesDetail(accesModalProc.id);
      await loadProcessus();
      notifyProcessusAccesChangedFromList(accesModalProc.id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRevokeAdminImplicitProcessus = async (userId: string) => {
    if (!accesModalProc) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus le processus tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous."
      )
    ) {
      return;
    }
    try {
      await api.post(`/processus/${accesModalProc.id}/admin-sans-acces`, { userId });
      await refreshAccesDetail(accesModalProc.id);
      await loadProcessus();
      notifyProcessusAccesChangedFromList(accesModalProc.id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const quickLimitAdminProcessus = async (userId: string) => {
    if (!accesModalProc) return;
    const permission = adminLimitPerm[userId] || 'lecture';
    try {
      await api.post(`/processus/${accesModalProc.id}/permissions`, { userId, permission });
      await refreshAccesDetail(accesModalProc.id);
      await loadProcessus();
      notifyProcessusAccesChangedFromList(accesModalProc.id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const replaceAdminProcessusPermissionLevel = async (userId: string, permission: string) => {
    if (!accesModalProc || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    try {
      for (const r of rows) {
        await api.delete(`/processus/${accesModalProc.id}/permissions/${r.id}`);
      }
      await api.post(`/processus/${accesModalProc.id}/permissions`, { userId, permission });
      await refreshAccesDetail(accesModalProc.id);
      await loadProcessus();
      notifyProcessusAccesChangedFromList(accesModalProc.id);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const openHistoriqueModal = async (p: any) => {
    setHistModalProc(p);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/processus/${p.id}/history`, { params: { page: 1, limit: 80 } });
      setHistoList(data?.data || []);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement historique');
      setHistModalProc(null);
    } finally {
      setHistoLoading(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (!formData.nom || !formData.codeProcessus) {
        setError('Le nom et le code sont obligatoires');
        return;
      }
      await api.post('/processus', {
        nom: formData.nom,
        codeProcessus: formData.codeProcessus,
        description: formData.description || undefined,
        entiteIds: formData.entiteIds || [],
        categorieIds: formData.categorieIds || [],
        proprietaireId: formData.proprietaireId || undefined,
        initialPermissions: createInitialPermissions,
      });
      setShowModal(false);
      resetCreateModal();
      await loadProcessus();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(processusList.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageSlice = processusList.slice(startIdx, startIdx + PAGE_SIZE);

  const droitsAdminLigne = 'consultation, modification, mise en corbeille, gestion des accès';

  const tokenQs = () => {
    const t = localStorage.getItem('token');
    return t ? `?token=${encodeURIComponent(t)}` : '';
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-10 text-gray-400">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Processus</h1>
          <p className="text-sm text-gray-500 mt-1">{processusList.length} processus accessible(s)</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={async () => {
              await loadCorbeilleProcessus();
              setShowCorbeilleModal(true);
            }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            🗑 Corbeille
          </button>
          {!isLecteur && (
            <button
              type="button"
              onClick={() => {
                resetCreateModal();
                setShowModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
            >
              + Nouveau processus
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
            {(filters.search || filters.statut || filters.entiteId || filters.categorieId) ? ' ●' : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom / code / description / tags</label>
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  placeholder="Rechercher…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select
                  value={filters.statut}
                  onChange={(e) => setFilters({ ...filters, statut: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  {statuts.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Entité</label>
                <select
                  value={filters.entiteId}
                  onChange={(e) => setFilters({ ...filters, entiteId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Toutes</option>
                  {entites.map((entite) => (
                    <option key={entite.id} value={entite.id}>
                      {entite.nom}
                      {entite.code ? ` (${entite.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Catégorie</label>
                <select
                  value={filters.categorieId}
                  onChange={(e) => setFilters({ ...filters, categorieId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Toutes</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.nom}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2 mt-4 pt-2 border-t border-gray-100">
              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                <span className="font-medium">Tri rapide :</span>
                {(['codeProcessus', 'nom', 'statut', 'proprietaire', 'entites', 'categories'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleSort(k)}
                    className={`hover:text-blue-600 ${sortConfig?.key === k ? 'text-blue-600 font-semibold' : ''}`}
                  >
                    {k === 'codeProcessus'
                      ? 'Code'
                      : k === 'proprietaire'
                        ? 'Propriétaire'
                        : k === 'entites'
                          ? 'Entités'
                          : k === 'categories'
                            ? 'Catégories'
                            : k}
                    {sortConfig?.key === k ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
                {sortConfig && (
                  <button type="button" onClick={resetSort} className="text-gray-600 hover:underline ml-2">
                    Réinitialiser tri
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFilters({ search: '', statut: '', entiteId: '', categorieId: '' })}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {pageSlice.length === 0 && (
          <div className="text-center py-10 text-gray-400 bg-white rounded-lg shadow">Aucun processus trouvé</div>
        )}
        {pageSlice.map((p) => {
          const currentStatut = statuts.find((s) => s.value === p.statut);
          const rowOpen = isProcessusRowExpanded(p.id);

          return (
            <div key={p.id} className="bg-white rounded-lg shadow overflow-hidden">
              <button
                type="button"
                onClick={() => toggleProcessusRow(p.id)}
                className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                aria-expanded={rowOpen}
                aria-label={rowOpen ? 'Replier le détail du processus' : 'Afficher le détail et les actions du processus'}
              >
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${currentStatut?.color || 'bg-gray-100 text-gray-800'}`}
                >
                  {currentStatut?.label || p.statut}
                </span>
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate">{p.nom}</h2>
                <span className="text-sm text-gray-500 font-mono shrink-0">{p.codeProcessus}</span>
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
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-gray-600">
                    <div>
                      <span className="font-medium">Documents : </span>
                      <span className="text-blue-700 font-semibold">{p.nombreDocuments ?? 0}</span>
                    </div>
                    <div>
                      <span className="font-medium">Tâches liées : </span>
                      <span>{p.tachesLieesTotal ?? 0}</span>
                      <span className="text-gray-400 text-xs"> (projets partageant une entité)</span>
                    </div>
                    {p.proprietaire && (
                      <div>
                        <span className="font-medium">Propriétaire : </span>
                        {p.proprietaire.prenom} {p.proprietaire.nom}
                      </div>
                    )}
                    {p.createdBy && (
                      <div>
                        <span className="font-medium">Créé par : </span>
                        {p.createdBy.prenom} {p.createdBy.nom}
                      </div>
                    )}
                  </div>
                  {p.description && <p className="text-sm text-gray-600 mt-2">{p.description}</p>}

                  {p.entites?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-medium text-gray-500 uppercase mb-1">Entités</p>
                      <div className="flex flex-wrap gap-1">
                        {p.entites.map((pe: any) => {
                          const eid = pe.entite?.id || pe.entiteId;
                          return (
                            <button
                              key={eid}
                              type="button"
                              onClick={() => eid && navigate(`/entites/${eid}`)}
                              className="px-2 py-0.5 bg-teal-100 text-teal-800 rounded text-xs hover:bg-teal-200"
                            >
                              🏢 {pe.entite?.nom || '—'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {p.categories?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.categories.map((pc: any) => (
                        <span
                          key={pc.categorie?.id || pc.categorieId}
                          className="px-2 py-0.5 text-xs rounded"
                          style={{
                            backgroundColor: pc.categorie?.couleur ? `${pc.categorie.couleur}20` : '#E5E7EB',
                            color: pc.categorie?.couleur || '#374151',
                          }}
                        >
                          {pc.categorie?.nom}
                        </span>
                      ))}
                    </div>
                  )}

                  {(p.documentsListe?.length > 0 || p.licencesListe?.length > 0 || p.projetsListe?.length > 0) && (
                    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                      {p.documentsListe?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Documents liés</p>
                          <div className="flex flex-wrap gap-1">
                            {p.documentsListe.map((d: any) => (
                              <a
                                key={d.id}
                                href={`${API_BASE_URL}/documents/${d.id}/view${tokenQs()}`}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-0.5 bg-gray-100 rounded text-xs text-blue-600 hover:underline"
                              >
                                📎 {d.nom}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {p.licencesListe?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Licences</p>
                          <div className="flex flex-wrap gap-1">
                            {p.licencesListe.map((l: any) => (
                              <span
                                key={l.id}
                                className="px-2 py-0.5 bg-amber-50 text-amber-900 rounded text-xs border border-amber-100"
                              >
                                📜 {l.nom} ({l.reference})
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {p.projetsListe?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Projets (entités communes)</p>
                          <div className="flex flex-wrap gap-1">
                            {p.projetsListe.map((pr: any) => (
                              <button
                                key={pr.id}
                                type="button"
                                onClick={() => navigate(`/projets/${pr.id}`)}
                                className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200"
                              >
                                📁 {pr.nom}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                    <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                      {isAccesRestreintProcessus(p) ? (
                        <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                          <span className="text-sm leading-none" aria-hidden>
                            🔒
                          </span>
                          <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">
                            Accès restreint
                          </span>
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                          <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                        </div>
                      )}
                      <AccessContratLikeAdminLines
                        users={users}
                        createdById={p.createdById}
                        createdBy={p.createdBy}
                        adminSansAccesUserIds={p.adminSansAccesUserIds}
                        permissions={processusPermissionsForAdminLines(p.permissions || [])}
                        droitsAdminCompletLabel={droitsAdminLigne}
                        niveauLabel={(n) => n}
                        keyPrefix={`liste-proc-${p.id}`}
                        creatorRightsLabel={droitsAdminLigne}
                      />
                      {(p.accesApercu?.delegations || []).map((d: any) => (
                        <div
                          key={`${d.user?.id}-${(d.permissionEntryIds || []).join('-')}`}
                          className="min-w-0"
                        >
                          <span className="font-medium text-gray-900">
                            {d.user.prenom} {d.user.nom}
                          </span>
                          <span className="text-gray-500 italic block sm:inline sm:ml-1">
                            ({permSummaryLineProcessus(d.permissions || [])})
                          </span>
                        </div>
                      ))}
                      <p className="text-[10px] text-gray-500 w-full basis-full">
                        Aligné sur les contrats : exclusion ou droits explicites pour les administrateurs sont visibles ici et
                        gérés dans la modale « Accès » (créateur, propriétaire ou permission « Gestion des accès »).
                      </p>
                    </div>
                  </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                      <button
                        type="button"
                        onClick={() => navigate(`/processus/${p.id}`)}
                        className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                      >
                        👁 Détails
                      </button>
                      {capModify(p) && (
                        <button
                          type="button"
                          onClick={() => navigate(`/processus/${p.id}`, { state: { openEdit: true } })}
                          className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          ✏️ Modifier
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onAccesButtonClick(p)}
                        className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200"
                      >
                        🔐 Accès
                      </button>
                      <button
                        type="button"
                        onClick={() => openHistoriqueModal(p)}
                        className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                      >
                        📜 Historique
                      </button>
                      {capDelete(p) && (
                        <button
                          type="button"
                          onClick={() => handleDelete(p.id, p.nom)}
                          disabled={deletingId === p.id}
                          className={`px-3 py-1.5 text-xs rounded ${
                            deletingId === p.id
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-red-100 text-red-700 hover:bg-red-200'
                          }`}
                        >
                          {deletingId === p.id ? '…' : '🗑 Mettre en corbeille'}
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

      {processusList.length > PAGE_SIZE && (
        <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 flex-wrap gap-3">
          <div className="text-sm text-gray-700">
            Affichage {startIdx + 1}-{Math.min(startIdx + PAGE_SIZE, processusList.length)} sur{' '}
            {processusList.length}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPage((pg) => Math.max(1, pg - 1))}
              disabled={safePage === 1}
              className={`px-4 py-2 rounded text-sm font-medium ${
                safePage === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              Précédent
            </button>
            <div className="flex gap-1 flex-wrap items-center">
              {getPaginationPageNumbers(safePage, totalPages).map((pg, idx) =>
                typeof pg === 'string' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">
                    {pg}
                  </span>
                ) : (
                  <button
                    key={pg}
                    type="button"
                    onClick={() => setPage(pg)}
                    className={`px-3 py-2 rounded text-sm font-medium ${
                      safePage === pg
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {pg}
                  </button>
                )
              )}
            </div>
            <button
              type="button"
              onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
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

      {showCorbeilleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-semibold">🗑 Processus en corbeille</h2>
              <button
                type="button"
                onClick={() => setShowCorbeilleModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              {corbeilleProcessus.length === 0 && (
                <p className="text-sm text-gray-500">Aucun processus en corbeille.</p>
              )}
              {corbeilleProcessus.map((cp: any) => (
                <div
                  key={cp.id}
                  className="flex flex-wrap justify-between items-center gap-3 p-3 border rounded-lg bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{cp.nom}</p>
                    <p className="text-xs text-gray-500 font-mono">{cp.codeProcessus}</p>
                    <p className="text-xs text-gray-500">
                      Supprimé le {cp.deletedAt ? new Date(cp.deletedAt).toLocaleString('fr-FR') : '—'}
                      {cp.createdBy && ` · Créé par ${cp.createdBy.prenom} ${cp.createdBy.nom}`}
                    </p>
                  </div>
                  {canRestoreProcessusCorbeille(cp) ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreProcessusFromCorbeille(cp.id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                    >
                      Restaurer
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400 shrink-0">
                      Restauration : admin, créateur ou propriétaire
                    </span>
                  )}
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-2">
                La suppression définitive reste réservée aux administrateurs (corbeille globale).
              </p>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-auto">
            <div className="p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Nouveau processus</h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    resetCreateModal();
                  }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                  <input
                    type="text"
                    required
                    value={formData.nom}
                    onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Code processus *</label>
                  <input
                    type="text"
                    required
                    value={formData.codeProcessus}
                    onChange={(e) =>
                      setFormData({ ...formData, codeProcessus: e.target.value.toUpperCase() })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Entité(s)</label>
                  <select
                    multiple
                    value={formData.entiteIds}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                      setFormData({ ...formData, entiteIds: selected });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    size={5}
                  >
                    {entites.map((entite) => (
                      <option key={entite.id} value={entite.id}>
                        {entite.nom} ({entite.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Catégorie(s)</label>
                  <select
                    multiple
                    value={formData.categorieIds}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                      setFormData({ ...formData, categorieIds: selected });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    size={5}
                  >
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nom}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Propriétaire (optionnel)</label>
                  <select
                    value={formData.proprietaireId}
                    onChange={(e) => setFormData({ ...formData, proprietaireId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="">— Non défini —</option>
                    {users
                      .filter((u: any) => u.role === 'admin' || u.role === 'contributeur')
                      .map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.prenom} {u.nom} ({u.email})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/80">
                  <p className="text-sm font-medium text-gray-800 mb-1">Accès initial au processus</p>
                  <p className="text-xs text-gray-600 mb-3 leading-relaxed">
                    Les administrateurs ont toujours tous les droits. Vous (créateur) et le propriétaire désigné
                    avez les droits étendus sans être listés ici. Ajoutez d&apos;autres utilisateurs et le niveau de
                    droit accordé dès la création.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                    <select
                      value={createPermDraftUserId}
                      onChange={(e) => setCreatePermDraftUserId(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
                    >
                      <option value="">— Utilisateur —</option>
                      {users
                        .filter(
                          (u: any) =>
                            (!u.statut || u.statut === 'actif') &&
                            u.role !== 'admin' &&
                            u.id !== currentUser?.id &&
                            u.id !== formData.proprietaireId
                        )
                        .map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.prenom} {u.nom} ({u.email})
                          </option>
                        ))}
                    </select>
                    <select
                      value={createPermDraftType}
                      onChange={(e) => setCreatePermDraftType(e.target.value)}
                      className="w-full sm:w-52 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
                    >
                      {PERM_OPTIONS.map((n) => (
                        <option key={n.value} value={n.value}>
                          {n.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (!createPermDraftUserId) return;
                        if (
                          createInitialPermissions.some(
                            (x) =>
                              x.userId === createPermDraftUserId && x.permission === createPermDraftType
                          )
                        ) {
                          return;
                        }
                        setCreateInitialPermissions((prev) => [
                          ...prev,
                          { userId: createPermDraftUserId, permission: createPermDraftType },
                        ]);
                        setCreatePermDraftUserId('');
                        setCreatePermDraftType('lecture');
                      }}
                      disabled={!createPermDraftUserId}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0"
                    >
                      Ajouter
                    </button>
                  </div>
                  {createInitialPermissions.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {createInitialPermissions.map((row) => {
                        const u = users.find((x: any) => x.id === row.userId);
                        return (
                          <li
                            key={`${row.userId}-${row.permission}`}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm border border-gray-200 rounded-md px-3 py-2 bg-white"
                          >
                            <span>
                              <span className="font-medium">
                                {u ? `${u.prenom} ${u.nom}` : row.userId}
                              </span>
                              <span className="text-gray-500">
                                {' '}
                                — {PERMISSION_LABELS[row.permission] || row.permission}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setCreateInitialPermissions((prev) =>
                                  prev.filter((x) => !(x.userId === row.userId && x.permission === row.permission))
                                )
                              }
                              className="text-xs text-red-600 hover:underline"
                            >
                              Retirer
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false);
                      resetCreateModal();
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
                  >
                    {submitting ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {accesModalProc && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {accesModalProc.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Le <span className="font-medium">créateur</span>, le <span className="font-medium">propriétaire</span> du
              processus et les utilisateurs avec la permission <span className="font-medium">« Gestion des accès »</span>{' '}
              peuvent gérer les droits. Pour un administrateur : sans ligne dans « Accès partagés » et sans exclusion, accès
              complet ; une ligne limite les droits ; « Retirer l&apos;accès » retire tout accès jusqu&apos;à octroi via «
              Accorder un accès » ; « Rétablir l&apos;accès admin par défaut » annule une exclusion.
            </p>
            {accesDetail && !accesDetail.canManagePermissions && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant que créateur,
                propriétaire ou avec la permission « Gestion des accès ».
              </p>
            )}
            {accesLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : accesDetail ? (
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
                  <p className="text-xs text-gray-500 mb-2">
                    Limitez un admin avec « Limiter l&apos;accès », retirez-le entièrement avec « Retirer l&apos;accès », ou
                    rétablissez l&apos;accès complet implicite s&apos;il était exclu.
                  </p>
                  <ul className="space-y-3 text-gray-700 text-sm">
                    {(accesDetail.admins || []).map((a: any) => {
                      const userDelegations = (accesDetail.delegations || []).filter((d: any) => d.user?.id === a.id);
                      const primaryDelegation = userDelegations[0];
                      const explicite = userDelegations.length > 0;
                      const isPrivilegedAdmin =
                        accesDetail.creator?.id === a.id || accesModalProc.proprietaireId === a.id;
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
                          {accesDetail.canManagePermissions && !isPrivilegedAdmin && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {refuse && !explicite ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRestoreAdminDefaultProcessus(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !explicite ? (
                                <>
                                  <select
                                    value={adminLimitPerm[a.id] ?? 'lecture'}
                                    onChange={(e) =>
                                      setAdminLimitPerm((prev) => ({ ...prev, [a.id]: e.target.value }))
                                    }
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {PERM_OPTIONS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void quickLimitAdminProcessus(a.id)}
                                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                  >
                                    Limiter l&apos;accès
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRevokeAdminImplicitProcessus(a.id)}
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
                                      if (!accesModalProc || permission === primaryDelegation?.permission) return;
                                      void replaceAdminProcessusPermissionLevel(a.id, permission);
                                    }}
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {PERM_OPTIONS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void revokeAllProcessusDelegationsForUser(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Révoquer l&apos;accès
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {accesDetail.canManagePermissions && isPrivilegedAdmin && (
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
                  {accesDetail.creator ? (
                    <p>
                      <span className="font-medium">
                        {accesDetail.creator.prenom} {accesDetail.creator.nom}
                      </span>
                      <span className="text-gray-400"> — droits étendus et gestion des accès (si habilité)</span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Créateur non résolu (processus système ou sans créateur).</p>
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
                          {d.grantedBy && (
                            <span className="text-xs text-gray-400">
                              par {d.grantedBy.prenom} {d.grantedBy.nom}
                            </span>
                          )}
                          {accesDetail.canManagePermissions ? (
                            <>
                              <select
                                value={d.permission}
                                onChange={(e) => {
                                  const permission = e.target.value;
                                  if (!accesModalProc || permission === d.permission) return;
                                  void replaceAdminProcessusPermissionLevel(d.user.id, permission);
                                }}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {PERM_OPTIONS.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleRemovePermissionEntry(d.id, d.user?.role === 'admin')
                                }
                                className="text-xs text-red-600 hover:underline ml-auto"
                              >
                                {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-500">
                              — {PERMISSION_LABELS[d.permission] || d.permission}
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
                            (u: any) =>
                              (!u.statut || u.statut === 'actif') &&
                              u.id !== accesDetail.creator?.id &&
                              u.id !== accesModalProc.proprietaireId
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
                        value={newPermType}
                        onChange={(e) => setNewPermType(e.target.value)}
                        className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        {PERM_OPTIONS.map((n) => (
                          <option key={n.value} value={n.value}>
                            {n.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAddPermission()}
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
                onClick={() => setAccesModalProc(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {histModalProc && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {histModalProc.nom}</h3>
            {histoLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : histoList.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucun événement enregistré</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {histoList.map((h: any) => (
                  <li key={h.id} className="border-b border-gray-100 pb-2">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500">
                      <span>{new Date(h.timestamp).toLocaleString('fr-FR')}</span>
                      <span>
                        {h.user?.prenom} {h.user?.nom}
                      </span>
                    </div>
                    <p className="font-medium text-gray-800">
                      {LABEL_LOG_ACTION[h.action] || h.action}
                      {h.ressourceType && (
                        <span className="text-gray-500 font-normal">
                          {' '}
                          · {LABEL_RESSOURCE[h.ressourceType] || h.ressourceType}
                        </span>
                      )}
                    </p>
                    {h.ressourceNom && <p className="text-gray-600 text-xs mt-0.5">{h.ressourceNom}</p>}
                    {h.details != null && (
                      <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-x-auto max-h-32">
                        {typeof h.details === 'string' ? h.details : JSON.stringify(h.details, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setHistModalProc(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
