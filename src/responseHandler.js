const logger = require('./logger');
const statusTracker = require('./statusTracker');
const { sendSecondMessage } = require('./messenger');
const pendingSecondMessages = new Set();

function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function extractMessageUser(jid) {
    return String(jid || '').split('@')[0] || '';
}

function getSerializedJid(jid) {
    if (jid && typeof jid === 'object' && jid._serialized) return String(jid._serialized);
    return String(jid || '');
}

function isPersonalJid(jid) {
    return String(jid || '').endsWith('@c.us');
}

function isGroupJid(jid) {
    return String(jid || '').endsWith('@g.us');
}

function isLidJid(jid) {
    return String(jid || '').endsWith('@lid');
}

function isNewsletterJid(jid) {
    return String(jid || '').endsWith('@newsletter');
}

function isBroadcastJid(jid) {
    return String(jid || '').endsWith('@broadcast');
}

function isUserJid(jid) {
    const raw = String(jid || '');
    return raw.endsWith('@c.us') || raw.endsWith('@lid') || raw.endsWith('@s.whatsapp.net');
}

function shouldIgnoreIncomingJid(jid) {
    const raw = String(jid || '');
    if (!raw) return true;
    return isGroupJid(raw) || isNewsletterJid(raw) || isBroadcastJid(raw) || raw === 'status@broadcast';
}

function getSecondMessageKey(prefix, numero) {
    return `${prefix}:${onlyDigits(numero)}`;
}

function collectLeadCandidates(msg, contact) {
    const remote = msg && msg.id && msg.id.remote;
    return [
        extractMessageUser(getSerializedJid(msg && msg.from)),
        extractMessageUser(getSerializedJid(msg && msg.author)),
        extractMessageUser(getSerializedJid(remote)),
        extractMessageUser(getSerializedJid(msg && msg.to)),
        contact && contact.number,
        contact && contact.id && contact.id.user
    ];
}

async function enrichCandidatesWithLidMapping(client, candidates, msg) {
    if (!client || typeof client.getContactLidAndPhone !== 'function') return candidates;

    const lidJids = [
        getSerializedJid(msg && msg.from),
        getSerializedJid(msg && msg.author),
        getSerializedJid(msg && msg.to),
        getSerializedJid(msg && msg.id && msg.id.remote)
    ].filter((jid) => isLidJid(jid));

    if (!lidJids.length) return candidates;

    const lookupInputs = [...new Set(
        lidJids.flatMap((jid) => [jid, extractMessageUser(jid)]).filter(Boolean)
    )];

    try {
        const mapped = await client.getContactLidAndPhone(lookupInputs);
        const extras = mapped.flatMap((entry) => [
            extractMessageUser(entry && entry.lid),
            extractMessageUser(entry && entry.pn)
        ]).filter(Boolean);

        if (!extras.length) return candidates;
        return [...candidates, ...extras];
    } catch (error) {
        logger.warn(`Não foi possível mapear LID para telefone: ${error.message}`);
        return candidates;
    }
}

