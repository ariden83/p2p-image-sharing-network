// SUPPRIMER ou commenter l'import statique :
// import config from './config.js';

let config; // sera chargé dynamiquement

// Toutes les variables qui dépendent de config doivent être initialisées après le chargement
let images;

let peer = null;
let connections = new Map();
let peerImages = new Map(); // Map pour stocker les images disponibles par pair
let availablePeers = []; // Liste des pairs disponibles au démarrage
let currentPeerIndex = 0; // Index du pair actuellement connecté
let currentImageIndex = 0; // Index de l'image actuelle
let sharedImagesCount = 0; // Compteur d'images partagées initialisé à 0
let peerUpdateInterval = null; // Variable pour suivre l'intervalle de mise à jour des pairs

// Stocker les images déjà affichées pour éviter les doublons
const displayedImages = new Set();

// Structure pour stocker les métadonnées du cache
const imageCache = new Map(); // Map<imageId, {timestamp: number, data: string}>

// Configuration
const MAX_PEERS = 10; // Nombre maximum de pairs à garder en mémoire
const RESET_INTERVAL = 10000; // Intervalle de réinitialisation en millisecondes
const CACHE_DURATION = 24 * 60 * 60; // Durée du cache en secondes (24 heures)

// Liste en mémoire des meilleurs pairs
let bestPeers = [];
let lastResetTime = Date.now();

// Cache pour la géolocalisation
let cachedGeolocation = null;

// Fonction pour vérifier si une image en cache est toujours valide
async function isCacheValid(imageId) {
    const cacheEntry = imageCache.get(imageId);
    if (!cacheEntry) return false;
    
    try {
        // Utiliser les headers de cache stockés
        const cacheHeaders = cacheEntry.cacheHeaders;
        if (!cacheHeaders) return false;

        // Si on a un header Expires, vérifier la date
        if (cacheHeaders.Expires) {
            const expirationDate = new Date(cacheHeaders.Expires);
            return Date.now() < expirationDate.getTime();
        }
        
        // Si on a un header Cache-Control avec max-age
        if (cacheHeaders['Cache-Control']) {
            const maxAgeMatch = cacheHeaders['Cache-Control'].match(/max-age=(\d+)/);
            if (maxAgeMatch) {
                const maxAge = parseInt(maxAgeMatch[1]);
                const age = (Date.now() - cacheEntry.timestamp) / 1000; // Convertir en secondes
                return age < maxAge;
            }
        }
        
        // Si aucun header de cache n'est trouvé, considérer le cache comme invalide
        return false;
    } catch (error) {
        console.error('Erreur lors de la vérification du cache:', error);
        return false;
    }
}

// Nouvelle fonction pour charger la config dynamiquement
async function loadConfig() {
    const configPath = window.location.pathname.includes('page2') ? './config-page2.js' : './config.js';
    config = (await import(`${configPath}?v=${Date.now()}`)).default;
    images = config.images.paths;
    initializeApp();
}

// Regroupe l'initialisation qui dépend de la config
function initializeApp() {
    initializePeer();
    startPeerUpdateInterval();
    document.getElementById('loadImageBtn').addEventListener('click', loadTestImage);
    updateSharedImagesCount();
    // ... (autres initialisations si besoin)

    // Gestionnaires de nettoyage (inchangés)
    let isDisconnecting = false;
    async function cleanup() {
        if (isDisconnecting) return;
        isDisconnecting = true;
        if (peer && peer.id) {
            try {
                connections.forEach(conn => conn.close());
                connections.clear();
                peerImages.clear();
                await unregisterFromDiscoveryServer(peer.id);
                peer.destroy();
            } catch (error) {
                console.error('Erreur lors de la fermeture:', error);
            }
        }
    }
    window.addEventListener('beforeunload', async (event) => {
        if (!isDisconnecting) await cleanup();
    });
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden' && !isDisconnecting) await cleanup();
    });
    window.addEventListener('unload', () => {
        if (!isDisconnecting) cleanup();
    });
}

// Lancer le chargement de la config au chargement du DOM
// (remplace l'ancien addEventListener)
document.addEventListener('DOMContentLoaded', loadConfig);

// Fonction pour démarrer l'intervalle de mise à jour des pairs
function startPeerUpdateInterval() {
    setInterval(async () => {
        // Mettre à jour la liste des pairs disponibles pour l'affichage
        await updateAvailablePeers();
        updatePeerList(); // Rafraîchir l'affichage de la liste des pairs

        // Vérifier d'abord si nous avons une connexion active
        if (connections.size === 0) {
            console.log('Pas de connexion active, tentative de connexion...');
            if (availablePeers.length > 0) {
                console.log('Pairs disponibles, tentative de connexion...');
                currentPeerIndex = -1;
                connectToNextPeer();
            }
        } else {
            // Vérifier si la connexion actuelle est toujours active
            const isConnectionActive = await checkCurrentConnection();
            if (!isConnectionActive) {
                // Vérifier une seconde fois avant de fermer la connexion
                const secondCheck = await checkCurrentConnection();
                if (!secondCheck) {
                    console.log('Connexion actuelle perdue après double vérification, tentative de connexion à un nouveau pair...');
                    const currentConn = Array.from(connections.values())[0];
                    if (currentConn) {
                        currentConn.close();
                    }
                    if (availablePeers.length > 0) {
                        console.log('Pairs disponibles, tentative de connexion...');
                        currentPeerIndex = -1;
                        connectToNextPeer();
                    }
                }
            }
        }
    }, 10000); // Augmenter l'intervalle à 10 secondes
}

// Obtenir la liste des pairs connus
async function getKnownPeers() {
    try {
        const response = await fetch(`${config.discoveryServer.url}/peers`);
        if (!response.ok) {
            throw new Error('Erreur lors de la récupération des pairs');
        }
        const data = await response.json();
        return data.peers.filter(peerData => peerData.id !== peer.id);
    } catch (error) {
        console.error('Erreur lors de la récupération des pairs:', error);
        return [];
    }
}

