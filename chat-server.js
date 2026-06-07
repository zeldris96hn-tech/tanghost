/**
 * TanGhost Chat Bridge Server v2.0
 * =================================
 * Servidor WebSocket local que hace de puente entre:
 *   - La extensión Chrome (content.js) → conecta a ws://localhost:7332/emit
 *   - El overlay de OBS (chat-overlay.html) → conecta a ws://localhost:7332/recv
 *
 * Separar emisores de receptores evita que reconexiones del overlay
 * o múltiples instancias del browser source dupliquen los mensajes.
 *
 * REQUISITOS: Node.js (https://nodejs.org) — no necesita npm install
 *
 * USO:
 *   node chat-server.js
 */

const http   = require('http');
const crypto = require('crypto');
const PORT   = 7332;

// Emisores = extensión Chrome  (path /emit)
// Receptores = overlays de OBS (path /recv o cualquier otro path)
const emitters  = new Set();
const receivers = new Set();

// Dedup en el servidor: evita reenviar el mismo mensaje si llega
// dos veces en menos de 2 segundos (por si la extensión tiene múltiples
// instancias o el content.js se recarga).
const recentMsgs = new Map();
const DEDUP_MS   = 2000;

function isDup(payload) {
    const key = payload.toString('utf8').substring(0, 120);
    const now = Date.now();
    if (recentMsgs.has(key) && now - recentMsgs.get(key) < DEDUP_MS) return true;
    recentMsgs.set(key, now);
    // Limpiar entradas viejas cada 200 mensajes
    if (recentMsgs.size > 200) {
        for (const [k, t] of recentMsgs) {
            if (now - t > DEDUP_MS * 3) recentMsgs.delete(k);
        }
    }
    return false;
}

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TanGhost Chat Bridge v2.0 — OK\n');
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

    // Determinar rol por path: /emit = extensión, cualquier otro = overlay
    const isEmitter = (req.url || '').startsWith('/emit');
    const role      = isEmitter ? 'EMISOR' : 'RECEPTOR';

    if (isEmitter) {
        emitters.add(socket);
    } else {
        receivers.add(socket);
    }

    console.log(`✅ [${role}] conectado. Emisores: ${emitters.size}  Receptores: ${receivers.size}`);

    socket.on('data', (buf) => {
        // Solo los emisores retransmiten a los receptores
        if (!emitters.has(socket)) return;

        try {
            const frame = parseFrame(buf);
            if (!frame) return;

            // Dedup a nivel de servidor
            if (isDup(frame.payload)) return;

            // Reenviar SOLO a receptores activos
            const outFrame = buildFrame(frame.payload);
            for (const c of receivers) {
                if (!c.destroyed) {
                    try { c.write(outFrame); } catch(e) {}
                }
            }

            // Log
            try {
                const data = JSON.parse(frame.payload.toString('utf8'));
                if (data.type === 'tg_chat') {
                    console.log(`💬 ${data.username}: ${(data.message || '').substring(0, 60)}`);
                }
            } catch(e) {}

        } catch(e) {}
    });

    socket.on('close', () => {
        emitters.delete(socket);
        receivers.delete(socket);
        console.log(`❌ [${role}] desconectado. Emisores: ${emitters.size}  Receptores: ${receivers.size}`);
    });
    socket.on('error', () => {
        emitters.delete(socket);
        receivers.delete(socket);
    });
});

// ── Parser de frame WebSocket (solo texto, sin fragmentación) ──
function parseFrame(buf) {
    if (buf.length < 2) return null;
    const opcode = buf[0] & 0x0f;
    if (opcode !== 1) return null; // solo text frames
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
    if (!masked) {
        return { payload: buf.slice(offset, offset + len) };
    }
    const mask = buf.slice(offset, offset + 4);
    offset += 4;
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i % 4];
    return { payload };
}

// ── Builder de frame WebSocket (sin máscara, servidor→cliente) ──
function buildFrame(data) {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('💬 ╔════════════════════════════════════════╗');
    console.log('💬 ║  TanGhost Chat Bridge v2.0 — Puerto 7332 ║');
    console.log('💬 ╚════════════════════════════════════════╝');
    console.log('');
    console.log('👉 Pasos:');
    console.log('   1. Mantén esta ventana abierta mientras transmites');
    console.log('   2. En OBS: Fuente → Navegador → chat-overlay.html');
    console.log('      Ancho: 400  Alto: 600  ✅ Fondo transparente');
    console.log('   3. Activa "Overlay Chat OBS" en la extensión TanGhost');
    console.log('   4. ¡Los mensajes del chat aparecerán en OBS!');
    console.log('');
});
