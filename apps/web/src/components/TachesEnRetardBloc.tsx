import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clampListPage, ListSectionPagination, LIST_SECTION_PAGE_SIZE } from './ListSectionPagination';

export type TacheEnRetardItem = {
  id: string;
  nom: string;
  statut: string;
  dateFinPrevue: string | null;
  projet: { id: string; nom: string; codeProjet: string } | null;
  assignesUtilisateurs: Array<{ id: string; nom: string; prenom: string }>;
  assignesEntites: Array<{ id: string; nom: string; code: string | null }>;
  assignesClientsFournisseurs?: Array<{ id: string; nom: string; type?: string | null }>;
};

type Props = {
  items: TacheEnRetardItem[];
  getPriorityMeta?: (tacheId: string) => { score: number; labels: string[] } | null;
  /** Sur la page Tâches : masquer le lien « Ouvrir la page Tâches » */
  hideFooterLink?: boolean;
  /** Si défini, clic sur le nom de la tâche (ex. ouvrir la modale sur la page Tâches) */
  onTacheClick?: (tacheId: string) => void;
};

export default function TachesEnRetardBloc({ items, getPriorityMeta, hideFooterLink, onTacheClick }: Props) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const itemsSig = useMemo(() => items.map((i) => i.id).join(','), [items]);
  useEffect(() => {
    setPage(1);
  }, [itemsSig]);

  if (!items.length) return null;

  const pageEff = clampListPage(page, items.length, LIST_SECTION_PAGE_SIZE);
  const pagedItems = items.slice((pageEff - 1) * LIST_SECTION_PAGE_SIZE, pageEff * LIST_SECTION_PAGE_SIZE);

  return (
    <div className="bg-white p-4 rounded-lg shadow mb-6 border-l-4 border-amber-500">
      <h2 className="text-lg font-semibold mb-1">Tâches en retard</h2>
      <p className="text-xs text-gray-500 mb-4">
        Tâches non finalisées (hors terminé / archivé) dont la date de fin prévue est dépassée, triées par échéance la plus
        ancienne. Affichage de {LIST_SECTION_PAGE_SIZE} lignes par page.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase border-b">
              <th className="py-2 pr-4">Tâche</th>
              <th className="py-2 pr-4">Projet</th>
              <th className="py-2 pr-4 whitespace-nowrap">Fin prévue</th>
              <th className="py-2 pr-4">Assignés</th>
              <th className="py-2">Entités</th>
              <th className="py-2">Clients / fournisseurs</th>
            </tr>
          </thead>
          <tbody>
            {pagedItems.map((t) => {
              const projet = t.projet;
              const priorityMeta = getPriorityMeta?.(t.id) || null;
              return (
                <tr key={t.id} className="border-t border-gray-100 hover:bg-amber-50/40">
                  <td className="py-3 pr-4 align-top">
                    <button
                      type="button"
                      onClick={() => (onTacheClick ? onTacheClick(t.id) : navigate('/taches'))}
                      className="text-left font-medium text-blue-700 hover:underline"
                    >
                      {t.nom}
                    </button>
                    <div className="text-xs text-gray-500 capitalize mt-0.5">{t.statut.replace(/_/g, ' ')}</div>
                    {priorityMeta && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-800 border-indigo-200">
                          🧠 Score {priorityMeta.score}
                        </span>
                        {priorityMeta.labels.slice(0, 2).map((lb) => (
                          <span key={`${t.id}-${lb}`} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-800">
                            {lb}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-4 align-top text-gray-700">
                    {projet ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/projets/${projet.id}`)}
                        className="text-left text-blue-700 hover:underline"
                      >
                        {projet.nom}
                        <span className="text-gray-500 font-normal"> ({projet.codeProjet})</span>
                      </button>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 align-top whitespace-nowrap text-amber-800 font-medium">
                    {t.dateFinPrevue
                      ? new Date(t.dateFinPrevue).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '—'}
                  </td>
                  <td className="py-3 pr-4 align-top text-gray-700">
                    {t.assignesUtilisateurs.length > 0
                      ? t.assignesUtilisateurs.map((u) => `${u.prenom} ${u.nom}`).join(', ')
                      : '—'}
                  </td>
                  <td className="py-3 align-top text-gray-700">
                    {t.assignesEntites.length > 0
                      ? t.assignesEntites.map((e) => (e.code ? `${e.nom} (${e.code})` : e.nom)).join(', ')
                      : '—'}
                  </td>
                  <td className="py-3 align-top text-gray-700">
                    {(t.assignesClientsFournisseurs || []).length > 0
                      ? (t.assignesClientsFournisseurs || [])
                          .map((c) =>
                            c.type ? `${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})` : c.nom
                          )
                          .join(', ')
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ListSectionPagination
        page={page}
        pageSize={LIST_SECTION_PAGE_SIZE}
        totalItems={items.length}
        onPageChange={setPage}
      />
      {!hideFooterLink && (
        <p className="text-xs text-gray-500 mt-3">
          <button type="button" onClick={() => navigate('/taches')} className="text-blue-600 hover:underline">
            Ouvrir la page Tâches
          </button>
        </p>
      )}
    </div>
  );
}
