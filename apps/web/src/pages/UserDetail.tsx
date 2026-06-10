import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import { mergeUserEntitesForDisplay } from '../utils/userEntitesDisplay';

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user: currentAdmin } = useAuth();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entitesList, setEntitesList] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [synthese, setSynthese] = useState<any>(null);
  const [synLoading, setSynLoading] = useState(false);
  const [synError, setSynError] = useState('');
  const [editData, setEditData] = useState({
    nom: '',
    prenom: '',
    email: '',
    fonction: '',
    role: 'contributeur',
    statut: 'actif',
    entiteIds: [] as string[],
  });

  useEffect(() => {
    if (id) {
      loadUser();
      loadEntites();
    }
  }, [id]);

  const loadSynthese = async () => {
    if (!id) return;
    setSynLoading(true);
    setSynError('');
    try {
      const res = await api.get(`/users/${id}/acces-synthese`);
      setSynthese(res.data);
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Impossible de charger la synthèse des accès');
    } finally {
      setSynLoading(false);
    }
  };

  useEffect(() => {
    if (id) loadSynthese();
  }, [id]);

  useEffect(() => {
    if (user) {
      setEditData({
        nom: user.nom || '',
        prenom: user.prenom || '',
        email: user.email || '',
        fonction: user.fonction || '',
        role: user.role || 'contributeur',
        statut: user.statut || 'actif',
        entiteIds: user.entitesMembres?.map((ue: any) => ue.entite?.id || ue.entiteId).filter(Boolean) || [],
      });
    }
  }, [user]);

  const loadUser = async () => {
    try {
      setError('');
      if (!id) {
        setError('ID de l\'utilisateur manquant');
        setLoading(false);
        return;
      }
      const response = await api.get(`/users/${id}`);
      if (response.data) {
        setUser(response.data);
      } else {
        setError('Utilisateur non trouvé');
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        setError('Utilisateur non trouvé');
      } else {
        setError(error.response?.data?.error || error.message || 'Erreur lors du chargement de l\'utilisateur');
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

  const handleSaveEdit = async () => {
    setError('');
    setSaving(true);

    try {
      const updateData: any = {};

      if (editData.nom !== (user.nom || '')) {
        updateData.nom = editData.nom;
      }
      if (editData.prenom !== (user.prenom || '')) {
        updateData.prenom = editData.prenom;
      }
      if (editData.email !== (user.email || '')) {
        updateData.email = editData.email;
      }
      if (editData.role !== (user.role || '')) {
        updateData.role = editData.role;
      }
      if (editData.statut !== (user.statut || '')) {
        updateData.statut = editData.statut;
      }
      const prevFonction = user.fonction || '';
      const nextFonction = (editData.fonction || '').trim();
      if (nextFonction !== prevFonction) {
        updateData.fonction = nextFonction || null;
      }

      const currentEntiteIds = (user.entitesMembres?.map((ue: any) => ue.entite?.id || ue.entiteId).filter(Boolean) || []).sort();
      const newEntiteIds = (editData.entiteIds || []).sort();
      if (JSON.stringify(currentEntiteIds) !== JSON.stringify(newEntiteIds)) {
        updateData.entiteIds = editData.entiteIds || [];
      }

      if (Object.keys(updateData).length === 0) {
        setIsEditing(false);
        setSaving(false);
        return;
      }

      await api.put(`/users/${id}`, updateData);
      await loadUser();
      setIsEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la modification');
    } finally {
      setSaving(false);
    }
  };

  const permLabel = (p: string) =>
    (
      {
        lecture: 'Lecture',
        modification: 'Modification',
        suppression: 'Suppression',
        gestion: 'Gestion',
      } as Record<string, string>
    )[p] ?? p;

  const uiLevelLabel = (l: string) =>
    ({ none: 'Aucun', lecture: 'Lecture', modification: 'Modification' } as Record<string, string>)[l] ?? l;

  const handleUiModuleSelect = async (module: string, value: string) => {
    if (!id) return;
    try {
      setSynError('');
      const level = value === '__inherit__' ? null : value;
      await api.patch(`/users/${id}/ui-module`, { module, level });
      await loadSynthese();
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Erreur lors de la mise à jour du module');
    }
  };

  const removeDelegation = async (permId: string) => {
    if (!id || !window.confirm('Retirer cette délégation de permission ?')) return;
    try {
      await api.delete(`/users/${id}/permissions-deleguees/${permId}`);
      await loadSynthese();
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Erreur lors du retrait');
    }
  };

  const removeDocConfidentiel = async (permId: string) => {
    if (!id || !window.confirm("Retirer l'accès à ce document confidentiel ?")) return;
    try {
      await api.delete(`/users/${id}/document-permissions/${permId}`);
      await loadSynthese();
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Erreur lors du retrait');
    }
  };

  const removeTacheAssignation = async (tacheId: string, tacheUserId: string) => {
    if (!window.confirm("Retirer l'affectation à cette tâche ?")) return;
    try {
      await api.delete(`/taches/${tacheId}/assignes/${tacheUserId}`);
      await loadSynthese();
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Erreur lors du retrait');
    }
  };

  const setTacheAssignPermission = async (tacheId: string, tacheUserId: string, permission: string) => {
    try {
      await api.patch(`/taches/${tacheId}/assignes/${tacheUserId}`, { permission });
      await loadSynthese();
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Erreur lors de la mise à jour du droit');
    }
  };

  const removeContratPermission = async (contratId: string, entryId: string) => {
    if (!window.confirm("Retirer l'accès à ce contrat ?")) return;
    try {
      await api.delete(`/contrats/${contratId}/permissions/entry/${entryId}`);
      await loadSynthese();
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Erreur lors du retrait');
    }
  };

  const removeLicencePermission = async (licenceId: string, targetUserId: string) => {
    if (!window.confirm("Retirer l'accès à cette licence ?")) return;
    try {
      await api.delete(`/licences/${licenceId}/permissions/${targetUserId}`);
      await loadSynthese();
    } catch (e: any) {
      setSynError(e.response?.data?.error || 'Erreur lors du retrait');
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    
    if (!passwordData.password || passwordData.password.length < 6) {
      setPasswordError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    if (passwordData.password !== passwordData.confirmPassword) {
      setPasswordError('Les mots de passe ne correspondent pas');
      return;
    }

    setChangingPassword(true);
    try {
      await api.patch(`/users/${id}/password`, {
        password: passwordData.password,
      });
      setShowPasswordModal(false);
      setPasswordData({ password: '', confirmPassword: '' });
      setPasswordError('');
      // Optionnel: afficher un message de succès
      alert('Mot de passe modifié avec succès');
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || 'Erreur lors de la modification du mot de passe');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Chargement...</div>
        </div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => navigate('/users')}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retour à la liste
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <button
          onClick={() => navigate('/users')}
          className="text-blue-600 hover:text-blue-800 mb-4 flex items-center gap-2"
        >
          ← Retour à la liste des utilisateurs
        </button>
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">
              {user.prenom} {user.nom}
            </h1>
            {user.fonction && (
              <p className="text-sm text-gray-600 mt-1">{user.fonction}</p>
            )}
          </div>
          {!isEditing && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowPasswordModal(true)}
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
              >
                Modifier le mot de passe
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Modifier
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        {isEditing ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prénom <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editData.prenom}
                  onChange={(e) => setEditData({ ...editData, prenom: e.target.value })}
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
                  value={editData.nom}
                  onChange={(e) => setEditData({ ...editData, nom: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={editData.email}
                  onChange={(e) => setEditData({ ...editData, email: e.target.value })}
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
                  value={editData.fonction}
                  onChange={(e) => setEditData({ ...editData, fonction: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Ex. Chef de projet, Analyste…"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rôle <span className="text-red-500">*</span>
                </label>
                <select
                  value={editData.role}
                  onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  <option value="admin">Administrateur</option>
                  <option value="contributeur">Contributeur</option>
                  <option value="lecteur">Lecteur</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Statut <span className="text-red-500">*</span>
                </label>
                <select
                  value={editData.statut}
                  onChange={(e) => setEditData({ ...editData, statut: e.target.value })}
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
                value={editData.entiteIds}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value);
                  setEditData({ ...editData, entiteIds: selected });
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
              {editData.entiteIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {editData.entiteIds.map((entiteId) => {
                    const entite = entitesList.find(e => e.id === entiteId);
                    return entite ? (
                      <span
                        key={entiteId}
                        className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs flex items-center gap-1"
                      >
                        {entite.nom}{entite.code ? ` (${entite.code})` : ''}
                        <button
                          type="button"
                          onClick={() => setEditData({ ...editData, entiteIds: editData.entiteIds.filter(id => id !== entiteId) })}
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

            <div className="flex justify-end space-x-3 pt-4 border-t">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setError('');
                  if (user) {
                    setEditData({
                      nom: user.nom || '',
                      prenom: user.prenom || '',
                      email: user.email || '',
                      fonction: user.fonction || '',
                      role: user.role || 'contributeur',
                      statut: user.statut || 'actif',
                      entiteIds: user.entitesMembres?.map((ue: any) => ue.entite?.id || ue.entiteId).filter(Boolean) || [],
                    });
                  }
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium text-gray-500">Prénom</label>
                <p className="mt-1 text-sm">{user.prenom}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Nom</label>
                <p className="mt-1 text-sm">{user.nom}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Email</label>
                <p className="mt-1 text-sm">{user.email}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Fonction / poste</label>
                <p className="mt-1 text-sm">{user.fonction || <span className="italic text-gray-400">—</span>}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Rôle</label>
                <p className="mt-1 text-sm capitalize">{user.role}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Statut</label>
                <p className="mt-1">
                  <span className={`px-2 py-1 text-xs rounded ${
                    user.statut === 'actif' ? 'bg-green-100 text-green-800' :
                    user.statut === 'inactif' ? 'bg-gray-100 text-gray-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {user.statut}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">Date de création</label>
                <p className="mt-1 text-sm">
                  {new Date(user.createdAt).toLocaleDateString('fr-FR')}
                </p>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-500">Entités</label>
              <div className="mt-1">
                {(() => {
                  const rows = mergeUserEntitesForDisplay(user);
                  if (rows.length === 0) {
                    return <p className="text-sm text-gray-500 italic">N/A</p>;
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
              </div>
            </div>

            {user.processusProprietaire && user.processusProprietaire.length > 0 && (
              <div>
                <label className="text-sm font-medium text-gray-500 mb-2 block">
                  Processus (propriétaire)
                </label>
                <div className="space-y-2">
                  {user.processusProprietaire.map((p: any) => (
                    <div key={p.id} className="border border-gray-200 rounded p-3">
                      <p className="font-medium text-sm">{p.nom}</p>
                      {p.codeProcessus && (
                        <p className="text-xs text-gray-500">Code: {p.codeProcessus}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {user.documentsUploaded && user.documentsUploaded.length > 0 && (
              <div>
                <label className="text-sm font-medium text-gray-500 mb-2 block">
                  Documents uploadés (10 derniers)
                </label>
                <div className="space-y-2">
                  {user.documentsUploaded.map((d: any) => (
                    <div key={d.id} className="border border-gray-200 rounded p-3">
                      <p className="font-medium text-sm">{d.nom}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(d.createdAt).toLocaleDateString('fr-FR')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Accès par page et ressources
          </h2>
          <button
            type="button"
            onClick={() => loadSynthese()}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            Actualiser
          </button>
        </div>
        {synError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {synError}
          </div>
        )}
        {synLoading && !synthese ? (
          <p className="text-gray-500 text-sm">Chargement de la synthèse…</p>
        ) : synthese ? (
          <div className="space-y-8 text-sm">
            <section>
              <h3 className="text-md font-medium text-gray-700 mb-1">Pages / modules</h3>
              <p className="text-xs text-gray-500 mb-3">
                Contrôle la navigation et le niveau (aucun, lecture, modification). « Hériter du rôle » retire la
                surcharge.
              </p>
              <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full">
                  <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                    <tr>
                      <th className="p-2">Module</th>
                      <th className="p-2">Défaut (rôle)</th>
                      <th className="p-2">Effectif</th>
                      <th className="p-2">Régler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {synthese.uiModules?.map((row: any) => (
                      <tr key={row.module} className="border-t border-gray-100">
                        <td className="p-2">{row.label}</td>
                        <td className="p-2">{uiLevelLabel(row.defaultLevel)}</td>
                        <td className="p-2">
                          <span className={row.isOverride ? 'font-medium text-blue-700' : ''}>
                            {uiLevelLabel(row.effectiveLevel)}
                          </span>
                          {row.isOverride && (
                            <span className="ml-1 text-xs text-gray-400">(surcharge)</span>
                          )}
                        </td>
                        <td className="p-2">
                          <select
                            className="border rounded px-2 py-1 text-sm max-w-[220px]"
                            value={row.isOverride ? row.effectiveLevel : '__inherit__'}
                            onChange={(e) => handleUiModuleSelect(row.module, e.target.value)}
                          >
                            <option value="__inherit__">
                              Hériter ({uiLevelLabel(row.defaultLevel)})
                            </option>
                            <option value="none">Aucun accès</option>
                            <option value="lecture">Lecture seule</option>
                            <option value="modification">Modification</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Périmètre réel par page</h3>
              <div className="border rounded-lg p-3 bg-gray-50 space-y-3">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Utilisateurs</p>
                  <p className="text-xs text-gray-600">
                    {synthese.pagesScopes?.utilisateurs?.description || '—'}
                  </p>
                  {typeof synthese.pagesScopes?.utilisateurs?.visibleCount === 'number' && (
                    <p className="text-xs text-gray-500 mt-1">
                      Utilisateurs visibles estimés: {synthese.pagesScopes.utilisateurs.visibleCount}
                    </p>
                  )}
                  {Array.isArray(synthese.pagesScopes?.utilisateurs?.preview) &&
                    synthese.pagesScopes.utilisateurs.preview.length > 0 && (
                      <ul className="mt-2 text-xs text-gray-700 list-disc list-inside">
                        {synthese.pagesScopes.utilisateurs.preview.map((u: any) => (
                          <li key={u.id}>
                            {u.prenom} {u.nom} ({u.email})
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Projets — gouvernance</h3>
              <p className="text-xs text-gray-500 mb-2">
                Rôles sur le projet (hors table des délégations). Retirer un rôle se fait depuis la fiche projet.
              </p>
              {synthese.projets?.gouvernance?.length ? (
                <ul className="space-y-2 border rounded-lg divide-y">
                  {synthese.projets.gouvernance.map((p: any) => (
                    <li key={p.id} className="p-3 flex flex-wrap justify-between gap-2">
                      <div>
                        <Link to={`/projets/${p.id}`} className="font-medium text-blue-600 hover:underline">
                          {p.nom}
                        </Link>
                        <span className="text-gray-500 text-xs ml-2">{p.codeProjet}</span>
                      </div>
                      <span className="text-xs text-gray-600">{p.roles?.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-400 text-xs">Aucune gouvernance directe.</p>
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Projets — délégations (permissions)</h3>
              {synthese.projets?.delegations?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Projet</th>
                        <th className="p-2">Droit</th>
                        <th className="p-2">Accordée par</th>
                        <th className="p-2 w-28"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.projets.delegations.map((row: any) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="p-2">
                            <Link
                              to={`/projets/${row.ressourceId}`}
                              className="text-blue-600 hover:underline"
                            >
                              {row.ressourceLabel}
                            </Link>
                          </td>
                          <td className="p-2">{permLabel(row.permission)}</td>
                          <td className="p-2 text-gray-600">
                            {row.grantedBy?.prenom} {row.grantedBy?.nom}
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeDelegation(row.id)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Aucune délégation projet.</p>
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Processus</h3>
              {synthese.processus?.proprietaire?.length ? (
                <p className="text-xs text-gray-600 mb-2">
                  Propriétaire de {synthese.processus.proprietaire.length} processus (voir aussi le profil ci-dessus).
                </p>
              ) : null}
              {synthese.processus?.delegations?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Processus</th>
                        <th className="p-2">Droit</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.processus.delegations.map((row: any) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="p-2">
                            <Link
                              to={`/processus/${row.ressourceId}`}
                              className="text-blue-600 hover:underline"
                            >
                              {row.ressourceLabel}
                            </Link>
                          </td>
                          <td className="p-2">{permLabel(row.permission)}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeDelegation(row.id)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !synthese.processus?.proprietaire?.length && (
                  <p className="text-gray-400 text-xs">Aucune délégation processus.</p>
                )
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Entités</h3>
              {synthese.entites?.membres?.length ? (
                <ul className="mb-3 text-xs text-gray-700 list-disc list-inside">
                  {synthese.entites.membres.map((m: any) => (
                    <li key={m.id}>
                      {m.entite?.nom} ({m.entite?.code})
                    </li>
                  ))}
                </ul>
              ) : null}
              {synthese.entites?.delegations?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Entité</th>
                        <th className="p-2">Droit</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.entites.delegations.map((row: any) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="p-2">
                            <Link
                              to={`/entites/${row.ressourceId}`}
                              className="text-blue-600 hover:underline"
                            >
                              {row.ressourceLabel}
                            </Link>
                          </td>
                          <td className="p-2">{permLabel(row.permission)}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeDelegation(row.id)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !synthese.entites?.membres?.length && (
                  <p className="text-gray-400 text-xs">Aucune entité ni délégation.</p>
                )
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Documents confidentiels</h3>
              {synthese.documents?.accesConfidentiel?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Document</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.documents.accesConfidentiel.map((row: any) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="p-2">{row.documentNom}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeDocConfidentiel(row.id)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Retirer l&apos;accès
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Aucun accès document confidentiel explicite.</p>
              )}
              {synthese.documents?.delegations?.length ? (
                <>
                  <h4 className="text-sm font-medium text-gray-600 mt-4 mb-2">
                    Délégations table Permission (document)
                  </h4>
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="min-w-full">
                      <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                        <tr>
                          <th className="p-2">Document</th>
                          <th className="p-2">Droit</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {synthese.documents.delegations.map((row: any) => (
                          <tr key={row.id} className="border-t border-gray-100">
                            <td className="p-2">{row.ressourceLabel}</td>
                            <td className="p-2">{permLabel(row.permission)}</td>
                            <td className="p-2">
                              <button
                                type="button"
                                onClick={() => removeDelegation(row.id)}
                                className="text-red-600 hover:underline text-xs"
                              >
                                Retirer
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Clients / fournisseurs (délégations)</h3>
              {synthese.clientsFournisseurs?.delegations?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Fiche</th>
                        <th className="p-2">Droit</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.clientsFournisseurs.delegations.map((row: any) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="p-2">
                            <Link
                              to={`/clients-fournisseurs/${row.ressourceId}`}
                              className="text-blue-600 hover:underline"
                            >
                              {row.ressourceLabel}
                            </Link>
                          </td>
                          <td className="p-2">{permLabel(row.permission)}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeDelegation(row.id)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Aucune délégation.</p>
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Tâches assignées</h3>
              {synthese.tachesAssignees?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Tâche</th>
                        <th className="p-2">Projet</th>
                        <th className="p-2">Droit</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.tachesAssignees.map((row: any) => (
                        <tr key={row.tacheUserId} className="border-t border-gray-100">
                          <td className="p-2">
                            <span className="font-medium">{row.tacheNom}</span>
                          </td>
                          <td className="p-2 text-gray-600">
                            {row.projet ? (
                              <Link
                                to={`/projets/${row.projet.id}`}
                                className="text-blue-600 hover:underline text-xs"
                              >
                                {row.projet.nom}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-2">
                            <select
                              className="border rounded px-1 py-0.5 text-xs"
                              value={row.permission}
                              onChange={(e) =>
                                setTacheAssignPermission(row.tacheId, row.tacheUserId, e.target.value)
                              }
                            >
                              <option value="lecture">Lecture</option>
                              <option value="modification">Modification</option>
                              <option value="suppression">Suppression</option>
                              <option value="gestion">Gestion</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeTacheAssignation(row.tacheId, row.tacheUserId)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Aucune tâche assignée.</p>
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Contrats</h3>
              <p className="text-xs text-gray-500 mb-2">
                Les droits sur un contrat sont gérés par le <span className="font-medium">créateur du contrat</span> depuis
                la page Contrats (modal Accès). Un administrateur applicatif n&apos;y peut pas supprimer un partage à la
                place du créateur.
              </p>
              {synthese.contrats?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Contrat</th>
                        <th className="p-2">Niveau</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.contrats.map((row: any) => {
                        const canRetirerIci =
                          row.contratCreatedById && currentAdmin?.id === row.contratCreatedById;
                        return (
                          <tr key={row.id} className="border-t border-gray-100">
                            <td className="p-2">
                              <Link to={`/contrats`} className="text-blue-600 hover:underline">
                                {row.contrat?.nom ?? row.contratId}
                              </Link>
                            </td>
                            <td className="p-2">{row.niveau}</td>
                            <td className="p-2">
                              {canRetirerIci ? (
                                <button
                                  type="button"
                                  onClick={() => removeContratPermission(row.contratId, row.id)}
                                  className="text-red-600 hover:underline text-xs"
                                >
                                  Retirer
                                </button>
                              ) : (
                                <span className="text-gray-400 text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Aucun accès contrat explicite (hors créations).</p>
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">Licences</h3>
              {synthese.licences?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">Licence</th>
                        <th className="p-2">Niveau</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.licences.map((row: any) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="p-2">
                            <Link to="/licences" className="text-blue-600 hover:underline">
                              {row.licence?.nom ?? row.licenceId}
                            </Link>
                          </td>
                          <td className="p-2">{row.niveau}</td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeLicencePermission(row.licenceId, id!)}
                              className="text-red-600 hover:underline text-xs"
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Aucun accès licence.</p>
              )}
            </section>

            <section>
              <h3 className="text-md font-medium text-gray-700 mb-2">PV de réunion</h3>
              {synthese.pvReunions?.length ? (
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 text-left text-xs text-gray-600 uppercase">
                      <tr>
                        <th className="p-2">PV</th>
                        <th className="p-2">Rôle</th>
                        <th className="p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {synthese.pvReunions.map((row: any) => (
                        <tr key={row.id} className="border-t border-gray-100">
                          <td className="p-2">{row.titre}</td>
                          <td className="p-2 text-gray-600">{row.lien}</td>
                          <td className="p-2">
                            <Link to={`/pv-reunion/${row.id}`} className="text-blue-600 hover:underline text-xs">
                              Ouvrir
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-400 text-xs">Aucun PV impliquant cet utilisateur.</p>
              )}
            </section>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Synthèse non disponible.</p>
        )}
      </div>

      {/* Modal de modification du mot de passe */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Modifier le mot de passe</h2>
              
              {passwordError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {passwordError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nouveau mot de passe <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={passwordData.password}
                    onChange={(e) => setPasswordData({ ...passwordData, password: e.target.value })}
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
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Confirmer le mot de passe"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordData({ password: '', confirmPassword: '' });
                    setPasswordError('');
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Annuler
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={changingPassword}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50"
                >
                  {changingPassword ? 'Modification...' : 'Modifier'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

