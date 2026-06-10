import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '../utils/jwt';

export interface AuthRequest extends Request {
  user?: JWTPayload;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Laisser passer les requêtes de préflight CORS
    if (req.method === 'OPTIONS') {
      return next();
    }

    // Essayer d'abord le header Authorization, puis le paramètre de requête (pour les téléchargements directs)
    let token: string | undefined;
    
    const rawHeader = (req.get('authorization') || (req.headers as any).authorization || (req.headers as any).Authorization) as string | undefined;
    if (rawHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(rawHeader.trim());
      if (match && match[1]) {
        token = match[1].trim();
      }
    }
    
    // Si pas de token dans le header, essayer le paramètre de requête
    if (!token && req.query.token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    if (!token) {
      console.warn('[AUTH] No Authorization header or token query param. headers=', req.headers);
      return res.status(401).json({ error: 'Token manquant', reason: 'no authorization header or token param' });
    }

    const payload = verifyAccessToken(token);
    req.user = payload;
    // Log pour les requêtes SMTP
    if (req.path.includes('/smtp')) {
      console.log('[AUTH] Requête SMTP authentifiée:', {
        path: req.path,
        method: req.method,
        userId: payload.userId,
        email: payload.email,
        role: payload.role
      });
    }
    next();
  } catch (error) {
    // Log détaillé côté serveur pour diagnostiquer (invalid signature, jwt expired, etc.)
    // En dev, on renvoie aussi la raison pour faciliter le debug côté client
    const reason = (error as any)?.message || 'invalid token';
    console.error('[AUTH] JWT error:', reason);
    return res.status(401).json({ error: 'Token invalide ou expiré', reason });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non authentifié' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Accès refusé' });
    }

    next();
  };
};
