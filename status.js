require('dotenv').config();
const Table = require('cli-table3');
const statusTracker = require('./src/statusTracker');

function getNextBatchTime() {
    const hours = [
        parseInt(process.env.BATCH_HOUR_1 || '9'),
        parseInt(process.env.BATCH_HOUR_2 || '11'),
        parseInt(process.env.BATCH_HOUR_3 || '16'),
        parseInt(process.env.BATCH_HOUR_4 || '17')
    ].sort((a, b) => a - b);

    const currentHour = new Date().getHours();
    
    for (let h of hours) {
        if (h > currentHour) {
            return `${String(h).padStart(2, '0')}:00`;
        }
    }
    return `${String(hours[0]).padStart(2, '0')}:00 (Amanhã)`;
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