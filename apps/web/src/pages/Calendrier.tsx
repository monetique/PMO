import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';

type CalendarView = 'month' | 'week' | 'day' | 'timeline';
type CalendarTypeFilter = 'all' | 'task' | 'notification';
type TimelineScale = 'day' | 'week' | 'month';

type TacheItem = {
  id: string;
  nom: string;
  statut: string;
  dateDebut?: string | null;
  dateFinApprox?: string | null;
  createdAt?: string;
  projetId?: string | null;
  projet?: { id: string; nom: string } | null;
  assignesUtilisateurs?: Array<{ id: string; nom: string; prenom: string }>;
  assignesEntites?: Array<{ id: string; nom: string }>;
  assignesClientsFournisseurs?: Array<{ id: string; nom: string; type?: string }>;
  userStory?: {
    id: string;
    epic?: {
      id: string;
      nom: string;
    } | null;
  } | null;
  liaisons?: Array<{ tacheLieeId?: string | null; type?: string | null }>;
};

type NotificationItem = {
  id: string;
  type: string;
  titre: string;
  contenu: string;
  lienType?: string | null;
  lienId?: string | null;
  createdAt: string;
};

type JourFerieItem = {
  id: string;
  date: string;
  libelle: string;
};

type ProjetItem = {
  id: string;
  nom: string;
};

type UserItem = {
  id: string;
  nom: string;
  prenom: string;
  entitesMembres?: Array<{ entite?: { id: string; nom: string } | null }>;
};

type CalendarEvent = {
  id: string;
  sourceId: string;
  type: 'task' | 'notification';
  subType?: string;
  title: string;
  date: Date;
  endDate?: Date | null;
  projectId?: string | null;
  projectName?: string;
  assigneesUsers?: string[];
  assigneesEntites?: string[];
  assigneesClientsFournisseurs?: string[];
  epicName?: string;
  durationLabel?: string;
  status?: string;
  tooltip: string;
};

const STATUS_LABEL: Record<string, string> = {
  cree: 'Créée',
  a_faire: 'À faire / Non démarré',
  en_cours: 'En cours (Active)',
  en_attente: 'En attente / Suspendu',
  bloque: 'Bloqué / En retard',
  termine: 'Terminé / Finalisé',
  archive: 'Archivée',
};

function dayKey(d: Date) {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sameDay(a: Date, b: Date) {
  return dayKey(a) === dayKey(b);
}

function diffDays(a: Date, b: Date) {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime();
  return Math.round(ms / (24 * 3600 * 1000));
}

function computeDurationLabel(
  dateDebut?: string | null,
  dateFinApprox?: string | null,
  holidayDates: Set<string> = new Set()
) {
  if (!dateDebut || !dateFinApprox) return '';
  const start = startOfDay(new Date(dateDebut));
  const end = startOfDay(new Date(dateFinApprox));
  if (end.getTime() < start.getTime()) return '';
  let openDays = 0;
  let cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    const dow = cur.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidayDates.has(dayKey(cur));
    if (!isWeekend && !isHoliday) openDays += 1;
    cur = addDays(cur, 1);
  }
  return `${openDays} j ouvrés`;
}

