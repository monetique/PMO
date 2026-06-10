import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import ProjetPilotageAgile from '../components/ProjetPilotageAgile';
import { PvReunionsLieesBlock } from '../components/PvReunionsLieesBlock';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { DocumentAccesNatifModal } from '../components/DocumentAccesNatifModal';
import { isNativeAuthorControlledUploadDoc as isNativeProjetUploadDoc } from '../utils/documentNativeAcces';
import { ProjetAccesModal } from '../components/ProjetAccesModal';
import { api, API_BASE_URL } from '../services/api';
import { useAuth } from '../store/auth';

const STATUS_COLORS: Record<string, string> = {
  'en_preparation': 'bg-yellow-100 text-yellow-800',
  'en_cours': 'bg-blue-100 text-blue-800',
  'termine': 'bg-green-100 text-green-800',
  'en_pause': 'bg-gray-100 text-gray-800',
  'archive': 'bg-purple-100 text-purple-800',
};
const STATUS_LABELS: Record<string, string> = {
  'en_preparation': 'En préparation',
  'en_cours': 'En cours',
  'termine': 'Terminé',
  'en_pause': 'En pause',
  'archive': 'Archivé',
};
const PRIORITY_COLORS: Record<string, string> = {
  'haute': 'bg-red-100 text-red-800',
  'moyenne': 'bg-orange-100 text-orange-800',
  'basse': 'bg-green-100 text-green-800',
};

const TACHE_STATUT_LABELS: Record<string, string> = {
  cree: 'Créée',
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  bloque: 'Bloquée',
  termine: 'Terminée',
  archive: 'Archivée',
};

type ProjetScoringResponse = {
  meta: {
    projetId: string;
    generatedAt: string;
    totalTaches: number;
    totalUtilisateurs: number;
    totalEntites: number;
  };
  settings: {
    weights: { delais: number; workflow: number; stabilite: number; rework: number; flux: number };
    productivityWindowDays: number;
  };
  taskScores: Array<{
    id: string;
    nom: string;
    statut: string;
    assignes: Array<{ id: string; nom: string; prenom: string }>;
    entites: Array<{ id: string; nom: string; code?: string | null }>;
    scoring: {
      delais: number;
      workflow: number;
      stabilite: number;
      rework: number;
      flux: number;
      final: number;
      transitions: number;
      reouvertures: number;
      completedAt?: string | null;
    };
  }>;
  userScores: Array<{
    user: { id: string; nom: string; prenom: string };
    scores: { moyenneTaches: number; productivite: number; final: number };
    metrics: { tachesAssignees: number; tachesTermineesPeriode: number; periodeJours: number };
  }>;
  entityScores: Array<{
    entite: { id: string; nom: string; code?: string | null };
    scores: { final: number };
    metrics: { utilisateursPrisEnCompte: number };
  }>;
};

function scoringBadgeClass(score: number): string {
  if (score >= 4.5) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (score >= 3.5) return 'bg-green-100 text-green-800 border-green-200';
  if (score >= 2.5) return 'bg-amber-100 text-amber-800 border-amber-200';
  if (score >= 1.5) return 'bg-orange-100 text-orange-800 border-orange-200';
  return 'bg-red-100 text-red-800 border-red-200';
}

const LABEL_PERM_ROW: Record<string, string> = {
  lecture: 'lecture',
  modification: 'modification',
  suppression: 'suppression',
  gestion: 'gestion des droits',
};

const droitsAdminLigne = 'modification + suppression + gestion des accès + lecture';

const LABEL_PERM_MODAL_PROJET: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des droits',
};

function projetPermissionsForAdminLinesDetail(perms: any[]) {
  const m = new Map<string, { userId: string; niveau: string; user?: any }>();
  for (const d of perms || []) {
    const uid = d.user?.id;
    if (!uid) continue;
    const ex = m.get(uid);
    const part = LABEL_PERM_MODAL_PROJET[d.permission] || d.permission;
    m.set(uid, {
      userId: uid,
      niveau: ex ? `${ex.niveau} + ${part}` : part,
      user: d.user,
    });
  }
  return Array.from(m.values());
}

const DROITS_ADMIN_DOC_PROJET_NATIF =
  'visualisation, modification statut, accès, suppression (admin non exclu de la pièce)';

const PMO_DOCUMENTS_ACCES_CHANGED = 'pmo-documents-acces-changed';

function notifyDocumentsListAccesSync() {
  try {
    window.dispatchEvent(new CustomEvent(PMO_DOCUMENTS_ACCES_CHANGED));
  } catch {
    /* ignore */
  }
}

function permSummaryLine(perms: string[]) {
  return perms.map((p) => LABEL_PERM_ROW[p] || p).join(' + ');
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string): boolean {
  const t = s.trim();
  if (!ISO_DATE_RE.test(t)) return false;
  const d = new Date(`${t}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

function formatMontantBudgetFr(v: unknown): string {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Saisie libre AAAA-MM-JJ + bouton ouvrant le sélecteur natif (showPicker / click). */
function ProjetDateField({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const iso = value.trim();
  const pickerValue = ISO_DATE_RE.test(iso) ? iso : '';

  const openPicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        // certains navigateurs exigent un geste utilisateur strict
      }
    }
    el.click();
  };

  return (
    <div className="flex gap-2 items-stretch">
      <input
        id={id}
        type="text"
        className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
        placeholder="AAAA-MM-JJ"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="shrink-0 flex items-center justify-center min-w-[2.75rem] px-2 py-2 border border-gray-300 rounded-md text-sm bg-gray-50 hover:bg-gray-100"
        title="Calendrier"
        aria-label="Ouvrir le calendrier"
        onClick={openPicker}
      >
        <span aria-hidden>📅</span>
      </button>
      <input
        ref={dateInputRef}
        type="date"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        value={pickerValue}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function isAccesRestreintProjet(p: any) {
  return !!p.createdById || (p.accesApercu?.delegations?.length ?? 0) > 0;
}

function getClientLabel(p: any): string {
  const n = typeof p.nomClient === 'string' ? p.nomClient.trim() : '';
  if (n) return n;
  const cfs = p.clientsFournisseurs;
  if (Array.isArray(cfs) && cfs.length > 0) {
    const nom = cfs[0]?.clientFournisseur?.nom;
    if (nom) return nom;
  }
  return '— (sans client)';
}

const PARTIES_PRENANTES_OPTIONS = [
  'Clients', 'Partenaires', 'Fournisseurs', 'Prestataires',
  'Utilisateurs finaux', 'Autorités réglementaires'
];

type UserOption = { id: string; nom: string; prenom: string; role?: string; email?: string; statut?: string };

type HabilitatorRow = { id: string; line: string; email?: string };

function collectHabilitatorsForProjetAccess(p: any | null, usersList: any[]): HabilitatorRow[] {
  const out: HabilitatorRow[] = [];
  const seen = new Set<string>();
  const add = (u: any | null | undefined, role: string) => {
    if (!u?.id || seen.has(u.id)) return;
    seen.add(u.id);
    const mail = u.email ? ` — ${u.email}` : '';
    out.push({
      id: u.id,
      line: `${u.prenom} ${u.nom}${mail} (${role})`,
      email: u.email,
    });
  };
  (usersList || []).forEach((u: any) => {
    if (u.role === 'admin' && (!u.statut || u.statut === 'actif')) {
      add(u, 'administrateur');
    }
  });
  if (p?.createdBy) add(p.createdBy, 'créateur du projet');
  if (p?.responsable) add(p.responsable, 'responsable du projet');
  if (p?.gestionnaire) add(p.gestionnaire, 'gestionnaire du projet');
  (p?.sponsors || []).forEach((s: any) => add(s.user || s, 'sponsor'));
  (p?.chefsProjet || []).forEach((s: any) => add(s.user || s, 'chef de projet'));
  (p?.techLeads || []).forEach((s: any) => add(s.user || s, 'tech lead'));
  (p?.equipe || []).forEach((s: any) => add(s.user || s, "membre d'équipe projet"));
  (p?.permissions || []).forEach((perm: any) => {
    if (perm.permission === 'gestion' && perm.user) {
      add(perm.user, 'gestion des accès sur le projet');
    }
  });
  return out;
}

function collectHabilitatorsForProjetDocumentAccess(
  p: any | null,
  usersList: any[],
  doc: any | null
): HabilitatorRow[] {
  const rows = collectHabilitatorsForProjetAccess(p, usersList);
  const seen = new Set(rows.map((r) => r.id));
  const u = doc?.uploadedBy;
  if (u?.id && !seen.has(u.id)) {
    const mail = u.email ? ` — ${u.email}` : '';
    rows.push({
      id: u.id,
      line: `${u.prenom} ${u.nom}${mail} (auteur du document — peut ajuster la liste d'accès)`,
      email: u.email,
    });
  }
  return rows;
}

function relationUserIds(rel: any[] | undefined): string[] {
  if (!rel?.length) return [];
  return rel.map((x: any) => x.userId ?? x.user?.id ?? x.id).filter(Boolean);
}

const PROJ_PERM_LABELS: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des accès',
};

type ProjetDelegRow = { key: string; userId?: string; nom: string; label: string };

function projetAccesDelegationsRows(p: any): ProjetDelegRow[] {
  const d = p?.accesApercu?.delegations;
  if (d?.length) {
    return d.map((row: any) => ({
      key: `${row.user?.id}-${(row.permissions || []).join(',')}`,
      userId: row.user?.id,
      nom: row.user ? `${row.user.prenom} ${row.user.nom}` : '—',
      label: (row.permissions || []).map((x: string) => PROJ_PERM_LABELS[x] || x).join(' + '),
    }));
  }
  const permsList = Array.isArray(p?.permissions) ? p.permissions : [];
  return permsList.map((perm: any) => ({
    key: perm.id,
    userId: perm.userId ?? perm.user?.id,
    nom: perm.user ? `${perm.user.prenom} ${perm.user.nom}` : '—',
    label: PROJ_PERM_LABELS[perm.permission] || perm.permission,
  }));
}

type ProjetRecapUserRow = { userId: string; utilisateur: string; roles: string };

const DROITS_ADMIN_FICHE_PROJET =
  'consultation, modification, suppression et gestion des accès sur la fiche projet';

function buildProjetRecapProjetsRows(
  p: any,
  delegRows: ProjetDelegRow[],
  usersList: any[],
  droitsAdmin: string
): ProjetRecapUserRow[] {
  const byId = new Map<string, { utilisateur: string; roles: Set<string> }>();

  const add = (userId: string | undefined, utilisateur: string, roleLine: string) => {
    if (!userId) return;
    if (!byId.has(userId)) {
      byId.set(userId, { utilisateur: utilisateur || '—', roles: new Set() });
    }
    byId.get(userId)!.roles.add(roleLine);
    if (utilisateur && utilisateur !== '—') {
      byId.get(userId)!.utilisateur = utilisateur;
    }
  };

  const excludedProj = new Set(p?.adminSansAccesUserIds ?? []);
  const permByUserIdProj = new Map(
    projetPermissionsForAdminLinesDetail(p?.permissions || []).map((x) => [x.userId, x]),
  );

  (usersList || [])
    .filter((u: any) => u.role === 'admin' && (!u.statut || u.statut === 'actif'))
    .forEach((a: any) => {
      const creatorId = p?.createdById || p?.createdBy?.id;
      const isCreator = creatorId === a.id;
      const perm = permByUserIdProj.get(a.id);
      const adminExclu = excludedProj.has(a.id) && !perm;
      const adminLimite = !!perm && !isCreator;
      const roleLine = isCreator
        ? `Administrateur et créateur : ${droitsAdmin}`
        : adminExclu
          ? 'Administrateur : aucun accès (exclu)'
          : adminLimite
            ? `Administrateur : accès limité — ${perm.niveau}`
            : `Administrateur applicatif : ${droitsAdmin}`;
      add(a.id, `${a.prenom} ${a.nom}`, roleLine);
    });

  if (p?.createdBy && (p.createdById || p.createdBy.id)) {
    const cid = p.createdById || p.createdBy.id;
    if (!byId.has(cid)) {
      add(cid, `${p.createdBy.prenom} ${p.createdBy.nom}`, `Créateur du projet : ${droitsAdmin}`);
    }
  }

  if (p?.responsable?.id) {
    add(
      p.responsable.id,
      `${p.responsable.prenom} ${p.responsable.nom}`,
      'Responsable projet (gouvernance fiche et documents)'
    );
  }
  if (p?.gestionnaire?.id) {
    add(
      p.gestionnaire.id,
      `${p.gestionnaire.prenom} ${p.gestionnaire.nom}`,
      'Gestionnaire projet (gouvernance fiche et documents)'
    );
  }
  (p?.sponsors || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Sponsor');
  });
  (p?.chefsProjet || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Chef de projet');
  });
  (p?.techLeads || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Tech lead');
  });
  (p?.equipe || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, "Membre d'équipe projet");
  });

  delegRows.forEach((r) => {
    if (!r.userId) return;
    add(r.userId, r.nom, `Droit délégué sur le projet : ${r.label}`);
  });

  return Array.from(byId.entries())
    .map(([userId, v]) => ({
      userId,
      utilisateur: v.utilisateur,
      roles: Array.from(v.roles).join(' ; '),
    }))
    .sort((a, b) => a.utilisateur.localeCompare(b.utilisateur, 'fr'));
}

