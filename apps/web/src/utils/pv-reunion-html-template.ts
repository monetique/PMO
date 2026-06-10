function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linesToUl(lines: string[]): string {
  if (!lines.length) return '<li>—</li>';
  return lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
}

function linesToParagraphs(lines: string[]): string {
  if (!lines.length) return '<p>—</p>';
  return lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
}

export type PvTemplateContext = {
  titre: string;
  statutLabel: string;
  dateReunionLabel: string;
  derniereMiseAJourLabel?: string;
  usersLines: string[];
  cfLines: string[];
  projetsLines: string[];
  tachesLines: string[];
  userStoriesLines: string[];
  epicsLines: string[];
  ordreDuJourLines?: string[];
  pointsDiscutesText?: string;
  decisionsPrisesLines?: string[];
  risquesBlocagesText?: string;
  conclusionText?: string;
  actionsRows?: Array<{
    action: string;
    responsable: string;
    dateLimite: string;
    userIds?: string[];
    userId?: string;
    entiteId?: string;
    clientFournisseurId?: string;
    notifyAssigned?: boolean;
  }>;
};

/** Structure type pour un procès-verbal (HTML compatible éditeur / export). */
export function buildStructuredPvHtml(ctx: PvTemplateContext): string {
  const t = escapeHtml(ctx.titre);
  const ordre = (ctx.ordreDuJourLines || []).map((x) => String(x || '').trim()).filter(Boolean);
  const decisions = (ctx.decisionsPrisesLines || []).map((x) => String(x || '').trim()).filter(Boolean);
  const points = String(ctx.pointsDiscutesText || '').trim();
  const risques = String(ctx.risquesBlocagesText || '').trim();
  const conclusion = String(ctx.conclusionText || '').trim();
  const actions = (ctx.actionsRows || [])
    .map((x) => ({
      action: String(x?.action || '').trim(),
      responsable: String(x?.responsable || '').trim(),
      dateLimite: String(x?.dateLimite || '').trim(),
      userIds: Array.isArray(x?.userIds)
        ? x.userIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [],
      userId: String(x?.userId || '').trim(),
      entiteId: String(x?.entiteId || '').trim(),
      clientFournisseurId: String(x?.clientFournisseurId || '').trim(),
      notifyAssigned: !!x?.notifyAssigned,
    }))
    .filter((x) => x.action || x.responsable || x.dateLimite);

  const pointsHtml = points
    ? points
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
    : '';
  const risquesHtml = risques
    ? risques
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
    : '';
  const conclusionHtml = conclusion
    ? conclusion
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join('')
    : '';

  const actionsHtml = actions.length
    ? `
<h2>Actions à réaliser</h2>
<table>
<thead>
<tr><th>Action</th><th>Responsable</th><th>Date limite</th></tr>
</thead>
<tbody>
${actions
  .map(
    (a) => {
      const mergedUserIds = Array.from(new Set([...(a.userIds || []), a.userId].filter(Boolean)));
      const firstUserId = mergedUserIds[0] || '';
      return `<tr data-user-id="${escapeHtml(firstUserId)}" data-user-ids="${escapeHtml(JSON.stringify(mergedUserIds))}" data-entite-id="${escapeHtml(a.entiteId)}" data-cf-id="${escapeHtml(a.clientFournisseurId)}" data-notify="${a.notifyAssigned ? '1' : '0'}"><td>${escapeHtml(a.action || '—')}</td><td>${escapeHtml(a.responsable || '—')}</td><td>${escapeHtml(a.dateLimite || '—')}</td></tr>`;
    }
  )
  .join('')}
</tbody>
</table>`
    : '';

  return `
<h2>Informations générales</h2>
<p><strong>Dernière mise à jour :</strong> ${escapeHtml(ctx.derniereMiseAJourLabel || '—')}</p>

<h2>Participants</h2>
<h3>Présents (utilisateurs)</h3>
<ul>${linesToUl(ctx.usersLines)}</ul>
<h3>Présents (clients / fournisseurs)</h3>
<ul>${linesToUl(ctx.cfLines)}</ul>

${ordre.length ? `<h2>Ordre du jour</h2>${linesToParagraphs(ordre)}` : ''}
${pointsHtml ? `<h2>Points discutés</h2>${pointsHtml}` : ''}
${decisions.length ? `<h2>Décisions prises</h2>${linesToParagraphs(decisions)}` : ''}
${actionsHtml}
${risquesHtml ? `<h2>Risques / blocages</h2>${risquesHtml}` : ''}
${conclusionHtml ? `<h2>Conclusion</h2>${conclusionHtml}` : ''}
${(() => {
  const parts: string[] = [];
  if (ctx.projetsLines.length)
    parts.push(`<p><strong>Projets :</strong> ${escapeHtml(ctx.projetsLines.join(' ; '))}</p>`);
  if (ctx.tachesLines.length)
    parts.push(`<p><strong>Tâches :</strong> ${escapeHtml(ctx.tachesLines.join(' ; '))}</p>`);
  if (ctx.userStoriesLines.length)
    parts.push(`<p><strong>User stories :</strong> ${escapeHtml(ctx.userStoriesLines.join(' ; '))}</p>`);
  if (ctx.epicsLines.length)
    parts.push(`<p><strong>Epics :</strong> ${escapeHtml(ctx.epicsLines.join(' ; '))}</p>`);
  if (!parts.length) return '';
  return `\n<h2>Rattachements (référence)</h2>\n${parts.join('\n')}`;
})()}
`.trim();
}
