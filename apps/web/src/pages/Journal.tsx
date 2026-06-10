import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function Journal() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    search: '',
    action: '',
    ressourceType: '',
    userId: '',
    dateFrom: '',
    dateTo: '',
  });
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [showFiltres, setShowFiltres] = useState(false);

  useEffect(() => {
    loadLogs();
    loadUsers();
  }, []);

  useEffect(() => {
    loadLogs();
    setPage(1);
  }, [filters.search, filters.action, filters.ressourceType, filters.userId, filters.dateFrom, filters.dateTo]);

  const loadLogs = async () => {
    try {
      const params: any = { limit: 100 };
      if (filters.search) params.search = filters.search;
      if (filters.action) params.action = filters.action;
      if (filters.ressourceType) params.ressourceType = filters.ressourceType;
      if (filters.userId) params.userId = filters.userId;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      const response = await api.get('/journal', { params });
      setLogs(response.data);
    } catch (error) {
      console.error('Erreur:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (error) {
      // silencieux
    }
  };

  const formatDetails = (log: any) => {
    const details: string[] = [];
    
    // Ajouter le chemin si disponible
    if (log.details?.path) {
      details.push(`${log.details.method || 'GET'} ${log.details.path}`);
    }
    
    // Pour les connexions, afficher l'IP
    if (log.action === 'connexion' && log.ipAddress) {
      const ip = log.ipAddress.replace('::ffff:', '');
      details.push(`IP: ${ip}`);
    }
    
    // Pour les autres actions avec nom de ressource
    if (log.ressourceNom && log.action !== 'connexion') {
      const actionText: Record<string, string> = {
        lecture: 'Consultation',
        creation: 'Création',
        modification: 'Modification',
        suppression: 'Suppression'
      };
      const actionLabel = actionText[log.action] || log.action;
      details.push(`${actionLabel} de "${log.ressourceNom}"`);
    }
    
    return details.length > 0 ? details.join(' • ') : '-';
  };

  if (loading) return <div className="p-6">Chargement...</div>;

  const totalPages = Math.max(1, Math.ceil(logs.length / pageSize));
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
  const startIdx = (page - 1) * pageSize;
  const pagedLogs = logs.slice(startIdx, startIdx + pageSize);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Journal d'accès</h1>

      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>
            Filtres
            {(filters.search ||
              filters.action ||
              filters.ressourceType ||
              filters.userId ||
              filters.dateFrom ||
              filters.dateTo)
              ? ' ●'
              : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Recherche</label>
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  placeholder="Nom ressource, détails"
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
                <select
                  value={filters.action}
                  onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Toutes</option>
                  <option value="lecture">Lecture</option>
                  <option value="creation">Création</option>
                  <option value="modification">Modification</option>
                  <option value="suppression">Suppression</option>
                  <option value="connexion">Connexion</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ressource</label>
                <select
                  value={filters.ressourceType}
                  onChange={(e) => setFilters({ ...filters, ressourceType: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Toutes</option>
                  <option value="processus">Processus</option>
                  <option value="document">Document</option>
                  <option value="projet">Projet</option>
                  <option value="utilisateur">Utilisateur</option>
                  <option value="entite">Entité</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Utilisateur</label>
                <select
                  value={filters.userId}
                  onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">Tous</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nom} {u.prenom}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Du</label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Au</label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => {
                  setFilters({
                    search: '',
                    action: '',
                    ressourceType: '',
                    userId: '',
                    dateFrom: '',
                    dateTo: '',
                  });
                }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Utilisateur
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ressource
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Nom
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Détails
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {pagedLogs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(log.timestamp).toLocaleString('fr-FR')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {log.user ? `${log.user.nom} ${log.user.prenom}` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full ${
                        log.action === 'lecture'
                          ? 'bg-blue-100 text-blue-800'
                          : log.action === 'creation'
                          ? 'bg-green-100 text-green-800'
                          : log.action === 'modification'
                          ? 'bg-yellow-100 text-yellow-800'
                          : log.action === 'suppression'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}
                    >
                      {log.action.charAt(0).toUpperCase() + log.action.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">
                    {log.ressourceType}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {log.ressourceNom || '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {formatDetails(log)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Précédent
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Suivant
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Affichage de <span className="font-medium">{startIdx + 1}</span> à{' '}
                  <span className="font-medium">{Math.min(startIdx + pageSize, logs.length)}</span> sur{' '}
                  <span className="font-medium">{logs.length}</span> résultats
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Préc.
                  </button>
                  {getPageNumbers().map((pageNum, idx) =>
                    pageNum === '...' ? (
                      <span
                        key={`ellipsis-${idx}`}
                        className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700"
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={pageNum}
                        onClick={() => setPage(pageNum as number)}
                        className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                          page === pageNum
                            ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                            : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  )}
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Suiv.
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
