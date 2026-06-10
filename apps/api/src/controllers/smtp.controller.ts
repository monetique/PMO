import { Response } from 'express';
import { SMTPService } from '../services/smtp.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';

const smtpService = new SMTPService();

export const getAllSMTPConfigs = async (req: AuthRequest, res: Response) => {
  try {
    const configs = await smtpService.findAll();
    res.json(configs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getSMTPConfig = async (req: AuthRequest, res: Response) => {
  try {
    const config = await smtpService.findOne(req.params.id);
    if (!config) {
      return res.status(404).json({ error: 'Configuration SMTP non trouvée' });
    }
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createSMTPConfig = async (req: AuthRequest, res: Response) => {
  try {
    // Log de débogage
    console.log('[SMTP CREATE] req.user:', req.user ? { userId: req.user.userId, email: req.user.email, role: req.user.role } : 'undefined');
    console.log('[SMTP CREATE] Authorization header:', req.headers.authorization ? 'présent' : 'absent');
    
    if (!req.user?.userId) {
      console.error('[SMTP CREATE] Erreur: req.user ou req.user.userId est undefined');
      console.error('[SMTP CREATE] req.user complet:', JSON.stringify(req.user, null, 2));
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const config = await smtpService.create(req.body, req.user.userId);
    await logAccess(req, res, 'creation', 'utilisateur', config.id, 'Configuration SMTP');
    res.status(201).json(config);
  } catch (error: any) {
    console.error('[SMTP CREATE] Erreur:', error);
    res.status(400).json({ error: error.message });
  }
};

export const updateSMTPConfig = async (req: AuthRequest, res: Response) => {
  try {
    // Log de débogage
    console.log('[SMTP UPDATE] req.user:', req.user ? { userId: req.user.userId, email: req.user.email, role: req.user.role } : 'undefined');
    console.log('[SMTP UPDATE] Authorization header:', req.headers.authorization ? 'présent' : 'absent');
    
    if (!req.user?.userId) {
      console.error('[SMTP UPDATE] Erreur: req.user ou req.user.userId est undefined');
      console.error('[SMTP UPDATE] req.user complet:', JSON.stringify(req.user, null, 2));
      return res.status(401).json({ error: 'Non authentifié' });
    }

    const config = await smtpService.update(req.params.id, req.body, req.user.userId);
    await logAccess(req, res, 'modification', 'utilisateur', config.id, 'Configuration SMTP');
    res.json(config);
  } catch (error: any) {
    console.error('[SMTP UPDATE] Erreur:', error);
    res.status(400).json({ error: error.message });
  }
};

export const deleteSMTPConfig = async (req: AuthRequest, res: Response) => {
  try {
    await smtpService.delete(req.params.id);
    await logAccess(req, res, 'suppression', 'utilisateur', req.params.id);
    res.status(204).send();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const testSMTPConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { testEmail } = req.body;
    const result = await smtpService.testConnection(req.params.id, testEmail);
    await logAccess(req, res, 'modification', 'utilisateur', req.params.id, 'Test SMTP');
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const testNotification = async (req: any, res: any) => {
  try {
    const { notificationId, testEmail, sujet, template } = req.body;
    if (!testEmail || !sujet || !template) {
      return res.status(400).json({ error: 'Email, sujet et template requis' });
    }
    const config = await smtpService.findActive();
    if (!config) {
      return res.status(400).json({ error: 'Aucune configuration SMTP active. Veuillez configurer le SMTP d\'abord.' });
    }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      tls: { rejectUnauthorized: false },
      auth: { user: config.user, pass: config.password },
    });
    await transporter.sendMail({
      from: `"${config.fromName || 'PMO Hub'}" <${config.fromEmail}>`,
      to: testEmail,
      subject: `[TEST] ${sujet}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #2563eb; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin:0; font-size:16px;">📧 Test de notification — PMO Hub</h2>
            <p style="margin:4px 0 0; font-size:12px; opacity:0.8;">Notification : ${notificationId}</p>
          </div>
          <div style="background: #fff8e1; border: 1px solid #f59e0b; padding: 12px 24px;">
            <p style="margin:0; font-size:12px; color:#92400e;">⚠️ Ceci est un email de test. Les valeurs entre [crochets] sont des variables remplacées automatiquement.</p>
          </div>
          <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
            <p style="font-size:13px; color:#374151; white-space:pre-wrap;">${template.replace(/\n/g, '<br>')}</p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">
            <p style="font-size:11px; color:#9ca3af;">PMO Hub — Notification automatique | Envoyé le ${new Date().toLocaleString('fr-FR')}</p>
          </div>
        </div>
      `,
    });
    res.json({ success: true, message: `Email de test envoyé à ${testEmail}` });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};
