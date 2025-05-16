const express = require('express');
const cors = require('cors');
const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Stockage des pairs connectés avec plus d'informations
let connectedPeers = new Map();

// Configuration
const CONFIG = {
    HEARTBEAT_TIMEOUT: 15000,    // 15 secondes
    CLEANUP_INTERVAL: 5000,      // 5 secondes
    MAX_MISSED_HEARTBEATS: 2     // Nombre maximum de heartbeats manqués
};

// Statistiques globales
let stats = {
    totalConnections: 0,
    activeConnections: 0,
    totalImagesShared: 0,
    countries: new Map(),
    lastHourConnections: 0,
    peakConnections: 0,
    connectionsByCountry: {}
};

// Routes
app.post('/register', (req, res) => {
    const { peerId, address, country, city } = req.body;
    if (!peerId || !address) {
        return res.status(400).json({ error: 'peerId et address sont requis' });
    }

    connectedPeers.set(peerId, {
        address,
        lastActive: Date.now(),
        country,
        city,
        imagesShared: 0,
        lastHeartbeat: Date.now(),
        missedHeartbeats: 0
    });

    // Mettre à jour les statistiques
    stats.totalConnections++;
    stats.activeConnections++;
    if (country) {
        stats.connectionsByCountry[country] = (stats.connectionsByCountry[country] || 0) + 1;
    }

    console.log(`Nouveau pair connecté: ${peerId} (${country || 'Pays inconnu'}, ${city || 'Ville inconnue'})`);
    res.json({ message: 'Pair enregistré avec succès' });
});

app.post('/unregister', (req, res) => {
    const { peerId } = req.body;
    if (!peerId) {
        return res.status(400).json({ error: 'peerId est requis' });
    }

    removePeer(peerId);
    console.log(`Pair déconnecté: ${peerId}`);
    res.json({ message: 'Pair désinscrit avec succès' });
});

app.post('/heartbeat', (req, res) => {
    const { peerId } = req.body;
    if (!peerId) {
        return res.status(400).json({ error: 'peerId est requis' });
    }

    const peer = connectedPeers.get(peerId);
    if (peer) {
        peer.lastActive = Date.now();
        peer.lastHeartbeat = Date.now();
        peer.missedHeartbeats = 0;
        console.log(`Heartbeat reçu de: ${peerId} (${peer.country || 'Pays inconnu'}, ${peer.city || 'Ville inconnue'})`);
    }
    res.json({ message: 'Heartbeat reçu' });
});

app.post('/image-shared', (req, res) => {
    const { peerId } = req.body;
    if (!peerId) {
        return res.status(400).json({ error: 'peerId est requis' });
    }

    const peer = connectedPeers.get(peerId);
    if (peer) {
        peer.imagesShared++;
        stats.totalImagesShared++;
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Pair non trouvé' });
    }
});

// Fonction pour supprimer un pair
function removePeer(peerId) {
    const peer = connectedPeers.get(peerId);
    if (peer) {
        // Mettre à jour les statistiques
        stats.activeConnections--;
        if (peer.country) {
            const countryCount = stats.countries.get(peer.country) || 0;
            if (countryCount > 0) {
                stats.countries.set(peer.country, countryCount - 1);
            }
        }
    }

    connectedPeers.delete(peerId);
    console.log(`Pair déconnecté: ${peerId}`);
}

app.get('/peers', (req, res) => {
    // Nettoyer les pairs inactifs
    cleanupInactivePeers();

    // Retourner la liste des pairs actifs avec leurs informations
    const peers = Array.from(connectedPeers.entries()).map(([id, data]) => ({
        id,
        country: data.country,
        city: data.city,
        lastSeen: data.lastSeen,
        connectionTime: data.connectionTime,
        imagesShared: data.imagesShared
    }));

    res.json({ peers });
});

// Fonction de nettoyage des pairs inactifs
function cleanupInactivePeers() {
    const now = Date.now();
    for (const [peerId, data] of connectedPeers.entries()) {
        if (now - data.lastHeartbeat > CONFIG.HEARTBEAT_TIMEOUT) {
            data.missedHeartbeats++;
            if (data.missedHeartbeats >= CONFIG.MAX_MISSED_HEARTBEATS) {
                removePeer(peerId);
            }
        }
    }
}

// Nettoyage périodique des pairs inactifs
setInterval(cleanupInactivePeers, CONFIG.CLEANUP_INTERVAL);

app.get('/stats', (req, res) => {
    // Réinitialiser le compteur horaire toutes les heures
    const now = new Date();
    if (now.getMinutes() === 0) {
        stats.lastHourConnections = 0;
    }

    res.json({
        totalConnections: stats.totalConnections,
        activeConnections: stats.activeConnections,
        totalImagesShared: stats.totalImagesShared,
        lastHourConnections: stats.lastHourConnections,
        peakConnections: stats.peakConnections,
        countries: Array.from(stats.countries.entries()).map(([country, count]) => ({
            country,
            count
        })),
        connectionsByCountry: stats.connectionsByCountry
    });
});

// Démarrer le serveur
app.listen(port, () => {
    console.log(`Serveur de découverte démarré sur le port ${port}`);
    console.log(`Configuration: Timeout=${CONFIG.HEARTBEAT_TIMEOUT}ms, Nettoyage=${CONFIG.CLEANUP_INTERVAL}ms`);
}); 