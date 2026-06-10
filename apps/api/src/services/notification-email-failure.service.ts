import { prisma } from '../utils/prisma';
import nodemailer from 'nodemailer';

function smtpErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function getActiveSMTP() {
  const smtp = await prisma.sMTPConfig.findFirst({ where: { isActive: true } });
  if (!smtp) return null;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
  });
  return { smtp, transporter };
}

export async function recordNotificationEmailFailure(data: {
  kind: string;
  toEmail: string;
  toUserId?: string | null;
  subject: string;
  htmlBody: string;
  errorMessage: string;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    await prisma.notificationEmailFailure.create({
      data: {
        kind: data.kind,
        toEmail: data.toEmail,
        toUserId: data.toUserId || null,
        subject: data.subject,
        htmlBody: data.htmlBody,
        errorMessage: data.errorMessage,
        metadata: data.metadata === undefined || data.metadata === null ? undefined : (data.metadata as object),
      },
    });
  } catch (e) {
    console.error('[NotificationEmailFailure] Impossible d’enregistrer l’échec:', e);
  }
}

export class NotificationEmailFailureService {
  async list(take = 200) {
    return prisma.notificationEmailFailure.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 500),
      include: {
        toUser: { select: { id: true, email: true, nom: true, prenom: true } },
      },
    });
  }

  async deleteById(id: string) {
    await prisma.notificationEmailFailure.delete({ where: { id } });
  }

  async resend(id: string): Promise<{ ok: true }> {
    const row = await prisma.notificationEmailFailure.findUnique({ where: { id } });
    if (!row) throw new Error('NOT_FOUND');

    const smtpData = await getActiveSMTP();
    if (!smtpData) {
      await prisma.notificationEmailFailure.update({
        where: { id },
        data: { errorMessage: 'Pas de configuration SMTP active (renvoi impossible).' },
      });
      throw new Error('SMTP non configuré');
    }

    try {
      await smtpData.transporter.sendMail({
        from: `"${smtpData.smtp.fromName || 'PMO Hub'}" <${smtpData.smtp.fromEmail}>`,
        to: row.toEmail,
        subject: row.subject,
        html: row.htmlBody,
      });
      await prisma.notificationEmailFailure.delete({ where: { id } });
      return { ok: true };
    } catch (err) {
      const msg = smtpErrorMessage(err);
      await prisma.notificationEmailFailure.update({
        where: { id },
        data: { errorMessage: `Échec du renvoi : ${msg}` },
      });
      throw new Error(msg);
    }
  }
}
