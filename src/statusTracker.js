const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const STATUS_FILE = path.join(__dirname, '../leads_status.json');
const WARMUP_FILE = path.join(__dirname, '../warmup_start.json');

class StatusTracker {
    constructor() {
        this.statusData = this.loadStatus();
    }

    loadStatus() {
        if (fs.existsSync(STATUS_FILE)) {
            try {
                return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            } catch (error) {
                logger.error(`Erro ao ler leads_status.json: ${error.message}`);
                return {};
            }
        }
        return {};
    }

    saveStatus() {
        try {
            fs.writeFileSync(STATUS_FILE, JSON.stringify(this.statusData, null, 2), 'utf8');
        } catch (error) {
            logger.error(`Erro ao salvar leads_status.json: ${error.message}`);
        }
    }

    addOrUpdateLead(numero, data) {
        if (!this.statusData[numero]) {
            this.statusData[numero] = { ...data, status: 'pendente', history: [] };
        } else {
            this.statusData[numero] = { ...this.statusData[numero], ...data };
        }
        this.saveStatus();
    }

    updateLeadStatus(numero, status, errorMsg = null) {
        if (this.statusData[numero]) {
            this.statusData[numero].status = status;
            this.statusData[numero].updatedAt = new Date().toISOString();
            if (status === 'enviado') {
                this.statusData[numero].primeiraMensagemTimestamp = new Date().toISOString();
            }
            if (status === 'respondido') {
                this.statusData[numero].segundaMensagemEnviada = true;
            }
            if (errorMsg) {
                this.statusData[numero].history.push(`Erro: ${errorMsg}`);
            }
            this.saveStatus();
        }
    }

    getLead(numero) {
        return this.statusData[numero];
    }

    getAllLeads() {
        return Object.values(this.statusData);
    }

    getPendingLeads() {
        return Object.values(this.statusData).filter(l => l.status === 'pendente');
    }

    getSentCountToday() {
        const today = new Date().toISOString().split('T')[0];
        return Object.values(this.statusData).filter(l => 
            (l.status === 'enviado' || l.status === 'respondido') && 
            l.primeiraMensagemTimestamp && 
            l.primeiraMensagemTimestamp.startsWith(today)
        ).length;
    }

    getWarmupDay() {
        if (!fs.existsSync(WARMUP_FILE)) {
            const startData = { startDate: new Date().toISOString() };
            fs.writeFileSync(WARMUP_FILE, JSON.stringify(startData), 'utf8');
            return 1;
        }
        try {
            const data = JSON.parse(fs.readFileSync(WARMUP_FILE, 'utf8'));
            const startDate = new Date(data.startDate);
            const now = new Date();
            const diffTime = Math.max(0, now - startDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
            return diffDays;
        } catch (error) {
            logger.error(`Erro ao ler warmup_start.json: ${error.message}`);
            return 1;
        }
    }
}

module.exports = new StatusTracker();