type ProjetDocRecapRow = { id: string; nom: string; role: string };

function buildProjetDocumentAccessRecapRows(doc: any, p: any | null, usersList: any[]): ProjetDocRecapRow[] {
  const map = new Map<string, { nom: string; role: string }>();
  const setRow = (userId: string | undefined, nom: string, role: string) => {
    if (!userId) return;
    const prev = map.get(userId);
    if (prev) {
      map.set(userId, { nom, role: `${prev.role} ; ${role}` });
    } else {
      map.set(userId, { nom, role });
    }
  };

  if (doc.estConfidentiel && isNativeProjetUploadDoc(doc)) {
    const excluded = new Set(doc.adminSansAccesUserIds || []);
    const permIds = new Set(
      (doc.permissionsUtilisateurs || []).map((x: any) => x.userId || x.user?.id).filter(Boolean)
    );
    (usersList || [])
      .filter((u: any) => u.role === 'admin' && (!u.statut || u.statut === 'actif'))
      .forEach((a: any) => {
        const isAuthor = doc.uploadedById === a.id;
        const hasPerm = permIds.has(a.id);
        if (isAuthor) {
          setRow(a.id, `${a.prenom} ${a.nom}`, 'Auteur du document : tous les droits sur la pièce');
        } else if (excluded.has(a.id) && !hasPerm) {
          setRow(a.id, `${a.prenom} ${a.nom}`, 'Admin : aucun accès (exclu par auteur)');
        } else if (hasPerm) {
          setRow(a.id, `${a.prenom} ${a.nom}`, 'Admin : accès limité — lecture (liste explicite)');
        } else {
          setRow(a.id, `${a.prenom} ${a.nom}`, `Admin : ${DROITS_ADMIN_DOC_PROJET_NATIF}`);
        }
      });
    (doc.permissionsUtilisateurs || []).forEach((perm: any) => {
      const uid = perm.user?.id;
      if (!uid || perm.user?.role === 'admin') return;
      setRow(uid, `${perm.user.prenom} ${perm.user.nom}`, 'Accès explicite : lecture');
    });
    if (doc.uploadedBy?.id && !map.has(doc.uploadedBy.id)) {
      setRow(
        doc.uploadedBy.id,
        `${doc.uploadedBy.prenom} ${doc.uploadedBy.nom}`,
        'Auteur du document : tous les droits sur la pièce'
      );
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, nom: v.nom, role: v.role }))
      .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  const adminDoc = 'Admin : modification statut + accès + lecture';
  (usersList || []).forEach((u: any) => {
    if (u.role === 'admin' && (!u.statut || u.statut === 'actif')) {
      setRow(u.id, `${u.prenom} ${u.nom}`, adminDoc);
    }
  });
  if (doc.uploadedBy?.id) {
    setRow(
      doc.uploadedBy.id,
      `${doc.uploadedBy.prenom} ${doc.uploadedBy.nom}`,
      'Uploadeur : modification statut + accès + lecture'
    );
  }
  if (p?.createdBy?.id) {
    setRow(
      p.createdBy.id,
      `${p.createdBy.prenom} ${p.createdBy.nom}`,
      'Créateur projet : modification statut + accès + lecture'
    );
  }
  if (doc.estConfidentiel) {
    (doc.permissionsUtilisateurs || []).forEach((perm: any) => {
      if (perm.user?.id) {
        setRow(
          perm.user.id,
          `${perm.user.prenom} ${perm.user.nom}`,
          'Accès explicite : lecture (document confidentiel)'
        );
      }
    });
  } else {
    (p?.chefsProjet || []).forEach((s: any) => {
      const u = s.user || s;
      if (u?.id) setRow(u.id, `${u.prenom} ${u.nom}`, 'Chef de projet : modification statut + lecture');
    });
    if (p?.responsable?.id) {
      setRow(
        p.responsable.id,
        `${p.responsable.prenom} ${p.responsable.nom}`,
        'Responsable : lecture'
      );
    }
    if (p?.gestionnaire?.id) {
      setRow(
        p.gestionnaire.id,
        `${p.gestionnaire.prenom} ${p.gestionnaire.nom}`,
        'Gestionnaire : lecture'
      );
    }
    (p?.sponsors || []).forEach((s: any) => {
      const u = s.user || s;
      if (u?.id) setRow(u.id, `${u.prenom} ${u.nom}`, 'Sponsor : lecture');
    });
    (p?.techLeads || []).forEach((s: any) => {
      const u = s.user || s;
      if (u?.id) setRow(u.id, `${u.prenom} ${u.nom}`, 'Tech Lead : lecture');
    });
    (p?.equipe || []).forEach((s: any) => {
      const u = s.user || s;
      if (u?.id) setRow(u.id, `${u.prenom} ${u.nom}`, 'Équipe : lecture');
    });
  }

  return Array.from(map.entries())
    .map(([id, v]) => ({ id, nom: v.nom, role: v.role }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function buildProjetTachesRecapRows(p: any, usersList: any[], taches: any[]): ProjetRecapUserRow[] {
  const byId = new Map<string, { utilisateur: string; roles: Set<string> }>();
  const add = (userId: string | undefined, utilisateur: string, roleLine: string) => {
    if (!userId) return;
    if (!byId.has(userId)) {
      byId.set(userId, { utilisateur: utilisateur || '—', roles: new Set() });
    }
    byId.get(userId)!.roles.add(roleLine);
    if (utilisateur && utilisateur !== '—') {
      byId.get(userId)!.utilisateur = utilisateur;
    }
  };

  (usersList || [])
    .filter((u: any) => u.role === 'admin' && (!u.statut || u.statut === 'actif'))
    .forEach((a: any) => {
      add(
        a.id,
        `${a.prenom} ${a.nom}`,
        'Voit toutes les tâches du projet ; création et modification des tâches réservées aux rôles autorisés sur l’écran Tâches'
      );
    });

  if (p?.createdBy && (p.createdById || p.createdBy.id)) {
    const u = p.createdBy;
    add(u.id, `${u.prenom} ${u.nom}`, 'Gouvernance : voit toutes les tâches du projet');
  }
  if (p?.responsable?.id) {
    add(
      p.responsable.id,
      `${p.responsable.prenom} ${p.responsable.nom}`,
      'Gouvernance : voit toutes les tâches du projet'
    );
  }
  if (p?.gestionnaire?.id) {
    add(
      p.gestionnaire.id,
      `${p.gestionnaire.prenom} ${p.gestionnaire.nom}`,
      'Gouvernance : voit toutes les tâches du projet'
    );
  }
  (p?.sponsors || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Gouvernance : voit toutes les tâches du projet');
  });
  (p?.chefsProjet || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Gouvernance : voit toutes les tâches du projet');
  });
  (p?.techLeads || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Gouvernance : voit toutes les tâches du projet');
  });
  (p?.equipe || []).forEach((s: any) => {
    const u = s.user || s;
    if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Gouvernance : voit toutes les tâches du projet');
  });

  (p?.permissions || []).forEach((perm: any) => {
    const u = perm.user;
    if (u?.id) {
      add(
        u.id,
        `${u.prenom} ${u.nom}`,
        `Droit délégué projet (${PROJ_PERM_LABELS[perm.permission] || perm.permission}) : visibilité des tâches limitée aux tâches dont il est créateur, assigné ou membre d’entité assignée`
      );
    }
  });

  for (const t of taches || []) {
    const c = t.createur;
    if (c?.id) {
      add(c.id, `${c.prenom} ${c.nom}`, 'Créateur d’au moins une tâche sur ce projet');
    }
    for (const u of t.assignesUtilisateurs || []) {
      if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Assigné utilisateur sur une ou plusieurs tâches');
    }
    for (const ent of t.assignesEntites || []) {
      const membres = ent.membres || [];
      for (const m of membres) {
        const u = m.user || m;
        if (u?.id) {
          add(
            u.id,
            `${u.prenom} ${u.nom}`,
            'Membre d’une entité assignée à une ou plusieurs tâches'
          );
        }
      }
    }
  }

  return Array.from(byId.entries())
    .map(([userId, v]) => ({
      userId,
      utilisateur: v.utilisateur,
      roles: Array.from(v.roles).join(' ; '),
    }))
    .sort((a, b) => a.utilisateur.localeCompare(b.utilisateur, 'fr'));
}

function ProjetCollapsibleSection({
  open,
  onToggle,
  title,
  children,
  className = '',
  id,
}: {
  open: boolean;
  onToggle: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Classes sur le conteneur externe (ex. print:hidden) */
  className?: string;
  /** Ancre pour navigation / scroll (ex. pilotage-agile) */
  id?: string;
}) {
  return (
    <div id={id} className={`bg-white rounded-lg shadow overflow-hidden ${className}`.trim()}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-5 py-4 flex justify-between items-center text-left hover:bg-gray-50 gap-2"
      >
        <span className="text-lg font-semibold flex items-center gap-2 min-w-0 text-gray-800">{title}</span>
        <span className="text-gray-400 shrink-0 text-sm" aria-hidden>
          {open ? '▼' : '▶'}
        </span>
      </button>
      <div
        className={`projet-detail-section-panel border-t border-gray-100 px-5 pb-5 pt-4 ${open ? '' : 'hidden'}`}
      >
        {children}
      </div>
    </div>
  );
}

