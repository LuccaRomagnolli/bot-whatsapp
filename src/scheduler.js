const cron = require('node-cron');
const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { sendFirstMessage } = require('./messenger');

const delay = ms => new Promise(res => setTimeout(res, ms));

// Algoritmo de Fisher-Yates para embaralhar o array
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function calculateBatchSize(config) {
    const isWarmup = config.WARMUP_MODE === 'true';
    let targetSize = parseInt(config.BATCH_SIZE) || 20;

    if (isWarmup) {
        const day = statusTracker.getWarmupDay();
        if (day <= 2) targetSize = 5;
        else if (day <= 4) targetSize = 10;
        else if (day <= 7) targetSize = 15;
    }
    return targetSize;
}

async function processBatch(client, config) {
    try {
        const hour = new Date().getHours();
        const startHour = parseInt(config.QUIET_START_HOUR) || 8;
        const endHour = parseInt(config.QUIET_END_HOUR) || 21;

        if (hour < startHour || hour >= endHour) {
            logger.warn(`Lote cancelado: Fora do horário comercial (${startHour}h - ${endHour}h). Hora atual: ${hour}h`);
            return;
        }

        const sentToday = statusTracker.getSentCountToday();
        const dailyLimit = parseInt(config.DAILY_LIMIT) || 80;

        if (sentToday >= dailyLimit) {
            logger.warn(`Lote cancelado: Limite diário de ${dailyLimit} mensagens atingido.`);
            return;
        }

        let pendingLeads = statusTracker.getPendingLeads();
        if (pendingLeads.length === 0) {
            logger.info('Lote cancelado: Não há mais leads pendentes na base.');
            return;
        }

        const targetSize = calculateBatchSize(config);
        const availableSlots = dailyLimit - sentToday;
        const actualBatchSize = Math.min(targetSize, availableSlots, pendingLeads.length);

        // Embaralhar leads e selecionar a quantidade exata
        pendingLeads = shuffleArray(pendingLeads);
        const batchLeads = pendingLeads.slice(0, actualBatchSize);

        logger.info(`Iniciando envio de lote: ${actualBatchSize} leads selecionados.`);

        for (const lead of batchLeads) {
            await sendFirstMessage(client, lead);
            
            // Delay aleatório entre as mensagens do lote
            const minDelay = parseInt(config.MIN_DELAY_MS) || 45000;
            const maxDelay = parseInt(config.MAX_DELAY_MS) || 180000;
            const batchDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
            
            logger.info(`Aguardando ${(batchDelay/1000).toFixed(1)}s até a próxima mensagem...`);
            await delay(batchDelay);
        }

        logger.info('Lote finalizado com sucesso.');

    } catch (error) {
        logger.error(`Erro crítico no processamento do lote: ${error.message}`);
    }
}

function startSchedulers(client, config) {
    const hours = [
        config.BATCH_HOUR_1 || '9',
        config.BATCH_HOUR_2 || '11',
        config.BATCH_HOUR_3 || '16',
        config.BATCH_HOUR_4 || '17'
    ];

    hours.forEach((hour, index) => {
        const cronTime = `0 ${hour} * * *`;
        cron.schedule(cronTime, () => {
            logger.info(`Triggering cron Lote ${index + 1} (${hour}:00)`);
            processBatch(client, config);
        }, { timezone: config.TZ || 'America/Sao_Paulo' });
        logger.info(`Cron agendado: Lote ${index + 1} às ${hour}:00`);
    });
}

module.exports = { startSchedulers };