// Obtenir la géolocalisation
async function getGeolocation() {
    // Retourner la valeur en cache si elle existe
    if (cachedGeolocation) {
        console.log('Utilisation de la géolocalisation en cache');
        return cachedGeolocation;
    }

    try {
        // Obtenir d'abord l'IP
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        if (!ipResponse.ok) {
            throw new Error(`HTTP error! status: ${ipResponse.status}`);
        }
        const ipData = await ipResponse.json();
        
        // Utiliser l'API gratuite de ip-api.com qui ne nécessite pas de clé API
        const geoResponse = await fetch(`http://ip-api.com/json/${ipData.ip}`);
        if (!geoResponse.ok) {
            throw new Error(`HTTP error! status: ${geoResponse.status}`);
        }
        
        const geoData = await geoResponse.json();
        // Mettre en cache le résultat
        cachedGeolocation = {
            country: geoData.country || 'Unknown',
            city: geoData.city || 'Unknown'
        };
        return cachedGeolocation;
    } catch (error) {
        console.warn('Impossible d\'obtenir la géolocalisation:', error.message);
        // Mettre en cache même en cas d'erreur pour éviter de réessayer
        cachedGeolocation = {
            country: 'Unknown',
            city: 'Unknown'
        };
        return cachedGeolocation;
    }
}

// Mesurer la qualité de connexion
async function measureConnectionQuality() {
    try {
        const startTime = performance.now();
        const response = await fetch('http://localhost:3001/ping', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ timestamp: Date.now() })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const endTime = performance.now();
        const latency = endTime - startTime;
        
        // Convertir la latence en qualité (0-100)
        // 0-50ms = excellent (100)
        // 50-100ms = bon (80)
        // 100-200ms = moyen (60)
        // 200-500ms = médiocre (40)
        // >500ms = mauvais (20)
        let quality = 100;
        if (latency > 500) quality = 20;
        else if (latency > 200) quality = 40;
        else if (latency > 100) quality = 60;
        else if (latency > 50) quality = 80;
        
        return quality;
    } catch (error) {
        console.warn('Impossible de mesurer la qualité de connexion:', error.message);
        return 0; // Retourne 0 en cas d'erreur
    }
}

// Mesurer la bande passante
async function measureBandwidth() {
    try {
        const startTime = performance.now();
        const response = await fetch(`${config.discoveryServer.url}/bandwidth-test`, {
            method: 'GET'
        });
        const endTime = performance.now();
        
        if (!response.ok) {
            throw new Error('Erreur lors de la mesure de la bande passante');
        }

        const data = await response.blob();
        const fileSize = data.size;
        const duration = (endTime - startTime) / 1000; // en secondes
        const bandwidth = (fileSize * 8) / duration; // en bits par seconde
        
        return bandwidth;
    } catch (error) {
        console.error('Erreur lors de la mesure de la bande passante:', error);
        return 0;
    }
}

// Mettre à jour la liste des meilleurs pairs
function updateBestPeers(newPeer) {
    const now = Date.now();
    
    // Vérifier si on doit réinitialiser la liste
    if (now - lastResetTime >= RESET_INTERVAL) {
        console.log('Réinitialisation de la liste des meilleurs pairs');
        bestPeers = [];
        lastResetTime = now;
    }

    // Ajouter le nouveau pair à la liste
    bestPeers.push(newPeer);

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
    
    console.log('Liste des meilleurs pairs mise à jour:', bestPeers);
}

// Mettre à jour la liste des pairs connectés
function updatePeerList() {
    const peerList = document.getElementById('peerList');
    peerList.innerHTML = '';
    
    // Filtrer notre propre ID de la liste
    const filteredPeers = availablePeers.filter(peerData => peerData.peerId !== peer.id);
    
    if (filteredPeers.length === 0) {
        const div = document.createElement('div');
        div.className = 'peer-item';
        div.textContent = 'Aucun pair disponible';
        peerList.appendChild(div);
        return;
    }

    // Fonction pour formater la bande passante
    function formatBandwidth(bandwidth) {
        if (bandwidth >= 1000000) { // Plus de 1 Mbps
            return `${(bandwidth / 1000000).toFixed(2)} Mbps`;
        } else if (bandwidth >= 1000) { // Plus de 1 kbps
            return `${(bandwidth / 1000).toFixed(2)} kbps`;
        } else {
            return `${bandwidth.toFixed(2)} bps`;
        }
    }

    filteredPeers.forEach(peerData => {
        const div = document.createElement('div');
        div.className = 'peer-item connected';
        
        // Formater les informations de qualité de connexion
        let qualityInfo = '';
        if (peerData.connectionQuality) {
            // Si connectionQuality est un nombre, c'est l'ancien format
            if (typeof peerData.connectionQuality === 'number') {
                const quality = peerData.connectionQuality;
                let latency;
                if (quality === 100) latency = 0;
                else if (quality === 80) latency = 50;
                else if (quality === 60) latency = 100;
                else if (quality === 40) latency = 200;
                else if (quality === 20) latency = 500;
                else latency = 1000;
                
                qualityInfo = `
                    <div>Qualité: ${quality}%</div>
                    <div>Latence: ${latency}ms</div>
                `;
            } else {
                // Nouveau format avec objet connectionQuality
                const quality = peerData.connectionQuality.quality || peerData.connectionQuality;
                const latency = peerData.connectionQuality.latency;
                const bandwidth = peerData.connectionQuality.bandwidth;
                
                qualityInfo = `
                    <div>Qualité: ${quality}%</div>
                    ${!isNaN(latency) ? `<div>Latence: ${Math.round(latency)}ms</div>` : ''}
                    ${!isNaN(bandwidth) ? `<div>Bande passante: ${formatBandwidth(bandwidth)}</div>` : ''}
                `;
            }
        }

        div.innerHTML = `
            <div>Pair: ${peerData.peerId}</div>
            <div class="peer-details">
                ${peerData.country ? `Pays: ${peerData.country}` : ''}
                ${peerData.city ? `Ville: ${peerData.city}` : ''}
                <div>Images partagées: ${peerData.sharedImages || 0}</div>
                <div>Page en cours: ${peerData.address || 'home'}</div>
                ${qualityInfo}
            </div>
        `;
        peerList.appendChild(div);
    });
}

// Mettre à jour la liste des pairs disponibles
async function updateAvailablePeers() {
    try {
        const currentPath = window.location.pathname;
        const response = await fetch(`${config.discoveryServer.url}/peers?path=${currentPath}`);
        if (!response.ok) {
            throw new Error('Erreur lors de la récupération des pairs');
        }
        const data = await response.json();
        if (!data.success) {
            throw new Error('Erreur serveur lors de la récupération des pairs');
        }
        
        // Filtrer notre propre ID
        const newPeers = data.peers.filter(peerData => peerData.peerId !== peer.id);
        
        // Mettre à jour la liste des pairs disponibles
        availablePeers = newPeers;
        console.log('Liste des pairs mise à jour:', availablePeers);
        updatePeerList();
    } catch (error) {
        console.error('Erreur lors de la mise à jour des pairs:', error);
    }
}

