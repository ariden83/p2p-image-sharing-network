/**
 * Test du fonctionnement P2P
 * Ce script simule plusieurs pairs et vérifie le partage d'images
 */

const { PeerServer } = require('peer');
const { Peer } = require('peerjs');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const TEST_PORT = 9000;
const TEST_IMAGE = path.join(__dirname, '../client/assets/images/test-image.jpg');
const NUM_PEERS = 3;

// Créer une image de test si elle n'existe pas
async function createTestImage() {
    try {
        await fs.access(TEST_IMAGE);
    } catch {
        // Créer une image de test simple (1x1 pixel noir)
        const buffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
        await fs.writeFile(TEST_IMAGE, buffer);
    }
}

// Classe pour simuler un pair
class TestPeer {
    constructor(id) {
        this.id = id;
        this.peer = new Peer(id, {
            host: 'localhost',
            port: TEST_PORT,
            path: '/peerjs'
        });
        this.connections = new Map();
        this.receivedImages = new Set();
    }

    async connect(otherPeer) {
        return new Promise((resolve, reject) => {
            const conn = this.peer.connect(otherPeer.id);
            conn.on('open', () => {
                this.connections.set(otherPeer.id, conn);
                resolve(conn);
            });
            conn.on('error', reject);
        });
    }

    async sendImage(imageData, toPeer) {
        const conn = this.connections.get(toPeer.id);
        if (!conn) throw new Error(`Pas de connexion avec le pair ${toPeer.id}`);
        conn.send({
            type: 'image',
            data: imageData
        });
    }

    setupListeners() {
        this.peer.on('connection', (conn) => {
            conn.on('data', (data) => {
                if (data.type === 'image') {
                    this.receivedImages.add(data.data);
                }
            });
        });
    }
}

// Test principal
async function runTest() {
    console.log('Démarrage des tests P2P...');

    // Créer l'image de test
    await createTestImage();
    const imageData = await fs.readFile(TEST_IMAGE);

    // Démarrer le serveur PeerJS
    const server = PeerServer({ port: TEST_PORT, path: '/peerjs' });
    console.log(`Serveur PeerJS démarré sur le port ${TEST_PORT}`);

    // Créer les pairs de test
    const peers = Array.from({ length: NUM_PEERS }, (_, i) => new TestPeer(`peer${i}`));
    peers.forEach(peer => peer.setupListeners());

    // Connecter les pairs entre eux
    console.log('Connexion des pairs...');
    for (let i = 0; i < peers.length; i++) {
        for (let j = i + 1; j < peers.length; j++) {
            await peers[i].connect(peers[j]);
            await peers[j].connect(peers[i]);
        }
    }

    // Tester le partage d'images
    console.log('Test du partage d\'images...');
    const sender = peers[0];
    const receivers = peers.slice(1);

    // Envoyer l'image à tous les autres pairs
    for (const receiver of receivers) {
        await sender.sendImage(imageData, receiver);
    }

    // Vérifier que tous les pairs ont reçu l'image
    await new Promise(resolve => setTimeout(resolve, 1000)); // Attendre la réception
    const allReceived = receivers.every(peer => peer.receivedImages.size > 0);
    console.log(`Test ${allReceived ? 'réussi' : 'échoué'}: ${receivers.length} pairs ont reçu l'image`);

    // Nettoyage
    server.close();
    peers.forEach(peer => peer.peer.destroy());
    console.log('Test terminé');
}

// Exécuter le test
runTest().catch(console.error); 