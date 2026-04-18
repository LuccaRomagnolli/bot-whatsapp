require('dotenv').config();
const Table = require('cli-table3');
const statusTracker = require('./src/statusTracker');

function getNextBatchTime() {
    const maxBatchSlots = 12;
    const parsedBatchCount = parseInt(process.env.BATCH_COUNT, 10);
    const batchCount = Number.isInteger(parsedBatchCount)
        ? Math.min(maxBatchSlots, Math.max(1, parsedBatchCount))
        : 4;

    const getBatchEnv = (key, fallback) => {
        const value = process.env[key];
        if (value === undefined) return fallback;
        return String(value).trim();
    };

    const defaultSlots = ['9', '11', '16', '17'];
    const slots = Array.from({ length: batchCount }, (_slot, index) =>
        getBatchEnv(`BATCH_HOUR_${index + 1}`, defaultSlots[index] || '')
    )
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .map((value) => {
            if (value.includes(':')) {
                const [h, m] = value.split(':').map((part) => parseInt(part, 10));
                if (Number.isInteger(h) && Number.isInteger(m)) return { h, m };
                return null;
            }
            const h = parseInt(value, 10);
            if (Number.isInteger(h)) return { h, m: 0 };
            return null;
        })
        .filter((slot) => slot && slot.h >= 0 && slot.h <= 23 && slot.m >= 0 && slot.m <= 59)
        .sort((a, b) => (a.h * 60 + a.m) - (b.h * 60 + b.m));

    if (slots.length === 0) return 'Sem horários válidos';

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const slot of slots) {
        const slotMinutes = slot.h * 60 + slot.m;
        if (slotMinutes > currentMinutes) {
            return `${String(slot.h).padStart(2, '0')}:${String(slot.m).padStart(2, '0')}`;
        }
    }
    return `${String(slots[0].h).padStart(2, '0')}:${String(slots[0].m).padStart(2, '0')} (Amanhã)`;
}

function showDashboard() {
    const leads = statusTracker.getAllLeads();
    
    let stats = { pendente: 0, enviado: 0, respondido: 0, erro: 0 };
    leads.forEach(l => {
        if(stats[l.status] !== undefined) stats[l.status]++;
    });

    const sentToday = statusTracker.getSentCountToday();
    const isWarmup = process.env.WARMUP_MODE === 'true';
    const warmupDay = statusTracker.getWarmupDay();
    const nextBatch = getNextBatchTime();

    const table = new Table({
        head: ['Métrica', 'Valor'],
        colWidths: [40, 20]
    });

    table.push(
        ['Total de Leads', leads.length],
        ['Pendentes', stats.pendente],
        ['Enviados (aguardando)', stats.enviado],
        ['Respondidos (2ª msg enviada)', stats.respondido],
        ['Erros', stats.erro],
        ['Mensagens enviadas HOJE', sentToday],
        ['Próximo lote agendado', nextBatch],
        ['Modo Warmup', isWarmup ? `Ativo (Dia ${warmupDay})` : 'Inativo']
    );

    console.log('\n============================================================');
    console.log('              DASHBOARD - WHATSAPP LEADS BOT');
    console.log('============================================================');
    console.log(table.toString());
    console.log('\n');
}

showDashboard();
