const cron = require('node-cron');
const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { sendFirstMessage } = require('./messenger');

const delay = ms => new Promise(res => setTimeout(res, ms));
const scheduledTasks = [];

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
    const getBatchEnv = (key, fallback) => {
        const value = config[key];
        if (value === undefined) return fallback;
        return String(value).trim();
    };

    const slots = [
        getBatchEnv('BATCH_HOUR_1', '9'),
        getBatchEnv('BATCH_HOUR_2', '11'),
        getBatchEnv('BATCH_HOUR_3', '16'),
        getBatchEnv('BATCH_HOUR_4', '17')
    ];

    slots.forEach((slot, index) => {
        if (!slot || !String(slot).trim()) return;

        const normalizedSlot = String(slot).trim();
        let hour = null;
        let minute = 0;

        if (normalizedSlot.includes(':')) {
            const parts = normalizedSlot.split(':');
            if (parts.length !== 2) {
                logger.warn(`Horário inválido em BATCH_HOUR_${index + 1}: "${normalizedSlot}". Use HH ou HH:mm.`);
                return;
            }
            hour = parseInt(parts[0], 10);
            minute = parseInt(parts[1], 10);
        } else {
            hour = parseInt(normalizedSlot, 10);
        }

        const isValidHour = Number.isInteger(hour) && hour >= 0 && hour <= 23;
        const isValidMinute = Number.isInteger(minute) && minute >= 0 && minute <= 59;

        if (!isValidHour || !isValidMinute) {
            logger.warn(`Horário inválido em BATCH_HOUR_${index + 1}: "${normalizedSlot}".`);
            return;
        }

        const cronTime = `${minute} ${hour} * * *`;
        const slotLabel = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const task = cron.schedule(cronTime, () => {
            logger.info(`Triggering cron Lote ${index + 1} (${slotLabel})`);
            processBatch(client, config);
        }, { timezone: config.TZ || 'America/Sao_Paulo' });
        scheduledTasks.push(task);
        logger.info(`Cron agendado: Lote ${index + 1} às ${slotLabel}`);
    });
}

function stopSchedulers() {
    while (scheduledTasks.length > 0) {
        const task = scheduledTasks.pop();
        task.stop();
        task.destroy();
    }
    logger.info('Todos os agendamentos foram interrompidos.');
}

module.exports = { startSchedulers, stopSchedulers, processBatch };