/**
 * TanGhost Gifter Server v1.0
 * ============================
 * Servidor WebSocket local para el overlay de Top Gifter.
 * Puerto: 7333
 *
 * Flujo:
 *   content.js → ws://localhost:7333/emit-gifter   (extensión manda regalos)
 *   gifter-overlay.html → ws://localhost:7333/recv-gifter  (overlay escucha)
 *
 * El servidor mantiene los totales acumulados por usuario durante
 * toda la sesión. Si gifter-overlay.html se reconecta, el servidor
 * le envía el estado actual (quién es el top gifter y con cuántas monedas).
 *
 * USO: node gifter-server.js
 */

const http   = require('http');
const crypto = require('crypto');
const PORT   = 7333;

const emitters  = new Set();   // extensión Chrome
const receivers = new Set();   // overlay(s) de OBS

// ── Estado de sesión ──────────────────────────────────────────────────
// gifterTotals: Map<username_lowercase, { username_original, coins }>
const gifterTotals = new Map();
let   topGifter    = null;    // { username, coins }
let   lastCfg      = null;    // última configuración enviada por la extensión

// Bots que se ignoran siempre
const BOT_NAMES = new Set(['tango happy hour', 'tango', 'tango live']);
function isBot(u) { return BOT_NAMES.has((u || '').toLowerCase().trim()); }

function processGift(username, coinsAdded) {
    if (!username || isBot(username)) return null;
    const key  = username.toLowerCase();
    const prev = gifterTotals.get(key);
    const total = Math.max(0, (prev ? prev.coins : 0) + coinsAdded);
    gifterTotals.set(key, { username, coins: total });

    // Recalcular el top siempre (necesario para que las restas actualicen el #1 correctamente)
    let newTop = null;
    for (const [, entry] of gifterTotals) {
        if (!newTop || entry.coins > newTop.coins) {
            newTop = { username: entry.username, coins: entry.coins };
        }
    }
    topGifter = newTop;
    return topGifter;
}

// ── Dedup mínimo en servidor: solo bloquea doble envío en < 2 segundos ──
// La protección principal está en content.js con el UUID de Tango.
// Este dedup solo es respaldo para envíos accidentales instantáneos.
const DEDUP_MS    = 2000;
const recentGifts = new Map();

function isDupGift(username, coins) {
    if (coins < 0) return false;
    const key  = username.toLowerCase() + '||' + coins;
    const now  = Date.now();
    const last = recentGifts.get(key);
    if (last && now - last < DEDUP_MS) {
        console.log(`[TanGhost] ⛔ Doble envío bloqueado: ${username} x${coins}`);
        return true;
    }
    recentGifts.set(key, now);
    if (recentGifts.size > 200) {
        for (const [k, t] of recentGifts)
            if (now - t > DEDUP_MS * 10) recentGifts.delete(k);
    }
    return false;
}

// ── WebSocket helpers ─────────────────────────────────────────────────
function buildFrame(data) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data), 'utf8');
    const len     = payload.length;
    let header;
    if (len < 126)       { header = Buffer.alloc(2); header[0]=0x81; header[1]=len; }
    else if (len < 65536){ header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(len,2); }
    else                 { header = Buffer.alloc(10);header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(len),2); }
    return Buffer.concat([header, payload]);
}

function parseFrame(buf) {
    if (buf.length < 2) return null;
    if ((buf[0] & 0x0f) !== 1) return null;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
    if (!masked) return { payload: buf.slice(offset, offset + len) };
    const mask = buf.slice(offset, offset + 4); offset += 4;
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i % 4];
    return { payload };
}

function broadcast(receivers, obj) {
    const frame = buildFrame(obj);
    for (const c of receivers) {
        if (!c.destroyed) { try { c.write(frame); } catch(e) {} }
    }
}

function sendTo(socket, obj) {
    if (!socket.destroyed) { try { socket.write(buildFrame(obj)); } catch(e) {} }
}

// ── Servidor HTTP / WebSocket ─────────────────────────────────────────
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TanGhost Gifter Server v1.0 — OK\n');
});

server.on('upgrade', (req, socket, head) => {
    const wsKey = req.headers['sec-websocket-key'];
    if (!wsKey) { socket.destroy(); return; }

    const accept = crypto
        .createHash('sha1')
        .update(wsKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    const path      = req.url || '';
    const isEmitter = path.startsWith('/emit-gifter');
    const role      = isEmitter ? 'EMISOR' : 'OVERLAY';

    if (isEmitter) {
        emitters.add(socket);
    } else {
        receivers.add(socket);
        // Enviar estado actual al overlay que acaba de conectar
        if (topGifter) {
            sendTo(socket, {
                type:     'tg_gift',
                username: topGifter.username,
                coins:    0,
                isSync:   true,
                topCoins: topGifter.coins,
                cfg:      lastCfg || null,   // ← config guardada para que el overlay aplique tamaños sin esperar un regalo
            });
        } else if (lastCfg) {
            // Sin gifter aún pero sí hay config — enviarla igual
            sendTo(socket, {
                type: 'tg_cfg',
                cfg:  lastCfg,
            });
        }
    }

    console.log(`✅ [${role}] conectado. Emisores: ${emitters.size}  Overlays: ${receivers.size}`);

    socket.on('data', (buf) => {
        if (!emitters.has(socket)) return;
        try {
            const frame = parseFrame(buf);
            if (!frame) return;
            const data = JSON.parse(frame.payload.toString('utf8'));

            if (data.type === 'tg_gift' && data.username && data.coins != null) {
                // Guardar config si viene incluida
                if (data.cfg) lastCfg = data.cfg;
                // Las restas (coins negativo) nunca se deduplicam — son correcciones manuales
                if (data.coins > 0 && isDupGift(data.username, data.coins)) return;
                const top = processGift(data.username, data.coins);
                if (!top) return;

                console.log(`🎁 ${data.username} → +${data.coins} coins | Top: ${top.username} (${top.coins})`);

                // Reenviar a todos los overlays con el total acumulado
                broadcast(receivers, {
                    type:     'tg_gift',
                    username: top.username,
                    coins:    data.coins,          // monedas de ESTE regalo
                    topCoins: top.coins,           // TOTAL acumulado del top gifter
                    cfg:      data.cfg || null,
                });
            }
        } catch(e) {}
    });

    socket.on('close', () => {
        emitters.delete(socket); receivers.delete(socket);
        console.log(`❌ [${role}] desconectado`);
    });
    socket.on('error', () => { emitters.delete(socket); receivers.delete(socket); });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('🎁 ╔══════════════════════════════════════════╗');
    console.log('🎁 ║  TanGhost Gifter Server v1.0 — Puerto 7333 ║');
    console.log('🎁 ╚══════════════════════════════════════════╝');
    console.log('');
    console.log('👉 Pasos:');
    console.log('   1. Mantén esta ventana abierta mientras transmites');
    console.log('   2. En OBS: Fuente → Navegador → gifter-overlay.html');
    console.log('      Ancho: 380  Alto: 280  ✅ Fondo transparente');
    console.log('   3. Activa "Overlay Gifter #1" en la extensión TanGhost');
    console.log('   4. ¡El top gifter aparece en pantalla con la suma acumulada!');
    console.log('');
    console.log('ℹ️  Los totales se reinician al cerrar este servidor.');
    console.log('');
});