// Vérifier si la connexion actuelle est toujours active
async function checkCurrentConnection() {
    if (connections.size === 0) {
        return false;
    }

    const currentConn = Array.from(connections.values())[0];
    if (!currentConn || !currentConn.open) {
        return false;
    }

    try {
        // Envoyer un message de vérification au pair actuel
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout lors de la vérification de la connexion'));
            }, 15000); // Augmenter le timeout à 15 secondes

            const messageHandler = (data) => {
                let message;
                try {
                    if (data instanceof ArrayBuffer) {
                        const decoder = new TextDecoder();
                        const text = decoder.decode(data);
                        message = JSON.parse(text);
                    } else if (typeof data === 'string') {
                        message = JSON.parse(data);
                    } else {
                        message = data;
                    }
                } catch (e) {
                    console.error('Erreur lors du parsing du message:', e);
                    return;
                }

                if (message.type === 'pong') {
                    clearTimeout(timeout);
                    currentConn.removeListener('data', messageHandler);
                    resolve(true);
                }
            };

            currentConn.on('data', messageHandler);
            currentConn.send(JSON.stringify({ type: 'ping' }));
        });

        return response;
    } catch (error) {
        console.error('Erreur lors de la vérification de la connexion:', error);
        // Ne pas considérer immédiatement la connexion comme perdue en cas d'erreur
        return true;
    }
}

