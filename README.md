# WhatsApp Leads Bot

Bot em Node.js para envio de primeira mensagem em lotes, resposta automatizada com segunda mensagem e controle de status por lead.

## Requisitos

- Node.js 18+
- NPM 9+
- Sessao ativa do WhatsApp Web (QR code no primeiro start)

## Configuracao

1. Copie o exemplo de ambiente:

```bash
cp .env.example .env
```

2. Preencha o arquivo `leads.csv` com cabecalho:

```csv
primeiro_nome,numero
Maria,5511999999999
Joao,5511988888888
```

## Rodando local

```bash
npm install
npm start
```

## Painel web interativo

```bash
npm run web
```

Abra `http://localhost:3000` para:
- iniciar/parar o bot
- disparar lote manual
- cadastrar leads pela interface
- selecionar horários de disparo (até 4 por dia)
- acompanhar métricas em tempo real

Comandos uteis:

```bash
npm run status
```

## Deploy com Docker

1. Build da imagem:

```bash
docker build -t whatsapp-bot-leads .
```

2. Rodar container:

```bash
docker run --name whatsapp-bot \
  --env-file .env \
  -v "$(pwd)/leads.csv:/app/leads.csv" \
  -v "$(pwd)/.wwebjs_auth:/app/.wwebjs_auth" \
  -v "$(pwd)/.wwebjs_cache:/app/.wwebjs_cache" \
  -v "$(pwd)/leads_status.json:/app/leads_status.json" \
  -v "$(pwd)/warmup_start.json:/app/warmup_start.json" \
  whatsapp-bot-leads
```

## Deploy com Docker Compose

1. Suba o bot:

```bash
docker compose up -d --build
```

2. Veja logs:

```bash
docker compose logs -f
```

3. Parar:

```bash
docker compose down
```

## Deploy no Railway

Este projeto ja inclui `railway.json`.

1. Conecte o repositorio no Railway.
2. Em Variables, cadastre as variaveis do `.env`.
3. Em Volumes, crie volume persistente para:
   - `/app/.wwebjs_auth`
   - `/app/.wwebjs_cache`
   - `/app/leads_status.json`
   - `/app/warmup_start.json`
4. Deploy.

## Deploy no Render

Este projeto ja inclui `render.yaml`.

1. No Render, crie novo Web Service a partir do repositorio.
2. O Render vai detectar `render.yaml`.
3. Configure as variaveis de ambiente do `.env`.
4. Configure disco persistente e monte em `/app` para manter sessao e status.
5. Deploy.

## Deploy em VPS

- Configure variaveis de ambiente do `.env`.
- Garanta persistencia das pastas `.wwebjs_auth` e `.wwebjs_cache`.
- Garanta persistencia de `leads_status.json` e `warmup_start.json`.
- Execute `npm start`.

Sem persistencia o bot precisara reautenticar no WhatsApp e perdera historico de warmup/status.
