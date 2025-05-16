# Application de Partage P2P d'Images

Cette application web permet de partager des images entre utilisateurs en utilisant la technologie P2P (Peer-to-Peer), réduisant ainsi la charge sur le serveur et optimisant la bande passante.

## Fonctionnalités

- Partage automatique des images entre les utilisateurs connectés
- Mise en cache des images pour une distribution P2P
- Interface utilisateur simple et intuitive
- Affichage du statut de chargement des images
- Utilisation de WebRTC pour les connexions P2P

## Architecture Technique

L'application est composée de plusieurs composants :

### Frontend
- `index.html` : Page principale avec la structure HTML et les styles CSS
- `js/p2p-manager.js` : Gestionnaire des connexions P2P
- `js/app.js` : Logique principale de l'application

### Backend
- `server/` : Dossier contenant le serveur Node.js
  - `server.js` : Serveur Express pour servir les fichiers statiques
  - `package.json` : Dépendances du serveur

## Comment ça marche

1. **Initialisation**
   - Lorsqu'un utilisateur charge la page, une connexion P2P est établie via WebRTC
   - Un ID unique est généré pour chaque utilisateur
   - Les connexions avec d'autres pairs sont établies automatiquement

2. **Chargement des images**
   - Quand une image est demandée, le système vérifie d'abord si elle est disponible via P2P
   - Si l'image est trouvée chez un pair, elle est récupérée directement
   - Sinon, l'image est chargée depuis le serveur et mise en cache pour les autres pairs

3. **Partage P2P**
   - Les images sont converties en base64 pour faciliter le partage
   - Chaque image chargée est automatiquement mise en cache
   - Les pairs peuvent demander et recevoir des images entre eux

## Installation

1. Clonez le dépôt :
```bash
git clone [URL_DU_REPO]
cd p2p-image-sharing
```

2. Installez les dépendances et démarrez le serveur :
```bash
npm start
```

Cette commande va :
- Installer les dépendances du serveur
- Démarrer le serveur Node.js

3. Ouvrez votre navigateur à l'adresse : `http://localhost:3000`

## Configuration

### Personnalisation des images
Modifiez le tableau `images` dans `js/app.js` pour inclure vos propres images :
```javascript
const images = [
    'https://votre-domaine.com/image1.jpg',
    'https://votre-domaine.com/image2.jpg'
];
```

### Configuration P2P
Les paramètres de connexion P2P peuvent être modifiés dans `js/p2p-manager.js` :
- Serveurs STUN
- Options de débogage
- Configuration des connexions

### Configuration du serveur
Les paramètres du serveur peuvent être modifiés dans `server/server.js` :
- Port d'écoute
- Options Express
- Configuration des routes

## Dépendances

### Frontend
- **PeerJS** : Bibliothèque pour simplifier l'utilisation de WebRTC

### Backend
- **Express** : Serveur web

## Limitations

- Nécessite un navigateur moderne supportant WebRTC
- Les connexions P2P peuvent être bloquées par certains pare-feu
- La taille des images partagées est limitée par la mémoire disponible

## Contribution

Les contributions sont les bienvenues ! N'hésitez pas à :
1. Fork le projet
2. Créer une branche pour votre fonctionnalité
3. Commiter vos changements
4. Pousser vers la branche
5. Ouvrir une Pull Request

## Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails. 