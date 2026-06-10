import { useMemo } from 'react';

export type TacheGantt = {
  id: string;
  nom: string;
  statut: string;
  dateDebut?: string;
  dateFinApprox?: string;
  createdAt?: string;
  projet?: { id: string; nom: string };
  userStory?: { id: string; epic?: { id: string } | null } | null;
  entityType?: 'tache' | 'user_story' | 'epic';
  epicRefId?: string;
};

const BAR_BG: Record<string, string> = {
  cree: 'bg-gray-500',
  a_faire: 'bg-slate-600',
  en_cours: 'bg-blue-600',
  en_attente: 'bg-amber-500',
  bloque: 'bg-red-600',
  termine: 'bg-green-600',
  archive: 'bg-violet-600',
};

/** Libellés alignés sur la page Tâches (liste). */
const LEGENDE_STATUTS: { value: keyof typeof BAR_BG; label: string }[] = [
  { value: 'cree', label: 'Créée' },
  { value: 'a_faire', label: 'À faire / Non démarré' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'en_attente', label: 'En attente / Suspendu' },
  { value: 'bloque', label: 'Bloqué / En retard' },
  { value: 'termine', label: 'Terminé' },
  { value: 'archive', label: 'Archivée' },
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseDay(iso?: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return startOfDay(d);
}

/** Intervalle d’affichage : dates réelles ou estimation à partir de la création. */
export function getTacheGanttRange(t: TacheGantt): { start: Date; end: Date; estimated: boolean } {
  const endFromApi = parseDay(t.dateFinApprox);
  const startFromApi = parseDay(t.dateDebut);
  const created = parseDay(t.createdAt) || startOfDay(new Date());

  let start = startFromApi || created;
  let end = endFromApi;
  const estimated = !startFromApi || !endFromApi;

  if (!end) {
    end = new Date(start);
    end.setDate(end.getDate() + (startFromApi ? 7 : 3));
  }
  if (end.getTime() <= start.getTime()) {
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  }
  return { start: startOfDay(start), end: startOfDay(end), estimated };
}

type Props = {
  taches: TacheGantt[];
  getCanEdit?: (t: TacheGantt) => boolean;
  onBarClick?: (t: TacheGantt) => void;
  getPriorityMeta?: (t: TacheGantt) => { score: number; labels: string[] } | null;
  /** En-tête de la colonne des libellés (ex. « User story / projet ») */
  rowLabelTitle?: string;
};

const DAY_MS = 86400000;

export default function TachesGanttView({
  taches,
  getCanEdit,
  onBarClick,
  getPriorityMeta,
  rowLabelTitle = 'Tâche / projet',
}: Props) {
  const model = useMemo(() => {
    if (!taches.length) return null;
    const rows = taches.map((tache) => ({ tache, ...getTacheGanttRange(tache) }));
    let minT = new Date(Math.min(...rows.map((r) => r.start.getTime())));
    let maxT = new Date(Math.max(...rows.map((r) => r.end.getTime())));
    minT = startOfDay(minT);
    maxT = startOfDay(maxT);
    minT.setDate(minT.getDate() - 2);
    maxT.setDate(maxT.getDate() + 5);
    const totalDays = Math.max(2, Math.ceil((maxT.getTime() - minT.getTime()) / DAY_MS) + 1);
    return { rows, minT, maxT, totalDays };
  }, [taches]);

  if (!model) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500 text-sm">
        Aucune tâche à afficher sur le Gantt (ajustez les filtres).
      </div>
    );
  }

  const { rows, minT, totalDays } = model;
  const colWidth = totalDays > 75 ? 10 : totalDays > 45 ? 14 : 18;
  const timelineW = totalDays * colWidth;
  const labelColW = 240;

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth: labelColW + timelineW }}>
          {/* Ligne calendrier */}
          <div className="flex h-10 border-b border-gray-200 bg-gray-50">
            <div
              className="shrink-0 border-r border-gray-200 px-2 flex items-end pb-1 font-medium text-xs text-gray-600 bg-gray-50 sticky left-0 z-10"
              style={{ width: labelColW }}
            >
              {rowLabelTitle}
            </div>
            <div className="relative h-full" style={{ width: timelineW }}>
              {Array.from({ length: totalDays }).map((_, i) => {
                const d = new Date(minT);
                d.setDate(d.getDate() + i);
                const isMonday = d.getDay() === 1;
                const isFirst = i === 0;
                const isMonthStart = d.getDate() === 1;
                const showLabel = isFirst || isMonthStart || isMonday;
                return (
                  <div
                    key={i}
                    className={`absolute top-0 bottom-0 border-l ${isMonday ? 'border-gray-300' : 'border-gray-100'}`}
                    style={{ left: i * colWidth, width: colWidth }}
                  >
                    {showLabel && (
                      <span className="absolute top-1 left-0.5 text-[10px] text-gray-600 whitespace-nowrap leading-none">
                        {d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lignes tâches */}
          {rows.map(({ tache, start, end, estimated }) => {
            const leftDays = Math.max(0, (start.getTime() - minT.getTime()) / DAY_MS);
            const spanDays = Math.max(0.5, (end.getTime() - start.getTime()) / DAY_MS);
            const leftPx = leftDays * colWidth;
            const widthPx = Math.max(spanDays * colWidth, 10);
            const barClass = BAR_BG[tache.statut] || 'bg-gray-500';
            const mayClick = Boolean(onBarClick && (!getCanEdit || getCanEdit(tache)));
            const priorityMeta = getPriorityMeta?.(tache) || null;

            return (
              <div key={tache.id} className="flex min-h-[44px] border-b border-gray-100 hover:bg-gray-50/80">
                <div
                  className="shrink-0 border-r border-gray-200 px-2 py-2 bg-white sticky left-0 z-[5] shadow-[2px_0_6px_-2px_rgba(0,0,0,0.06)]"
                  style={{ width: labelColW }}
                >
                  <p className="text-sm font-medium text-gray-800 truncate" title={tache.nom}>
                    {tache.nom}
                  </p>
                  {priorityMeta && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50 text-indigo-800 border-indigo-200">
                        Score {priorityMeta.score}
                      </span>
                      {priorityMeta.labels.slice(0, 1).map((lb) => (
                        <span key={`${tache.id}-${lb}`} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-800">
                          {lb}
                        </span>
                      ))}
                    </div>
                  )}
                  {tache.projet && (
                    <p className="text-xs text-gray-500 truncate" title={tache.projet.nom}>
                      {tache.projet.nom}
                    </p>
                  )}
                  {(() => {
                    const et = tache.entityType ?? 'tache';
                    const primaryLabel =
                      et === 'tache' ? 'Tâche' : et === 'user_story' ? 'User story' : 'Epic';
                    return (
                      <div className="mt-1.5 space-y-0.5 text-[10px] font-mono text-gray-500 break-all">
                        <div>
                          <span className="text-gray-400 font-sans">{primaryLabel} · </span>
                          {tache.id}
                        </div>
                        {et === 'user_story' && tache.epicRefId && (
                          <div>
                            <span className="text-gray-400 font-sans">Epic · </span>
                            {tache.epicRefId}
                          </div>
                        )}
                        {et === 'tache' && tache.userStory && (
                          <>
                            <div>
                              <span className="text-gray-400 font-sans">User story · </span>
                              {tache.userStory.id}
                            </div>
                            {tache.userStory.epic && (
                              <div>
                                <span className="text-gray-400 font-sans">Epic · </span>
                                {tache.userStory.epic.id}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="relative flex-1 py-2" style={{ width: timelineW, minHeight: 44 }}>
                  <button
                    type="button"
                    disabled={!mayClick}
                    onClick={() => {
                      if (mayClick) onBarClick?.(tache);
                    }}
                    className={`absolute top-2 h-7 rounded-md text-left px-2 text-xs font-medium text-white shadow-sm truncate transition ${mayClick ? 'hover:brightness-110 cursor-pointer' : 'cursor-default opacity-90'} disabled:cursor-not-allowed ${barClass} ${estimated ? 'ring-1 ring-white/30' : ''}`}
                    style={{ left: leftPx, width: widthPx, maxWidth: timelineW - leftPx }}
                    title={`${start.toLocaleDateString('fr-FR')} → ${end.toLocaleDateString('fr-FR')}${estimated ? ' (dates estimées)' : ''}`}
                  >
                    {estimated ? '~ ' : ''}
                    {tache.nom}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="px-3 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-600 space-y-3">
        <div>
          <p className="font-semibold text-gray-700 mb-2">Légende — couleur = statut</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {LEGENDE_STATUTS.map(({ value, label }) => (
              <div key={value} className="flex items-center gap-2">
                <span className={`shrink-0 w-4 h-4 rounded shadow-sm ${BAR_BG[value]}`} title={label} aria-hidden />
                <span className="text-gray-700">{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="shrink-0 w-4 h-4 rounded shadow-sm bg-gray-500" aria-hidden />
              <span className="text-gray-700">Autre statut (gris)</span>
            </div>
          </div>
        </div>
        <div className="pt-2 border-t border-gray-200 space-y-1 text-gray-600">
          <p>
            <span className="inline-block w-3 h-3 rounded bg-gray-400 opacity-80 align-middle mr-1" aria-hidden />
            Préfixe « ~ » ou barre plus légère : début ou fin non renseignés (estimation à partir de la date de création).
          </p>
          <p>Largeur de la barre = plage entre date de début et fin approximative (lorsqu’elles sont définies).</p>
        </div>
      </div>
    </div>
  );
}
