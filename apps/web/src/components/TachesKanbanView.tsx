import { useState, useCallback } from 'react';

export type KanbanTache = {
  id: string;
  nom: string;
  statut: string;
  dateFinApprox?: string;
  projet?: { id: string; nom: string };
  assignesUtilisateurs?: { id: string; nom: string; prenom: string }[];
  assignesClientsFournisseurs?: { id: string; nom: string; type: string }[];
  /** Carte = tâche réelle : IDs user story / epic liés (si présents). */
  userStory?: { id: string; epic?: { id: string } | null } | null;
  /** Carte synthèse (liste US ou epics) : libellé de la ligne d’ID principale. */
  entityType?: 'tache' | 'user_story' | 'epic';
  /** Si `entityType === 'user_story'` : ID de l’epic parent pour affichage. */
  epicRefId?: string;
};

export type KanbanColumn = { value: string; label: string; color: string };

type Props = {
  taches: KanbanTache[];
  columns: KanbanColumn[];
  getCanEdit: (t: KanbanTache) => boolean;
  onMoveTache: (tacheId: string, newStatut: string) => Promise<void>;
  onCardClick: (t: KanbanTache) => void;
  getPriorityMeta?: (t: KanbanTache) => { score: number; labels: string[] } | null;
  /** Vue synthétique (ex. user stories / epics) : pas de glisser-déposer */
  readOnly?: boolean;
};

