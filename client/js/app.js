import config from './config.js';

let peer = null;
let connections = new Map();
let peerImages = new Map();
const images = config.images.paths;
let availablePeers = []; // Liste des pairs disponibles au démarrage
let currentPeerIndex = 0; // Index du pair actuellement connecté
let currentImageIndex = 0; // Index de l'image actuelle

// Stocker les images déjà affichées pour éviter les doublons
const displayedImages = new Set();

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
    try {
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();
        return {
            country: data.country_name,
            city: data.city
        };
    } catch (error) {
        console.error('Erreur lors de la géolocalisation:', error);
        return { country: null, city: null };
    }
}

// S'enregistrer auprès du serveur de découverte
async function registerWithDiscoveryServer(peerId) {
    try {
        const { country, city } = await getGeolocation();
        const response = await fetch(`${config.discoveryServer.url}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                peerId,
                address: window.location.href,
                country,
                city
            })
        });
        if (!response.ok) {
            throw new Error('Erreur lors de l\'enregistrement');
        }
        console.log('Enregistré auprès du serveur de découverte');
        
        // Démarrer le heartbeat
        startHeartbeat(peerId);
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement:', error);
    }
}

// Démarrer le heartbeat
function startHeartbeat(peerId) {
    setInterval(async () => {
        try {
            const response = await fetch(`${config.discoveryServer.url}/heartbeat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ peerId })
            });
            if (!response.ok) {
                throw new Error('Erreur lors du heartbeat');
            }
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

// Se connecter au prochain pair disponible
async function connectToNextPeer() {
    if (availablePeers.length === 0) {
        console.log('Aucun pair disponible');
        updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
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

    try {
        console.log(`Tentative de connexion au pair ${nextPeer.id}`);
        updateConnectionStatus('connecting', `Tentative de connexion à ${nextPeer.id}...`);
        const conn = peer.connect(nextPeer.id, { reliable: true });
        
        conn.on('open', () => {
            console.log(`Connexion établie avec ${nextPeer.id}`);
            connections.set(nextPeer.id, conn);
            updateConnectionStatus('connected', `Connecté à ${nextPeer.id}`);
            updatePeerList();

            // Demander la liste des images
            conn.send({
                type: 'get_images'
            });
        });

        conn.on('data', (data) => {
            console.log('Données reçues:', data);
            switch(data.type) {
                case 'image':
                    displayImage(data.data, `Image reçue de ${nextPeer.id}`, 'peer', nextPeer.id);
                    break;
                case 'image_list':
                    peerImages.set(nextPeer.id, data.data);
                    updatePeerList();
                    break;
                case 'request_image':
                    // Un pair demande une image
                    handleImageRequest(conn, data.data);
                    break;
            }
        });

        conn.on('close', () => {
            console.log(`Connexion fermée avec ${nextPeer.id}`);
            connections.delete(nextPeer.id);
            peerImages.delete(nextPeer.id);
            updatePeerList();
            
            // Si on n'a plus de connexions, on est toujours sur le réseau mais pas connecté à un pair
            if (connections.size === 0) {
                updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                // Essayer de se connecter au prochain pair après un court délai
                setTimeout(connectToNextPeer, 1000);
            }
        });

        conn.on('error', (err) => {
            console.error(`Erreur de connexion avec ${nextPeer.id}:`, err);
            connections.delete(nextPeer.id);
            peerImages.delete(nextPeer.id);
            updatePeerList();
            
            // Si on n'a plus de connexions, on est toujours sur le réseau mais pas connecté à un pair
            if (connections.size === 0) {
                updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                // Essayer de se connecter au prochain pair après un court délai
                setTimeout(connectToNextPeer, 1000);
            }
        });
    } catch (error) {
        console.error(`Erreur lors de la connexion à ${nextPeer.id}:`, error);
        // Si on n'a plus de connexions, on est toujours sur le réseau mais pas connecté à un pair
        if (connections.size === 0) {
            updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
            // Essayer de se connecter au prochain pair après un court délai
            setTimeout(connectToNextPeer, 1000);
        }
    }
}

// Gérer une demande d'image
async function handleImageRequest(conn, imagePath) {
    try {
        const response = await fetch(imagePath);
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
            conn.send({
                type: 'image',
                data: reader.result
            });
        };
        reader.readAsDataURL(blob);
    } catch (error) {
        console.error('Erreur lors de l\'envoi de l\'image:', error);
    }
}

