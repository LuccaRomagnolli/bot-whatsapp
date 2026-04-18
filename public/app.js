const stateEl = document.getElementById('botState');
const statsGrid = document.getElementById('statsGrid');
const leadsTableBody = document.getElementById('leadsTableBody');
const feedback = document.getElementById('feedback');
const leadsInput = document.getElementById('leadsInput');
const csvFileInput = document.getElementById('csvFileInput');
const secondMessageInput = document.getElementById('secondMessageInput');
const batchSizeInput = document.getElementById('batchSizeInput');
const batchCountInput = document.getElementById('batchCountInput');
const dailyLimitInput = document.getElementById('dailyLimitInput');
const replyDelayInput = document.getElementById('replyDelayInput');
const scheduleGrid = document.getElementById('scheduleGrid');
const waStatusText = document.getElementById('waStatusText');
const waPhoneText = document.getElementById('waPhoneText');
const waQrImage = document.getElementById('waQrImage');
const waQrHint = document.getElementById('waQrHint');
const MAX_BATCH_SLOTS = 12;
let scheduleInputs = [];
let localBatchCountOverride = null;
let settingsDirty = false;
let scheduleDirty = false;

function setFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.style.color = isError ? '#dd6b7a' : '#b8c6d8';
}

function sanitizeTimeValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{1,2}):([0-5]\d)$/);
  if (!match) return '';

  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return '';
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function ensureScheduleInputs(count) {
  const safeCount = clampInt(count, 4, 1, MAX_BATCH_SLOTS);
  if (scheduleInputs.length === safeCount) return;

  const previousValues = scheduleInputs.map((input) => input.value || '');
  scheduleGrid.innerHTML = '';
  scheduleInputs = [];

  for (let index = 0; index < safeCount; index += 1) {
    const input = document.createElement('input');
    input.type = 'time';
    input.dataset.slot = String(index + 1);
    input.title = `Horário do lote ${index + 1}`;
    input.value = sanitizeTimeValue(previousValues[index] || '');
    input.addEventListener('input', () => {
      scheduleDirty = true;
    });
    input.addEventListener('change', () => {
      scheduleDirty = true;
    });
    scheduleGrid.appendChild(input);
    scheduleInputs.push(input);
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha na requisição');
  return data;
}

function renderStats(summary) {
  const { totals, bot } = summary;
  stateEl.textContent = bot.running ? 'Bot ativo' : (bot.starting ? 'Inicializando...' : 'Bot inativo');

  const cards = [
    ['Leads', totals.leads],
    ['Pendentes', totals.pendente],
    ['Enviados', totals.enviado],
    ['Respondidos', totals.respondido],
    ['Erros', totals.erro],
    ['Enviadas Hoje', totals.sentToday],
    ['Warmup', totals.warmupMode ? `Dia ${totals.warmupDay}` : 'Inativo']
  ];

  statsGrid.innerHTML = cards
    .map(([label, value]) => `<div class="stat"><label>${label}</label><strong>${value}</strong></div>`)
    .join('');

  const config = summary.config || {};
  const summaryBatchCount = clampInt(config.batchCount, 4, 1, MAX_BATCH_SLOTS);
  const effectiveBatchCount = localBatchCountOverride ?? summaryBatchCount;

  if (!settingsDirty) {
    if (document.activeElement !== batchSizeInput) batchSizeInput.value = String(config.batchSize ?? 20);
    if (document.activeElement !== batchCountInput) batchCountInput.value = String(summaryBatchCount);
    if (document.activeElement !== dailyLimitInput) dailyLimitInput.value = String(config.dailyLimit ?? 80);
    if (document.activeElement !== replyDelayInput) {
      replyDelayInput.value = String(config.responseReplyDelaySeconds ?? 8);
    }
  } else if (localBatchCountOverride !== null && document.activeElement !== batchCountInput) {
    batchCountInput.value = String(localBatchCountOverride);
  }

  ensureScheduleInputs(effectiveBatchCount);
  if (!scheduleDirty) {
    const slots = Array.isArray(summary.schedule?.slots) ? summary.schedule.slots : [];
    scheduleInputs.forEach((input, index) => {
      if (document.activeElement !== input) {
        const safeValue = sanitizeTimeValue(slots[index]);
        input.value = safeValue;
      }
    });
  }

  if (document.activeElement !== secondMessageInput) {
    secondMessageInput.value = summary.config?.secondMessage || '';
  }
}

function formatPhone(number) {
  if (!number) return '';
  const digits = String(number).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 2) return `+${digits}`;
  return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
}

