import { useEffect, useRef, useState } from 'react';
import { AccessContratLikeAdminLines } from './AccessContratLikeAdminLines';
import { DocumentAccesNatifModal } from './DocumentAccesNatifModal';
import { api, API_BASE_URL } from '../services/api';
import { useAuth } from '../store/auth';
import { isNativeAuthorControlledUploadDoc, normalizeDocumentAclFields } from '../utils/documentNativeAcces';
import type { DocTache } from '../pages/Taches';

export type AgileDocUserOption = { id: string; nom: string; prenom: string; role?: string; statut?: string };

const DROITS_ADMIN_DOC_PROJET_NATIF =
  'visualisation, modification statut, accès, suppression (admin non exclu de la pièce)';

/** Bloc documents natifs user story (upload + ACL auteur) — extrait pour éviter une dépendance circulaire avec les modales agile. */
export function AgileDocumentsUserStorySection({
  userStoryId,
  documentsNatifs,
  canEdit,
  onDocumentsChange,
  users,
}: {
  userStoryId: string;
  documentsNatifs: DocTache[];
  canEdit: boolean;
  onDocumentsChange?: () => void;
  users: AgileDocUserOption[];
}) {
  const { user: currentUser } = useAuth();
  const [docs, setDocs] = useState<DocTache[]>(() => documentsNatifs.map((d) => normalizeDocumentAclFields(d)));
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNom, setUploadNom] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [natifAccesDoc, setNatifAccesDoc] = useState<{ id: string; nom: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDocs(documentsNatifs.map((d) => normalizeDocumentAclFields(d)));
  }, [documentsNatifs]);

  const getFileIcon = (type: string) => {
    if (type?.includes('pdf')) return '\u{1F4C4}';
    if (type?.includes('image')) return '\u{1F5BC}\uFE0F';
    if (type?.includes('word') || type?.includes('doc')) return '\u{1F4DD}';
    if (type?.includes('excel') || type?.includes('sheet')) return '\u{1F4CA}';
    return '\u{1F4CE}';
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('fichier', uploadFile);
      formData.append('nom', uploadNom || uploadFile.name);
      formData.append('description', uploadDesc);
      const res = await api.post(`/user-stories/${userStoryId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDocs((prev) => [...prev, normalizeDocumentAclFields(res.data)]);
      setShowUpload(false);
      setUploadFile(null);
      setUploadNom('');
      setUploadDesc('');
      onDocumentsChange?.();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Erreur upload');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase">
          {'\u{1F4CE}'} Documents ({docs.length})
        </h4>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowUpload(!showUpload)}
            className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 border border-blue-200"
          >
            {'\u2B06'} Uploader
          </button>
        )}
      </div>
      {showUpload && canEdit && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 space-y-2">
          <input
            type="text"
            value={uploadNom}
            onChange={(e) => setUploadNom(e.target.value)}
            placeholder="Nom du document"
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
          />
          <input
            type="text"
            value={uploadDesc}
            onChange={(e) => setUploadDesc(e.target.value)}
            placeholder="Description (optionnel)"
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded bg-white hover:bg-gray-50"
            >
              {uploadFile ? uploadFile.name : `${'\u{1F4CE}'} Choisir un fichier`}
            </button>
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!uploadFile || uploading}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? 'Upload...' : 'Uploader'}
            </button>
            <button type="button" onClick={() => setShowUpload(false)} className="text-xs text-gray-500">
              Annuler
            </button>
          </div>
          <p className="text-[11px] text-amber-800">
            Déposé en confidentiel : vous pourrez retirer l&apos;accès aux administrateurs et accorder des lectures
            explicites via « Accès ».
          </p>
        </div>
      )}
      <div className="space-y-2">
        {docs.length === 0 && <p className="text-sm text-gray-400">Aucun document déposé sur cette user story</p>}
        {docs.map((doc) => {
          const natif = isNativeAuthorControlledUploadDoc(doc);
          return (
            <div key={doc.id} className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className="text-lg">{getFileIcon(doc.fichierType)}</span>
                  <div className="min-w-0">
                    <a
                      href={`${API_BASE_URL}/documents/${doc.id}/view?token=${localStorage.getItem('token')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline truncate block"
                    >
                      {doc.nom}
                    </a>
                    <div className="flex gap-2 flex-wrap mt-0.5">
                      <span className="text-xs text-gray-500 capitalize">{doc.typeDocument}</span>
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 rounded">{doc.statut}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {natif && doc.uploadedById === currentUser?.id && (
                    <button
                      type="button"
                      onClick={() => setNatifAccesDoc({ id: doc.id, nom: doc.nom })}
                      className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                    >
                      {'\u{1F511}'} Accès
                    </button>
                  )}
                </div>
              </div>
              <div className="border-t border-gray-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Accès :</p>
                {natif ? (
                  <div className="text-xs text-gray-700 space-y-2">
                    <div className="flex flex-col items-center w-fit">
                      <div className="w-14 h-14 bg-red-100 border border-red-300 rounded-lg flex flex-col items-center justify-center">
                        <span className="text-xl">{'\u{1F512}'}</span>
                      </div>
                      <span className="text-xs text-red-600 font-medium mt-1">Accès restreint</span>
                    </div>
                    <AccessContratLikeAdminLines
                      keyPrefix={`us-doc-${doc.id}`}
                      users={users}
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
                      droitsAdminCompletLabel={DROITS_ADMIN_DOC_PROJET_NATIF}
                      creatorRightsLabel="auteur — tous les droits sur ce document"
                      niveauLabel={() => 'Lecture'}
                      limitedPrefix="Admin : accès limité —"
                    />
                    {(doc.permissionsUtilisateurs || [])
                      .filter((p: any) => p.user && p.user.role !== 'admin')
                      .map((p: any) => (
                        <div key={p.id || p.user.id} className="min-w-0">
                          <span className="font-medium text-gray-900">
                            {p.user.prenom} {p.user.nom}
                          </span>
                          <span className="text-gray-500 italic ml-1">(Accès explicite : lecture)</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Résumé des accès non disponible pour ce type de pièce.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <DocumentAccesNatifModal
        open={!!natifAccesDoc}
        document={natifAccesDoc}
        users={users}
        classNameZ="z-[90]"
        onClose={() => setNatifAccesDoc(null)}
        onAfterMutation={() => onDocumentsChange?.()}
      />
    </div>
  );
}
