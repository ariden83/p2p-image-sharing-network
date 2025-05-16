/**
 * @architecture
 * role: backend/server
 * description: Serveur Express pour servir les fichiers statiques
 * dependencies:
 *   - express
 *   - peer
 * responsibilities:
 *   - Servir les fichiers statiques depuis le dossier client
 *   - Gérer les routes
 *   - Configurer le port d'écoute
 */

const express = require('express');
const path = require('path');
const { ExpressPeerServer } = require('peer');

const app = express();
const port = process.env.PORT || 3000;

// Servir les fichiers statiques depuis le dossier client
app.use(express.static(path.join(__dirname, '..', 'client')));

// Créer le serveur HTTP
const server = require('http').Server(app);

// Configurer le serveur PeerJS
const peerServer = ExpressPeerServer(server, {
    debug: true,
    path: '/peerjs'
});

// Utiliser le serveur PeerJS
app.use('/peerjs', peerServer);

// Route principale
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// Démarrer le serveur
server.listen(port, () => {
    console.log(`Serveur démarré sur http://localhost:${port}`);
    console.log(`Serveur PeerJS disponible sur /peerjs`);
}); 