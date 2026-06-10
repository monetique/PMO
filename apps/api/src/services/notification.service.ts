import { prisma } from '../utils/prisma';
import nodemailer from 'nodemailer';
import { recordNotificationEmailFailure } from './notification-email-failure.service';
import { NotificationSettingService, resolveEmailSettingKey } from './notification-setting.service';

export class NotificationService {
  private async canUserReceiveNotifications(userId?: string | null): Promise<boolean> {
    if (!userId) return true;
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { statut: true },
    });
    return row?.statut === 'actif';
  }

  // ── SMTP helper (même pattern que PasswordResetService) ───────────────────
  private async getActiveSMTP() {
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

  /** Envoie un email transactionnel ; en cas d’absence SMTP ou d’erreur, enregistre pour la page Configuration. */
  private async sendNotificationEmail(params: {
    kind: string;
    toEmail: string;
    toUserId?: string | null;
    subject: string;
    html: string;
    metadata?: Record<string, unknown>;
  }) {
    const settingKey = resolveEmailSettingKey(params.kind);
    if (!(await NotificationSettingService.isEmailEnabled(settingKey))) {
      return;
    }
    if (!(await this.canUserReceiveNotifications(params.toUserId))) {
      return;
    }
    const smtp = await this.getActiveSMTP();
    if (!smtp) {
      console.log('[NOTIF] Pas de config SMTP active — email non envoyé');
      await recordNotificationEmailFailure({
        kind: settingKey,
        toEmail: params.toEmail,
        toUserId: params.toUserId,
        subject: params.subject,
        htmlBody: params.html,
        errorMessage: 'Pas de configuration SMTP active',
        metadata: params.metadata,
      });
      return;
    }
    try {
      await smtp.transporter.sendMail({
        from: `"${smtp.smtp.fromName || 'PMO Hub'}" <${smtp.smtp.fromEmail}>`,
        to: params.toEmail,
        subject: params.subject,
        html: params.html,
      });
      console.log(`[NOTIF] Email ${params.kind} envoyé à ${params.toEmail}`);
    } catch (err) {
      console.error(`[NOTIF] Erreur envoi email (${params.kind}):`, err);
      await recordNotificationEmailFailure({
        kind: settingKey,
        toEmail: params.toEmail,
        toUserId: params.toUserId,
        subject: params.subject,
        htmlBody: params.html,
        errorMessage: err instanceof Error ? err.message : String(err),
        metadata: params.metadata,
      });
    }
  }

  // ── Créer une notification in-app ─────────────────────────────────────────
  async createNotification(data: {
    userId: string;
    type: string;
    titre: string;
    contenu: string;
    lienType?: string;
    lienId?: string;
  }) {
    return prisma.notification.create({ data });
  }

  private async createInAppIfEnabled(
    settingKey: string,
    data: {
      userId: string;
      type: string;
      titre: string;
      contenu: string;
      lienType?: string;
      lienId?: string;
    }
  ) {
    if (!(await NotificationSettingService.isAppEnabled(settingKey))) return;
    if (!(await this.canUserReceiveNotifications(data.userId))) return;
    try {
      await prisma.notification.create({ data });
    } catch {
      /* silencieux */
    }
  }

  // ── Récupérer les notifications d'un utilisateur ──────────────────────────
  async getNotifications(userId: string) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ── Marquer une notification comme lue ───────────────────────────────────
  async marquerLue(id: string, userId: string) {
    return prisma.notification.updateMany({
      where: { id, userId },
      data: { lue: true },
    });
  }

  // ── Marquer toutes comme lues ─────────────────────────────────────────────
  async marquerToutesLues(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, lue: false },
      data: { lue: true },
    });
  }

  // ── Compter les non lues ──────────────────────────────────────────────────
  async countNonLues(userId: string) {
    return prisma.notification.count({
      where: { userId, lue: false },
    });
  }

  // ── Envoyer email de mention ──────────────────────────────────────────────
  private libelleContexte(type: 'tache' | 'epic' | 'userStory' | 'pvReunion' | 'document' | 'licence' | 'processus' | 'projet' | 'contrat'): { sujet: string; intro: string; libelle: string; cta: string } {
    if (type === 'epic') {
      return {
        sujet: 'epic',
        intro: 'vous a mentionné dans un commentaire sur l’epic :',
        libelle: '📗 Epic',
        cta: 'Voir les tâches →',
      };
    }
    if (type === 'userStory') {
      return {
        sujet: 'user story',
        intro: 'vous a mentionné dans un commentaire sur la user story :',
        libelle: '📘 User story',
        cta: 'Voir les tâches →',
      };
    }
    if (type === 'pvReunion') {
      return {
        sujet: 'PV de réunion',
        intro: 'vous a mentionné dans un commentaire sur le PV de réunion :',
        libelle: '📝 PV',
        cta: 'Voir le PV →',
      };
    }
    if (type === 'document') {
      return {
        sujet: 'document',
        intro: 'vous a mentionné dans un commentaire sur le document :',
        libelle: '📎 Document',
        cta: 'Voir les documents →',
      };
    }
    if (type === 'licence') {
      return {
        sujet: 'licence',
        intro: 'vous a mentionné dans un commentaire sur la licence :',
        libelle: '📄 Licence',
        cta: 'Voir les licences →',
      };
    }
    if (type === 'processus') {
      return {
        sujet: 'processus',
        intro: 'vous a mentionné dans un commentaire lié au processus :',
        libelle: '⚙️ Processus',
        cta: 'Voir le processus →',
      };
    }
    if (type === 'projet') {
      return {
        sujet: 'projet',
        intro: 'vous a mentionné dans un commentaire lié au projet :',
        libelle: '📁 Projet',
        cta: 'Voir le projet →',
      };
    }
    if (type === 'contrat') {
      return {
        sujet: 'contrat',
        intro: 'vous a mentionné dans un commentaire lié au contrat :',
        libelle: '📑 Contrat',
        cta: 'Voir les contrats →',
      };
    }
    return {
      sujet: 'tâche',
      intro: 'vous a mentionné dans un commentaire de la tâche :',
      libelle: '📋',
      cta: 'Voir la tâche →',
    };
  }

  async envoyerEmailMention(data: {
    destinataireEmail: string;
    destinataireNom: string;
    destinataireUserId?: string;
    auteurNom: string;
    commentaireContenu: string;
    appUrl: string;
    context: { type: 'tache' | 'epic' | 'userStory' | 'pvReunion' | 'document' | 'licence' | 'processus' | 'projet' | 'contrat'; id: string; titre: string };
    notificationKind?: string;
  }) {
    const lien =
      data.context.type === 'pvReunion'
        ? `${data.appUrl}/pv-reunion/${data.context.id}`
        : data.context.type === 'processus'
          ? `${data.appUrl}/processus/${data.context.id}`
          : data.context.type === 'projet'
            ? `${data.appUrl}/projets/${data.context.id}`
            : data.context.type === 'contrat'
              ? `${data.appUrl}/contrats`
        : data.context.type === 'licence'
          ? `${data.appUrl}/licences`
          : data.context.type === 'document'
            ? `${data.appUrl}/documents`
        : `${data.appUrl}/taches`;
    const L = this.libelleContexte(data.context.type);
    const subject = `📌 Mention (${L.sujet}) : ${data.context.titre}`;
    const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
              <h2 style="margin:0;">📌 Nouvelle mention</h2>
            </div>
            <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
              <p>Bonjour <strong>${data.destinataireNom}</strong>,</p>
              <p><strong>${data.auteurNom}</strong> ${L.intro}</p>
              <div style="background: white; border-left: 4px solid #2563eb; padding: 12px; margin: 16px 0; border-radius: 4px;">
                <p style="margin:0; font-weight: bold; color: #1d4ed8;">${L.libelle} ${data.context.titre}</p>
                <p style="margin: 8px 0 0; color: #374151; font-style: italic;">"${data.commentaireContenu}"</p>
              </div>
              <a href="${lien}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-top: 8px;">
                ${L.cta}
              </a>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 20px;">PMO Hub — Notification automatique</p>
            </div>
          </div>
        `;
    await this.sendNotificationEmail({
      kind: data.notificationKind || 'mention',
      toEmail: data.destinataireEmail,
      toUserId: data.destinataireUserId,
      subject,
      html,
      metadata: { contextType: data.context.type, titre: data.context.titre },
    });
  }

  // ── Traiter les mentions dans un commentaire ──────────────────────────────
  // Extrait les @Prénom Nom du texte et notifie chaque personne trouvée
  async traiterMentions(data: {
    contenu: string;
    auteurId: string;
    auteurNom: string;
    appUrl: string;
    context: { type: 'tache' | 'epic' | 'userStory' | 'pvReunion' | 'document' | 'licence' | 'processus' | 'projet' | 'contrat'; id: string; titre: string };
  }) {
    // Extraire les mentions @Prénom Nom (2 mots après @)
    const mentionRegex = /@([A-Za-zÀ-ÿ]+\s+[A-Za-zÀ-ÿ]+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(data.contenu)) !== null) {
      mentions.push(match[1].trim());
    }

    if (mentions.length === 0) return;

    // Récupérer tous les utilisateurs
    const users = await prisma.user.findMany({
      select: { id: true, nom: true, prenom: true, email: true },
    });

    const mentionSettingKey =
      data.context.type === 'pvReunion'
        ? 'mention_pv'
        : data.context.type === 'document'
          ? 'mention_document'
          : data.context.type === 'licence'
            ? 'mention_licence'
            : data.context.type === 'processus'
              ? 'mention_processus'
              : data.context.type === 'projet'
                ? 'mention_projet'
                : data.context.type === 'contrat'
                  ? 'mention_contrat'
            : 'mention';
    for (const mention of mentions) {
      // Trouver l'utilisateur correspondant (insensible à la casse)
      const user = users.find(u =>
        `${u.prenom} ${u.nom}`.toLowerCase() === mention.toLowerCase() ||
        `${u.nom} ${u.prenom}`.toLowerCase() === mention.toLowerCase()
      );

      if (!user || user.id === data.auteurId) continue;

      await this.createInAppIfEnabled(mentionSettingKey, {
        userId: user.id,
        type: 'mention',
        titre: `Mention : "${data.context.titre}"`,
        contenu: `${data.auteurNom} : ${data.contenu.substring(0, 100)}${data.contenu.length > 100 ? '...' : ''}`,
        lienType: data.context.type,
        lienId: data.context.id,
      });

      // Email
      await this.envoyerEmailMention({
        destinataireEmail: user.email,
        destinataireNom: `${user.prenom} ${user.nom}`,
        destinataireUserId: user.id,
        auteurNom: data.auteurNom,
        commentaireContenu: data.contenu,
        appUrl: data.appUrl,
        context: { type: data.context.type, id: data.context.id, titre: data.context.titre },
        notificationKind: mentionSettingKey,
      });
    }
  }

  // ── Assignation à une tâche ───────────────────────────────────────────────
  async notifierAssignation(data: {
    tacheId: string;
    tacheNom: string;
    assigneUserId: string;
    assigneEmail: string;
    assigneNom: string;
    auteurNom: string;
    appUrl: string;
  }) {
    await this.createInAppIfEnabled('assignation', {
      userId: data.assigneUserId,
      type: 'assignation',
      titre: `Vous avez été assigné à "${data.tacheNom}"`,
      contenu: `${data.auteurNom} vous a assigné à cette tâche.`,
      lienType: 'tache', lienId: data.tacheId,
    });
    await this.sendNotificationEmail({
      kind: 'assignation',
      toEmail: data.assigneEmail,
      toUserId: data.assigneUserId,
      subject: `✅ Nouvelle assignation : ${data.tacheNom}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px">
          <div style="background:#2563eb;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">✅ Nouvelle assignation</h2></div>
          <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
            <p>Bonjour <strong>${data.assigneNom}</strong>,</p>
            <p><strong>${data.auteurNom}</strong> vous a assigné à la tâche :</p>
            <div style="background:white;border-left:4px solid #2563eb;padding:12px;margin:16px 0;border-radius:4px">
              <p style="margin:0;font-weight:bold;color:#1d4ed8">📋 ${data.tacheNom}</p>
            </div>
            <a href="${data.appUrl}/taches" style="display:inline-block;background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Voir la tâche →</a>
            <p style="color:#9ca3af;font-size:12px;margin-top:20px">PMO Hub — Notification automatique</p>
          </div></div>`,
      metadata: { tacheId: data.tacheId },
    });
  }

  // ── Assignation à un projet ──────────────────────────────────────────────
  async notifierAssignationProjet(data: {
    projetId: string;
    projetNom: string;
    assigneUserId: string;
    assigneEmail: string;
    assigneNom: string;
    auteurNom: string;
    appUrl: string;
    roles: string[];
  }) {
    const rolesLabel = data.roles.length ? data.roles.join(', ') : 'membre du projet';
    await this.createInAppIfEnabled('assignation_projet', {
      userId: data.assigneUserId,
      type: 'assignation_projet',
      titre: `Vous avez été assigné au projet "${data.projetNom}"`,
      contenu: `${data.auteurNom} vous a assigné (${rolesLabel}).`,
      lienType: 'projet',
      lienId: data.projetId,
    });
    await this.sendNotificationEmail({
      kind: 'assignation_projet',
      toEmail: data.assigneEmail,
      toUserId: data.assigneUserId,
      subject: `✅ Assignation projet : ${data.projetNom}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px">
          <div style="background:#0b5fff;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">✅ Assignation à un projet</h2></div>
          <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
            <p>Bonjour <strong>${data.assigneNom}</strong>,</p>
            <p><strong>${data.auteurNom}</strong> vous a assigné au projet :</p>
            <div style="background:white;border-left:4px solid #0b5fff;padding:12px;margin:16px 0;border-radius:4px">
              <p style="margin:0;font-weight:bold;color:#0b5fff">📁 ${data.projetNom}</p>
              <p style="margin:6px 0 0;color:#374151">Rôle(s) : <strong>${rolesLabel}</strong></p>
            </div>
            <a href="${data.appUrl}/projets/${data.projetId}" style="display:inline-block;background:#0b5fff;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Voir le projet →</a>
            <p style="color:#9ca3af;font-size:12px;margin-top:20px">PMO Hub — Notification automatique</p>
          </div></div>`,
      metadata: { projetId: data.projetId, roles: data.roles },
    });
  }

  // ── Changement de statut ──────────────────────────────────────────────────
  async notifierChangementStatut(data: {
    tacheId: string; tacheNom: string; ancienStatut: string; nouveauStatut: string;
    destinataires: { id: string; email: string; nom: string }[];
    auteurNom: string; appUrl: string;
  }) {
    const statutLabels: Record<string, string> = {
      cree: 'Créée', a_faire: 'À faire', en_cours: 'En cours',
      en_attente: 'En attente', bloque: '🔴 Bloqué', termine: '✅ Terminé', archive: 'Archivée'
    };
    const nouveauLabel = statutLabels[data.nouveauStatut] || data.nouveauStatut;
    const ancienLabel = statutLabels[data.ancienStatut] || data.ancienStatut;

    for (const dest of data.destinataires) {
      await this.createInAppIfEnabled('statut', {
        userId: dest.id, type: 'statut',
        titre: `Statut modifié : "${data.tacheNom}" → ${nouveauLabel}`,
        contenu: `${data.auteurNom} a changé le statut de ${ancienLabel} à ${nouveauLabel}.`,
        lienType: 'tache', lienId: data.tacheId,
      });
      await this.sendNotificationEmail({
        kind: 'statut',
        toEmail: dest.email,
        toUserId: dest.id,
        subject: `🔄 Statut modifié : ${data.tacheNom}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
            <div style="background:#7c3aed;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">🔄 Changement de statut</h2></div>
            <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
              <p>Bonjour <strong>${dest.nom}</strong>,</p>
              <p><strong>${data.auteurNom}</strong> a modifié le statut de la tâche <strong>${data.tacheNom}</strong> :</p>
              <div style="background:white;border-left:4px solid #7c3aed;padding:12px;margin:16px 0;border-radius:4px">
                <p style="margin:0">${ancienLabel} → <strong>${nouveauLabel}</strong></p>
              </div>
              <a href="${data.appUrl}/taches" style="display:inline-block;background:#7c3aed;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Voir la tâche →</a>
            </div></div>`,
        metadata: { tacheId: data.tacheId },
      });
    }
  }

  // ── Tâche en retard ───────────────────────────────────────────────────────
  async notifierRetard(data: {
    tacheId: string; tacheNom: string; joursRetard: number;
    destinataires: { id: string; email: string; nom: string }[];
    appUrl: string;
  }) {
    for (const dest of data.destinataires) {
      await this.createInAppIfEnabled('retard', {
        userId: dest.id, type: 'retard',
        titre: `⚠️ Tâche en retard : "${data.tacheNom}"`,
        contenu: `Cette tâche est en retard de ${data.joursRetard} jour(s).`,
        lienType: 'tache', lienId: data.tacheId,
      });
      await this.sendNotificationEmail({
        kind: 'retard',
        toEmail: dest.email,
        toUserId: dest.id,
        subject: `⚠️ Tâche en retard : ${data.tacheNom}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
            <div style="background:#dc2626;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">⚠️ Tâche en retard</h2></div>
            <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
              <p>Bonjour <strong>${dest.nom}</strong>,</p>
              <p>La tâche suivante est en retard de <strong>${data.joursRetard} jour(s)</strong> :</p>
              <div style="background:white;border-left:4px solid #dc2626;padding:12px;margin:16px 0;border-radius:4px">
                <p style="margin:0;font-weight:bold;color:#dc2626">📋 ${data.tacheNom}</p>
              </div>
              <a href="${data.appUrl}/taches" style="display:inline-block;background:#dc2626;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Voir la tâche →</a>
            </div></div>`,
        metadata: { tacheId: data.tacheId, joursRetard: data.joursRetard },
      });
    }
  }

  // ── Nouvelle tâche liée à un projet ───────────────────────────────────────
  async notifierNouvelleTacheProjet(data: {
    tacheId: string; tacheNom: string; projetNom: string;
    membres: { id: string; email: string; nom: string }[];
    createurNom: string; appUrl: string;
  }) {
    for (const membre of data.membres) {
      await this.createInAppIfEnabled('nouvelle_tache', {
        userId: membre.id, type: 'nouvelle_tache',
        titre: `Nouvelle tâche dans "${data.projetNom}"`,
        contenu: `${data.createurNom} a créé la tâche "${data.tacheNom}".`,
        lienType: 'tache', lienId: data.tacheId,
      });
      await this.sendNotificationEmail({
        kind: 'nouvelle_tache_projet',
        toEmail: membre.email,
        toUserId: membre.id,
        subject: `📋 Nouvelle tâche dans ${data.projetNom}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
            <div style="background:#059669;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">📋 Nouvelle tâche</h2></div>
            <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
              <p>Bonjour <strong>${membre.nom}</strong>,</p>
              <p><strong>${data.createurNom}</strong> a créé une nouvelle tâche dans le projet <strong>${data.projetNom}</strong> :</p>
              <div style="background:white;border-left:4px solid #059669;padding:12px;margin:16px 0;border-radius:4px">
                <p style="margin:0;font-weight:bold;color:#059669">📋 ${data.tacheNom}</p>
              </div>
              <a href="${data.appUrl}/taches" style="display:inline-block;background:#059669;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Voir la tâche →</a>
            </div></div>`,
        metadata: { tacheId: data.tacheId, projetNom: data.projetNom },
      });
    }
  }

  // ── Commentaire sur une tâche ─────────────────────────────────────────────
  async notifierCommentaireSurCible(data: {
    cibleType: 'tache' | 'epic' | 'userStory';
    cibleId: string;
    cibleNom: string;
    commentaire: string;
    destinataires: { id: string; email: string; nom: string }[];
    auteurNom: string;
    appUrl: string;
  }) {
    const intro =
      data.cibleType === 'epic'
        ? `a commenté l’epic <strong>${data.cibleNom}</strong> :`
        : data.cibleType === 'userStory'
          ? `a commenté la user story <strong>${data.cibleNom}</strong> :`
          : `a commenté la tâche <strong>${data.cibleNom}</strong> :`;
    const cta =
      data.cibleType === 'tache' ? 'Voir la tâche →' : 'Voir les tâches →';

    const settingKey =
      data.cibleType === 'epic'
        ? 'commentaire_epic'
        : data.cibleType === 'userStory'
          ? 'commentaire_user_story'
          : 'commentaire';

    for (const dest of data.destinataires) {
      await this.createInAppIfEnabled(settingKey, {
        userId: dest.id,
        type: 'commentaire',
        titre: `Nouveau commentaire sur "${data.cibleNom}"`,
        contenu: `${data.auteurNom} : ${data.commentaire.substring(0, 100)}`,
        lienType: data.cibleType,
        lienId: data.cibleId,
      });
      await this.sendNotificationEmail({
        kind: settingKey,
        toEmail: dest.email,
        toUserId: dest.id,
        subject: `💬 Nouveau commentaire : ${data.cibleNom}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
            <div style="background:#0284c7;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">💬 Nouveau commentaire</h2></div>
            <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
              <p>Bonjour <strong>${dest.nom}</strong>,</p>
              <p><strong>${data.auteurNom}</strong> ${intro}</p>
              <div style="background:white;border-left:4px solid #0284c7;padding:12px;margin:16px 0;border-radius:4px;font-style:italic">
                "${data.commentaire.substring(0, 200)}${data.commentaire.length > 200 ? '...' : ''}"
              </div>
              <a href="${data.appUrl}/taches" style="display:inline-block;background:#0284c7;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">${cta}</a>
            </div></div>`,
        metadata: { cibleType: data.cibleType, cibleId: data.cibleId },
      });
    }
  }

  async notifierCommentaire(data: {
    tacheId: string;
    tacheNom: string;
    commentaire: string;
    destinataires: { id: string; email: string; nom: string }[];
    auteurNom: string;
    appUrl: string;
  }) {
    return this.notifierCommentaireSurCible({
      cibleType: 'tache',
      cibleId: data.tacheId,
      cibleNom: data.tacheNom,
      commentaire: data.commentaire,
      destinataires: data.destinataires,
      auteurNom: data.auteurNom,
      appUrl: data.appUrl,
    });
  }

  // ── Document uploadé ──────────────────────────────────────────────────────
  async notifierCommentairePvReunion(data: {
    pvId: string;
    pvTitre: string;
    commentaire: string;
    destinataires: { id: string; email: string; nom: string }[];
    auteurNom: string;
    appUrl: string;
    pieceJointeNom?: string;
    /** Si true : le commentaire est assigné à chaque destinataire (e-mail + in-app explicites). */
    estAssignation?: boolean;
  }) {
    const lien = `${data.appUrl}/pv-reunion/${data.pvId}`;
    const pieceHtml = data.pieceJointeNom
      ? `<p style="margin:12px 0">📎 Pièce jointe : <strong>${data.pieceJointeNom}</strong></p>`
      : '';
    const assign = !!data.estAssignation;
    for (const dest of data.destinataires) {
      await this.createInAppIfEnabled('commentaire_pv', {
        userId: dest.id,
        type: assign ? 'commentaire_pv_assigne' : 'commentaire_pv',
        titre: assign
          ? `Commentaire qui vous est assigné — « ${data.pvTitre} »`
          : `Commentaire sur « ${data.pvTitre} »`,
        contenu: assign
          ? `${data.auteurNom} vous a assigné un commentaire sur ce PV : ${data.commentaire.substring(0, 100)}${data.commentaire.length > 100 ? '…' : ''}`
          : `${data.auteurNom} : ${data.commentaire.substring(0, 100)}${data.commentaire.length > 100 ? '...' : ''}`,
        lienType: 'pvReunion',
        lienId: data.pvId,
      });
      const introAssign = `<p><strong>${data.auteurNom}</strong> vous a <strong>assigné</strong> un commentaire sur le procès-verbal <strong>${data.pvTitre}</strong> :</p>`;
      const introGeneral = `<p><strong>${data.auteurNom}</strong> a commenté le procès-verbal <strong>${data.pvTitre}</strong> :</p>`;
      await this.sendNotificationEmail({
        kind: assign ? 'commentaire_pv_assigne' : 'commentaire_pv',
        toEmail: dest.email,
        toUserId: dest.id,
        subject: assign
          ? `Commentaire PV qui vous est assigné : ${data.pvTitre}`
          : `💬 Commentaire sur PV : ${data.pvTitre}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
            <div style="background:#0369a1;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">${assign ? '✅ Commentaire assigné' : '💬 PV de réunion'}</h2></div>
            <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
              <p>Bonjour <strong>${dest.nom}</strong>,</p>
              ${assign ? introAssign : introGeneral}
              <div style="background:white;border-left:4px solid #0369a1;padding:12px;margin:16px 0;border-radius:4px;font-style:italic">
                "${data.commentaire.substring(0, 400)}${data.commentaire.length > 400 ? '...' : ''}"
              </div>
              ${pieceHtml}
              <a href="${lien}" style="display:inline-block;background:#0369a1;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Ouvrir le PV →</a>
            </div></div>`,
        metadata: { pvId: data.pvId, assign },
      });
    }
  }

  async notifierAssignationActionPvReunion(data: {
    pvId: string;
    pvTitre: string;
    actionLabel: string;
    destinataire: { id: string; email: string; nom: string };
    auteurNom: string;
    appUrl: string;
  }) {
    const lien = `${data.appUrl}/pv-reunion/${data.pvId}`;
    await this.createInAppIfEnabled('assignation_action_pv', {
      userId: data.destinataire.id,
      type: 'assignation_action_pv',
      titre: `Action PV assignée — « ${data.pvTitre} »`,
      contenu: `${data.auteurNom} vous a assigné une action : ${data.actionLabel}`,
      lienType: 'pvReunion',
      lienId: data.pvId,
    });
    await this.sendNotificationEmail({
      kind: 'assignation_action_pv',
      toEmail: data.destinataire.email,
      toUserId: data.destinataire.id,
      subject: `✅ Action assignée sur PV : ${data.pvTitre}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px">
          <div style="background:#0f766e;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">✅ Action PV assignée</h2></div>
          <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
            <p>Bonjour <strong>${data.destinataire.nom}</strong>,</p>
            <p><strong>${data.auteurNom}</strong> vous a assigné une action dans le procès-verbal <strong>${data.pvTitre}</strong> :</p>
            <div style="background:white;border-left:4px solid #0f766e;padding:12px;margin:16px 0;border-radius:4px">
              <p style="margin:0;font-weight:bold;color:#0f766e">📝 ${data.actionLabel}</p>
            </div>
            <a href="${lien}" style="display:inline-block;background:#0f766e;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Ouvrir le PV →</a>
          </div></div>`,
      metadata: { pvId: data.pvId },
    });
  }

  async notifierDocumentUploade(data: {
    tacheId: string; tacheNom: string; documentNom: string;
    destinataires: { id: string; email: string; nom: string }[];
    auteurNom: string; appUrl: string;
  }) {
    for (const dest of data.destinataires) {
      await this.createInAppIfEnabled('document', {
        userId: dest.id, type: 'document',
        titre: `Nouveau document dans "${data.tacheNom}"`,
        contenu: `${data.auteurNom} a uploadé "${data.documentNom}".`,
        lienType: 'tache', lienId: data.tacheId,
      });
      await this.sendNotificationEmail({
        kind: 'document',
        toEmail: dest.email,
        toUserId: dest.id,
        subject: `📎 Nouveau document : ${data.tacheNom}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px">
            <div style="background:#d97706;color:white;padding:20px;border-radius:8px 8px 0 0"><h2 style="margin:0">📎 Nouveau document</h2></div>
            <div style="background:#f9fafb;padding:20px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px">
              <p>Bonjour <strong>${dest.nom}</strong>,</p>
              <p><strong>${data.auteurNom}</strong> a uploadé un document sur la tâche <strong>${data.tacheNom}</strong> :</p>
              <div style="background:white;border-left:4px solid #d97706;padding:12px;margin:16px 0;border-radius:4px">
                <p style="margin:0">📎 <strong>${data.documentNom}</strong></p>
              </div>
              <a href="${data.appUrl}/taches" style="display:inline-block;background:#d97706;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Voir la tâche →</a>
            </div></div>`,
        metadata: { tacheId: data.tacheId, documentNom: data.documentNom },
      });
    }
  }

}