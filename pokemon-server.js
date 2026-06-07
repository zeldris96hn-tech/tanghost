/**
 * TanGhost Pokémon Bridge Server v1.0
 * ====================================
 * Servidor WebSocket local que hace de puente entre:
 *   - La extensión Chrome (content.js) → envía eventos de chat
 *   - El overlay de OBS (pokemon-overlay.html) → recibe y anima Pokémon
 *
 * REQUISITOS: Node.js (https://nodejs.org) — no necesita npm install
 *
 * USO:
 *   node pokemon-server.js
 *
 * Luego en OBS:
 *   Fuente → Navegador → URL: ruta completa a pokemon-overlay.html
 *   Ejemplo: file:///C:/TanGhost/pokemon-overlay.html
 *   Ancho: 1920  Alto: 1080  Fondo transparente: ✅
 */

const http = require('http');
const PORT = 7331;

// ── WebSocket manual (sin dependencias externas) ──
const clients = new Set();

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TanGhost Pokémon Bridge — OK\n');
});

server.on('upgrade', (req, socket, head) => {
    // Handshake WebSocket RFC 6455
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const crypto = require('crypto');
    const accept = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    clients.add(socket);
    console.log(`✅ Cliente conectado. Total: ${clients.size}`);

    socket.on('data', (buf) => {
        try {
            const frame = parseFrame(buf);
            if (!frame) return;
            // Retransmitir a todos los demás clientes (el overlay)
            const outFrame = buildFrame(frame.payload);
            for (const c of clients) {
                if (c !== socket && !c.destroyed) {
                    try { c.write(outFrame); } catch(e) {}
                }
            }
            // Log
            try {
                const data = JSON.parse(frame.payload.toString('utf8'));
                if (data.username) console.log(`💬 ${data.username}: ${(data.message||'').substring(0,40)}`);
            } catch(e) {}
        } catch(e) {}
    });

    socket.on('close', () => {
        clients.delete(socket);
        console.log(`❌ Cliente desconectado. Total: ${clients.size}`);
    });
    socket.on('error', () => {
        clients.delete(socket);
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
    console.log('🎮 ╔════════════════════════════════════════╗');
    console.log('🎮 ║  TanGhost Pokémon Bridge — Puerto 7331  ║');
    console.log('🎮 ╚════════════════════════════════════════╝');
    console.log('');
    console.log('👉 Pasos:');
    console.log('   1. Mantén esta ventana abierta mientras transmites');
    console.log('   2. En OBS: Fuente → Navegador → pokmon-overlay.html');
    console.log('   3. Activa la extensión TanGhost en Tango.me');
    console.log('   4. ¡Los Pokémon aparecerán con cada mensaje!');
    console.log('');
});
