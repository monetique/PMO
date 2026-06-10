import { prisma } from '../utils/prisma';
import nodemailer from 'nodemailer';

export interface SMTPConfigData {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName?: string;
  isActive?: boolean;
}

export class SMTPService {
  async findAll() {
    return prisma.sMTPConfig.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        updatedBy: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    return prisma.sMTPConfig.findUnique({
      where: { id },
      include: {
        updatedBy: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
          },
        },
      },
    });
  }

  async findActive() {
    return prisma.sMTPConfig.findFirst({
      where: { isActive: true },
    });
  }

  async create(data: SMTPConfigData, updatedById: string) {
    // Si cette config est marquée comme active, désactiver toutes les autres
    if (data.isActive) {
      await prisma.sMTPConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
    }

    return prisma.sMTPConfig.create({
      data: {
        ...data,
        updatedById,
      },
      include: {
        updatedBy: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
          },
        },
      },
    });
  }

  async update(id: string, data: Partial<SMTPConfigData>, updatedById: string) {
    // Si cette config est marquée comme active, désactiver toutes les autres
    if (data.isActive) {
      await prisma.sMTPConfig.updateMany({
        where: { isActive: true, id: { not: id } },
        data: { isActive: false },
      });
    }

    // Si le mot de passe n'est pas fourni, ne pas le mettre à jour
    const updateData: any = {
      ...data,
      updatedById,
    };
    
    // Si password est une chaîne vide, ne pas l'inclure dans la mise à jour
    if (updateData.password === '' || updateData.password === undefined) {
      delete updateData.password;
    }

    return prisma.sMTPConfig.update({
      where: { id },
      data: updateData,
      include: {
        updatedBy: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
          },
        },
      },
    });
  }

  async delete(id: string) {
    return prisma.sMTPConfig.delete({
      where: { id },
    });
  }

  async testConnection(configId: string, testEmail?: string) {
    const config = await prisma.sMTPConfig.findUnique({
      where: { id: configId },
    });

    if (!config) {
      throw new Error('Configuration SMTP non trouvée');
    }

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure, // true pour 465, false pour autres ports
      tls: { rejectUnauthorized: false },
      auth: {
        user: config.user,
        pass: config.password,
      },
    });

    try {
      // Vérifier la connexion
      await transporter.verify();

      // Si un email de test est fourni, envoyer un email de test
      if (testEmail) {
        await transporter.sendMail({
          from: `"${config.fromName || 'Test SMTP'}" <${config.fromEmail}>`,
          to: testEmail,
          subject: 'Test de configuration SMTP',
          html: `
            <h2>Test de configuration SMTP</h2>
            <p>Ceci est un email de test pour vérifier que la configuration SMTP fonctionne correctement.</p>
            <p>Configuration testée : ${config.host}:${config.port}</p>
            <p>Date : ${new Date().toLocaleString('fr-FR')}</p>
          `,
        });
      }

      // Mettre à jour le résultat du test
      await prisma.sMTPConfig.update({
        where: { id: configId },
        data: {
          lastTestAt: new Date(),
          lastTestResult: {
            success: true,
            message: testEmail ? `Email de test envoyé avec succès à ${testEmail}` : 'Connexion SMTP réussie',
            timestamp: new Date().toISOString(),
          },
        },
      });

      return {
        success: true,
        message: testEmail ? `Email de test envoyé avec succès à ${testEmail}` : 'Connexion SMTP réussie',
      };
    } catch (error: any) {
      // Enregistrer l'erreur
      await prisma.sMTPConfig.update({
        where: { id: configId },
        data: {
          lastTestAt: new Date(),
          lastTestResult: {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString(),
          },
        },
      });

      throw new Error(`Échec du test SMTP : ${error.message}`);
    }
  }
}