export default function TachesKanbanView({
  taches,
  columns,
  getCanEdit,
  onMoveTache,
  onCardClick,
  getPriorityMeta,
  readOnly = false,
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatut, setDragOverStatut] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);

  const byColumn = useCallback(() => {
    const m = new Map<string, KanbanTache[]>();
    for (const c of columns) m.set(c.value, []);
    for (const t of taches) {
      const col = columns.some((c) => c.value === t.statut) ? t.statut : 'cree';
      const list = m.get(col) ?? [];
      list.push(t);
      m.set(col, list);
    }
    return m;
  }, [taches, columns]);

  const grouped = byColumn();

  const handleDragStart = (e: React.DragEvent, t: KanbanTache) => {
    if (readOnly || !getCanEdit(t)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/tache-id', t.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(t.id);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverStatut(null);
  };

  const handleDragOver = (e: React.DragEvent, statut: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStatut(statut);
  };

  const handleDrop = async (e: React.DragEvent, newStatut: string) => {
    e.preventDefault();
    setDragOverStatut(null);
    const id = e.dataTransfer.getData('text/tache-id');
    if (!id) return;
    const t = taches.find((x) => x.id === id);
    if (!t || t.statut === newStatut) {
      setDraggingId(null);
      return;
    }
    if (readOnly || !getCanEdit(t)) {
      setDraggingId(null);
      return;
    }
    setMovingId(id);
    try {
      await onMoveTache(id, newStatut);
    } finally {
      setMovingId(null);
      setDraggingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        {readOnly ? (
          <>
            {taches.length} élément(s) — colonnes selon le statut agrégé des tâches liées (lecture seule, pas de
            glisser-déposer)
          </>
        ) : (
          <>
            {taches.length} tâche(s) — glissez une carte vers une autre colonne pour changer le statut
            <span className="text-gray-400"> (admin / contributeur)</span>
          </>
        )}
      </p>
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory">
        {columns.map((col) => {
          const list = grouped.get(col.value) ?? [];
          const isOver = dragOverStatut === col.value;
          return (
            <div
              key={col.value}
              className={`flex-shrink-0 w-[min(100vw-2rem,280px)] snap-start rounded-xl border-2 flex flex-col max-h-[min(75vh,720px)] transition-colors ${
                isOver ? 'border-blue-400 bg-blue-50/50' : 'border-gray-200 bg-gray-50/80'
              }`}
              onDragOver={(e) => handleDragOver(e, col.value)}
              onDrop={(e) => handleDrop(e, col.value)}
            >
              <div
                className={`px-3 py-2.5 border-b border-gray-200/80 rounded-t-[10px] sticky top-0 z-10 ${col.color} bg-opacity-95 backdrop-blur-sm`}
              >
                <h3 className="text-sm font-semibold text-gray-900">{col.label}</h3>
                <p className="text-xs text-gray-600 mt-0.5 tabular-nums">{list.length} carte{list.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="p-2 space-y-2 overflow-y-auto flex-1 min-h-[120px]">
                {list.map((t) => {
                  const editable = !readOnly && getCanEdit(t);
                  const isDragging = draggingId === t.id;
                  const isMoving = movingId === t.id;
                  const priorityMeta = getPriorityMeta?.(t) || null;
                  return (
                    <div
                      key={t.id}
                      draggable={editable}
                      onDragStart={(e) => handleDragStart(e, t)}
                      onDragEnd={handleDragEnd}
                      role="button"
                      tabIndex={0}
                      onClick={() => onCardClick(t)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          onCardClick(t);
                        }
                      }}
                      className={`rounded-lg border border-gray-200 bg-white p-3 shadow-sm text-left transition-all ${
                        editable ? 'cursor-grab active:cursor-grabbing hover:border-blue-300 hover:shadow' : 'cursor-pointer opacity-95'
                      } ${isDragging ? 'opacity-50 ring-2 ring-blue-400' : ''} ${isMoving ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      <p className="text-sm font-medium text-gray-900 line-clamp-3">{t.nom}</p>
                      {priorityMeta && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold border bg-indigo-50 text-indigo-800 border-indigo-200">
                            🧠 Score {priorityMeta.score}
                          </span>
                          {priorityMeta.labels.slice(0, 2).map((lb) => (
                            <span key={`${t.id}-${lb}`} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-100 text-indigo-800">
                              {lb}
                            </span>
                          ))}
                        </div>
                      )}
                      {(() => {
                        const et = t.entityType ?? 'tache';
                        const primaryLabel =
                          et === 'tache' ? 'Tâche' : et === 'user_story' ? 'User story' : 'Epic';
                        return (
                          <div className="mt-2 space-y-0.5 text-[10px] font-mono text-gray-500 break-all">
                            <div title={`Identifiant (${primaryLabel})`}>
                              <span className="text-gray-400 font-sans">{primaryLabel} · </span>
                              {t.id}
                            </div>
                            {et === 'user_story' && t.epicRefId && (
                              <div title="Identifiant de l’epic">
                                <span className="text-gray-400 font-sans">Epic · </span>
                                {t.epicRefId}
                              </div>
                            )}
                            {et === 'tache' && t.userStory && (
                              <>
                                <div title="Identifiant de la user story">
                                  <span className="text-gray-400 font-sans">User story · </span>
                                  {t.userStory.id}
                                </div>
                                {t.userStory.epic && (
                                  <div title="Identifiant de l’epic">
                                    <span className="text-gray-400 font-sans">Epic · </span>
                                    {t.userStory.epic.id}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                      {t.projet?.nom && <p className="text-xs text-purple-700 mt-1 truncate">📁 {t.projet.nom}</p>}
                      {t.dateFinApprox && (
                        <p className="text-xs text-gray-500 mt-1">Fin : {new Date(t.dateFinApprox).toLocaleDateString('fr-FR')}</p>
                      )}
                      {t.assignesUtilisateurs && t.assignesUtilisateurs.length > 0 && (
                        <p className="text-xs text-gray-600 mt-1.5 truncate" title="Personnes assignées">
                          {t.assignesUtilisateurs.map((u) => `${u.prenom} ${u.nom}`).join(', ')}
                        </p>
                      )}
                      {t.assignesClientsFournisseurs && t.assignesClientsFournisseurs.length > 0 && (
                        <p className="text-xs text-amber-900/90 mt-1 truncate" title="Clients / fournisseurs assignés">
                          {t.assignesClientsFournisseurs
                            .map((c) => `${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})`)
                            .join(', ')}
                        </p>
                      )}
                      {!editable && !readOnly && (
                        <p className="text-[10px] text-amber-700 mt-2 font-medium">Lecture seule — pas de glisser-déposer</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
