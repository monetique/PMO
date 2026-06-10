import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { PasswordResetService } from '../services/password-reset.service';
import { verifyRefreshToken, generateAccessToken } from '../utils/jwt';
import { prisma } from '../utils/prisma';
import { getEffectiveUiModules } from '../services/userUiModule.service';
import { AuthRequest } from '../middleware/auth';

const authService = new AuthService();
const passwordResetService = new PasswordResetService();

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const result = await authService.login(
      email,
      password,
      req.ip || req.socket.remoteAddress,
      req.headers['user-agent']
    );

    res.json(result);
  } catch (error: any) {
    // Mapper les codes d'erreur en messages spécifiques
    let errorMessage = error.message;
    if (error.message === 'EMAIL_INCORRECT') {
      errorMessage = 'Email incorrect';
    } else if (error.message === 'MOT_DE_PASSE_INCORRECT') {
      errorMessage = 'Mot de passe incorrect';
    }
    res.status(401).json({ error: errorMessage });
  }
};

export const refresh = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token requis' });
    }

    const payload = verifyRefreshToken(refreshToken);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    
    if (!user || user.statut !== 'actif') {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const newPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    res.json({
      token: generateAccessToken(newPayload),
    });
  } catch (error: any) {
    res.status(401).json({ error: 'Token invalide' });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, nom, prenom, role } = req.body;
    if (!email || !password || !nom || !prenom) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const user = await authService.register(email, password, nom, prenom, role);
    res.status(201).json(user);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const me = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({ error: 'Non authentifié' });
    }
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, email: true, nom: true, prenom: true, role: true, statut: true },
    });
    if (!user || user.statut !== 'actif') {
      return res.status(401).json({ error: 'Utilisateur introuvable ou inactif' });
    }
    const uiModules = await getEffectiveUiModules(user.id, user.role);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        role: user.role,
        uiModules,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    await passwordResetService.requestReset(email, req.headers['origin'] as string || process.env.FRONTEND_URL || 'http://localhost:5173');
    // Réponse générique pour éviter l’énumération d’emails
    res.json({ message: 'Si un compte existe pour cet email, un lien a été envoyé.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token et mot de passe requis' });

    await passwordResetService.resetPassword(token, password);
    res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
