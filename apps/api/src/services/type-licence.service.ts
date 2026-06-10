import { prisma } from '../utils/prisma';

export const typeLicenceService = {
  async findAll() {
    return prisma.typeLicence.findMany({ orderBy: { nom: 'asc' } });
  },
  async create(data: { nom: string }) {
    return prisma.typeLicence.create({
      data: { nom: data.nom.trim() },
    });
  },
  async update(id: string, data: { nom: string }) {
    return prisma.typeLicence.update({
      where: { id },
      data: { nom: data.nom.trim() },
    });
  },
  async delete(id: string) {
    return prisma.typeLicence.delete({ where: { id } });
  },
};
