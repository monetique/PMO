import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { mergeUserEntitesForDisplay, userEntitesSortLabel } from '../utils/userEntitesDisplay';
import { useAuth } from '../store/auth';

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [entitesList, setEntitesList] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    nom: '',
    email: '',
    role: '',
    statut: '',
    entiteId: '',
  });
  const [showFiltres, setShowFiltres] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);
  const [statusBusyById, setStatusBusyById] = useState<Record<string, boolean>>({});
  const pageSize = 10;
  const [formData, setFormData] = useState({
    nom: '',
    prenom: '',
    email: '',
    fonction: '',
    password: '',
    confirmPassword: '',
    role: 'contributeur',
    statut: 'actif',
    entiteIds: [] as string[],
  });

  useEffect(() => {
    loadUsers();
    loadEntites();
  }, []);

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.nom, filters.email, filters.role, filters.statut, filters.entiteId, sortConfig]);
  useEffect(() => {
    setPage(1);
  }, [filters.nom, filters.email, filters.role, filters.statut, filters.entiteId, sortConfig]);

  const loadUsers = async () => {
    try {
      const params: any = {};
      if (filters.nom) params.nom = filters.nom;
      if (filters.email) params.email = filters.email;
      if (filters.role) params.role = filters.role;
      if (filters.statut) params.statut = filters.statut;
      if (filters.entiteId) params.entiteId = filters.entiteId;
      if (sortConfig) {
        params.sortBy = sortConfig.key;
        params.sortOrder = sortConfig.direction;
      }
      const response = await api.get('/users', { params });
      let sortedUsers = response.data;
      
      // Tri côté client pour les entités (car Prisma ne peut pas trier directement par relation)
      if (sortConfig?.key === 'entites') {
        sortedUsers = [...response.data].sort((a, b) => {
          const aEntites = userEntitesSortLabel(mergeUserEntitesForDisplay(a));
          const bEntites = userEntitesSortLabel(mergeUserEntitesForDisplay(b));
          if (sortConfig.direction === 'asc') {
            return aEntites.localeCompare(bEntites, 'fr', { sensitivity: 'base' });
          } else {
            return bEntites.localeCompare(aEntites, 'fr', { sensitivity: 'base' });
          }
        });
      }
      
      setUsers(sortedUsers);
    } catch (error) {
      console.error('Erreur:', error);
    } finally {
      setLoading(false);
    }
  };

  const canToggleUserStatus = currentUser?.role === 'admin';

  const toggleUserActivation = async (u: any, enabled: boolean) => {
    const nextStatut = enabled ? 'actif' : 'inactif';
    setStatusBusyById((prev) => ({ ...prev, [u.id]: true }));
    try {
      await api.put(`/users/${u.id}`, { statut: nextStatut });
      await loadUsers();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Mise à jour du statut impossible');
    } finally {
      setStatusBusyById((prev) => ({ ...prev, [u.id]: false }));
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

  const loadEntites = async () => {
    try {
      const response = await api.get('/entites');
      setEntitesList(response.data);
    } catch (error) {
      console.error('Erreur chargement entités:', error);
    }
  };

  const handleCreate = async () => {
    setError('');
    
    if (!formData.nom || !formData.prenom || !formData.email || !formData.password) {
      setError('Veuillez remplir tous les champs obligatoires');
      return;
    }

    if (formData.password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }

    setCreating(true);
    try {
      const createData: any = {
        nom: formData.nom,
        prenom: formData.prenom,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        statut: formData.statut,
      };
      if ((formData.fonction || '').trim()) {
        createData.fonction = formData.fonction.trim();
      }

      if (formData.entiteIds && formData.entiteIds.length > 0) {
        createData.entiteIds = formData.entiteIds;
      }

      await api.post('/users', createData);
      await loadUsers();
      setShowCreateModal(false);
      setFormData({
        nom: '',
        prenom: '',
        email: '',
        fonction: '',
        password: '',
        confirmPassword: '',
        role: 'contributeur',
        statut: 'actif',
        entiteIds: [],
      });
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la création de l\'utilisateur');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="p-6">Chargement...</div>;

  const totalPages = Math.max(1, Math.ceil(users.length / pageSize));
  const startIdx = (page - 1) * pageSize;
  const pagedUsers = users.slice(startIdx, startIdx + pageSize);
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    const addRange = (start: number, end: number) => {
      for (let i = start; i <= end; i++) pages.push(i);
    };
    if (page <= 4) {
      addRange(1, 5);
      pages.push('...');
      pages.push(totalPages);
    } else if (page >= totalPages - 3) {
      pages.push(1);
      pages.push('...');
      addRange(totalPages - 4, totalPages);
    } else {
      pages.push(1);
      pages.push('...');
      addRange(page - 1, page + 1);
      pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Utilisateurs</h1>
        <button 
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Nouvel utilisateur
        </button>
      </div>

      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>
            Filtres
            {(filters.nom || filters.email || filters.role || filters.statut || filters.entiteId) ? ' ●' : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
                <input
                  type="text"
                  value={filters.nom}
                  onChange={(e) => setFilters({ ...filters, nom: e.target.value })}
                  placeholder="Nom ou prénom"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input
                  type="text"
                  value={filters.email}
                  onChange={(e) => setFilters({ ...filters, email: e.target.value })}
                  placeholder="Adresse email"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Rôle</label>
                <select
                  value={filters.role}
                  onChange={(e) => setFilters({ ...filters, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  <option value="admin">Administrateur</option>
                  <option value="contributeur">Contributeur</option>
                  <option value="lecteur">Lecteur</option>
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
                  <option value="actif">Actif</option>
                  <option value="inactif">Inactif</option>
                  <option value="suspendu">Suspendu</option>
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
                  {entitesList.map((entite) => (
                    <option key={entite.id} value={entite.id}>
                      {entite.nom}
                      {entite.code ? ` (${entite.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => setFilters({ nom: '', email: '', role: '', statut: '', entiteId: '' })}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-semibold">Liste des utilisateurs</h2>
          {sortConfig && (
            <button
              onClick={resetSort}
              className="px-3 py-1 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              title="Réinitialiser le tri"
            >
              Réinitialiser le tri
            </button>
          )}
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th 
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('nom')}
              >
                <div className="flex items-center gap-1">
                  Nom
                  {sortConfig?.key === 'nom' && (
                    <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('email')}
              >
                <div className="flex items-center gap-1">
                  Email
                  {sortConfig?.key === 'email' && (
                    <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('role')}
              >
                <div className="flex items-center gap-1">
                  Rôle
                  {sortConfig?.key === 'role' && (
                    <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('entites')}
              >
                <div className="flex items-center gap-1">
                  Entités
                  {sortConfig?.key === 'entites' && (
                    <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              <th 
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                onClick={() => handleSort('statut')}
              >
                <div className="flex items-center gap-1">
                  Statut
                  {sortConfig?.key === 'statut' && (
                    <span>{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                  )}
                </div>
              </th>
              {canToggleUserStatus && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Activation
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pagedUsers.map((u) => (
              <tr key={u.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <Link 
                    to={`/users/${u.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    <span>
                      {u.prenom} {u.nom}
                      {u.fonction ? (
                        <span className="text-gray-500 font-normal"> · {u.fonction}</span>
                      ) : null}
                    </span>
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">{u.email}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm capitalize">{u.role}</td>
                <td className="px-6 py-4 text-sm">
                  {(() => {
                    const rows = mergeUserEntitesForDisplay(u);
                    if (rows.length === 0) {
                      return <span className="text-gray-500 italic">N/A</span>;
                    }
                    return (
                      <div className="flex flex-wrap gap-2">
                        {rows.map((row) => {
                          const base =
                            row.responsable && !row.membre
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-blue-100 text-blue-800';
                          return (
                            <span key={row.id} className={`px-2 py-1 rounded text-xs ${base}`}>
                              {row.nom || 'N/A'}
                              {row.code ? ` (${row.code})` : ''}
                              {row.responsable && row.membre && (
                                <span className="text-amber-800 font-medium"> · Resp.</span>
                              )}
                              {row.responsable && !row.membre && (
                                <span className="font-medium"> · Responsable</span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs rounded ${
                    u.statut === 'actif' ? 'bg-green-100 text-green-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {u.statut}
                  </span>
                  {u.statut !== 'actif' && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      Cet utilisateur ne reçoit aucune notification.
                    </p>
                  )}
                </td>
                {canToggleUserStatus && (
                  <td className="px-6 py-4 whitespace-nowrap">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={u.statut === 'actif'}
                        disabled={!!statusBusyById[u.id]}
                        onChange={(e) => void toggleUserActivation(u, e.target.checked)}
                        className="sr-only peer"
                      />
                      <span className="text-xs text-gray-600">Notifications & accès</span>
                      <span className="relative inline-flex h-5 w-10 items-center rounded-full bg-gray-300 transition-colors peer-checked:bg-green-500">
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                          u.statut === 'actif' ? 'translate-x-5' : 'translate-x-1'
                        }`} />
                      </span>
                    </label>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && (
          <div className="text-center py-8 text-gray-500">Aucun utilisateur</div>
        )}
        {users.length > pageSize && (
          <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
            <div className="text-sm text-gray-700">
              Affichage {startIdx + 1}-{Math.min(startIdx + pageSize, users.length)} sur {users.length}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`px-4 py-2 rounded text-sm font-medium ${page === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                Précédent
              </button>
              <div className="flex gap-1">
                {getPageNumbers().map((p, idx) => (
                  typeof p === 'string' ? (
                    <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">{p}</span>
                  ) : (
                    <button
                      key={p as number}
                      onClick={() => setPage(p as number)}
                      className={`px-3 py-2 rounded text-sm font-medium ${page === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      {p}
                    </button>
                  )
                ))}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className={`px-4 py-2 rounded text-sm font-medium ${page === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de création d'utilisateur */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto relative">
            <button
              type="button"
              aria-label="Fermer"
              onClick={() => setShowCreateModal(false)}
              className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 text-xl leading-none"
            >
              ×
            </button>
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Nouvel utilisateur</h2>
              
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Prénom <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.prenom}
                      onChange={(e) => setFormData({ ...formData, prenom: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Nom <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.nom}
                      onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fonction / poste <span className="text-gray-500 font-normal">(facultatif)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.fonction}
                      onChange={(e) => setFormData({ ...formData, fonction: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Ex. Chef de projet…"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Rôle <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="admin">Administrateur</option>
                      <option value="contributeur">Contributeur</option>
                      <option value="lecteur">Lecteur</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Mot de passe <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Au moins 6 caractères"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Confirmer le mot de passe <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="Confirmer le mot de passe"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Statut <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.statut}
                      onChange={(e) => setFormData({ ...formData, statut: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="actif">Actif</option>
                      <option value="inactif">Inactif</option>
                      <option value="suspendu">Suspendu</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Entités
                  </label>
                  <select
                    multiple
                    value={formData.entiteIds}
                    onChange={(e) => {
                      const selected = Array.from(e.target.selectedOptions, option => option.value);
                      setFormData({ ...formData, entiteIds: selected });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md min-h-[120px]"
                    size={5}
                  >
                    {entitesList.map((entite) => (
                      <option key={entite.id} value={entite.id}>
                        {entite.nom}{entite.code ? ` (${entite.code})` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Sélectionnez une ou plusieurs entités. Utilisez Ctrl (Cmd sur Mac) pour sélectionner plusieurs entités.
                  </p>
                  {formData.entiteIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.entiteIds.map((entiteId) => {
                        const entite = entitesList.find(e => e.id === entiteId);
                        return entite ? (
                          <span
                            key={entiteId}
                            className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs flex items-center gap-1"
                          >
                            {entite.nom}{entite.code ? ` (${entite.code})` : ''}
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, entiteIds: formData.entiteIds.filter(id => id !== entiteId) })}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              ×
                            </button>
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setFormData({
                      nom: '',
                      prenom: '',
                      email: '',
                      fonction: '',
                      password: '',
                      confirmPassword: '',
                      role: 'contributeur',
                      statut: 'actif',
                      entiteIds: [],
                    });
                    setError('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {creating ? 'Création...' : 'Créer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
