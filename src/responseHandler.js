const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { sendSecondMessage } = require('./messenger');

function setupResponseHandler(client, config) {
    client.on('message', async msg => {
        try {
            const contact = await msg.getContact();
            const numeroStr = contact.number;
            
            if (!numeroStr) return;

            const lead = statusTracker.getLead(numeroStr);
            
            if (lead) {
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                
                if (lead.status === 'enviado' && !lead.segundaMensagemEnviada) {
                    logger.info(`📩 Resposta recebida de ${lead.primeiro_nome} às ${timeStr}`);
                    
                    // Dispara a segunda mensagem de forma assíncrona, não bloqueante
                    sendSecondMessage(client, lead, config).catch(err => {
                        logger.error(`Falha no fluxo da segunda mensagem para ${lead.numero}: ${err.message}`);
                    });
                } else if (lead.status === 'respondido') {
                    // Ignora silenciosamente conforme especificação
                } else if (lead.status === 'pendente') {
                    // Ignora
                }
            }
        } catch (error) {
            logger.error(`Erro no listener de mensagens: ${error.message}`);
        }
    });
}

module.exports = { setupResponseHandler };