// S'enregistrer auprès du serveur de découverte
async function registerWithDiscoveryServer(peerId, isRetry = false) {
    try {
        // Réinitialiser explicitement le compteur à 0 lors de l'enregistrement
        sharedImagesCount = 0;
        
        const geolocation = await getGeolocation();
        const connectionQuality = await measureConnectionQuality();
        
        const peerData = {
            peerId,
            address: window.location.pathname,
            country: geolocation.country,
            city: geolocation.city,
            connectionQuality,
            timestamp: Date.now(),
            sharedImages: 0 // Forcer la valeur à 0 lors de l'enregistrement
        };
        
        console.log('Valeur de sharedImagesCount avant envoi:', sharedImagesCount);
        console.log('Données complètes envoyées au serveur lors de l\'enregistrement:', peerData);
        
        const response = await fetch('http://localhost:3001/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(peerData)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('Enregistrement réussi:', data);
        
        // Mettre à jour la liste des pairs
        if (data.peers) {
            availablePeers = data.peers.filter(peerData => peerData.peerId !== peer.id);
            updatePeerList();
        }
        
        // Démarrer le heartbeat
        startHeartbeat(peerId);
        
        return data;
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement:', error);
        // Ne réessayer qu'une seule fois si ce n'est pas déjà un retry
        if (!isRetry) {
            console.log('Tentative de réessai dans 5 secondes...');
            setTimeout(() => registerWithDiscoveryServer(peerId, true), 5000);
        } else {
            console.error('Échec de l\'enregistrement après une tentative de réessai');
            updateConnectionStatus('error', 'Impossible de s\'enregistrer auprès du serveur');
        }
    }
}

// Démarrer le heartbeat
function startHeartbeat(peerId) {
    setInterval(async () => {
        try {
            const connectionQuality = await measureConnectionQuality();
            const bandwidth = await measureBandwidth();
            
            // Calculer la latence à partir de la qualité de connexion
            // La qualité est inversement proportionnelle à la latence
            // 100 = 0ms, 80 = 50ms, 60 = 100ms, 40 = 200ms, 20 = 500ms
            let latency;
            if (connectionQuality === 100) latency = 0;
            else if (connectionQuality === 80) latency = 50;
            else if (connectionQuality === 60) latency = 100;
            else if (connectionQuality === 40) latency = 200;
            else if (connectionQuality === 20) latency = 500;
            else latency = 1000; // Valeur par défaut pour les autres cas

            const peerData = {
                peerId,
                connectionQuality: {
                    quality: connectionQuality,
                    latency: latency,
                    bandwidth: bandwidth
                },
                timestamp: Date.now(),
                sharedImages: sharedImagesCount,
                address: window.location.pathname,
                country: cachedGeolocation?.country || 'Unknown',
                city: cachedGeolocation?.city || 'Unknown'
            };

            console.log('Données envoyées au serveur lors du heartbeat:', peerData);

            const response = await fetch(`${config.discoveryServer.url}/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(peerData)
            });
            
            if (!response.ok) {
                throw new Error('Erreur lors du heartbeat');
            }

            // Mettre à jour la liste des meilleurs pairs
            updateBestPeers(peerData);
        } catch (error) {
            console.error('Erreur lors du heartbeat:', error);
        }
    }, config.discoveryServer.heartbeatInterval);
}

// Se désinscrire du serveur de découverte
async function unregisterFromDiscoveryServer(peerId) {
    console.log('Tentative de désinscription du pair:', peerId);
    try {
        const url = `${config.discoveryServer.url}/unregister`;
        console.log('Envoi de la requête de désinscription à:', url);
        
        // Essayer d'abord avec fetch
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ peerId }),
                keepalive: true
            });
            
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }
            console.log('Désinscription réussie via fetch');
            return;
        } catch (fetchError) {
            console.warn('Échec de fetch, tentative avec sendBeacon:', fetchError);
        }
        
        // Fallback avec sendBeacon
        const data = new Blob([JSON.stringify({ peerId })], { type: 'application/json' });
        const success = navigator.sendBeacon(url, data);
        
        if (!success) {
            throw new Error('Échec de l\'envoi de la requête de déconnexion');
        }
        console.log('Désinscription réussie via sendBeacon');
    } catch (error) {
        console.error('Erreur lors de la désinscription:', error);
    }
}

// Supprimer un pair problématique de la liste
function removeProblematicPeer(peerId) {
    console.log(`Suppression du pair problématique ${peerId} de la liste`);
    
    // Supprimer de la liste des pairs disponibles
    availablePeers = availablePeers.filter(p => p.peerId !== peerId);
    
    // Supprimer de la liste des meilleurs pairs
    bestPeers = bestPeers.filter(p => p.peerId !== peerId);
    
    // Mettre à jour l'affichage
    updatePeerList();
    
    console.log('Liste des pairs après suppression:', availablePeers);
}

// Se connecter au prochain pair disponible
async function connectToNextPeer() {
    if (availablePeers.length === 0) {
        console.log('Aucun pair disponible');
        updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
        // Vérifier à nouveau dans 5 secondes
        setTimeout(async () => {
            await updateAvailablePeers();
            if (availablePeers.length > 0) {
                connectToNextPeer();
            }
        }, 5000);
        return;
    }

    // Si on a déjà une connexion, on la ferme
    if (connections.size > 0) {
        const currentConn = Array.from(connections.values())[0];
        currentConn.close();
    }

    // Se connecter au prochain pair dans la liste
    currentPeerIndex = (currentPeerIndex + 1) % availablePeers.length;
    const nextPeer = availablePeers[currentPeerIndex];

    if (!nextPeer || !nextPeer.peerId) {
        console.log('Pair invalide, mise à jour de la liste des pairs...');
        await updateAvailablePeers();
        // Ne pas appeler connectToNextPeer() ici pour éviter la boucle infinie
        if (availablePeers.length === 0) {
            updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
        }
        return;
    }

    try {
        console.log(`Tentative de connexion au pair ${nextPeer.peerId}`);
        updateConnectionStatus('connecting', `Tentative de connexion à ${nextPeer.peerId}...`);

        // Vérifier si le peer est toujours valide
        if (!peer || peer.disconnected) {
            console.log('Réinitialisation du peer...');
            await initializePeer();
            return;
        }

        const conn = peer.connect(nextPeer.peerId, { reliable: true });
        
        conn.on('open', () => {
            console.log(`Connexion établie avec ${nextPeer.peerId}`);
            connections.set(nextPeer.peerId, conn);
            updateConnectionStatus('connected', `Connecté à ${nextPeer.peerId}`);
            updatePeerList();
        });

        conn.on('close', () => {
            console.log(`Connexion fermée avec ${nextPeer.peerId}`);
            connections.delete(nextPeer.peerId);
            peerImages.delete(nextPeer.peerId);
            removeProblematicPeer(nextPeer.peerId);
            
            // Vérifier immédiatement s'il y a d'autres pairs disponibles
            if (availablePeers.length > 0) {
                console.log('Tentative de connexion à un autre pair après fermeture...');
                setTimeout(() => connectToNextPeer(), 1000); // Ajouter un délai pour éviter les appels trop rapides
            } else {
                updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                // Vérifier à nouveau dans 5 secondes
                setTimeout(async () => {
                    await updateAvailablePeers();
                    if (availablePeers.length > 0) {
                        connectToNextPeer();
                    }
                }, 5000);
            }
        });

        conn.on('error', (err) => {
            console.error(`Erreur de connexion avec ${nextPeer.peerId}:`, err);
            connections.delete(nextPeer.peerId);
            peerImages.delete(nextPeer.peerId);
            removeProblematicPeer(nextPeer.peerId);
            
            // Vérifier immédiatement s'il y a d'autres pairs disponibles
            if (availablePeers.length > 0) {
                console.log('Tentative de connexion à un autre pair après erreur...');
                setTimeout(() => connectToNextPeer(), 1000); // Ajouter un délai pour éviter les appels trop rapides
            } else {
                updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                // Vérifier à nouveau dans 5 secondes
                setTimeout(async () => {
                    await updateAvailablePeers();
                    if (availablePeers.length > 0) {
                        connectToNextPeer();
                    }
                }, 5000);
            }
        });
    } catch (error) {
        console.error(`Erreur lors de la connexion à ${nextPeer.peerId}:`, error);
        removeProblematicPeer(nextPeer.peerId);
        
        // Vérifier immédiatement s'il y a d'autres pairs disponibles
        if (availablePeers.length > 0) {
            console.log('Tentative de connexion à un autre pair après erreur...');
            setTimeout(() => connectToNextPeer(), 1000); // Ajouter un délai pour éviter les appels trop rapides
        } else {
            updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
            // Vérifier à nouveau dans 5 secondes
            setTimeout(async () => {
                await updateAvailablePeers();
                if (availablePeers.length > 0) {
                    connectToNextPeer();
                }
            }, 5000);
        }
    }
}

// Vérifier si une image est disponible dans le cache
function isImageAvailable(imagePath, peerId = null) {
    console.log('Vérification du cache pour:', {
        imagePath,
        peerId,
        displayedImages: Array.from(displayedImages),
        imageCache: Array.from(imageCache.entries())
    });

    // Vérifier d'abord l'ID serveur
    const serverImageId = `server-server-${imagePath}`;
    console.log('Vérification de l\'ID serveur:', serverImageId);
    
    if (displayedImages.has(serverImageId)) {
        if (isCacheValid(serverImageId)) {
            console.log('Image trouvée dans le cache serveur et valide');
            return true;
        } else {
            console.log('Image trouvée dans le cache serveur mais expirée, suppression');
            displayedImages.delete(serverImageId);
            imageCache.delete(serverImageId);
            const container = document.querySelector(`[data-image-id="${serverImageId}"]`);
            if (container) {
                container.remove();
            }
        }
    }

    // Si on vérifie pour un pair spécifique, vérifier son ID
    if (peerId) {
        const peerImageId = `peer-${peerId}-${imagePath}`;
        console.log('Vérification de l\'ID du pair:', peerImageId);
        
        if (displayedImages.has(peerImageId)) {
            if (isCacheValid(peerImageId)) {
                console.log('Image trouvée dans le cache du pair et valide');
                return true;
            } else {
                console.log('Image trouvée dans le cache du pair mais expirée, suppression');
                displayedImages.delete(peerImageId);
                imageCache.delete(peerImageId);
                const container = document.querySelector(`[data-image-id="${peerImageId}"]`);
                if (container) {
                    container.remove();
                }
            }
        }
    }

    console.log('Image non trouvée dans le cache ou non valide');
    return false;
}

// Mettre à jour l'affichage du nombre d'images partagées
function updateSharedImagesCount() {
    const sharedImagesElement = document.getElementById('sharedImagesCount');
    if (!sharedImagesElement) {
        // Créer l'élément s'il n'existe pas
        const container = document.createElement('div');
        container.className = 'shared-images-info';
        container.innerHTML = `
            <div class="info-label">Images partagées:</div>
            <div id="sharedImagesCount" class="info-value">0</div>
        `;
        document.querySelector('.panel').appendChild(container);
    }
    document.getElementById('sharedImagesCount').textContent = sharedImagesCount;
}

// Gérer une demande d'image
async function handleImageRequest(conn, imagePath) {
    console.log(`Traitement de la demande d'image: ${imagePath}`);
    try {
        // Vérifier d'abord l'ID serveur
        const serverImageId = `server-server-${imagePath}`;
        console.log('Recherche de l\'image avec l\'ID serveur:', serverImageId);
        
        if (displayedImages.has(serverImageId)) {
            const img = document.querySelector(`[data-image-id="${serverImageId}"] img`);
            if (img && img.src) {
                console.log(`Image ${imagePath} trouvée dans le cache serveur, envoi en cours`);
                console.log('Source de l\'image:', img.src);
                sharedImagesCount++; // Incrémenter le compteur
                updateSharedImagesCount(); // Mettre à jour l'affichage
                
                // Récupérer les headers de cache de l'image depuis le cache local
                const cacheEntry = imageCache.get(serverImageId);
                const cacheHeaders = cacheEntry?.cacheHeaders || {
                    'Cache-Control': `max-age=${CACHE_DURATION}`,
                    'Expires': new Date(Date.now() + CACHE_DURATION * 1000).toUTCString()
                };
                
                const message = {
                    type: 'image',
                    data: img.src,
                    source: 'cache',
                    cacheId: serverImageId,
                    cacheHeaders: cacheHeaders
                };
                
                console.log('Envoi du message avec headers de cache:', message);
                conn.send(JSON.stringify(message));
                return;
            } else {
                console.log('Image trouvée dans le cache serveur mais non accessible, suppression');
                displayedImages.delete(serverImageId);
            }
        }

        // Si pas trouvée avec l'ID serveur, vérifier l'ID du pair
        const peerImageId = `peer-${conn.peer}-${imagePath}`;
        console.log('Recherche de l\'image avec l\'ID du pair:', peerImageId);
        
        if (displayedImages.has(peerImageId)) {
            const img = document.querySelector(`[data-image-id="${peerImageId}"] img`);
            if (img && img.src) {
                console.log(`Image ${imagePath} trouvée dans le cache du pair, envoi en cours`);
                console.log('Source de l\'image:', img.src);
                sharedImagesCount++; // Incrémenter le compteur
                updateSharedImagesCount(); // Mettre à jour l'affichage
                
                // Récupérer les headers de cache de l'image depuis le cache local
                const cacheEntry = imageCache.get(peerImageId);
                const cacheHeaders = cacheEntry?.cacheHeaders || {
                    'Cache-Control': `max-age=${CACHE_DURATION}`,
                    'Expires': new Date(Date.now() + CACHE_DURATION * 1000).toUTCString()
                };
                
                const message = {
                    type: 'image',
                    data: img.src,
                    source: 'cache',
                    cacheId: peerImageId,
                    cacheHeaders: cacheHeaders
                };
                
                console.log('Envoi du message avec headers de cache:', message);
                conn.send(JSON.stringify(message));
                return;
            } else {
                console.log('Image trouvée dans le cache du pair mais non accessible, suppression');
                displayedImages.delete(peerImageId);
            }
        }

        console.log(`Image ${imagePath} non disponible dans le cache, chargement depuis le serveur`);
        // Si l'image n'est pas dans le cache, la charger depuis le serveur
        const response = await fetch(imagePath, {
            headers: {
                'Cache-Control': `max-age=${CACHE_DURATION}`,
                'Expires': new Date(Date.now() + CACHE_DURATION * 1000).toUTCString()
            }
        });
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        // Récupérer les headers de cache de la réponse du serveur
        const cacheControl = response.headers.get('Cache-Control');
        const expires = response.headers.get('Expires');
        
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
            const imageData = reader.result;
            console.log('Image chargée depuis le serveur, envoi en cours');
            sharedImagesCount++; // Incrémenter le compteur
            updateSharedImagesCount(); // Mettre à jour l'affichage
            
            const message = {
                type: 'image',
                data: imageData,
                source: 'server',
                path: imagePath,
                cacheHeaders: {
                    'Cache-Control': cacheControl || `max-age=${CACHE_DURATION}`,
                    'Expires': expires || new Date(Date.now() + CACHE_DURATION * 1000).toUTCString()
                }
            };
            
            console.log('Envoi du message avec headers de cache:', message);
            conn.send(JSON.stringify(message));
        };
        reader.readAsDataURL(blob);
    } catch (error) {
        console.error('Erreur lors de l\'envoi de l\'image:', error);
        conn.send(JSON.stringify({
            type: 'image_error',
            data: `Erreur lors du chargement: ${error.message}`
        }));
    }
}

// Initialiser la connexion P2P
async function initializePeer() {
    return new Promise((resolve, reject) => {
        updateConnectionStatus('connecting', 'Connexion en cours...');
        
        try {
            peer = new Peer({
                debug: 3,
                config: {
                    'iceServers': [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            peer.on('open', async (id) => {
                document.getElementById('peerId').textContent = id;
                console.log('Connecté avec l\'ID:', id);
                
                // S'enregistrer auprès du serveur de découverte
                await registerWithDiscoveryServer(id);
                
                // Récupérer la liste des pairs disponibles
                await updateAvailablePeers();
                
                // Se connecter au premier pair
                if (availablePeers.length > 0) {
                    connectToNextPeer();
                } else {
                    updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                }
                
                resolve();
            });

            // Ajouter la gestion des connexions entrantes
            peer.on('connection', (conn) => {
                console.log('=== NOUVELLE CONNEXION ENTRANTE ===');
                console.log('ID du pair connecté:', conn.peer);
                
                conn.on('open', () => {
                    console.log(`Connexion ouverte avec ${conn.peer}`);
                });

                conn.on('data', (data) => {
                    console.log('=== DÉBUT TRAITEMENT MESSAGE ENTRANT ===');
                    console.log('Type de données reçu:', typeof data);
                    console.log('Est ArrayBuffer:', data instanceof ArrayBuffer);
                    console.log('Est String:', typeof data === 'string');
                    console.log('Données brutes:', data);
                    
                    let message;
                    try {
                        if (data instanceof ArrayBuffer) {
                            const decoder = new TextDecoder();
                            const text = decoder.decode(data);
                            message = JSON.parse(text);
                        } else if (typeof data === 'string') {
                            message = JSON.parse(data);
                        } else {
                            message = data;
                        }
                    } catch (e) {
                        console.error('Erreur lors du parsing du message:', e);
                        return;
                    }

                    if (!message || !message.type) {
                        console.error('Message invalide:', message);
                        return;
                    }

                    console.log('Message final à traiter:', message);
                    console.log('Type du message:', message.type);
                    console.log('Données du message:', message.data);

                    switch(message.type) {
                        case 'ping':
                            console.log('Ping reçu de', conn.peer);
                            // Répondre immédiatement avec un pong
                            conn.send(JSON.stringify({ type: 'pong' }));
                            break;
                        case 'image':
                            console.log('=== RÉCEPTION D\'UNE IMAGE ===');
                            console.log('Source:', conn.peer);
                            console.log('Données reçues:', message.data);
                            console.log('Informations de cache:', message.source, message.cacheId || message.path);
                            console.log('Headers de cache reçus:', message.cacheHeaders);
                            
                            // Créer l'objet cacheInfo avec toutes les informations nécessaires
                            const cacheInfo = {
                                source: message.source || 'peer',
                                cacheId: message.cacheId,
                                path: message.path,
                                cacheHeaders: message.cacheHeaders
                            };
                            
                            displayImage(message.data, `Image reçue de ${conn.peer}`, 'peer', conn.peer, cacheInfo);
                            break;
                        case 'image_list':
                            console.log(`Liste d'images reçue de ${conn.peer}:`, message.data);
                            peerImages.set(conn.peer, message.data);
                            updatePeerList();
                            break;
                        case 'request_image':
                            console.log(`Demande d'image reçue: ${message.data}`);
                            handleImageRequest(conn, message.data);
                            break;
                        case 'check_image':
                            console.log(`Vérification de l'image: ${message.data}`);
                            const hasImage = isImageAvailable(message.data, conn.peer);
                            console.log(`Réponse: ${hasImage ? 'Image disponible' : 'Image non disponible'}`);
                            const response = {
                                type: 'image_availability',
                                data: {
                                    path: message.data,
                                    available: hasImage
                                }
                            };
                            console.log('Envoi de la réponse de disponibilité:', response);
                            conn.send(JSON.stringify(response));
                            break;
                        case 'image_availability':
                            console.log('Réponse de disponibilité reçue:', message.data);
                            break;
                        case 'get_images':
                            console.log('Demande de liste d\'images reçue');
                            const imageListResponse = {
                                type: 'image_list',
                                data: images
                            };
                            console.log('Envoi de la liste d\'images:', imageListResponse);
                            conn.send(JSON.stringify(imageListResponse));
                            break;
                        case 'image_error':
                            console.log('Erreur d\'image reçue:', message.data);
                            break;
                        default:
                            console.log('Type de message inconnu:', message.type);
                    }
                    console.log('=== FIN TRAITEMENT MESSAGE ENTRANT ===');
                });

                conn.on('close', () => {
                    console.log(`Connexion fermée avec ${conn.peer}`);
                });

                conn.on('error', (err) => {
                    console.error(`Erreur de connexion avec ${conn.peer}:`, err);
                });
            });

            peer.on('error', (err) => {
                console.error('Erreur PeerJS:', err);
                updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                
                // Si l'erreur est liée à une connexion échouée, supprimer le pair et essayer le suivant
                if (err.message && err.message.includes('Could not connect to peer')) {
                    const failedPeerId = err.message.split('Could not connect to peer ')[1];
                    if (failedPeerId) {
                        removeProblematicPeer(failedPeerId);
                        console.log('Tentative de connexion au prochain pair après erreur...');
                        connectToNextPeer();
                    }
                }
                
                reject(err);
            });

            peer.on('close', async () => {
                updateConnectionStatus('disconnected', 'Déconnecté du réseau');
                console.log('Connexion P2P fermée');
                if (peer.id) {
                    await unregisterFromDiscoveryServer(peer.id);
                }
            });
        } catch (error) {
            console.error('Erreur lors de l\'initialisation:', error);
            updateConnectionStatus('disconnected', 'Erreur d\'initialisation');
            reject(error);
        }
    });
}

// Charger une image de test
async function loadTestImage() {
    console.log('=== DÉBUT LOAD TEST IMAGE ===');
    console.log('Index initial:', currentImageIndex);
    
    const imagesContainer = document.getElementById('images-container');
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'image-container loading';
    imagesContainer.appendChild(loadingContainer);

    try {
        if (currentImageIndex >= images.length) {
            console.log('Réinitialisation de l\'index des images');
            currentImageIndex = 0;
        }

        const selectedImage = images[currentImageIndex];
        console.log(`=== CHARGEMENT DE L'IMAGE ${selectedImage} ===`);
        console.log('Index actuel:', currentImageIndex);

        // Vérifier si nous avons une connexion active
        if (connections.size === 0) {
            console.log('Aucun pair connecté, chargement depuis le serveur');
            await loadImageFromServer(selectedImage, loadingContainer);
            console.log('Chargement depuis le serveur terminé');
            return;
        }

        const currentPeerId = Array.from(connections.keys())[0];
        const conn = connections.get(currentPeerId);

        // Vérifier si la connexion est toujours active
        const isConnectionActive = await checkCurrentConnection();
        if (!isConnectionActive) {
            console.log('Connexion au pair perdue, chargement depuis le serveur');
            await loadImageFromServer(selectedImage, loadingContainer);
            console.log('Chargement depuis le serveur terminé');
            return;
        }
        
        try {
            // D'abord vérifier si le pair a l'image dans son cache
            console.log(`Vérification de la disponibilité de l'image ${selectedImage} auprès du pair ${currentPeerId}`);
            
            const hasImage = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout lors de la vérification'));
                }, 5000);

                const messageHandler = (data) => {
                    console.log('Message reçu pendant la vérification:', data);
                    let message;
                    try {
                        if (data instanceof ArrayBuffer) {
                            const decoder = new TextDecoder();
                            const text = decoder.decode(data);
                            message = JSON.parse(text);
                        } else if (typeof data === 'string') {
                            message = JSON.parse(data);
                        } else {
                            message = data;
                        }
                    } catch (e) {
                        console.error('Erreur lors du parsing du message:', e);
                        return;
                    }

                    if (message.type === 'image_availability') {
                        clearTimeout(timeout);
                        conn.removeListener('data', messageHandler);
                        console.log('Réponse de disponibilité reçue:', message.data);
                        resolve(message.data.available);
                    }
                };

                conn.on('data', messageHandler);
                const checkMessage = {
                    type: 'check_image',
                    data: selectedImage
                };
                conn.send(JSON.stringify(checkMessage));
            });

            if (!hasImage) {
                console.log(`Le pair ${currentPeerId} n'a pas l'image ${selectedImage} dans son cache`);
                // Charger l'image depuis le serveur
                await loadImageFromServer(selectedImage, loadingContainer);
                
                // Mettre à jour la liste des pairs disponibles
                await updateAvailablePeers();
                
                // Si d'autres pairs sont disponibles, se connecter à un nouveau pair
                if (availablePeers.length > 1) {
                    console.log('D\'autres pairs disponibles, changement de pair...');
                    changePeer();
                }
                return;
            }

            console.log(`Le pair ${currentPeerId} a l'image ${selectedImage} dans son cache, chargement en cours...`);
            
            const imageData = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout lors du chargement'));
                }, 10000);

                const messageHandler = (data) => {
                    let message;
                    try {
                        if (data instanceof ArrayBuffer) {
                            const decoder = new TextDecoder();
                            const text = decoder.decode(data);
                            message = JSON.parse(text);
                        } else if (typeof data === 'string') {
                            message = JSON.parse(data);
                        } else {
                            message = data;
                        }
                    } catch (e) {
                        console.error('Erreur lors du parsing du message:', e);
                        return;
                    }

                    console.log('Message parsé:', message);

                    if (message.type === 'image') {
                        clearTimeout(timeout);
                        conn.removeListener('data', messageHandler);
                        console.log('Image reçue du pair');
                        resolve(message);
                    } else if (message.type === 'image_error') {
                        clearTimeout(timeout);
                        conn.removeListener('data', messageHandler);
                        console.error('Erreur reçue du pair:', message.data);
                        reject(new Error(message.data));
                    }
                };

                conn.on('data', messageHandler);
                const requestMessage = {
                    type: 'request_image',
                    data: selectedImage
                };
                conn.send(JSON.stringify(requestMessage));
            });

            loadingContainer.remove();
            console.log('Affichage de l\'image reçue du pair');
            displayImage(imageData.data, `Image reçue de ${currentPeerId} (${selectedImage})`, 'peer', currentPeerId, imageData.cacheHeaders);
            console.log('Chargement depuis le pair terminé');
            return;
        } catch (error) {
            console.warn(`Échec de la récupération depuis le pair ${currentPeerId}:`, error);
            // Si on a une erreur de communication, on charge depuis le serveur
            console.log('Erreur de communication avec le pair, chargement depuis le serveur');
            await loadImageFromServer(selectedImage, loadingContainer);
            console.log('Chargement depuis le serveur terminé');
            
            // Mettre à jour la liste des pairs disponibles
            await updateAvailablePeers();
            
            // Si d'autres pairs sont disponibles, se connecter à un nouveau pair
            if (availablePeers.length > 1) {
                console.log('D\'autres pairs disponibles, changement de pair...');
                changePeer();
            }
        }
    } catch (error) {
        loadingContainer.remove();
        const errorContainer = document.createElement('div');
        errorContainer.className = 'error-message';
        errorContainer.textContent = `Erreur: ${error.message}`;
        imagesContainer.appendChild(errorContainer);
    } finally {
        // Incrémenter l'index une seule fois à la fin de la fonction
        currentImageIndex++;
        console.log('=== FIN LOAD TEST IMAGE ===');
        console.log('Index final après incrémentation:', currentImageIndex);
    }
}

