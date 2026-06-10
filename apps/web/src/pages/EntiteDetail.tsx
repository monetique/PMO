import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';

function userNomAvecFonction(u: { prenom?: string; nom?: string; fonction?: string | null }) {
  const n = `${u.prenom ?? ''} ${u.nom ?? ''}`.trim();
  return u.fonction ? `${n} · ${u.fonction}` : n;
}

export default function EntiteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const isLecteur = currentUser?.role === 'lecteur';
  const [entite, setEntite] = useState<any>(null);
  const [processus, setProcessus] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entitesList, setEntitesList] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [historyPagination, setHistoryPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [typesEntite, setTypesEntite] = useState<any[]>([]);
  const [editData, setEditData] = useState({
    nom: '',
    typeEntiteId: '',
    parentId: '',
    responsableId: '',
    description: '',
    membreIds: [] as string[],
  });

  useEffect(() => {
    if (id) {
      setLoading(true);
      setError('');
      loadEntite();
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
      loadProcessus();
      loadProjets();
      loadHistory(1);
    } else {
      setError('ID de l\'entité manquant dans l\'URL');
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (entite) {
      setEditData({
        nom: entite.nom || '',
        typeEntiteId: entite.typeEntiteId || entite.typeEntite?.id || '',
        parentId: entite.parentId || '',
        responsableId: entite.responsableId || '',
        description: entite.description || '',
        membreIds: entite.membres?.map((m: any) => m.user?.id || m.userId).filter(Boolean) || [],
      });
    }
  }, [entite]);

  const loadEntite = async () => {
    try {
      setError('');
      if (!id) {
        setError('ID de l\'entité manquant');
        setLoading(false);
        return;
      }
      const response = await api.get(`/entites/${id}`);
      if (response.data) {
        setEntite(response.data);
      } else {
        setError('Entité non trouvée');
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        setError('Entité non trouvée');
      } else {
        setError(error.response?.data?.error || error.message || 'Erreur lors du chargement de l\'entité');
      }
    } finally {
      setLoading(false);
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

  const loadProcessus = async () => {
    try {
      const response = await api.get(`/processus?entiteId=${id}`);
      setProcessus(response.data);
    } catch (error) {
      console.error('Erreur chargement processus:', error);
    }
  };

  const loadProjets = async () => {
    try {
      const response = await api.get(`/projets?entiteId=${id}`);
      setProjets(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Erreur chargement projets:', error);
      setProjets([]);
    }
  };

  const loadHistory = async (page: number = 1) => {
    try {
      const response = await api.get(`/entites/${id}/history?page=${page}&limit=10`);
      setHistory(response.data.data);
      setHistoryPagination(response.data.pagination);
    } catch (error) {
      console.error('Erreur chargement historique:', error);
    }
  };

  const handleSaveEdit = async () => {
    setError('');
    setSaving(true);

    try {
      const updateData: any = {};

      // Vérifier les changements
      if (editData.nom !== (entite.nom || '')) {
        updateData.nom = editData.nom;
      }
      const curTypeId = entite.typeEntiteId || entite.typeEntite?.id || '';
      if (editData.typeEntiteId !== curTypeId) {
        updateData.typeEntiteId = editData.typeEntiteId;
      }
      if (editData.parentId !== (entite.parentId || '')) {
        updateData.parentId = editData.parentId || null;
      }
      if (editData.responsableId !== (entite.responsableId || '')) {
        updateData.responsableId = editData.responsableId || null;
      }
      if (editData.description !== (entite.description || '')) {
        updateData.description = editData.description || null;
      }
      const currentMembreIds = entite.membres?.map((m: any) => m.user?.id || m.userId).filter(Boolean).sort() || [];
      const newMembreIds = (editData.membreIds || []).sort();
      if (JSON.stringify(currentMembreIds) !== JSON.stringify(newMembreIds)) {
        updateData.membreIds = editData.membreIds || [];
      }

      // Mettre à jour seulement s'il y a des changements
      if (Object.keys(updateData).length > 0) {
        await api.put(`/entites/${id}`, updateData);
        await loadEntite();
        await loadProcessus();
        await loadProjets();
        await loadHistory(1); // Recharger l'historique à la page 1
      }

      setIsEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la modification');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Chargement...</div>;
  if (error && !entite) {
    return (
      <div className="p-6">
        <div className="mb-4">
          <button
            onClick={() => navigate('/entites')}
            className="text-blue-600 hover:text-blue-800 mb-4"
          >
            ← Retour à la liste
          </button>
        </div>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">
          {error}
        </div>
      </div>
    );
  }
  if (!entite) return <div className="p-6">Entité non trouvée</div>;

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/entites')}
          className="text-blue-600 hover:text-blue-800 mb-4"
        >
          ← Retour à la liste
        </button>
        <h1 className="text-2xl font-bold">{entite.nom}</h1>
        <p className="text-gray-600 mt-2">Code: {entite.code}</p>
      </div>

      {/* Informations générales */}
      <div className="bg-white rounded-lg shadow mb-6 p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Informations générales</h2>
          {!isEditing ? (
            !isLecteur && (
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Modifier
              </button>
            )
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsEditing(false);
                  if (entite) {
                    setEditData({
                      nom: entite.nom || '',
                      typeEntiteId: entite.typeEntiteId || entite.typeEntite?.id || '',
                      parentId: entite.parentId || '',
                      responsableId: entite.responsableId || '',
                      description: entite.description || '',
                      membreIds: entite.membres?.map((m: any) => m.user?.id || m.userId).filter(Boolean) || [],
                    });
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

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
            {error}
          </div>
        )}

        {isEditing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nom <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={editData.nom}
                onChange={(e) => setEditData({ ...editData, nom: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Nom de l'entité"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={editData.typeEntiteId}
                onChange={(e) => setEditData({ ...editData, typeEntiteId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                {typesEntite
                  .filter((t) => t.actif || t.id === editData.typeEntiteId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.libelle}
                      {!t.actif ? ' (inactif)' : ''}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Entité parente
              </label>
              <select
                value={editData.parentId}
                onChange={(e) => setEditData({ ...editData, parentId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Aucune (entité racine)</option>
                {entitesList
                  .filter((e) => e.id !== id)
                  .map((entite) => (
                    <option key={entite.id} value={entite.id}>
                      {entite.nom} ({entite.code}) - {entite.typeEntite?.libelle || entite.typeEntite?.code || '—'}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Une entité ne peut pas être sa propre parente</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Responsable
              </label>
              <select
                value={editData.responsableId}
                onChange={(e) => setEditData({ ...editData, responsableId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Sélectionner un responsable</option>
                {usersList
                  .filter((u) => u.role === 'admin' || u.role === 'contributeur')
                  .map((user) => (
                                       <option key={user.id} value={user.id}>
                      {userNomAvecFonction(user)} ({user.email})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Membres
              </label>
              <select
                multiple
                value={editData.membreIds}
                onChange={(e) => {
                  const selectedIds = Array.from(e.target.selectedOptions, option => option.value);
                  setEditData({ ...editData, membreIds: selectedIds });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 min-h-[100px]"
                size={5}
              >
                {usersList.map((user) => (
                  <option key={user.id} value={user.id}>
                    {userNomAvecFonction(user)} ({user.email}) — {user.role}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Maintenez Ctrl (ou Cmd sur Mac) pour sélectionner plusieurs membres</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={editData.description}
                onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                placeholder="Description de l'entité"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-sm font-medium text-gray-500">Type</label>
              <p className="mt-1 text-sm">{entite.typeEntite?.libelle || entite.typeEntite?.code || '—'}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Entité parente</label>
              <p className="mt-1 text-sm">
                {entite.parent ? `${entite.parent.nom}${entite.parent.code ? ` (${entite.parent.code})` : ''}` : <span className="text-gray-500 italic">N/A</span>}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Responsable</label>
              <p className="mt-1 text-sm">
                {entite.responsable ? (
                  <>
                    {userNomAvecFonction(entite.responsable)}{' '}
                    <span className="text-gray-500">({entite.responsable.email})</span>
                  </>
                ) : (
                  'Non assigné'
                )}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Membres</label>
              <div className="mt-1">
                {entite.membres && entite.membres.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {entite.membres.map((m: any) => (
                      <span
                        key={m.user?.id || m.userId}
                        className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800"
                      >
                        {m.user ? userNomAvecFonction(m.user) : '—'}{' '}
                        {m.user?.email && (
                          <span className="text-gray-600 font-normal">({m.user.email})</span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">N/A</p>
                )}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-500">Code</label>
              <p className="mt-1 text-sm font-medium">{entite.code}</p>
            </div>
            {entite.description && (
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-gray-500">Description</label>
                <div className="mt-1 p-3 bg-gray-50 border border-gray-200 rounded-md">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{entite.description}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Projets associés */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Projets associés</h2>
        {projets.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priorité</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fin prévue</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {projets.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{p.codeProjet}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <a
                        href={`/projets/${p.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/projets/${p.id}`);
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {p.nom}
                      </a>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span
                        className={`px-2 py-1 text-xs rounded ${
                          p.statut === 'en_cours'
                            ? 'bg-blue-100 text-blue-800'
                            : p.statut === 'en_preparation'
                              ? 'bg-yellow-100 text-yellow-800'
                              : p.statut === 'termine'
                                ? 'bg-green-100 text-green-800'
                                : p.statut === 'en_pause'
                                  ? 'bg-gray-100 text-gray-800'
                                  : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {p.statut || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">{p.priorite || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {p.dateFinPrevue ? new Date(p.dateFinPrevue).toLocaleDateString('fr-FR') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">Aucun projet associé à cette entité</div>
        )}
      </div>

      {/* Processus associés */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Processus associés</h2>
        {processus.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Propriétaire</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {processus.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">{p.codeProcessus}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <a
                        href={`/processus/${p.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/processus/${p.id}`);
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {p.nom}
                      </a>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 py-1 text-xs rounded ${
                        p.statut === 'actif' ? 'bg-green-100 text-green-800' :
                        p.statut === 'valide' ? 'bg-blue-100 text-blue-800' :
                        p.statut === 'en_revision' ? 'bg-yellow-100 text-yellow-800' :
                        p.statut === 'archive' ? 'bg-purple-100 text-purple-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {p.statut}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {p.proprietaire ? `${p.proprietaire.prenom} ${p.proprietaire.nom}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            Aucun processus associé à cette entité
          </div>
        )}
      </div>

      {/* Historique des modifications */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Historique des modifications</h2>
        {history.length === 0 ? (
          <p className="text-gray-500 text-center py-8">Aucun historique disponible</p>
        ) : (
          <div className="space-y-4">
            {history.map((entry: any) => {
              const getActionLabel = (action: string) => {
                const labels: Record<string, string> = {
                  creation: 'Création',
                  modification: 'Modification',
                  suppression: 'Suppression',
                  consultation: 'Consultation',
                  lecture: 'Consultation',
                };
                return labels[action] || action;
              };

              const getActionIcon = (action: string) => {
                if (action === 'creation') return '➕';
                if (action === 'modification') return '✏️';
                if (action === 'suppression') return '🗑️';
                if (action === 'consultation' || action === 'lecture') return '👁️';
                return '📝';
              };

              const getActionColor = (action: string) => {
                if (action === 'creation') return 'bg-green-100 text-green-800';
                if (action === 'modification') return 'bg-blue-100 text-blue-800';
                if (action === 'suppression') return 'bg-red-100 text-red-800';
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
                            {entry.details.changementMembres && (
                              <div>Membres modifiés</div>
                            )}
                            {entry.details.changementNom && (
                              <div>Nom: {entry.details.changementNom}</div>
                            )}
                            {entry.details.changementType && (
                              <div>Type modifié</div>
                            )}
                            {entry.details.changementResponsable && (
                              <div>Responsable modifié</div>
                            )}
                            {entry.details.changementParent && (
                              <div>Entité parente modifiée</div>
                            )}
                          </div>
                        )}
                        <p className="text-sm text-gray-700 mt-2">
                          {entry.user?.prenom} {entry.user?.nom}
                          {entry.ressourceNom && (
                            <span className="text-gray-500"> - {entry.ressourceNom}</span>
                          )}
                          <span className="text-xs text-gray-400 ml-2">(Entité)</span>
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
                    return (
                      pageNum === 1 ||
                      pageNum === historyPagination.totalPages ||
                      (pageNum >= historyPagination.page - 1 && pageNum <= historyPagination.page + 1)
                    );
                  })
                  .map((pageNum, index, array) => {
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
  );
}

