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

        // Vérifier si le peer est toujours valide
        if (!peer || peer.disconnected) {
            console.log('Réinitialisation du peer...');
            await initializePeer();
            return;
        }

        const conn = peer.connect(nextPeer.id, { reliable: true });
        
        conn.on('open', () => {
            console.log(`Connexion établie avec ${nextPeer.id}`);
            connections.set(nextPeer.id, conn);
            updateConnectionStatus('connected', `Connecté à ${nextPeer.id}`);
            updatePeerList();
        });

        // Supprimer la gestion des messages ici car elle est déjà gérée dans l'événement 'connection'
        conn.on('close', () => {
            console.log(`Connexion fermée avec ${nextPeer.id}`);
            connections.delete(nextPeer.id);
            peerImages.delete(nextPeer.id);
            updatePeerList();
            
            if (connections.size === 0) {
                updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                setTimeout(connectToNextPeer, 1000);
            }
        });

        conn.on('error', (err) => {
            console.error(`Erreur de connexion avec ${nextPeer.id}:`, err);
            connections.delete(nextPeer.id);
            peerImages.delete(nextPeer.id);
            updatePeerList();
            
            if (connections.size === 0) {
                updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
                setTimeout(connectToNextPeer, 1000);
            }
        });
    } catch (error) {
        console.error(`Erreur lors de la connexion à ${nextPeer.id}:`, error);
        if (connections.size === 0) {
            updateConnectionStatus('network', 'Connecté au réseau, en attente de pair...');
            setTimeout(connectToNextPeer, 1000);
        }
    }
}

