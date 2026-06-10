import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, API_BASE_URL } from '../services/api';

type TabType =
  | 'categories'
  | 'smtp'
  | 'entreprise'
  | 'typesSociete'
  | 'typesEntite'
  | 'typesLicence'
  | 'typesContrat'
  | 'devises'
  | 'notifications'
  | 'affichageTache';

const VALID_TABS: TabType[] = [
  'categories',
  'smtp',
  'entreprise',
  'typesSociete',
  'typesEntite',
  'typesLicence',
  'typesContrat',
  'devises',
  'notifications',
  'affichageTache',
];

function isTabType(s: string): s is TabType {
  return VALID_TABS.includes(s as TabType);
}

const NOTIFICATION_EMAIL_KIND_LABELS: Record<string, string> = {
  mention: 'Mention',
  mention_pv: 'Mention (PV de réunion)',
  mention_document: 'Mention (document)',
  mention_licence: 'Mention (licence)',
  mention_processus: 'Mention (processus)',
  mention_projet: 'Mention (projet)',
  mention_contrat: 'Mention (contrat)',
  assignation: 'Assignation (tâche)',
  assignation_projet: 'Assignation (projet)',
  statut: 'Changement de statut',
  retard: 'Tâche en retard',
  nouvelle_tache: 'Nouvelle tâche (projet)',
  nouvelle_tache_projet: 'Nouvelle tâche (projet)',
  commentaire: 'Commentaire (tâche)',
  commentaire_epic: 'Commentaire (epic)',
  commentaire_user_story: 'Commentaire (user story)',
  commentaire_pv: 'Commentaire PV',
  commentaire_pv_assigne: 'Commentaire PV assigné',
  assignation_action_pv: 'Action PV assignée',
  document: 'Document sur tâche',
  licence_alerte: 'Alerte licence',
};

