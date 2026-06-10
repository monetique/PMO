# Dockerfile pour le Frontend de l'application 1
FROM node:20-alpine AS builder

WORKDIR /app

# Afficher les versions
RUN echo "=== Versions ===" && \
    node --version && \
    npm --version

# Copier les fichiers de dépendances
COPY package*.json ./

# Afficher le contenu de package.json pour vérification
RUN echo "=== Contenu package.json ===" && \
    cat package.json | head -20

# Installer les dépendances avec logs détaillés
RUN echo "=== Installation des dépendances ===" && \
    npm ci --verbose 2>&1 | tee /tmp/npm-install.log || \
    (echo "=== ERREUR INSTALLATION ===" && cat /tmp/npm-install.log && exit 1)

# Copier le reste du code
COPY . .

# Afficher la structure des fichiers copiés
RUN echo "=== Structure des fichiers ===" && \
    ls -la && \
    echo "=== Fichiers src ===" && \
    ls -la src/ | head -20 && \
    echo "=== Fichiers tsconfig ===" && \
    cat tsconfig.json 2>/dev/null || echo "tsconfig.json non trouvé" && \
    echo "=== Fichiers vite.config ===" && \
    cat vite.config.ts 2>/dev/null || echo "vite.config.ts non trouvé"

# Variables d'environnement pour le build Vite (injectées dans le JS au build)
# Passer build-arg depuis docker-compose : http://localhost:4000/api/v1
ARG VITE_API_URL=http://localhost:4000/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN echo "=== Variables d'environnement ===" && \
    echo "VITE_API_URL=$VITE_API_URL"

RUN echo "=== Début du build ===" && \
    npm run build 2>&1 | tee /tmp/build.log && \
    echo "=== Vérification du résultat du build ===" && \
    if [ ! -d "dist" ]; then \
      echo "=== ERREUR: Le dossier dist n'existe pas ===" && \
      cat /tmp/build.log && \
      exit 1; \
    fi && \
    echo "=== Build réussi ===" && \
    ls -la dist/ && \
    du -sh dist/

# Horodatage du build : ouvrir http://<host>:5173/build-info.json pour vérifier que Docker sert bien la dernière image
RUN printf '{"builtAtUtc":"%s","source":"docker-web-app1"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > dist/build-info.json

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
