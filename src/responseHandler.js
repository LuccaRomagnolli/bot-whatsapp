const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { sendSecondMessage } = require('./messenger');

function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function extractMessageUser(jid) {
    return String(jid || '').split('@')[0] || '';
}

function resolveLeadFromCandidates(candidates) {
    const uniqueCandidates = [...new Set(candidates.map(onlyDigits).filter(Boolean))];
    if (!uniqueCandidates.length) return null;

    for (const candidate of uniqueCandidates) {
        const exact = statusTracker.getLead(candidate);
        if (exact) return { lead: exact, matchedBy: `exact:${candidate}` };
    }

    const sentLeads = statusTracker.getAllLeads().filter((lead) => lead.status === 'enviado' && !lead.segundaMensagemEnviada);
    for (const candidate of uniqueCandidates) {
        const compatible = sentLeads.filter((lead) => {
            const leadNumber = onlyDigits(lead.numero);
            return leadNumber.endsWith(candidate) || candidate.endsWith(leadNumber);
        });
        if (compatible.length === 1) {
            return { lead: compatible[0], matchedBy: `approx:${candidate}` };
        }
    }

    return null;
}

function setupResponseHandler(client, config) {
    client.on('message', async msg => {
        try {
            if (msg.fromMe) return;
            if (String(msg.from || '').endsWith('@g.us')) return;

            const contact = await msg.getContact().catch(() => null);
            const candidates = [
                extractMessageUser(msg.from),
                extractMessageUser(msg.author),
                contact && contact.number,
                contact && contact.id && contact.id.user
            ];

            const resolved = resolveLeadFromCandidates(candidates);
            if (!resolved || !resolved.lead) {
                logger.info(`Mensagem recebida sem lead correspondente (from=${msg.from || '-'}, candidates=${candidates.filter(Boolean).join('|') || '-'})`);
                return;
            }

            const { lead, matchedBy } = resolved;
            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

            if (lead.status === 'enviado' && !lead.segundaMensagemEnviada) {
                logger.info(`📩 Resposta recebida de ${lead.primeiro_nome} às ${timeStr} (${matchedBy})`);

                // Dispara a segunda mensagem de forma assíncrona, não bloqueante
                sendSecondMessage(client, lead, config).catch(err => {
                    logger.error(`Falha no fluxo da segunda mensagem para ${lead.numero}: ${err.message}`);
                });
            }
        } catch (error) {
            logger.error(`Erro no listener de mensagens: ${error.message}`);
        }
    });
}

module.exports = { setupResponseHandler };