function UnsentEmailNotificationsSection() {
  const PAGE_SIZE = 15;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyBulk, setBusyBulk] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [rows, currentPage]);
  const pageIds = pageRows.map((r) => r.id);
  const selectedOnPageCount = pageIds.filter((id) => selectedIds.includes(id)).length;
  const allPageSelected = pageIds.length > 0 && selectedOnPageCount === pageIds.length;

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await api.get('/admin/notification-email-failures');
      setRows(Array.isArray(data) ? data : []);
      setPage(1);
      setSelectedIds([]);
    } catch (e: any) {
      setRows([]);
      setLoadError(e?.response?.data?.error || 'Impossible de charger les notifications non envoyées.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resend = async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/admin/notification-email-failures/${id}/resend`);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Renvoi impossible');
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectPage = () => {
    setSelectedIds((prev) => {
      if (allPageSelected) {
        return prev.filter((id) => !pageIds.includes(id));
      }
      const set = new Set(prev);
      pageIds.forEach((id) => set.add(id));
      return [...set];
    });
  };

  const bulkResend = async () => {
    if (selectedIds.length === 0) return;
    setBusyBulk(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => api.post(`/admin/notification-email-failures/${id}/resend`))
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const ko = results.length - ok;
      alert(`Renvoi en masse terminé: ${ok} succès${ko ? `, ${ko} échec(s)` : ''}.`);
      await load();
    } catch {
      alert('Renvoi en masse impossible');
    } finally {
      setBusyBulk(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Supprimer ${selectedIds.length} entrée(s) sélectionnée(s) ?`)) return;
    setBusyBulk(true);
    try {
      const results = await Promise.allSettled(
        selectedIds.map((id) => api.delete(`/admin/notification-email-failures/${id}`))
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const ko = results.length - ok;
      alert(`Suppression en masse terminée: ${ok} succès${ko ? `, ${ko} échec(s)` : ''}.`);
      await load();
    } catch {
      alert('Suppression en masse impossible');
    } finally {
      setBusyBulk(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Supprimer cette entrée ? Elle ne sera plus proposée au renvoi.')) return;
    setBusyId(id);
    try {
      await api.delete(`/admin/notification-email-failures/${id}`);
      await load();
    } catch {
      alert('Suppression impossible');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Notifications non envoyées</h2>
          <p className="text-sm text-gray-500 mt-1">
            Emails automatiques (tâches, PV, etc.) qui n’ont pas pu partir : absence de SMTP actif, erreur serveur
            mail, refus du relais, etc. Vous pouvez renvoyer après correction de la configuration ou supprimer l’entrée.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Chargement…' : 'Actualiser'}
        </button>
      </div>

      {loadError ? (
        <div className="text-sm text-red-700 py-4 border border-red-200 rounded-lg px-4 bg-red-50">
          {loadError}
        </div>
      ) : loading && rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-6">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600 py-4 border border-dashed border-gray-200 rounded-lg px-4 bg-gray-50">
          Aucun échec d’envoi enregistré. Les prochains échecs (après déploiement de cette version) apparaîtront ici.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void bulkResend()}
                disabled={busyBulk || selectedIds.length === 0}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {busyBulk ? '…' : `Renvoyer la sélection (${selectedIds.length})`}
              </button>
              <button
                type="button"
                onClick={() => void bulkDelete()}
                disabled={busyBulk || selectedIds.length === 0}
                className="px-3 py-1.5 text-xs border border-red-200 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50"
              >
                Supprimer la sélection
              </button>
            </div>
            <div className="text-xs text-gray-600">
              {rows.length} entrée(s) • Page {currentPage}/{totalPages} • 15 lignes/page
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2 font-medium w-10">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    onChange={toggleSelectPage}
                    aria-label="Sélectionner la page"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Destinataire</th>
                <th className="px-3 py-2 font-medium">Sujet</th>
                <th className="px-3 py-2 font-medium">Erreur</th>
                <th className="px-3 py-2 font-medium w-40">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pageRows.map((r) => {
                const destLabel =
                  r.toUser?.prenom != null
                    ? `${r.toUser.prenom} ${r.toUser.nom} · ${r.toEmail}`
                    : r.toEmail;
                const errShort =
                  String(r.errorMessage || '').length > 140
                    ? `${String(r.errorMessage).slice(0, 140)}…`
                    : r.errorMessage;
                return (
                  <tr key={r.id} className="hover:bg-gray-50/80 align-top">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.id)}
                        onChange={() => toggleSelectOne(r.id)}
                        aria-label={`Sélectionner ${r.id}`}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                      {r.createdAt ? new Date(r.createdAt).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {NOTIFICATION_EMAIL_KIND_LABELS[r.kind] || r.kind}
                    </td>
                    <td className="px-3 py-2 text-gray-800 break-all max-w-[14rem]">{destLabel}</td>
                    <td className="px-3 py-2 text-gray-800 break-all max-w-[14rem]">{r.subject}</td>
                    <td className="px-3 py-2 text-red-700 break-words max-w-[18rem]" title={r.errorMessage}>
                      {errShort || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void resend(r.id)}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {busyId === r.id ? '…' : 'Renvoyer'}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void remove(r.id)}
                          className="px-2 py-1 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Précédent
            </button>
            <span className="text-xs text-gray-600">Page {currentPage} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function JoursFeriesSection() {
  const [rows, setRows] = useState<Array<{ id: string; date: string; libelle: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ date: '', libelle: '' });

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/jours-feries');
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!form.date) {
      alert('La date est obligatoire');
      return;
    }
    if (!form.libelle.trim()) {
      alert('Le libellé est obligatoire');
      return;
    }
    setBusy(true);
    try {
      await api.post('/admin/jours-feries', {
        date: form.date,
        libelle: form.libelle.trim(),
      });
      setForm({ date: '', libelle: '' });
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Supprimer ce jour férié ?')) return;
    setBusy(true);
    try {
      await api.delete(`/admin/jours-feries/${id}`);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Suppression impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Jours fériés</h2>
          <p className="text-sm text-gray-500 mt-1">
            Les jours fériés saisis ici sont déduits du calcul de durée des tâches (uniquement s’ils sont entre la date de début et la date de fin).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="px-3 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
        >
          Actualiser
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 mb-4">
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <input
          type="text"
          value={form.libelle}
          onChange={(e) => setForm((p) => ({ ...p, libelle: e.target.value }))}
          placeholder="Ex: Fête du Travail"
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          Ajouter
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-600">Aucun jour férié configuré.</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2 font-medium w-44">Date</th>
                <th className="px-3 py-2 font-medium">Libellé</th>
                <th className="px-3 py-2 font-medium w-32">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-gray-700">{r.date}</td>
                  <td className="px-3 py-2 text-gray-800">{r.libelle}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(r.id)}
                      className="px-2 py-1 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                    >
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NotificationsTab() {
  const [openTemplate, setOpenTemplate] = useState<string | null>(null);
  const [testEmailMap, setTestEmailMap] = useState<Record<string, string>>({});
  const [testingMap, setTestingMap] = useState<Record<string, boolean>>({});
  const [testResultMap, setTestResultMap] = useState<Record<string, {success: boolean, message: string} | null>>({});
  const [settingsByKey, setSettingsByKey] = useState<
    Record<string, { emailEnabled: boolean; appEnabled: boolean }>
  >({});
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [smtpConfigsNotif, setSmtpConfigsNotif] = useState<any[]>([]);

  const loadNotificationSettings = async () => {
    setSettingsLoading(true);
    try {
      const { data } = await api.get('/admin/notification-settings');
      const m: Record<string, { emailEnabled: boolean; appEnabled: boolean }> = {};
      for (const row of data || []) {
        m[row.key] = { emailEnabled: !!row.emailEnabled, appEnabled: !!row.appEnabled };
      }
      setSettingsByKey(m);
    } catch {
      setSettingsByKey({});
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    void loadNotificationSettings();
    void (async () => {
      try {
        const { data } = await api.get('/smtp');
        setSmtpConfigsNotif(Array.isArray(data) ? data : []);
      } catch {
        setSmtpConfigsNotif([]);
      }
    })();
  }, []);

  const smtpValidForNotifications = useMemo(() => {
    const active = (smtpConfigsNotif || []).find((c: any) => c?.isActive);
    if (!active) return { ok: false as const, reason: 'missing' as const };
    const tr = active.lastTestResult;
    if (tr && tr.success === false) return { ok: false as const, reason: 'failed' as const };
    return { ok: true as const };
  }, [smtpConfigsNotif]);

  const getSetting = (key: string) => settingsByKey[key] || { emailEnabled: true, appEnabled: true };

  const patchNotificationSetting = async (
    key: string,
    partial: { emailEnabled?: boolean; appEnabled?: boolean }
  ) => {
    await api.patch(`/admin/notification-settings/${key}`, partial);
    await loadNotificationSettings();
  };

  const sendTestNotification = async (n: any) => {
    const email = testEmailMap[n.id];
    if (!email) return;
    setTestingMap(prev => ({ ...prev, [n.id]: true }));
    setTestResultMap(prev => ({ ...prev, [n.id]: null }));
    try {
      const res = await api.post('/smtp/test-notification', {
        notificationId: n.id, testEmail: email, sujet: n.sujet, template: n.template,
      });
      setTestResultMap(prev => ({ ...prev, [n.id]: { success: true, message: res.data.message } }));
    } catch (e: any) {
      setTestResultMap(prev => ({ ...prev, [n.id]: { success: false, message: e?.response?.data?.error || 'Erreur envoi' } }));
    }
    setTestingMap(prev => ({ ...prev, [n.id]: false }));
  };

  const notifications = [
    { id: 'mention', icon: '📌', pages: ['Tâches', 'Epics', 'User stories'], titre: 'Mention dans un commentaire Tâches', description: 'Envoye lorsque un utilisateur est mentionne via @Prenom Nom dans un commentaire sur une tache, un epic ou une user story.', destinataire: 'La personne mentionnee', declencheur: 'Ajout commentaire avec @mention', sujet: 'Mention (tache / epic / user story) : [Titre]', template: `Bonjour [Prenom Nom],

[Auteur] vous a mentionne dans un commentaire (tache, epic ou user story) :

[Titre]

"[Contenu du commentaire]"

PMO Hub` },
    { id: 'mention_processus', icon: '📌', pages: ['Processus'], titre: 'Mention dans un commentaire Processus', description: 'Envoyee lorsqu un utilisateur est mentionne via @Prenom Nom dans un commentaire lie a un document reference par un processus.', destinataire: 'La personne mentionnee', declencheur: 'Ajout commentaire document lie a un processus avec @mention', sujet: 'Mention (processus) : [Nom processus]', template: `Bonjour [Prenom Nom],

[Auteur] vous a mentionne dans un commentaire lie au processus :

[Nom processus]

"[Contenu du commentaire]"

PMO Hub` },
    { id: 'mention_projet', icon: '📌', pages: ['Projets'], titre: 'Mention dans un commentaire Projets', description: 'Envoyee lorsqu un utilisateur est mentionne via @Prenom Nom dans un commentaire lie a un document reference par un projet.', destinataire: 'La personne mentionnee', declencheur: 'Ajout commentaire document lie a un projet avec @mention', sujet: 'Mention (projet) : [Nom projet]', template: `Bonjour [Prenom Nom],

[Auteur] vous a mentionne dans un commentaire lie au projet :

[Nom projet]

"[Contenu du commentaire]"

PMO Hub` },
    { id: 'mention_contrat', icon: '📌', pages: ['Contrats'], titre: 'Mention dans un commentaire Contrats', description: 'Envoyee lorsqu un utilisateur est mentionne via @Prenom Nom dans un commentaire lie a un document rattache a un contrat.', destinataire: 'La personne mentionnee', declencheur: 'Ajout commentaire document lie a un contrat avec @mention', sujet: 'Mention (contrat) : [Nom contrat]', template: `Bonjour [Prenom Nom],

[Auteur] vous a mentionne dans un commentaire lie au contrat :

[Nom contrat]

"[Contenu du commentaire]"

PMO Hub` },
    { id: 'mention_pv', icon: '📌', pages: ['PV de réunion'], titre: 'Mention dans un commentaire PV-Réunion', description: 'Envoyee lorsqu un utilisateur est mentionne via @Prenom Nom dans un commentaire sur un PV de reunion.', destinataire: 'La personne mentionnee', declencheur: 'Ajout commentaire PV avec @mention', sujet: 'Mention (PV de reunion) : [Titre PV]', template: `Bonjour [Prenom Nom],

[Auteur] vous a mentionne dans un commentaire sur le PV :

[Titre PV]

"[Contenu du commentaire]"

PMO Hub` },
    { id: 'mention_document', icon: '📌', pages: ['Documents'], titre: 'Mention dans un commentaire Document', description: 'Envoyee lorsqu un utilisateur est mentionne via @Prenom Nom dans un commentaire de document.', destinataire: 'La personne mentionnee', declencheur: 'Ajout commentaire document avec @mention', sujet: 'Mention (document) : [Titre document]', template: `Bonjour [Prenom Nom],

[Auteur] vous a mentionne dans un commentaire sur le document :

[Titre document]

"[Contenu du commentaire]"

PMO Hub` },
    { id: 'mention_licence', icon: '📌', pages: ['Licences'], titre: 'Mention dans un commentaire Licence', description: 'Envoyee lorsqu un utilisateur est mentionne via @Prenom Nom dans un commentaire de licence.', destinataire: 'La personne mentionnee', declencheur: 'Ajout commentaire licence avec @mention', sujet: 'Mention (licence) : [Nom licence]', template: `Bonjour [Prenom Nom],

[Auteur] vous a mentionne dans un commentaire sur la licence :

[Nom licence]

"[Contenu du commentaire]"

PMO Hub` },
    { id: 'assignation', icon: '✅', pages: ['Tâches'], titre: 'Assignation a une tache', description: 'Envoye lorsque un utilisateur est assigne a une tache.', destinataire: 'Utilisateur assigne', declencheur: 'Creation ou modification avec assignation', sujet: 'Nouvelle assignation : [Nom tache]', template: `Bonjour [Prenom Nom],

[Auteur] vous a assigne a la tache :

[Nom de la tache]

PMO Hub` },
    { id: 'assignation_projet', icon: '✅', pages: ['Projets'], titre: 'Assignation à un Projet', description: 'Envoyee lorsqu un utilisateur est nouvellement assigne sur un projet (responsable, gestionnaire, sponsor, chef de projet, tech lead, equipe projet).', destinataire: 'Utilisateur assigne sur le projet', declencheur: 'Creation / modification du projet avec ajout d un role', sujet: 'Assignation projet : [Nom projet]', template: `Bonjour [Prenom Nom],

[Auteur] vous a assigné au projet :

[Nom projet]

Rôle(s) : [Roles]

PMO Hub` },
    { id: 'statut', icon: '🔄', pages: ['Tâches', 'Processus', 'Projets'], titre: 'Changement de statut', description: 'Envoye lorsque le statut est modifie.', destinataire: 'Createur et utilisateurs assignes', declencheur: 'Modification du statut', sujet: 'Statut modifie : [Nom tache]', template: `Bonjour [Prenom Nom],

[Auteur] a modifie le statut de [Nom tache] :

[Ancien statut] => [Nouveau statut]

PMO Hub` },
    { id: 'retard', icon: '⚠️', pages: ['Tâches', 'Projets'], titre: 'Tache en retard', description: 'Envoye chaque matin a 8h pour les taches dont la date de fin est depassee.', destinataire: 'Createur et utilisateurs assignes', declencheur: 'Job automatique a 8h00', sujet: 'Tache en retard : [Nom tache]', template: `Bonjour [Prenom Nom],

La tache suivante est en retard de [N] jour(s) :

[Nom de la tache]

PMO Hub` },
    { id: 'nouvelle_tache', icon: '📋', pages: ['Tâches', 'Projets'], titre: 'Nouvelle tache liee a un projet', description: 'Envoye aux membres du projet lorsque une nouvelle tache y est liee.', destinataire: 'Membres du projet', declencheur: 'Creation tache avec projet associe', sujet: 'Nouvelle tache dans [Nom projet]', template: `Bonjour [Prenom Nom],

[Auteur] a cree une nouvelle tache dans [Nom projet] :

[Nom de la tache]

PMO Hub` },
    { id: 'commentaire', icon: '💬', pages: ['Tâches', 'Epics', 'User stories', 'Processus', 'Projets', 'Documents'], titre: 'Nouveau commentaire (tache)', description: 'Envoye lorsque un commentaire est ajoute sur une tache.', destinataire: 'Createur et assignes (hors auteur)', declencheur: 'Ajout commentaire sur une tache', sujet: 'Nouveau commentaire : [Nom tache]', template: `Bonjour [Prenom Nom],

[Auteur] a commente la tache [Nom tache] :

"[Contenu]"

PMO Hub` },
    { id: 'commentaire_epic', icon: '💬', pages: ['Tâches', 'Epics'], titre: 'Nouveau commentaire sur un epic', description: 'Envoye au createur de l epic et aux createurs / assignes des taches rattachees aux user stories de l epic (hors auteur).', destinataire: 'Createur epic + parties prenantes des taches liees', declencheur: 'Ajout commentaire sur un epic', sujet: 'Nouveau commentaire : [Nom epic]', template: `Bonjour [Prenom Nom],

[Auteur] a commente l epic [Nom epic] :

"[Contenu]"

PMO Hub` },
    { id: 'commentaire_user_story', icon: '💬', pages: ['Tâches', 'User stories'], titre: 'Nouveau commentaire sur une user story', description: 'Envoye aux createurs et assignes des taches liees a la user story (hors auteur).', destinataire: 'Createurs et assignes des taches liees', declencheur: 'Ajout commentaire sur une user story', sujet: 'Nouveau commentaire : [User story]', template: `Bonjour [Prenom Nom],

[Auteur] a commente la user story [Extrait description] :

"[Contenu]"

PMO Hub` },
    { id: 'document', icon: '📎', pages: ['Documents', 'Tâches', 'Processus', 'Projets', 'Contrats'], titre: 'Document uploade', description: 'Envoye lorsque un document est uploade sur une tache.', destinataire: 'Createur et assignes (hors auteur)', declencheur: 'Upload document sur une tache', sujet: 'Nouveau document : [Nom tache]', template: `Bonjour [Prenom Nom],

[Auteur] a uploade un document sur [Nom tache] :

[Nom du document]

PMO Hub` },
    { id: 'commentaire_pv', icon: '💬', pages: ['PV de réunion'], titre: 'Commentaire sur un PV de réunion', description: 'Envoye lorsque un commentaire est ajoute sur un PV. Si le commentaire est assigne a un utilisateur, seul celui-ci est notifie ; sinon le createur du PV et les delegues modification.', destinataire: 'Assigne (prioritaire) ou createur + delegues', declencheur: 'Ajout commentaire sur un PV', sujet: 'Commentaire sur PV : [Titre PV]', template: `Bonjour [Prenom Nom],

[Auteur] a commente le PV [Titre PV] :

"[Contenu]"

[Si piece jointe : mention de l annexe]

PMO Hub` },
    {
      id: 'assignation_action_pv',
      icon: '✅',
      pages: ['PV de réunion'],
      titre: 'Action du tableau assignée (PV)',
      description:
        'Envoyée lorsqu’une ligne d’action du PV est assignée à un ou plusieurs utilisateurs (et entité avec notification).',
      destinataire: 'Utilisateurs assignés (+ responsable entité si concerné)',
      declencheur: 'Enregistrement du PV avec actions notifiables',
      sujet: 'Action assignée sur PV : [Titre PV]',
      template: `Bonjour [Prenom Nom],

[Auteur] vous a assigné une action dans le procès-verbal [Titre PV].

[Libellé action]

PMO Hub`,
    },
    {
      id: 'licence_alerte',
      icon: '🔔',
      pages: ['Licences'],
      titre: 'Alerte licence (échéance / récurrence)',
      description:
        'Envoyee aux destinataires choisis sur la fiche licence, selon une date avant fin de validite ou une date fixe avec recurrence (semaine, mois, an). Arretee si la licence est au statut Cloturee. Execution cote serveur : verification environ toutes les heures.',
      destinataire: 'Utilisateurs selectionnes sur l alerte',
      declencheur: 'Job serveur + regles definies dans le detail licence',
      sujet: 'Alerte licence : [Nom licence]',
      template: `Bonjour [Prenom Nom],

Ceci est une alerte concernant la licence suivante :
• Nom : [Nom licence]
• Reference : [Reference]
• Type : [Type licence]
• Date de debut : [Date debut]
• Date de fin : [Date fin]
• Contexte : [Contexte alerte]

Consultez l application pour plus de details : [Lien application]

— PMO Hub`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-2">Notifications par email</h2>
        <p className="text-sm text-gray-500 mb-6">Liste des notifications automatiques envoyees par application.</p>
        <div className="space-y-3">
          {notifications.map(n => (
            <div key={n.id} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex items-start gap-4 p-4 hover:bg-gray-50">
                <div className="text-2xl shrink-0">{n.icon}</div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-gray-800 mb-1">{n.titre}</h3>
                  <p className="text-sm text-gray-600 mb-2">{n.description}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-2">
                    <span>Destinataire : {n.destinataire}</span>
                    <span>Declencheur : {n.declencheur}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-xs text-gray-400 font-medium mr-1">Pages concernées :</span>
                    {(n as any).pages?.map((p: string) => (
                      <span key={p} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-xs font-medium border border-indigo-100">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0 text-xs">
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">Application</span>
                    <div className="flex rounded-md border border-gray-200 overflow-hidden">
                      <button
                        type="button"
                        disabled={settingsLoading}
                        onClick={() => void patchNotificationSetting(n.id, { appEnabled: true })}
                        className={`px-2 py-1 ${getSetting(n.id).appEnabled ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Activée
                      </button>
                      <button
                        type="button"
                        disabled={settingsLoading}
                        onClick={() => void patchNotificationSetting(n.id, { appEnabled: false })}
                        className={`px-2 py-1 border-l border-gray-200 ${!getSetting(n.id).appEnabled ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Désactivée
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500">Email</span>
                    <div className="flex rounded-md border border-gray-200 overflow-hidden">
                      <button
                        type="button"
                        disabled={settingsLoading}
                        onClick={() => void patchNotificationSetting(n.id, { emailEnabled: true })}
                        className={`px-2 py-1 ${getSetting(n.id).emailEnabled ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Activé
                      </button>
                      <button
                        type="button"
                        disabled={settingsLoading}
                        onClick={() => void patchNotificationSetting(n.id, { emailEnabled: false })}
                        className={`px-2 py-1 border-l border-gray-200 ${!getSetting(n.id).emailEnabled ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                      >
                        Désactivé
                      </button>
                    </div>
                  </div>
                  <button onClick={() => setOpenTemplate(openTemplate === n.id ? null : n.id)} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 text-gray-600">
                    {openTemplate === n.id ? 'Masquer' : 'Voir template'}
                  </button>
                </div>
              </div>
              {openTemplate === n.id && (
                <div className="border-t border-gray-100 bg-gray-50 p-4">
                  <div className="bg-white border border-gray-200 rounded-lg overflow-hidden max-w-2xl">
                    <div className="bg-blue-600 text-white px-4 py-3">
                      <p className="text-xs font-medium opacity-75 mb-1">Sujet :</p>
                      <p className="text-sm font-semibold">{n.sujet}</p>
                    </div>
                    <div className="p-4">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{n.template}</pre>
                      <p className="text-xs text-gray-400 mt-3">PMO Hub — Notification automatique</p>
                    </div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg p-4 max-w-2xl mt-3">
                    <p className="text-sm font-semibold text-gray-700 mb-3">📧 Tester l'envoi de cette notification</p>
                    <div className="flex gap-2 mb-2">
                      <input type="email" placeholder="Entrez votre adresse email..."
                        value={testEmailMap[n.id] || ''}
                        onChange={e => setTestEmailMap(prev => ({ ...prev, [n.id]: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
                      <button onClick={() => sendTestNotification(n)}
                        disabled={testingMap[n.id] || !testEmailMap[n.id]}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {testingMap[n.id] ? '⏳ Envoi...' : '📤 Envoyer le test'}
                      </button>
                    </div>
                    {testResultMap[n.id] && (
                      <div className={`px-3 py-2 rounded text-sm ${testResultMap[n.id]!.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                        {testResultMap[n.id]!.success ? '✅ ' : '❌ '}{testResultMap[n.id]!.message}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Les valeurs entre [crochets] sont remplacees automatiquement.</p>
                </div>
              )}
            </div>
          ))}
        </div>
        {!smtpValidForNotifications.ok && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800 font-medium">
              {smtpValidForNotifications.reason === 'missing'
                ? 'Aucune configuration SMTP active : les emails de notification ne peuvent pas être envoyés. Activez et testez une configuration dans l’onglet « Configuration SMTP ».'
                : 'La configuration SMTP active a échoué au dernier test : les envois risquent d’échouer. Corrigez les paramètres puis relancez un test depuis l’onglet « Configuration SMTP ».'}
            </p>
          </div>
        )}
      </div>

      <JoursFeriesSection />
      <UnsentEmailNotificationsSection />
    </div>
  );
}

