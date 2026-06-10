import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { api } from '../services/api';
import TachesEnRetardBloc, { type TacheEnRetardItem } from '../components/TachesEnRetardBloc';

interface KPIs {
  processus: {
    total: number;
    parStatut: Record<string, number>;
  };
  projets: {
    actifs: number;
    parStatut: Record<string, number>;
  };
  documentsRecents: any[];
  utilisateursActifs: number;
  entitesTotal: number;
  entitesMembres?: Array<{ id: string; nom: string; code?: string; _count: { membres: number } }>;
  documentsPlusVisualises?: Array<{ id: string; nom: string; typeDocument: string; uploadedBy: { nom: string; prenom: string }; nombreVisualisations: number }>;
  documentsPlusTelecharges?: Array<{ id: string; nom: string; typeDocument: string; uploadedBy: { nom: string; prenom: string }; nombreTelechargements: number }>;
  projetsPlusActifs?: Array<{
    id: string;
    nom: string;
    codeProjet: string;
    statut: string;
    scoreActivite: number;
    consultationsJournal: number;
    tachesMisesAJour: number;
  }>;
  tachesEnRetard?: TacheEnRetardItem[];
  tachesAssigneesEnInstance?: Array<{
    id: string;
    nom: string;
    statut: string;
    dateFinPrevue?: string | null;
    updatedAt?: string;
    projet?: { id: string; nom: string; codeProjet?: string } | null;
  }>;
  projetsAssignesCount?: number;
  adminGlobalTotals?: {
    processusTotal: number;
    projetsTotal: number;
    epicUserStoryTache: { epics: number; userStories: number; taches: number; total: number };
    clientsFournisseurs: { clients: number; fournisseurs: number; total: number };
    contratsTotal: number;
    pvReunionsTotal: number;
    licencesCertifications: { licences: number; certifications: number; total: number };
    entitesTotal: number;
    documentsTotal: number;
    utilisateursTotal: number;
  };
  adminProjetsParStatutEtEntites?: {
    totalProjets: number;
    parStatut: Array<{
      statut: string;
      count: number;
      projets: Array<{
        id: string;
        nom: string;
        codeProjet: string;
        dateFinPrevue: string | null;
        entites: Array<{ id: string; nom: string; code: string | null }>;
      }>;
    }>;
  };
}

