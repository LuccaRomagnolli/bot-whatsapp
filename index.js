require('dotenv').config();
const logger = require('./src/logger');
const { processCSV } = require('./src/csvReader');
const { initializeClient } = require('./src/client');
const { setupResponseHandler } = require('./src/responseHandler');
const { startSchedulers } = require('./src/scheduler');

function validateConfig(config) {
    const requiredVars = ['SECOND_MESSAGE'];
    const missing = requiredVars.filter((key) => !config[key] || !String(config[key]).trim());
    if (missing.length > 0) {
        throw new Error(`Variáveis obrigatórias ausentes no .env: ${missing.join(', ')}`);
    }
}

async function main() {
    try {
        logger.info('Iniciando Bot de WhatsApp...');
        validateConfig(process.env);
        
        // 1. Processar CSV e sincronizar com o arquivo de status
        await processCSV();

        // 2. Inicializar o cliente do WhatsApp Web e autenticar
        const client = await initializeClient();

        // 3. Configurar listener de mensagens para a Segunda Mensagem (LGPD compliant)
        setupResponseHandler(client, process.env);

        // 4. Iniciar Agendadores (Crons dos lotes)
        startSchedulers(client, process.env);

        logger.info('Sistema rodando em background. Aguardando horários agendados...');

    } catch (error) {
        logger.error(`Erro fatal de inicialização: ${error.message}`);
        process.exit(1);
    }
}

main();