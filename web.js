require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('./src/logger');
const { processCSV } = require('./src/csvReader');
const { startBot, stopBot, resetWhatsAppSession, triggerBatchNow, applyScheduleChanges, getSummary } = require('./src/botService');
const { startClientConnection, getConnectionStatus } = require('./src/client');
const statusTracker = require('./src/statusTracker');

const app = express();
const PORT = parseInt(process.env.WEB_PORT, 10) || 3000;
const CSV_FILE = path.join(__dirname, 'leads.csv');
const ENV_FILE = path.join(__dirname, '.env');
const MAX_BATCH_SLOTS = 12;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/summary', (_req, res) => {
    res.json(getSummary(process.env));
});

app.get('/api/whatsapp/status', (_req, res) => {
    res.json(getConnectionStatus());
});

function serializeEnvValue(value) {
    const normalized = String(value ?? '');
    if (!normalized) return '';
    if (/^[A-Za-z0-9_./:-]+$/.test(normalized)) return normalized;
    return JSON.stringify(normalized);
}

function normalizeTimeSlot(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{1,2}):([0-5]\d)$/);
    if (!match) return null;

    const hour = parseInt(match[1], 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return null;

    return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function readIntInRange(value, fallback, min, max) {
    const parsed = parseInt(value, 10);
    if (!Number.isInteger(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function getBatchCountFromEnv() {
    return readIntInRange(process.env.BATCH_COUNT, 4, 1, MAX_BATCH_SLOTS);
}

function updateEnvValues(values) {
    const original = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    let lines = original ? original.split('\n') : [];

    Object.entries(values).forEach(([key, value]) => {
        const index = lines.findIndex((line) => line.startsWith(`${key}=`));
        const normalizedValue = String(value ?? '');
        const nextLine = `${key}=${serializeEnvValue(normalizedValue)}`;
        if (index >= 0) {
            lines[index] = nextLine;
        } else {
            lines.push(nextLine);
        }
        process.env[key] = normalizedValue;
    });

    fs.writeFileSync(ENV_FILE, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

function loadCsvLeads() {
    if (!fs.existsSync(CSV_FILE)) return [];

    const normalized = fs.readFileSync(CSV_FILE, 'utf8').replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('primeiro_nome') && firstLine.includes('numero');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines
        .map((line) => {
            const [primeiro_nome, numero] = line.split(',');
            return {
                primeiro_nome: String(primeiro_nome || '').trim(),
                numero: String(numero || '').replace(/\D/g, '')
            };
        })
        .filter((lead) => lead.primeiro_nome && lead.numero);
}

function writeCsvLeads(leads) {
    const rows = ['primeiro_nome,numero'];
    leads.forEach((lead) => {
        const primeiroNome = String(lead.primeiro_nome || '').trim();
        const numero = String(lead.numero || '').replace(/\D/g, '');
        if (primeiroNome && numero) rows.push(`${primeiroNome},${numero}`);
    });
    fs.writeFileSync(CSV_FILE, `${rows.join('\n')}\n`, 'utf8');
}

app.post('/api/start', async (_req, res) => {
    try {
        const connection = getConnectionStatus();
        if (connection.status !== 'connected') {
            startClientConnection();
            return res.status(400).json({
                error: 'Conecte o WhatsApp antes de iniciar o bot. Use o QR Code na seção "Conta WhatsApp".'
            });
        }

        const result = await startBot(process.env);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/whatsapp/connect', (_req, res) => {
    try {
        const connection = startClientConnection();

        if (connection.status === 'connected') {
            return res.json({ ok: true, message: 'Conta já conectada.', connection });
        }

        return res.json({
            ok: true,
            message: 'Conexão iniciada. Escaneie o QR Code exibido no painel para autenticar.',
            connection
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/whatsapp/reset', async (_req, res) => {
    try {
        const result = await resetWhatsAppSession();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/stop', async (_req, res) => {
    try {
        const result = await stopBot();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/trigger', async (_req, res) => {
    try {
        const result = await triggerBatchNow(process.env);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/leads', async (req, res) => {
    try {
        const { leads } = req.body;
        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ error: 'Envie ao menos 1 lead.' });
        }

        const validLeads = [];
        leads.forEach((lead) => {
            const primeiroNome = String(lead.primeiro_nome || '').trim();
            const numero = String(lead.numero || '').replace(/\D/g, '');
            if (primeiroNome && numero) validLeads.push({ primeiro_nome: primeiroNome, numero });
        });

        if (validLeads.length === 0) {
            return res.status(400).json({ error: 'Nenhum lead válido informado.' });
        }

        writeCsvLeads(validLeads);
        await processCSV();
        res.json({ ok: true, message: 'Leads atualizados com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/leads/upload-csv', async (req, res) => {
    try {
        const { csvContent } = req.body;
        if (!csvContent || !String(csvContent).trim()) {
            return res.status(400).json({ error: 'Arquivo CSV vazio.' });
        }

        const normalized = String(csvContent).replace(/\r\n/g, '\n').trim();
        const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
        if (lines.length === 0) {
            return res.status(400).json({ error: 'Nenhuma linha válida encontrada no CSV.' });
        }

        const firstLine = lines[0].toLowerCase();
        const hasHeader = firstLine.includes('primeiro_nome') && firstLine.includes('numero');
        const csvOutput = hasHeader ? lines.join('\n') : ['primeiro_nome,numero', ...lines].join('\n');

        fs.writeFileSync(CSV_FILE, `${csvOutput}\n`, 'utf8');
        await processCSV();
        res.json({ ok: true, message: 'CSV anexado e leads sincronizados com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/leads/:numero', (req, res) => {
    try {
        const numero = String(req.params.numero || '').replace(/\D/g, '');
        if (!numero) {
            return res.status(400).json({ error: 'Número inválido para remoção.' });
        }

        const csvLeads = loadCsvLeads();
        const filteredCsvLeads = csvLeads.filter((lead) => String(lead.numero) !== numero);
        const removedFromCsv = filteredCsvLeads.length !== csvLeads.length;
        const removedFromStatus = statusTracker.removeLead(numero);

        if (!removedFromCsv && !removedFromStatus) {
            return res.status(404).json({ error: 'Lead não encontrado.' });
        }

        writeCsvLeads(filteredCsvLeads);
        return res.json({ ok: true, message: 'Lead removido com sucesso.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.delete('/api/leads', (_req, res) => {
    try {
        const removedCount = statusTracker.clearLeads();
        writeCsvLeads([]);
        return res.json({
            ok: true,
            message: removedCount > 0
                ? `${removedCount} lead(s) removido(s) com sucesso.`
                : 'Nenhum lead para remover.'
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/settings', (req, res) => {
    try {
        const batchSize = readIntInRange(req.body?.batchSize, readIntInRange(process.env.BATCH_SIZE, 20, 1, 1000), 1, 1000);
        const batchCount = readIntInRange(req.body?.batchCount, getBatchCountFromEnv(), 1, MAX_BATCH_SLOTS);
        const dailyLimit = readIntInRange(req.body?.dailyLimit, readIntInRange(process.env.DAILY_LIMIT, 80, 1, 100000), 1, 100000);
        const responseReplyDelaySeconds = readIntInRange(
            req.body?.responseReplyDelaySeconds,
            Math.floor(readIntInRange(process.env.RESPONSE_REPLY_MIN_MS, 8000, 0, 3600000) / 1000),
            0,
            3600
        );
        const responseReplyDelayMs = responseReplyDelaySeconds * 1000;

        const valuesToPersist = {
            BATCH_SIZE: String(batchSize),
            BATCH_COUNT: String(batchCount),
            DAILY_LIMIT: String(dailyLimit),
            RESPONSE_REPLY_MIN_MS: String(responseReplyDelayMs),
            RESPONSE_REPLY_MAX_MS: String(responseReplyDelayMs)
        };

        for (let index = batchCount + 1; index <= MAX_BATCH_SLOTS; index += 1) {
            valuesToPersist[`BATCH_HOUR_${index}`] = '';
        }

        updateEnvValues(valuesToPersist);

        const result = applyScheduleChanges(process.env);
        return res.json({
            ok: true,
            message: result.message,
            config: {
                batchSize,
                batchCount,
                dailyLimit,
                responseReplyDelaySeconds
            }
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/schedule', (req, res) => {
    try {
        const { slots } = req.body;
        if (!Array.isArray(slots)) {
            return res.status(400).json({ error: 'Formato inválido. Envie slots como array.' });
        }

        const batchCount = getBatchCountFromEnv();
        const trimmedSlots = slots.slice(0, batchCount);
        const normalizedSlots = Array.from({ length: batchCount }, (_slot, index) => normalizeTimeSlot(trimmedSlots[index]));
        const hasInvalidSlot = normalizedSlots.some((slot) => slot === null);
        if (hasInvalidSlot) {
            return res.status(400).json({ error: 'Use horários no formato HH:mm (ex: 15:20).' });
        }
        const sanitized = normalizedSlots.map((slot) => slot || '');

        const valuesToPersist = {};
        for (let index = 1; index <= MAX_BATCH_SLOTS; index += 1) {
            valuesToPersist[`BATCH_HOUR_${index}`] = index <= batchCount ? (sanitized[index - 1] || '') : '';
        }
        updateEnvValues(valuesToPersist);

        const result = applyScheduleChanges(process.env);
        return res.json({ ok: true, message: result.message, batchCount, slots: sanitized });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/second-message', (req, res) => {
    try {
        const secondMessage = String(req.body?.secondMessage || '').replace(/\r\n/g, '\n').trim();
        if (!secondMessage) {
            return res.status(400).json({ error: 'A segunda mensagem não pode ficar vazia.' });
        }

        updateEnvValues({ SECOND_MESSAGE: secondMessage });
        return res.json({ ok: true, message: 'Segunda mensagem salva com sucesso.', secondMessage });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

const server = app.listen(PORT, () => {
    logger.info(`Painel web disponível em http://localhost:${PORT}`);
});

server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
        logger.error(`Porta ${PORT} já está em uso. Finalize a instância anterior ou use WEB_PORT com outra porta.`);
        process.exit(1);
    }
    logger.error(`Falha ao subir painel web: ${error.message}`);
    process.exit(1);
});