export default function Dashboard() {
  const { user } = useAuth();
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const isContributeur = user?.role === 'contributeur';

  useEffect(() => {
    loadKPIs();
  }, []);

  const loadKPIs = async () => {
    try {
      const response = await api.get('/dashboard');
      setKpis(response.data);
    } catch (error) {
      console.error('Erreur chargement KPIs:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Chargement...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      {isAdmin ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          <button type="button" onClick={() => navigate('/processus')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-blue-50 transition">
            <div className="text-sm text-blue-600">Processus</div>
            <div className="text-2xl font-bold text-blue-600">{kpis?.adminGlobalTotals?.processusTotal ?? 0}</div>
          </button>
          <button type="button" onClick={() => navigate('/projets')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-indigo-50 transition">
            <div className="text-sm text-indigo-600">Projets</div>
            <div className="text-2xl font-bold text-indigo-600">{kpis?.adminGlobalTotals?.projetsTotal ?? 0}</div>
          </button>
          <button type="button" onClick={() => navigate('/taches')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-violet-50 transition">
            <div className="text-sm text-violet-600">Epic + User story + Tâches</div>
            <div className="text-2xl font-bold text-violet-600">{kpis?.adminGlobalTotals?.epicUserStoryTache?.total ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">
              Epic {kpis?.adminGlobalTotals?.epicUserStoryTache?.epics ?? 0} · US {kpis?.adminGlobalTotals?.epicUserStoryTache?.userStories ?? 0} · Tâches {kpis?.adminGlobalTotals?.epicUserStoryTache?.taches ?? 0}
            </div>
          </button>
          <button type="button" onClick={() => navigate('/clients-fournisseurs')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-cyan-50 transition">
            <div className="text-sm text-cyan-700">Clients + Fournisseurs</div>
            <div className="text-2xl font-bold text-cyan-700">{kpis?.adminGlobalTotals?.clientsFournisseurs?.total ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">
              Clients {kpis?.adminGlobalTotals?.clientsFournisseurs?.clients ?? 0} · Fournisseurs {kpis?.adminGlobalTotals?.clientsFournisseurs?.fournisseurs ?? 0}
            </div>
          </button>
          <button type="button" onClick={() => navigate('/contrats')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-purple-50 transition">
            <div className="text-sm text-purple-700">Contrats</div>
            <div className="text-2xl font-bold text-purple-700">{kpis?.adminGlobalTotals?.contratsTotal ?? 0}</div>
          </button>
          <button type="button" onClick={() => navigate('/pv-reunion')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-amber-50 transition">
            <div className="text-sm text-amber-700">PV de réunion</div>
            <div className="text-2xl font-bold text-amber-700">{kpis?.adminGlobalTotals?.pvReunionsTotal ?? 0}</div>
          </button>
          <button type="button" onClick={() => navigate('/licences')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-emerald-50 transition">
            <div className="text-sm text-emerald-700">Licences + Certifications</div>
            <div className="text-2xl font-bold text-emerald-700">{kpis?.adminGlobalTotals?.licencesCertifications?.total ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">
              Licences {kpis?.adminGlobalTotals?.licencesCertifications?.licences ?? 0} · Certifications {kpis?.adminGlobalTotals?.licencesCertifications?.certifications ?? 0}
            </div>
          </button>
          <button type="button" onClick={() => navigate('/entites')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-sky-50 transition">
            <div className="text-sm text-sky-700">Entités</div>
            <div className="text-2xl font-bold text-sky-700">{kpis?.adminGlobalTotals?.entitesTotal ?? 0}</div>
          </button>
          <button type="button" onClick={() => navigate('/documents')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-blue-50 transition">
            <div className="text-sm text-blue-700">Documents</div>
            <div className="text-2xl font-bold text-blue-700">{kpis?.adminGlobalTotals?.documentsTotal ?? 0}</div>
          </button>
          <button type="button" onClick={() => navigate('/users')} className="bg-white p-4 rounded-lg shadow text-left hover:bg-gray-50 transition">
            <div className="text-sm text-gray-700">Utilisateurs</div>
            <div className="text-2xl font-bold text-gray-700">{kpis?.adminGlobalTotals?.utilisateursTotal ?? 0}</div>
          </button>
        </div>
      ) : isContributeur ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button
            type="button"
            onClick={() => navigate('/taches')}
            className="bg-white p-4 rounded-lg shadow text-left hover:bg-blue-50 transition"
            title="Voir mes tâches assignées en instance"
          >
            <div className="text-sm text-blue-600">Tâches assignées en instance</div>
            <div className="text-2xl font-bold text-blue-600">{kpis?.tachesAssigneesEnInstance?.length ?? 0}</div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/taches')}
            className="bg-white p-4 rounded-lg shadow text-left hover:bg-red-50 transition"
            title="Voir mes tâches en retard"
          >
            <div className="text-sm text-red-600">Tâches en retard</div>
            <div className="text-2xl font-bold text-red-600">{kpis?.tachesEnRetard?.length ?? 0}</div>
          </button>
          <button
            type="button"
            onClick={() => navigate('/projets')}
            className="bg-white p-4 rounded-lg shadow text-left hover:bg-indigo-50 transition"
            title="Voir mes projets concernés"
          >
            <div className="text-sm text-indigo-600">Projets concernés</div>
            <div className="text-2xl font-bold text-indigo-600">{kpis?.projetsAssignesCount ?? 0}</div>
          </button>
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate('/processus')}
          className="bg-white p-4 rounded-lg shadow text-left hover:bg-blue-50 transition"
          title="Aller à la liste des processus"
        >
          <div className="text-sm text-blue-600">Processus total</div>
          <div className="text-2xl font-bold text-blue-600">{kpis?.processus?.total ?? 0}</div>
        </button>
        <button
          type="button"
          onClick={() => navigate('/entites')}
          className="bg-white p-4 rounded-lg shadow text-left hover:bg-blue-50 transition"
          title="Aller à la liste des entités"
        >
          <div className="text-sm text-blue-600">Entités</div>
          <div className="text-2xl font-bold text-blue-600">{kpis?.entitesTotal || 0}</div>
        </button>
        <button
          type="button"
          onClick={() => isAdmin && navigate('/users')}
          disabled={!isAdmin}
          className={`p-4 rounded-lg shadow text-left transition ${isAdmin ? 'bg-white hover:bg-blue-50 cursor-pointer' : 'bg-gray-100 cursor-not-allowed'}`}
          title={isAdmin ? 'Aller à la liste des utilisateurs' : "Accès réservé à l'administrateur"}
        >
          <div className={`text-sm ${isAdmin ? 'text-blue-600' : 'text-gray-600'}`}>Utilisateurs actifs</div>
          <div className={`text-2xl font-bold ${isAdmin ? 'text-blue-600' : 'text-gray-600'}`}>{kpis?.utilisateursActifs || 0}</div>
        </button>
        <button
          type="button"
          onClick={() => navigate('/documents')}
          className="bg-white p-4 rounded-lg shadow text-left hover:bg-blue-50 transition"
          title="Aller à la liste des documents"
        >
          <div className="text-sm text-blue-600">Documents récents</div>
          <div className="text-2xl font-bold text-blue-600">{kpis?.documentsRecents?.length ?? 0}</div>
        </button>
      </div>
      )}

      {isContributeur && (
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <h2 className="text-lg font-semibold mb-1">Tâches assignées</h2>
          <p className="text-xs text-gray-500 mb-4">
            Affiche uniquement vos tâches assignées en instance (hors tâches terminées/archivées).
          </p>
          {(kpis?.tachesAssigneesEnInstance || []).length === 0 ? (
            <p className="text-sm text-gray-500 italic">Aucune tâche assignée en instance.</p>
          ) : (
            <div className="space-y-2">
              {(kpis?.tachesAssigneesEnInstance || []).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => navigate('/taches')}
                  className="w-full flex items-center justify-between p-3 border border-gray-200 rounded hover:bg-blue-50 text-left transition"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{t.nom}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {t.projet?.nom ? `${t.projet.nom}${t.projet.codeProjet ? ` (${t.projet.codeProjet})` : ''} · ` : ''}
                      <span className="capitalize">{String(t.statut || '').replace(/_/g, ' ')}</span>
                      {t.dateFinPrevue ? ` · Échéance: ${new Date(t.dateFinPrevue).toLocaleDateString('fr-FR')}` : ''}
                    </div>
                  </div>
                  <span className="ml-3 text-xs text-blue-700 font-medium shrink-0">Voir</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <TachesEnRetardBloc items={kpis?.tachesEnRetard ?? []} />

      {!isContributeur && kpis?.projetsPlusActifs && kpis.projetsPlusActifs.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <h2 className="text-lg font-semibold mb-1">5 projets les plus actifs</h2>
          <p className="text-xs text-gray-500 mb-4">
            Sur les 30 derniers jours : actions enregistrées sur le projet (journal) et tâches mises à jour. Les places restantes sont complétées par les projets modifiés récemment.
          </p>
          <div className="space-y-2">
            {kpis.projetsPlusActifs.map((projet, index) => (
              <button
                key={projet.id}
                type="button"
                onClick={() => navigate(`/projets/${projet.id}`)}
                className="w-full flex items-center justify-between p-3 border border-gray-200 rounded hover:bg-blue-50 text-left transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-500 shrink-0">#{index + 1}</span>
                    <span className="text-sm font-medium text-gray-900 truncate">{projet.nom}</span>
                    <span className="text-xs text-gray-500 shrink-0">({projet.codeProjet})</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1 capitalize">
                    {projet.statut.replace(/_/g, ' ')}
                    {(projet.consultationsJournal > 0 || projet.tachesMisesAJour > 0) && (
                      <>
                        {' · '}
                        journal {projet.consultationsJournal}, tâches {projet.tachesMisesAJour}
                      </>
                    )}
                  </div>
                </div>
                <div className="ml-4 shrink-0 text-sm font-bold text-indigo-600" title="Score d'activité (30 j.)">
                  {projet.scoreActivite > 0 ? projet.scoreActivite : '—'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {isAdmin && kpis?.adminProjetsParStatutEtEntites && (
        <div className="bg-white p-4 rounded-lg shadow mb-6">
          <h2 className="text-lg font-semibold mb-1">Projets par statut et entité</h2>
          <p className="text-xs text-gray-500 mb-4">
            Total projets : <span className="font-semibold text-gray-700">{kpis.adminProjetsParStatutEtEntites.totalProjets}</span>
          </p>
          <div className="space-y-4">
            {kpis.adminProjetsParStatutEtEntites.parStatut.map((row) => {
              const max = Math.max(...kpis.adminProjetsParStatutEtEntites!.parStatut.map((x) => x.count), 1);
              const width = Math.max(6, Math.round((row.count / max) * 100));
              const totalProjets = kpis.adminProjetsParStatutEtEntites!.totalProjets || 1;
              const percent = Math.round((row.count / totalProjets) * 100);
              return (
                <div key={row.statut} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-semibold text-gray-800 capitalize">{row.statut.replace(/_/g, ' ')}</div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                        Total: {row.count} projet(s)
                      </div>
                      <div className="text-xs font-semibold text-gray-600">
                        {percent}% des projets
                      </div>
                    </div>
                  </div>
                  <div className="w-full h-3 bg-gray-100 rounded">
                    <div className="h-3 rounded bg-indigo-600" style={{ width: `${width}%` }} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {row.projets.map((p) => {
                      const remainingLabel = (() => {
                        if (!p.dateFinPrevue) return 'Échéance non définie';
                        const now = new Date();
                        const end = new Date(p.dateFinPrevue);
                        const diffDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        if (diffDays > 0) return `${diffDays} jour(s) restant(s)`;
                        if (diffDays === 0) return "Clôture aujourd'hui";
                        return `${Math.abs(diffDays)} jour(s) de retard`;
                      })();
                      const entites = p.entites || [];
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => navigate(`/projets/${p.id}`)}
                          className="w-full text-left p-2 rounded border border-gray-100 hover:bg-blue-50"
                        >
                          <div className="text-sm font-medium text-gray-900">
                            {p.nom} <span className="text-xs text-gray-500">({p.codeProjet})</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-1">
                            <span className="font-medium">Entité(s) assignée(s) :</span>{' '}
                            {entites.length === 0 ? (
                              <span className="italic text-gray-500">Sans entité</span>
                            ) : (
                              <span className="inline-flex flex-wrap gap-1 align-middle">
                                {entites.map((e) => (
                                  <span
                                    key={e.id}
                                    className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200"
                                  >
                                    {e.nom}
                                  </span>
                                ))}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-600">{remainingLabel}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isContributeur && kpis?.processus?.parStatut && Object.keys(kpis.processus.parStatut).length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Processus par statut</h2>
            <div className="space-y-2">
              {Object.entries(kpis.processus.parStatut).map(([statut, count]) => (
                <button
                  key={statut}
                  type="button"
                  onClick={() => navigate(`/processus?statut=${encodeURIComponent(statut)}`)}
                  className="w-full flex justify-between items-center px-3 py-2 rounded hover:bg-blue-50 transition capitalize text-left text-blue-600 hover:underline"
                  title={`Voir les processus avec le statut ${statut}`}
                >
                  <span>{statut.replace('_', ' ')}</span>
                  <span className="font-bold">{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Camembert des statuts */}
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Répartition des statuts (en %)</h2>
            <PieChart parStatut={kpis.processus.parStatut} />
          </div>
        </div>
      )}
      {!isContributeur && !isAdmin && kpis?.projets?.parStatut && Object.keys(kpis.projets.parStatut).length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Projets par statut</h2>
            <div className="space-y-2">
              {Object.entries(kpis.projets.parStatut).map(([statut, count]) => (
                <button
                  key={statut}
                  type="button"
                  onClick={() => navigate(`/projets?statut=${encodeURIComponent(statut)}`)}
                  className="w-full flex justify-between items-center px-3 py-2 rounded hover:bg-blue-50 transition capitalize text-left text-blue-600 hover:underline"
                  title={`Voir les projets avec le statut ${statut}`}
                >
                  <span>{statut.replace(/_/g, ' ')}</span>
                  <span className="font-bold">{count as number}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Répartition des projets par statut (en %)</h2>
            <PieChart parStatut={kpis.projets.parStatut} />
          </div>
        </div>
      )}

      {!isContributeur && kpis?.entitesMembres && kpis.entitesMembres.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Membres par entité</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="py-2 pr-4">Entité</th>
                    <th className="py-2">Membres</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.entitesMembres
                    .slice()
                    .sort((a, b) => b._count.membres - a._count.membres)
                    .slice(0, 10)
                    .map((e) => (
                      <tr key={e.id} className="border-t">
                        <td className="py-2 pr-4 text-sm">{e.nom}{e.code ? ` (${e.code})` : ''}</td>
                        <td className="py-2 text-sm font-semibold">{e._count.membres}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {kpis.entitesMembres.length > 10 && (
              <p className="text-xs text-gray-500 mt-2">Affichage des 10 premières entités (triées par nombre de membres)</p>
            )}
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Répartition des membres par entité (en %)</h2>
            <PieChartMembers entites={kpis.entitesMembres} />
          </div>
        </div>
      )}

      {/* Documents les plus visualisés et téléchargés */}
      {!isContributeur && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {kpis?.documentsPlusVisualises && kpis.documentsPlusVisualises.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Top 5 documents les plus visualisés</h2>
            <div className="space-y-2">
              {kpis.documentsPlusVisualises.map((doc, index) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                      <span className="text-sm font-medium text-gray-900">{doc.nom}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {doc.uploadedBy?.prenom} {doc.uploadedBy?.nom} • {doc.typeDocument}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span className="text-sm font-bold text-blue-600">{doc.nombreVisualisations}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {kpis?.documentsPlusTelecharges && kpis.documentsPlusTelecharges.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow">
            <h2 className="text-lg font-semibold mb-4">Top 5 documents les plus téléchargés</h2>
            <div className="space-y-2">
              {kpis.documentsPlusTelecharges.map((doc, index) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded hover:bg-gray-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                      <span className="text-sm font-medium text-gray-900">{doc.nom}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {doc.uploadedBy?.prenom} {doc.uploadedBy?.nom} • {doc.typeDocument}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span className="text-sm font-bold text-green-600">{doc.nombreTelechargements}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>}
    </div>
  );
}

// Composant local: camembert SVG sans dépendance
function PieChart({ parStatut }: { parStatut: Record<string, number> }) {
  const entries = Object.entries(parStatut);
  const total = entries.reduce((sum, [, c]) => sum + (c as number), 0) || 1;

  // Couleurs par statut (alignées avec l'app)
  const colorByStatut: Record<string, string> = {
    brouillon: '#9CA3AF', // gray-400
    en_revision: '#F59E0B', // amber-500
    valide: '#2563EB', // blue-600
    actif: '#16A34A', // green-600
    archive: '#7C3AED', // violet-600
    obsolete: '#DC2626', // red-600
  };

  // Génération des arcs
  let cumulative = 0;
  const radius = 70;
  const cx = 90;
  const cy = 90;

  const slices = entries.map(([statut, count]) => {
    const value = (count as number);
    const fraction = value / total;
    const startAngle = cumulative * 2 * Math.PI;
    const endAngle = (cumulative + fraction) * 2 * Math.PI;
    cumulative += fraction;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    const pathData = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      'Z',
    ].join(' ');

    const color = colorByStatut[statut] || '#6B7280';
    const percent = Math.round((value / total) * 100);

    return { statut, value, percent, color, pathData };
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label="Camembert des statuts">
        <circle cx={cx} cy={cy} r={radius} fill="#F3F4F6" />
        {slices.map((s) => (
          <path key={s.statut} d={s.pathData} fill={s.color} />
        ))}
        {/* Cercle central pour effet donut léger */}
        <circle cx={cx} cy={cy} r={40} fill="#FFFFFF" />
      </svg>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {slices.map((s) => (
          <div key={s.statut} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: s.color }} />
              <span className="text-sm capitalize">{s.statut.replace('_', ' ')}</span>
            </div>
            <span className="text-sm font-semibold">{s.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PieChartMembers({ entites }: { entites: Array<{ id: string; nom: string; code?: string; _count: { membres: number } }> }) {
  if (!entites || entites.length === 0) return null;
  const sorted = entites.slice().sort((a, b) => b._count.membres - a._count.membres);
  const top = sorted.slice(0, 8);
  const others = sorted.slice(8);
  const items = top.map(e => ({ label: `${e.nom}${e.code ? ` (${e.code})` : ''}`, value: e._count.membres }));
  const othersSum = others.reduce((s, e) => s + e._count.membres, 0);
  if (othersSum > 0) items.push({ label: 'Autres', value: othersSum });

  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  let cumulative = 0;
  const radius = 70;
  const cx = 90;
  const cy = 90;

  const palette = ['#2563EB','#16A34A','#F59E0B','#7C3AED','#DC2626','#059669','#9333EA','#EA580C','#0EA5E9'];

  const slices = items.map((it, idx) => {
    const fraction = it.value / total;
    const startAngle = cumulative * 2 * Math.PI;
    const endAngle = (cumulative + fraction) * 2 * Math.PI;
    cumulative += fraction;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const pathData = [`M ${cx} ${cy}`, `L ${x1} ${y1}`, `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`, 'Z'].join(' ');
    const percent = Math.round(fraction * 100);
    const color = palette[idx % palette.length];
    return { label: it.label, percent, color, pathData };
  });

  return (
    <div className="flex items-center gap-6">
      <svg width={180} height={180} viewBox="0 0 180 180" role="img" aria-label="Camembert membres par entité">
        <circle cx={cx} cy={cy} r={radius} fill="#F3F4F6" />
        {slices.map((s) => (
          <path key={s.label} d={s.pathData} fill={s.color} />
        ))}
        <circle cx={cx} cy={cy} r={40} fill="#FFFFFF" />
      </svg>
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded" style={{ backgroundColor: s.color }} />
              <span className="text-sm">{s.label}</span>
            </div>
            <span className="text-sm font-semibold">{s.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