export default function ProjetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser } = useAuth();
  const [showAccesModal, setShowAccesModal] = useState(false);
  const [acceDoc, setAcceDoc] = useState<any>(null);
  const [acceEstConfidentiel, setAcceEstConfidentiel] = useState(false);
  const [accePermissionUserIds, setAccePermissionUserIds] = useState<string[]>([]);
  const [showDocAccesContratModal, setShowDocAccesContratModal] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const [projet, setProjet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [devises, setDevises] = useState<{ id: string; code: string; libelle?: string | null }[]>([]);

  // Form state
  const [form, setForm] = useState<any>({});
  // Stakeholders with names
  const [partiesPrenantes, setPartiesPrenantes] = useState<{ type: string; nom: string }[]>([]);
  const [clientsFournisseurs, setClientsFournisseurs] = useState<any[]>([]);
  const [newPartieCFId, setNewPartieCFId] = useState('');
  const [expandedCfLiesIds, setExpandedCfLiesIds] = useState<Set<string>>(() => new Set());
  const toggleCfLieRow = (cfId: string) => {
    setExpandedCfLiesIds((prev) => {
      const next = new Set(prev);
      if (next.has(cfId)) next.delete(cfId);
      else next.add(cfId);
      return next;
    });
  };
  const isCfLieRowExpanded = (cfId: string) => expandedCfLiesIds.has(cfId);
  const [newPartie, setNewPartie] = useState({ type: 'Clients', nom: '' });
  // KPIs
  const [kpis, setKpis] = useState<string[]>([]);
  const [newKpi, setNewKpi] = useState('');
  // Objectifs
  const [objectifsStrategiques, setObjectifsStrategiques] = useState<string[]>([]);
  const [newObjStrat, setNewObjStrat] = useState('');
  const [objectifsOperationnels, setObjectifsOperationnels] = useState<string[]>([]);
  const [newObjOp, setNewObjOp] = useState('');
  // Documents
  const [documents, setDocuments] = useState<any[]>([]);
  const [tachesProjet, setTachesProjet] = useState<any[]>([]);
  const [projetScoring, setProjetScoring] = useState<ProjetScoringResponse | null>(null);
  const [loadingScoring, setLoadingScoring] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [selectedScoringUserId, setSelectedScoringUserId] = useState<string | null>(null);
  const [selectedScoringEntiteId, setSelectedScoringEntiteId] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showLierModal, setShowLierModal] = useState(false);
  const [allDocuments, setAllDocuments] = useState<any[]>([]);
  const [searchDoc, setSearchDoc] = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadNom, setUploadNom] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadEstConfidentiel, setUploadEstConfidentiel] = useState(true);
  const [uploadPermissionUserIds, setUploadPermissionUserIds] = useState<string[]>([]);
  const [viewingDocument, setViewingDocument] = useState<any>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [accessBlockedModal, setAccessBlockedModal] = useState<{
    context: 'projet' | 'document';
    documentLabel?: string;
    documentRef?: any;
  } | null>(null);
  const [accesModalProjetDetail, setAccesModalProjetDetail] = useState<{ id: string; nom: string } | null>(null);

  const [secInfos, setSecInfos] = useState(false);
  const [secGouvernance, setSecGouvernance] = useState(false);
  const [secContexte, setSecContexte] = useState(false);
  const [secObjectifs, setSecObjectifs] = useState(false);
  const [secDocuments, setSecDocuments] = useState(false);
  const [secPvReunion, setSecPvReunion] = useState(false);
  const [secPilotage, setSecPilotage] = useState(false);
  const [secScoring, setSecScoring] = useState(false);
  const [secRecap, setSecRecap] = useState(false);

  useEffect(() => {
    loadProjet();
    loadUsers();
    loadDocuments();
    loadClientsFournisseurs();
    (async () => {
      try {
        const r = await api.get('/devises');
        setDevises(Array.isArray(r.data) ? r.data : []);
      } catch {
        setDevises([]);
      }
    })();
  }, [id]);

  const refreshTachesProjet = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get('/taches', { params: { projetId: id } });
      setTachesProjet(r.data || []);
    } catch (e) {
      console.error('Erreur chargement tâches projet:', e);
      setTachesProjet([]);
    }
  }, [id]);

  const loadProjetScoring = useCallback(async () => {
    if (!id) return;
    setLoadingScoring(true);
    setScoringError(null);
    try {
      const r = await api.get(`/projets/${id}/scoring`);
      setProjetScoring(r.data || null);
    } catch (e: any) {
      setProjetScoring(null);
      setScoringError(e?.response?.data?.error || 'Impossible de charger le scoring.');
    } finally {
      setLoadingScoring(false);
    }
  }, [id]);

  useEffect(() => {
    void refreshTachesProjet();
  }, [refreshTachesProjet]);

  useEffect(() => {
    void loadProjetScoring();
  }, [loadProjetScoring]);

  useEffect(() => {
    const st = location.state as { openEdit?: boolean } | null;
    if (st?.openEdit) {
      setEditing(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  /** Ouvre la section Pilotage & agile et fait défiler jusqu’à elle (#pilotage-agile). */
  useEffect(() => {
    if (location.hash !== '#pilotage-agile' || loading) return;
    setSecPilotage(true);
    const t = window.setTimeout(() => {
      document.getElementById('pilotage-agile')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 280);
    return () => window.clearTimeout(t);
  }, [location.hash, loading, id]);

  const loadProjet = async () => {
    try {
      const response = await api.get(`/projets/${id}`);
      const p = response.data;
      setProjet(p);
      setForm({
        nom: p.nom || '',
        type: p.type || 'interne',
        nomClient: p.nomClient || '',
        dateDebut: p.dateDebut ? p.dateDebut.substring(0, 10) : '',
        dateFinPrevue: p.dateFinPrevue ? p.dateFinPrevue.substring(0, 10) : '',
        statut: p.statut || 'en_preparation',
        priorite: p.priorite || 'moyenne',
        sponsorIds: relationUserIds(p.sponsors),
        chefProjetIds: relationUserIds(p.chefsProjet),
        techLeadIds: relationUserIds(p.techLeads),
        equipeIds: relationUserIds(p.equipe),
        contexte: p.contexte || '',
        mission: p.mission || '',
        vision: p.vision || '',
        scopeInclus: p.scopeInclus || '',
        scopeExclus: p.scopeExclus || '',
        budgetPrevu:
          p.budgetPrevu != null && p.budgetPrevu !== ''
            ? String(p.budgetPrevu).replace(/,/g, '.')
            : '',
        budgetConsomme:
          p.budgetConsomme != null && p.budgetConsomme !== ''
            ? String(p.budgetConsomme).replace(/,/g, '.')
            : '',
        deviseId: p.deviseId || p.devise?.id || '',
      });
      setPartiesPrenantes(p.partiesPrenantes || []);
      setKpis(p.kpis || []);
      setObjectifsStrategiques(p.objectifsStrategiques || []);
      setObjectifsOperationnels(p.objectifsOperationnels || []);
    } catch (err) {
      console.error('Erreur:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (err) {
      console.error('Erreur chargement users:', err);
    }
  };
  const loadDocuments = async () => {
    try {
      const response = await api.get('/documents', { params: { referenceType: 'projet', referenceId: id } });
      setDocuments(response.data);
    } catch (err) {
      console.error('Erreur chargement documents:', err);
    }
  };
  const loadClientsFournisseurs = async () => {
    try {
      const r = await api.get("/clients-fournisseurs");
      setClientsFournisseurs(r.data);
    } catch (err) { console.error(err); }
  };

  const isProjetGovernanceMember = (uid: string | undefined): boolean => {
    if (!uid || !projet) return false;
    if (projet.createdById === uid) return true;
    if (projet.responsableId === uid || projet.gestionnaireId === uid) return true;
    const collect = (arr: any[]) =>
      (arr || []).map((s: any) => s.userId ?? s.user?.id).filter(Boolean);
    return [
      ...collect(projet.sponsors),
      ...collect(projet.chefsProjet),
      ...collect(projet.techLeads),
      ...collect(projet.equipe),
    ].includes(uid);
  };

  const hasProjetViewForDocuments = (): boolean => {
    if (!currentUser || !projet) return false;
    if (projet.capabilities?.canView != null) return !!projet.capabilities.canView;
    if (currentUser.role === 'admin') return true;
    if (projet.createdById === currentUser.id) return true;
    if (projet.createdById == null) return true;
    if (isProjetGovernanceMember(currentUser.id)) return true;
    return Array.isArray(projet.permissions) && projet.permissions.some((perm: any) => perm.userId === currentUser.id);
  };

  const whyCannotAccessDocument = (doc: any): 'ok' | 'projet' | 'document' => {
    if (!hasProjetViewForDocuments()) return 'projet';
    if (!doc.estConfidentiel) return 'ok';
    const uid = currentUser?.id;
    if (!uid) return 'document';

    if (isNativeProjetUploadDoc(doc)) {
      if (doc.uploadedById === uid) return 'ok';
      if (doc.permissionsUtilisateurs?.some((p: any) => p.userId === uid || p.user?.id === uid)) {
        return 'ok';
      }
      if (currentUser?.role === 'admin') {
        const excluded = doc.adminSansAccesUserIds || [];
        if (!excluded.includes(uid)) return 'ok';
      }
      return 'document';
    }

    if (doc.uploadedById === uid) return 'ok';
    if (
      projet &&
      (projet.createdById === uid || projet.responsableId === uid || projet.gestionnaireId === uid)
    ) {
      return 'ok';
    }
    if (isProjetGovernanceMember(uid)) return 'ok';
    if (
      doc.permissionsUtilisateurs?.some((p: any) => p.userId === uid || p.user?.id === uid)
    ) {
      return 'ok';
    }
    return 'document';
  };

  const openProjetDocumentAccessDenied = (context: 'projet' | 'document', doc?: any) => {
    setAccessBlockedModal({
      context,
      documentLabel: doc?.nom,
      documentRef: doc,
    });
  };

  const handleUploadDocument = async () => {
    if (uploadFiles.length === 0) { alert('Veuillez sélectionner un fichier'); return; }
    setUploading(true);
    try {
      await Promise.all(uploadFiles.map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('nom', uploadNom || file.name);
        formData.append('typeDocument', 'projet');
        formData.append('referenceType', 'projet');
        formData.append('referenceId', id!);
        formData.append('description', uploadDescription);
        formData.append('estConfidentiel', uploadEstConfidentiel.toString());
        if (uploadEstConfidentiel && uploadPermissionUserIds.length > 0) {
          uploadPermissionUserIds.forEach(uid => formData.append('permissionUserIds', uid));
        }
        formData.append('versionMajeure', '1');
        formData.append('versionMineure', '0');
        formData.append('versionPatch', '0');
        return api.post('/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      }));
      setShowUploadModal(false);
      setUploadFiles([]);
      setUploadNom('');
      setUploadDescription('');
      setUploadEstConfidentiel(false);
      setUploadPermissionUserIds([]);
      await loadDocuments();
      if (!editing) await loadProjet();
    } catch (err) {
      console.error('Erreur upload:', err);
      alert('Erreur lors de l\'upload');
    } finally {
      setUploading(false);
    }
  };
  const handleViewDocument = async (doc: any) => {
    const why = whyCannotAccessDocument(doc);
    if (why !== 'ok') {
      openProjetDocumentAccessDenied(why, doc);
      return;
    }
    try {
      const response = await api.get(`/documents/${doc.id}/view`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      setDocumentUrl(url);
      setViewingDocument(doc);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        openProjetDocumentAccessDenied('document', doc);
      } else {
        alert(
          'Fichier introuvable sur le serveur. Il a peut-être été supprimé ou uploadé dans un ancien environnement. Veuillez ré-uploader le document.'
        );
      }
    }
  };
  const closeViewer = () => {
    if (documentUrl) URL.revokeObjectURL(documentUrl);
    setDocumentUrl(null);
    setViewingDocument(null);
  };
  const handleDeleteDocument = async (docId: string, docNom: string) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer "${docNom}" ?`)) return;
    try {
      await api.delete(`/documents/${docId}`);
      await loadDocuments();
      if (!editing) await loadProjet();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression');
    }
  };
  const handleDownload = async (doc: any) => {
    const why = whyCannotAccessDocument(doc);
    if (why !== 'ok') {
      openProjetDocumentAccessDenied(why, doc);
      return;
    }
    try {
      const response = await api.get(`/documents/${doc.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', doc.fichierNomOriginal || doc.nom);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      if (err?.response?.status === 403) {
        openProjetDocumentAccessDenied('document', doc);
      } else {
        alert('Erreur lors du téléchargement');
      }
    }
  };
  const loadAllDocuments = async () => {
    try {
      const response = await api.get('/documents');
      setAllDocuments(response.data);
    } catch (err) {
      console.error('Erreur chargement documents:', err);
    }
  };
  const handleOpenLierModal = async () => {
    await loadAllDocuments();
    setSelectedDocIds([]);
    setSearchDoc('');
    setShowLierModal(true);
  };
  const handleToggleDoc = (docId: string) => {
    setSelectedDocIds(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  };
  const handleLierDocuments = async () => {
    try {
      await Promise.all(selectedDocIds.map(docId =>
        api.put(`/documents/${docId}`, { referenceType: 'projet', referenceId: id })
      ));
      setShowLierModal(false);
      setSelectedDocIds([]);
      await loadDocuments();
      if (!editing) await loadProjet();
    } catch (err) {
      alert('Erreur lors de la liaison des documents');
    }
  };
  const handleDelierDocument = async (docId: string, docNom: string) => {
    if (!confirm(`Délier le document "${docNom}" de ce projet ?`)) return;
    try {
      await api.put(`/documents/${docId}`, { referenceType: null, referenceId: null, typeDocument: 'general' });
      await loadDocuments();
      if (!editing) await loadProjet();
    } catch (err) {
      alert('Erreur lors de la déliaison du document');
    }
  };
  const canModifierAcces = (doc: any) => {
    if (!currentUser) return false;
    if (isNativeProjetUploadDoc(doc)) {
      return doc.uploadedById === currentUser.id;
    }
    if (currentUser.role === 'admin') return true;
    if (projet && projet.createdById === currentUser.id) return true;
    if (doc.uploadedById === currentUser.id) return true;
    const chefIds = (projet?.chefsProjet || []).map((s: any) => s.user?.id || s.id);
    if (chefIds.includes(currentUser.id)) return true;
    return false;
  };
  const canModifierStatut = (doc: any) => {
    if (!currentUser) return false;
    if (isNativeProjetUploadDoc(doc)) {
      if (doc.uploadedById === currentUser.id) return true;
      return !!doc.permissionsUtilisateurs?.some(
        (p: any) => (p.userId || p.user?.id) === currentUser.id
      );
    }
    if (currentUser.role === 'admin') return true;
    if (projet && projet.createdById === currentUser.id) return true;
    if (doc.uploadedById === currentUser.id) return true;
    const chefIds = (projet?.chefsProjet || []).map((s: any) => s.user?.id || s.id);
    if (chefIds.includes(currentUser.id)) return true;
    return false;
  };
  const canSupprimerDocument = (doc: any) => {
    if (!currentUser) return false;
    if (isNativeProjetUploadDoc(doc)) {
      if (doc.uploadedById === currentUser.id) return true;
      return !!doc.permissionsUtilisateurs?.some(
        (p: any) => (p.userId || p.user?.id) === currentUser.id
      );
    }
    return true;
  };
  const handleChangeStatut = async (docId: string, newStatut: string) => {
    try {
      await api.put(`/documents/${docId}`, { statut: newStatut });
      await loadDocuments();
    } catch (err: any) {
      if (err?.response?.status === 403) {
        const d = documents.find((x: any) => x.id === docId);
        openProjetDocumentAccessDenied('document', d);
      } else {
        alert('Erreur lors du changement de statut');
      }
    }
  };
  const handleOpenAccesModal = async (doc: any) => {
    let target = doc;

    // Si le document est rattaché nativement au projet mais pas encore marqué confidentiel,
    // on active le mode "pièce native" pour permettre au créateur de gérer les accès
    // (exclusion / limitation des administrateurs) comme sur la fiche projet.
    const isProjetNativeLink =
      doc?.typeDocument === 'projet' && doc?.referenceType === 'projet' && !!doc?.referenceId;
    if (isProjetNativeLink && !isNativeProjetUploadDoc(doc)) {
      try {
        const existingPermIds = (doc.permissionsUtilisateurs || [])
          .map((p: any) => p.userId || p.user?.id)
          .filter(Boolean);
        const basePermIds =
          existingPermIds.length > 0
            ? existingPermIds
            : currentUser?.id
              ? [currentUser.id]
              : [];

        await api.put(`/documents/${doc.id}`, {
          estConfidentiel: true,
          // Satisfait la validation backend "au moins un utilisateur" pour les documents confidentiels.
          permissionUserIds: basePermIds,
        });
        target = { ...doc, estConfidentiel: true, permissionsUtilisateurs: doc.permissionsUtilisateurs };
        await loadDocuments();
      } catch (err: any) {
        alert(
          err?.response?.data?.error ||
            "Erreur lors de l'activation de la gestion avancée des accès pour ce document"
        );
        return;
      }
    }

    setAcceDoc(target);
    if (isNativeProjetUploadDoc(target)) {
      setShowDocAccesContratModal(true);
      return;
    }
    setAcceEstConfidentiel(target.estConfidentiel || false);
    setAccePermissionUserIds(
      target.permissionsUtilisateurs?.map((p: any) => p.userId || p.user?.id).filter(Boolean) || []
    );
    setShowAccesModal(true);
  };

  const handleSaveAcces = async () => {
    if (!acceDoc) return;
    try {
      await api.put(`/documents/${acceDoc.id}`, {
        estConfidentiel: acceEstConfidentiel,
        permissionUserIds: acceEstConfidentiel ? accePermissionUserIds : [],
      });
      setShowAccesModal(false);
      setAcceDoc(null);
      await loadDocuments();
      notifyDocumentsListAccesSync();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Erreur lors de la modification de l\'accès');
    }
  };

  const handleSave = async () => {
    setError('');
    const dd = (form.dateDebut || '').trim();
    const dfp = (form.dateFinPrevue || '').trim();
    if (!form.nom || !dd || !isValidIsoDate(dd)) {
      setError('Nom et date de début valides (format AAAA-MM-JJ) sont obligatoires');
      return;
    }
    if (dfp && !isValidIsoDate(dfp)) {
      setError('Date de fin prévue : format AAAA-MM-JJ invalide');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/projets/${id}`, {
        nom: form.nom,
        type: form.type,
        nomClient: form.nomClient,
        dateDebut: dd,
        dateFinPrevue: dfp,
        statut: form.statut,
        priorite: form.priorite,
        sponsorIds: form.sponsorIds,
        chefProjetIds: form.chefProjetIds,
        techLeadIds: form.techLeadIds,
        equipeIds: form.equipeIds,
        contexte: form.contexte,
        mission: form.mission,
        vision: form.vision,
        scopeInclus: form.scopeInclus,
        scopeExclus: form.scopeExclus,
        budgetPrevu: (form.budgetPrevu || '').trim() ? form.budgetPrevu : null,
        budgetConsomme: (form.budgetConsomme || '').trim() ? form.budgetConsomme : null,
        deviseId: (form.deviseId || '').trim() || null,
        partiesPrenantes,
        kpis,
        objectifsStrategiques,
        objectifsOperationnels,
      });
      await loadProjet();
      setEditing(false);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Mettre ce projet en corbeille ? Vous pourrez le restaurer ou le supprimer définitivement depuis la corbeille (admin).')) return;
    try {
      await api.delete(`/projets/${id}`);
      navigate('/projets');
    } catch (err) {
      console.error('Erreur suppression:', err);
    }
  };

  const handlePrint = () => { window.print(); };

  const toggleUser = (field: string, userId: string) => {
    const current: string[] = form[field] || [];
    if (current.includes(userId)) {
      setForm({ ...form, [field]: current.filter((id: string) => id !== userId) });
    } else {
      setForm({ ...form, [field]: [...current, userId] });
    }
  };

  const getUserName = (userId: string) => {
    const u = users.find(u => u.id === userId);
    return u ? `${u.prenom} ${u.nom}` : userId;
  };

  const addPartie = () => {
    if (!newPartie.nom.trim()) return;
    setPartiesPrenantes([...partiesPrenantes, { ...newPartie }]);
    setNewPartie({ type: 'Clients', nom: '' });
  };

  const removePartie = (idx: number) => setPartiesPrenantes(partiesPrenantes.filter((_, i) => i !== idx));

  const addKpi = () => {
    if (!newKpi.trim()) return;
    setKpis([...kpis, newKpi.trim()]);
    setNewKpi('');
  };

  const addObjStrat = () => {
    if (!newObjStrat.trim()) return;
    setObjectifsStrategiques([...objectifsStrategiques, newObjStrat.trim()]);
    setNewObjStrat('');
  };

  const addObjOp = () => {
    if (!newObjOp.trim()) return;
    setObjectifsOperationnels([...objectifsOperationnels, newObjOp.trim()]);
    setNewObjOp('');
  };

  // Multi-select user component
  const UserMultiSelect = ({ field, label }: { field: string; label: string }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {editing ? (
        <div className="border border-gray-300 rounded-md max-h-32 overflow-y-auto p-2">
          {users.map(u => (
            <label key={u.id} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-gray-50 px-1 rounded">
              <input
                type="checkbox"
                checked={(form[field] || []).includes(u.id)}
                onChange={() => toggleUser(field, u.id)}
                className="rounded"
              />
              <span className="text-sm">{u.prenom} {u.nom}</span>
            </label>
          ))}
          {users.length === 0 && <p className="text-sm text-gray-400 italic">Aucun utilisateur</p>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 min-h-[32px]">
          {(() => {
            const relKey =
              field === 'sponsorIds'
                ? 'sponsors'
                : field === 'chefProjetIds'
                  ? 'chefsProjet'
                  : field === 'techLeadIds'
                    ? 'techLeads'
                    : 'equipe';
            const rows = (projet[relKey] || []) as any[];
            if (rows.length === 0) {
              return <span className="text-sm text-gray-400 italic">—</span>;
            }
            return rows.map((row: any) => {
              const person = row.user || row;
              const pid = person?.id ?? row.userId ?? row.id;
              const label =
                person?.prenom || person?.nom
                  ? `${person.prenom ?? ''} ${person.nom ?? ''}`.trim()
                  : '—';
              return (
                <span key={pid} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                  {label}
                </span>
              );
            });
          })()}
        </div>
      )}
    </div>
  );

  const Field = ({ label, value, editComponent }: { label: string; value: any; editComponent?: React.ReactNode }) => (
    <div>
      <label className="block text-sm font-medium text-gray-500 mb-1">{label}</label>
      {editing && editComponent ? editComponent : (
        <p className="text-sm text-gray-900">{value || <span className="italic text-gray-400">—</span>}</p>
      )}
    </div>
  );

  const delegRowsProjet = projet ? projetAccesDelegationsRows(projet) : [];
  const recapProjetRows = projet
    ? buildProjetRecapProjetsRows(projet, delegRowsProjet, users, DROITS_ADMIN_FICHE_PROJET)
    : [];
  const recapTachesRows = projet
    ? buildProjetTachesRecapRows(projet, users, tachesProjet)
    : [];
  const scoringEntityUserScores = useMemo(() => {
    if (!projetScoring) return new Map<string, number[]>();
    const userScoreById = new Map(projetScoring.userScores.map((u) => [u.user.id, u.scores.final]));
    const map = new Map<string, number[]>();
    for (const task of projetScoring.taskScores) {
      for (const ent of task.entites || []) {
        if (!map.has(ent.id)) map.set(ent.id, []);
        for (const u of task.assignes || []) {
          const us = userScoreById.get(u.id);
          if (typeof us === 'number') map.get(ent.id)?.push(us);
        }
      }
    }
    return map;
  }, [projetScoring]);
  const selectedScoringUser = projetScoring?.userScores.find((u) => u.user.id === selectedScoringUserId) || null;
  const selectedScoringEntite = projetScoring?.entityScores.find((e) => e.entite.id === selectedScoringEntiteId) || null;

  if (loading) return <div className="p-6">Chargement...</div>;
  if (!projet) return <div className="p-6 text-red-600">Projet introuvable</div>;

  const capDetail = {
    canView: projet.capabilities?.canView !== false,
    canModify: !!projet.capabilities?.canModify,
    canDelete: !!projet.capabilities?.canDelete,
    canManagePermissions: !!projet.capabilities?.canManagePermissions,
  };
  const tr = projet.tachesResume || { total: 0, parStatut: {} as Record<string, number>, enRetard: 0, avancementPct: null as number | null };
  const documentsListeApercu =
    projet.documentsListe?.length > 0
      ? projet.documentsListe
      : documents.map((d: any) => ({ id: d.id, nom: d.nom }));
  const clientLine = getClientLabel(projet);
  const showClientLine = clientLine && clientLine !== '— (sans client)';

  return (
    <>
      {/* Style d'impression */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #print-zone, #print-zone * { visibility: visible !important; }
          #print-zone { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          #print-zone .projet-detail-section-panel { display: block !important; }
        }
      `}</style>

      <div className="p-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6 no-print">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => navigate('/projets')}
              className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1 w-fit"
            >
              ← Retour aux projets
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Projet</h1>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm no-print">{error}</div>}

        {/* Zone imprimable (même disposition carte que la liste Projets) */}
        <div id="print-zone" ref={printRef} className="space-y-4">
          {/* En-tête impression */}
          <div className="hidden print:block mb-6 border-b pb-4">
            <h1 className="text-3xl font-bold">{projet.nom}</h1>
            <div className="flex gap-3 mt-2">
              <span className={`px-2 py-1 text-xs rounded ${STATUS_COLORS[projet.statut] || ''}`}>{STATUS_LABELS[projet.statut]}</span>
              <span className={`px-2 py-1 text-xs rounded capitalize ${PRIORITY_COLORS[projet.priorite] || ''}`}>{projet.priorite}</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">Fiche générée le {new Date().toLocaleDateString('fr-FR')}</p>
          </div>

          {/* Carte récapitulatif (alignée sur une ligne de la page Projets) */}
          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[projet.statut] || 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABELS[projet.statut] || projet.statut}
                  </span>
                  <h2 className="text-lg font-semibold text-gray-900">{projet.nom}</h2>
                  {projet.codeProjet && <span className="text-xs text-gray-500 font-mono">{projet.codeProjet}</span>}
                  <span className={`px-2 py-0.5 rounded text-xs capitalize ${PRIORITY_COLORS[projet.priorite] || 'bg-gray-100 text-gray-700'}`}>
                    {projet.priorite}
                  </span>
                </div>
                {showClientLine && <p className="text-sm text-gray-600 mb-1">Client : {clientLine}</p>}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-gray-600">
                  <div>
                    <span className="font-medium">Début : </span>
                    {projet.dateDebut ? new Date(projet.dateDebut).toLocaleDateString('fr-FR') : '—'}
                  </div>
                  <div>
                    <span className="font-medium">Fin prévue : </span>
                    {projet.dateFinPrevue ? new Date(projet.dateFinPrevue).toLocaleDateString('fr-FR') : '—'}
                  </div>
                  {projet.createdBy && (
                    <div>
                      <span className="font-medium">Créé par : </span>
                      {projet.createdBy.prenom} {projet.createdBy.nom}
                    </div>
                  )}
                  {tr.avancementPct != null && (
                    <div>
                      <span className="font-medium">Avancement tâches : </span>
                      {tr.avancementPct}%
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-semibold text-gray-500 uppercase">Tâches</span>
                  {tr.total === 0 ? (
                    <span className="text-xs text-gray-400">Aucune tâche</span>
                  ) : (
                    <>
                      <span className="text-xs text-gray-700 font-medium">{tr.total} au total</span>
                      {Object.entries(tr.parStatut || {}).map(([st, n]) =>
                        (n as number) > 0 ? (
                          <span key={st} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                            {TACHE_STATUT_LABELS[st] || st} : {n as number}
                          </span>
                        ) : null
                      )}
                    </>
                  )}
                </div>

                {(projet.alertesProjet?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {projet.alertesProjet.map((a: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded text-xs font-medium">
                        ⚠ {a}
                      </span>
                    ))}
                  </div>
                )}

                {documentsListeApercu.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">Documents</p>
                    <div className="flex flex-wrap gap-1">
                      {documentsListeApercu.map((d: { id: string; nom: string }) => (
                        <a
                          key={d.id}
                          href={`${API_BASE_URL}/documents/${d.id}/view?token=${localStorage.getItem('token')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-0.5 bg-gray-100 rounded text-xs text-blue-600 hover:underline"
                        >
                          📎 {d.nom}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                  <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                    {isAccesRestreintProjet(projet) ? (
                      <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                        <span className="text-sm leading-none" aria-hidden>
                          🔒
                        </span>
                        <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">Accès restreint</span>
                      </div>
                    ) : (
                      <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                        <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                      </div>
                    )}
                    <AccessContratLikeAdminLines
                      users={users as any[]}
                      createdById={projet.createdById}
                      createdBy={projet.createdBy}
                      adminSansAccesUserIds={projet.adminSansAccesUserIds}
                      permissions={projetPermissionsForAdminLinesDetail(projet.permissions || [])}
                      droitsAdminCompletLabel={droitsAdminLigne}
                      niveauLabel={(n) => n}
                      keyPrefix={`detail-proj-${projet.id}`}
                      creatorRightsLabel={droitsAdminLigne}
                    />
                    {(projet.accesApercu?.delegations || []).map((d: any) => (
                      <div key={`${d.user?.id}-${(d.permissionEntryIds || []).join('-')}`} className="min-w-0">
                        <span className="font-medium text-gray-900">
                          {d.user.prenom} {d.user.nom}
                        </span>
                        <span className="text-gray-500 italic block sm:inline sm:ml-1">({permSummaryLine(d.permissions || [])})</span>
                      </div>
                    ))}
                    <p className="text-[10px] text-gray-500 w-full basis-full">
                      Aligné sur la liste des projets : exclusion ou droits explicites pour les administrateurs sont visibles
                      ici et gérés via le bouton « Accès » (créateur ou délégation « Gestion des droits »).
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem] no-print">
                <button
                  type="button"
                  onClick={() => {
                    navigate(
                      { pathname: location.pathname, search: location.search, hash: 'pilotage-agile' },
                      { replace: true }
                    );
                  }}
                  className="px-3 py-1.5 text-xs text-center bg-indigo-100 text-indigo-800 rounded hover:bg-indigo-200 font-medium"
                >
                  📊 Pilotage & agile
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                >
                  🖨️ Imprimer
                </button>
                {capDetail.canView && (
                  <button
                    type="button"
                    onClick={() => setAccesModalProjetDetail({ id: projet.id, nom: projet.nom })}
                    className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200 font-medium"
                  >
                    🔐 Accès
                  </button>
                )}
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        void loadProjet();
                      }}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={saving}
                      className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
                    >
                      {saving ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                  </>
                ) : (
                  <>
                    {capDetail.canModify && (
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        ✏️ Modifier
                      </button>
                    )}
                    {capDetail.canDelete && (
                      <button
                        type="button"
                        onClick={() => void handleDelete()}
                        className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                      >
                        🗑 Mettre en corbeille
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ① Informations générales */}
          <ProjetCollapsibleSection
            open={secInfos}
            onToggle={() => setSecInfos((v) => !v)}
            title={
              <>
                <span className="w-7 h-7 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                  1
                </span>
                Informations générales
              </>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <Field
                label="Nom du projet"
                value={projet.nom}
                editComponent={<input type="text" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />}
              />
              <Field
                label="Type de projet"
                value={projet.type}
                editComponent={
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="interne">Interne</option>
                    <option value="client">Client</option>
                    <option value="communautaire">Communautaire</option>
                  </select>
                }
              />
              {(editing ? form.type === 'client' : projet.type === 'client') && (
                <Field
                  label="Nom du client"
                  value={projet.nomClient}
                  editComponent={<input type="text" value={form.nomClient} onChange={(e) => setForm({ ...form, nomClient: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Nom de l'entreprise" />}
                />
              )}
              <Field
                label="Date de début"
                value={projet.dateDebut ? new Date(projet.dateDebut).toLocaleDateString('fr-FR') : '—'}
                editComponent={
                  <ProjetDateField
                    id="projet-date-debut"
                    value={form.dateDebut}
                    onChange={(v) => setForm({ ...form, dateDebut: v })}
                  />
                }
              />
              <Field
                label="Date de fin prévue"
                value={projet.dateFinPrevue ? new Date(projet.dateFinPrevue).toLocaleDateString('fr-FR') : '—'}
                editComponent={
                  <ProjetDateField
                    id="projet-date-fin-prevue"
                    value={form.dateFinPrevue}
                    onChange={(v) => setForm({ ...form, dateFinPrevue: v })}
                  />
                }
              />
              <Field
                label="Statut"
                value={STATUS_LABELS[projet.statut] || projet.statut}
                editComponent={
                  <select value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="en_preparation">En préparation</option>
                    <option value="en_cours">En cours</option>
                    <option value="termine">Terminé</option>
                    <option value="en_pause">En pause</option>
                    <option value="archive">Archivé</option>
                  </select>
                }
              />
              <Field
                label="Priorité"
                value={projet.priorite}
                editComponent={
                  <select value={form.priorite} onChange={(e) => setForm({ ...form, priorite: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="haute">Haute</option>
                    <option value="moyenne">Moyenne</option>
                    <option value="basse">Basse</option>
                  </select>
                }
              />
              <Field
                label="Budget prévu"
                value={
                  (() => {
                    const m = formatMontantBudgetFr(projet.budgetPrevu);
                    const c = projet.devise?.code;
                    if (!m && !c) return null;
                    return [m, c].filter(Boolean).join(' ') || null;
                  })()
                }
                editComponent={
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Facultatif"
                    value={form.budgetPrevu ?? ''}
                    onChange={(e) => setForm({ ...form, budgetPrevu: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                }
              />
              <Field
                label="Budget consommé"
                value={
                  (() => {
                    const m = formatMontantBudgetFr(projet.budgetConsomme);
                    const c = projet.devise?.code;
                    if (!m && !c) return null;
                    return [m, c].filter(Boolean).join(' ') || null;
                  })()
                }
                editComponent={
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Facultatif"
                    value={form.budgetConsomme ?? ''}
                    onChange={(e) => setForm({ ...form, budgetConsomme: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                }
              />
              <Field
                label="Devise du budget"
                value={
                  projet.devise
                    ? `${projet.devise.code}${projet.devise.libelle ? ` — ${projet.devise.libelle}` : ''}`
                    : null
                }
                editComponent={
                  <select
                    value={form.deviseId || ''}
                    onChange={(e) => setForm({ ...form, deviseId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="">
                      {devises.length ? '— Aucune devise —' : 'Aucune devise (Configuration → Devises)'}
                    </option>
                    {devises.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code}
                        {d.libelle ? ` — ${d.libelle}` : ''}
                      </option>
                    ))}
                  </select>
                }
              />
            </div>
          </ProjetCollapsibleSection>

          {/* ② Gouvernance */}
          <ProjetCollapsibleSection
            open={secGouvernance}
            onToggle={() => setSecGouvernance((v) => !v)}
            title={
              <>
                <span className="w-7 h-7 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                  2
                </span>
                Gouvernance du projet
              </>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <UserMultiSelect field="sponsorIds" label="Sponsor / Superviseur" />
              <UserMultiSelect field="chefProjetIds" label="Chef de projet / PMO" />
              <UserMultiSelect field="techLeadIds" label="Tech Lead" />
              <UserMultiSelect field="equipeIds" label="Équipe projet / Intervenants" />
            </div>

            {/* Parties prenantes */}
            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">Parties prenantes (Stakeholders)</label>
              {partiesPrenantes.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {partiesPrenantes.map((pp, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded text-xs">{pp.type}</span>
                      <span className="text-sm text-gray-700">{pp.nom}</span>
                      {editing && (
                        <button onClick={() => removePartie(idx)} className="text-red-400 hover:text-red-600 text-xs ml-auto">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic mb-3">Aucune partie prenante</p>
              )}
              {editing && (
                <div className="flex gap-2 mt-2">
                  <select value={newPartie.type} onChange={(e) => setNewPartie({ ...newPartie, type: e.target.value })} className="px-2 py-1 border border-gray-300 rounded text-sm">
                    {PARTIES_PRENANTES_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <input type="text" value={newPartie.nom} onChange={(e) => setNewPartie({ ...newPartie, nom: e.target.value })} placeholder="Nom / Description" className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm" onKeyDown={(e) => e.key === 'Enter' && addPartie()} />
                  <button onClick={addPartie} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Ajouter</button>
                </div>
              )}
            </div>
            {/* Clients / Fournisseurs liés — lignes repliables (même principe que la liste Processus) */}
            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">🏢 Clients / Fournisseurs liés</label>
              {projet?.clientsFournisseurs?.length > 0 ? (
                <div className="space-y-4 mb-3">
                  {projet.clientsFournisseurs.map((cfp: any) => {
                    const cfId = cfp.clientFournisseurId as string;
                    const cf = cfp.clientFournisseur;
                    const rowOpen = isCfLieRowExpanded(cfId);
                    const reps = cf?.representants || [];
                    return (
                      <div key={cfId} className="bg-white rounded-lg shadow overflow-hidden border border-gray-100">
                        <button
                          type="button"
                          onClick={() => toggleCfLieRow(cfId)}
                          className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                          aria-expanded={rowOpen}
                          aria-label={
                            rowOpen
                              ? 'Replier le détail du client / fournisseur'
                              : 'Afficher le détail et les actions'
                          }
                        >
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${cf?.type === 'client' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}
                          >
                            {cf?.type === 'client' ? '👤 Client' : '🏭 Fournisseur'}
                          </span>
                          <span className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate text-left">
                            {cf?.nom || '—'}
                          </span>
                          <span className="text-sm text-gray-500 font-mono shrink-0">{cf?.matriculeFiscale || '—'}</span>
                          {rowOpen && (
                            <span className="text-gray-400 shrink-0 ml-auto" aria-hidden>
                              ▼
                            </span>
                          )}
                        </button>

                        {rowOpen && (
                          <div className="px-4 sm:px-5 pb-4 pt-0 border-t border-gray-100">
                            <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 pt-3">
                              <div className="min-w-0 flex-1 space-y-2">
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-gray-600">
                                  {cf?.typeSociete?.nom && (
                                    <div>
                                      <span className="font-medium">Type : </span>
                                      {cf.typeSociete.nom}
                                    </div>
                                  )}
                                  {cf?.matriculeFiscale && (
                                    <div>
                                      <span className="font-medium">MF/ID : </span>
                                      {cf.matriculeFiscale}
                                    </div>
                                  )}
                                  {cf?.pays && (
                                    <div>
                                      <span className="font-medium">Pays : </span>
                                      {cf.pays}
                                    </div>
                                  )}
                                  {cf?.adresse && (
                                    <div className="col-span-2 lg:col-span-4">
                                      <span className="font-medium">Adresse : </span>
                                      {cf.adresse}
                                    </div>
                                  )}
                                </div>

                                {reps.length > 0 && (
                                  <div className="mt-2">
                                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">Représentants légaux</p>
                                    <div className="space-y-1">
                                      {reps.map((rep: any) => (
                                        <div
                                          key={rep.id}
                                          className="flex flex-wrap items-center gap-2 text-sm border border-gray-100 rounded-md px-2 py-1.5 bg-gray-50/80"
                                        >
                                          <span
                                            className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${rep.statut === 'en_exercice' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                                          >
                                            {rep.statut === 'en_exercice' ? 'En exercice' : 'Fin d’exercice'}
                                          </span>
                                          <span className="font-medium">
                                            {rep.prenom} {rep.nom}
                                          </span>
                                          {rep.fonction && <span className="text-gray-400">— {rep.fonction}</span>}
                                          {(rep.email || rep.telephone) && (
                                            <span className="text-gray-500 text-xs w-full basis-full flex flex-wrap gap-x-3 gap-y-0.5">
                                              {rep.email && (
                                                <span>
                                                  E-mail :{' '}
                                                  <a
                                                    href={`mailto:${rep.email}`}
                                                    className="text-blue-700 hover:underline break-all"
                                                  >
                                                    {rep.email}
                                                  </a>
                                                </span>
                                              )}
                                              {rep.telephone && (
                                                <span>
                                                  Tél. :{' '}
                                                  <a
                                                    href={`tel:${String(rep.telephone).replace(/\s/g, '')}`}
                                                    className="tabular-nums text-gray-700 hover:underline"
                                                  >
                                                    {rep.telephone}
                                                  </a>
                                                </span>
                                              )}
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                                <button
                                  type="button"
                                  onClick={() => navigate('/clients-fournisseurs')}
                                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                                >
                                  👁 Module C/F
                                </button>
                                {editing && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await api.delete(`/clients-fournisseurs/${cfId}/projets/${id}`);
                                      setExpandedCfLiesIds((prev) => {
                                        const next = new Set(prev);
                                        next.delete(cfId);
                                        return next;
                                      });
                                      loadProjet();
                                    }}
                                    className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                                  >
                                    🔗 Retirer du projet
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic mb-3">Aucun client/fournisseur lié</p>
              )}
              {editing && (
                <div className="flex gap-2 mt-2">
                  <select value={newPartieCFId} onChange={(e) => setNewPartieCFId(e.target.value)} className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm">
                    <option value="">— Sélectionner un client/fournisseur —</option>
                    {(clientsFournisseurs || []).filter((cf: any) =>
                      !(projet?.clientsFournisseurs || []).some((cfp: any) => cfp.clientFournisseurId === cf.id)
                    ).map((cf: any) => (
                      <option key={cf.id} value={cf.id}>[{cf.type === 'client' ? 'Client' : 'Fournisseur'}] {cf.nom}</option>
                    ))}
                  </select>
                  <button onClick={async () => { if (!newPartieCFId) return; await api.post(`/clients-fournisseurs/${newPartieCFId}/projets`, { projetId: id }); setNewPartieCFId(""); loadProjet(); loadClientsFournisseurs(); }} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Lier</button>
                </div>
              )}
            </div>
          </ProjetCollapsibleSection>

          {/* ③ Contexte et description */}
          <ProjetCollapsibleSection
            open={secContexte}
            onToggle={() => setSecContexte((v) => !v)}
            title={
              <>
                <span className="w-7 h-7 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                  3
                </span>
                Contexte et description
              </>
            }
          >
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Contexte du projet</label>
                {editing ? (
                  <textarea value={form.contexte} onChange={(e) => setForm({ ...form, contexte: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Décrivez le contexte..." />
                ) : (
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{projet.contexte || <span className="italic text-gray-400">—</span>}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Mission — Pourquoi ce projet existe</label>
                {editing ? (
                  <textarea value={form.mission} onChange={(e) => setForm({ ...form, mission: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Quelle est la mission de ce projet ?" />
                ) : (
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{projet.mission || <span className="italic text-gray-400">—</span>}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">Vision — Résultat ou impact attendu</label>
                {editing ? (
                  <textarea value={form.vision} onChange={(e) => setForm({ ...form, vision: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Quel est l'impact visé ?" />
                ) : (
                  <p className="text-sm text-gray-900 whitespace-pre-wrap">{projet.vision || <span className="italic text-gray-400">—</span>}</p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">✅ Scope — Ce qui est inclus</label>
                  {editing ? (
                    <textarea value={form.scopeInclus} onChange={(e) => setForm({ ...form, scopeInclus: e.target.value })} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Ce qui est dans le périmètre..." />
                  ) : (
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{projet.scopeInclus || <span className="italic text-gray-400">—</span>}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">❌ Scope — Ce qui est exclu</label>
                  {editing ? (
                    <textarea value={form.scopeExclus} onChange={(e) => setForm({ ...form, scopeExclus: e.target.value })} rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" placeholder="Ce qui est hors périmètre..." />
                  ) : (
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{projet.scopeExclus || <span className="italic text-gray-400">—</span>}</p>
                  )}
                </div>
              </div>
            </div>
          </ProjetCollapsibleSection>

          {/* ④ Objectifs */}
          <ProjetCollapsibleSection
            open={secObjectifs}
            onToggle={() => setSecObjectifs((v) => !v)}
            title={
              <>
                <span className="w-7 h-7 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                  4
                </span>
                Objectifs du projet
              </>
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Objectifs stratégiques */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Objectifs stratégiques</label>
                {objectifsStrategiques.length > 0 ? (
                  <ul className="space-y-1 mb-3">
                    {objectifsStrategiques.map((obj, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <span className="text-blue-500 mt-0.5">•</span>
                        <span className="flex-1 text-gray-700">{obj}</span>
                        {editing && <button onClick={() => setObjectifsStrategiques(objectifsStrategiques.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-gray-400 italic mb-3">Aucun objectif stratégique</p>}
                {editing && (
                  <div className="flex gap-2">
                    <input type="text" value={newObjStrat} onChange={(e) => setNewObjStrat(e.target.value)} placeholder="Ajouter un objectif..." className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm" onKeyDown={(e) => e.key === 'Enter' && addObjStrat()} />
                    <button onClick={addObjStrat} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">+</button>
                  </div>
                )}
              </div>

              {/* Objectifs opérationnels */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Objectifs opérationnels</label>
                {objectifsOperationnels.length > 0 ? (
                  <ul className="space-y-1 mb-3">
                    {objectifsOperationnels.map((obj, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <span className="text-green-500 mt-0.5">•</span>
                        <span className="flex-1 text-gray-700">{obj}</span>
                        {editing && <button onClick={() => setObjectifsOperationnels(objectifsOperationnels.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-gray-400 italic mb-3">Aucun objectif opérationnel</p>}
                {editing && (
                  <div className="flex gap-2">
                    <input type="text" value={newObjOp} onChange={(e) => setNewObjOp(e.target.value)} placeholder="Ajouter un objectif..." className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm" onKeyDown={(e) => e.key === 'Enter' && addObjOp()} />
                    <button onClick={addObjOp} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">+</button>
                  </div>
                )}
              </div>
            </div>

            {/* KPIs */}
            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">Indicateurs de succès (KPI)</label>
              {kpis.length > 0 ? (
                <div className="flex flex-wrap gap-2 mb-3">
                  {kpis.map((kpi, idx) => (
                    <span key={idx} className="flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                      📊 {kpi}
                      {editing && <button onClick={() => setKpis(kpis.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 ml-1 text-xs">✕</button>}
                    </span>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400 italic mb-3">Aucun KPI défini</p>}
              {editing && (
                <div className="flex gap-2">
                  <input type="text" value={newKpi} onChange={(e) => setNewKpi(e.target.value)} placeholder="Ex: Réduire le temps de traitement de 30%" className="flex-1 px-3 py-1 border border-gray-300 rounded text-sm" onKeyDown={(e) => e.key === 'Enter' && addKpi()} />
                  <button onClick={addKpi} className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Ajouter</button>
                </div>
              )}
            </div>
          </ProjetCollapsibleSection>

        <ProjetCollapsibleSection
          className="print:hidden"
          open={secPvReunion}
          onToggle={() => setSecPvReunion((v) => !v)}
          title={<span className="text-gray-900">📋 PV de réunion liés au projet</span>}
        >
          {id ? <PvReunionsLieesBlock apiPath={`/projets/${id}/pv-reunions`} /> : null}
        </ProjetCollapsibleSection>

        {/* Section Documents */}
        <ProjetCollapsibleSection
          className="print:hidden"
          open={secDocuments}
          onToggle={() => setSecDocuments((v) => !v)}
          title={<span className="text-gray-900">📎 Documents du projet</span>}
        >
          <div className="flex flex-wrap justify-end gap-2 mb-4">
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700"
            >
              + Ajouter un document
            </button>
            <button
              onClick={handleOpenLierModal}
              className="px-4 py-2 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700"
            >
              🔗 Lier un document existant
            </button>
          </div>
          <div className="mb-4 rounded-md border border-blue-100 bg-blue-50/80 p-4 text-sm text-gray-700 leading-relaxed">
            <p className="font-medium text-gray-900 mb-2">Trois niveaux d&apos;accès</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Détail du projet</strong> : lecture, modification, suppression ou gestion des accès sur le projet
                (gouvernance, permissions déléguées). Sans cet accès, la section documents n&apos;est pas utilisable pour
                vous.
              </li>
              <li>
                <strong>Document déposé sur le projet</strong> (fichier ajouté ici, confidentiel) : seuls l&apos;auteur du
                dépôt et les personnes explicitement autorisées peuvent consulter, changer le statut ou supprimer la
                pièce. L&apos;auteur gère les accès comme sur une fiche contrat (exclure ou limiter les administrateurs).
              </li>
              <li>
                <strong>Document lié</strong> : en liant un document déjà existant, les mêmes règles d&apos;accès que sur
                l&apos;emplacement d&apos;origine s&apos;appliquent (héritage des habilitations déjà définies).
              </li>
            </ul>
          </div>
          {documents.length === 0 ? (
            <p className="text-sm text-gray-400 italic">Aucun document attaché à ce projet</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Taille</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Statut</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Accès</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-4 py-2 text-sm text-gray-900">{doc.nom}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{doc.fichierType}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{doc.fichierTaille ? Math.round(doc.fichierTaille / 1024) + ' Ko' : '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{new Date(doc.createdAt).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-2 text-sm">
                      {canModifierStatut(doc) ? (
                        <select value={doc.statut} onChange={(e) => handleChangeStatut(doc.id, e.target.value)} className="text-xs border border-gray-300 rounded px-1 py-0.5 cursor-pointer">
                          <option value="brouillon">brouillon</option>
                          <option value="en_revision">en_revision</option>
                          <option value="valide">valide</option>
                          <option value="archive">archive</option>
                        </select>
                      ) : (
                        <span className={`px-2 py-1 text-xs rounded ${
                          doc.statut === 'valide' ? 'bg-green-100 text-green-800' :
                          doc.statut === 'en_revision' ? 'bg-yellow-100 text-yellow-800' :
                          doc.statut === 'archive' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>{doc.statut}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {doc.estConfidentiel ? (
                        <div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">🔒 Accès restreint</span>
                          <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                            {isNativeProjetUploadDoc(doc) ? (
                              <>
                                <AccessContratLikeAdminLines
                                  keyPrefix={`pd-row-${doc.id}`}
                                  users={users}
                                  createdById={doc.uploadedById}
                                  createdBy={doc.uploadedBy}
                                  adminSansAccesUserIds={doc.adminSansAccesUserIds}
                                  permissions={(doc.permissionsUtilisateurs || [])
                                    .filter((p: any) => p.user?.role === 'admin')
                                    .map((p: any) => ({
                                      userId: p.userId || p.user?.id,
                                      niveau: 'lecture',
                                      user: p.user,
                                    }))}
                                  droitsAdminCompletLabel={DROITS_ADMIN_DOC_PROJET_NATIF}
                                  creatorRightsLabel="auteur — tous les droits sur ce document"
                                  niveauLabel={() => 'Lecture'}
                                  limitedPrefix="Admin : accès limité —"
                                />
                                {(doc.permissionsUtilisateurs || [])
                                  .filter((p: any) => p.user && p.user.role !== 'admin')
                                  .map((p: any) => (
                                    <div key={p.id} className="min-w-0">
                                      <span className="font-medium text-gray-900">
                                        {p.user.prenom} {p.user.nom}
                                      </span>
                                      <span className="text-gray-500 italic block sm:inline sm:ml-1">
                                        (Accès explicite : lecture)
                                      </span>
                                    </div>
                                  ))}
                              </>
                            ) : (
                              (() => {
                                const ayantsDroit: { nom: string; droits: string }[] = [];
                                const addPerson = (id: string, nom: string, droits: string) => {
                                  if (!ayantsDroit.find((a) => a.nom === nom)) ayantsDroit.push({ nom, droits });
                                };
                                users
                                  .filter((u) => u.role === 'admin')
                                  .forEach((u) =>
                                    addPerson(u.id, `${u.prenom} ${u.nom}`, 'Admin : modification statut + accès + lecture')
                                  );
                                if (doc.uploadedBy)
                                  addPerson(
                                    doc.uploadedBy.id,
                                    `${doc.uploadedBy.prenom} ${doc.uploadedBy.nom}`,
                                    'Uploadeur : modification statut + accès + lecture'
                                  );
                                if (projet?.createdBy)
                                  addPerson(
                                    projet.createdBy.id,
                                    `${projet.createdBy.prenom} ${projet.createdBy.nom}`,
                                    'Créateur : modification statut + accès + lecture'
                                  );
                                (doc.permissionsUtilisateurs || []).forEach((p: any) => {
                                  if (p.user)
                                    addPerson(p.user.id, `${p.user.prenom} ${p.user.nom}`, 'Accès explicite : lecture');
                                });
                                if (ayantsDroit.length === 0)
                                  return <span className="italic text-gray-400">Aucun utilisateur défini</span>;
                                return ayantsDroit.map((a, i) => (
                                  <div key={i}>
                                    <span className="font-medium">{a.nom}</span>{' '}
                                    <span className="text-gray-400">({a.droits})</span>
                                  </div>
                                ));
                              })()
                            )}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">🌐 Accès libre</span>
                          <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                            {(() => {
                              const ayantsDroit: {nom: string, droits: string}[] = [];
                              const addPerson = (id: string, nom: string, droits: string) => {
                                if (!ayantsDroit.find(a => a.nom === nom)) ayantsDroit.push({ nom, droits });
                              };
                              users.filter(u => u.role === 'admin').forEach(u => addPerson(u.id, `${u.prenom} ${u.nom}`, 'Admin : modification statut + accès + lecture'));
                              if (doc.uploadedBy) addPerson(doc.uploadedBy.id, `${doc.uploadedBy.prenom} ${doc.uploadedBy.nom}`, 'Uploadeur : modification statut + accès + lecture');
                              if (projet?.createdBy) addPerson(projet.createdBy.id, `${projet.createdBy.prenom} ${projet.createdBy.nom}`, 'Créateur : modification statut + accès + lecture');
                              (projet?.chefsProjet || []).forEach((s: any) => { const u = s.user || s; addPerson(u.id, `${u.prenom} ${u.nom}`, 'Chef de projet : modification statut + lecture'); });
                              if (projet?.responsable) addPerson(projet.responsable.id, `${projet.responsable.prenom} ${projet.responsable.nom}`, 'Responsable : lecture');
                              if (projet?.gestionnaire) addPerson(projet.gestionnaire.id, `${projet.gestionnaire.prenom} ${projet.gestionnaire.nom}`, 'Gestionnaire : lecture');
                              (projet?.sponsors || []).forEach((s: any) => { const u = s.user || s; addPerson(u.id, `${u.prenom} ${u.nom}`, 'Sponsor : lecture'); });
                              (projet?.techLeads || []).forEach((s: any) => { const u = s.user || s; addPerson(u.id, `${u.prenom} ${u.nom}`, 'Tech Lead : lecture'); });
                              (projet?.equipe || []).forEach((s: any) => { const u = s.user || s; addPerson(u.id, `${u.prenom} ${u.nom}`, 'Équipe : lecture'); });
                              if (ayantsDroit.length === 0) return <span className="italic text-gray-400">Aucune gouvernance définie</span>;
                              return ayantsDroit.map((a, i) => (
                                <div key={i}><span className="font-medium">{a.nom}</span> <span className="text-gray-400">({a.droits})</span></div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      <div className="flex gap-2"><button onClick={() => handleViewDocument(doc)} className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200">👁 Visualiser</button><button onClick={() => handleDownload(doc)} className="px-3 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200">⬇ Télécharger</button>{doc.typeDocument !== 'projet' && <button onClick={() => handleDelierDocument(doc.id, doc.nom)} className="px-3 py-1 bg-orange-100 text-orange-700 rounded text-xs hover:bg-orange-200">🔗 Délier</button>}{canModifierAcces(doc) && (
                        <button
                          type="button"
                          onClick={() => void handleOpenAccesModal(doc)}
                          className="px-3 py-1 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200"
                        >
                          🔑 Accès
                        </button>
                      )}
                      {canSupprimerDocument(doc) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteDocument(doc.id, doc.nom)}
                          className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                        >
                          🗑 Supprimer
                        </button>
                      )}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ProjetCollapsibleSection>

        {id && (
          <div className="print:hidden space-y-4">
            <ProjetCollapsibleSection
              id="pilotage-agile"
              className="scroll-mt-24"
              open={secPilotage}
              onToggle={() => setSecPilotage((v) => !v)}
              title={<span className="text-gray-900">📊 Pilotage du projet</span>}
            >
              <ProjetPilotageAgile
                projetId={id}
                projet={projet}
                usersForTaches={users.map((u) => ({
                  id: u.id,
                  nom: u.nom,
                  prenom: u.prenom,
                  role: u.role,
                }))}
                tachesBrutes={tachesProjet}
                onTachesRefresh={async () => {
                  await refreshTachesProjet();
                  await loadProjetScoring();
                }}
                hideIntro
              />
            </ProjetCollapsibleSection>
            <ProjetCollapsibleSection
              open={secScoring}
              onToggle={() => setSecScoring((v) => !v)}
              title={<span className="text-gray-900">⭐ Scoring automatisé</span>}
            >
              <p className="text-xs text-gray-600 mb-4">
                Scoring 100% automatique (1 à 5) calculé sur les tâches, puis agrégé par utilisateur et par entité.
              </p>
              <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs text-indigo-900">
                <p className="font-semibold mb-1">Méthodes de calcul</p>
                <p className="mb-1">
                  Utilisateur = (Moyenne score tâches × 90%) + (Score productivité × 10%)
                </p>
                <p>
                  Entité = Moyenne des scores utilisateurs rattachés à l&apos;entité via les tâches du projet
                </p>
              </div>

              {loadingScoring ? (
                <p className="text-sm text-gray-500">Chargement du scoring…</p>
              ) : scoringError ? (
                <p className="text-sm text-red-600">{scoringError}</p>
              ) : !projetScoring ? (
                <p className="text-sm text-gray-500">Aucune donnée de scoring disponible.</p>
              ) : (
                <div className="space-y-5">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <div className="text-xs text-gray-500 uppercase">Tâches scorées</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-1">{projetScoring.meta.totalTaches}</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <div className="text-xs text-gray-500 uppercase">Utilisateurs scorés</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-1">{projetScoring.meta.totalUtilisateurs}</div>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <div className="text-xs text-gray-500 uppercase">Entités scorées</div>
                      <div className="text-2xl font-semibold text-gray-900 mt-1">{projetScoring.meta.totalEntites}</div>
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Utilisateur</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Score final</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Moy. tâches</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Productivité</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Terminées ({projetScoring.settings.productivityWindowDays}j)</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {projetScoring.userScores.map((u) => (
                          <tr key={u.user.id}>
                            <td className="px-3 py-2 font-medium text-gray-900">{u.user.prenom} {u.user.nom}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${scoringBadgeClass(u.scores.final)}`}>
                                {u.scores.final.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{u.scores.moyenneTaches.toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-700">{u.scores.productivite.toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-700">{u.metrics.tachesTermineesPeriode}</td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs hover:bg-indigo-100"
                                onClick={() =>
                                  setSelectedScoringUserId((prev) => (prev === u.user.id ? null : u.user.id))
                                }
                              >
                                {selectedScoringUserId === u.user.id ? 'Fermer' : 'Détail'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedScoringUser && (
                    <div className="rounded-lg border border-indigo-200 bg-white px-4 py-3 text-sm">
                      <div className="font-semibold text-gray-900 mb-1">
                        Détail calcul utilisateur : {selectedScoringUser.user.prenom} {selectedScoringUser.user.nom}
                      </div>
                      <p className="text-gray-700">
                        Score final = ({selectedScoringUser.scores.moyenneTaches.toFixed(2)} × 0.90) + ({selectedScoringUser.scores.productivite.toFixed(2)} × 0.10) ={' '}
                        <span className="font-semibold">{selectedScoringUser.scores.final.toFixed(2)}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Base productivité : {selectedScoringUser.metrics.tachesTermineesPeriode} tâche(s) terminée(s) sur {selectedScoringUser.metrics.periodeJours} jours.
                      </p>
                    </div>
                  )}

                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Entité</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Score final</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Contributions utilisateurs</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {projetScoring.entityScores.map((e) => (
                          <tr key={e.entite.id}>
                            <td className="px-3 py-2 font-medium text-gray-900">{e.entite.nom}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${scoringBadgeClass(e.scores.final)}`}>
                                {e.scores.final.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{e.metrics.utilisateursPrisEnCompte}</td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs hover:bg-indigo-100"
                                onClick={() =>
                                  setSelectedScoringEntiteId((prev) => (prev === e.entite.id ? null : e.entite.id))
                                }
                              >
                                {selectedScoringEntiteId === e.entite.id ? 'Fermer' : 'Détail'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedScoringEntite && (
                    <div className="rounded-lg border border-indigo-200 bg-white px-4 py-3 text-sm">
                      <div className="font-semibold text-gray-900 mb-1">
                        Détail calcul entité : {selectedScoringEntite.entite.nom}
                      </div>
                      <p className="text-gray-700">
                        Score entité = moyenne des scores utilisateurs rattachés ={' '}
                        <span className="font-semibold">{selectedScoringEntite.scores.final.toFixed(2)}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Valeurs utilisées : {(scoringEntityUserScores.get(selectedScoringEntite.entite.id) || [])
                          .map((v) => v.toFixed(2))
                          .join(', ') || 'aucune'}.
                      </p>
                    </div>
                  )}

                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Tâche</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Final</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Délais</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Workflow</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Stabilité</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Rework</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Flux</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {projetScoring.taskScores.map((t) => (
                          <tr key={t.id}>
                            <td className="px-3 py-2 text-gray-900">{t.nom}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${scoringBadgeClass(t.scoring.final)}`}>
                                {t.scoring.final.toFixed(2)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{t.scoring.delais.toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-700">{t.scoring.workflow.toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-700">{t.scoring.stabilite.toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-700">{t.scoring.rework.toFixed(2)}</td>
                            <td className="px-3 py-2 text-gray-700">{t.scoring.flux.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </ProjetCollapsibleSection>
            {projet && (
              <ProjetCollapsibleSection
                open={secRecap}
                onToggle={() => setSecRecap((v) => !v)}
                title={<span className="text-gray-900">Recap Accès</span>}
              >
                <p className="text-xs text-gray-500 mb-5">
                  Synthèse des habilitations sur la fiche projet, les documents et les tâches. Les droits délégués sur le
                  projet se gèrent via le bouton « Accès » (en-tête de la fiche ou liste des projets).
                </p>

                <h3 className="text-sm font-semibold text-gray-800 mb-2">Accès au projet</h3>
                {recapProjetRows.length === 0 ? (
                  <p className="text-sm text-gray-500 mb-6">Aucune entrée à afficher.</p>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-lg mb-6">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Utilisateur</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Rôles / droits</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {recapProjetRows.map((row) => (
                          <tr key={row.userId} className="bg-white">
                            <td className="px-3 py-2 font-medium text-gray-900 align-top">{row.utilisateur}</td>
                            <td className="px-3 py-2 text-gray-700 align-top">{row.roles}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-800 mb-2">Accès aux documents</h3>
                {documents.length === 0 ? (
                  <p className="text-sm text-gray-500 mb-6">Aucun document rattaché à ce projet.</p>
                ) : (
                  <div className="space-y-4 mb-6">
                    {documents.map((doc) => {
                      const docRows = buildProjetDocumentAccessRecapRows(doc, projet, users);
                      return (
                        <div key={doc.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h4 className="font-medium text-gray-900 text-sm">{doc.nom}</h4>
                            {doc.estConfidentiel ? (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                Confidentiel
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                Non confidentiel
                              </span>
                            )}
                          </div>
                          {docRows.length === 0 ? (
                            <p className="text-xs text-gray-500 italic">Aucune ligne d&apos;accès détaillée.</p>
                          ) : (
                            <div className="overflow-x-auto border border-gray-100 rounded-md bg-white">
                              <table className="min-w-full text-xs">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">Utilisateur</th>
                                    <th className="px-3 py-2 text-left font-medium text-gray-600">Rôle / droits</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {docRows.map((dr) => (
                                    <tr key={dr.id}>
                                      <td className="px-3 py-2 font-medium text-gray-900 align-top">{dr.nom}</td>
                                      <td className="px-3 py-2 text-gray-700 align-top">{dr.role}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <h3 className="text-sm font-semibold text-gray-800 mb-2">Accès aux tâches</h3>
                <p className="text-xs text-gray-600 mb-3">
                  Les administrateurs et la gouvernance projet voient toutes les tâches. Les autres utilisateurs ne voient
                  que les tâches dont ils sont créateurs, assignés ou membres d&apos;une entité assignée (hors cas
                  admin).
                </p>
                {recapTachesRows.length === 0 ? (
                  <p className="text-sm text-gray-500">Aucune entrée à afficher.</p>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Utilisateur</th>
                          <th className="px-3 py-2 text-left font-medium text-gray-600">Rôles / visibilité</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {recapTachesRows.map((row) => (
                          <tr key={row.userId} className="bg-white">
                            <td className="px-3 py-2 font-medium text-gray-900 align-top">{row.utilisateur}</td>
                            <td className="px-3 py-2 text-gray-700 align-top">{row.roles}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </ProjetCollapsibleSection>
            )}
          </div>
        )}
        </div>{/* fin print-zone */}
      </div>{/* p-6 page */}
      <DocumentAccesNatifModal
        open={showDocAccesContratModal && !!acceDoc}
        document={acceDoc ? { id: acceDoc.id, nom: acceDoc.nom } : null}
        users={users}
        onClose={() => {
          setShowDocAccesContratModal(false);
          setAcceDoc(null);
        }}
        onAfterMutation={() => loadDocuments()}
      />

      {/* Modal Modifier Accès */}
      {showAccesModal && acceDoc && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">🔑 Modifier l'accès — {acceDoc.nom}</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="acceConfidentiel" checked={acceEstConfidentiel} onChange={(e) => { setAcceEstConfidentiel(e.target.checked); if (!e.target.checked) setAccePermissionUserIds([]); }} />
                <label htmlFor="acceConfidentiel" className="text-sm text-gray-700">Accès restreint (document confidentiel)</label>
              </div>
              {acceEstConfidentiel && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Utilisateurs autorisés :</label>
                  <select multiple value={accePermissionUserIds} onChange={(e) => setAccePermissionUserIds(Array.from(e.target.selectedOptions, o => o.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm h-40">
                    {users.map(u => <option key={u.id} value={u.id}>{u.prenom} {u.nom}</option>)}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Maintenez Ctrl (Cmd sur Mac) pour sélectionner plusieurs utilisateurs</p>
                  {accePermissionUserIds.length > 0 && <p className="text-xs text-blue-600 mt-1">{accePermissionUserIds.length} utilisateur(s) sélectionné(s)</p>}
                </div>
              )}
              {!acceEstConfidentiel && (
                <p className="text-sm text-green-600">
                  🌐 Le document sera consultable par toute personne ayant accès au détail de ce projet.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setShowAccesModal(false); setAcceDoc(null); }} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
              <button onClick={handleSaveAcces} className="px-4 py-2 bg-purple-600 text-white rounded-md text-sm hover:bg-purple-700">Enregistrer</button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Lier Document Existant */}
      {showLierModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <h3 className="text-lg font-semibold mb-4">🔗 Lier un document existant</h3>
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              Un document lié conserve ses habilitations d&apos;origine (processus, autre projet ou général). Seuls les
              utilisateurs qui ont accès au détail de ce projet pourront en outre voir la pièce dans ce contexte.
            </p>
            <input
              type="text"
              value={searchDoc}
              onChange={(e) => setSearchDoc(e.target.value)}
              placeholder="Rechercher un document..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-4"
            />
            <div className="overflow-y-auto flex-1 border border-gray-200 rounded-md">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500"></th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Nom</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lié à</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {allDocuments
                    .filter(d => d.nom.toLowerCase().includes(searchDoc.toLowerCase()))
                    .map(d => (
                      <tr key={d.id} onClick={() => handleToggleDoc(d.id)} className="cursor-pointer hover:bg-blue-50">
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selectedDocIds.includes(d.id)} onChange={() => handleToggleDoc(d.id)} onClick={e => e.stopPropagation()} />
                        </td>
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">{d.nom}</td>
                        <td className="px-3 py-2 text-sm text-gray-500">{d.typeDocument}</td>
                        <td className="px-3 py-2 text-sm text-gray-500">
                          {d.processus ? d.processus.nom : d.projet ? d.projet.nom : 'Général'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {selectedDocIds.length > 0 && (
              <p className="text-sm text-blue-600 mt-2">{selectedDocIds.length} document(s) sélectionné(s)</p>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowLierModal(false)} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
              <button onClick={handleLierDocuments} disabled={selectedDocIds.length === 0} className="px-4 py-2 bg-gray-600 text-white rounded-md text-sm hover:bg-gray-700 disabled:opacity-50">Lier ({selectedDocIds.length})</button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Upload Document */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Ajouter un document</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fichier(s) <span className="text-red-500">*</span></label>
                <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt,.zip" onChange={(e) => { if (e.target.files) { const files = Array.from(e.target.files); setUploadFiles(files); if (files.length === 1) setUploadNom(files[0].name); } }} className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
                {uploadFiles.length > 0 && <p className="text-xs text-gray-500 mt-1">{uploadFiles.length} fichier(s) sélectionné(s)</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du document</label>
                <input type="text" value={uploadNom} onChange={(e) => setUploadNom(e.target.value)} placeholder="Nom du document" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Description optionnelle" rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Accès</label>
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" id="estConfidentiel" checked={uploadEstConfidentiel} onChange={(e) => { setUploadEstConfidentiel(e.target.checked); if (!e.target.checked) setUploadPermissionUserIds([]); }} />
                  <label htmlFor="estConfidentiel" className="text-sm text-gray-700">Accès restreint (document confidentiel)</label>
                </div>
                {uploadEstConfidentiel && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Sélectionner les utilisateurs autorisés :</label>
                    <select multiple value={uploadPermissionUserIds} onChange={(e) => setUploadPermissionUserIds(Array.from(e.target.selectedOptions, o => o.value))} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm h-32">
                      {users.map(u => <option key={u.id} value={u.id}>{u.prenom} {u.nom}</option>)}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">Maintenez Ctrl (Cmd sur Mac) pour sélectionner plusieurs utilisateurs</p>
                    {uploadPermissionUserIds.length > 0 && <p className="text-xs text-blue-600 mt-1">{uploadPermissionUserIds.length} utilisateur(s) sélectionné(s)</p>}
                  </div>
                )}
                {!uploadEstConfidentiel && (
                  <p className="text-xs text-gray-500 mt-2">
                    Sans restriction, le fichier est consultable par toute personne habilitée sur le détail du projet
                    (gouvernance et permissions projet).
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => { setShowUploadModal(false); setUploadFiles([]); setUploadNom(''); setUploadDescription(''); }} className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50">Annuler</button>
              <button onClick={handleUploadDocument} disabled={uploading} className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50">{uploading ? 'Upload en cours...' : 'Uploader'}</button>
            </div>
          </div>
        </div>
      )}
      {accesModalProjetDetail && (
        <ProjetAccesModal
          projet={accesModalProjetDetail}
          users={users as any[]}
          onClose={() => setAccesModalProjetDetail(null)}
          onAfterChange={() => void loadProjet()}
        />
      )}
      {accessBlockedModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="projet-access-blocked-title"
          onClick={() => setAccessBlockedModal(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="projet-access-blocked-title" className="text-lg font-semibold text-gray-900 mb-2">
              Accès refusé
            </h3>
            {accessBlockedModal.context === 'projet' ? (
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Vous n&apos;avez pas accès au détail de ce projet : vous ne pouvez donc pas consulter ni télécharger les
                documents de la section « Documents du projet ». Veuillez contacter l&apos;une des personnes suivantes
                pour obtenir une habilitation :
              </p>
            ) : (
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Vous n&apos;avez pas la possibilité d&apos;accéder à ce document
                {accessBlockedModal.documentLabel ? (
                  <>
                    {' '}
                    « <span className="font-medium">{accessBlockedModal.documentLabel}</span> »
                  </>
                ) : null}
                . Vous devez disposer de l&apos;accès au projet et, pour un document confidentiel, figurer dans la liste
                des personnes autorisées (ou disposer d&apos;un rôle habilité). Veuillez contacter l&apos;une des
                personnes suivantes :
              </p>
            )}
            {(() => {
              const rows =
                accessBlockedModal.context === 'projet'
                  ? collectHabilitatorsForProjetAccess(projet, users)
                  : collectHabilitatorsForProjetDocumentAccess(
                      projet,
                      users,
                      accessBlockedModal.documentRef || null
                    );
              if (rows.length === 0) {
                return (
                  <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md p-3">
                    Aucun contact nominatif n&apos;a pu être déterminé automatiquement. Veuillez vous adresser à votre
                    administrateur applicatif.
                  </p>
                );
              }
              return (
                <ul className="text-sm text-gray-800 space-y-2 border border-gray-100 rounded-md p-3 bg-gray-50 max-h-56 overflow-y-auto">
                  {rows.map((h) => (
                    <li key={h.id} className="leading-snug">
                      • {h.line}
                    </li>
                  ))}
                </ul>
              );
            })()}
            <div className="flex justify-end mt-5">
              <button
                type="button"
                onClick={() => setAccessBlockedModal(null)}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de visualisation */}
      {viewingDocument && documentUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-[90vw] h-[90vh] flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              <h2 className="text-xl font-bold">{viewingDocument.nom}</h2>
              <div className="flex gap-2">
                <button onClick={() => handleDownload(viewingDocument)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">⬇ Télécharger</button>
                <button onClick={closeViewer} className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm">✕ Fermer</button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              {viewingDocument.fichierType === 'application/pdf' || viewingDocument.fichierType?.includes('pdf') ? (
                <iframe src={documentUrl} className="w-full h-full border-0" title={viewingDocument.nom} />
              ) : viewingDocument.fichierType?.includes('image') ? (
                <img src={documentUrl} alt={viewingDocument.nom} className="max-w-full max-h-full object-contain mx-auto" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <p className="text-lg mb-4">Aperçu non disponible pour ce type de fichier</p>
                  <button onClick={() => handleDownload(viewingDocument)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Télécharger le fichier</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
