const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const logger = require('./logger');

const AUTH_DIR = path.join(process.cwd(), '.wwebjs_auth');
const CACHE_DIR = path.join(process.cwd(), '.wwebjs_cache');

let client = null;
let connectPromise = null;
let resolveConnect = null;
let rejectConnect = null;
let recoverPromise = null;
const readySubscribers = new Set();
const CONNECTED_WA_STATE = 'CONNECTED';

const connection = {
    status: 'disconnected',
    qrDataUrl: '',
    phoneNumber: '',
    lastError: '',
    lastDisconnectReason: '',
    updatedAt: null
};

function updateConnectionState(patch) {
    Object.assign(connection, patch, { updatedAt: new Date().toISOString() });
}

function notifyClientReady(instance) {
    readySubscribers.forEach((handler) => {
        try {
            handler(instance);
        } catch (error) {
            logger.warn(`Falha ao notificar listener de cliente pronto: ${error.message}`);
        }
    });
}

function subscribeClientReady(handler) {
    if (typeof handler !== 'function') return () => {};
    readySubscribers.add(handler);
    return () => readySubscribers.delete(handler);
}

function settleConnectSuccess(instance) {
    if (resolveConnect) {
        resolveConnect(instance);
    }
    connectPromise = null;
    resolveConnect = null;
    rejectConnect = null;
}

function settleConnectError(error) {
    if (rejectConnect) {
        rejectConnect(error);
    }
    connectPromise = null;
    resolveConnect = null;
    rejectConnect = null;
}

function extractPhone(instance) {
    const serialized = instance && instance.info && instance.info.wid && instance.info.wid._serialized;
    if (!serialized) return '';
    return String(serialized).split('@')[0];
}

async function destroyClientInstance(instance, context = '') {
    if (!instance) return;
    try {
        await instance.destroy();
    } catch (error) {
        const prefix = context ? `${context}: ` : '';
        logger.warn(`${prefix}não foi possível destruir cliente ativo: ${error.message}`);
    }
}

async function getInstanceState(instance) {
    if (!instance || typeof instance.getState !== 'function') return '';
    try {
        const state = await instance.getState();
        return String(state || '').toUpperCase();
    } catch (_error) {
        return '';
    }
}

async function isInstanceConnected(instance) {
    const state = await getInstanceState(instance);
    return state === CONNECTED_WA_STATE;
}

function createClient() {
    const instance = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    instance.on('qr', async (qr) => {
        if (client !== instance) return;

        logger.info('QR Code recebido, escaneie com seu WhatsApp:');
        qrcodeTerminal.generate(qr, { small: true });

        updateConnectionState({
            status: 'qr_ready',
            qrDataUrl: '',
            phoneNumber: '',
            lastError: '',
            lastDisconnectReason: ''
        });

        try {
            const qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
            if (client === instance) {
                updateConnectionState({
                    status: 'qr_ready',
                    qrDataUrl
                });
            }
        } catch (error) {
            logger.error(`Falha ao gerar imagem do QR code: ${error.message}`);
        }
    });

    instance.on('ready', () => {
        if (client !== instance) return;

        const phoneNumber = extractPhone(instance);
        logger.info('WhatsApp Client conectado e pronto!');
        updateConnectionState({
            status: 'connected',
            qrDataUrl: '',
            phoneNumber,
            lastError: '',
            lastDisconnectReason: ''
        });
        notifyClientReady(instance);
        settleConnectSuccess(instance);
    });

    instance.on('auth_failure', (msg) => {
        if (client !== instance) return;

        const message = `Falha na autenticação: ${msg}`;
        logger.error(message);
        updateConnectionState({
            status: 'error',
            lastError: message,
            qrDataUrl: '',
            phoneNumber: ''
        });
        client = null;
        settleConnectError(new Error(message));
    });

    instance.on('disconnected', (reason) => {
        if (client === instance) {
            client = null;
        }

        const reasonText = String(reason || 'desconhecido');
        logger.error(`Client desconectado. Razão: ${reasonText}`);
        updateConnectionState({
            status: 'disconnected',
            qrDataUrl: '',
            phoneNumber: '',
            lastDisconnectReason: reasonText
        });

        if (connectPromise) {
            settleConnectError(new Error(`Client desconectado antes de iniciar: ${reasonText}`));
        }
    });

    return instance;
}

function initializeClient() {
    return initializeClientInternal();
}

