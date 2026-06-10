/** Numéros de page avec ellipses (même logique que Processus / Documents). */
export function getPaginationPageNumbers(page: number, totalPages: number): (number | string)[] {
  const pages: (number | string)[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return pages;
  }
  const addRange = (start: number, end: number) => {
    for (let i = start; i <= end; i++) pages.push(i);
  };
  if (page <= 4) {
    addRange(1, 5);
    pages.push('...');
    pages.push(totalPages);
  } else if (page >= totalPages - 3) {
    pages.push(1);
    pages.push('...');
    addRange(totalPages - 4, totalPages);
  } else {
    pages.push(1);
    pages.push('...');
    addRange(page - 1, page + 1);
    pages.push('...');
    pages.push(totalPages);
  }
  return pages;
}
