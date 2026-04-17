const logger = require('./logger');
const statusTracker = require('./statusTracker');

const delay = ms => new Promise(res => setTimeout(res, ms));

function getRandomTemplate(nome) {
    const templates = [
        `Olá, falo com ${nome}?`,
        `Oi! Estou falando com ${nome}?`,
        `Olá ${nome}, tudo bem?`
    ];
    const emojis = ['😊', '🙂', '👋', '✅'];
    
    let msg = templates[Math.floor(Math.random() * templates.length)];
    
    // 30% de chance de adicionar emoji
    if (Math.random() <= 0.3) {
        msg += ' ' + emojis[Math.floor(Math.random() * emojis.length)];
    }
    
    return msg;
}

async function sendMessageWithTyping(client, numero, texto) {
    const chatId = `${numero}@c.us`;
    
    try {
        const numberId = await client.getNumberId(numero);
        if (!numberId) {
            logger.warn(`Número inválido ou inexistente no WhatsApp: ${numero}`);
            return false;
        }
        const targetChatId = numberId._serialized || chatId;

        await delay(1000); // Pausa breve antes de digitar

        const chat = await client.getChatById(targetChatId).catch(() => null);
        if (chat) {
            await chat.sendSeen().catch(() => null);
            await chat.sendStateTyping().catch(() => null);
        }
        
        // Simular digitação: ~50ms por caractere ±20%
        const baseTime = texto.length * 50;
        const variance = baseTime * 0.2;
        const typingTime = baseTime + (Math.random() * variance * 2 - variance);
        
        await delay(typingTime);
        if (chat) await chat.clearState().catch(() => null);
        
        await client.sendMessage(targetChatId, texto);
        return true;
    } catch (error) {
        logger.error(`Erro ao enviar mensagem para ${numero}: ${error.message}`);
        return false;
    }
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