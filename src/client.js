const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('./logger');

function initializeClient() {
    return new Promise((resolve, reject) => {
        let isResolved = false;
        const client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        client.on('qr', (qr) => {
            logger.info('QR Code recebido, escaneie com seu WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        client.on('ready', () => {
            logger.info('WhatsApp Client conectado e pronto!');
            isResolved = true;
            resolve(client);
        });

        client.on('auth_failure', msg => {
            logger.error(`Falha na autenticação: ${msg}`);
            if (!isResolved) reject(new Error(`Falha na autenticação: ${msg}`));
        });

        client.on('disconnected', (reason) => {
            logger.error(`Client desconectado. Razão: ${reason}`);
            if (!isResolved) reject(new Error(`Client desconectado antes de iniciar: ${reason}`));
        });

        client.initialize().catch((error) => {
            logger.error(`Erro ao inicializar WhatsApp Client: ${error.message}`);
            if (!isResolved) reject(error);
        });
    });
}

module.exports = { initializeClient };