// Fonction utilitaire pour charger une image depuis le serveur
async function loadImageFromServer(imagePath, loadingContainer) {
    console.log(`=== DÉBUT LOAD IMAGE FROM SERVER ===`);
    console.log(`Chargement de l'image ${imagePath} depuis le serveur`);
    console.log('Index avant chargement:', currentImageIndex);
    
    try {
        // Utiliser le chemin complet depuis la racine du serveur
        const fullPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
        const response = await fetch(fullPath, {
            headers: {
                'Cache-Control': `max-age=${CACHE_DURATION}`,
                'Expires': new Date(Date.now() + CACHE_DURATION * 1000).toUTCString()
            }
        });
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const blob = await response.blob();
        const reader = new FileReader();
        
        return new Promise((resolve, reject) => {
            reader.onloadend = () => {
                loadingContainer.remove();
                const imageData = reader.result;
                console.log('Image chargée depuis le serveur, affichage en cours');
                displayImage(imageData, `Image locale (${imagePath})`, 'server');
                console.log('Index après affichage:', currentImageIndex);
                resolve();
            };
            
            reader.onerror = (error) => {
                loadingContainer.remove();
                reject(new Error('Erreur lors de la lecture du fichier'));
            };
            
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        loadingContainer.remove();
        console.log('=== ERREUR LOAD IMAGE FROM SERVER ===');
        console.log('Index lors de l\'erreur:', currentImageIndex);
        throw error;
    } finally {
        console.log('=== FIN LOAD IMAGE FROM SERVER ===');
        console.log('Index final:', currentImageIndex);
    }
}

// Afficher une image
async function displayImage(imageData, status, source = 'server', peerId = null, cacheHeaders = null) {
    const imagePath = status.includes('(') ? status.match(/\((.*?)\)/)[1] : imageData;
    const imageId = source === 'server' 
        ? `server-server-${imagePath}`
        : `peer-${peerId}-${imagePath}`;
    
    console.log('=== AFFICHAGE D\'UNE IMAGE ===');
    console.log('Détails:', {
        imagePath,
        source,
        peerId,
        imageId,
        cacheHeaders: cacheHeaders,
        displayedImages: Array.from(displayedImages),
        isDisplayed: displayedImages.has(imageId)
    });
    
    // Vérifier si l'image est en cache et toujours valide
    if (displayedImages.has(imageId)) {
        const isValid = await isCacheValid(imageId);
        if (isValid) {
            console.log(`Image ${imagePath} déjà affichée et cache valide, on passe à la suivante`);
            return;
        } else {
            console.log(`Image ${imagePath} en cache mais expirée, on la recharge`);
            displayedImages.delete(imageId);
            imageCache.delete(imageId);
            const container = document.querySelector(`[data-image-id="${imageId}"]`);
            if (container) {
                container.remove();
            }
        }
    }
    
    // Ajouter l'image au cache avec le timestamp actuel et les headers de cache
    imageCache.set(imageId, {
        timestamp: Date.now(),
        data: imageData,
        cacheHeaders: cacheHeaders || {
            'Cache-Control': `max-age=${CACHE_DURATION}`,
            'Expires': new Date(Date.now() + CACHE_DURATION * 1000).toUTCString()
        }
    });
    displayedImages.add(imageId);
    
    console.log(`Ajout de l'image ${imagePath} au cache (ID: ${imageId}, Timestamp: ${new Date().toLocaleString()})`);

    const container = document.createElement('div');
    container.className = 'image-container';
    container.dataset.imageId = imageId;

    const img = document.createElement('img');
    img.src = imageData;
    img.alt = 'Image partagée';
    img.onload = async () => {
        console.log(`Image ${imageId} chargée avec succès`);
        const isValid = await isCacheValid(imageId);
        console.log('État du cache après chargement:', {
            imageId,
            isInCache: displayedImages.has(imageId),
            cacheValid: isValid,
            timestamp: new Date(imageCache.get(imageId)?.timestamp).toLocaleString(),
            cacheHeaders: imageCache.get(imageId)?.cacheHeaders,
            allImages: Array.from(displayedImages)
        });
    };
    img.onerror = (error) => {
        console.error(`Erreur lors du chargement de l'image ${imageId}:`, error);
        displayedImages.delete(imageId);
        imageCache.delete(imageId);
        console.log('Image supprimée du cache à cause d\'une erreur');
    };

    const sourceDiv = document.createElement('div');
    sourceDiv.className = `image-source ${source}`;
    sourceDiv.textContent = source === 'server' ? 'Serveur' : `Pair: ${peerId}`;

    // Calculer la date d'expiration en fonction des headers de cache
    let expirationDate;
    if (cacheHeaders) {
        if (cacheHeaders.Expires) {
            expirationDate = new Date(cacheHeaders.Expires);
        } else if (cacheHeaders['Cache-Control']) {
            const maxAgeMatch = cacheHeaders['Cache-Control'].match(/max-age=(\d+)/);
            if (maxAgeMatch) {
                const maxAge = parseInt(maxAgeMatch[1]);
                expirationDate = new Date(Date.now() + maxAge * 1000);
            }
        }
    }
    
    // Si pas de date d'expiration définie, utiliser la durée par défaut
    if (!expirationDate) {
        expirationDate = new Date(Date.now() + CACHE_DURATION * 1000);
    }

    const statusDiv = document.createElement('div');
    statusDiv.className = 'status';
    statusDiv.textContent = `${status} (Expire le ${expirationDate.toLocaleDateString()} à ${expirationDate.toLocaleTimeString()})`;

    container.appendChild(img);
    container.appendChild(sourceDiv);
    container.appendChild(statusDiv);
    
    document.getElementById('images-container').appendChild(container);
}

// Changer de pair
function changePeer() {
    if (availablePeers.length <= 1) {
        console.log('Pas d\'autre pair disponible');
        alert('Pas d\'autre pair disponible');
        return;
    }

    console.log('Changement de pair demandé');
    
    // Si on a déjà une connexion, on la ferme
    if (connections.size > 0) {
        const currentConn = Array.from(connections.values())[0];
        currentConn.close();
    }

    // Se connecter au prochain pair dans la liste
    currentPeerIndex = (currentPeerIndex + 1) % availablePeers.length;
    const nextPeer = availablePeers[currentPeerIndex];

    if (!nextPeer || !nextPeer.peerId) {
        console.log('Pair invalide');
        updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
        return;
    }

    try {
        console.log(`Tentative de connexion au pair ${nextPeer.peerId}`);
        updateConnectionStatus('connecting', `Tentative de connexion à ${nextPeer.peerId}...`);

        const conn = peer.connect(nextPeer.peerId, { reliable: true });
        
        conn.on('open', () => {
            console.log(`Connexion établie avec ${nextPeer.peerId}`);
            connections.set(nextPeer.peerId, conn);
            updateConnectionStatus('connected', `Connecté à ${nextPeer.peerId}`);
            updatePeerList();
        });

        conn.on('close', () => {
            console.log(`Connexion fermée avec ${nextPeer.peerId}`);
            connections.delete(nextPeer.peerId);
            peerImages.delete(nextPeer.peerId);
            removeProblematicPeer(nextPeer.peerId);
            updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
        });

        conn.on('error', (err) => {
            console.error(`Erreur de connexion avec ${nextPeer.peerId}:`, err);
            connections.delete(nextPeer.peerId);
            peerImages.delete(nextPeer.peerId);
            removeProblematicPeer(nextPeer.peerId);
            updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
        });
    } catch (error) {
        console.error(`Erreur lors de la connexion à ${nextPeer.peerId}:`, error);
        removeProblematicPeer(nextPeer.peerId);
        updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
    }
}

// Mettre à jour l'indicateur d'état de connexion
function updateConnectionStatus(status, message) {
    const statusContainer = document.querySelector('.connection-status');
    if (!statusContainer) {
        // Créer le conteneur s'il n'existe pas
        const container = document.createElement('div');
        container.className = 'connection-status';
        container.innerHTML = `
            <div class="status-indicator ${status}"></div>
            <div class="status-text">${message}</div>
            <button id="changePeerBtn" class="change-peer-btn" style="display: none;">Changer de pair</button>
        `; 
        document.querySelector('.panel').insertBefore(container, document.getElementById('peerId').parentNode);
        
        // Ajouter l'écouteur d'événement pour le bouton
        document.getElementById('changePeerBtn').addEventListener('click', () => {
            changePeer();
        });
    } else {
        // Mettre à jour le conteneur existant
        const indicator = statusContainer.querySelector('.status-indicator');
        const text = statusContainer.querySelector('.status-text');
        let changePeerBtn = statusContainer.querySelector('.change-peer-btn');
        
        // Mettre à jour l'indicateur et le texte
        indicator.className = `status-indicator ${status}`;
        text.textContent = message;
        
        // Gérer le bouton "Changer de pair"
        if (status === 'connected' && availablePeers.length > 1) {
            if (!changePeerBtn) {
                // Si le bouton n'existe pas, le créer
                changePeerBtn = document.createElement('button');
                changePeerBtn.id = 'changePeerBtn';
                changePeerBtn.className = 'change-peer-btn';
                changePeerBtn.textContent = 'Changer de pair';
                changePeerBtn.addEventListener('click', () => {
                    changePeer();
                });
                statusContainer.appendChild(changePeerBtn);
            }
            changePeerBtn.style.display = 'block';
        } else if (changePeerBtn) {
            changePeerBtn.style.display = 'none';
        }
    }
} 
