import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';

export default function Profile() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [editData, setEditData] = useState({
    nom: '',
    prenom: '',
    email: '',
  });
  const [favoris, setFavoris] = useState<{ processus: any[]; documents: any[] }>({ processus: [], documents: [] });
  const [loadingFavoris, setLoadingFavoris] = useState(false);

  useEffect(() => {
    if (currentUser?.id) {
      loadUser();
      loadFavoris();
    }
  }, [currentUser]);

  useEffect(() => {
    if (user) {
      setEditData({
        nom: user.nom || '',
        prenom: user.prenom || '',
        email: user.email || '',
      });
    }
  }, [user]);

  const loadUser = async () => {
    try {
      setError('');
      if (!currentUser?.id) {
        setError('Utilisateur non connecté');
        setLoading(false);
        return;
      }
      const response = await api.get(`/users/${currentUser.id}`);
      if (response.data) {
        setUser(response.data);
      } else {
        setError('Utilisateur non trouvé');
      }
    } catch (error: any) {
      if (error.response?.status === 404) {
        setError('Utilisateur non trouvé');
      } else {
        setError(error.response?.data?.error || error.message || 'Erreur lors du chargement du profil');
      }
    } finally {
      setLoading(false);
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

      if (Object.keys(updateData).length === 0) {
        setIsEditing(false);
        setSaving(false);
        return;
      }

      if (!currentUser?.id) {
        setError('Utilisateur non connecté');
        return;
      }
      const userId = currentUser.id;
      await api.put(`/users/${userId}`, updateData);
      await loadUser();
      setIsEditing(false);
      // Optionnel: mettre à jour le store auth
      const updatedUser = { ...currentUser, ...updateData };
      localStorage.setItem('user', JSON.stringify(updatedUser));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la modification');
    } finally {
      setSaving(false);
    }
  };

  const loadFavoris = async () => {
    setLoadingFavoris(true);
    try {
      console.log('Chargement des favoris...');
      const response = await api.get('/favoris');
      console.log('Favoris reçus:', response.data);
      setFavoris(response.data || { processus: [], documents: [] });
    } catch (error: any) {
      console.error('Erreur chargement favoris:', error);
      console.error('Détails erreur:', error.response?.data);
      // Initialiser avec des tableaux vides en cas d'erreur
      setFavoris({ processus: [], documents: [] });
    } finally {
      setLoadingFavoris(false);
    }
  };

  const handleRetirerProcessusFavori = async (processusId: string) => {
    try {
      await api.delete(`/favoris/processus/${processusId}`);
      await loadFavoris();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erreur lors de la suppression du favori');
    }
  };

  const handleRetirerDocumentFavori = async (documentId: string) => {
    try {
      await api.delete(`/favoris/documents/${documentId}`);
      await loadFavoris();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Erreur lors de la suppression du favori');
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
      if (!currentUser?.id) {
        setPasswordError('Utilisateur non connecté');
        return;
      }
      const userId = currentUser.id;
      await api.patch(`/users/${userId}/password`, {
        password: passwordData.password,
      });
      setShowPasswordModal(false);
      setPasswordData({ password: '', confirmPassword: '' });
      setPasswordError('');
      alert('Mot de passe modifié avec succès');
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || 'Erreur lors de la modification du mot de passe');
    } finally {
      setChangingPassword(false);
    }
  };

  // Debug: afficher l'état des favoris
  useEffect(() => {
    console.log('État favoris:', favoris);
    console.log('Loading favoris:', loadingFavoris);
  }, [favoris, loadingFavoris]);

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
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retour au tableau de bord
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Mon Profil</h1>
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
                Modifier mes informations
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
              <div className="col-span-2">
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
                {user.entitesMembres && user.entitesMembres.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {user.entitesMembres.map((ue: any) => (
                      <span
                        key={ue.entite?.id || ue.entiteId}
                        className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs"
                      >
                        {ue.entite?.nom || 'N/A'}{ue.entite?.code ? ` (${ue.entite.code})` : ''}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 italic">N/A</p>
                )}
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

      {/* Section Favoris - Toujours affichée */}
      <div className="mt-6 bg-white rounded-lg shadow p-6 border-2 border-blue-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Mes Favoris</h2>
          <div className="text-sm text-gray-500">
            💡 Cliquez sur l'icône ⭐ sur les pages Processus ou Documents pour ajouter des favoris
          </div>
        </div>
        
        {loadingFavoris ? (
          <div className="text-center py-8 text-gray-500">Chargement des favoris...</div>
        ) : (
          <>
            {favoris.processus.length === 0 && favoris.documents.length === 0 ? (
              <div className="text-center py-8">
                <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                <p className="text-gray-500 mb-2 font-medium">Vous n'avez pas encore de favoris</p>
                <p className="text-sm text-gray-400">
                  Ajoutez des processus ou documents en favoris depuis leurs pages respectives
                </p>
              </div>
            ) : (
          <div className="space-y-6">
            {/* Favoris Processus */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Processus favoris ({favoris.processus.length})</h3>
              {favoris.processus.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Aucun processus en favoris</p>
              ) : (
                <div className="space-y-2">
                  {favoris.processus.map((p: any) => (
                    <div key={p.id} className="border border-gray-200 rounded p-3 flex items-center justify-between hover:bg-gray-50">
                      <div className="flex-1">
                        <button
                          onClick={() => navigate(`/processus/${p.id}`)}
                          className="text-left"
                        >
                          <p className="font-medium text-sm text-blue-600 hover:underline">{p.nom}</p>
                          {p.codeProcessus && (
                            <p className="text-xs text-gray-500">Code: {p.codeProcessus}</p>
                          )}
                          {p.statut && (
                            <p className="text-xs text-gray-500 capitalize">Statut: {p.statut.replace('_', ' ')}</p>
                          )}
                        </button>
                      </div>
                      <button
                        onClick={() => handleRetirerProcessusFavori(p.id)}
                        className="ml-4 px-3 py-1 text-sm text-red-600 hover:text-red-800 border border-red-300 rounded hover:bg-red-50"
                        title="Retirer des favoris"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Favoris Documents */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Documents favoris ({favoris.documents.length})</h3>
              {favoris.documents.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Aucun document en favoris</p>
              ) : (
                <div className="space-y-2">
                  {favoris.documents.map((d: any) => (
                    <div key={d.id} className="border border-gray-200 rounded p-3 flex items-center justify-between hover:bg-gray-50">
                      <div className="flex-1">
                        <button
                          onClick={() => navigate(`/documents`)}
                          className="text-left"
                        >
                          <p className="font-medium text-sm text-blue-600 hover:underline">{d.nom}</p>
                          {d.version && (
                            <p className="text-xs text-gray-500">Version: {d.version}</p>
                          )}
                          {d.typeDocument && (
                            <p className="text-xs text-gray-500 capitalize">Type: {d.typeDocument}</p>
                          )}
                          {d.processus && (
                            <p className="text-xs text-gray-500">Processus: {d.processus.nom} ({d.processus.codeProcessus})</p>
                          )}
                        </button>
                      </div>
                      <button
                        onClick={() => handleRetirerDocumentFavori(d.id)}
                        className="ml-4 px-3 py-1 text-sm text-red-600 hover:text-red-800 border border-red-300 rounded hover:bg-red-50"
                        title="Retirer des favoris"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
            )}
          </>
        )}
      </div>

      {/* Modal de modification du mot de passe */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">Modifier mon mot de passe</h2>
              
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
