import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Tache } from '../pages/Taches';

const STATUT_LABELS: Record<string, string> = {
  cree: 'Créée',
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  bloque: 'Bloquée',
  termine: 'Terminée',
  archive: 'Archivée',
};

function fmtDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR');
  } catch {
    return iso;
  }
}

function assignesStr(t: Tache) {
  const u = (t.assignesUtilisateurs || []).map((x) => `${x.prenom} ${x.nom}`.trim()).join(', ');
  return u || '—';
}

function safeFilePart(s: string) {
  return s.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80);
}

type EpicRow = { id: string; nom: string };
type UsRow = { id: string; description: string; epic?: { nom?: string } | null };

export function exportProjetDashboardPdf(
  projetNom: string,
  taches: Tache[],
  epics: EpicRow[],
  userStories: UsRow[],
) {
  const doc = new jsPDF();
  const now = new Date();
  const term = taches.filter((t) => t.statut === 'termine').length;
  const enc = taches.filter((t) => t.statut === 'en_cours').length;
  const bloq = taches.filter(
    (t) =>
      t.statut === 'bloque' ||
      (t.dateFinApprox &&
        new Date(t.dateFinApprox) < now &&
        t.statut !== 'termine' &&
        t.statut !== 'archive'),
  ).length;
  const pct = taches.length ? Math.round((term / taches.length) * 100) : 0;

  doc.setFontSize(16);
  doc.text(`Tableau de bord — ${projetNom}`, 14, 18);
  doc.setFontSize(10);
  doc.text(`Export du ${now.toLocaleString('fr-FR')}`, 14, 26);

  let y = 34;
  doc.setFontSize(11);
  doc.text(`Avancement global (tâches terminées / total) : ${pct}%`, 14, y);
  y += 7;
  doc.text(`Tâches : ${taches.length} total — ${term} terminées — ${enc} en cours — ${bloq} bloquées / en retard`, 14, y);
  y += 7;
  doc.text(`Epics : ${epics.length} — User stories : ${userStories.length}`, 14, y);
  y += 10;

  const statutRows: string[][] = [];
  const keys = ['cree', 'a_faire', 'en_cours', 'en_attente', 'bloque', 'termine', 'archive'];
  for (const k of keys) {
    const n = taches.filter((t) => t.statut === k).length;
    if (n > 0) statutRows.push([STATUT_LABELS[k] || k, String(n)]);
  }
  if (statutRows.length === 0) statutRows.push(['—', '0']);

  autoTable(doc, {
    startY: y,
    head: [['Statut', 'Nombre de tâches']],
    body: statutRows,
    theme: 'striped',
    styles: { fontSize: 9 },
  });

  doc.save(`dashboard-${safeFilePart(projetNom)}.pdf`);
}

export function exportProjetListePdf(projetNom: string, taches: Tache[]) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(`Tâches (liste) — ${projetNom}`, 14, 16);
  doc.setFontSize(9);
  doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 14, 22);

  const body = taches.map((t) => [
    t.nom.substring(0, 80),
    STATUT_LABELS[t.statut] || t.statut,
    assignesStr(t),
    fmtDate(t.dateDebut),
    fmtDate(t.dateFinApprox),
    t.userStory?.description ? t.userStory.description.substring(0, 60) + (t.userStory.description.length > 60 ? '…' : '') : '—',
  ]);

  autoTable(doc, {
    startY: 28,
    head: [['Tâche', 'Statut', 'Assignés', 'Début', 'Fin', 'User story']],
    body: body.length ? body : [['—', '—', '—', '—', '—', '—']],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [59, 130, 246] },
  });

  doc.save(`liste-taches-${safeFilePart(projetNom)}.pdf`);
}

export function exportProjetKanbanPdf(projetNom: string, taches: Tache[]) {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`Vue Kanban (par statut) — ${projetNom}`, 14, 16);
  doc.setFontSize(9);
  doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 14, 22);

  const cols = ['cree', 'a_faire', 'en_cours', 'en_attente', 'bloque', 'termine', 'archive'];
  let y = 30;
  for (const st of cols) {
    const list = taches.filter((t) => t.statut === st);
    if (list.length === 0) continue;
    doc.setFontSize(11);
    doc.text(`${STATUT_LABELS[st] || st} (${list.length})`, 14, y);
    y += 6;
    doc.setFontSize(9);
    for (const t of list) {
      const line = `• ${t.nom.substring(0, 95)}`;
      const lines = doc.splitTextToSize(line, 180);
      doc.text(lines, 18, y);
      y += lines.length * 5;
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
    }
    y += 6;
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
  }

  doc.save(`kanban-${safeFilePart(projetNom)}.pdf`);
}

export function exportProjetGanttPdf(projetNom: string, taches: Tache[]) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(`Planning (Gantt simplifié) — ${projetNom}`, 14, 16);
  doc.setFontSize(8);
  doc.text(
    'Plages indicatives (début / fin). Les dépendances détaillées se gèrent via les liaisons sur chaque tâche.',
    14,
    22,
  );

  const body = taches.map((t) => [
    t.nom.substring(0, 70),
    STATUT_LABELS[t.statut] || t.statut,
    fmtDate(t.dateDebut),
    fmtDate(t.dateFinApprox),
    t.createdAt ? fmtDate(t.createdAt) : '—',
  ]);

  autoTable(doc, {
    startY: 28,
    head: [['Tâche', 'Statut', 'Début', 'Fin approx.', 'Création']],
    body: body.length ? body : [['—', '—', '—', '—', '—']],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [99, 102, 241] },
  });

  doc.save(`gantt-${safeFilePart(projetNom)}.pdf`);
}

export function exportProjetEpicsUsPdf(projetNom: string, epics: EpicRow[], userStories: UsRow[]) {
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(`Epics & User stories — ${projetNom}`, 14, 16);

  autoTable(doc, {
    startY: 24,
    head: [['Epic']],
    body: epics.length ? epics.map((e) => [e.nom]) : [['—']],
    styles: { fontSize: 9 },
  });

  const dExt = doc as { lastAutoTable?: { finalY: number } };
  const lastY = dExt.lastAutoTable?.finalY ?? 40;
  autoTable(doc, {
    startY: lastY + 12,
    head: [['User story', 'Epic']],
    body: userStories.length
      ? userStories.map((us) => [
          us.description.substring(0, 100) + (us.description.length > 100 ? '…' : ''),
          us.epic?.nom || '—',
        ])
      : [['—', '—']],
    styles: { fontSize: 8 },
  });

  doc.save(`epics-us-${safeFilePart(projetNom)}.pdf`);
}
