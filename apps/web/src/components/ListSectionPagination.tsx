/** Nombre d’éléments par page pour les listes des sections Tâches / User stories / Epics (sans scroll). */
export const LIST_SECTION_PAGE_SIZE = 10;

export function clampListPage(page: number, totalItems: number, pageSize: number): number {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  return Math.min(Math.max(1, page), totalPages);
}

/** Pagination bas de liste, style aligné page Projet (bordure arrondie, indigo actif). */
export function ListSectionPagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems <= pageSize) return null;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, totalItems);
  const btnBase = 'px-3 py-2 rounded border text-sm font-medium transition-colors';
  const btnOff = `${btnBase} border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed`;
  const btnOn = `${btnBase} border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700`;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-gray-500">
        <span className="tabular-nums">{from}</span>–<span className="tabular-nums">{to}</span> sur{' '}
        <span className="tabular-nums">{totalItems}</span>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          className={safePage <= 1 ? btnOff : btnOn}
        >
          Précédent
        </button>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          className={safePage >= totalPages ? btnOff : btnOn}
        >
          Suivant
        </button>
      </div>
    </div>
  );
}
