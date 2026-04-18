const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { processCSV } = require('./csvReader');
const { initializeClient, disconnectClient, getConnectionStatus, subscribeClientReady } = require('./client');
const { setupResponseHandler } = require('./responseHandler');
const { startSchedulers, stopSchedulers, processBatch } = require('./scheduler');

let client = null;
let running = false;
let starting = false;
let activeConfig = process.env;
let unsubscribeClientReady = null;
const MAX_BATCH_SLOTS = 12;
const RESPONSE_HANDLER_ATTACHED = Symbol('responseHandlerAttached');

function normalizeTimeSlot(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{1,2}):([0-5]\d)$/);
    if (!match) return '';

    const hour = parseInt(match[1], 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return '';

    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function readIntInRange(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function getBatchCount(config = process.env) {
    return readIntInRange(config.BATCH_COUNT, 4, 1, MAX_BATCH_SLOTS);
}

function validateConfig(config) {
    const requiredVars = ['SECOND_MESSAGE'];
    const missing = requiredVars.filter((key) => !config[key] || !String(config[key]).trim());
    if (missing.length > 0) {
        throw new Error(`Variáveis obrigatórias ausentes no .env: ${missing.join(', ')}`);
    }
}

function ensureRuntimeBindings(targetClient, config) {
    if (!targetClient) return;

    if (!targetClient[RESPONSE_HANDLER_ATTACHED]) {
        setupResponseHandler(targetClient, config);
        targetClient[RESPONSE_HANDLER_ATTACHED] = true;
    }

    stopSchedulers();
    startSchedulers(targetClient, config);
}

function ensureClientReadySubscription() {
    if (unsubscribeClientReady) return;

    unsubscribeClientReady = subscribeClientReady((nextClient) => {
        client = nextClient;
        if (!running) return;
        ensureRuntimeBindings(nextClient, activeConfig);
        logger.info('Cliente reconectado. Listeners e agendamentos reaplicados.');
    });
}

async function startBot(config = process.env) {
    if (running) return { running: true, message: 'Bot já está em execução.' };
    if (starting) return { running: false, message: 'Inicialização já em andamento.' };

    try {
        starting = true;
        activeConfig = config;
        ensureClientReadySubscription();
        validateConfig(config);
        logger.info('Iniciando Bot de WhatsApp...');
        await processCSV();
        client = await initializeClient();
        ensureRuntimeBindings(client, config);
        running = true;
        logger.info('Sistema rodando em background. Aguardando horários agendados...');
        return { running: true, message: 'Bot iniciado com sucesso.' };
    } finally {
        starting = false;
    }
}

async function stopBot() {
    stopSchedulers();
    await disconnectClient();
    client = null;
    running = false;
    return { running: false, message: 'Bot interrompido com sucesso.' };
}

async function resetWhatsAppSession() {
    stopSchedulers();
    await disconnectClient({ removeSession: true });
    client = null;
    running = false;
    starting = false;
    return { ok: true, message: 'Número removido. Escaneie um novo QR Code para conectar outra conta.' };
}

async function triggerBatchNow(config = process.env) {
    if (!running) throw new Error('Bot não está em execução.');
    const activeClient = await initializeClient();
    client = activeClient;
    await processBatch(activeClient, config);
    return { ok: true, message: 'Lote manual executado.' };
}

function applyScheduleChanges(config = process.env) {
    activeConfig = config;

    if (!running || !client) {
        return { ok: true, message: 'Horários salvos. Serão aplicados quando o bot iniciar.' };
    }

    stopSchedulers();
    startSchedulers(client, config);
    return { ok: true, message: 'Horários atualizados e aplicados no bot em execução.' };
}

function getSummary(config = process.env) {
    const leads = statusTracker.getAllLeads();
    const stats = { pendente: 0, enviado: 0, respondido: 0, erro: 0 };
    leads.forEach((lead) => {
        if (stats[lead.status] !== undefined) stats[lead.status] += 1;
    });

    const batchCount = getBatchCount(config);
    const scheduleSlots = Array.from({ length: batchCount }, (_slot, index) =>
        normalizeTimeSlot(config[`BATCH_HOUR_${index + 1}`])
    );
    const responseReplyMinMs = readIntInRange(config.RESPONSE_REPLY_MIN_MS, 8000, 0, 3600000);

    return {
        bot: { running, starting },
        whatsapp: getConnectionStatus(),
        config: {
            secondMessage: String(config.SECOND_MESSAGE || ''),
            batchSize: readIntInRange(config.BATCH_SIZE, 20, 1, 1000),
            batchCount,
            dailyLimit: readIntInRange(config.DAILY_LIMIT, 80, 1, 100000),
            responseReplyDelaySeconds: Math.floor(responseReplyMinMs / 1000)
        },
        schedule: {
            batchCount,
            slots: scheduleSlots
        },
        totals: {
            leads: leads.length,
            pendente: stats.pendente,
            enviado: stats.enviado,
            respondido: stats.respondido,
            erro: stats.erro,
            sentToday: statusTracker.getSentCountToday(),
            warmupDay: statusTracker.getWarmupDay(),
            warmupMode: config.WARMUP_MODE === 'true'
        },
        leads
    };
}

module.exports = {
    startBot,
    stopBot,
    resetWhatsAppSession,
    triggerBatchNow,
    applyScheduleChanges,
    getSummary
};
