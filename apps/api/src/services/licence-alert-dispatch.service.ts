import nodemailer from 'nodemailer';
import { UserStatus } from '../generated/prisma/enums';
import { prisma } from '../utils/prisma';
import {
  LICENCE_ALERTE_CORPS_DEFAUT,
  LICENCE_ALERTE_SUJET_DEFAUT,
  applyLicenceAlerteTemplate,
} from '../constants/licence-alerte-mail';
import { NotificationSettingService } from './notification-setting.service';

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

async function getActiveSMTP() {
  const smtp = await prisma.sMTPConfig.findFirst({ where: { isActive: true } });
  if (!smtp) return null;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    tls: { rejectUnauthorized: false },
    auth: { user: smtp.user, pass: smtp.password },
  });
  return { smtp, transporter };
}

type NotifRow = {
  id: string;
  mode: string;
  joursAvant: number;
  dateAlerte: Date | null;
  recurrence: string;
  lastSentAt: Date | null;
  destinataireIds: string[];
};

function shouldSendLicenceAlert(notif: NotifRow, licence: { dateFin: Date | null }, today: Date): boolean {
  const t0 = startOfLocalDay(today);

  if (notif.lastSentAt && sameLocalDay(new Date(notif.lastSentAt), t0)) {
    return false;
  }

  if (notif.mode === 'before_end') {
    if (!licence.dateFin) return false;
    const end = startOfLocalDay(new Date(licence.dateFin));
    const alertDay = new Date(end);
    alertDay.setDate(alertDay.getDate() - Math.max(1, notif.joursAvant));
    return sameLocalDay(alertDay, t0);
  }

  if (notif.mode !== 'date_recurrence' || !notif.dateAlerte) return false;

  const anchor = startOfLocalDay(new Date(notif.dateAlerte));
  const rec = notif.recurrence || 'none';

  if (rec === 'none') {
    return sameLocalDay(anchor, t0);
  }

  if (rec === 'weekly') {
    const diffMs = t0.getTime() - anchor.getTime();
    if (diffMs < 0) return false;
    const diffDays = Math.floor(diffMs / 86400000);
    return diffDays % 7 === 0;
  }

  if (rec === 'monthly') {
    const monthsSince =
      (t0.getFullYear() - anchor.getFullYear()) * 12 + (t0.getMonth() - anchor.getMonth());
    if (monthsSince < 0) return false;
    const lastDayOfMonth = new Date(t0.getFullYear(), t0.getMonth() + 1, 0).getDate();
    const targetDay = Math.min(anchor.getDate(), lastDayOfMonth);
    if (t0.getDate() !== targetDay) return false;
    if (monthsSince === 0) return t0.getTime() >= anchor.getTime();
    return true;
  }

  if (rec === 'yearly') {
    if (t0.getMonth() !== anchor.getMonth() || t0.getDate() !== anchor.getDate()) return false;
    if (t0.getFullYear() < anchor.getFullYear()) return false;
    if (t0.getFullYear() === anchor.getFullYear()) return t0.getTime() >= anchor.getTime();
    return true;
  }

  return false;
}

/**
 * Boucle planifiable (cron / setInterval) : envoie les alertes actives dont la licence n’est pas clôturée.
 */
export async function runLicenceAlertDispatch(): Promise<{ sent: number; skipped: number }> {
  const today = new Date();
  const smtpData = await getActiveSMTP();
  if (!smtpData) {
    return { sent: 0, skipped: 0 };
  }
  const { smtp, transporter } = smtpData;
  const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  const rows = await prisma.licenceNotification.findMany({
    where: { active: true },
    include: {
      licence: {
        select: {
          id: true,
          nom: true,
          reference: true,
          typeLicence: true,
          statut: true,
          dateDebut: true,
          dateFin: true,
          deletedAt: true,
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;

  for (const row of rows) {
    const licence = row.licence;
    if (!licence || licence.deletedAt || licence.statut === 'cloturee') {
      skipped++;
      continue;
    }
    if (!shouldSendLicenceAlert(row, licence, today)) {
      skipped++;
      continue;
    }
    if (!(await NotificationSettingService.isEmailEnabled('licence_alerte'))) {
      skipped++;
      continue;
    }
    const ids = [...new Set(row.destinataireIds || [])];
    if (ids.length === 0) {
      skipped++;
      continue;
    }

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, nom: true, prenom: true, statut: true },
    });

    let ctx = '';
    if (row.mode === 'before_end') {
      ctx = `Rappel : la licence arrive à échéance dans ${row.joursAvant} jour(s) (date de fin renseignée).`;
    } else {
      const r = row.recurrence || 'none';
      ctx =
        r === 'none'
          ? 'Alerte planifiée à la date indiquée.'
          : `Alerte récurrente : ${r === 'weekly' ? 'chaque semaine' : r === 'monthly' ? 'chaque mois' : 'chaque année'} à partir de la date de référence.`;
    }

    const dateDebutStr = licence.dateDebut
      ? new Date(licence.dateDebut).toLocaleDateString('fr-FR')
      : '—';
    const dateFinStr = licence.dateFin ? new Date(licence.dateFin).toLocaleDateString('fr-FR') : '—';

    let anyMailOk = false;
    for (const u of users) {
      if (!u.email || u.statut !== UserStatus.actif) continue;
      const vars = {
        prenomNom: `${u.prenom} ${u.nom}`.trim(),
        nomLicence: licence.nom,
        reference: licence.reference,
        typeLicence: licence.typeLicence,
        dateDebut: dateDebutStr,
        dateFin: dateFinStr,
        contexteAlerte: ctx,
        lienApplication: `${appUrl}/licences`,
      };
      const subject = applyLicenceAlerteTemplate(LICENCE_ALERTE_SUJET_DEFAUT, vars);
      const bodyText = applyLicenceAlerteTemplate(LICENCE_ALERTE_CORPS_DEFAUT, vars);
      const html = bodyText.split('\n').map((line) => `<p style="margin:0 0 8px;">${line || '&nbsp;'}</p>`).join('');

      try {
        await transporter.sendMail({
          from: `"${smtp.fromName || 'PMO Hub'}" <${smtp.fromEmail}>`,
          to: u.email,
          subject,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;">${html}</div>`,
        });
        anyMailOk = true;
        sent++;
      } catch (e) {
        console.error('[LICENCE_ALERT]', row.id, u.email, e);
      }
    }

    if (anyMailOk) {
      await prisma.licenceNotification.update({
        where: { id: row.id },
        data: { lastSentAt: new Date() },
      });
    }
  }

  if (sent > 0) {
    console.log(`[LICENCE_ALERT] Envoi terminé : ${sent} email(s), ${skipped} ignoré(s).`);
  }
  return { sent, skipped };
}
