-- Ajout des types de ressource pour le journal d'accès (tâches / epics / user stories)
ALTER TYPE "ResourceType" ADD VALUE 'tache';
ALTER TYPE "ResourceType" ADD VALUE 'epic';
ALTER TYPE "ResourceType" ADD VALUE 'userStory';
