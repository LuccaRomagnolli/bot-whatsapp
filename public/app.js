const stateEl = document.getElementById('botState');
const statsGrid = document.getElementById('statsGrid');
const leadsTableBody = document.getElementById('leadsTableBody');
const feedback = document.getElementById('feedback');
const leadsInput = document.getElementById('leadsInput');
const csvFileInput = document.getElementById('csvFileInput');
const scheduleInputs = [
  document.getElementById('slot1'),
  document.getElementById('slot2'),
  document.getElementById('slot3'),
  document.getElementById('slot4')
];

function setFeedback(message, isError = false) {
  feedback.textContent = message;
  feedback.style.color = isError ? '#dd6b7a' : '#b8c6d8';
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

  const slots = [
    summary.schedule?.slot1 || '',
    summary.schedule?.slot2 || '',
    summary.schedule?.slot3 || '',
    summary.schedule?.slot4 || ''
  ];
  scheduleInputs.forEach((input, index) => {
    if (document.activeElement !== input) input.value = slots[index];
  });
}

function renderLeads(leads) {
  if (!leads.length) {
    leadsTableBody.innerHTML = '<tr><td colspan="3">Nenhum lead cadastrado.</td></tr>';
    return;
  }
  leadsTableBody.innerHTML = leads
    .map((lead) => `
      <tr>
        <td>${lead.primeiro_nome || '-'}</td>
        <td>${lead.numero || '-'}</td>
        <td><span class="tag ${lead.status}">${lead.status || 'pendente'}</span></td>
      </tr>
    `)
    .join('');
}

async function refresh() {
  try {
    const summary = await api('/api/summary');
    renderStats(summary);
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
document.getElementById('saveScheduleBtn').addEventListener('click', async () => {
  const slots = scheduleInputs.map((input) => input.value || '');
  try {
    const result = await api('/api/schedule', {
      method: 'POST',
      body: JSON.stringify({ slots })
    });
    setFeedback(result.message || 'Horários salvos com sucesso.');
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

refresh();
setInterval(refresh, 8000);
