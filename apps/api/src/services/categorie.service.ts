import { prisma } from '../utils/prisma';

export class CategorieService {
  async findAll() {
    return prisma.categorieProcessus.findMany({
      orderBy: { nom: 'asc' },
      include: {
        parent: true,
        children: true,
        _count: {
          select: {
            processus: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    return prisma.categorieProcessus.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
        _count: {
          select: {
            processus: true,
          },
        },
      },
    });
  }

  async create(data: {
    nom: string;
    description?: string;
    couleur?: string;
    icone?: string;
    parentId?: string;
  }) {
    return prisma.categorieProcessus.create({
      data,
      include: {
        parent: true,
        children: true,
      },
    });
  }

  async update(id: string, data: {
    nom?: string;
    description?: string;
    couleur?: string;
    icone?: string;
    parentId?: string;
  }) {
    return prisma.categorieProcessus.update({
      where: { id },
      data,
      include: {
        parent: true,
        children: true,
        _count: {
          select: {
            processus: true,
          },
        },
      },
    });
  }

  async delete(id: string) {
    // Vérifier si la catégorie a des processus associés
    const categorie = await prisma.categorieProcessus.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            processus: true,
            children: true,
          },
        },
      },
    });

    if (!categorie) {
      throw new Error('Catégorie non trouvée');
    }

    if (categorie._count.processus > 0) {
      throw new Error('Impossible de supprimer une catégorie qui a des processus associés');
    }

    if (categorie._count.children > 0) {
      throw new Error('Impossible de supprimer une catégorie qui a des sous-catégories');
    }

    return prisma.categorieProcessus.delete({
      where: { id },
    });
  }
}