function isWeekend(d: Date) {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

export default function Calendrier() {
  const navigate = useNavigate();
  useAuth();
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [tasks, setTasks] = useState<TacheItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [joursFeries, setJoursFeries] = useState<JourFerieItem[]>([]);
  const [projets, setProjets] = useState<ProjetItem[]>([]);
  const [allUsers, setAllUsers] = useState<UserItem[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<CalendarTypeFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assignUserFilter, setAssignUserFilter] = useState<string>('all');
  const [assignEntiteFilter, setAssignEntiteFilter] = useState<string>('all');
  const [assignCfFilter, setAssignCfFilter] = useState<string>('all');
  const [timelineScale, setTimelineScale] = useState<TimelineScale>('week');

  const load = async () => {
    setLoading(true);
    try {
      const [tRes, nRes, jfRes, pRes, uRes] = await Promise.all([
        api.get('/taches'),
        api.get('/notifications'),
        api.get('/jours-feries').catch(() => ({ data: [] })),
        api.get('/projets').catch(() => ({ data: [] })),
        api.get('/users').catch(() => ({ data: [] })),
      ]);
      setTasks(Array.isArray(tRes.data) ? tRes.data : []);
      setNotifications(Array.isArray(nRes.data) ? nRes.data : []);
      setJoursFeries(Array.isArray(jfRes.data) ? jfRes.data : []);
      setProjets(Array.isArray(pRes.data) ? pRes.data : []);
      setAllUsers(Array.isArray(uRes.data) ? uRes.data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => clearInterval(timer);
  }, []);

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    tasks.forEach((t) => {
      if (t.projet?.id) m.set(t.projet.id, t.projet.nom || t.projet.id);
    });
    return [...m.entries()].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [tasks]);

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tasks) {
      if (t.projetId && t.projet?.nom) m.set(t.projetId, t.projet.nom);
    }
    for (const p of projets) {
      if (p?.id && p?.nom && !m.has(p.id)) m.set(p.id, p.nom);
    }
    return m;
  }, [tasks, projets]);

  const taskById = useMemo(() => {
    const m = new Map<string, TacheItem>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const holidayDates = useMemo(() => {
    const s = new Set<string>();
    for (const j of joursFeries) {
      if (!j?.date) continue;
      s.add(String(j.date).slice(0, 10));
    }
    return s;
  }, [joursFeries]);

  const events = useMemo<CalendarEvent[]>(() => {
    const out: CalendarEvent[] = [];
    for (const t of tasks) {
      if (projectFilter !== 'all' && t.projetId !== projectFilter) continue;
      if (statusFilter !== 'all' && t.statut !== statusFilter) continue;
      if (assignUserFilter !== 'all') {
        const assigned = (t.assignesUtilisateurs || []).some((u) => u.id === assignUserFilter);
        if (!assigned) continue;
      }
      if (assignEntiteFilter !== 'all') {
        const assigned = (t.assignesEntites || []).some((e) => e.id === assignEntiteFilter);
        if (!assigned) continue;
      }
      if (assignCfFilter !== 'all') {
        const assigned = (t.assignesClientsFournisseurs || []).some((cf) => cf.id === assignCfFilter);
        if (!assigned) continue;
      }
      const start = t.dateDebut ? startOfDay(new Date(t.dateDebut)) : startOfDay(new Date(t.createdAt || Date.now()));
      const end = t.dateFinApprox ? endOfDay(new Date(t.dateFinApprox)) : start;
      const assigneesUsers = (t.assignesUtilisateurs || []).map((u) => `${u.prenom} ${u.nom}`.trim()).filter(Boolean);
      const assigneesEntites = (t.assignesEntites || []).map((e) => e.nom).filter(Boolean);
      const assigneesClientsFournisseurs = (t.assignesClientsFournisseurs || []).map((cf) => cf.nom).filter(Boolean);
      const epicName = t.userStory?.epic?.nom?.trim() || '';
      const durationLabel = computeDurationLabel(t.dateDebut, t.dateFinApprox, holidayDates);
      let cursor = startOfDay(start);
      const limit = startOfDay(end);
      while (cursor.getTime() <= limit.getTime()) {
        out.push({
          id: `${t.id}-${dayKey(cursor)}`,
          sourceId: t.id,
          type: 'task',
          title: t.nom,
          date: new Date(cursor),
          endDate: end,
          projectId: t.projetId || null,
          projectName: t.projet?.nom,
          assigneesUsers,
          assigneesEntites,
          assigneesClientsFournisseurs,
          epicName: epicName || undefined,
          durationLabel,
          status: t.statut,
          tooltip:
            `${t.nom}\nProjet: ${t.projet?.nom || '—'}\nStatut: ${STATUS_LABEL[t.statut] || t.statut}` +
            `${epicName ? `\nEPIC: ${epicName}` : ''}` +
            `${assigneesUsers.length ? `\nUtilisateurs: ${assigneesUsers.join(', ')}` : ''}` +
            `${assigneesEntites.length ? `\nEntités: ${assigneesEntites.join(', ')}` : ''}` +
            `${assigneesClientsFournisseurs.length ? `\nClients/Fournisseurs: ${assigneesClientsFournisseurs.join(', ')}` : ''}` +
            `${durationLabel ? `\nTemps de réalisation: ${durationLabel}` : ''}`,
        });
        cursor = addDays(cursor, 1);
      }
    }
    for (const n of notifications) {
      let notifProjectId: string | null = null;
      let notifProjectName: string | undefined;
      if (n.lienType === 'projet' && n.lienId) {
        notifProjectId = n.lienId;
        notifProjectName = projectNameById.get(n.lienId);
        // Même logique de périmètre que les tâches:
        // si le projet n'est pas visible dans le scope utilisateur, on masque l'événement.
        if (!notifProjectName) continue;
      } else if (n.lienType === 'tache' && n.lienId) {
        const t = taskById.get(n.lienId);
        // Si la tâche n'est pas accessible (donc absente de /taches), la notification est masquée.
        if (!t) continue;
        notifProjectId = t?.projetId || null;
        notifProjectName = t?.projet?.nom || (notifProjectId ? projectNameById.get(notifProjectId) : undefined);
      }
      out.push({
        id: `n-${n.id}`,
        sourceId: n.id,
        type: 'notification',
        subType: n.type,
        title: n.titre,
        date: startOfDay(new Date(n.createdAt)),
        projectId: notifProjectId,
        projectName: notifProjectName,
        tooltip: `${n.titre}\n${n.contenu}${notifProjectName ? `\nProjet: ${notifProjectName}` : ''}`,
      });
    }
    if (typeFilter === 'task') return out.filter((e) => e.type === 'task');
    if (typeFilter === 'notification') return out.filter((e) => e.type === 'notification');
    return out;
  }, [tasks, notifications, typeFilter, projectFilter, statusFilter, assignUserFilter, assignEntiteFilter, assignCfFilter, holidayDates, projectNameById, taskById]);

  const filteredTasksForTimeline = useMemo(() => {
    if (typeFilter === 'notification') return [] as TacheItem[];
    return tasks.filter((t) => {
      if (projectFilter !== 'all' && t.projetId !== projectFilter) return false;
      if (statusFilter !== 'all' && t.statut !== statusFilter) return false;
      if (assignUserFilter !== 'all' && !(t.assignesUtilisateurs || []).some((u) => u.id === assignUserFilter)) return false;
      if (assignEntiteFilter !== 'all' && !(t.assignesEntites || []).some((e) => e.id === assignEntiteFilter)) return false;
      if (assignCfFilter !== 'all' && !(t.assignesClientsFournisseurs || []).some((cf) => cf.id === assignCfFilter)) return false;
      return true;
    });
  }, [tasks, typeFilter, projectFilter, statusFilter, assignUserFilter, assignEntiteFilter, assignCfFilter]);

  const filteredNotificationsForTimeline = useMemo(() => {
    if (typeFilter === 'task') return [] as NotificationItem[];
    const visibleTaskIds = new Set(filteredTasksForTimeline.map((t) => t.id));
    return notifications.filter((n) => {
      if (n.lienType === 'tache' && n.lienId) {
        // Notification visible seulement si la tâche est dans le périmètre courant.
        return visibleTaskIds.has(n.lienId);
      }
      if (n.lienType === 'projet' && n.lienId) {
        if (projectFilter !== 'all' && n.lienId !== projectFilter) return false;
        // Projet visible seulement s'il est présent dans le scope remonté au calendrier.
        return projectNameById.has(n.lienId);
      }
      if (projectFilter !== 'all') return false;
      // Notification sans lien projet/tâche: reste visible car reçue par l'utilisateur connecté.
      return true;
    });
  }, [typeFilter, notifications, filteredTasksForTimeline, projectFilter, projectNameById]);

  const dynamicUsers = useMemo(() => {
    const m = new Map<string, string>();
    filteredTasksForTimeline.forEach((t) => {
      (t.assignesUtilisateurs || []).forEach((u) => m.set(u.id, `${u.prenom} ${u.nom}`));
    });
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  }, [filteredTasksForTimeline]);

  const dynamicEntites = useMemo(() => {
    const m = new Map<string, string>();
    filteredTasksForTimeline.forEach((t) => {
      (t.assignesEntites || []).forEach((e) => m.set(e.id, e.nom));
    });
    return [...m.entries()].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [filteredTasksForTimeline]);

  const dynamicCfs = useMemo(() => {
    const m = new Map<string, string>();
    filteredTasksForTimeline.forEach((t) => {
      (t.assignesClientsFournisseurs || []).forEach((cf) => m.set(cf.id, cf.nom));
    });
    return [...m.entries()].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }, [filteredTasksForTimeline]);

  useEffect(() => {
    if (assignUserFilter !== 'all' && !dynamicUsers.some((u) => u.id === assignUserFilter)) setAssignUserFilter('all');
    if (assignEntiteFilter !== 'all' && !dynamicEntites.some((e) => e.id === assignEntiteFilter)) setAssignEntiteFilter('all');
    if (assignCfFilter !== 'all' && !dynamicCfs.some((c) => c.id === assignCfFilter)) setAssignCfFilter('all');
  }, [dynamicUsers, dynamicEntites, dynamicCfs, assignUserFilter, assignEntiteFilter, assignCfFilter]);

  const [rangeStart, rangeEnd] = useMemo(() => {
    const a = startOfDay(anchor);
    if (view === 'day') return [a, endOfDay(a)] as const;
    if (view === 'timeline') {
      if (timelineScale === 'day') return [a, endOfDay(a)] as const;
      if (timelineScale === 'week') {
        const d = a.getDay() === 0 ? 7 : a.getDay();
        const monday = addDays(a, 1 - d);
        return [monday, endOfDay(addDays(monday, 6))] as const;
      }
      const first = new Date(a.getFullYear(), a.getMonth(), 1);
      const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
      return [startOfDay(first), endOfDay(last)] as const;
    }
    if (view === 'week') {
      const d = a.getDay() === 0 ? 7 : a.getDay();
      const monday = addDays(a, 1 - d);
      return [monday, endOfDay(addDays(monday, 6))] as const;
    }
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return [startOfDay(first), endOfDay(last)] as const;
  }, [anchor, view, timelineScale]);

  const daysInRange = useMemo(() => {
    const arr: Date[] = [];
    let cur = startOfDay(rangeStart);
    while (cur.getTime() <= rangeEnd.getTime()) {
      arr.push(new Date(cur));
      cur = addDays(cur, 1);
    }
    return arr;
  }, [rangeStart, rangeEnd]);

  const weekBusinessDays = useMemo(() => {
    if (view !== 'week') return daysInRange;
    return daysInRange.filter((d) => !isWeekend(d));
  }, [view, daysInRange]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    events.forEach((e) => {
      const k = dayKey(e.date);
      const arr = m.get(k) || [];
      arr.push(e);
      m.set(k, arr);
    });
    return m;
  }, [events]);

  const navigatePeriod = (dir: -1 | 1) => {
    if (view === 'day') setAnchor(addDays(anchor, dir));
    else if (view === 'week') setAnchor(addDays(anchor, 7 * dir));
    else if (view === 'timeline') {
      if (timelineScale === 'day') setAnchor(addDays(anchor, dir));
      else if (timelineScale === 'week') setAnchor(addDays(anchor, 7 * dir));
      else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, anchor.getDate()));
    }
    else setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, anchor.getDate()));
  };

  const goToday = () => setAnchor(startOfDay(new Date()));

  const resetFilters = () => {
    setTypeFilter('all');
    setProjectFilter('all');
    setStatusFilter('all');
    setAssignUserFilter('all');
    setAssignEntiteFilter('all');
    setAssignCfFilter('all');
  };

  const openEvent = (e: CalendarEvent) => {
    if (e.type === 'task') {
      navigate(`/taches?focusTaskId=${encodeURIComponent(e.sourceId)}`);
      return;
    }
    const notif = notifications.find((n) => n.id === e.sourceId);
    if (!notif) return;
    if (notif.lienType === 'document' && notif.lienId) navigate('/documents');
    else if (notif.lienType === 'projet' && notif.lienId) navigate(`/projets/${notif.lienId}`);
    else if (notif.lienType === 'tache' && notif.lienId) navigate('/taches');
    else navigate('/dashboard');
  };

  const onTaskDropToDay = async (taskId: string, targetDay: Date) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const oldStart = task.dateDebut ? startOfDay(new Date(task.dateDebut)) : startOfDay(new Date());
    const delta = diffDays(targetDay, oldStart);
    if (delta === 0) return;
    const newStart = addDays(oldStart, delta);
    const payload: any = { dateDebut: dayKey(newStart) };
    if (task.dateFinApprox) {
      const oldEnd = startOfDay(new Date(task.dateFinApprox));
      payload.dateFinApprox = dayKey(addDays(oldEnd, delta));
    }
    try {
      await api.put(`/taches/${task.id}`, payload);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Déplacement impossible');
    }
  };

  const monthGridDays = useMemo(() => {
    if (view !== 'month') return [] as Date[];
    const first = new Date(rangeStart);
    const firstDow = first.getDay() === 0 ? 7 : first.getDay();
    const gridStart = addDays(first, 1 - firstDow);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [view, rangeStart]);

  const renderTaskMeta = (ev: CalendarEvent) => (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {!!ev.epicName && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 font-semibold tracking-wide">
          EPIC: {ev.epicName}
        </span>
      )}
      {!!ev.assigneesUsers?.length && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-indigo-50 text-indigo-700">
          U: {ev.assigneesUsers.join(', ')}
        </span>
      )}
      {!!ev.assigneesEntites?.length && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-teal-50 text-teal-700">
          E: {ev.assigneesEntites.join(', ')}
        </span>
      )}
      {!!ev.assigneesClientsFournisseurs?.length && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-fuchsia-50 text-fuchsia-700">
          C/F: {ev.assigneesClientsFournisseurs.join(', ')}
        </span>
      )}
      {!!ev.durationLabel && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 text-gray-700">
          Durée: {ev.durationLabel}
        </span>
      )}
      {ev.status === 'bloque' && (
        <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 font-semibold">
          En retard
        </span>
      )}
    </div>
  );

  const timelineModel = useMemo(() => {
    const dayWidth = 44;
    const rowHeight = 36;
    const timelineStart = startOfDay(rangeStart);
    const timelineEnd = endOfDay(rangeEnd);
    const totalDays = Math.max(1, diffDays(timelineEnd, timelineStart) + 1);

    const userById = new Map<string, UserItem>();
    for (const u of allUsers) userById.set(u.id, u);

    type Row = { id: string; label: string; level: number; parentId: string | null; kind: string; sticky?: boolean };
    type Bar = {
      id: string;
      rowId: string;
      taskId: string;
      title: string;
      projectName: string;
      status: string;
      start: Date;
      end: Date;
      task: TacheItem;
    };

    const rows: Row[] = [];
    const bars: Bar[] = [];
    const pushRow = (row: Row) => {
      if (!rows.some((r) => r.id === row.id)) rows.push(row);
    };

    for (const t of filteredTasksForTimeline) {
      const projetId = t.projetId || 'unknown-project';
      const projetNom = t.projet?.nom || projectNameById.get(t.projetId || '') || 'Sans projet';
      const projectRowId = `project:${projetId}`;
      const entitesGroupId = `project:${projetId}:entites`;
      const tiersGroupId = `project:${projetId}:tiers`;
      const unknownRowId = `project:${projetId}:unknown`;

      pushRow({ id: projectRowId, label: projetNom, level: 0, parentId: null, kind: 'project' });
      pushRow({ id: entitesGroupId, label: 'Entités', level: 1, parentId: projectRowId, kind: 'entites-group' });
      pushRow({ id: tiersGroupId, label: 'Tiers', level: 1, parentId: projectRowId, kind: 'tiers-group' });
      pushRow({ id: unknownRowId, label: 'Inconnus', level: 1, parentId: projectRowId, kind: 'unknown' });

      const start = t.dateDebut ? startOfDay(new Date(t.dateDebut)) : startOfDay(new Date(t.createdAt || Date.now()));
      const end = t.dateFinApprox ? endOfDay(new Date(t.dateFinApprox)) : endOfDay(start);

      const addBar = (rowId: string, suffix: string) => {
        bars.push({
          id: `${t.id}:${suffix}`,
          rowId,
          taskId: t.id,
          title: t.nom,
          projectName: projetNom,
          status: t.statut,
          start,
          end,
          task: t,
        });
      };

      const usersAssigned = t.assignesUtilisateurs || [];
      const tiersAssigned = t.assignesClientsFournisseurs || [];
      const entitesAssigned = t.assignesEntites || [];

      if (usersAssigned.length > 0) {
        for (const u of usersAssigned) {
          const userFullName = `${u.prenom} ${u.nom}`.trim() || 'Utilisateur';
          const userRowId = `project:${projetId}:user:${u.id}`;
          const userData = userById.get(u.id);
          const userEntites = (userData?.entitesMembres || [])
            .map((ue) => ue.entite)
            .filter(Boolean) as Array<{ id: string; nom: string }>;
          if (userEntites.length > 0) {
            for (const ent of userEntites) {
              const entiteRowId = `project:${projetId}:entite:${ent.id}`;
              pushRow({ id: entiteRowId, label: ent.nom, level: 2, parentId: entitesGroupId, kind: 'entite' });
            }
            const firstEntiteId = userEntites[0].id;
            pushRow({
              id: userRowId,
              label: userFullName,
              level: 3,
              parentId: `project:${projetId}:entite:${firstEntiteId}`,
              kind: 'user',
            });
          } else {
            const entiteRowId = `project:${projetId}:entite:unknown`;
            pushRow({ id: entiteRowId, label: 'Entité inconnue', level: 2, parentId: entitesGroupId, kind: 'entite' });
            pushRow({ id: userRowId, label: userFullName, level: 3, parentId: entiteRowId, kind: 'user' });
          }
          addBar(userRowId, `user-${u.id}`);
        }
      } else if (tiersAssigned.length > 0) {
        for (const cf of tiersAssigned) {
          const tierRowId = `project:${projetId}:tier:${cf.id}`;
          pushRow({ id: tierRowId, label: cf.nom, level: 2, parentId: tiersGroupId, kind: 'tier' });
          addBar(tierRowId, `tier-${cf.id}`);
        }
      } else if (entitesAssigned.length > 0) {
        for (const ent of entitesAssigned) {
          const entiteRowId = `project:${projetId}:entite:${ent.id}`;
          pushRow({ id: entiteRowId, label: ent.nom, level: 2, parentId: entitesGroupId, kind: 'entite' });
          addBar(entiteRowId, `entite-${ent.id}`);
        }
      } else {
        addBar(unknownRowId, 'unknown');
      }
    }

    for (const n of filteredNotificationsForTimeline) {
      let projetId = 'unknown-project';
      let projetNom = 'Sans projet';
      if (n.lienType === 'projet' && n.lienId) {
        projetId = n.lienId;
        projetNom = projectNameById.get(n.lienId) || 'Projet';
      } else if (n.lienType === 'tache' && n.lienId) {
        const t = taskById.get(n.lienId);
        if (t?.projetId) {
          projetId = t.projetId;
          projetNom = t.projet?.nom || projectNameById.get(t.projetId) || 'Projet';
        }
      }
      const projectRowId = `project:${projetId}`;
      const notifGroupId = `project:${projetId}:notifications`;
      pushRow({ id: projectRowId, label: projetNom, level: 0, parentId: null, kind: 'project' });
      pushRow({ id: notifGroupId, label: 'Notifications', level: 1, parentId: projectRowId, kind: 'notifications-group' });
      const notifRowId = `project:${projetId}:notification:${n.id}`;
      pushRow({ id: notifRowId, label: n.titre, level: 2, parentId: notifGroupId, kind: 'notification' });

      const date = startOfDay(new Date(n.createdAt));
      bars.push({
        id: `notif:${n.id}`,
        rowId: notifRowId,
        taskId: `notification:${n.id}`,
        title: n.titre,
        projectName: projetNom,
        status: 'notification',
        start: date,
        end: endOfDay(date),
        task: {
          id: `notification:${n.id}`,
          nom: n.titre,
          statut: 'notification',
          dateDebut: n.createdAt,
          dateFinApprox: n.createdAt,
        },
      });
    }

    const childrenByParent = new Map<string | null, string[]>();
    for (const row of rows) {
      const arr = childrenByParent.get(row.parentId) || [];
      arr.push(row.id);
      childrenByParent.set(row.parentId, arr);
    }

    const sortIdsByLabel = (ids: string[]) =>
      [...ids].sort((a, b) => {
        const ra = rows.find((r) => r.id === a);
        const rb = rows.find((r) => r.id === b);
        return (ra?.label || '').localeCompare(rb?.label || '', 'fr');
      });

    const orderedRows: Row[] = [];
    const visit = (parentId: string | null) => {
      const childIds = sortIdsByLabel(childrenByParent.get(parentId) || []);
      for (const id of childIds) {
        const row = rows.find((r) => r.id === id);
        if (!row) continue;
        orderedRows.push(row);
        visit(id);
      }
    };
    visit(null);

    const barItems = bars
      .map((b) => {
        const clampedStart = b.start.getTime() < timelineStart.getTime() ? timelineStart : b.start;
        const clampedEnd = b.end.getTime() > timelineEnd.getTime() ? timelineEnd : b.end;
        if (clampedEnd.getTime() < timelineStart.getTime() || clampedStart.getTime() > timelineEnd.getTime()) return null;
        const startOffset = Math.max(0, diffDays(clampedStart, timelineStart));
        const endOffset = Math.max(startOffset, diffDays(clampedEnd, timelineStart));
        return {
          ...b,
          left: startOffset * dayWidth + 2,
          width: Math.max(12, (endOffset - startOffset + 1) * dayWidth - 4),
        };
      })
      .filter(Boolean) as Array<Bar & { left: number; width: number }>;

    const barsByRow = new Map<string, Array<Bar & { left: number; width: number }>>();
    for (const b of barItems) {
      const arr = barsByRow.get(b.rowId) || [];
      arr.push(b);
      barsByRow.set(b.rowId, arr);
    }

    const firstBarByTaskId = new Map<string, { x: number; y: number }>();
    orderedRows.forEach((row, rowIndex) => {
      const rowBars = barsByRow.get(row.id) || [];
      for (const b of rowBars) {
        if (firstBarByTaskId.has(b.taskId)) continue;
        firstBarByTaskId.set(b.taskId, {
          x: b.left + b.width,
          y: rowIndex * rowHeight + rowHeight / 2,
        });
      }
    });

    const dependencyLines: Array<{ key: string; left: number; top: number; width: number; height: number }> = [];
    const added = new Set<string>();
    for (const t of filteredTasksForTimeline) {
      const source = firstBarByTaskId.get(t.id);
      if (!source) continue;
      for (const l of t.liaisons || []) {
        const targetId = l?.tacheLieeId || '';
        if (!targetId) continue;
        const target = firstBarByTaskId.get(targetId);
        if (!target) continue;
        const key = `${t.id}->${targetId}`;
        if (added.has(key)) continue;
        added.add(key);
        const left = Math.min(source.x, target.x);
        const top = Math.min(source.y, target.y);
        const width = Math.max(1, Math.abs(target.x - source.x));
        const height = Math.max(1, Math.abs(target.y - source.y));
        dependencyLines.push({ key, left, top, width, height });
      }
    }

    const days: Date[] = [];
    let cur = startOfDay(timelineStart);
    while (cur.getTime() <= timelineEnd.getTime()) {
      days.push(new Date(cur));
      cur = addDays(cur, 1);
    }

    return {
      dayWidth,
      rowHeight,
      totalDays,
      orderedRows,
      rowById: new Map(orderedRows.map((r) => [r.id, r])),
      barsByRow,
      dependencyLines,
      days,
      timelineWidth: totalDays * dayWidth,
    };
  }, [filteredTasksForTimeline, filteredNotificationsForTimeline, allUsers, projectNameById, rangeStart, rangeEnd, taskById]);

  const visibleTimelineRows = useMemo(() => {
    const rows = timelineModel.orderedRows;
    const byId = timelineModel.rowById;
    const isExpanded = (id: string) => expandedRows[id] !== false;
    return rows.filter((row) => {
      let p = row.parentId;
      while (p) {
        if (!isExpanded(p)) return false;
        p = byId.get(p)?.parentId || null;
      }
      return true;
    });
  }, [timelineModel, expandedRows]);

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Calendrier</h1>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigatePeriod(-1)} className="px-3 py-2 border rounded text-sm">Précédent</button>
          <button onClick={goToday} className="px-3 py-2 border rounded text-sm">Aujourd’hui</button>
          <button onClick={() => navigatePeriod(1)} className="px-3 py-2 border rounded text-sm">Suivant</button>
          <button onClick={() => void load()} className="px-3 py-2 border rounded text-sm">Rafraîchir</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setView('month')} className={`px-3 py-1.5 rounded text-sm ${view === 'month' ? 'bg-blue-600 text-white' : 'bg-white border'}`}>Mois</button>
        <button onClick={() => setView('week')} className={`px-3 py-1.5 rounded text-sm ${view === 'week' ? 'bg-blue-600 text-white' : 'bg-white border'}`}>Semaine</button>
          <button onClick={() => setView('day')} className={`px-3 py-1.5 rounded text-sm ${view === 'day' ? 'bg-blue-600 text-white' : 'bg-white border'}`}>Jour</button>
          <button onClick={() => setView('timeline')} className={`px-3 py-1.5 rounded text-sm ${view === 'timeline' ? 'bg-blue-600 text-white' : 'bg-white border'}`}>Timeline</button>

        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as CalendarTypeFilter)} className="px-2 py-1.5 border rounded text-sm">
          <option value="all">Type: Tous</option>
          <option value="task">Type: Tâches</option>
          <option value="notification">Type: Notifications</option>
        </select>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="px-2 py-1.5 border rounded text-sm">
          <option value="all">Projet: Tous</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-1.5 border rounded text-sm">
          <option value="all">Statut: Tous</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={assignUserFilter} onChange={(e) => setAssignUserFilter(e.target.value)} className="px-2 py-1.5 border rounded text-sm">
          <option value="all">Assignation utilisateur: Tous</option>
          {dynamicUsers.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
        <select value={assignEntiteFilter} onChange={(e) => setAssignEntiteFilter(e.target.value)} className="px-2 py-1.5 border rounded text-sm">
          <option value="all">Assignation entité: Toutes</option>
          {dynamicEntites.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
        </select>
        <select value={assignCfFilter} onChange={(e) => setAssignCfFilter(e.target.value)} className="px-2 py-1.5 border rounded text-sm">
          <option value="all">Assignation client/fournisseur: Tous</option>
          {dynamicCfs.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
        {view === 'timeline' && (
          <select value={timelineScale} onChange={(e) => setTimelineScale(e.target.value as TimelineScale)} className="px-2 py-1.5 border rounded text-sm">
            <option value="day">Période timeline: Jour</option>
            <option value="week">Période timeline: Semaine</option>
            <option value="month">Période timeline: Mois</option>
          </select>
        )}
        <button
          type="button"
          onClick={resetFilters}
          className="px-3 py-1.5 border rounded text-sm bg-white hover:bg-gray-50"
        >
          Réinitialiser filtres
        </button>
      </div>

      <div className="text-xs text-gray-600 mb-3 flex flex-wrap gap-4">
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-blue-500" /> Tâche planifiée (créée/à faire/autre)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-500" /> Tâche active (en cours)</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-orange-400" /> Notification</span>
      </div>

      {loading ? (
        <div className="bg-white border rounded p-6 text-gray-500">Chargement…</div>
      ) : view === 'month' ? (
        <div className="grid grid-cols-7 gap-2">
          {monthGridDays.map((d) => {
            const dayEvents = eventsByDay.get(dayKey(d)) || [];
            const inMonth = d.getMonth() === rangeStart.getMonth();
            return (
              <div
                key={dayKey(d)}
                className={`min-h-[120px] border rounded p-2 ${inMonth ? '' : 'opacity-50'} ${isWeekend(d) ? 'bg-gray-50 border-gray-200' : 'bg-white'}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const taskId = e.dataTransfer.getData('task-id');
                  if (taskId) void onTaskDropToDay(taskId, d);
                }}
              >
                <div className="text-xs font-semibold mb-1">{d.toLocaleDateString('fr-FR')}</div>
                {isWeekend(d) && (
                  <div className="text-[10px] text-gray-500 mb-1">Week-end</div>
                )}
                <div className="space-y-1">
                  {dayEvents.map((ev) => {
                    const isTask = ev.type === 'task';
                    const status = ev.status || '';
                    const lineClass = isTask
                      ? status === 'termine'
                        ? 'bg-blue-100 line-through text-gray-500'
                        : status === 'bloque'
                          ? 'bg-red-100 text-red-800'
                          : status === 'en_attente'
                            ? 'bg-yellow-100 text-yellow-800'
                            : status === 'en_cours'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-blue-100 text-blue-900'
                      : 'bg-orange-100 text-orange-900';
                    return (
                      <button
                        key={ev.id}
                        title={ev.tooltip}
                        draggable={isTask}
                        onDragStart={(e) => {
                          if (isTask) e.dataTransfer.setData('task-id', ev.sourceId);
                        }}
                        onClick={() => openEvent(ev)}
                        className={`w-full text-left px-1.5 py-1 rounded text-[11px] ${lineClass}`}
                      >
                        {isTask && ev.status === 'bloque' ? 'Retard · ' : ''}
                        {isTask && ev.status === 'en_attente' ? 'En pause · ' : ''}
                        <span className="font-medium">{ev.title}</span>
                        {ev.projectName ? <span className="text-[10px] text-gray-700"> ({ev.projectName})</span> : null}
                        {isTask && renderTaskMeta(ev)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === 'timeline' ? (
        <div className="bg-white border rounded">
          <div className="overflow-auto max-h-[75vh]">
            <div
              className="relative"
              style={{ minWidth: `${320 + timelineModel.timelineWidth}px` }}
            >
              <div className="flex sticky top-0 z-20 bg-white border-b">
                <div className="w-80 shrink-0 px-3 py-2 text-xs font-semibold text-gray-700 border-r">
                  Hiérarchie
                </div>
                <div className="relative" style={{ width: `${timelineModel.timelineWidth}px` }}>
                  <div className="h-6 border-b text-[11px] text-gray-500">
                    {timelineModel.days
                      .filter((d) => d.getDay() === 1)
                      .map((d) => (
                        <div
                          key={`w-${dayKey(d)}`}
                          className="absolute top-0 h-6 border-l border-gray-300 pl-1"
                          style={{ left: `${diffDays(d, startOfDay(rangeStart)) * timelineModel.dayWidth}px` }}
                        >
                          Semaine du {d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                        </div>
                      ))}
                  </div>
                  <div className="h-8 flex text-[10px] text-gray-600">
                    {timelineModel.days.map((d) => (
                      <div
                        key={`d-${dayKey(d)}`}
                        className={`h-8 border-l border-gray-200 flex items-center justify-center ${isWeekend(d) ? 'bg-gray-50' : ''}`}
                        style={{ width: `${timelineModel.dayWidth}px` }}
                      >
                        {d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {visibleTimelineRows.map((row, rowIndex) => {
                const rowBars = timelineModel.barsByRow.get(row.id) || [];
                const hasChildren = timelineModel.orderedRows.some((r) => r.parentId === row.id);
                const isOpen = expandedRows[row.id] !== false;
                const rowBg = row.kind === 'project' ? 'bg-gray-50 font-semibold' : row.kind.endsWith('group') ? 'bg-gray-25' : 'bg-white';
                return (
                  <div key={row.id} className={`flex border-b ${rowBg}`} style={{ height: `${timelineModel.rowHeight}px` }}>
                    <div className="w-80 shrink-0 border-r px-2 flex items-center text-xs text-gray-800 sticky left-0 z-10 bg-white">
                      <div style={{ paddingLeft: `${row.level * 14}px` }} className="flex items-center gap-1">
                        {hasChildren ? (
                          <button
                            type="button"
                            className="w-4 h-4 inline-flex items-center justify-center rounded border text-[10px]"
                            onClick={() => setExpandedRows((prev) => ({ ...prev, [row.id]: !(prev[row.id] !== false) }))}
                            title={isOpen ? 'Réduire' : 'Développer'}
                          >
                            {isOpen ? '−' : '+'}
                          </button>
                        ) : (
                          <span className="w-4 h-4 inline-block" />
                        )}
                        <span>{row.label}</span>
                      </div>
                    </div>
                    <div className="relative" style={{ width: `${timelineModel.timelineWidth}px` }}>
                      {timelineModel.days.map((d) => (
                        <div
                          key={`${row.id}:${dayKey(d)}`}
                          className={`absolute top-0 bottom-0 border-l ${isWeekend(d) ? 'bg-gray-50 border-gray-200' : 'border-gray-100'}`}
                          style={{ left: `${diffDays(d, startOfDay(rangeStart)) * timelineModel.dayWidth}px`, width: `${timelineModel.dayWidth}px` }}
                        />
                      ))}
                      {rowBars.map((b) => {
                        const barClass =
                          b.status === 'notification'
                            ? 'bg-orange-500'
                            : b.status === 'termine'
                            ? 'bg-blue-400'
                            : b.status === 'en_cours'
                              ? 'bg-green-500'
                              : b.status === 'bloque'
                                ? 'bg-red-500'
                                : 'bg-blue-500';
                        return (
                          <button
                            key={b.id}
                            title={`${b.title}\nProjet: ${b.projectName}`}
                            onClick={() => {
                              if (b.taskId.startsWith('notification:')) {
                                openEvent({
                                  id: b.id,
                                  sourceId: b.taskId.replace('notification:', ''),
                                  type: 'notification',
                                  title: b.title,
                                  date: b.start,
                                  endDate: b.end,
                                  status: b.status,
                                  projectName: b.projectName,
                                  tooltip: b.title,
                                });
                                return;
                              }
                              openEvent({
                                id: b.id,
                                sourceId: b.taskId,
                                type: 'task',
                                title: b.title,
                                date: b.start,
                                endDate: b.end,
                                status: b.status,
                                projectName: b.projectName,
                                tooltip: b.title,
                              });
                            }}
                            className={`absolute top-1/2 -translate-y-1/2 h-5 rounded text-[10px] text-white px-2 text-left truncate ${barClass}`}
                            style={{ left: `${b.left}px`, width: `${b.width}px` }}
                          >
                            {b.title}
                          </button>
                        );
                      })}
                      {rowIndex === 0 &&
                        timelineModel.dependencyLines.map((ln) => (
                          <div key={ln.key}>
                            <div
                              className="absolute border-t border-indigo-400"
                              style={{ left: `${ln.left}px`, top: `${ln.top}px`, width: `${ln.width}px` }}
                            />
                            <div
                              className="absolute border-l border-indigo-400"
                              style={{ left: `${ln.left + ln.width}px`, top: `${ln.top}px`, height: `${ln.height}px` }}
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}

              {visibleTimelineRows.length === 0 && (
                <div className="p-4 text-sm text-gray-500">Aucune tâche à afficher pour la période et les filtres sélectionnés.</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border rounded p-3">
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            {(view === 'day' ? [anchor] : weekBusinessDays).map((d) => {
              const dayEvents = eventsByDay.get(dayKey(d)) || [];
              return (
                <div
                  key={dayKey(d)}
                  className="border rounded p-2 min-h-[280px]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const taskId = e.dataTransfer.getData('task-id');
                    if (taskId) void onTaskDropToDay(taskId, d);
                  }}
                >
                  <div className="text-xs font-semibold mb-2">{d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>
                  <div className="space-y-1">
                    {dayEvents.map((ev) => (
                      <button
                        key={ev.id}
                        title={ev.tooltip}
                        draggable={ev.type === 'task'}
                        onDragStart={(e) => {
                          if (ev.type === 'task') e.dataTransfer.setData('task-id', ev.sourceId);
                        }}
                        onClick={() => openEvent(ev)}
                        className={`w-full text-left px-2 py-1 rounded text-xs ${ev.type === 'task' ? 'bg-blue-100 text-blue-900' : 'bg-orange-100 text-orange-900'} ${ev.type === 'task' && ev.status === 'termine' ? 'line-through text-gray-500' : ''}`}
                      >
                        <span className="font-medium">{ev.title}</span>
                        {ev.projectName ? <span className="text-[11px] text-gray-700"> ({ev.projectName})</span> : null}
                        {ev.type === 'task' && renderTaskMeta(ev)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

