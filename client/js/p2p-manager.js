/**
 * @architecture
 * role: frontend/p2p
 * description: Gestionnaire des connexions P2P via WebRTC
 * dependencies:
 *   - peerjs (cdn)
 * responsibilities:
 *   - Gestion des connexions P2P
 *   - Cache des images
 *   - Requêtes et réponses P2P
 * 
 * @security
 * permissions: public
 * sensitive_data: 
 *   - images en base64
 *   - connexions P2P
 * 
 * @performance
 * critical_path: true
 * caching_strategy: 
 *   - in-memory pour les images
 *   - connexions P2P persistantes
 * 
 * @testing
 * test_files: 
 *   - tests/p2p-manager.test.js
 * coverage_required: 80%
 * 
 * @maintenance
 * last_review: 2024-03-20
 * complexity: medium
 * technical_debt: low
 * 
 * @documentation
 * api_docs: docs/p2p-manager.md
 * examples: 
 *   - docs/examples/p2p-connection.md
 *   - docs/examples/image-sharing.md
 * 
 * @semantics
 * concepts: 
 *   - "P2P Communication"
 *   - "WebRTC"
 *   - "Image Sharing"
 *   - "Real-time Data Transfer"
 * patterns:
 *   - "Observer Pattern"
 *   - "Connection Pool"
 *   - "Cache Strategy"
 * domain: "Real-time P2P Image Sharing"
 * 
 * @relationships
 * communicates_with:
 *   - "js/app.js"
 *   - "server/server.js"
 * extends: null
 * implements:
 *   - "IP2PManager"
 * 
 * @history
 * changes:
 *   - date: "2024-03-20"
 *     author: "AI Assistant"
 *     description: "Initial implementation of P2P manager"
 *   - date: "2024-03-21"
 *     author: "Developer"
 *     description: "Added image caching and connection pooling"
 * 
 * @llm
 * context: "This is a critical component for P2P image sharing. It manages WebRTC connections and image caching."
 * examples: |
 *   // Example of creating a new P2P connection
 *   const manager = new P2PManager();
 *   await manager.initialize();
 *   
 *   // Example of sharing an image
 *   manager.cacheImage('image.jpg', imageData);
 *   await manager.requestImageFromPeers('image.jpg');
 * constraints:
 *   - "Must handle connection failures gracefully"
 *   - "Should implement proper cleanup of resources"
 *   - "Must maintain backward compatibility"
 * suggestions:
 *   - "Consider implementing connection retry logic"
 *   - "Add compression for large images"
 *   - "Implement connection quality monitoring"
 */

class P2PManager {
    constructor() {
        this.peer = null;
        this.connections = new Map();
        this.imageCache = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;

        this.peer = new Peer(null, {
            debug: 2,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });

        return new Promise((resolve, reject) => {
            this.peer.on('open', (id) => {
                console.log('Mon ID P2P:', id);
                this.isInitialized = true;
                resolve(id);
            });

            this.peer.on('error', (err) => {
                console.error('Erreur P2P:', err);
                reject(err);
            });

            this.peer.on('connection', (conn) => {
                this.handleNewConnection(conn);
            });
        });
    }

    handleNewConnection(conn) {
        console.log('Nouvelle connexion reçue:', conn.peer);
        
        conn.on('data', (data) => {
            if (data.type === 'request-image') {
                const imageUrl = data.url;
                if (this.imageCache.has(imageUrl)) {
                    conn.send({
                        type: 'image-data',
                        url: imageUrl,
                        data: this.imageCache.get(imageUrl)
                    });
                }
            }
        });

        this.connections.set(conn.peer, conn);
    }

    async requestImageFromPeers(imageUrl) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        for (const [peerId, conn] of this.connections) {
            conn.send({
                type: 'request-image',
                url: imageUrl
            });
        }
    }

    cacheImage(imageUrl, imageData) {
        this.imageCache.set(imageUrl, imageData);
    }

    async connectToPeer(peerId) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const conn = this.peer.connect(peerId);
        this.handleNewConnection(conn);
        return conn;
    }
}

// Exporter l'instance unique du gestionnaire P2P
window.p2pManager = new P2PManager(); 