function getConnectionLabel(status) {
  if (status === 'connected') return 'Conectado';
  if (status === 'qr_ready') return 'Aguardando leitura do QR Code';
  if (status === 'connecting') return 'Conectando...';
  if (status === 'error') return 'Erro na autenticação';
  return 'Desconectado';
}

function renderWhatsApp(connection = {}) {
  const statusLabel = getConnectionLabel(connection.status);
  waStatusText.textContent = `Status da conexão: ${statusLabel}`;

  if (connection.phoneNumber) {
    waPhoneText.textContent = `Número conectado: ${formatPhone(connection.phoneNumber)}`;
  } else {
    waPhoneText.textContent = 'Nenhum número conectado.';
  }

  if (connection.qrDataUrl) {
    waQrImage.src = connection.qrDataUrl;
    waQrImage.style.display = 'block';
    waQrHint.textContent = 'Escaneie este QR Code com o WhatsApp no seu celular.';
  } else {
    waQrImage.removeAttribute('src');
    waQrImage.style.display = 'none';

    if (connection.status === 'connected') {
      waQrHint.textContent = 'Conta autenticada. Você já pode iniciar o bot.';
    } else if (connection.status === 'connecting') {
      waQrHint.textContent = 'Gerando QR Code... aguarde alguns segundos.';
    } else if (connection.status === 'error') {
      waQrHint.textContent = connection.lastError || 'Falha ao autenticar. Tente conectar novamente.';
    } else {
      waQrHint.textContent = 'Clique em "Conectar por QR" para gerar o código.';
    }
  }
}

function renderLeads(leads) {
  if (!leads.length) {
    leadsTableBody.innerHTML = '<tr><td colspan="4">Nenhum lead cadastrado.</td></tr>';
    return;
  }
  leadsTableBody.innerHTML = leads
    .map((lead) => `
      <tr>
        <td>${lead.primeiro_nome || '-'}</td>
        <td>${lead.numero || '-'}</td>
        <td><span class="tag ${lead.status}">${lead.status || 'pendente'}</span></td>
        <td>
          <button class="ghost danger table-action-btn delete-lead-btn" data-numero="${lead.numero || ''}">
            Apagar
          </button>
        </td>
      </tr>
    `)
    .join('');
}

async function refresh() {
  try {
    const summary = await api('/api/summary');
    renderStats(summary);
    renderWhatsApp(summary.whatsapp || {});
    renderLeads(summary.leads || []);
  } catch (error) {
    setFeedback(error.message, true);
  }
}

