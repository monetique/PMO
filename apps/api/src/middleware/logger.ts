import { Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from './auth';
import { LogAction, ResourceType } from '../generated/prisma/enums';

export const logAccess = async (
  req: AuthRequest,
  res: Response,
  action: LogAction,
  ressourceType: ResourceType,
  ressourceId?: string,
  ressourceNom?: string,
  details?: any
) => {
  try {
    const userId = req.user?.userId || 'anonymous';
    
    await prisma.journalAcces.create({
      data: {
        userId,
        action,
        ressourceType,
        ressourceId,
        ressourceNom,
        details,
        ipAddress: req.ip || req.socket.remoteAddress || undefined,
        userAgent: req.headers['user-agent'] || undefined,
      },
    });
  } catch (error) {
    console.error('Erreur lors de la journalisation:', error);
  }
};

export const logger = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const originalSend = res.send;
  
  res.send = function (data) {
    // Log après l'envoi de la réponse
    const action: LogAction = 
      req.method === 'GET' ? 'lecture' :
      req.method === 'POST' ? 'creation' :
      req.method === 'PUT' || req.method === 'PATCH' ? 'modification' :
      req.method === 'DELETE' ? 'suppression' : 'lecture';

    // Déterminer le type de ressource depuis l'URL
    const urlParts = req.path.split('/').filter(Boolean);
    let ressourceType: ResourceType = 'utilisateur';
    if (urlParts.includes('processus')) ressourceType = 'processus';
    else if (urlParts.includes('projet')) ressourceType = 'projet';
    else if (urlParts.includes('document')) ressourceType = 'document';
    else if (urlParts.includes('entite')) ressourceType = 'entite';
    else if (urlParts.includes('licences')) ressourceType = 'licence';
    else if (urlParts.includes('clients-fournisseurs')) ressourceType = 'clientFournisseur';
    else if (urlParts.includes('contrats')) ressourceType = 'contrat';
    else if (urlParts.includes('taches')) ressourceType = 'tache';
    else if (urlParts.includes('epics')) ressourceType = 'epic';
    else if (urlParts.includes('user-stories')) ressourceType = 'userStory';
    else if (urlParts.includes('pv-reunions')) ressourceType = 'pvReunion';

    const ressourceId = req.params.id;
    
    if (req.user && ressourceType !== 'utilisateur') {
      logAccess(req, res, action, ressourceType, ressourceId, undefined, {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
      }).catch(console.error);
    }

    return originalSend.call(this, data);
  };

  next();
};