export default function Configuration() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const t = searchParams.get('tab');
    return t && isTabType(t) ? t : 'categories';
  });

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && isTabType(t)) setActiveTab(t);
  }, [searchParams]);

  const selectTab = (tab: TabType) => {
    setActiveTab(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', tab);
        return next;
      },
      { replace: true }
    );
  };

  // Catégories
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any>(null);
  const [formData, setFormData] = useState({
    nom: '',
    description: '',
    couleur: '#3B82F6',
    icone: '',
    parentId: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // SMTP
  const [smtpConfigs, setSmtpConfigs] = useState<any[]>([]);
  const [smtpLoading, setSmtpLoading] = useState(true);
  const [typesSocieteList, setTypesSocieteList] = useState<any[]>([]);
  const [tsLoading, setTsLoading] = useState(false);
  const [showTsModal, setShowTsModal] = useState(false);
  const [editingTs, setEditingTs] = useState<any>(null);
  const [tsForm, setTsForm] = useState({ nom: '', description: '' });
  const [typesLicenceList, setTypesLicenceList] = useState<any[]>([]);
  const [tlLoading, setTlLoading] = useState(false);
  const [showTlModal, setShowTlModal] = useState(false);
  const [editingTl, setEditingTl] = useState<any>(null);
  const [tlForm, setTlForm] = useState({ nom: '' });
  const [typesContratList, setTypesContratList] = useState<any[]>([]);
  const [tcLoading, setTcLoading] = useState(false);
  const [showTcModal, setShowTcModal] = useState(false);
  const [editingTc, setEditingTc] = useState<any>(null);
  const [tcForm, setTcForm] = useState({ code: '', libelle: '' });
  const [typesEntiteList, setTypesEntiteList] = useState<any[]>([]);
  const [teLoading, setTeLoading] = useState(false);
  const [showTeModal, setShowTeModal] = useState(false);
  const [editingTe, setEditingTe] = useState<any>(null);
  const [teForm, setTeForm] = useState({ code: '', libelle: '', ordre: 0, actif: true });
  const [devisesList, setDevisesList] = useState<any[]>([]);
  const [devLoading, setDevLoading] = useState(false);
  const [showDevModal, setShowDevModal] = useState(false);
  const [editingDev, setEditingDev] = useState<any>(null);
  const [devForm, setDevForm] = useState({ code: '', libelle: '' });
  const [showSmtpModal, setShowSmtpModal] = useState(false);
  const [editingSmtp, setEditingSmtp] = useState<any>(null);
  const [smtpFormData, setSmtpFormData] = useState({
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    fromEmail: '',
    fromName: '',
    isActive: false,
  });
  const [smtpSubmitting, setSmtpSubmitting] = useState(false);
  const [smtpError, setSmtpError] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);
  const [companyError, setCompanyError] = useState('');
  const [companyLogoFile, setCompanyLogoFile] = useState<File | null>(null);
  const [companyRemoveLogo, setCompanyRemoveLogo] = useState(false);
  const [companyInfo, setCompanyInfo] = useState({
    nomEntreprise: '',
    formatEntreprise: '',
    tailleEntreprise: '',
    adresseEntreprise: '',
    logoFilename: '',
    updatedAt: '',
    updatedBy: null as null | { prenom?: string; nom?: string; email?: string },
  });

  useEffect(() => {
    if (activeTab === 'categories') {
      loadCategories();
    } else if (activeTab === 'typesSociete') {
      loadTypesSociete();
    } else if (activeTab === 'typesLicence') {
      loadTypesLicence();
    } else if (activeTab === 'typesContrat') {
      loadTypesContrat();
    } else if (activeTab === 'typesEntite') {
      loadTypesEntite();
    } else if (activeTab === 'devises') {
      loadDevises();
    } else if (activeTab === 'smtp') {
      loadSmtpConfigs();
    } else if (activeTab === 'entreprise') {
      loadCompanyInfo();
    }
  }, [activeTab]);

  const loadCompanyInfo = async () => {
    try {
      setCompanyLoading(true);
      const { data } = await api.get('/company-info');
      setCompanyInfo({
        nomEntreprise: data?.nomEntreprise || '',
        formatEntreprise: data?.formatEntreprise || '',
        tailleEntreprise: data?.tailleEntreprise || '',
        adresseEntreprise: data?.adresseEntreprise || '',
        logoFilename: data?.logoFilename || '',
        updatedAt: data?.updatedAt || '',
        updatedBy: data?.updatedBy || null,
      });
      setCompanyLogoFile(null);
      setCompanyRemoveLogo(false);
    } catch (e: any) {
      setCompanyError(e?.response?.data?.error || 'Impossible de charger les informations entreprise.');
    } finally {
      setCompanyLoading(false);
    }
  };

  const saveCompanyInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCompanySaving(true);
      setCompanyError('');
      const fd = new FormData();
      fd.append('nomEntreprise', companyInfo.nomEntreprise || '');
      fd.append('formatEntreprise', companyInfo.formatEntreprise || '');
      fd.append('tailleEntreprise', companyInfo.tailleEntreprise || '');
      fd.append('adresseEntreprise', companyInfo.adresseEntreprise || '');
      if (companyLogoFile) fd.append('logo', companyLogoFile);
      if (companyRemoveLogo) fd.append('removeLogo', 'true');
      const { data } = await api.put('/company-info', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCompanyInfo({
        nomEntreprise: data?.nomEntreprise || '',
        formatEntreprise: data?.formatEntreprise || '',
        tailleEntreprise: data?.tailleEntreprise || '',
        adresseEntreprise: data?.adresseEntreprise || '',
        logoFilename: data?.logoFilename || '',
        updatedAt: data?.updatedAt || '',
        updatedBy: data?.updatedBy || null,
      });
      setCompanyLogoFile(null);
      setCompanyRemoveLogo(false);
    } catch (err: any) {
      setCompanyError(err?.response?.data?.error || 'Erreur lors de l’enregistrement.');
    } finally {
      setCompanySaving(false);
    }
  };

  const loadTypesSociete = async () => {
    setTsLoading(true);
    try { const r = await api.get("/types-societe"); setTypesSocieteList(r.data); } catch(e) { console.error(e); }
    setTsLoading(false);
  };
  const handleSaveTs = async () => {
    try {
      if (editingTs) await api.put(`/types-societe/${editingTs.id}`, tsForm);
      else await api.post("/types-societe", tsForm);
      setShowTsModal(false); setEditingTs(null); setTsForm({ nom: "", description: "" }); loadTypesSociete();
    } catch(e) { alert("Erreur"); }
  };
  const handleDeleteTs = async (id: string, nom: string) => {
    if (!confirm(`Supprimer "${nom}" ?`)) return;
    await api.delete(`/types-societe/${id}`); loadTypesSociete();
  };

  const loadTypesLicence = async () => {
    setTlLoading(true);
    try {
      const r = await api.get('/types-licence');
      setTypesLicenceList(r.data);
    } catch (e) {
      console.error(e);
    }
    setTlLoading(false);
  };
  const handleSaveTl = async () => {
    try {
      if (editingTl) await api.put(`/types-licence/${editingTl.id}`, tlForm);
      else await api.post('/types-licence', tlForm);
      setShowTlModal(false);
      setEditingTl(null);
      setTlForm({ nom: '' });
      loadTypesLicence();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };
  const handleDeleteTl = async (id: string, nom: string) => {
    if (!confirm(`Supprimer le type de licence « ${nom} » ?`)) return;
    try {
      await api.delete(`/types-licence/${id}`);
      loadTypesLicence();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const loadTypesContrat = async () => {
    setTcLoading(true);
    try {
      const r = await api.get('/types-contrat');
      setTypesContratList(r.data);
    } catch (e) {
      console.error(e);
    }
    setTcLoading(false);
  };
  const handleSaveTc = async () => {
    try {
      if (editingTc) await api.put(`/types-contrat/${editingTc.id}`, tcForm);
      else await api.post('/types-contrat', tcForm);
      setShowTcModal(false);
      setEditingTc(null);
      setTcForm({ code: '', libelle: '' });
      loadTypesContrat();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };
  const handleDeleteTc = async (id: string, libelle: string) => {
    if (!confirm(`Supprimer le type de contrat « ${libelle} » ?`)) return;
    try {
      await api.delete(`/types-contrat/${id}`);
      loadTypesContrat();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const loadTypesEntite = async () => {
    setTeLoading(true);
    try {
      const r = await api.get('/types-entite');
      setTypesEntiteList(r.data);
    } catch (e) {
      console.error(e);
    }
    setTeLoading(false);
  };
  const handleSaveTe = async () => {
    try {
      const payload = {
        code: teForm.code,
        libelle: teForm.libelle,
        ordre: Number(teForm.ordre) || 0,
        actif: teForm.actif,
      };
      if (editingTe) await api.put(`/types-entite/${editingTe.id}`, payload);
      else await api.post('/types-entite', payload);
      setShowTeModal(false);
      setEditingTe(null);
      setTeForm({ code: '', libelle: '', ordre: 0, actif: true });
      loadTypesEntite();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };
  const handleDeleteTe = async (id: string, libelle: string) => {
    if (!confirm(`Supprimer le type d'entité « ${libelle} » ?`)) return;
    try {
      await api.delete(`/types-entite/${id}`);
      loadTypesEntite();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const loadDevises = async () => {
    setDevLoading(true);
    try {
      const r = await api.get('/devises');
      setDevisesList(r.data);
    } catch (e) {
      console.error(e);
    }
    setDevLoading(false);
  };
  const handleSaveDev = async () => {
    try {
      const payload = { code: devForm.code, libelle: devForm.libelle || null };
      if (editingDev) await api.put(`/devises/${editingDev.id}`, payload);
      else await api.post('/devises', payload);
      setShowDevModal(false);
      setEditingDev(null);
      setDevForm({ code: '', libelle: '' });
      loadDevises();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };
  const handleDeleteDev = async (id: string, code: string) => {
    if (!confirm(`Supprimer la devise « ${code} » ?`)) return;
    try {
      await api.delete(`/devises/${id}`);
      loadDevises();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const loadCategories = async () => {
    try {
      const response = await api.get('/categories');
      setCategories(response.data);
    } catch (error) {
      console.error('Erreur chargement catégories:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (!formData.nom.trim()) {
        setError('Le nom est obligatoire');
        return;
      }

      const submitData = {
        ...formData,
        parentId: formData.parentId || undefined,
        description: formData.description || undefined,
        icone: formData.icone || undefined,
      };

      if (editingCategory) {
        await api.put(`/categories/${editingCategory.id}`, submitData);
      } else {
        await api.post('/categories', submitData);
      }

      setShowModal(false);
      setEditingCategory(null);
      setFormData({
        nom: '',
        description: '',
        couleur: '#3B82F6',
        icone: '',
        parentId: '',
      });
      loadCategories();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de l\'opération');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (category: any) => {
    setEditingCategory(category);
    setFormData({
      nom: category.nom || '',
      description: category.description || '',
      couleur: category.couleur || '#3B82F6',
      icone: category.icone || '',
      parentId: category.parentId || '',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette catégorie ?')) {
      return;
    }

    setDeletingId(id);
    try {
      await api.delete(`/categories/${id}`);
      loadCategories();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCancel = () => {
    setShowModal(false);
    setEditingCategory(null);
    setFormData({
      nom: '',
      description: '',
      couleur: '#3B82F6',
      icone: '',
      parentId: '',
    });
    setError('');
  };

  const loadSmtpConfigs = async () => {
    try {
      setSmtpLoading(true);
      const response = await api.get('/smtp');
      setSmtpConfigs(response.data);
    } catch (error) {
      console.error('Erreur chargement configs SMTP:', error);
    } finally {
      setSmtpLoading(false);
    }
  };

  const handleSmtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpError('');
    setSmtpSubmitting(true);

    try {
      const submitData = {
        ...smtpFormData,
        port: parseInt(smtpFormData.port.toString()),
        fromName: smtpFormData.fromName || undefined,
      };

      if (editingSmtp) {
        await api.put(`/smtp/${editingSmtp.id}`, submitData);
      } else {
        await api.post('/smtp', submitData);
      }

      setShowSmtpModal(false);
      setEditingSmtp(null);
      setSmtpFormData({
        host: '',
        port: 587,
        secure: false,
        user: '',
        password: '',
        fromEmail: '',
        fromName: '',
        isActive: false,
      });
      loadSmtpConfigs();
    } catch (err: any) {
      setSmtpError(err.response?.data?.error || 'Erreur lors de l\'opération');
    } finally {
      setSmtpSubmitting(false);
    }
  };

  const handleEditSmtp = (config: any) => {
    setEditingSmtp(config);
    setSmtpFormData({
      host: config.host || '',
      port: config.port || 587,
      secure: config.secure || false,
      user: config.user || '',
      password: '', // Ne pas pré-remplir le mot de passe
      fromEmail: config.fromEmail || '',
      fromName: config.fromName || '',
      isActive: config.isActive || false,
    });
    setShowSmtpModal(true);
  };

  const handleDeleteSmtp = async (id: string) => {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette configuration SMTP ?')) {
      return;
    }

    try {
      await api.delete(`/smtp/${id}`);
      loadSmtpConfigs();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  };

  const handleTestSmtp = async (id: string) => {
    if (!testEmail.trim()) {
      alert('Veuillez saisir un email de test');
      return;
    }

    setTestingId(id);
    try {
      const response = await api.post(`/smtp/${id}/test`, { testEmail });
      alert(response.data.message || 'Test réussi !');
      loadSmtpConfigs(); // Recharger pour afficher le résultat du test
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors du test');
      loadSmtpConfigs(); // Recharger même en cas d'erreur pour afficher le résultat
    } finally {
      setTestingId(null);
      setTestEmail('');
    }
  };

  if (loading && activeTab === 'categories') return <div className="p-6">Chargement...</div>;
  if (smtpLoading && activeTab === 'smtp') return <div className="p-6">Chargement...</div>;

  // Organiser les catégories en arbre (catégories racines avec leurs enfants)
  const rootCategories = categories.filter((cat) => !cat.parentId);
  const getChildren = (parentId: string) => {
    return categories.filter((cat) => cat.parentId === parentId);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Configuration</h1>

      {/* Onglets : retour à la ligne pour que tous restent visibles */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex flex-wrap gap-x-6 gap-y-2">
          <button
            onClick={() => selectTab('categories')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'categories'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Catégories
          </button>
          <button
            onClick={() => selectTab('smtp')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'smtp'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Configuration SMTP
          </button>
          <button
            onClick={() => selectTab('entreprise')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'entreprise'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Informations entreprise
          </button>
          <button
            onClick={() => selectTab('typesSociete')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'typesSociete'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Types de société
          </button>
          <button
            onClick={() => selectTab('typesEntite')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'typesEntite'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Types d'entité
          </button>
          <button
            onClick={() => selectTab('typesLicence')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'typesLicence'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Types de licence
          </button>
          <button
            onClick={() => selectTab('typesContrat')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'typesContrat'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Types de contrat
          </button>
          <button
            onClick={() => selectTab('devises')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'devises'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Devises
          </button>
          <button
            onClick={() => selectTab('notifications')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'notifications'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            🔔 Notifications
          </button>
          <button
            onClick={() => selectTab('affichageTache')}
            className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
              activeTab === 'affichageTache'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Affichage tâche
          </button>
        </nav>
      </div>

      {/* Contenu Catégories */}
      {activeTab === 'categories' && (
        <>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Catégories de processus</h2>
            <button
              onClick={() => {
                setEditingCategory(null);
                setFormData({
                  nom: '',
                  description: '',
                  couleur: '#3B82F6',
                  icone: '',
                  parentId: '',
                });
                setShowModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Ajouter une catégorie
            </button>
          </div>

      {/* Modal de création/édition */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-auto">
            <div className="p-6 max-h-[85vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">
                  {editingCategory ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
                </h2>
                <button
                  onClick={handleCancel}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nom <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nom}
                    onChange={(e) => setFormData({ ...formData, nom: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Nom de la catégorie"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Description de la catégorie"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Couleur
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="color"
                        value={formData.couleur}
                        onChange={(e) => setFormData({ ...formData, couleur: e.target.value })}
                        className="h-10 w-20 border border-gray-300 rounded cursor-pointer"
                      />
                      <input
                        type="text"
                        value={formData.couleur}
                        onChange={(e) => setFormData({ ...formData, couleur: e.target.value })}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="#3B82F6"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Icône
                    </label>
                    <input
                      type="text"
                      value={formData.icone}
                      onChange={(e) => setFormData({ ...formData, icone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="ex: 📁, 📄, 📋"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Catégorie parente
                  </label>
                  <select
                    value={formData.parentId}
                    onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Aucune (catégorie racine)</option>
                    {categories
                      .filter((cat) => !editingCategory || cat.id !== editingCategory.id)
                      .map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.nom}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {submitting ? 'Enregistrement...' : editingCategory ? 'Modifier' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Liste des catégories */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {categories.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Aucune catégorie. Cliquez sur "Ajouter une catégorie" pour commencer.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {rootCategories.map((category) => (
              <div key={category.id} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                      style={{ backgroundColor: category.couleur || '#3B82F6', color: 'white' }}
                    >
                      {category.icone || '📁'}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{category.nom}</h3>
                        {category._count && category._count.processus > 0 && (
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {category._count.processus} processus
                          </span>
                        )}
                      </div>
                      {category.description && (
                        <p className="text-sm text-gray-600 mt-1">{category.description}</p>
                      )}
                      {category.couleur && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-gray-500">Couleur:</span>
                          <div
                            className="w-6 h-6 rounded border border-gray-300"
                            style={{ backgroundColor: category.couleur }}
                          />
                          <span className="text-xs text-gray-500">{category.couleur}</span>
                        </div>
                      )}
                      {/* Afficher les sous-catégories */}
                      {getChildren(category.id).length > 0 && (
                        <div className="mt-3 ml-6 pl-4 border-l-2 border-gray-200">
                          <p className="text-xs text-gray-500 mb-2">Sous-catégories:</p>
                          {getChildren(category.id).map((child) => (
                            <div key={child.id} className="mb-2 flex items-center justify-between group">
                              <div className="flex items-center gap-2 flex-1">
                                <div
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                                  style={{ backgroundColor: child.couleur || '#3B82F6', color: 'white' }}
                                >
                                  {child.icone || '📁'}
                                </div>
                                <div>
                                  <span className="text-sm text-gray-700">{child.nom}</span>
                                  {child.description && (
                                    <p className="text-xs text-gray-500">{child.description}</p>
                                  )}
                                </div>
                                {child._count && child._count.processus > 0 && (
                                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                    {child._count.processus} processus
                                  </span>
                                )}
                              </div>
                              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => handleEdit(child)}
                                  className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                                >
                                  Modifier
                                </button>
                                <button
                                  onClick={() => handleDelete(child.id)}
                                  disabled={deletingId === child.id}
                                  className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                                >
                                  {deletingId === child.id ? '...' : 'Supprimer'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(category)}
                      className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Modifier
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      disabled={deletingId === category.id}
                      className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                    >
                      {deletingId === category.id ? 'Suppression...' : 'Supprimer'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </>
      )}

      {/* Contenu SMTP */}
      {activeTab === 'smtp' && (
        <>
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Configurations SMTP</h2>
            <button
              onClick={() => {
                setEditingSmtp(null);
                setSmtpFormData({
                  host: '',
                  port: 587,
                  secure: false,
                  user: '',
                  password: '',
                  fromEmail: '',
                  fromName: '',
                  isActive: false,
                });
                setShowSmtpModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Nouvelle configuration SMTP
            </button>
          </div>

          {/* Modal de création/édition SMTP */}
          {showSmtpModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto py-4">
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 my-auto">
                <div className="p-6 max-h-[85vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">
                      {editingSmtp ? 'Modifier la configuration SMTP' : 'Nouvelle configuration SMTP'}
                    </h2>
                    <button
                      onClick={() => {
                        setShowSmtpModal(false);
                        setEditingSmtp(null);
                        setSmtpFormData({
                          host: '',
                          port: 587,
                          secure: false,
                          user: '',
                          password: '',
                          fromEmail: '',
                          fromName: '',
                          isActive: false,
                        });
                        setSmtpError('');
                      }}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      ✕
                    </button>
                  </div>

                  {smtpError && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
                      {smtpError}
                    </div>
                  )}

                  <form onSubmit={handleSmtpSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Serveur SMTP (host) <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={smtpFormData.host}
                          onChange={(e) => setSmtpFormData({ ...smtpFormData, host: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder="smtp.example.com"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Port <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          required
                          value={smtpFormData.port}
                          onChange={(e) => setSmtpFormData({ ...smtpFormData, port: parseInt(e.target.value) || 587 })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder="587"
                        />
                      </div>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={smtpFormData.secure}
                        onChange={(e) => setSmtpFormData({ ...smtpFormData, secure: e.target.checked })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label className="ml-2 block text-sm text-gray-700">
                        Connexion sécurisée (SSL/TLS) - généralement pour le port 465
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Utilisateur <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={smtpFormData.user}
                          onChange={(e) => setSmtpFormData({ ...smtpFormData, user: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder="user@example.com"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Mot de passe <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="password"
                          required={!editingSmtp}
                          value={smtpFormData.password}
                          onChange={(e) => setSmtpFormData({ ...smtpFormData, password: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder={editingSmtp ? 'Laisser vide pour ne pas modifier' : 'Mot de passe'}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Email expéditeur <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          required
                          value={smtpFormData.fromEmail}
                          onChange={(e) => setSmtpFormData({ ...smtpFormData, fromEmail: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder="noreply@example.com"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nom expéditeur
                        </label>
                        <input
                          type="text"
                          value={smtpFormData.fromName}
                          onChange={(e) => setSmtpFormData({ ...smtpFormData, fromName: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Nom de l'expéditeur"
                        />
                      </div>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={smtpFormData.isActive}
                        onChange={(e) => setSmtpFormData({ ...smtpFormData, isActive: e.target.checked })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label className="ml-2 block text-sm text-gray-700">
                        Activer cette configuration (désactivera automatiquement les autres)
                      </label>
                    </div>

                    <div className="flex justify-end space-x-3 pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setShowSmtpModal(false);
                          setEditingSmtp(null);
                          setSmtpFormData({
                            host: '',
                            port: 587,
                            secure: false,
                            user: '',
                            password: '',
                            fromEmail: '',
                            fromName: '',
                            isActive: false,
                          });
                          setSmtpError('');
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={smtpSubmitting}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                      >
                        {smtpSubmitting ? 'Enregistrement...' : editingSmtp ? 'Modifier' : 'Créer'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* Liste des configurations SMTP */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {smtpConfigs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                Aucune configuration SMTP. Cliquez sur "Nouvelle configuration SMTP" pour commencer.
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {smtpConfigs.map((config) => (
                  <div key={config.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{config.host}:{config.port}</h3>
                          {config.isActive && (
                            <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 rounded">
                              Active
                            </span>
                          )}
                          {config.secure && (
                            <span className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded">
                              SSL/TLS
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                          <div>
                            <span className="font-medium">Utilisateur:</span> {config.user}
                          </div>
                          <div>
                            <span className="font-medium">Email expéditeur:</span> {config.fromEmail}
                          </div>
                          {config.fromName && (
                            <div>
                              <span className="font-medium">Nom expéditeur:</span> {config.fromName}
                            </div>
                          )}
                          {config.updatedBy && (
                            <div>
                              <span className="font-medium">Modifié par:</span> {config.updatedBy.prenom} {config.updatedBy.nom}
                            </div>
                          )}
                        </div>
                        {config.lastTestResult && (
                          <div className="mt-2">
                            <div className={`text-sm ${
                              config.lastTestResult.success ? 'text-green-600' : 'text-red-600'
                            }`}>
                              <span className="font-medium">Dernier test:</span>{' '}
                              {config.lastTestAt ? new Date(config.lastTestAt).toLocaleString('fr-FR') : 'N/A'} -{' '}
                              {config.lastTestResult.success 
                                ? config.lastTestResult.message || 'Succès'
                                : config.lastTestResult.error || 'Échec'}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 ml-4">
                        <div className="flex flex-col gap-2">
                          <input
                            type="email"
                            value={testEmail}
                            onChange={(e) => setTestEmail(e.target.value)}
                            placeholder="Email de test"
                            className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          />
                          <button
                            onClick={() => handleTestSmtp(config.id)}
                            disabled={testingId === config.id || !testEmail.trim()}
                            className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {testingId === config.id ? 'Test en cours...' : 'Tester'}
                          </button>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => handleEditSmtp(config)}
                            className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => handleDeleteSmtp(config.id)}
                            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                          >
                            Supprimer
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      {activeTab === 'entreprise' && (
        <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
          <h2 className="text-xl font-semibold mb-1">Informations Entreprise</h2>
          <p className="text-sm text-gray-500 mb-5">
            Ces informations sont utilisées dans le PDF des PV de réunion : logo en en-tête et adresse en pied de page.
          </p>
          {companyLoading ? (
            <p className="text-sm text-gray-500">Chargement...</p>
          ) : (
            <form onSubmit={saveCompanyInfo} className="space-y-4">
              {companyError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded">{companyError}</div>
              )}
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'entreprise</label>
                  <input
                    value={companyInfo.nomEntreprise}
                    onChange={(e) => setCompanyInfo((p) => ({ ...p, nomEntreprise: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Format de l'entreprise</label>
                  <input
                    value={companyInfo.formatEntreprise}
                    onChange={(e) => setCompanyInfo((p) => ({ ...p, formatEntreprise: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    placeholder="Ex: SARL, SA..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Taille de l'entreprise</label>
                  <input
                    value={companyInfo.tailleEntreprise}
                    onChange={(e) => setCompanyInfo((p) => ({ ...p, tailleEntreprise: e.target.value }))}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    placeholder="Ex: 250 employés"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setCompanyLogoFile(e.target.files?.[0] || null)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                  {(companyInfo.logoFilename || companyLogoFile) && (
                    <label className="mt-2 inline-flex items-center gap-2 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={companyRemoveLogo}
                        onChange={(e) => setCompanyRemoveLogo(e.target.checked)}
                      />
                      Supprimer le logo actuel
                    </label>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse de l'entreprise</label>
                <textarea
                  value={companyInfo.adresseEntreprise}
                  onChange={(e) => setCompanyInfo((p) => ({ ...p, adresseEntreprise: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm min-h-[80px]"
                  placeholder="Adresse affichée en pied de page du PDF"
                />
              </div>
              {companyInfo.logoFilename && !companyRemoveLogo && (
                <div>
                  <p className="text-xs text-gray-500 mb-2">Aperçu du logo actuel</p>
                  <img
                    src={`${API_BASE_URL}/company-info/logo?token=${localStorage.getItem('token') || ''}`}
                    alt="Logo entreprise"
                    className="max-h-16 object-contain border border-gray-200 rounded p-2 bg-white"
                  />
                </div>
              )}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {companyInfo.updatedAt
                    ? `Dernière mise à jour: ${new Date(companyInfo.updatedAt).toLocaleString('fr-FR')}${
                        companyInfo.updatedBy ? ` par ${companyInfo.updatedBy.prenom || ''} ${companyInfo.updatedBy.nom || ''}` : ''
                      }`
                    : 'Aucune mise à jour enregistrée.'}
                </p>
                <button
                  type="submit"
                  disabled={companySaving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {companySaving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {activeTab === 'typesSociete' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Types de société</h2>
            <button onClick={() => { setEditingTs(null); setTsForm({ nom: '', description: '' }); setShowTsModal(true); }} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">+ Ajouter</button>
          </div>
          {tsLoading ? <div className="text-gray-400">Chargement...</div> : (
            <div className="space-y-2">
              {typesSocieteList.length === 0 && <div className="text-gray-400 text-sm">Aucun type de société défini</div>}
              {typesSocieteList.map(ts => (
                <div key={ts.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3">
                  <div>
                    <span className="font-medium text-gray-900">{ts.nom}</span>
                    {ts.description && <span className="ml-3 text-sm text-gray-500">{ts.description}</span>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingTs(ts); setTsForm({ nom: ts.nom, description: ts.description || '' }); setShowTsModal(true); }} className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">✏️ Modifier</button>
                    <button onClick={() => handleDeleteTs(ts.id, ts.nom)} className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">🗑 Supprimer</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showTsModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-lg font-semibold mb-4">{editingTs ? '✏️ Modifier' : '+ Ajouter'} un type de société</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                    <input type="text" value={tsForm.nom} onChange={e => setTsForm({...tsForm, nom: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="Ex: SARL, SA, SAS..." />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input type="text" value={tsForm.description} onChange={e => setTsForm({...tsForm, description: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowTsModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Annuler</button>
                  <button onClick={handleSaveTs} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">Enregistrer</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'typesLicence' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Types de licence</h2>
            <button
              onClick={() => {
                setEditingTl(null);
                setTlForm({ nom: '' });
                setShowTlModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              + Ajouter
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Ces types apparaissent dans le formulaire des licences (liste déroulante).
          </p>
          {tlLoading ? (
            <div className="text-gray-400">Chargement...</div>
          ) : (
            <div className="space-y-2">
              {typesLicenceList.length === 0 && (
                <div className="text-gray-400 text-sm">Aucun type de licence défini</div>
              )}
              {typesLicenceList.map((tl) => (
                <div
                  key={tl.id}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3"
                >
                  <span className="font-medium text-gray-900">{tl.nom}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingTl(tl);
                        setTlForm({ nom: tl.nom });
                        setShowTlModal(true);
                      }}
                      className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      ✏️ Modifier
                    </button>
                    <button
                      onClick={() => handleDeleteTl(tl.id, tl.nom)}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      🗑 Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showTlModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-lg font-semibold mb-4">
                  {editingTl ? '✏️ Modifier' : '+ Ajouter'} un type de licence
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                    <input
                      type="text"
                      value={tlForm.nom}
                      onChange={(e) => setTlForm({ ...tlForm, nom: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      placeholder="Ex. Standard, SaaS, Cloud..."
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setShowTlModal(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSaveTl}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'typesContrat' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Types de contrat</h2>
            <button
              onClick={() => {
                setEditingTc(null);
                setTcForm({ code: '', libelle: '' });
                setShowTcModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              + Ajouter
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Le <span className="font-medium">code</span> sert de préfixe dans la nomenclature automatique des codes contrat :{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">[CODE]-[ANNÉE]-[CLIENT]-[SÉQ]</code>. Ex. code « MS » →{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">MS-2026-A1B2C3D4-001</code>.
          </p>
          {tcLoading ? (
            <div className="text-gray-400">Chargement...</div>
          ) : (
            <div className="space-y-2">
              {typesContratList.length === 0 && (
                <div className="text-gray-400 text-sm">Aucun type de contrat défini</div>
              )}
              {typesContratList.map((tc) => (
                <div
                  key={tc.id}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3"
                >
                  <div>
                    <span className="font-mono font-semibold text-gray-900">{tc.code}</span>
                    <span className="ml-3 text-gray-700">{tc.libelle}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTc(tc);
                        setTcForm({ code: tc.code, libelle: tc.libelle });
                        setShowTcModal(true);
                      }}
                      className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      ✏️ Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTc(tc.id, tc.libelle)}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      🗑 Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showTcModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-lg font-semibold mb-4">
                  {editingTc ? '✏️ Modifier' : '+ Ajouter'} un type de contrat
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                    <input
                      type="text"
                      value={tcForm.code}
                      onChange={(e) => setTcForm({ ...tcForm, code: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono uppercase"
                      placeholder="Ex. MS, PREST, SAAS"
                    />
                    <p className="text-xs text-gray-500 mt-1">Lettres et chiffres uniquement (normalisé en majuscules).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Libellé *</label>
                    <input
                      type="text"
                      value={tcForm.libelle}
                      onChange={(e) => setTcForm({ ...tcForm, libelle: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      placeholder="Ex. Maintenance, Prestation intellectuelle…"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowTcModal(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTc}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'typesEntite' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Types d'entité</h2>
            <button
              onClick={() => {
                setEditingTe(null);
                setTeForm({ code: '', libelle: '', ordre: 0, actif: true });
                setShowTeModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              + Ajouter
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Ces types alimentent la liste <span className="font-medium">Type</span> lors de la création ou modification d'une entité. Un type désactivé n'est plus proposé pour les nouvelles entités.
          </p>
          {teLoading ? (
            <div className="text-gray-400">Chargement...</div>
          ) : (
            <div className="space-y-2">
              {typesEntiteList.length === 0 && (
                <div className="text-gray-400 text-sm">Aucun type d'entité défini</div>
              )}
              {typesEntiteList.map((te) => (
                <div
                  key={te.id}
                  className="flex flex-wrap items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-4 py-3"
                >
                  <div className="min-w-0">
                    <span className="font-mono font-semibold text-gray-900">{te.code}</span>
                    <span className="ml-3 text-gray-700">{te.libelle}</span>
                    <span className="ml-2 text-xs text-gray-400">ordre {te.ordre ?? 0}</span>
                    {!te.actif && (
                      <span className="ml-2 px-2 py-0.5 text-xs rounded bg-amber-100 text-amber-800">Inactif</span>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTe(te);
                        setTeForm({
                          code: te.code,
                          libelle: te.libelle,
                          ordre: te.ordre ?? 0,
                          actif: te.actif !== false,
                        });
                        setShowTeModal(true);
                      }}
                      className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      ✏️ Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTe(te.id, te.libelle)}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      🗑 Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showTeModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-lg font-semibold mb-4">
                  {editingTe ? '✏️ Modifier' : '+ Ajouter'} un type d'entité
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                    <input
                      type="text"
                      value={teForm.code}
                      onChange={(e) => setTeForm({ ...teForm, code: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
                      placeholder="Ex. direction, service"
                    />
                    <p className="text-xs text-gray-500 mt-1">Normalisé en minuscules et underscores.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Libellé *</label>
                    <input
                      type="text"
                      value={teForm.libelle}
                      onChange={(e) => setTeForm({ ...teForm, libelle: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      placeholder="Ex. Direction, Service"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ordre d'affichage</label>
                    <input
                      type="number"
                      value={teForm.ordre}
                      onChange={(e) => setTeForm({ ...teForm, ordre: Number(e.target.value) })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={teForm.actif}
                      onChange={(e) => setTeForm({ ...teForm, actif: e.target.checked })}
                    />
                    Actif (proposé à la création d'entité)
                  </label>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowTeModal(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveTe}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'devises' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Devises</h2>
            <button
              onClick={() => {
                setEditingDev(null);
                setDevForm({ code: '', libelle: '' });
                setShowDevModal(true);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
            >
              + Ajouter
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Codes utilisés dans le formulaire des licences (liste à côté du coût). Le code est normalisé en majuscules (ex. TND, EUR).
          </p>
          {devLoading ? (
            <div className="text-gray-400">Chargement...</div>
          ) : (
            <div className="space-y-2">
              {devisesList.length === 0 && (
                <div className="text-gray-400 text-sm">Aucune devise définie</div>
              )}
              {devisesList.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3"
                >
                  <div>
                    <span className="font-mono font-semibold text-gray-900">{d.code}</span>
                    {d.libelle && (
                      <span className="ml-3 text-sm text-gray-500">{d.libelle}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingDev(d);
                        setDevForm({ code: d.code, libelle: d.libelle || '' });
                        setShowDevModal(true);
                      }}
                      className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      ✏️ Modifier
                    </button>
                    <button
                      onClick={() => handleDeleteDev(d.id, d.code)}
                      className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      🗑 Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showDevModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
                <h3 className="text-lg font-semibold mb-4">
                  {editingDev ? '✏️ Modifier' : '+ Ajouter'} une devise
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Code *</label>
                    <input
                      type="text"
                      value={devForm.code}
                      onChange={(e) => setDevForm({ ...devForm, code: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono uppercase"
                      placeholder="TND, EUR, USD..."
                      maxLength={12}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Libellé</label>
                    <input
                      type="text"
                      value={devForm.libelle}
                      onChange={(e) => setDevForm({ ...devForm, libelle: e.target.value })}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      placeholder="Ex. Dinar tunisien"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    onClick={() => setShowDevModal(false)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSaveDev}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Enregistrer
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contenu Notifications */}
      {activeTab === 'notifications' && (
        <NotificationsTab />
      )}

      {/* Contenu Affichage tâche */}
      {activeTab === 'affichageTache' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow p-6 border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Méthodologie d&apos;ordre d&apos;affichage des tâches</h2>
            <p className="text-sm text-gray-600 mb-4">
              Cette section documente les règles métier utilisées pour ordonner les tâches dans les vues Liste, Kanban,
              Gantt et le bloc « Tâches en retard ».
            </p>

            <div className="space-y-4 text-sm text-gray-700">
              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-1">1) Filtrage initial</p>
                <p>
                  Les tâches au statut <span className="font-medium">terminé</span> et <span className="font-medium">archivé</span>{' '}
                  sont exclues du calcul de priorisation.
                </p>
              </div>

              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-1">2) Score de priorité (ordre principal)</p>
                <p className="mb-2">Le score est calculé automatiquement avec les composantes suivantes :</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Statut : en cours (+50), à faire (+40), créée (+30), en attente (+15), bloqué (+10)</li>
                  <li>
                    Urgence (date de fin prévisionnelle) : en retard (+100), ≤1j (+80), ≤3j (+60), ≤7j (+40), ≤14j (+20), &gt;14j
                    (+5)
                  </li>
                  <li>Priorité métier : élevée (+30), moyenne (+20), basse (+10)</li>
                  <li>
                    Complexité : élevée avec deadline ≤7j (+20), moyenne (+10), basse (+5) pour favoriser les quick wins
                  </li>
                  <li>Ajustements contextuels : bloquée urgente (+40), bloquée non urgente (-30), en attente (-10)</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                <p className="font-semibold text-gray-900 mb-1">3) Tri final (stable et explicable)</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Tri principal : score décroissant (du plus prioritaire au moins prioritaire)</li>
                  <li>En cas d&apos;égalité : date de fin prévisionnelle la plus proche</li>
                  <li>Dernier critère : ordre alphabétique sur le nom de la tâche</li>
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
                <p className="font-semibold text-indigo-900 mb-1">Labels intelligents</p>
                <p className="text-indigo-900">
                  Les labels affichés sont générés automatiquement pour faciliter la lecture : 🔥 Urgent, ⚠️ À risque, 🚧
                  Bloquée critique, ⚡ Quick win.
                </p>
              </div>

              <p className="text-xs text-gray-500 pt-1 border-t border-gray-200">
                Dernière mise à jour de la méthodologie : <span className="font-medium">20/04/2026</span>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

