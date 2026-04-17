const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const logger = require('./logger');
const statusTracker = require('./statusTracker');

const CSV_FILE = path.join(__dirname, '../leads.csv');

function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function processCSV() {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(CSV_FILE)) {
            logger.error(`Arquivo ${CSV_FILE} não encontrado.`);
            return resolve();
        }

        let loaded = 0;
        fs.createReadStream(CSV_FILE)
            .pipe(csv())
            .on('data', (row) => {
                try {
                    const nomeStr = (row.primeiro_nome || row.nome || '').trim();
                    let numeroStr = (row.numero || row.telefone || row.celular || '').replace(/\D/g, '');

                    // Aceita números BR com DDD (10 ou 11 dígitos) e internacionais a partir de 10.
                    if (!nomeStr || !numeroStr || numeroStr.length < 10) {
                        return; // Ignora linhas inválidas
                    }

                    const nomeFormatado = capitalize(nomeStr);
                    
                    statusTracker.addOrUpdateLead(numeroStr, {
                        primeiro_nome: nomeFormatado,
                        numero: numeroStr
                    });
                    loaded++;
                } catch (err) {
                    logger.error(`Erro ao processar linha do CSV: ${err.message}`);
                }
            })
            .on('end', () => {
                logger.info(`Leitura do CSV concluída. ${loaded} leads validados no sistema.`);
                resolve();
            })
            .on('error', reject);
    });
}

module.exports = { processCSV };