// Gérer une demande d'image
async function handleImageRequest(conn, imagePath) {
    console.log(`Traitement de la demande d'image: ${imagePath}`);
    try {
        console.log(`Tentative de chargement de l'image depuis: ${imagePath}`);
        const response = await fetch(imagePath);
        if (!response.ok) {
            console.error(`Image non trouvée: ${imagePath}`);
            conn.send({
                type: 'image_error',
                data: `Image non disponible: ${imagePath}`
            });
            return;
        }
        
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onloadend = () => {
            console.log(`Envoi de l'image: ${imagePath}`);
            conn.send({
                type: 'image',
                data: reader.result
            });
        };
        reader.readAsDataURL(blob);
    } catch (error) {
        console.error('Erreur lors de l\'envoi de l\'image:', error);
        conn.send({
            type: 'image_error',
            data: `Erreur lors du chargement: ${error.message}`
        });
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

                // Mettre à jour la liste des pairs toutes les 5 secondes
                setInterval(updateAvailablePeers, 5000);
                
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
                    if (data instanceof ArrayBuffer) {
                        console.log('Traitement ArrayBuffer...');
                        const decoder = new TextDecoder();
                        const text = decoder.decode(data);
                        console.log('Texte décodé:', text);
                        try {
                            message = JSON.parse(text);
                            console.log('Message JSON parsé:', message);
                        } catch (e) {
                            console.error('Erreur lors du décodage du message:', e);
                            console.error('Texte qui a causé l\'erreur:', text);
                            return;
                        }
                    } else if (typeof data === 'string') {
                        console.log('Traitement String...');
                        try {
                            message = JSON.parse(data);
                            console.log('Message string parsé:', message);
                        } catch (e) {
                            console.error('Erreur lors du parsing du message string:', e);
                            console.error('String qui a causé l\'erreur:', data);
                            return;
                        }
                    } else {
                        console.log('Traitement message direct...');
                        message = data;
                        console.log('Message direct:', message);
                    }

                    console.log('Message final à traiter:', message);
                    console.log('Type du message:', message.type);
                    console.log('Données du message:', message.data);

                    switch(message.type) {
                        case 'image':
                            console.log('Image reçue');
                            displayImage(message.data, `Image reçue de ${conn.peer}`, 'peer', conn.peer);
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
                            const hasImage = images.includes(message.data);
                            console.log(`Réponse: ${hasImage ? 'Image disponible' : 'Image non disponible'}`);
                            const response = {
                                type: 'image_availability',
                                data: {
                                    path: message.data,
                                    available: hasImage
                                }
                            };
                            console.log('Envoi de la réponse de disponibilité:', response);
                            const responseStr = JSON.stringify(response);
                            console.log('Réponse stringifiée:', responseStr);
                            conn.send(responseStr);
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
        console.log(`Tentative de chargement de l'image ${selectedImage} (index: ${currentImageIndex})`);

        // Si aucun pair n'est connecté, charger directement depuis le serveur
        if (connections.size === 0) {
            console.log('Aucun pair connecté, chargement depuis le serveur');
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
            return;
        }

        const currentPeerId = Array.from(connections.keys())[0];
        const conn = connections.get(currentPeerId);
        
        try {
            // D'abord vérifier si le pair a l'image
            console.log(`Vérification de la disponibilité de l'image ${selectedImage} auprès du pair ${currentPeerId}`);
            
            const hasImage = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout lors de la vérification'));
                }, 2000);

                const messageHandler = (data) => {
                    console.log('Message brut reçu pendant la vérification:', data);
                    let message;
                    if (data instanceof ArrayBuffer) {
                        const decoder = new TextDecoder();
                        const text = decoder.decode(data);
                        console.log('Message ArrayBuffer décodé en texte:', text);
                        try {
                            message = JSON.parse(text);
                            console.log('Message JSON parsé:', message);
                        } catch (e) {
                            console.error('Erreur lors du décodage du message:', e);
                            return;
                        }
                    } else if (typeof data === 'string') {
                        try {
                            message = JSON.parse(data);
                            console.log('Message string parsé:', message);
                        } catch (e) {
                            console.error('Erreur lors du parsing du message string:', e);
                            return;
                        }
                    } else {
                        message = data;
                        console.log('Message direct:', message);
                    }

                    if (message.type === 'image_availability') {
                        console.log('Réponse de disponibilité reçue:', message.data);
                        clearTimeout(timeout);
                        conn.removeListener('data', messageHandler);
                        resolve(message.data.available);
                    }
                };

                conn.on('data', messageHandler);
                const checkMessage = {
                    type: 'check_image',
                    data: selectedImage
                };
                console.log('Envoi de la demande de vérification:', checkMessage);
                const checkMessageStr = JSON.stringify(checkMessage);
                console.log('Message de vérification stringifié:', checkMessageStr);
                conn.send(checkMessageStr);
            });

            if (!hasImage) {
                console.log(`Le pair ${currentPeerId} n'a pas l'image ${selectedImage}`);
                throw new Error('Image non disponible chez le pair');
            }

            console.log(`Le pair ${currentPeerId} a l'image ${selectedImage}, chargement en cours...`);
            
            const imageData = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout lors du chargement'));
                }, 5000);

                const messageHandler = (data) => {
                    console.log('Message reçu pendant le chargement:', data);
                    let message;
                    if (data instanceof ArrayBuffer) {
                        const decoder = new TextDecoder();
                        const text = decoder.decode(data);
                        try {
                            message = JSON.parse(text);
                        } catch (e) {
                            console.error('Erreur lors du décodage du message:', e);
                            return;
                        }
                    } else {
                        message = data;
                    }

                    if (message.type === 'image') {
                        clearTimeout(timeout);
                        conn.removeListener('data', messageHandler);
                        resolve(message.data);
                    } else if (message.type === 'image_error') {
                        clearTimeout(timeout);
                        conn.removeListener('data', messageHandler);
                        reject(new Error(message.data));
                    }
                };

                conn.on('data', messageHandler);
                const requestMessage = {
                    type: 'request_image',
                    data: selectedImage
                };
                console.log('Envoi de la demande d\'image:', requestMessage);
                conn.send(JSON.stringify(requestMessage));
            });

            loadingContainer.remove();
            displayImage(imageData, `Image reçue de ${currentPeerId} (${selectedImage})`, 'peer', currentPeerId);
            currentImageIndex++;
            return;
        } catch (error) {
            console.warn(`Échec de la récupération depuis le pair ${currentPeerId}:`, error);
        }

        // Si on arrive ici, c'est qu'on n'a pas pu charger depuis le pair
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
    // Utiliser le chemin de l'image comme partie de l'ID unique
    const imagePath = status.includes('(') ? status.match(/\((.*?)\)/)[1] : imageData;
    const imageId = `${source}-${peerId || 'server'}-${imagePath}`;
    
    console.log('Vérification de l\'image:', {
        imageId,
        displayedImages: Array.from(displayedImages),
        isDisplayed: displayedImages.has(imageId)
    });
    
    if (displayedImages.has(imageId)) {
        console.log(`Image ${imagePath} déjà affichée, on passe à la suivante`);
        currentImageIndex++;
        return;
    }
    
    displayedImages.add(imageId);
    console.log(`Ajout de l'image ${imagePath} à la liste des images affichées`);

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