// Mettre à jour la liste des pairs connectés
function updatePeerList() {
    const peerList = document.getElementById('peerList');
    peerList.innerHTML = '';
    
    if (availablePeers.length === 0) {
        const div = document.createElement('div');
        div.className = 'peer-item';
        div.textContent = 'Aucun pair disponible';
        peerList.appendChild(div);
        return;
    }

    availablePeers.forEach(peerData => {
        const div = document.createElement('div');
        div.className = 'peer-item connected'; // Tous les pairs disponibles sont considérés comme connectés
        div.innerHTML = `
            <div>Pair: ${peerData.id}</div>
            <div class="peer-details">
                ${peerData.country ? `Pays: ${peerData.country}` : ''}
                ${peerData.city ? `Ville: ${peerData.city}` : ''}
                <div>Images partagées: ${peerData.imagesShared}</div>
            </div>
        `;
        peerList.appendChild(div);
    });
}

// Mettre à jour la liste des pairs disponibles
async function updateAvailablePeers() {
    try {
        const response = await fetch(`${config.discoveryServer.url}/peers`);
        if (!response.ok) {
            throw new Error('Erreur lors de la récupération des pairs');
        }
        const data = await response.json();
        availablePeers = data.peers.filter(peerData => peerData.id !== peer.id);
        console.log('Liste des pairs mise à jour:', availablePeers);
        updatePeerList();
    } catch (error) {
        console.error('Erreur lors de la mise à jour des pairs:', error);
    }
}

// Initialiser la connexion P2P
function initializePeer() {
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

            // Mettre à jour la liste des pairs toutes les 5 secondes
            setInterval(updateAvailablePeers, 5000);
        });

        peer.on('error', (err) => {
            console.error('Erreur PeerJS:', err);
            // En cas d'erreur PeerJS, on essaie de se reconnecter
            updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
            setTimeout(connectToNextPeer, 1000);
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
    }
}

// Charger une image de test
async function loadTestImage() {
    const imagesContainer = document.getElementById('images-container');
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'image-container loading';
    imagesContainer.appendChild(loadingContainer);

    try {
        const selectedImage = images[currentImageIndex % images.length];
        console.log(`Tentative de chargement de l'image ${selectedImage}`);

        // Vérifier si le pair actuel a l'image
        const currentPeerId = Array.from(connections.keys())[0];
        if (currentPeerId && peerImages.has(currentPeerId)) {
            const peerImageList = peerImages.get(currentPeerId);
            if (peerImageList.includes(selectedImage)) {
                try {
                    const conn = connections.get(currentPeerId);
                    const imageData = await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            reject(new Error('Timeout'));
                        }, config.timeouts.peerImageRequest);

                        const messageHandler = (data) => {
                            if (data.type === 'image') {
                                clearTimeout(timeout);
                                conn.removeListener('data', messageHandler);
                                resolve(data.data);
                            }
                        };

                        conn.on('data', messageHandler);
                        conn.send({
                            type: 'request_image',
                            data: selectedImage
                        });
                    });

                    loadingContainer.remove();
                    displayImage(imageData, `Image reçue de ${currentPeerId}`, 'peer', currentPeerId);
                    currentImageIndex++;
                    return;
                } catch (error) {
                    console.warn(`Échec de la récupération depuis le pair ${currentPeerId}:`, error);
                    // Passer au pair suivant
                    connectToNextPeer();
                }
            }
        }

        // Si on arrive ici, charger depuis le serveur
        console.log(`Chargement de l'image ${selectedImage} depuis le serveur`);
        const response = await fetch(selectedImage);
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
            loadingContainer.remove();
            const imageData = reader.result;
            displayImage(imageData, `Image locale (${selectedImage})`, 'server');
            currentImageIndex++;
        };
        reader.readAsDataURL(blob);
    } catch (error) {
        loadingContainer.remove();
        const errorContainer = document.createElement('div');
        errorContainer.className = 'error-message';
        errorContainer.textContent = `Erreur: ${error.message}`;
        imagesContainer.appendChild(errorContainer);
    }
}

