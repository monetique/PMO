import { PrismaClient } from '../generated/prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Gestion de la fermeture propre
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
