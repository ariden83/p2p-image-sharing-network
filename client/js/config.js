// Configuration de l'application
const config = {
    // Configuration du serveur de découverte
    discoveryServer: {
        url: 'http://localhost:3001',
        heartbeatInterval: 15000, // Intervalle entre les heartbeats en ms
    },
    
    // Configuration des timeouts
    timeouts: {
        peerImageRequest: 5000, // Timeout pour la demande d'image à un pair en ms
        peerConnection: 10000,  // Timeout pour la connexion à un pair en ms
    },
    
    // Configuration des chemins d'images
    images: {
        paths: [
            '/assets/images/image.png',
            '/assets/images/image1.png',
            '/assets/images/image2.png',
            '/assets/images/image3.png',
            '/assets/images/image4.png',
            '/assets/images/image5.png'
        ]
    }
};

// Exporter la configuration
export default config; 