// Afficher une image
function displayImage(imageData, status, source = 'server', peerId = null) {
    const imageId = `${source}-${peerId || 'server'}-${imageData.substring(0, 50)}`;
    
    if (displayedImages.has(imageId)) {
        console.log('Image déjà affichée');
        return;
    }
    
    displayedImages.add(imageId);

    const container = document.createElement('div');
    container.className = 'image-container';
    container.dataset.imageId = imageId;

    const img = document.createElement('img');
    img.src = imageData;
    img.alt = 'Image partagée';

    const sourceDiv = document.createElement('div');
    sourceDiv.className = `image-source ${source}`;
    sourceDiv.textContent = source === 'server' ? 'Serveur' : `Pair: ${peerId}`;
    
    const statusDiv = document.createElement('div');
    statusDiv.className = 'status';
    statusDiv.textContent = status;

    container.appendChild(img);
    container.appendChild(sourceDiv);
    container.appendChild(statusDiv);
    
    document.getElementById('images-container').appendChild(container);
}

// Mettre à jour l'indicateur d'état de connexion
function updateConnectionStatus(status, message) {
    const statusContainer = document.querySelector('.connection-status');
    if (!statusContainer) {
        const container = document.createElement('div');
        container.className = 'connection-status';
        container.innerHTML = `
            <div class="status-indicator ${status}"></div>
            <div class="status-text">${message}</div>
        `;
        document.querySelector('.panel').insertBefore(container, document.getElementById('peerId').parentNode);
    } else {
        const indicator = statusContainer.querySelector('.status-indicator');
        const text = statusContainer.querySelector('.status-text');
        indicator.className = `status-indicator ${status}`;
        text.textContent = message;
    }
}

// Initialiser l'application
document.addEventListener('DOMContentLoaded', () => {
    initializePeer();
    document.getElementById('loadImageBtn').addEventListener('click', loadTestImage);

    // Variable pour suivre si la déconnexion est en cours
    let isDisconnecting = false;

    // Fonction de déconnexion propre
    async function cleanup() {
        if (isDisconnecting) return;
        isDisconnecting = true;

        console.log('Début du nettoyage');
        if (peer && peer.id) {
            try {
                // Fermer toutes les connexions P2P
                connections.forEach(conn => {
                    console.log('Fermeture de la connexion avec:', conn.peer);
                    conn.close();
                });
                connections.clear();
                peerImages.clear();

                // Se désinscrire du serveur de découverte
                console.log('Envoi de la notification de désinscription');
                await unregisterFromDiscoveryServer(peer.id);
                
                // Fermer la connexion PeerJS
                console.log('Destruction de la connexion PeerJS');
                peer.destroy();
            } catch (error) {
                console.error('Erreur lors de la fermeture:', error);
            }
        }
        console.log('Fin du nettoyage');
    }

    // Gestionnaire pour beforeunload
    window.addEventListener('beforeunload', async (event) => {
        console.log('Événement beforeunload déclenché');
        if (!isDisconnecting) {
            await cleanup();
        }
    });

    // Gestionnaire pour visibilitychange
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden' && !isDisconnecting) {
            console.log('Événement visibilitychange déclenché');
            await cleanup();
        }
    });

    // Gestionnaire pour unload
    window.addEventListener('unload', () => {
        console.log('Événement unload déclenché');
        if (!isDisconnecting) {
            cleanup();
        }
    });
}); 