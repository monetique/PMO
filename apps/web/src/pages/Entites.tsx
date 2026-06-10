import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import { getPaginationPageNumbers } from '../utils/pagination';

const LABEL_PERM_ROW: Record<string, string> = {
  lecture: 'lecture',
  modification: 'modification',
  suppression: 'suppression',
  gestion: 'gestion des droits',
};

const LABEL_PERM_MODAL: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des droits',
};

const ENTITE_PERM_LEVELS = [
  { value: 'lecture', label: '👁 Consultation' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression (mise en corbeille)' },
  { value: 'gestion', label: '🔐 Gestion des droits' },
];

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

function permSummaryLine(perms: string[]) {
  return perms.map((p) => LABEL_PERM_ROW[p] || p).join(' + ');
}

function isAccesRestreintEntite(e: any) {
  return !!e.createdById || (e.accesApercu?.delegations?.length ?? 0) > 0;
}

const droitsAdminLigne = 'modification + suppression + gestion des accès + lecture';

function entitePermissionsForAdminLines(delegations: any[]) {
  return (delegations || []).map((d: any) => ({
    userId: d.user?.id,
    niveau: permSummaryLine(d.permissions || []),
    user: d.user,
  }));
}

function countEntitesInTree(nodes: any[]): number {
  if (!nodes?.length) return 0;
  return nodes.reduce((acc, n) => acc + 1 + countEntitesInTree(n.children || []), 0);
}

function entiteMembreUsers(node: any) {
  const list = (node.membres || [])
    .map((m: any) => m.user)
    .filter((u: any) => u?.id);
  const byId = new Map<string, any>();
  for (const u of list) {
    if (!byId.has(u.id)) byId.set(u.id, u);
  }
  return Array.from(byId.values()).sort((a, b) =>
    `${a.prenom} ${a.nom}`.localeCompare(`${b.prenom} ${b.nom}`, 'fr', { sensitivity: 'base' })
  );
}

function userNomAvecFonction(u: { prenom?: string; nom?: string; fonction?: string | null }) {
  const n = `${u.prenom ?? ''} ${u.nom ?? ''}`.trim();
  return u.fonction ? `${n} · ${u.fonction}` : n;
}

function entiteDelegationsForTree(node: any) {
  const dels = node.accesApercu?.delegations;
  if (!Array.isArray(dels) || dels.length === 0) return [];
  return dels
    .filter((d: any) => d.user?.id)
    .map((d: any) => ({
      user: d.user,
      label: permSummaryLine(d.permissions || []),
    }))
    .sort((a: any, b: any) =>
      `${a.user.prenom} ${a.user.nom}`.localeCompare(`${b.user.prenom} ${b.user.nom}`, 'fr', {
        sensitivity: 'base',
      })
    );
}

function EntiteTreeNodes({ nodes, depth, navigate }: { nodes: any[]; depth: number; navigate: (to: string) => void }) {
  if (!nodes?.length) return null;
  return (
    <ul className={depth === 0 ? 'space-y-0.5' : 'mt-0.5 ml-3 pl-3 border-l border-gray-200 space-y-0.5'}>
      {nodes.map((node) => {
        const typeLabel = node.typeEntite?.libelle || node.typeEntite?.code || '—';
        const children = node.children as any[] | undefined;
        const hasChildren = Array.isArray(children) && children.length > 0;
        const membreUsers = entiteMembreUsers(node);
        const delegRows = entiteDelegationsForTree(node);
        return (
          <li key={node.id}>
            <div className="py-1.5 pr-2 rounded-md hover:bg-slate-50 text-sm group space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded text-xs font-medium shrink-0">{typeLabel}</span>
                <button
                  type="button"
                  onClick={() => navigate(`/entites/${node.id}`)}
                  className="font-medium text-gray-900 hover:text-blue-600 text-left"
                >
                  {node.nom}
                </button>
                <span className="text-gray-500 font-mono text-xs">{node.code}</span>
                {node.responsable && (
                  <span className="text-xs text-gray-600">
                    <span className="text-gray-400">Responsable :</span>{' '}
                    {userNomAvecFonction(node.responsable)}
                  </span>
                )}
              </div>
              {(membreUsers.length > 0 || delegRows.length > 0) && (
                <div className="pl-0 sm:pl-1 space-y-0.5 text-xs text-gray-600 border-t border-gray-100/80 pt-1 mt-0.5">
                  {membreUsers.length > 0 && (
                    <div className="flex flex-wrap gap-x-1 gap-y-0.5 items-baseline">
                      <span className="font-medium text-gray-500 shrink-0">Membres :</span>
                      <span className="flex flex-wrap gap-1">
                        {membreUsers.map((u: any) => (
                          <span
                            key={u.id}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-800"
                          >
                            {userNomAvecFonction(u)}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                  {delegRows.length > 0 && (
                    <div className="flex flex-wrap gap-x-1 gap-y-0.5 items-baseline">
                      <span className="font-medium text-gray-500 shrink-0">Droits délégués :</span>
                      <span className="flex flex-wrap gap-1">
                        {delegRows.map((d: any) => (
                          <span
                            key={d.user.id}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-violet-50 text-violet-900"
                            title={d.label}
                          >
                            {userNomAvecFonction(d.user)}
                            <span className="text-violet-600 font-normal ml-1">({d.label})</span>
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            {hasChildren ? <EntiteTreeNodes nodes={children!} depth={depth + 1} navigate={navigate} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function Entites() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isLecteur = currentUser?.role === 'lecteur';

  const [entites, setEntites] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [typesEntite, setTypesEntite] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    nom: '',
    code: '',
    typeEntiteId: '',
    parentId: '',
    responsableId: '',
    description: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    typeEntiteId: '',
    parentId: '',
    responsableId: '',
  });
  const [showFiltres, setShowFiltres] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [accesModalEntite, setAccesModalEntite] = useState<any | null>(null);
  const [accesDetail, setAccesDetail] = useState<any | null>(null);
  const [accesLoading, setAccesLoading] = useState(false);
  const [adminLimitPerm, setAdminLimitPerm] = useState<Record<string, string>>({});
  const [newPermUserId, setNewPermUserId] = useState('');
  const [newPermType, setNewPermType] = useState('lecture');
  const [histModalEntite, setHistModalEntite] = useState<any | null>(null);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);
  const [expandedEntiteIds, setExpandedEntiteIds] = useState<Set<string>>(() => new Set());
  const [showCorbeilleModal, setShowCorbeilleModal] = useState(false);
  const [corbeilleEntites, setCorbeilleEntites] = useState<any[]>([]);
  const [viewMode, setViewMode] = useState<'liste' | 'hierarchie'>('liste');
  const [entiteTree, setEntiteTree] = useState<any[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const toggleEntiteRow = (id: string) => {
    setExpandedEntiteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isEntiteRowExpanded = (id: string) => expandedEntiteIds.has(id);

  useEffect(() => {
    loadEntites();
    loadUsers();
    void (async () => {
      try {
        const r = await api.get('/types-entite');
        setTypesEntite(Array.isArray(r.data) ? r.data : []);
      } catch {
        setTypesEntite([]);
      }
    })();
  }, []);

  useEffect(() => {
    loadEntites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.typeEntiteId, filters.parentId, filters.responsableId, sortConfig]);

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.typeEntiteId, filters.parentId, filters.responsableId, sortConfig]);

  const loadEntiteTree = useCallback(async () => {
    setTreeLoading(true);
    try {
      const r = await api.get('/entites/tree');
      setEntiteTree(Array.isArray(r.data) ? r.data : []);
    } catch {
      setEntiteTree([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewMode === 'hierarchie') {
      void loadEntiteTree();
    }
  }, [viewMode, loadEntiteTree]);

  const loadCorbeilleEntites = async () => {
    try {
      const r = await api.get('/entites/corbeille');
      setCorbeilleEntites(Array.isArray(r.data) ? r.data : []);
    } catch {
      setCorbeilleEntites([]);
    }
  };

  const handleRestoreEntiteFromCorbeille = async (id: string) => {
    try {
      await api.post(`/corbeille/entites/${id}/restaurer`);
      setShowCorbeilleModal(false);
      await loadEntites();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur lors de la restauration');
    }
  };

  const canRestoreEntiteCorbeille = (row: any) =>
    currentUser?.role === 'admin' ||
    row.createdById === currentUser?.id ||
    row.createdBy?.id === currentUser?.id ||
    row.responsableId === currentUser?.id ||
    row.responsable?.id === currentUser?.id;

  const cap = (e: any) => ({
    canView: e.capabilities?.canView !== false,
    canModify: !!e.capabilities?.canModify,
    canDelete: !!e.capabilities?.canDelete,
    canManagePermissions: !!e.capabilities?.canManagePermissions,
  });

  const onAccesButtonClick = (e: any) => {
    void openAccesModal(e);
  };

  const openAccesModal = async (entite: any) => {
    setAccesModalEntite(entite);
    setAccesDetail(null);
    setNewPermUserId('');
    setNewPermType('lecture');
    setAdminLimitPerm({});
    setAccesLoading(true);
    try {
      const { data } = await api.get(`/entites/${entite.id}/acces`);
      setAccesDetail(data);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur chargement accès');
      setAccesModalEntite(null);
    } finally {
      setAccesLoading(false);
    }
  };

  const refreshAccesDetail = async (id: string) => {
    const { data } = await api.get(`/entites/${id}/acces`);
    setAccesDetail(data);
  };

  const handleAddPermission = async () => {
    if (!accesModalEntite || !newPermUserId) return;
    try {
      await api.post(`/entites/${accesModalEntite.id}/permissions`, {
        userId: newPermUserId,
        permission: newPermType,
      });
      setNewPermUserId('');
      await refreshAccesDetail(accesModalEntite.id);
      loadEntites();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const handleRemovePermission = async (permissionId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit explicite sur cette entité. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès »."
      : 'Retirer ce droit ?';
    if (!accesModalEntite || !window.confirm(msg)) return;
    try {
      await api.delete(`/entites/${accesModalEntite.id}/permissions/${permissionId}`);
      await refreshAccesDetail(accesModalEntite.id);
      loadEntites();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const revokeAllEntiteDelegationsForUser = async (userId: string) => {
    if (!accesModalEntite || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    if (rows.length === 0) return;
    if (!window.confirm('Révoquer tous les droits explicites pour cet utilisateur sur cette entité ?')) return;
    try {
      for (const r of rows) {
        await api.delete(`/entites/${accesModalEntite.id}/permissions/${r.id}`);
      }
      await refreshAccesDetail(accesModalEntite.id);
      loadEntites();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const handleRestoreAdminDefaultEntite = async (userId: string) => {
    if (!accesModalEntite) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/entites/${accesModalEntite.id}/admin-sans-acces/${userId}`);
      await refreshAccesDetail(accesModalEntite.id);
      loadEntites();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const handleRevokeAdminImplicitEntite = async (userId: string) => {
    if (!accesModalEntite) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus l'entité tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous."
      )
    ) {
      return;
    }
    try {
      await api.post(`/entites/${accesModalEntite.id}/admin-sans-acces`, { userId });
      await refreshAccesDetail(accesModalEntite.id);
      loadEntites();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const quickLimitAdminEntite = async (userId: string) => {
    if (!accesModalEntite) return;
    const permission = adminLimitPerm[userId] || 'lecture';
    try {
      await api.post(`/entites/${accesModalEntite.id}/permissions`, { userId, permission });
      await refreshAccesDetail(accesModalEntite.id);
      loadEntites();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const replaceAdminEntitePermissionLevel = async (userId: string, permission: string) => {
    if (!accesModalEntite || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    try {
      for (const r of rows) {
        await api.delete(`/entites/${accesModalEntite.id}/permissions/${r.id}`);
      }
      await api.post(`/entites/${accesModalEntite.id}/permissions`, { userId, permission });
      await refreshAccesDetail(accesModalEntite.id);
      loadEntites();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const openHistoriqueModal = async (e: any) => {
    setHistModalEntite(e);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/entites/${e.id}/history?page=1&limit=200`);
      setHistoList(data?.data || []);
    } catch {
      setHistoList([]);
      alert('Impossible de charger l’historique.');
      setHistModalEntite(null);
    } finally {
      setHistoLoading(false);
    }
  };

  const loadEntites = async () => {
    try {
      const params: any = {};
      if (filters.search) params.search = filters.search;
      if (filters.typeEntiteId) params.typeEntiteId = filters.typeEntiteId;
      if (filters.parentId) params.parentId = filters.parentId;
      if (filters.responsableId) params.responsableId = filters.responsableId;
      if (sortConfig) {
        params.sortBy = sortConfig.key;
        params.sortOrder = sortConfig.direction;
      }
      const response = await api.get('/entites', { params });
      let sortedEntites = response.data;

      if (sortConfig?.key === 'responsable') {
        sortedEntites = [...response.data].sort((a, b) => {
          const aName = a.responsable ? userNomAvecFonction(a.responsable) : '';
          const bName = b.responsable ? userNomAvecFonction(b.responsable) : '';
          return sortConfig.direction === 'asc'
            ? aName.localeCompare(bName, 'fr', { sensitivity: 'base' })
            : bName.localeCompare(aName, 'fr', { sensitivity: 'base' });
        });
      } else if (sortConfig?.key === 'parent') {
        sortedEntites = [...response.data].sort((a, b) => {
          const aName = a.parent ? `${a.parent.nom} (${a.parent.code})` : 'N/A';
          const bName = b.parent ? `${b.parent.nom} (${b.parent.code})` : 'N/A';
          return sortConfig.direction === 'asc'
            ? aName.localeCompare(bName, 'fr', { sensitivity: 'base' })
            : bName.localeCompare(aName, 'fr', { sensitivity: 'base' });
        });
      }

      setEntites(sortedEntites);
    } catch (err) {
      console.error('Erreur:', err);
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

  const loadUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (err) {
      console.error('Erreur chargement utilisateurs:', err);
    }
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (!formData.nom || !formData.code || !formData.typeEntiteId) {
        setError('Le nom, le code et le type d’entité sont obligatoires');
        return;
      }

      if (isEditing && editingId) {
        await api.put(`/entites/${editingId}`, {
          nom: formData.nom,
          code: formData.code.toUpperCase(),
          typeEntiteId: formData.typeEntiteId,
          parentId: formData.parentId || undefined,
          responsableId: formData.responsableId || undefined,
          description: formData.description || undefined,
        });
      } else {
        await api.post('/entites', {
          nom: formData.nom,
          code: formData.code.toUpperCase(),
          typeEntiteId: formData.typeEntiteId,
          parentId: formData.parentId || undefined,
          responsableId: formData.responsableId || undefined,
          description: formData.description || undefined,
          membreIds: [],
        });
      }

      setShowModal(false);
      setIsEditing(false);
      setEditingId(null);
      setFormData({
        nom: '',
        code: '',
        typeEntiteId: typesEntite.find((t) => t.actif)?.id || '',
        parentId: '',
        responsableId: '',
        description: '',
      });
      loadEntites();
      if (viewMode === 'hierarchie') void loadEntiteTree();
    } catch (err: any) {
      setError(err.response?.data?.error || `Erreur lors de ${isEditing ? 'la modification' : 'la création'}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (entiteId: string) => {
    try {
      const response = await api.get(`/entites/${entiteId}`);
      const entite = response.data;

      setFormData({
        nom: entite.nom || '',
        code: entite.code || '',
        typeEntiteId: entite.typeEntiteId || entite.typeEntite?.id || '',
        parentId: entite.parentId || '',
        responsableId: entite.responsableId || '',
        description: entite.description || '',
      });

      setIsEditing(true);
      setEditingId(entiteId);
      setShowModal(true);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || "Erreur lors du chargement de l'entité");
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setIsEditing(false);
    setEditingId(null);
    setError('');
    setFormData({
      nom: '',
      code: '',
      typeEntiteId: typesEntite.find((t) => t.actif)?.id || '',
      parentId: '',
      responsableId: '',
      description: '',
    });
  };

  const handleSoftDelete = async (id: string, nom: string) => {
    if (
      !confirm(
        `Mettre l’entité « ${nom} » en corbeille ? (restauration possible ; suppression définitive depuis la corbeille globale)`
      )
    )
      return;
    try {
      await api.delete(`/entites/${id}`);
      loadEntites();
      if (viewMode === 'hierarchie') void loadEntiteTree();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const totalPages = Math.max(1, Math.ceil(entites.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pagedEntites = entites.slice(startIdx, startIdx + pageSize);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-10 text-gray-400">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 flex-1 min-w-0">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Entités</h1>
              <p className="text-sm text-gray-500 mt-1">
                {viewMode === 'liste'
                  ? `${entites.length} entité(s) — vue liste`
                  : treeLoading
                    ? 'Chargement de l’arborescence…'
                    : `${countEntitesInTree(entiteTree)} entité(s) — arborescence parent / enfant`}
              </p>
            </div>
            <div
              className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-100/90 shrink-0"
              role="group"
              aria-label="Mode d’affichage"
            >
              <button
                type="button"
                onClick={() => setViewMode('liste')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  viewMode === 'liste'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Vue liste
              </button>
              <button
                type="button"
                onClick={() => setViewMode('hierarchie')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  viewMode === 'hierarchie'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Vue hiérarchie
              </button>
            </div>
          </div>
        <div className="flex flex-wrap gap-2 justify-end lg:shrink-0">
          <button
            type="button"
            onClick={async () => {
              await loadCorbeilleEntites();
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
                setIsEditing(false);
                setEditingId(null);
                setFormData({
                  nom: '',
                  code: '',
                  typeEntiteId: typesEntite.find((t) => t.actif)?.id || '',
                  parentId: '',
                  responsableId: '',
                  description: '',
                });
                setShowModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
            >
              + Nouvelle entité
            </button>
          )}
        </div>
        </div>
      </div>

      {viewMode === 'liste' && (
      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>
            Filtres
            {(filters.search || filters.typeEntiteId || filters.parentId || filters.responsableId) ? ' ●' : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Recherche</label>
                <input
                  type="text"
                  value={filters.search}
                  onChange={(ev) => setFilters({ ...filters, search: ev.target.value })}
                  placeholder="Nom, code, description"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select
                  value={filters.typeEntiteId}
                  onChange={(ev) => setFilters({ ...filters, typeEntiteId: ev.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  {typesEntite.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.libelle}
                      {!t.actif ? ' (inactif)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Entité parente</label>
                <select
                  value={filters.parentId}
                  onChange={(ev) => setFilters({ ...filters, parentId: ev.target.value })}
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Responsable</label>
                <select
                  value={filters.responsableId}
                  onChange={(ev) => setFilters({ ...filters, responsableId: ev.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  {users
                    .filter((u) => u.role === 'admin' || u.role === 'contributeur')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.prenom} {u.nom}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2 mt-4 pt-2 border-t border-gray-100">
              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                <span className="font-medium">Tri rapide :</span>
                {['code', 'nom', 'type', 'responsable', 'parent'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleSort(k)}
                    className={`hover:text-blue-600 ${sortConfig?.key === k ? 'text-blue-600 font-semibold' : ''}`}
                  >
                    {k}
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
                onClick={() => setFilters({ search: '', typeEntiteId: '', parentId: '', responsableId: '' })}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {viewMode === 'hierarchie' && (
        <div className="bg-white rounded-lg shadow mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-slate-50/80">
            <p className="text-sm font-medium text-gray-800">Relations entre entités</p>
            <p className="text-xs text-gray-500 mt-1">
              Chaque niveau représente une entité enfant rattachée à son parent. Les filtres de la vue liste ne s’appliquent pas ici — toutes les entités auxquelles vous avez accès sont affichées.
            </p>
          </div>
          <div className="p-4 sm:p-5 max-h-[min(70vh,720px)] overflow-y-auto">
            {treeLoading ? (
              <p className="text-sm text-gray-500 py-6 text-center">Chargement de l’arborescence…</p>
            ) : entiteTree.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">Aucune entité racine ou aucune entité accessible.</p>
            ) : (
              <EntiteTreeNodes nodes={entiteTree} depth={0} navigate={navigate} />
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">{isEditing ? '✏️ Modifier l’entité' : '+ Nouvelle entité'}</h2>
                <button type="button" onClick={handleCloseModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
                  ✕
                </button>
              </div>

              {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nom}
                    onChange={(ev) => setFormData({ ...formData, nom: ev.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Nom de l'entité"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Code <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.code}
                    onChange={(ev) => setFormData({ ...formData, code: ev.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="ENT-001"
                    disabled={isEditing}
                  />
                  {isEditing && <p className="text-xs text-gray-500 mt-1">Le code ne peut pas être modifié</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                  <select
                    required
                    value={formData.typeEntiteId}
                    onChange={(ev) => setFormData({ ...formData, typeEntiteId: ev.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    {typesEntite
                      .filter((t) => t.actif || t.id === formData.typeEntiteId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.libelle}
                        </option>
                      ))}
                  </select>
                  {typesEntite.filter((t) => t.actif || t.id === formData.typeEntiteId).length === 0 && (
                    <p className="text-xs text-amber-700 mt-1">Aucun type disponible : configurez-en dans Configuration → Types d'entité.</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Entité parente</label>
                  <select
                    value={formData.parentId}
                    onChange={(ev) => setFormData({ ...formData, parentId: ev.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">Aucune (racine)</option>
                    {entites
                      .filter((entite) => !isEditing || entite.id !== editingId)
                      .map((entite) => (
                        <option key={entite.id} value={entite.id}>
                          {entite.nom} ({entite.code}) — {entite.typeEntite?.libelle || entite.typeEntite?.code || '—'}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Responsable</label>
                  <select
                    value={formData.responsableId}
                    onChange={(ev) => setFormData({ ...formData, responsableId: ev.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">—</option>
                    {users
                      .filter((u) => u.role === 'admin' || u.role === 'contributeur')
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {userNomAvecFonction(u)} ({u.email})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(ev) => setFormData({ ...formData, description: ev.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Description"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <button type="button" onClick={handleCloseModal} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? 'Enregistrement…' : isEditing ? 'Enregistrer' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'liste' && (
      <Fragment>
      <div className="space-y-4">
        {entites.length === 0 && (
          <div className="text-center py-10 text-gray-400 bg-white rounded-lg shadow">Aucune entité</div>
        )}
        {pagedEntites.map((e) => {
          const c = cap(e);
          const typeLabel = e.typeEntite?.libelle || e.typeEntite?.code || '—';
          const rowOpen = isEntiteRowExpanded(e.id);
          return (
            <div key={e.id} className="bg-white rounded-lg shadow overflow-hidden">
              <button
                type="button"
                onClick={() => toggleEntiteRow(e.id)}
                className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                aria-expanded={rowOpen}
                aria-label={rowOpen ? "Replier le détail de l'entité" : "Afficher le détail et les actions de l'entité"}
              >
                <span className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded text-xs font-medium shrink-0">{typeLabel}</span>
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate">{e.nom}</h2>
                <span className="text-sm text-gray-500 font-mono shrink-0">{e.code}</span>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
                    <div>
                      <span className="font-medium text-gray-700">Responsable : </span>
                      {e.responsable ? userNomAvecFonction(e.responsable) : '—'}
                    </div>
                    <div>
                      <span className="font-medium text-gray-700">Parent : </span>
                      {e.parent ? `${e.parent.nom} (${e.parent.code})` : <span className="text-gray-400">Racine</span>}
                    </div>
                    {e.description && (
                      <div className="sm:col-span-2 text-xs text-gray-500 line-clamp-2">{e.description}</div>
                    )}
                    <div className="sm:col-span-2 text-sm">
                      <span className="font-medium text-gray-700">Créé par : </span>
                      {e.createdBy ? `${e.createdBy.prenom} ${e.createdBy.nom}` : <span className="text-amber-600">Non renseigné (héritage)</span>}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                    <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                      {isAccesRestreintEntite(e) ? (
                        <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                          <span className="text-sm leading-none" aria-hidden>
                            🔒
                          </span>
                          <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">Accès restreint</span>
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                          <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                          <span className="text-[10px] text-green-800/90 text-center mt-0.5">Tous les utilisateurs authentifiés</span>
                        </div>
                      )}
                      <AccessContratLikeAdminLines
                        users={users}
                        createdById={e.createdById}
                        createdBy={e.createdBy}
                        adminSansAccesUserIds={e.adminSansAccesUserIds}
                        permissions={entitePermissionsForAdminLines(e.accesApercu?.delegations || [])}
                        droitsAdminCompletLabel={droitsAdminLigne}
                        niveauLabel={(n) => n}
                        keyPrefix={`liste-ent-${e.id}`}
                        creatorRightsLabel={droitsAdminLigne}
                      />
                      {(e.accesApercu?.delegations || []).map((d: any) => (
                        <div key={d.user.id} className="min-w-0">
                          <span className="font-medium text-gray-900">
                            {userNomAvecFonction(d.user)}
                          </span>
                          <span className="text-gray-500 italic block sm:inline sm:ml-1">
                            {d.permissions?.includes('lecture') && d.permissions?.length === 1 ? (
                              <>👁 ({permSummaryLine(d.permissions)})</>
                            ) : (
                              <> ({permSummaryLine(d.permissions)})</>
                            )}
                          </span>
                        </div>
                      ))}
                      <p className="text-[10px] text-gray-500 w-full basis-full">
                        Aligné sur les contrats : exclusion ou droits explicites pour les administrateurs sont visibles ici et
                        gérés dans la modale « Accès » (créateur ou délégation « Gestion des droits »).
                      </p>
                    </div>
                  </div>
                    </div>

                <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                  {c.canView && (
                    <button
                      type="button"
                      onClick={() => navigate(`/entites/${e.id}`)}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                    >
                      👁 Détails
                    </button>
                  )}
                  {c.canModify && (
                    <button type="button" onClick={() => handleEdit(e.id)} className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                      ✏️ Modifier
                    </button>
                  )}
                  <button type="button" onClick={() => onAccesButtonClick(e)} className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200">
                    🔐 Accès
                  </button>
                  <button
                    type="button"
                    onClick={() => openHistoriqueModal(e)}
                    className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                  >
                    📜 Historique
                  </button>
                  {c.canDelete && (
                    <button
                      type="button"
                      onClick={() => handleSoftDelete(e.id, e.nom)}
                      className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      🗑 Mettre en corbeille
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

      {entites.length > pageSize && (
        <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 flex-wrap gap-3">
          <div className="text-sm text-gray-700">
            Affichage {startIdx + 1}-{Math.min(startIdx + pageSize, entites.length)} sur {entites.length}
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
      </Fragment>
      )}

      {accesModalEntite && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {accesModalEntite.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Le <span className="font-medium">créateur</span> de l&apos;entité et les utilisateurs avec la permission{' '}
              <span className="font-medium">« Gestion des droits »</span> peuvent gérer les accès. Pour un administrateur :
              sans ligne dans « Accès partagés » et sans exclusion, accès complet ; une ligne limite les droits ; « Retirer
              l&apos;accès » retire tout accès jusqu&apos;à octroi via « Accorder un accès » ; « Rétablir l&apos;accès admin par
              défaut » annule une exclusion. Le <span className="font-medium">responsable</span> ne peut pas être exclu ni
              limité depuis cette liste.
            </p>
            {accesDetail && !accesDetail.canManagePermissions && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant que créateur ou
                avec la délégation « Gestion des droits ».
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
                        accesDetail.creator?.id === a.id || accesModalEntite.responsableId === a.id;
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
                                  onClick={() => void handleRestoreAdminDefaultEntite(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !explicite ? (
                                <>
                                  <select
                                    value={adminLimitPerm[a.id] ?? 'lecture'}
                                    onChange={(ev) =>
                                      setAdminLimitPerm((prev) => ({ ...prev, [a.id]: ev.target.value }))
                                    }
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {ENTITE_PERM_LEVELS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void quickLimitAdminEntite(a.id)}
                                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                  >
                                    Limiter l&apos;accès
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRevokeAdminImplicitEntite(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Retirer l&apos;accès
                                  </button>
                                </>
                              ) : (
                                <>
                                  <select
                                    value={primaryDelegation?.permission ?? 'lecture'}
                                    onChange={(ev) => {
                                      const permission = ev.target.value;
                                      if (!accesModalEntite || permission === primaryDelegation?.permission) return;
                                      void replaceAdminEntitePermissionLevel(a.id, permission);
                                    }}
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {ENTITE_PERM_LEVELS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void revokeAllEntiteDelegationsForUser(a.id)}
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
                              Créateur ou responsable : accès étendu, non modérable ici.
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
                      <span className="text-gray-400"> — modification, mise en corbeille, gestion des accès (si habilité)</span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Aucun créateur enregistré (données historiques).</p>
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
                                onChange={(ev) => {
                                  const permission = ev.target.value;
                                  if (!accesModalEntite || permission === d.permission) return;
                                  void replaceAdminEntitePermissionLevel(d.user.id, permission);
                                }}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {ENTITE_PERM_LEVELS.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => void handleRemovePermission(d.id, d.user?.role === 'admin')}
                                className="text-xs text-red-600 hover:underline ml-auto"
                              >
                                {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-500">— {LABEL_PERM_MODAL[d.permission] || d.permission}</span>
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
                        onChange={(ev) => setNewPermUserId(ev.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">— Utilisateur —</option>
                        {(() => {
                          const actifs = users.filter(
                            (u: any) =>
                              (!u.statut || u.statut === 'actif') &&
                              u.id !== accesDetail.creator?.id &&
                              u.id !== accesModalEntite.responsableId
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
                        onChange={(ev) => setNewPermType(ev.target.value)}
                        className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        {ENTITE_PERM_LEVELS.map((n) => (
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
                onClick={() => setAccesModalEntite(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {showCorbeilleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-semibold">🗑 Entités en corbeille</h2>
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
              {corbeilleEntites.length === 0 && (
                <p className="text-sm text-gray-500">Aucune entité en corbeille.</p>
              )}
              {corbeilleEntites.map((ce: any) => (
                <div
                  key={ce.id}
                  className="flex flex-wrap justify-between items-center gap-3 p-3 border rounded-lg bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{ce.nom}</p>
                    <p className="text-xs text-gray-500 font-mono">{ce.code}</p>
                    <p className="text-xs text-gray-500">
                      Supprimé le {ce.deletedAt ? new Date(ce.deletedAt).toLocaleString('fr-FR') : '—'}
                      {ce.createdBy && ` · Créé par ${ce.createdBy.prenom} ${ce.createdBy.nom}`}
                    </p>
                  </div>
                  {canRestoreEntiteCorbeille(ce) ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreEntiteFromCorbeille(ce.id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                    >
                      Restaurer
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400 shrink-0">
                      Restauration : admin, créateur ou responsable
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

      {histModalEntite && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {histModalEntite.nom}</h3>
            {histoLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : histoList.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucun événement enregistré</p>
            ) : (
              <ul className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
                {histoList.map((h: any) => (
                  <li key={h.id} className="border-b border-gray-100 pb-2">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500">
                      <span>{h.timestamp ? new Date(h.timestamp).toLocaleString('fr-FR') : ''}</span>
                      <span>
                        {h.user?.prenom} {h.user?.nom}
                      </span>
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
              <button type="button" onClick={() => setHistModalEntite(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
