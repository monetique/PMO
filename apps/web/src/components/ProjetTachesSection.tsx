import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import {
  TacheCard,
  TacheModal,
  TachesAvancementBlock,
  TachesDashboard,
  type ClientFournisseurOption,
  type EntiteOption,
  type ProjetOption,
  type Tache,
  type UserOption,
} from '../pages/Taches';
import {
  peutModifierTacheSelonApi,
  tacheVisiblePourUtilisateurSurProjetPage,
  userIsProjetGovernanceMember,
} from '../utils/tacheAccess';

type Props = {
  projetId: string;
  projet: any;
  usersForTaches: UserOption[];
  /** Appelé après sauvegarde d’une tâche (création / édition) pour rafraîchir un récap parent. */
  onTachesRefresh?: () => void;
};

export default function ProjetTachesSection({ projetId, projet, usersForTaches, onTachesRefresh }: Props) {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [tachesBrutes, setTachesBrutes] = useState<Tache[]>([]);
  const [projets, setProjets] = useState<ProjetOption[]>([]);
  const [entites, setEntites] = useState<EntiteOption[]>([]);
  const [clientsFournisseurs, setClientsFournisseurs] = useState<ClientFournisseurOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTache, setEditTache] = useState<Tache | undefined>();
  const [showDash, setShowDash] = useState(true);

  const load = useCallback(async () => {
    if (!projetId) return;
    setLoading(true);
    try {
      const [tRes, pRes, eRes, cfRes] = await Promise.all([
        api.get('/taches', { params: { projetId } }),
        api.get('/projets'),
        api.get('/entites'),
        api.get('/clients-fournisseurs').catch(() => ({ data: [] })),
      ]);
      setTachesBrutes(tRes.data || []);
      setProjets((pRes.data || []).map((p: any) => ({ id: p.id, nom: p.nom })));
      setEntites((eRes.data || []).map((e: any) => ({ id: e.id, nom: e.nom })));
      const cfRaw = Array.isArray(cfRes.data) ? cfRes.data : [];
      setClientsFournisseurs(cfRaw.map((c: any) => ({ id: c.id, nom: c.nom, type: c.type || 'client' })));
    } catch (e) {
      console.error('Chargement tâches projet:', e);
    } finally {
      setLoading(false);
    }
  }, [projetId]);

  useEffect(() => {
    load();
  }, [load]);

  const tachesVisibles = useMemo(
    () =>
      tachesBrutes.filter((t) =>
        tacheVisiblePourUtilisateurSurProjetPage(t, currentUser, projet),
      ),
    [tachesBrutes, currentUser, projet],
  );

  const peutEdit = peutModifierTacheSelonApi(currentUser);
  const peutCreer = !!currentUser;
  const estMembreGouvernance = currentUser
    ? userIsProjetGovernanceMember(currentUser.id, projet)
    : false;

  const nbMasquees = tachesBrutes.length - tachesVisibles.length;

  const projetClientFournisseurIds = useMemo(
    () =>
      (projet?.clientsFournisseurs || [])
        .map((x: any) => x.clientFournisseurId || x.clientFournisseur?.id)
        .filter(Boolean),
    [projet],
  );

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-2">📋 Tâches du projet</h2>
        <p className="text-sm text-gray-500">Chargement des tâches…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="w-7 h-7 bg-teal-100 text-teal-700 rounded-full flex items-center justify-center text-sm font-bold">
              📋
            </span>
            Tâches du projet
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {tachesVisibles.length} tâche(s) visible(s) pour vous
            {nbMasquees > 0 && (
              <span className="text-amber-600">
                {' '}
                — {nbMasquees} autre(s) non affichée(s) (habilitation)
              </span>
            )}
            {estMembreGouvernance && (
              <span className="block text-xs text-gray-400 mt-0.5">
                En tant que membre de la gouvernance, vous voyez toutes les tâches liées à ce projet.
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowDash((v) => !v)}
            className={`px-3 py-2 rounded border text-sm font-medium ${
              showDash
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {showDash ? 'Masquer le tableau de bord' : 'Tableau de bord'}
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(
                projetId
                  ? `/taches?projetId=${encodeURIComponent(projetId)}`
                  : '/taches'
              )
            }
            className="px-3 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            Toutes les tâches
          </button>
          {peutCreer && (
            <button
              type="button"
              onClick={() => {
                setEditTache(undefined);
                setShowModal(true);
              }}
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              + Nouvelle tâche
            </button>
          )}
        </div>
      </div>

      {tachesVisibles.length > 0 && <TachesAvancementBlock taches={tachesVisibles} />}

      {showDash && tachesVisibles.length > 0 && (
        <TachesDashboard
          taches={tachesVisibles}
          showStatutBreakdown
          showParPersonne
          hideAvancement
        />
      )}

      {tachesVisibles.length === 0 && (
        <p className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-200 rounded-lg">
          Aucune tâche liée à ce projet, ou aucune tâche que vous êtes habilité à consulter.
        </p>
      )}

      <div className="space-y-4 mt-4">
        {tachesVisibles.map((t) => (
          <TacheCard
            key={t.id}
            tache={t}
            defaultExpanded
            onEdit={() => {
              setEditTache(t);
              setShowModal(true);
            }}
            canEdit={peutEdit}
            users={usersForTaches}
            currentUserRole={currentUser?.role || ''}
            allUsers={usersForTaches}
            onRefreshData={async () => {
              await load();
              onTachesRefresh?.();
            }}
          />
        ))}
      </div>

      {showModal && (
        <TacheModal
          key={editTache?.id || `nouvelle-${projetId}`}
          onClose={() => {
            setShowModal(false);
            setEditTache(undefined);
          }}
          onSave={async () => {
            await load();
            onTachesRefresh?.();
          }}
          projets={projets}
          users={usersForTaches}
          entites={entites}
          clientsFournisseurs={clientsFournisseurs}
          projetClientFournisseurIds={
            projetClientFournisseurIds.length > 0 ? projetClientFournisseurIds : undefined
          }
          taches={tachesBrutes}
          editTache={editTache}
          lockProjetId={editTache ? undefined : projetId}
        />
      )}
    </div>
  );
}
