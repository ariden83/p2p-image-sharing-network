# Architecture du Projet

## Structure des Dossiers

```
p2p-image-sharing/
├── client/                 # Dossier contenant tous les fichiers frontend
│   ├── index.html         # Page principale de l'application
│   ├── assets/            # Dossier contenant les ressources statiques
│   │   └── images/        # Dossier contenant les images
│   │       ├── image1.jpg # Image exemple 1
│   │       ├── image2.jpg # Image exemple 2
│   │       └── image3.jpg # Image exemple 3
│   └── js/                # Dossier contenant les scripts frontend
│       ├── app.js         # Logique principale de l'application
│       └── p2p-manager.js # Gestionnaire des connexions P2P
├── server/                # Dossier contenant le backend
│   ├── server.js         # Serveur Express
│   └── package.json      # Dépendances et configuration du serveur
├── docs/                  # Documentation et métadonnées
│   ├── metadata.json     # Métadonnées pour l'IA
│   └── examples/         # Exemples d'utilisation
├── package.json          # Configuration principale (workspace)
└── ARCHITECTURE.md       # Ce fichier
```

## Organisation du Projet

### Frontend (client/)
Le frontend est organisé dans le dossier `client/` qui contient :
- `index.html` : Page principale
- `assets/` : Ressources statiques
  - `images/` : Images de l'application
- `js/` : Scripts JavaScript
  - `app.js` : Logique principale
  - `p2p-manager.js` : Gestionnaire P2P

Cette organisation permet :
- Une séparation claire entre frontend et backend
- Une meilleure structure pour le déploiement
- Une organisation plus professionnelle
- Une gestion claire des assets statiques

### Backend
Le backend est isolé dans le dossier `server/` avec ses propres dépendances et configuration. Cette séparation permet :
- Une meilleure organisation du code
- Une gestion indépendante des dépendances
- Une séparation claire des responsabilités

### Gestion des Dépendances

Le projet utilise une structure de workspace npm avec deux fichiers `package.json` distincts :

#### package.json (racine)
```json
{
  "name": "p2p-image-sharing",
  "version": "1.0.0",
  "private": true,
  "workspaces": ["server"],
  "scripts": {
    "start": "cd server && npm start",
    "install": "cd server && npm install"
  }
}
```
- Définit le projet global
- Configure le workspace npm
- Ne contient pas de dépendances
- Redirige les commandes vers le serveur

#### server/package.json
```json
{
  "name": "p2p-image-sharing-server",
  "version": "1.0.0",
  "dependencies": {
    "express": "^4.18.2"
  },
  "scripts": {
    "start": "node server.js"
  }
}
```
- Contient les dépendances du serveur
- Gère la configuration du serveur
- Définit les scripts spécifiques au serveur

Cette séparation permet :
- Une meilleure isolation des dépendances
- Une gestion plus claire des versions
- Une possibilité d'ajouter d'autres composants plus tard

### Workspace
Le projet utilise un workspace npm pour gérer les dépendances du serveur. Le `package.json` à la racine sert uniquement de point d'entrée.

## Métadonnées d'Architecture

Les métadonnées d'architecture sont stockées dans le fichier `docs/metadata.json`. Ce fichier contient toutes les informations nécessaires pour l'IA et les outils de développement, sans exposer ces informations aux utilisateurs finaux.

Le format des métadonnées suit la structure suivante :

```json
{
  "files": {
    "path/to/file": {
      "architecture": {
        "role": "[frontend|backend]/[component]",
        "description": "[description du rôle]",
        "dependencies": ["liste des dépendances"],
        "responsibilities": ["liste des responsabilités"]
      },
      "security": {
        "permissions": "[niveau de permission requis]",
        "sensitive_data": ["données sensibles gérées"]
      },
      "performance": {
        "critical_path": [true|false],
        "caching_strategy": "[stratégie de cache]"
      },
      "testing": {
        "test_files": ["fichiers de test associés"],
        "coverage_required": [pourcentage de couverture requis]
      },
      "maintenance": {
        "last_review": "[date de dernière revue]",
        "complexity": "[low|medium|high]",
        "technical_debt": "[niveau de dette technique]"
      },
      "documentation": {
        "api_docs": "[lien vers la documentation API]",
        "examples": ["exemples d'utilisation"]
      },
      "semantics": {
        "concepts": ["liste des concepts clés"],
        "patterns": ["patterns de conception utilisés"],
        "domain": "[domaine d'application]"
      },
      "relationships": {
        "communicates_with": ["composants avec lesquels il communique"],
        "extends": ["classes dont il hérite"],
        "implements": ["interfaces qu'il implémente"]
      },
      "history": {
        "changes": [
          {
            "date": "[date du changement]",
            "author": "[auteur du changement]",
            "description": "[description du changement]"
          }
        ]
      },
      "llm": {
        "context": "[contexte spécifique pour les LLMs]",
        "examples": ["exemples d'utilisation pour les LLMs"],
        "constraints": ["contraintes à respecter"],
        "suggestions": ["suggestions d'amélioration"]
      }
    }
  }
}
```

Cette approche offre plusieurs avantages :
1. Sécurité : Les métadonnées sensibles ne sont pas exposées aux utilisateurs finaux
2. Organisation : Toutes les métadonnées sont centralisées dans un seul fichier
3. Maintenance : Plus facile à maintenir et à mettre à jour
4. Performance : Les fichiers de production ne sont pas alourdis par les commentaires
5. Séparation des préoccupations : La documentation est séparée du code

## Composants

### Frontend

#### index.html
- Page principale de l'application
- Contient la structure HTML et les styles CSS
- Charge les scripts JavaScript nécessaires

#### js/app.js
- Gère la logique principale de l'application
- Définit la liste des images à afficher
- Gère le chargement et l'affichage des images
- Convertit les images en base64 pour le partage P2P

#### js/p2p-manager.js
- Gère les connexions P2P via WebRTC
- Utilise PeerJS pour simplifier la gestion des connexions
- Gère le cache des images
- Gère les requêtes et réponses P2P

### Backend

#### server/server.js
- Serveur Express pour servir les fichiers statiques
- Configure les routes
- Gère le port d'écoute
- Sert les fichiers depuis le dossier parent

#### server/package.json
- Dépendances spécifiques au serveur
- Scripts de démarrage du serveur
- Configuration du serveur Node.js

## Flux de Données

1. L'utilisateur accède à l'application via le serveur Express
2. Le frontend initialise une connexion P2P
3. Lorsqu'une image est demandée :
   - Le système vérifie d'abord si elle est disponible via P2P
   - Si non, l'image est chargée depuis le serveur
   - L'image est mise en cache pour les autres pairs
4. Les pairs peuvent partager les images entre eux

## Conventions

- Les fichiers JavaScript utilisent le style camelCase
- Les noms de classes utilisent le PascalCase
- Les fichiers de configuration sont en JSON
- La documentation est en Markdown

## Dépendances

### Frontend
- PeerJS (via CDN)

### Backend
- Express

## Points d'Extension

Le projet peut être étendu en :
1. Ajoutant de nouveaux gestionnaires dans le dossier `js/`
2. Créant de nouvelles routes dans `server/server.js`
3. Ajoutant de nouveaux fichiers statiques dans le dossier racine
4. Étendant la configuration dans les fichiers `package.json`

## Règles de Modification

1. Toujours maintenir la structure de dossiers existante
2. Ajouter de nouveaux fichiers dans les dossiers appropriés
3. Mettre à jour ce fichier si la structure change
4. Documenter les nouvelles fonctionnalités dans le README.md 