async function initializeClientInternal() {
    if (client && connection.status === 'connected') {
        const healthy = await isInstanceConnected(client);
        if (healthy) return client;

        logger.warn('Cliente estava conectado, mas ficou inconsistente. Reconectando sessão...');
        const staleClient = client;
        client = null;
        updateConnectionState({
            status: 'disconnected',
            qrDataUrl: '',
            phoneNumber: '',
            lastError: '',
            lastDisconnectReason: 'Sessão inconsistente detectada.'
        });
        await destroyClientInstance(staleClient, 'Reconexão');
    }

    if (connectPromise) {
        return connectPromise;
    }

    if (client && connection.status !== 'connected') {
        const staleClient = client;
        client = null;
        await destroyClientInstance(staleClient, 'Limpeza de cliente stale');
    }

    client = createClient();
    const currentClient = client;
    updateConnectionState({
        status: 'connecting',
        qrDataUrl: '',
        phoneNumber: '',
        lastError: '',
        lastDisconnectReason: ''
    });

    connectPromise = new Promise((resolve, reject) => {
        resolveConnect = resolve;
        rejectConnect = reject;
    });

    currentClient.initialize().catch((error) => {
        if (client !== currentClient) return;
        logger.error(`Erro ao inicializar WhatsApp Client: ${error.message}`);
        updateConnectionState({
            status: 'error',
            lastError: `Erro ao inicializar WhatsApp Client: ${error.message}`,
            qrDataUrl: '',
            phoneNumber: ''
        });
        client = null;
        settleConnectError(error);
    });

    return connectPromise;
}

function startClientConnection() {
    if (connection.status === 'connected' || connection.status === 'connecting' || connection.status === 'qr_ready') {
        return getConnectionStatus();
    }

    initializeClient().catch((error) => {
        logger.error(`Falha ao iniciar conexão via painel: ${error.message}`);
    });

    return getConnectionStatus();
}

function getConnectionStatus() {
    return {
        status: connection.status,
        qrDataUrl: connection.qrDataUrl,
        phoneNumber: connection.phoneNumber,
        lastError: connection.lastError,
        lastDisconnectReason: connection.lastDisconnectReason,
        updatedAt: connection.updatedAt
    };
}

function getActiveClient() {
    return client;
}

async function ensureConnectedClient(preferredClient = null) {
    if (preferredClient) {
        const preferredHealthy = await isInstanceConnected(preferredClient);
        if (preferredHealthy) return preferredClient;
    }

    if (client) {
        const activeHealthy = await isInstanceConnected(client);
        if (activeHealthy) return client;
    }

    return initializeClientInternal();
}

async function recoverClient(reason = '') {
    if (recoverPromise) return recoverPromise;

    recoverPromise = (async () => {
        const reasonText = String(reason || '').trim() || 'Recuperação automática da sessão.';
        logger.warn(`Reconectando WhatsApp após falha transitória. Motivo: ${reasonText}`);

        if (connectPromise) {
            settleConnectError(new Error('Conexão reiniciada para recuperar a sessão.'));
        }

        const staleClient = client;
        client = null;
        updateConnectionState({
            status: 'disconnected',
            qrDataUrl: '',
            phoneNumber: '',
            lastError: '',
            lastDisconnectReason: reasonText
        });

        await destroyClientInstance(staleClient, 'Recuperação');
        return initializeClientInternal();
    })().finally(() => {
        recoverPromise = null;
    });

    return recoverPromise;
}

async function disconnectClient(options = {}) {
    const { removeSession = false } = options;
    const activeClient = client;

    if (rejectConnect) {
        rejectConnect(new Error('Conexão cancelada pelo usuário.'));
    }

    client = null;
    connectPromise = null;
    resolveConnect = null;
    rejectConnect = null;
    recoverPromise = null;

    if (activeClient) {
        if (removeSession) {
            try {
                await activeClient.logout();
            } catch (error) {
                logger.warn(`Não foi possível executar logout remoto: ${error.message}`);
            }
        }

        try {
            await activeClient.destroy();
        } catch (error) {
            logger.warn(`Não foi possível destruir cliente ativo: ${error.message}`);
        }
    }

    if (removeSession) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    }

    updateConnectionState({
        status: 'disconnected',
        qrDataUrl: '',
        phoneNumber: '',
        lastError: '',
        lastDisconnectReason: removeSession ? 'Sessão removida pelo usuário.' : 'Conexão encerrada pelo usuário.'
    });
}

module.exports = {
    initializeClient,
    startClientConnection,
    getConnectionStatus,
    disconnectClient,
    ensureConnectedClient,
    recoverClient,
    subscribeClientReady,
    getActiveClient
};
