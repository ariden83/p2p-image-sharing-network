const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

// Configuration
const MAX_PEERS = 10;
const RESET_INTERVAL = 60000;    // 1 minute au lieu de 10 secondes
const HEARTBEAT_TIMEOUT = 30000; // 30 secondes au lieu de 5 secondes
const CLEANUP_INTERVAL = 15000;  // 15 secondes au lieu de 5 secondes

// Liste en mémoire des meilleurs pairs
let bestPeers = [];
let lastResetTime = Date.now();

// Middleware
app.use(cors());
app.use(express.json());

// Fonction pour mettre à jour la liste des meilleurs pairs
function updateBestPeers(newPeer) {
    const now = Date.now();
    
    // Vérifier si on doit réinitialiser la liste
    if (now - lastResetTime >= RESET_INTERVAL) {
        console.log('Réinitialisation de la liste des meilleurs pairs');
        console.log('Nombre de pairs avant réinitialisation:', bestPeers.length);
        bestPeers = [];
        lastResetTime = now;
    }

    // Mettre à jour ou ajouter le pair
    const existingPeerIndex = bestPeers.findIndex(p => p.peerId === newPeer.peerId);
    if (existingPeerIndex !== -1) {
        bestPeers[existingPeerIndex] = { ...bestPeers[existingPeerIndex], ...newPeer };
        console.log(`Pair ${newPeer.peerId} mis à jour`);
    } else {
        bestPeers.push(newPeer);
        console.log(`Nouveau pair ${newPeer.peerId} ajouté`);
    }

    // Trier les pairs par qualité de connexion
    bestPeers.sort((a, b) => {
        const qualityA = a.connectionQuality || { latency: Infinity, bandwidth: 0 };
        const qualityB = b.connectionQuality || { latency: Infinity, bandwidth: 0 };
        
        // Priorité à la latence basse et à la bande passante élevée
        const scoreA = (qualityA.bandwidth / 1000) / (qualityA.latency || 1);
        const scoreB = (qualityB.bandwidth / 1000) / (qualityB.latency || 1);
        
        return scoreB - scoreA;
    });

    // Garder seulement les meilleurs pairs
    bestPeers = bestPeers.slice(0, MAX_PEERS);
    
    console.log('Liste des meilleurs pairs mise à jour:', bestPeers.map(p => p.peerId));
}

// Nettoyer les pairs inactifs
function cleanupInactivePeers() {
    const now = Date.now();
    const beforeCount = bestPeers.length;
    
    bestPeers = bestPeers.filter(peer => {
        const lastUpdate = peer.timestamp || 0;
        const isActive = now - lastUpdate < HEARTBEAT_TIMEOUT;
        if (!isActive) {
            console.log(`Pair ${peer.peerId} marqué comme inactif (dernière mise à jour: ${Math.round((now - lastUpdate) / 1000)}s)`);
        }
        return isActive;
    });

    const removedCount = beforeCount - bestPeers.length;
    if (removedCount > 0) {
        console.log(`${removedCount} pairs inactifs supprimés`);
    }
}

// Endpoint pour l'enregistrement d'un pair
app.post('/register', (req, res) => {
    const peerData = {
        ...req.body,
        timestamp: Date.now()
    };
    
    console.log('Données reçues lors de l\'enregistrement:', peerData);
    updateBestPeers(peerData);
    res.json({ success: true });
});

// Endpoint pour le heartbeat
app.post('/heartbeat', (req, res) => {
    const peerData = {
        ...req.body,
        timestamp: Date.now()
    };
    
    console.log('Données reçues lors du heartbeat:', peerData);
    updateBestPeers(peerData);
    res.json({ success: true });
});

// Endpoint pour la désinscription
app.post('/unregister', (req, res) => {
    const { peerId } = req.body;
    console.log(`Désinscription du pair ${peerId}`);
    bestPeers = bestPeers.filter(peer => peer.peerId !== peerId);
    res.json({ success: true });
});

// Endpoint pour obtenir la liste des pairs
app.get('/peers', (req, res) => {
    cleanupInactivePeers();
    console.log(`Liste des pairs demandée. ${bestPeers.length} pairs disponibles`);
    console.log('Détails des pairs:', JSON.stringify(bestPeers, null, 2));
    
    // S'assurer que chaque pair a les champs requis
    const formattedPeers = bestPeers.map(peer => ({
        peerId: peer.peerId,
        connectionQuality: peer.connectionQuality || { latency: Infinity, bandwidth: 0 },
        timestamp: peer.timestamp,
        sharedImages: peer.sharedImages || 0,
        city: peer.city || 'Unknown',
        country: peer.country || 'Unknown',
        address: peer.address || 'home'
    }));

    res.json({
        success: true,
        count: formattedPeers.length,
        peers: formattedPeers
    });
});

// Endpoint pour le test de ping
app.post('/ping', (req, res) => {
    res.json({ success: true });
});

// Endpoint pour le test de bande passante
app.get('/bandwidth-test', (req, res) => {
    // Générer un fichier de test de 1MB
    const testData = Buffer.alloc(1024 * 1024);
    res.send(testData);
});

// Endpoint pour les statistiques du serveur
app.get('/stats', (req, res) => {
  res.json({
    success: true,
    uptime: process.uptime(),
    activePeers: bestPeers.length,
    maxPeers: MAX_PEERS,
    lastReset: lastResetTime
  });
});

// Gestion des 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error('Erreur non gérée:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Démarrer le serveur
const server = app.listen(port, () => {
    console.log(`Serveur de découverte démarré sur le port ${port}`);
    console.log('Configuration:');
    console.log(`- MAX_PEERS: ${MAX_PEERS}`);
    console.log(`- RESET_INTERVAL: ${RESET_INTERVAL}ms`);
    console.log(`- HEARTBEAT_TIMEOUT: ${HEARTBEAT_TIMEOUT}ms`);
    console.log(`- CLEANUP_INTERVAL: ${CLEANUP_INTERVAL}ms`);
    
    // Nettoyer les pairs inactifs périodiquement
    setInterval(cleanupInactivePeers, CLEANUP_INTERVAL);
});

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function shutdown() {
    console.log('Arrêt du serveur...');
    server.close(() => {
        console.log('Serveur arrêté');
        process.exit(0);
    });
    
    // Forcer l'arrêt après 10 secondes
    setTimeout(() => {
        console.error('Arrêt forcé après délai d\'attente');
        process.exit(1);
    }, 10000);
}