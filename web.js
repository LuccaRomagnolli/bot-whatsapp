require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('./src/logger');
const { processCSV } = require('./src/csvReader');
const { startBot, stopBot, triggerBatchNow, applyScheduleChanges, getSummary } = require('./src/botService');

const app = express();
const PORT = parseInt(process.env.WEB_PORT, 10) || 3000;
const CSV_FILE = path.join(__dirname, 'leads.csv');
const ENV_FILE = path.join(__dirname, '.env');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/summary', (_req, res) => {
    res.json(getSummary(process.env));
});

function updateEnvValues(values) {
    const original = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    let lines = original ? original.split('\n') : [];

    Object.entries(values).forEach(([key, value]) => {
        const index = lines.findIndex((line) => line.startsWith(`${key}=`));
        const nextLine = `${key}=${value || ''}`;
        if (index >= 0) {
            lines[index] = nextLine;
        } else {
            lines.push(nextLine);
        }
        process.env[key] = value || '';
    });

    fs.writeFileSync(ENV_FILE, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}

app.post('/api/start', async (_req, res) => {
    try {
        const result = await startBot(process.env);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
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

        const rows = ['primeiro_nome,numero'];
        leads.forEach((lead) => {
            const primeiroNome = String(lead.primeiro_nome || '').trim();
            const numero = String(lead.numero || '').replace(/\D/g, '');
            if (primeiroNome && numero) rows.push(`${primeiroNome},${numero}`);
        });

        if (rows.length <= 1) {
            return res.status(400).json({ error: 'Nenhum lead válido informado.' });
        }

        fs.writeFileSync(CSV_FILE, `${rows.join('\n')}\n`, 'utf8');
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

app.post('/api/schedule', (req, res) => {
    try {
        const { slots } = req.body;
        if (!Array.isArray(slots)) {
            return res.status(400).json({ error: 'Formato inválido. Envie slots como array.' });
        }

        const sanitized = slots.slice(0, 4).map((slot) => String(slot || '').trim());
        const isValid = sanitized.every((slot) => !slot || /^\d{1,2}:\d{2}$/.test(slot));
        if (!isValid) {
            return res.status(400).json({ error: 'Use horários no formato HH:mm (ex: 15:20).' });
        }

        updateEnvValues({
            BATCH_HOUR_1: sanitized[0] || '',
            BATCH_HOUR_2: sanitized[1] || '',
            BATCH_HOUR_3: sanitized[2] || '',
            BATCH_HOUR_4: sanitized[3] || ''
        });

        const result = applyScheduleChanges(process.env);
        return res.json({ ok: true, message: result.message, slots: sanitized });
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
