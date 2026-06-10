-- Alignement avec documents « natifs » epic / user story (ACL auteur comme fiche projet)
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'epic';
ALTER TYPE "DocType" ADD VALUE IF NOT EXISTS 'user_story';
ALTER TYPE "RefType" ADD VALUE IF NOT EXISTS 'epic';
ALTER TYPE "RefType" ADD VALUE IF NOT EXISTS 'userStory';
