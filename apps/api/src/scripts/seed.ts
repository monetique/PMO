import 'dotenv/config';
import { prisma } from '../utils/prisma';
import { hashPassword } from '../utils/hash';

async function main() {
  console.log('🌱 Démarrage du seed...');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {
      passwordHash: await hashPassword('admin123'),
      statut: 'actif',
    },
    create: {
      email: 'admin@example.com',
      passwordHash: await hashPassword('admin123'),
      nom: 'Admin',
      prenom: 'Super',
      role: 'admin',
      statut: 'actif',
    },
  });

  console.log('✅ Admin:', admin.email, '(mot de passe: admin123)');

  const typeDirection =
    (await prisma.typeEntite.findFirst({ where: { code: 'direction' } })) ||
    (await prisma.typeEntite.create({
      data: { code: 'direction', libelle: 'Direction', ordre: 0, actif: true },
    }));

  const direction = await prisma.entite.upsert({
    where: { code: 'DIR-001' },
    update: {},
    create: {
      nom: 'Direction Générale',
      code: 'DIR-001',
      typeEntiteId: typeDirection.id,
      description: 'Direction principale',
      responsableId: admin.id,
    },
  });

  console.log('✅ Entité:', direction.nom);

  const contributeur = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {
      passwordHash: await hashPassword('user123'),
      statut: 'actif',
    },
    create: {
      email: 'user@example.com',
      passwordHash: await hashPassword('user123'),
      nom: 'Dupont',
      prenom: 'Jean',
      role: 'contributeur',
      statut: 'actif',
    },
  });

  await prisma.userEntite.upsert({
    where: {
      userId_entiteId: { userId: contributeur.id, entiteId: direction.id },
    },
    update: {},
    create: { userId: contributeur.id, entiteId: direction.id },
  });

  console.log('✅ Contributeur:', contributeur.email, '(user123), lié à', direction.code);

  let categorie = await prisma.categorieProcessus.findFirst({
    where: { nom: 'Gestion', parentId: null },
  });
  if (!categorie) {
    categorie = await prisma.categorieProcessus.create({
      data: {
        nom: 'Gestion',
        description: 'Processus de gestion',
        couleur: '#3B82F6',
      },
    });
  }
  console.log('✅ Catégorie:', categorie.nom);

  let processus = await prisma.processus.findUnique({
    where: { codeProcessus: 'PROC-001' },
  });
  if (!processus) {
    processus = await prisma.processus.create({
      data: {
        nom: "Processus d'exemple",
        codeProcessus: 'PROC-001',
        description: 'Un processus de démonstration',
        proprietaireId: contributeur.id,
        createdById: contributeur.id,
        statut: 'brouillon',
      },
    });
    await prisma.processusCategorie.create({
      data: { processusId: processus.id, categorieId: categorie.id },
    });
    await prisma.processusEntite.create({
      data: { processusId: processus.id, entiteId: direction.id },
    });
  }
  console.log('✅ Processus:', processus.nom);

  console.log('🎉 Seed terminé avec succès!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
