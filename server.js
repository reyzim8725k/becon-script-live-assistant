import express from 'express';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { WebSocketServer, WebSocket } from 'ws';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = Number(process.env.PORT || 3000);

let TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || '';
let TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
let TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

if (!TIKTOK_USERNAME || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    const rl = readline.createInterface({ input, output });
    if (!TIKTOK_USERNAME) {
        TIKTOK_USERNAME = (await rl.question('Digite o nome de usuário da live: '))
            .trim()
            .replace(/^@/, '');
    }
    if (!TELEGRAM_BOT_TOKEN) {
        TELEGRAM_BOT_TOKEN = (await rl.question('Cole o token do bot Telegram: ')).trim();
    }
    if (!TELEGRAM_CHAT_ID) {
        TELEGRAM_CHAT_ID = (await rl.question('Digite o Chat ID do Telegram: ')).trim();
    }
    rl.close();
}

if (!TIKTOK_USERNAME) {
    console.error('Nenhum usuário informado. Servidor encerrado.');
    process.exit(1);
}

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Token ou Chat ID do Telegram não informado. Servidor encerrado.');
    process.exit(1);
}

app.use(express.static('public'));

const connection = new TikTokLiveConnection(TIKTOK_USERNAME, {});
const clientes = new Set();
const termosScript = ['script', 'scripts', 'script vip', 'codigo', 'código'];
const usuariosComScriptRespondido = new Map();
const usuariosQueJaCurtiram = new Set();
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(process.cwd(), 'audios');
let falaScript = 'Os scripts grátis estão no link da bio!';
let falaPresente = 'Obrigado, {usuario}, pelo presente {presente}! Seu script será entregue quando a live terminar.';
let falaEntrada = 'Bem-vindo à live, {usuario}!';
let falaLike = 'Obrigado pela curtida, {usuario}!';
const AUDIO_WORKERS = Number(process.env.AUDIO_WORKERS || 4);
const audioJobs = [];
const playbackJobs = [];
let activeAudioWorkers = 0;
let playingAudio = false;

function comando(programa, argumentos) {
    return new Promise((resolve, reject) => {
        const processo = spawn(programa, argumentos, { stdio: ['ignore', 'ignore', 'pipe'] });
        let erro = '';
        processo.stderr?.on('data', bloco => { erro += bloco.toString(); });
        processo.on('error', reject);
        processo.on('close', codigo => codigo === 0 ? resolve() : reject(new Error(erro || `${programa} saiu com código ${codigo}`)));
    });
}

async function gerarAudio(texto, tipo = 'fala') {
    const id = crypto.randomUUID();
    const mp3 = path.join(AUDIO_DIR, `${tipo}-${id}.mp3`);
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    await comando('gtts-cli', [texto, '--lang', 'pt', '--output', mp3]);
    return { mp3, texto };
}

async function limparAudiosTemporarios() {
    await fs.mkdir(AUDIO_DIR, { recursive: true });
    const arquivos = await fs.readdir(AUDIO_DIR);
    const antigos = arquivos.filter(nome =>
        (nome.startsWith('gift-') || nome.startsWith('fala-') || nome.startsWith('entrada-') || nome.startsWith('curtida-')) && nome.endsWith('.mp3')
    );
    await Promise.all(antigos.map(nome =>
        fs.rm(path.join(AUDIO_DIR, nome), { force: true })
    ));
    if (antigos.length) {
        console.log(`Limpeza inicial: ${antigos.length} áudio(s) temporário(s) removido(s).`);
    }
}

function reproduzirArquivo(arquivo, texto) {
    playbackJobs.push({ arquivo, texto });
    void processarReproducao();
}

async function processarReproducao() {
    if (playingAudio || !playbackJobs.length) return;
    playingAudio = true;
    const job = playbackJobs.shift();
    console.log(`[${hora()}] Áudio: ${job.texto}`);
    try {
        await comando('mpv', [
            '--no-video',
            '--really-quiet',
            '--volume=100',
            '--speed=1.15',
            '--audio-pitch-correction=yes',
            job.arquivo
        ]);
    } catch (error) {
        console.error('Não foi possível reproduzir o MP3:', error.message);
    } finally {
        await fs.rm(job.arquivo, { force: true }).catch(() => {});
        playingAudio = false;
        void processarReproducao();
    }
}

function gerarEReproduzirPresente(usuario, presente) {
    audioJobs.push({ tipo: 'gift', texto: falaPresente.replaceAll('{usuario}', usuario).replaceAll('{presente}', presente) });
    void processarWorkers();
}

function gerarEReproduzirTexto(texto, tipo = 'fala') {
    audioJobs.push({ tipo, texto });
    void processarWorkers();
}

async function processarWorkers() {
    while (activeAudioWorkers < AUDIO_WORKERS && audioJobs.length) {
        const job = audioJobs.shift();
        activeAudioWorkers++;
        gerarAudio(job.texto, job.tipo)
            .then(resultado => reproduzirArquivo(resultado.mp3, resultado.texto))
            .catch(error => console.error('Erro ao gerar áudio personalizado:', error.message))
            .finally(() => { activeAudioWorkers--; void processarWorkers(); });
    }
}

function limpar(texto, limite = 300) {
    return String(texto || '')
        .replace(/https?:\/\/\S+/gi, '')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limite);
}

function hora() {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium'
    }).format(new Date());
}

function enviarTodos(payload) {
    const mensagem = JSON.stringify(payload);
    for (const cliente of clientes) {
        if (cliente.readyState === WebSocket.OPEN) cliente.send(mensagem);
    }
}

