import { prisma } from '../utils/prisma';
import { hashPassword } from '../utils/hash';
import { Role, UserStatus } from '@prisma/client';
import { getEntiteDescendantIds, getUserDirectEntiteIds, keepMostSpecificEntiteIds } from '../utils/entiteScope';

function fonctionFromInput(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

export class UserService {
  private async getUserEntiteIds(userId: string): Promise<string[]> {
    const direct = await getUserDirectEntiteIds(userId);
    return keepMostSpecificEntiteIds(direct);
  }

  private async getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
    return getEntiteDescendantIds([...new Set((rootIds || []).filter(Boolean))]);
  }

  private async getScopedEntiteIdsForUser(userId: string): Promise<string[]> {
    const own = await this.getUserEntiteIds(userId);
    return this.getEntiteDescendantIds(own);
  }

  async findAll(filters?: {
    role?: Role;
    entiteId?: string;
    statut?: UserStatus;
    search?: string;
    nom?: string;
    email?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    requesterId?: string;
    requesterRole?: Role | string;
  }) {
    const where: any = {};
    if (filters?.requesterRole && filters.requesterRole !== 'admin' && filters?.requesterId) {
      const scopedEntiteIds = await this.getScopedEntiteIdsForUser(filters.requesterId);
      if (!scopedEntiteIds.length) {
        where.id = '__NO_USER_SCOPE__';
      } else {
        where.AND = where.AND || [];
        where.AND.push({
          entitesMembres: { some: { entiteId: { in: scopedEntiteIds } } },
        });
      }
    }
    if (filters?.role) where.role = filters.role;
    if (filters?.entiteId) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { entitesMembres: { some: { entiteId: filters.entiteId } } },
          {
            entitesResponsable: {
              some: { id: filters.entiteId, deletedAt: null },
            },
          },
        ],
      });
    }
    if (filters?.statut) where.statut = filters.statut;
    
    // Filtre par nom (recherche dans nom et prénom)
    if (filters?.nom) {
      where.AND = where.AND || [];
      where.AND.push({
        OR: [
          { nom: { contains: filters.nom, mode: 'insensitive' } },
          { prenom: { contains: filters.nom, mode: 'insensitive' } },
        ],
      });
    }
    
    // Filtre par email
    if (filters?.email) {
      where.AND = where.AND || [];
      where.AND.push({
        email: { contains: filters.email, mode: 'insensitive' },
      });
    }
    
    // Recherche générale (pour compatibilité avec l'ancien système)
    if (filters?.search && !filters?.nom && !filters?.email) {
      where.OR = [
        { email: { contains: filters.search, mode: 'insensitive' } },
        { nom: { contains: filters.search, mode: 'insensitive' } },
        { prenom: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Définir l'ordre de tri
    let orderBy: any = { nom: 'asc' }; // Par défaut, tri par nom croissant
    
    if (filters?.sortBy) {
      const sortOrder = filters.sortOrder || 'asc';
      
      switch (filters.sortBy) {
        case 'nom':
          orderBy = { nom: sortOrder };
          break;
        case 'email':
          orderBy = { email: sortOrder };
          break;
        case 'role':
          orderBy = { role: sortOrder };
          break;
        case 'statut':
          orderBy = { statut: sortOrder };
          break;
        case 'entites':
          // Pour les entités, on trie par le nom de la première entité
          // Note: Prisma ne supporte pas directement le tri par relation, donc on trie côté application
          orderBy = { nom: sortOrder }; // Tri par défaut, le tri par entités sera fait côté frontend
          break;
        default:
          orderBy = { nom: 'asc' };
      }
    }

    return prisma.user.findMany({
      where,
      include: {
        entitesMembres: {
          include: {
            entite: { select: { id: true, nom: true, code: true } },
          },
        },
        _count: {
          select: {
            processusProprietaire: true,
            documentsUploaded: true,
          },
        },
      },
      orderBy,
    });
  }

  async findOne(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        entitesMembres: {
          include: {
            entite: true,
          },
        },
        entitesResponsable: {
          where: { deletedAt: null },
          select: { id: true, nom: true, code: true },
        },
        processusProprietaire: { take: 10, orderBy: { updatedAt: 'desc' } },
        documentsUploaded: { take: 10, orderBy: { createdAt: 'desc' } },
        journalAcces: {
          take: 20,
          orderBy: { timestamp: 'desc' },
        },
      },
    });
  }

  async create(data: {
    email: string;
    password: string;
    nom: string;
    prenom: string;
    fonction?: string | null;
    role?: Role;
    statut?: UserStatus;
    entiteIds?: string[];
  }) {
    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) {
      throw new Error('Email déjà utilisé');
    }

    const passwordHash = await hashPassword(data.password);
    const { entiteIds } = data;
    
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        nom: data.nom,
        prenom: data.prenom,
        role: data.role || 'contributeur',
        statut: data.statut || 'actif',
        entitesMembres: entiteIds && entiteIds.length > 0 ? {
          create: entiteIds.map((entiteId) => ({
            entiteId,
          })),
        } : undefined,
      },
      include: {
        entitesMembres: {
          include: {
            entite: { select: { id: true, nom: true } },
          },
        },
      },
    });
  }

  async update(id: string, data: {
    nom?: string;
    prenom?: string;
    email?: string;
    fonction?: string | null;
    role?: Role;
    entiteIds?: string[];
    statut?: UserStatus;
    avatarUrl?: string;
  }) {
    const { entiteIds, fonction, ...updateData } = data;
    
    // Si entiteIds est fourni, mettre à jour les relations
    if (entiteIds !== undefined) {
      // Supprimer toutes les relations existantes
      await prisma.userEntite.deleteMany({
        where: { userId: id },
      });
      
      // Créer les nouvelles relations
      if (entiteIds.length > 0) {
        await prisma.userEntite.createMany({
          data: entiteIds.map((entiteId) => ({
            userId: id,
            entiteId,
          })),
        });
      }
    }
    
    const prismaData: Record<string, unknown> = { ...updateData };
    if (fonction !== undefined) {
      prismaData.fonction = fonctionFromInput(fonction);
    }

    return prisma.user.update({
      where: { id },
      data: prismaData as any,
      include: {
        entitesMembres: {
          include: {
            entite: { select: { id: true, nom: true } },
          },
        },
      },
    });
  }

  async updatePassword(id: string, newPassword: string) {
    const passwordHash = await hashPassword(newPassword);
    return prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async delete(id: string) {
    return prisma.user.delete({ where: { id } });
  }
}
