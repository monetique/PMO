import { useEffect, useState } from 'react';
import { api } from '../services/api';

type CfRow = { id: string; nom: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Fiche créée (même API que la page Clients / Fournisseurs). */
  onCreated: (fiche: CfRow) => void;
};

const emptyForm = {
  nom: '',
  typeSocieteId: '',
  matriculeFiscale: '',
  adresse: '',
  pays: '',
};

/**
 * Modal « Ajouter une fiche » alignée sur Clients / Fournisseurs (type client imposé, sans liaison projet ici).
 */
export default function ClientFournisseurQuickCreateModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [typesSociete, setTypesSociete] = useState<{ id: string; nom: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    setErr('');
    api
      .get('/types-societe')
      .then((r) => setTypesSociete(r.data))
      .catch(() => setTypesSociete([]));
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    setErr('');
    if (!form.nom.trim()) {
      setErr('Le nom de l’entité est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post('/clients-fournisseurs', {
        type: 'client',
        nom: form.nom.trim(),
        typeSocieteId: form.typeSocieteId || undefined,
        matriculeFiscale: form.matriculeFiscale.trim() || undefined,
        adresse: form.adresse.trim() || undefined,
        pays: form.pays.trim() || undefined,
        projetIds: [],
      });
      onCreated({ id: data.id, nom: data.nom });
      onClose();
    } catch {
      setErr('Impossible d’enregistrer la fiche. Réessayez ou vérifiez les droits.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-semibold mb-1">+ Ajouter une fiche client</h3>
        <p className="text-xs text-gray-500 mb-4">
          La fiche sera enregistrée comme sur la page Clients / Fournisseurs et pourra y être modifiée.
        </p>
        {err && <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{err}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l&apos;entité *</label>
            <input
              type="text"
              value={form.nom}
              onChange={(e) => setForm({ ...form, nom: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type de société</label>
            <select
              value={form.typeSocieteId}
              onChange={(e) => setForm({ ...form, typeSocieteId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              <option value="">— Sélectionner —</option>
              {typesSociete.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Matricule fiscale / identifiant</label>
            <input
              type="text"
              value={form.matriculeFiscale}
              onChange={(e) => setForm({ ...form, matriculeFiscale: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
            <input
              type="text"
              value={form.adresse}
              onChange={(e) => setForm({ ...form, adresse: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pays</label>
            <input
              type="text"
              value={form.pays}
              onChange={(e) => setForm({ ...form, pays: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}