async function notificarTelegram(usuario, presente, quantidade) {
    const texto = [
        'NOVO PRESENTE 🎁',
        `TIPO: ${presente}`,
        `QUANTIDADE: ${quantidade}x`,
        `HORÁRIO: ${hora()}`,
        `USUÁRIO: @${usuario}`
    ].join('\n');

    try {
        const resposta = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: TELEGRAM_CHAT_ID,
                    text: texto
                })
            }
        );

        if (!resposta.ok) {
            const erro = await resposta.text();
            throw new Error(`Telegram HTTP ${resposta.status}: ${erro}`);
        }

        console.log(`[${hora()}] Notificação enviada ao Telegram.`);
    } catch (error) {
        console.error(`[${hora()}] Falha ao enviar Telegram: ${error.message}`);
    }
}

function extrairChat(data) {
    const usuario = limpar(
        data.user?.uniqueId || data.user?.unique_id || data.user?.uniqueID ||
        data.uniqueId || data.unique_id || data.user?.nickname || 'visitante',
        80
    ).replace(/^@/, '');

    const comentario = limpar(
        data.comment || data.text || data.content || data.message?.content ||
        data.message?.text || data.chatMessage || ''
    );

    return { usuario, comentario };
}

function contemTermoScript(texto) {
    const normalizado = texto.toLocaleLowerCase('pt-BR');
    return termosScript.some(termo => normalizado.includes(termo));
}

console.log('---------------------------------------------');
console.log(`Assistente do Becon Script · @${TIKTOK_USERNAME}`);
console.log('Modo: mensagens prontas, sem IA');
console.log(`Workers de áudio: ${AUDIO_WORKERS}`);
console.log('---------------------------------------------');

await limparAudiosTemporarios();

connection.connect()
    .then(state => {
        console.log(`Conectado à live! Room ID: ${state.roomId}`);
        enviarTodos({ type: 'status', connected: true, username: TIKTOK_USERNAME });
    })
    .catch(error => console.error('Erro ao conectar à live:', error.message));

connection.on(WebcastEvent.CHAT, data => {
    const item = extrairChat(data);
    if (!item.comentario || item.comentario.length < 2) return;

    console.log(`[${hora()}] @${item.usuario}: ${item.comentario}`);
    enviarTodos({ type: 'chat', ...item, receivedAt: hora() });

    // Evita repetir a resposta de script para a mesma pessoa a cada comentário.
    if (contemTermoScript(item.comentario)) {
        const ultimo = usuariosComScriptRespondido.get(item.usuario) || 0;
        if (Date.now() - ultimo >= 30_000) {
            usuariosComScriptRespondido.set(item.usuario, Date.now());
            enviarTodos({
                type: 'script-question',
                usuario: item.usuario,
                comentario: item.comentario
            });
            gerarEReproduzirTexto(falaScript, 'fala');
        }
    }
});

connection.on(WebcastEvent.GIFT, data => {
    const usuario = limpar(
        data.user?.uniqueId || data.user?.unique_id || data.user?.nickname || 'visitante',
        80
    ).replace(/^@/, '');
    const presente = limpar(
        data.giftDetails?.giftName || data.giftDetails?.gift_name ||
        data.giftDetails?.name || data.giftName || data.gift_name ||
        data.gift?.name || data.gift?.giftName || 'presente',
        100
    );
    const quantidade = data.repeatCount || data.repeat_count || 1;

    console.log(`[${hora()}] Presente de @${usuario}: ${presente} (${quantidade}x)`);
    enviarTodos({
        type: 'gift',
        usuario,
        presente,
        quantidade,
        receivedAt: hora()
    });
    void notificarTelegram(usuario, presente, quantidade);
    gerarEReproduzirPresente(usuario, presente);
});

connection.on(WebcastEvent.MEMBER, data => {
    const usuario = limpar(data.user?.uniqueId || data.user?.unique_id || data.user?.nickname || 'novo espectador', 80);
    console.log(`[${hora()}] Entrada de @${usuario}`);
    enviarTodos({ type: 'member', usuario });
    gerarEReproduzirTexto(falaEntrada.replaceAll('{usuario}', usuario), 'entrada');
});

connection.on(WebcastEvent.LIKE, data => {
    const usuario = limpar(data.user?.uniqueId || data.user?.unique_id || data.user?.nickname || 'alguém', 80);
    console.log(`[${hora()}] Curtida de @${usuario}`);
    enviarTodos({ type: 'like', usuario });

    if (usuariosQueJaCurtiram.has(usuario)) {
        console.log(`[${hora()}] Curtida de @${usuario} ignorada: usuário já recebeu boas-vindas.`);
        return;
    }

    usuariosQueJaCurtiram.add(usuario);
    gerarEReproduzirTexto(falaLike.replaceAll('{usuario}', usuario), 'curtida');
});

wss.on('connection', socket => {
    clientes.add(socket);
    socket.send(JSON.stringify({
        type: 'status',
        connected: true,
        username: TIKTOK_USERNAME,
        mode: 'predefined'
    }));
    socket.on('message', raw => {
        try {
            const config = JSON.parse(raw.toString());
            if (config.type !== 'settings') return;
            if (typeof config.script === 'string' && config.script.trim()) falaScript = limpar(config.script, 260);
            if (typeof config.gift === 'string' && config.gift.trim()) falaPresente = limpar(config.gift, 260);
            if (typeof config.member === 'string' && config.member.trim()) falaEntrada = limpar(config.member, 260);
            if (typeof config.like === 'string' && config.like.trim()) falaLike = limpar(config.like, 260);
        } catch {}
    });
    socket.on('close', () => clientes.delete(socket));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Site do assistente: http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
    console.log('\nEncerrando assistente...');
    await connection.disconnect().catch(() => {});
    process.exit(0);
});
