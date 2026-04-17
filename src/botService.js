const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { processCSV } = require('./csvReader');
const { initializeClient } = require('./client');
const { setupResponseHandler } = require('./responseHandler');
const { startSchedulers, stopSchedulers, processBatch } = require('./scheduler');

let client = null;
let running = false;
let starting = false;

function validateConfig(config) {
    const requiredVars = ['SECOND_MESSAGE'];
    const missing = requiredVars.filter((key) => !config[key] || !String(config[key]).trim());
    if (missing.length > 0) {
        throw new Error(`Variáveis obrigatórias ausentes no .env: ${missing.join(', ')}`);
    }
}

async function startBot(config = process.env) {
    if (running) return { running: true, message: 'Bot já está em execução.' };
    if (starting) return { running: false, message: 'Inicialização já em andamento.' };

    try {
        starting = true;
        validateConfig(config);
        logger.info('Iniciando Bot de WhatsApp...');
        await processCSV();
        client = await initializeClient();
        setupResponseHandler(client, config);
        startSchedulers(client, config);
        running = true;
        logger.info('Sistema rodando em background. Aguardando horários agendados...');
        return { running: true, message: 'Bot iniciado com sucesso.' };
    } finally {
        starting = false;
    }
}

async function stopBot() {
    stopSchedulers();
    if (client) {
        await client.destroy();
        client = null;
    }
    running = false;
    return { running: false, message: 'Bot interrompido com sucesso.' };
}

async function triggerBatchNow(config = process.env) {
    if (!running || !client) throw new Error('Bot não está em execução.');
    await processBatch(client, config);
    return { ok: true, message: 'Lote manual executado.' };
}

function applyScheduleChanges(config = process.env) {
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

    return {
        bot: { running, starting },
        schedule: {
            slot1: String(config.BATCH_HOUR_1 || ''),
            slot2: String(config.BATCH_HOUR_2 || ''),
            slot3: String(config.BATCH_HOUR_3 || ''),
            slot4: String(config.BATCH_HOUR_4 || '')
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
    triggerBatchNow,
    applyScheduleChanges,
    getSummary
};