async function postAction(path, successMessage) {
  try {
    const result = await api(path, { method: 'POST', body: '{}' });
    setFeedback(result.message || successMessage);
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
}

document.getElementById('startBtn').addEventListener('click', () => postAction('/api/start', 'Bot iniciado.'));
document.getElementById('stopBtn').addEventListener('click', () => postAction('/api/stop', 'Bot parado.'));
document.getElementById('triggerBtn').addEventListener('click', () => postAction('/api/trigger', 'Lote manual enviado.'));
document.getElementById('connectWaBtn').addEventListener('click', () => postAction('/api/whatsapp/connect', 'Conexão iniciada.'));
document.getElementById('resetWaBtn').addEventListener('click', async () => {
  const confirmReset = window.confirm('Isso vai desconectar e remover o número atual. Deseja continuar?');
  if (!confirmReset) return;
  await postAction('/api/whatsapp/reset', 'Número removido com sucesso.');
});
batchCountInput.addEventListener('input', () => {
  settingsDirty = true;
  scheduleDirty = true;
  localBatchCountOverride = clampInt(batchCountInput.value, 4, 1, MAX_BATCH_SLOTS);
  ensureScheduleInputs(localBatchCountOverride);
});
batchSizeInput.addEventListener('input', () => {
  settingsDirty = true;
});
dailyLimitInput.addEventListener('input', () => {
  settingsDirty = true;
});
replyDelayInput.addEventListener('input', () => {
  settingsDirty = true;
});
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  try {
    const payload = {
      batchSize: clampInt(batchSizeInput.value, 20, 1, 1000),
      batchCount: clampInt(batchCountInput.value, 4, 1, MAX_BATCH_SLOTS),
      dailyLimit: clampInt(dailyLimitInput.value, 80, 1, 100000),
      responseReplyDelaySeconds: clampInt(replyDelayInput.value, 8, 0, 3600)
    };

    const result = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    settingsDirty = false;
    localBatchCountOverride = null;
    setFeedback(result.message || 'Configurações salvas com sucesso.');
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
});
document.getElementById('saveScheduleBtn').addEventListener('click', async () => {
  const slots = scheduleInputs.map((input) => input.value || '');
  try {
    const result = await api('/api/schedule', {
      method: 'POST',
      body: JSON.stringify({ slots })
    });
    scheduleDirty = false;
    setFeedback(result.message || 'Horários salvos com sucesso.');
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
});

document.getElementById('saveSecondMessageBtn').addEventListener('click', async () => {
  try {
    const result = await api('/api/second-message', {
      method: 'POST',
      body: JSON.stringify({ secondMessage: secondMessageInput.value || '' })
    });
    secondMessageInput.value = result.secondMessage || secondMessageInput.value;
    setFeedback(result.message || 'Segunda mensagem salva com sucesso.');
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
});

document.getElementById('saveLeadsBtn').addEventListener('click', async () => {
  const lines = leadsInput.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const leads = lines.map((line) => {
    const [primeiro_nome, numero] = line.split(',').map((part) => (part || '').trim());
    return { primeiro_nome, numero };
  });

  try {
    const result = await api('/api/leads', {
      method: 'POST',
      body: JSON.stringify({ leads })
    });
    setFeedback(result.message || 'Leads salvos com sucesso.');
    leadsInput.value = '';
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
});

document.getElementById('clearLeadsBtn').addEventListener('click', async () => {
  const confirmClear = window.confirm('Tem certeza que deseja apagar todos os leads?');
  if (!confirmClear) return;

  try {
    const result = await api('/api/leads', { method: 'DELETE' });
    setFeedback(result.message || 'Leads removidos com sucesso.');
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
});

leadsTableBody.addEventListener('click', async (event) => {
  const button = event.target.closest('.delete-lead-btn');
  if (!button) return;

  const numero = button.dataset.numero || '';
  if (!numero) {
    setFeedback('Número do lead inválido para remoção.', true);
    return;
  }

  const confirmDelete = window.confirm(`Apagar lead ${numero}?`);
  if (!confirmDelete) return;

  try {
    const result = await api(`/api/leads/${encodeURIComponent(numero)}`, { method: 'DELETE' });
    setFeedback(result.message || 'Lead removido com sucesso.');
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
});

csvFileInput.addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  try {
    const csvContent = await file.text();
    const result = await api('/api/leads/upload-csv', {
      method: 'POST',
      body: JSON.stringify({ csvContent })
    });
    setFeedback(result.message || 'CSV anexado com sucesso.');
    csvFileInput.value = '';
    await refresh();
  } catch (error) {
    setFeedback(error.message, true);
  }
});

ensureScheduleInputs(4);
refresh();
setInterval(refresh, 8000);
