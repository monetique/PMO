import crypto from 'crypto';
import { prisma } from '../utils/prisma';
import bcrypt from 'bcrypt';
import nodemailer from 'nodemailer';

export class PasswordResetService {
  private async getActiveSMTP() {
    const smtp = await prisma.sMTPConfig.findFirst({ where: { isActive: true } });
    if (!smtp) throw new Error('Aucune configuration SMTP active');
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.password },
    });
    return { smtp, transporter };
  }

  async requestReset(email: string, originUrl: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    // Réponse générique même si l’utilisateur n’existe pas
    if (!user) return;

    // Invalider anciens tokens non utilisés
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });

    // Générer token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    });

    // Envoyer email
    const { smtp, transporter } = await this.getActiveSMTP();
    const resetLink = `${originUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
    await transporter.sendMail({
      from: `"${smtp.fromName || 'Support'}" <${smtp.fromEmail}>`,
      to: user.email,
      subject: 'Réinitialisation de mot de passe',
      html: `
        <p>Bonjour ${user.prenom || ''} ${user.nom || ''},</p>
        <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
        <p>Cliquez sur le lien ci-dessous (valide 30 minutes) :</p>
        <p><a href="${resetLink}">${resetLink}</a></p>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      `,
    });
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!record) throw new Error('Token invalide');
    if (record.usedAt) throw new Error('Token déjà utilisé');
    if (record.expiresAt < new Date()) throw new Error('Token expiré');

    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: hash } }),
      prisma.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } }),
    ]);
  }
}
