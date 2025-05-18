const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const port = process.env.PORT || 3001;

// Configuration
const config = {
    MAX_PEERS: 10,
    RESET_INTERVAL: 60000,    // 1 minute
    HEARTBEAT_TIMEOUT: 30000, // 30 secondes
    CLEANUP_INTERVAL: 15000,  // 15 secondes
    MIN_ACTIVE_PEERS: 2       // Nombre minimum de pairs actifs requis
};

// Liste en mémoire des meilleurs pairs par path
const bestPeersByPath = {
    'page1': [],
    'page2': []
};
let lastResetTime = Date.now();

// Middleware
app.use(cors());
app.use(express.json());

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname, '../client')));

// Fonction pour mettre à jour la liste des meilleurs pairs
function updateBestPeers(newPeer) {
    const now = Date.now();
    const path = newPeer.address || 'page1';
    const pathKey = path.includes('page2') ? 'page2' : 'page1';
    
    // Vérifier si on doit réinitialiser la liste
    if (now - lastResetTime >= config.RESET_INTERVAL) {
        resetBestPeers(pathKey);
        lastResetTime = now;
    }

    // Mettre à jour ou ajouter le pair
    const existingPeerIndex = bestPeersByPath[pathKey].findIndex(p => p.peerId === newPeer.peerId);
    if (existingPeerIndex !== -1) {
        bestPeersByPath[pathKey][existingPeerIndex] = { ...bestPeersByPath[pathKey][existingPeerIndex], ...newPeer };
        console.log(`Pair ${newPeer.peerId} mis à jour pour le path ${pathKey}`);
    } else {
        bestPeersByPath[pathKey].push(newPeer);
        console.log(`Nouveau pair ${newPeer.peerId} ajouté pour le path ${pathKey}`);
    }

    // Trier les pairs par qualité de connexion
    bestPeersByPath[pathKey].sort((a, b) => {
        const qualityA = a.connectionQuality || { latency: Infinity, bandwidth: 0 };
        const qualityB = b.connectionQuality || { latency: Infinity, bandwidth: 0 };
        
        // Priorité à la latence basse et à la bande passante élevée
        const scoreA = (qualityA.bandwidth / 1000) / (qualityA.latency || 1);
        const scoreB = (qualityB.bandwidth / 1000) / (qualityB.latency || 1);
        
        return scoreB - scoreA;
    });

    // Garder seulement les meilleurs pairs
    bestPeersByPath[pathKey] = bestPeersByPath[pathKey].slice(0, config.MAX_PEERS);
    
    console.log(`Liste des meilleurs pairs mise à jour pour ${pathKey}:`, bestPeersByPath[pathKey].map(p => p.peerId));
}

// Nouvelle fonction pour réinitialiser la liste des meilleurs pairs
function resetBestPeers(pathKey) {
    const now = Date.now();
    const activePeers = bestPeersByPath[pathKey].filter(peer => {
        const lastUpdate = peer.timestamp || 0;
        const isActive = now - lastUpdate < config.HEARTBEAT_TIMEOUT;
        const quality = peer.connectionQuality || { latency: Infinity, bandwidth: 0 };
        const isGoodQuality = quality.latency <= 500 && quality.bandwidth >= 1000;
        return isActive && isGoodQuality;
    });

    if (activePeers.length > config.MIN_ACTIVE_PEERS) {
        // Supprimer les 20% les moins performants
        const removeCount = Math.ceil(activePeers.length * 0.2);
        bestPeersByPath[pathKey] = activePeers.slice(0, activePeers.length - removeCount);
        console.log(`Réinitialisation partielle pour ${pathKey} : ${removeCount} pairs supprimés`);
    } else {
        console.log(`Pas assez de pairs actifs pour réinitialiser ${pathKey}`);
    }
}

// Nettoyer les pairs inactifs
function cleanupInactivePeers() {
    const now = Date.now();
    
    Object.keys(bestPeersByPath).forEach(pathKey => {
        const beforeCount = bestPeersByPath[pathKey].length;
        
        bestPeersByPath[pathKey] = bestPeersByPath[pathKey].filter(peer => {
            const lastUpdate = peer.timestamp || 0;
            const isActive = now - lastUpdate < config.HEARTBEAT_TIMEOUT;
            if (!isActive) {
                console.log(`Pair ${peer.peerId} marqué comme inactif pour ${pathKey} (dernière mise à jour: ${Math.round((now - lastUpdate) / 1000)}s)`);
            }
            return isActive;
        });

        const removedCount = beforeCount - bestPeersByPath[pathKey].length;
        if (removedCount > 0) {
            console.log(`${removedCount} pairs inactifs supprimés de ${pathKey}`);
        }
    });
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
    Object.keys(bestPeersByPath).forEach(pathKey => {
        bestPeersByPath[pathKey] = bestPeersByPath[pathKey].filter(peer => peer.peerId !== peerId);
    });
    res.json({ success: true });
});

// Endpoint pour obtenir la liste des pairs
app.get('/peers', (req, res) => {
    const currentPath = req.query.path || '';
    console.log('Path demandé:', currentPath);
    
    // Déterminer le path key en fonction de l'URL
    let pathKey = 'page1';
    if (currentPath.includes('page2')) {
        pathKey = 'page2';
    }
    
    console.log('Path key sélectionné:', pathKey);
    console.log('Pairs disponibles:', bestPeersByPath[pathKey]);
    
    res.json({ 
        success: true, 
        peers: bestPeersByPath[pathKey] || [],
        currentPath: pathKey
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
    const stats = {
        success: true,
        uptime: process.uptime(),
        lastReset: lastResetTime,
        paths: {}
    };

    Object.keys(bestPeersByPath).forEach(pathKey => {
        stats.paths[pathKey] = {
            activePeers: bestPeersByPath[pathKey].length,
            maxPeers: config.MAX_PEERS
        };
    });

    res.json(stats);
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
    console.log(`- MAX_PEERS: ${config.MAX_PEERS}`);
    console.log(`- RESET_INTERVAL: ${config.RESET_INTERVAL}ms`);
    console.log(`- HEARTBEAT_TIMEOUT: ${config.HEARTBEAT_TIMEOUT}ms`);
    console.log(`- CLEANUP_INTERVAL: ${config.CLEANUP_INTERVAL}ms`);
    console.log(`- MIN_ACTIVE_PEERS: ${config.MIN_ACTIVE_PEERS}`);
    
    // Nettoyer les pairs inactifs périodiquement
    setInterval(cleanupInactivePeers, config.CLEANUP_INTERVAL);
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