async function resolvePhoneDigitsFromJids(client, jids) {
    const uniqueJids = [...new Set((jids || []).map(getSerializedJid).filter(Boolean))];

    for (const jid of uniqueJids) {
        if (isPersonalJid(jid) || jid.endsWith('@s.whatsapp.net')) {
            const directNumber = onlyDigits(extractMessageUser(jid));
            if (directNumber) return directNumber;
        }
    }

    const lidJids = uniqueJids.filter((jid) => isLidJid(jid));
    if (!lidJids.length || !client || typeof client.getContactLidAndPhone !== 'function') {
        return '';
    }

    const lookupInputs = [...new Set(
        lidJids.flatMap((jid) => [jid, extractMessageUser(jid)]).filter(Boolean)
    )];

    try {
        const mapped = await client.getContactLidAndPhone(lookupInputs);
        for (const entry of mapped) {
            const mappedNumber = onlyDigits(extractMessageUser(entry && entry.pn));
            if (mappedNumber) return mappedNumber;
        }
    } catch (error) {
        logger.warn(`Falha ao resolver número a partir de LID: ${error.message}`);
    }

    return '';
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

function enqueueSecondMessage(client, config, lead, key, contextLabel) {
    if (pendingSecondMessages.has(key)) {
        logger.info(`⏳ ${contextLabel}: segunda mensagem já está em processamento para ${lead.numero}.`);
        return;
    }
    pendingSecondMessages.add(key);

    sendSecondMessage(client, lead, config)
        .catch(err => {
            logger.error(`Falha no fluxo da segunda mensagem para ${lead.numero}: ${err.message}`);
        })
        .finally(() => {
            pendingSecondMessages.delete(key);
        });
}

async function triggerSelfTestSecondMessage(client, config, msg) {
    if (!msg || !msg.fromMe) return;

    const fromJid = getSerializedJid(msg.from);
    const toJid = getSerializedJid(msg.to);
    const remoteJid = getSerializedJid(msg.id && msg.id.remote);

    if (shouldIgnoreIncomingJid(fromJid) || shouldIgnoreIncomingJid(toJid) || shouldIgnoreIncomingJid(remoteJid)) return;
    if (!isUserJid(fromJid) || !isUserJid(toJid) || !isUserJid(remoteJid)) return;

    const isOwnChat = fromJid === toJid && toJid === remoteJid;
    if (!isOwnChat) return;

    const incomingText = String(msg.body || '').trim();
    const secondMessage = String(config.SECOND_MESSAGE || '').trim();
    if (!incomingText || (secondMessage && incomingText === secondMessage)) return;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    logger.info(`🧪 Mensagem de teste recebida no próprio número às ${timeStr}. Disparando segunda mensagem...`);

    const ownNumber = await resolvePhoneDigitsFromJids(client, [
        remoteJid,
        fromJid,
        getSerializedJid(client && client.info && client.info.wid && client.info.wid._serialized)
    ]);
    const testLead = {
        primeiro_nome: 'Teste',
        numero: ownNumber,
        status: 'enviado',
        segundaMensagemEnviada: false
    };

    if (!testLead.numero) {
        logger.warn('Self-test ignorado: número próprio não pôde ser resolvido.');
        return;
    }

    const selfTestKey = getSecondMessageKey('self', testLead.numero);
    enqueueSecondMessage(client, config, testLead, selfTestKey, 'Self-test');
}

function setupResponseHandler(client, config) {
    client.on('message', async msg => {
        try {
            const fromJid = getSerializedJid(msg.from);
            if (shouldIgnoreIncomingJid(fromJid)) return;
            if (msg.fromMe) return;

            const contact = await msg.getContact().catch(() => null);
            let candidates = collectLeadCandidates(msg, contact);

            let resolved = resolveLeadFromCandidates(candidates);
            if (!resolved || !resolved.lead) {
                candidates = await enrichCandidatesWithLidMapping(client, candidates, msg);
                resolved = resolveLeadFromCandidates(candidates);
            }

            if (!resolved || !resolved.lead) {
                logger.info(`Mensagem recebida sem lead correspondente (from=${msg.from || '-'}, candidates=${candidates.filter(Boolean).join('|') || '-'})`);
                return;
            }

            const { lead, matchedBy } = resolved;
            const leadNumber = onlyDigits(lead.numero);
            if (!leadNumber) {
                logger.warn(`Lead encontrado sem número válido. Ignorando resposta (matchedBy=${matchedBy}).`);
                return;
            }

            const now = new Date();
            const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            const isEligible = lead.status === 'enviado' && !lead.segundaMensagemEnviada;
            if (!isEligible) {
                logger.info(`Lead ${lead.primeiro_nome} (${lead.numero}) encontrado, mas não elegível para 2ª mensagem (status=${lead.status || '-'}, segundaMensagemEnviada=${Boolean(lead.segundaMensagemEnviada)}).`);
                return;
            }

            logger.info(`📩 Resposta recebida de ${lead.primeiro_nome} às ${timeStr} (${matchedBy})`);

            const queueKey = getSecondMessageKey('lead', leadNumber);
            enqueueSecondMessage(client, config, lead, queueKey, 'Lead');
        } catch (error) {
            logger.error(`Erro no listener de mensagens: ${error.message}`);
        }
    });

    client.on('message_create', async msg => {
        try {
            await triggerSelfTestSecondMessage(client, config, msg);
        } catch (error) {
            logger.error(`Erro no listener de mensagens (self-test): ${error.message}`);
        }
    });
}

module.exports = { setupResponseHandler };
