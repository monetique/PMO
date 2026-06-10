# Dockerfile pour l'API de l'application 1
FROM node:20-alpine AS builder

WORKDIR /app

# Afficher les versions
RUN echo "=== Versions ===" && \
    node --version && \
    npm --version

# Copier les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma

# Afficher le contenu de package.json pour vérification
RUN echo "=== Contenu package.json ===" && \
    cat package.json | head -20 && \
    echo "=== Structure prisma ===" && \
    ls -la prisma/ 2>/dev/null || echo "Dossier prisma non trouvé"

# Réseau instable (ECONNRESET / timeout) : renforcer les retries et délais npm avant npm ci
RUN npm config set fetch-retries 10 && \
    npm config set fetch-retry-factor 2 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 180000 && \
    npm config set fetch-timeout 600000

# Installer les dépendances (sans pipe vers tee : sinon le code de sortie peut être masqué)
RUN echo "=== Installation des dépendances ===" && \
    npm ci || (echo "=== npm ci échoué, nouvelle tentative dans 20s ===" && sleep 20 && npm ci) || (echo "=== dernière tentative dans 45s ===" && sleep 45 && npm ci)

# Copier le reste du code
COPY . .

# Afficher la structure des fichiers copiés
RUN echo "=== Structure des fichiers ===" && \
    ls -la && \
    echo "=== Fichiers src ===" && \
    ls -la src/ | head -20 && \
    echo "=== Fichiers tsconfig ===" && \
    cat tsconfig.json 2>/dev/null || echo "tsconfig.json non trouvé"

# Client Prisma (binaire local du lockfile, pas npx qui peut tirer Prisma 7)
RUN echo "=== Génération du client Prisma ===" && ./node_modules/.bin/prisma generate

# Compilation TypeScript
RUN echo "=== Compilation TypeScript ===" && npm run build && ls -la dist/

# Image de production
FROM node:20-alpine AS production

WORKDIR /app

# Réutiliser node_modules du builder (évite un 2ᵉ npm ci réseau, source fréquente d’ECONNRESET)
COPY package*.json ./
COPY prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev

# Copier les fichiers compilés depuis le builder
COPY --from=builder /app/dist ./dist
RUN ./node_modules/.bin/prisma generate

# Créer le dossier pour les uploads
# Installer Tesseract OCR + langues + outils PDF
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-fra \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-ara \
    poppler-utils \
    ghostscript \
    imagemagick \
    && rm -rf /var/cache/apk/*
# Créer les dossiers pour les uploads et OCR
RUN mkdir -p /app/uploads /app/uploads/ocr

# Exposer le port
EXPOSE 4000

# Commande par défaut
CMD ["npm", "start"]
