const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { ensureConnectedClient, recoverClient } = require('./client');

const delay = ms => new Promise(res => setTimeout(res, ms));
const TRANSIENT_ERROR_PATTERNS = [
    /detached frame/i,
    /execution context was destroyed/i,
    /target closed/i,
    /session closed/i,
    /context destroyed/i,
    /cannot find context with specified id/i
];

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function getRandomTemplate(nome) {
    const templates = [
        `Olá, falo com ${nome}?`,
        `Oi! Estou falando com ${nome}?`,
        `Olá ${nome}, tudo bem?`
    ];

    const startEmojis = ['👋', '✨', '🤝', '😊', '🙂'];
    const endEmojis = ['😊', '🙂', '😉', '✅', '💬', '👍'];

    let msg = pickRandom(templates);

    // 35% de chance de emoji no inicio da mensagem
    if (Math.random() <= 0.35) {
        msg = `${pickRandom(startEmojis)} ${msg}`;
    }

    // 70% de chance de emoji(s) no fim (sendo 25% chance de virem dois)
    if (Math.random() <= 0.7) {
        const firstEmoji = pickRandom(endEmojis);
        const secondEmoji = Math.random() <= 0.25 ? ` ${pickRandom(endEmojis)}` : '';
        msg += ` ${firstEmoji}${secondEmoji}`;
    }

    return msg;
}

async function sendMessageWithTyping(client, numero, texto) {
    const chatId = `${numero}@c.us`;
    let activeClient = null;

    const normalizedText = String(texto || '').trim();
    if (!normalizedText) {
        logger.warn(`Mensagem vazia para ${numero}. Envio cancelado.`);
        return false;
    }

    try {
        activeClient = await ensureConnectedClient(client);
    } catch (error) {
        logger.error(`Não foi possível garantir conexão ativa para ${numero}: ${error.message}`);
        return false;
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let chat = null;
        try {
            const numberId = await activeClient.getNumberId(numero);
            if (!numberId) {
                logger.warn(`Número inválido ou inexistente no WhatsApp: ${numero}`);
                return false;
            }
            const targetChatId = numberId._serialized || chatId;

            await delay(1000); // Pausa breve antes de digitar

            chat = await activeClient.getChatById(targetChatId).catch(() => null);
            if (chat) {
                await chat.sendSeen().catch(() => null);
                await chat.sendStateTyping().catch(() => null);
            }

            // Simular digitação: ~50ms por caractere ±20%
            const baseTime = normalizedText.length * 50;
            const variance = baseTime * 0.2;
            const typingTime = baseTime + (Math.random() * variance * 2 - variance);

            await delay(typingTime);
            if (chat) await chat.clearState().catch(() => null);

            await activeClient.sendMessage(targetChatId, normalizedText);
            return true;
        } catch (error) {
            if (chat) await chat.clearState().catch(() => null);

            const isTransient = TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(String(error.message || '')));
            if (isTransient && attempt < maxAttempts) {
                const retryDelay = 1200 * attempt;
                logger.warn(`Falha transitória ao enviar para ${numero} (tentativa ${attempt}/${maxAttempts}): ${error.message}. Retentando em ${retryDelay}ms...`);
                try {
                    activeClient = await recoverClient(`Erro de envio para ${numero}: ${error.message}`);
                } catch (recoverError) {
                    logger.error(`Falha ao recuperar sessão antes do reenvio para ${numero}: ${recoverError.message}`);
                    return false;
                }
                await delay(retryDelay);
                continue;
            }

            logger.error(`Erro ao enviar mensagem para ${numero}: ${error.message}`);
            return false;
        }
    }

    return false;
}

async function sendFirstMessage(client, lead) {
    const msg = getRandomTemplate(lead.primeiro_nome);
    const success = await sendMessageWithTyping(client, lead.numero, msg);
    
    if (success) {
        statusTracker.updateLeadStatus(lead.numero, 'enviado');
        logger.info(`Primeira mensagem enviada para ${lead.primeiro_nome} (${lead.numero})`);
    } else {
        statusTracker.updateLeadStatus(lead.numero, 'erro', 'Falha no envio da primeira mensagem');
    }
}

async function sendSecondMessage(client, lead, config) {
    const minDelay = parseInt(config.RESPONSE_REPLY_MIN_MS) || 8000;
    const maxDelay = parseInt(config.RESPONSE_REPLY_MAX_MS) || 15000;
    const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
    
    logger.info(`Aguardando ${randomDelay}ms para responder ${lead.primeiro_nome}...`);
    await delay(randomDelay);
    
    const success = await sendMessageWithTyping(client, lead.numero, config.SECOND_MESSAGE);
    
    if (success) {
        statusTracker.updateLeadStatus(lead.numero, 'respondido');
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        logger.info(`✅ Segunda mensagem enviada para ${lead.primeiro_nome} às ${timeStr}`);
    }
}

module.exports = { sendFirstMessage, sendSecondMessage };
