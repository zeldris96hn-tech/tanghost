(function () {
    'use strict';
    console.log("👻 TanGhost v18.6");

    // ================================================================
    // ESTADO
    // ================================================================
    let ENABLED        = true;
    let MUTED_TTS      = false;   // silencia solo la voz; todo lo demás funciona
    let SELECTED_VOICE = null;
    let RATE           = 1.05;
    let OBS_PORT       = '4455';
    let OBS_PASSWORD   = '';

    let OBS_SLOTS = [
        { scene:'', source:'' },
        { scene:'', source:'' },
        { scene:'', source:'' },
    ];
    let OBS_FOLLOW_SLOTS = [
        { scene:'', source:'' },
        { scene:'', source:'' },
        { scene:'', source:'' },
    ];
    let OBS_SPECIAL_SLOTS = [
        { scene:'', source:'' },
        { scene:'', source:'' },
        { scene:'', source:'' },
    ];

    let FILTERS = {
        readEmojis:        true,
        readLinks:         true,
        readNumbers:       true,
        readAllCaps:       true,
        readShort:         true,
        readUsername:      true,
        giftSound:         true,
        readJoined:        true,
        obsConnect:        false,
        obsFollowConnect:  false,
        obsSpecialConnect: false,
    };

    // ================================================================
    // TIMER — cuenta regresiva 4 horas
    // Solo arranca con el PRIMER MENSAJE REAL del chat
    // (NO con "empezó a ver", NO con seguidor, NO con regalo)
    // ================================================================
    let timerStarted = false;
    let timerEnd     = null;

    function timerStart() {
        if (timerStarted) return;
        timerStarted = true;
        timerEnd = Date.now() + 4 * 60 * 60 * 1000;
        chrome.storage.local.set({ timerEnd, timerStarted: true });
        console.log('👻 TanGhost: timer iniciado');
    }

    chrome.storage.local.get(['timerEnd','timerStarted'], (r) => {
        if (r.timerStarted && r.timerEnd && r.timerEnd > Date.now()) {
            timerStarted = true;
            timerEnd     = r.timerEnd;
            console.log('👻 TanGhost: timer restaurado');
        }
    });

    // ================================================================
    // SELECTORES
    // ================================================================
    const SEL_ROOT = '.Pna2H';
    const SEL_USER = '.peyuZ';
    const SEL_TEXT = '.KR99L';
    const SEL_INIT = '.J_XGe';

    // ================================================================
    // EXTRAER TEXTO — igual que v10, robusto ante cambios de layout
    // ================================================================
    function extractNodeText(node) {
        const userEl = node.querySelector(SEL_USER);
        const textEl = node.querySelector(SEL_TEXT);

        if (textEl) {
            return {
                username: userEl?.innerText?.trim() || '',
                message:  textEl.innerText?.trim()  || '',
                fullText: node.innerText?.trim()    || '',
            };
        }

        const fullText = node.innerText?.trim() || '';
        if (!fullText) return null;

        const wrapper = node.querySelector('.KngPy') || node;
        const kids = [...wrapper.children].filter(c => c.innerText?.trim());
        let username = '';
        let message  = fullText;
        if (kids.length >= 2) {
            username = kids[0].innerText?.trim() || '';
            message  = kids.slice(1).map(c => c.innerText?.trim()).join(' ');
        } else if (kids.length === 1) {
            message = kids[0].innerText?.trim() || '';
        }
        return { username, message, fullText };
    }

    // ================================================================
    // PATRONES — definidos antes de makeKey que los usa
    // ================================================================
    const FOLLOW_PATS = [
        /¡Nuevo seguidor!/i, /Nuevo seguidor/i, /new follower/i,
        /started following/i, /empezó a seguir/i, /comenzó a seguir/i,
        /is now following/i,
    ];
    function isFollow(text) { return FOLLOW_PATS.some(p => p.test(text)); }

    const JOINED_PATS = [
        /empezó a ver/i, /started watching/i, /joined/i,
        /se unió/i, /entró a ver/i, /is watching/i, /comenzó a ver/i,
    ];
    function isJoined(text) {
        if (isFollow(text)) return false;
        return JOINED_PATS.some(p => p.test(text));
    }

    const RX_EMOJI = new RegExp(
        '(?:[\\u{1F000}-\\u{1FFFF}]|[\\u{2600}-\\u{27BF}]|[\\u{2300}-\\u{23FF}]' +
        '|[\\u{2B00}-\\u{2BFF}]|[\\u{FE00}-\\u{FEFF}]|[\\u{E0000}-\\u{E007F}]' +
        '|\\u{200D}|\\u{20E3}|[#*0-9]\\u{FE0F}?\\u{20E3}|\\u{FE0F})+', 'gu'
    );
    const RX_GIFT_NUM = /\b(\d{1,3}(?:[.,]\d{3})*|\d{1,6})\s*$/;

    const SPECIAL_GIFT_NUMS = new Set([999, 1000, 1100, 1111, -1]); // -1 = NaN de Tango

    // En Tango el número del regalo SIEMPRE va al final: "NombreUsuario\n79"
    // También puede aparecer como "NaN" cuando Tango no parsea el número → dispara especial.
    // Strip emojis → buscar número al final, o la palabra NaN al final.
    const RX_GIFT_NAN = /\bNaN\s*$/;

    function extractGiftNumber(text) {
        const clean = text.replace(RX_EMOJI, '').trim();
        if (RX_GIFT_NAN.test(clean)) return -1;
        const m = RX_GIFT_NUM.exec(clean);
        if (!m) return null;
        // Quitar separadores de miles (punto o coma) antes de parsear
        // Ej: "18.999" → "18999", "18,999" → "18999"
        const numStr = m[1].replace(/[.,]/g, '');
        return parseInt(numStr, 10);
    }

    function isGiftSpecial(text) {
        const n = extractGiftNumber(text);
        if (n === null) return false;
        return SPECIAL_GIFT_NUMS.has(n);
    }
    function isGiftNormal(text) {
        const n = extractGiftNumber(text);
        if (n === null) return false;
        return !SPECIAL_GIFT_NUMS.has(n) && n >= 1 && n <= 99999;
    }

    // Exponer función de diagnóstico para el popup
    window.__TG_DIAGNOSE__ = function(text) {
        const clean = text.replace(RX_EMOJI, '').trim();
        const n = extractGiftNumber(text);
        return {
            input:       text,
            clean:       clean,
            giftNumber:  n,
            isFollow:    isFollow(text),
            isJoined:    isJoined(text),
            isGiftNorm:  !isGiftSpecial(text) && isGiftNormal(text),
            isGiftSpec:  isGiftSpecial(text),
            specialNums: [...SPECIAL_GIFT_NUMS],
        };
    };

    // ================================================================
    // DEDUPLICACION v18.2
    // ================================================================
    //
    // FIX v18.2 — bug de mensajes repetidos:
    //   Causa: tras un re-render, el nodo vuelve como objeto DOM nuevo.
    //   No está en WeakSet. Si su 'processed' tiene age > RERENDER_WIN → pasa.
    //   Solución: sealCurrentDOM() refresca también los 'processed' de nodos
    //   que SIGUEN visibles en el DOM. Si el nodo sigue ahí no puede ser nuevo.
    //   Cuando el usuario manda el mismo texto de verdad, el nodo viejo ya
    //   desapareció → su ts NO se refresca → expira → PASA correctamente.
    //
    // Tres tipos de entrada en seenKeys:
    //   'sealed'    — estaba en DOM al arrancar. Bloquea re-renders siempre.
    //                 sealCurrentDOM() refresca el ts en cada llamada.
    //   'processed' — fue procesado como mensaje real. NO bloquea chat
    //                 (permite que el mismo usuario repita el mismo texto).
    //                 SI bloquea regalos/follows (evita doble disparo).
    //                 sealCurrentDOM() TAMBIEN refresca ts si el nodo sigue
    //                 visible, evitando re-renders post-regalo que escapan.
    //   'bot'       — usuario de sistema/Tango. Bloquea sin TTL.
    //
    // Re-render del historial (nodo nuevo, mismo texto): sealed → BLOQUEADO
    // Mismo usuario manda mismo texto de nuevo: processed expirado → PASA
    // Bot de Tango repite su mensaje: bot → BLOQUEADO siempre

    const seenKeys = new Map(); // clave → { type: 'sealed'|'processed'|'bot', ts: number }
    const SEEN_TTL    = 4 * 60 * 60 * 1000; // 4h — TTL general
    const GIFT_TTL    = 30_000;              // 30s — bloquea re-render pero permite mismo regalo de nuevo
    const FOLLOW_TTL  = 4 * 60 * 60 * 1000; // follows: no se repiten en sesion
    const JOIN_TTL    = 60_000;              // joined: 60s
    const RERENDER_WIN = 2 * 60 * 1000;     // 2min — ventana de re-render para chat

    // Bots/sistema de Tango — sus mensajes se marcan 'bot' y bloquean sin TTL
    const BOT_USERNAMES = new Set([
        'tango happy hour',
        'tango',
        'tango live',
    ]);
    function isBotUsername(username) {
        if (!username) return false;
        return BOT_USERNAMES.has(username.toLowerCase().trim());
    }

    function makeContentKey(el) {
        // Intentar usar el UUID único de Tango para CUALQUIER tipo de evento
        // data-testid="chat-event-UUID" o "gift-event-UUID" → key permanente e irrepetible
        const eventEl = el.querySelector('[data-testid^="chat-event-"]') ||
                        el.querySelector('[data-testid^="gift-event-"]') ||
                        (el.dataset?.testid?.startsWith('chat-event-') ? el : null) ||
                        (el.dataset?.testid?.startsWith('gift-event-') ? el : null);
        if (eventEl) {
            return 'uuid||' + eventEl.dataset.testid;
        }

        // Fallback: sin UUID → usar contenido como antes
        const extracted = extractNodeText(el);
        if (!extracted) return null;
        const user     = extracted.username || '';
        const text     = extracted.message  || extracted.fullText || '';
        const fullText = extracted.fullText || text;
        if (isFollow(fullText))  return 'follow||' + user + '||' + text;
        if (isJoined(fullText))  return 'joined||' + user + '||' + text;
        const gn = extractGiftNumber(fullText);
        if (gn !== null)         return 'gift||' + user + '||' + String(gn) + '||' + Date.now();
        return 'chat||' + user + '||' + text;
    }

    const processedEls = new WeakSet();

    function isSeen(el) {
        // 1. Referencia exacta de objeto DOM ya procesada
        if (processedEls.has(el)) return true;

        const key = makeContentKey(el);
        if (!key) return false;
        const entry = seenKeys.get(key);
        const age   = entry ? Date.now() - entry.ts : Infinity;

        // 2. UUID de Tango (chat-event o gift-event) → bloquear toda la sesión
        if (key.startsWith('uuid||') && entry && entry.type !== 'bot' && age < SEEN_TTL) return true;

        // 3. Historial sellado → bloquear siempre
        if (entry && entry.type === 'sealed' && age < SEEN_TTL) return true;

        // 4. Bot marcado → bloquear sin TTL
        if (entry && entry.type === 'bot') return true;

        // 5. Chat sin UUID ya procesado hace menos de RERENDER_WIN → es un re-render
        if (key.startsWith('chat||') && entry && entry.type === 'processed' && age < RERENDER_WIN) return true;

        // 6. Follows/joined ya procesados
        if (key.startsWith('follow||') && entry && entry.type === 'processed' && age < FOLLOW_TTL) return true;
        if (key.startsWith('joined||') && entry && entry.type === 'processed' && age < JOIN_TTL) return true;

        return false;
    }

    function markSeen(el) {
        processedEls.add(el);
        const key = makeContentKey(el);
        if (!key) return;
        // Detectar bots del sistema (Tango Happy Hour, etc.) → marcar como 'bot'
        // Los mensajes de bots nunca deben procesarse como mensajes reales nuevos
        const extracted = extractNodeText(el);
        const username  = extracted?.username || '';
        if (isBotUsername(username) || key.startsWith('chat||Tango ') || key.startsWith('chat||tango ')) {
            seenKeys.set(key, { type: 'bot', ts: Date.now() });
            return;
        }
        seenKeys.set(key, { type: 'processed', ts: Date.now() });
    }

    // Limpiar entradas viejas cada 10 min (bots son permanentes)
    setInterval(function() {
        var now = Date.now();
        for (var entry of seenKeys) {
            if (now - entry[1].ts > SEEN_TTL) {
                seenKeys.delete(entry[0]);
            }
        }
    }, 600_000);

        // ================================================================
    // TTS
    // ================================================================
    let ttsQueue     = [];
    let ttsBusy      = false;
    let ttsLastStart = 0;

    function ttsEnqueue(text) {
        if (!text?.trim() || !ENABLED) return;
        ttsQueue.push(text.trim());
        if (ttsQueue.length > 20) ttsQueue = ttsQueue.slice(-20);
        ttsFlush();
    }
    function ttsFlush() {
        if (ttsBusy || !ttsQueue.length || !ENABLED) return;
        const text = ttsQueue.shift();
        const u    = new SpeechSynthesisUtterance(text);
        const v    = getVoice();
        if (v) u.voice = v;
        u.rate  = RATE;
        u.pitch = 1.0;
        ttsBusy      = true;
        ttsLastStart = Date.now();
        u.onend   = () => { ttsBusy = false; ttsLastStart = 0; ttsFlush(); };
        u.onerror = (e) => {
            if (e.error !== 'interrupted') console.warn('TanGhost TTS:', e.error);
            ttsBusy = false; ttsLastStart = 0;
            setTimeout(ttsFlush, 80);
        };
        speechSynthesis.speak(u);
    }
    setInterval(() => {
        if (speechSynthesis.speaking && ttsBusy) {
            const elapsed = ttsLastStart > 0 ? Date.now() - ttsLastStart : 0;
            if (elapsed > 3000) { speechSynthesis.pause(); speechSynthesis.resume(); }
        }
        if (ttsBusy && ttsLastStart > 0 && (Date.now() - ttsLastStart) > 12000) {
            speechSynthesis.cancel(); ttsBusy = false; ttsLastStart = 0;
            setTimeout(ttsFlush, 100);
        }
    }, 5000);

    // ================================================================
    // VOCES
    // ================================================================
    let cachedVoice = null;
    function getVoice() {
        if (SELECTED_VOICE) {
            const v = speechSynthesis.getVoices().find(v => v.name === SELECTED_VOICE);
            if (v) return v;
        }
        if (cachedVoice) return cachedVoice;
        const all = speechSynthesis.getVoices();
        cachedVoice =
            all.find(v => v.name.includes('Google') && v.lang.startsWith('es')) ||
            all.find(v => v.lang.startsWith('es')) ||
            all[0] || null;
        return cachedVoice;
    }
    speechSynthesis.onvoiceschanged = () => { cachedVoice = null; };

    // ================================================================
    // STORAGE
    // ================================================================
    chrome.storage.sync.get(
        ["enabled","voice","rate","filters","obsPort","obsPassword",
         "obsSlots","obsFollowSlots","obsSpecialSlots","obsScene","obsSource","muteTts","gifterConfig"],
        (res) => {
            ENABLED        = res.enabled     ?? true;
            MUTED_TTS      = res.muteTts     ?? false;
            if (res.gifterConfig) GIFTER_CFG = Object.assign({}, GIFTER_CFG, res.gifterConfig);
            SELECTED_VOICE = res.voice       || null;
            RATE           = res.rate        ?? 1.05;
            OBS_PORT       = res.obsPort     || '4455';
            OBS_PASSWORD   = res.obsPassword || '';
            if (res.obsSlots) {
                OBS_SLOTS = res.obsSlots;
            } else if (res.obsScene || res.obsSource) {
                OBS_SLOTS[0] = { scene: res.obsScene || '', source: res.obsSource || '' };
            }
            if (res.obsFollowSlots)  OBS_FOLLOW_SLOTS  = res.obsFollowSlots;
            if (res.obsSpecialSlots) OBS_SPECIAL_SLOTS = res.obsSpecialSlots;
            FILTERS = Object.assign({}, FILTERS, res.filters || {});

            if (FILTERS.obsConnect)        obsGiftConnect();
            if (FILTERS.obsFollowConnect)  obsFollowConnect();
            if (FILTERS.obsSpecialConnect) obsSpecialConnect();
        }
    );

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.enabled !== undefined) {
            ENABLED = changes.enabled.newValue;
            if (!ENABLED) { ttsQueue = []; ttsBusy = false; speechSynthesis.cancel(); }
        }
        if (changes.muteTts !== undefined) {
            MUTED_TTS = changes.muteTts.newValue;
            if (MUTED_TTS) { ttsQueue = []; speechSynthesis.cancel(); ttsBusy = false; ttsLastStart = 0; }
        }
        if (changes.voice          !== undefined) { SELECTED_VOICE = changes.voice.newValue; cachedVoice = null; }
        if (changes.rate           !== undefined)   RATE            = changes.rate.newValue;
        if (changes.obsPort        !== undefined)   OBS_PORT        = changes.obsPort.newValue;
        if (changes.obsPassword    !== undefined)   OBS_PASSWORD    = changes.obsPassword.newValue;
        if (changes.obsSlots       !== undefined)   OBS_SLOTS       = changes.obsSlots.newValue;
        if (changes.obsFollowSlots !== undefined) {
            OBS_FOLLOW_SLOTS = changes.obsFollowSlots.newValue;
            Object.keys(obsFollowItemCache).forEach(k => delete obsFollowItemCache[k]);
        }
        if (changes.obsSpecialSlots !== undefined) {
            OBS_SPECIAL_SLOTS = changes.obsSpecialSlots.newValue;
            Object.keys(obsSpecialItemCache).forEach(k => delete obsSpecialItemCache[k]);
        }
        if (changes.filters !== undefined) {
            const prev    = { ...FILTERS };
            const updated = changes.filters.newValue || {};
            // Actualizar solo los filtros que realmente cambiaron
            Object.keys(updated).forEach(k => { FILTERS[k] = updated[k]; });
            // Conexiones OBS: actuar solo si el flag cambió de verdad
            if (updated.obsConnect        !== undefined && updated.obsConnect        !== prev.obsConnect)        { FILTERS.obsConnect        = updated.obsConnect;        updated.obsConnect        ? obsGiftConnect()    : obsGiftDisconnect();    }
            if (updated.obsFollowConnect  !== undefined && updated.obsFollowConnect  !== prev.obsFollowConnect)  { FILTERS.obsFollowConnect  = updated.obsFollowConnect;  updated.obsFollowConnect  ? obsFollowConnect()  : obsFollowDisconnect();  }
            if (updated.obsSpecialConnect !== undefined && updated.obsSpecialConnect !== prev.obsSpecialConnect) { FILTERS.obsSpecialConnect = updated.obsSpecialConnect; updated.obsSpecialConnect ? obsSpecialConnect() : obsSpecialDisconnect(); }
        }
    });

    // ================================================================
    // AUDIO
    // ================================================================
    let coinAudio = null;
    try { coinAudio = new Audio(chrome.runtime.getURL('audios/coin.mp3')); coinAudio.volume = 0.9; coinAudio.load(); } catch(e) {}
    function playGift() {
        if (!coinAudio) return;
        try { const a = coinAudio.cloneNode(true); a.volume = 0.9; a.play().catch(()=>{}); } catch(e) {}
    }

    let specialAudio = null;
    try { specialAudio = new Audio(chrome.runtime.getURL('audios/special.mp3')); specialAudio.volume = 1.0; specialAudio.load(); } catch(e) {}
    function playSpecial() {
        if (!specialAudio) return;
        try { const a = specialAudio.cloneNode(true); a.volume = 1.0; a.play().catch(()=>{}); } catch(e) {}
    }

    // ================================================================
    // AUTH OBS
    // ================================================================
    async function obsCalcAuth(a, pw) {
        const enc = new TextEncoder();
        const h1  = await crypto.subtle.digest('SHA-256', enc.encode(pw + a.salt));
        const b1  = btoa(String.fromCharCode(...new Uint8Array(h1)));
        const h2  = await crypto.subtle.digest('SHA-256', enc.encode(b1 + a.challenge));
        return btoa(String.fromCharCode(...new Uint8Array(h2)));
    }

    // ================================================================
    // OBS — REGALO (WebSocket independiente)
    // ================================================================
    let obsGiftWs             = null;
    let obsGiftConnected      = false;
    let obsGiftReconnectTimer = null;
    let obsGiftReqId          = 1;
    const obsGiftItemCache    = {};

    function obsGiftConnect() {
        if (obsGiftWs && obsGiftWs.readyState <= 1) return;
        clearTimeout(obsGiftReconnectTimer);
        try { obsGiftWs = new WebSocket('ws://127.0.0.1:' + OBS_PORT); } catch(e) { return; }
        obsGiftWs.onmessage = async (evt) => {
            let msg; try { msg = JSON.parse(evt.data); } catch { return; }
            if (msg.op === 0) {
                const sub = 1 | 512;
                if (msg.d.authentication) {
                    obsGiftSend(1, { rpcVersion:1, eventSubscriptions:sub, authentication: await obsCalcAuth(msg.d.authentication, OBS_PASSWORD) });
                } else {
                    obsGiftSend(1, { rpcVersion:1, eventSubscriptions:sub });
                }
            }
            if (msg.op === 2) { obsGiftConnected = true;  chrome.storage.local.set({ obs_gift_status:'connected' }); }
            if (msg.op === 7) { obsGiftWs.dispatchEvent(new CustomEvent('obs_rg_'+msg.d.requestId, { detail:msg.d })); }
        };
        obsGiftWs.onerror = () => { obsGiftConnected=false; chrome.storage.local.set({ obs_gift_status:'error' }); };
        obsGiftWs.onclose = () => {
            obsGiftConnected=false; chrome.storage.local.set({ obs_gift_status:'disconnected' });
            if (FILTERS.obsConnect) obsGiftReconnectTimer = setTimeout(obsGiftConnect, 5000);
        };
    }
    function obsGiftDisconnect() {
        clearTimeout(obsGiftReconnectTimer);
        if (obsGiftWs) { obsGiftWs.close(); obsGiftWs=null; }
        obsGiftConnected=false;
        chrome.storage.local.set({ obs_gift_status:'disconnected' });
    }
    function obsGiftSend(op, data) {
        if (obsGiftWs?.readyState === 1) obsGiftWs.send(JSON.stringify({ op, d:data }));
    }
    function obsGiftGetItemId(scene, source, cb) {
        const k = (scene||'')+'||'+source;
        if (obsGiftItemCache[k] !== undefined) { cb(obsGiftItemCache[k]); return; }
        const rid = 'rg_'+(obsGiftReqId++);
        obsGiftSend(6, { requestType:'GetSceneItemId', requestId:rid, requestData:{ sceneName:scene||undefined, sourceName:source } });
        const h = (e) => {
            obsGiftItemCache[k] = e.detail?.responseData?.sceneItemId ?? null;
            obsGiftWs?.removeEventListener('obs_rg_'+rid, h);
            cb(obsGiftItemCache[k]);
        };
        obsGiftWs?.addEventListener('obs_rg_'+rid, h);
        setTimeout(() => obsGiftWs?.removeEventListener('obs_rg_'+rid, h), 5000);
    }
    function obsGiftTrigger() {
        if (!obsGiftConnected) return;
        OBS_SLOTS.forEach(slot => {
            if (!slot.source) return;
            obsGiftGetItemId(slot.scene, slot.source, (id) => {
                if (id === null) return;
                const d = { sceneName: slot.scene||undefined, sceneItemId: id };
                obsGiftSend(6, { requestType:'TriggerMediaInputAction', requestId:String(obsGiftReqId++), requestData:{ inputName:slot.source, mediaAction:'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' } });
                obsGiftSend(6, { requestType:'SetSceneItemEnabled', requestId:String(obsGiftReqId++), requestData:{ ...d, sceneItemEnabled:true } });
                let hidden=false;
                function hide() { if(hidden)return; hidden=true; obsGiftSend(6,{requestType:'SetSceneItemEnabled',requestId:String(obsGiftReqId++),requestData:{...d,sceneItemEnabled:false}}); }
                function onEvt(e) { let m; try{m=JSON.parse(e.data);}catch{return;} if(m.op===5&&m.d?.eventType==='MediaInputPlaybackEnded'&&m.d?.eventData?.inputName===slot.source){obsGiftWs?.removeEventListener('message',onEvt);hide();} }
                obsGiftWs?.addEventListener('message',onEvt);
                setTimeout(()=>{obsGiftWs?.removeEventListener('message',onEvt);hide();},30000);
            });
        });
    }

    // ================================================================
    // OBS — SEGUIDOR (WebSocket independiente)
    // ================================================================
    let obsFollowWs             = null;
    let obsFollowConnected      = false;
    let obsFollowReconnectTimer = null;
    let obsFollowReqId          = 1;
    const obsFollowItemCache    = {};

    function obsFollowConnect() {
        if (obsFollowWs && obsFollowWs.readyState <= 1) return;
        clearTimeout(obsFollowReconnectTimer);
        try { obsFollowWs = new WebSocket('ws://127.0.0.1:' + OBS_PORT); } catch(e) { return; }
        obsFollowWs.onmessage = async (evt) => {
            let msg; try { msg = JSON.parse(evt.data); } catch { return; }
            if (msg.op === 0) {
                const sub = 1 | 512;
                if (msg.d.authentication) {
                    obsFollowSend(1, { rpcVersion:1, eventSubscriptions:sub, authentication: await obsCalcAuth(msg.d.authentication, OBS_PASSWORD) });
                } else {
                    obsFollowSend(1, { rpcVersion:1, eventSubscriptions:sub });
                }
            }
            if (msg.op === 2) { obsFollowConnected = true;  chrome.storage.local.set({ obs_follow_status:'connected' }); }
            if (msg.op === 7) { obsFollowWs.dispatchEvent(new CustomEvent('obs_rf_'+msg.d.requestId, { detail:msg.d })); }
        };
        obsFollowWs.onerror = () => { obsFollowConnected=false; chrome.storage.local.set({ obs_follow_status:'error' }); };
        obsFollowWs.onclose = () => {
            obsFollowConnected=false; chrome.storage.local.set({ obs_follow_status:'disconnected' });
            if (FILTERS.obsFollowConnect) obsFollowReconnectTimer = setTimeout(obsFollowConnect, 5000);
        };
    }
    function obsFollowDisconnect() {
        clearTimeout(obsFollowReconnectTimer);
        if (obsFollowWs) { obsFollowWs.close(); obsFollowWs=null; }
        obsFollowConnected=false;
        chrome.storage.local.set({ obs_follow_status:'disconnected' });
    }
    function obsFollowSend(op, data) {
        if (obsFollowWs?.readyState === 1) obsFollowWs.send(JSON.stringify({ op, d:data }));
    }
    function obsFollowGetItemId(scene, source, cb) {
        const k = (scene||'')+'||'+source;
        if (obsFollowItemCache[k] !== undefined) { cb(obsFollowItemCache[k]); return; }
        const rid = 'rf_'+(obsFollowReqId++);
        obsFollowSend(6, { requestType:'GetSceneItemId', requestId:rid, requestData:{ sceneName:scene||undefined, sourceName:source } });
        const h = (e) => {
            obsFollowItemCache[k] = e.detail?.responseData?.sceneItemId ?? null;
            obsFollowWs?.removeEventListener('obs_rf_'+rid, h);
            cb(obsFollowItemCache[k]);
        };
        obsFollowWs?.addEventListener('obs_rf_'+rid, h);
        setTimeout(() => obsFollowWs?.removeEventListener('obs_rf_'+rid, h), 5000);
    }
    function obsFollowTrigger() {
        if (!obsFollowConnected) return;
        console.log('👻 TanGhost: ▶ disparando OBS-Seguidor');
        OBS_FOLLOW_SLOTS.forEach(slot => {
            if (!slot.source) return;
            obsFollowGetItemId(slot.scene, slot.source, (id) => {
                if (id === null) return;
                const d = { sceneName: slot.scene||undefined, sceneItemId: id };
                obsFollowSend(6, { requestType:'TriggerMediaInputAction', requestId:String(obsFollowReqId++), requestData:{ inputName:slot.source, mediaAction:'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' } });
                obsFollowSend(6, { requestType:'SetSceneItemEnabled', requestId:String(obsFollowReqId++), requestData:{ ...d, sceneItemEnabled:true } });
                let hidden=false;
                function hide() { if(hidden)return; hidden=true; obsFollowSend(6,{requestType:'SetSceneItemEnabled',requestId:String(obsFollowReqId++),requestData:{...d,sceneItemEnabled:false}}); }
                function onEvt(e) { let m; try{m=JSON.parse(e.data);}catch{return;} if(m.op===5&&m.d?.eventType==='MediaInputPlaybackEnded'&&m.d?.eventData?.inputName===slot.source){obsFollowWs?.removeEventListener('message',onEvt);hide();} }
                obsFollowWs?.addEventListener('message',onEvt);
                setTimeout(()=>{obsFollowWs?.removeEventListener('message',onEvt);hide();},30000);
            });
        });
    }

    // ================================================================
    // OBS — REGALOS ESPECIALES (WebSocket independiente)
    // ================================================================
    let obsSpecialWs             = null;
    let obsSpecialConnected      = false;
    let obsSpecialReconnectTimer = null;
    let obsSpecialReqId          = 1;
    const obsSpecialItemCache    = {};

    function obsSpecialConnect() {
        if (obsSpecialWs && obsSpecialWs.readyState <= 1) return;
        clearTimeout(obsSpecialReconnectTimer);
        try { obsSpecialWs = new WebSocket('ws://127.0.0.1:' + OBS_PORT); } catch(e) { return; }
        obsSpecialWs.onmessage = async (evt) => {
            let msg; try { msg = JSON.parse(evt.data); } catch { return; }
            if (msg.op === 0) {
                const sub = 1 | 512;
                if (msg.d.authentication) {
                    obsSpecialSend(1, { rpcVersion:1, eventSubscriptions:sub, authentication: await obsCalcAuth(msg.d.authentication, OBS_PASSWORD) });
                } else {
                    obsSpecialSend(1, { rpcVersion:1, eventSubscriptions:sub });
                }
            }
            if (msg.op === 2) { obsSpecialConnected = true;  chrome.storage.local.set({ obs_special_status:'connected' }); }
            if (msg.op === 7) { obsSpecialWs.dispatchEvent(new CustomEvent('obs_rs_'+msg.d.requestId, { detail:msg.d })); }
        };
        obsSpecialWs.onerror = () => { obsSpecialConnected=false; chrome.storage.local.set({ obs_special_status:'error' }); };
        obsSpecialWs.onclose = () => {
            obsSpecialConnected=false; chrome.storage.local.set({ obs_special_status:'disconnected' });
            if (FILTERS.obsSpecialConnect) obsSpecialReconnectTimer = setTimeout(obsSpecialConnect, 5000);
        };
    }
    function obsSpecialDisconnect() {
        clearTimeout(obsSpecialReconnectTimer);
        if (obsSpecialWs) { obsSpecialWs.close(); obsSpecialWs=null; }
        obsSpecialConnected=false;
        chrome.storage.local.set({ obs_special_status:'disconnected' });
    }
    function obsSpecialSend(op, data) {
        if (obsSpecialWs?.readyState === 1) obsSpecialWs.send(JSON.stringify({ op, d:data }));
    }
    function obsSpecialGetItemId(scene, source, cb) {
        const k = (scene||'')+'||'+source;
        if (obsSpecialItemCache[k] !== undefined) { cb(obsSpecialItemCache[k]); return; }
        const rid = 'rs_'+(obsSpecialReqId++);
        obsSpecialSend(6, { requestType:'GetSceneItemId', requestId:rid, requestData:{ sceneName:scene||undefined, sourceName:source } });
        const h = (e) => {
            obsSpecialItemCache[k] = e.detail?.responseData?.sceneItemId ?? null;
            obsSpecialWs?.removeEventListener('obs_rs_'+rid, h);
            cb(obsSpecialItemCache[k]);
        };
        obsSpecialWs?.addEventListener('obs_rs_'+rid, h);
        setTimeout(() => obsSpecialWs?.removeEventListener('obs_rs_'+rid, h), 5000);
    }
    function obsSpecialTrigger() {
        if (!obsSpecialConnected) return;
        OBS_SPECIAL_SLOTS.forEach(slot => {
            if (!slot.source) return;
            obsSpecialGetItemId(slot.scene, slot.source, (id) => {
                if (id === null) return;
                const d = { sceneName: slot.scene||undefined, sceneItemId: id };
                obsSpecialSend(6, { requestType:'TriggerMediaInputAction', requestId:String(obsSpecialReqId++), requestData:{ inputName:slot.source, mediaAction:'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' } });
                obsSpecialSend(6, { requestType:'SetSceneItemEnabled', requestId:String(obsSpecialReqId++), requestData:{ ...d, sceneItemEnabled:true } });
                let hidden=false;
                function hide() { if(hidden)return; hidden=true; obsSpecialSend(6,{requestType:'SetSceneItemEnabled',requestId:String(obsSpecialReqId++),requestData:{...d,sceneItemEnabled:false}}); }
                function onEvt(e) { let m; try{m=JSON.parse(e.data);}catch{return;} if(m.op===5&&m.d?.eventType==='MediaInputPlaybackEnded'&&m.d?.eventData?.inputName===slot.source){obsSpecialWs?.removeEventListener('message',onEvt);hide();} }
                obsSpecialWs?.addEventListener('message',onEvt);
                setTimeout(()=>{obsSpecialWs?.removeEventListener('message',onEvt);hide();},30000);
            });
        });
    }

    // ================================================================
    // FILTROS DE TEXTO
    // ================================================================
    const RX_URL = /https?:\/\/\S+|www\.\S+/gi;
    const RX_NUM = /\d[\d.,]*/g;

    function stripEmojis(str) {
        return (str || '').replace(RX_EMOJI, '').replace(/\s{2,}/g, ' ').trim();
    }
    function filterText(message, username, joined) {
        if (joined && !FILTERS.readJoined) return null;
        let cleanText = stripEmojis(message);
        let cleanUser = stripEmojis(username);
        if (!FILTERS.readAllCaps) {
            const letters = cleanText.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g,'');
            if (letters.length >= 2 && letters === letters.toUpperCase()) return null;
        }
        if (!FILTERS.readShort) {
            if (cleanText.replace(/\s/g,'').length <= 3) return null;
        }
        let out = cleanText;
        if (!FILTERS.readLinks)   out = out.replace(RX_URL,'');
        if (!FILTERS.readNumbers) out = out.replace(RX_NUM,'');
        out = out.replace(/\s{2,}/g,' ').trim();
        if (!out) return null;
        if (FILTERS.readUsername && cleanUser) out = cleanUser + ': ' + out;
        return out;
    }

    // ================================================================
    // PROCESAR NODO — lógica de v10 (usa fullText para detección)
    // ================================================================
    function processNode(el) {
        if (!el || isSeen(el)) return;
        markSeen(el);

        const extracted = extractNodeText(el);
        if (!extracted) return;
        const { username, message, fullText } = extracted;
        if (!fullText) return;

        // Detectar usando fullText — número al final = candidato a regalo
        const follow  = isFollow(fullText);
        const joined  = isJoined(fullText);
        let   giftNum = (!follow && !joined) ? extractGiftNumber(fullText) : null;

        // ── VALIDACIÓN: confirmar que es un regalo legítimo de Tango ──
        // Un regalo real siempre tiene data-testid="gift-event-UUID" en el DOM.
        // Si el nodo tiene número al final pero NO tiene gift-event, es un
        // mensaje de texto normal que casualmente termina en número → ignorar como regalo.
        if (giftNum !== null) {
            const hasGiftNode = !!el.querySelector('[data-testid^="gift-event-"]');
            if (!hasGiftNode) {
                console.log('👻 TanGhost: número al final pero sin gift-event → tratando como chat normal |', fullText.substring(0,50));
                giftNum = null; // no es regalo
            }
        }
        const special = giftNum !== null && SPECIAL_GIFT_NUMS.has(giftNum);
        const gift    = giftNum !== null && !special;

        // ── TIMER: solo mensajes REALES de chat (no joined, follow ni regalo) ──
        // El timer es SOLO visual — no tiene ninguna relación con los disparos de OBS.
        if (!joined && !follow && giftNum === null) timerStart();

        // ── OBS / SONIDOS: se disparan SIEMPRE que haya número al final ──
        if (follow) {
            console.log('👻 TanGhost: SEGUIDOR |', fullText.substring(0,50));
            diagLog(fullText.substring(0,60), 'follow', '');
            if (FILTERS.obsFollowConnect) obsFollowTrigger();
        }
        if (special) {
            if (isBotUsername(username)) {
                sealCurrentDOM();
                setTimeout(sealCurrentDOM, 300);
            } else {
                console.log('👻 TanGhost: REGALO ESPECIAL |', fullText.substring(0,50), '→', giftNum);
                diagLog(fullText.substring(0,60), 'special', 'Núm especial: ' + giftNum);
                sealCurrentDOM();
                setTimeout(sealCurrentDOM, 300);
                playSpecial();
                if (FILTERS.obsSpecialConnect) obsSpecialTrigger();
                gifterOverlayEvent(username, giftNum);
                chrome.storage.local.get(['gifterDonors'], (r) => {
                    const donors = r.gifterDonors || {};
                    const key    = username.toLowerCase();
                    donors[key]  = { username, coins: (donors[key]?.coins || 0) + giftNum, lastTs: Date.now() };
                    chrome.storage.local.set({ gifterDonors: donors });
                });
            }
        }
        if (gift) {
            // FIX v18.5: ignorar regalos de bots del sistema (Tango Happy Hour, etc.)
            // Sus "regalos" son notificaciones del sistema, no donaciones reales.
            if (isBotUsername(username)) {
                sealCurrentDOM();
                setTimeout(sealCurrentDOM, 300);
                // No disparar sonido, OBS ni gifter overlay para bots
            } else {
                console.log('👻 TanGhost: REGALO |', fullText.substring(0,50), '→', giftNum);
                diagLog(fullText.substring(0,60), 'gift', 'Núm: ' + giftNum);
                sealCurrentDOM();
                setTimeout(sealCurrentDOM, 300);
                if (FILTERS.giftSound) playGift();
                if (FILTERS.obsConnect) obsGiftTrigger();
                gifterOverlayEvent(username, giftNum);
                chrome.storage.local.get(['gifterDonors'], (r) => {
                    const donors = r.gifterDonors || {};
                    const key    = username.toLowerCase();
                    donors[key]  = { username, coins: (donors[key]?.coins || 0) + giftNum, lastTs: Date.now() };
                    chrome.storage.local.set({ gifterDonors: donors });
                });
            }
        }

        // FIX v18.3: bots del sistema (Tango Happy Hour, etc.) → no TTS,
        // pero SÍ aparecen en overlays (una sola vez, markSeen los bloquea).
        if (isBotUsername(username)) {
            // Solo enviar a overlays — sin voz
            if (!joined && !follow && giftNum === null && username) {
                pokemonChatEvent(username, message || fullText);
                chatOverlayEvent(username, message || fullText);
            }
            return;
        }

        // Para TTS: usar message (texto limpio sin nombre) con fallback a fullText
        // Si TTS está muteado (MUTED_TTS), se omite la voz pero todo lo demás funciona
        if (!MUTED_TTS) {
            const out = filterText(message || fullText, username, joined);
            if (out) ttsEnqueue(out);
        }

        // ============================================================
        // OVERLAY PERSONAJES — emitir evento por cada mensaje real de chat
        // ============================================================
        if (!joined && !follow && giftNum === null && username) {
            pokemonChatEvent(username, message || fullText);
            chatOverlayEvent(username, message || fullText);
        }
    }

    // ================================================================
    // POKEMON CHAT EVENT — comunica con el overlay de OBS
    // Estrategia: WebSocket cliente → servidor local en puerto 7331
    // ================================================================
    let pokeWs = null;
    let pokeWsReconnectTimer = null;
    let POKE_CFG = {
        pokeEnabled:    true,
        pokeTime:       120,           // segundos (2 min por defecto, máx 300)
        pokeSpeed:      2.2,
        pokeMax:        8,
        pokeSize:       128,
        pokeFontFamily: 'Press Start 2P',
        pokeFontSize:   13,
    };

    // Cargar config al iniciar
    chrome.storage.sync.get(['pokeConfig'], (res) => {
        if (res.pokeConfig) POKE_CFG = Object.assign({}, POKE_CFG, res.pokeConfig);
    });
    // Escuchar cambios en tiempo real
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.pokeConfig) POKE_CFG = Object.assign({}, POKE_CFG, changes.pokeConfig.newValue);
    });

    function pokeWsConnect() {
        if (pokeWs && pokeWs.readyState <= 1) return;
        clearTimeout(pokeWsReconnectTimer);
        try {
            pokeWs = new WebSocket('ws://localhost:7331');
            pokeWs.onopen  = () => console.log('👻 TanGhost Pokemon WS: conectado');
            pokeWs.onclose = () => { pokeWs = null; pokeWsReconnectTimer = setTimeout(pokeWsConnect, 4000); };
            pokeWs.onerror = () => { try { pokeWs.close(); } catch(e){} };
        } catch(e) {
            pokeWsReconnectTimer = setTimeout(pokeWsConnect, 4000);
        }
    }
    pokeWsConnect();

    // ================================================================
    // CHAT OVERLAY — WebSocket hacia chat-server.js (puerto 7332)
    // Envía cada mensaje real del chat a la ventana de OBS
    // ================================================================
    let chatWs = null;
    let chatWsReconnectTimer = null;
    let CHAT_OVERLAY_ENABLED = false;
    let CHAT_CFG = {
        chatTheme:      'dark',
        chatPosition:   'bottom',
        chatTime:       12,
        chatMax:        12,
        chatFontFamily: 'Segoe UI, Arial, sans-serif',
        chatFontSize:   13,
        chatWidth:      400,
        chatOpacity:    72,
    };

    // Cargar estado y config guardados
    chrome.storage.local.get(['chatOverlayEnabled'], (r) => {
        CHAT_OVERLAY_ENABLED = !!r.chatOverlayEnabled;
        if (CHAT_OVERLAY_ENABLED) chatWsConnect();
    });
    chrome.storage.sync.get(['chatConfig'], (r) => {
        if (r.chatConfig) CHAT_CFG = Object.assign({}, CHAT_CFG, r.chatConfig);
    });

    // Escuchar cambios desde el popup
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.chatOverlayEnabled !== undefined) {
            const en = changes.chatOverlayEnabled.newValue;
            if (en && !CHAT_OVERLAY_ENABLED) { CHAT_OVERLAY_ENABLED = true;  chatWsConnect(); }
            if (!en && CHAT_OVERLAY_ENABLED) { CHAT_OVERLAY_ENABLED = false; chatWsDisconnect(); }
        }
        if (changes.chatConfig !== undefined) {
            CHAT_CFG = Object.assign({}, CHAT_CFG, changes.chatConfig.newValue);
        }
    });

    function chatWsConnect() {
        if (chatWs && chatWs.readyState <= 1) return;
        clearTimeout(chatWsReconnectTimer);
        try {
            chatWs = new WebSocket('ws://localhost:7332/emit');
            chatWs.onopen  = () => {
                console.log('👻 TanGhost Chat WS: conectado');
                chrome.storage.local.set({ chat_overlay_status: 'connected' });
            };
            chatWs.onclose = () => {
                chatWs = null;
                chrome.storage.local.set({ chat_overlay_status: 'disconnected' });
                if (CHAT_OVERLAY_ENABLED) chatWsReconnectTimer = setTimeout(chatWsConnect, 4000);
            };
            chatWs.onerror = () => {
                chrome.storage.local.set({ chat_overlay_status: 'error' });
                try { chatWs.close(); } catch(e) {}
            };
        } catch(e) {
            chatWsReconnectTimer = setTimeout(chatWsConnect, 4000);
        }
    }

    function chatWsDisconnect() {
        clearTimeout(chatWsReconnectTimer);
        if (chatWs) { chatWs.close(); chatWs = null; }
        chrome.storage.local.set({ chat_overlay_status: 'disconnected' });
    }

    function chatOverlayEvent(username, message) {
        if (!CHAT_OVERLAY_ENABLED) return;
        if (!chatWs || chatWs.readyState !== WebSocket.OPEN) return;
        try {
            chatWs.send(JSON.stringify({
                type:     'tg_chat',
                username: username,
                message:  message,
                ts:       Date.now(),
                cfg:      CHAT_CFG,
            }));
        } catch(e) {}
    }

    // ================================================================
    // GIFTER OVERLAY — WebSocket hacia gifter-server.js (puerto 7333)
    // Envía cada regalo al servidor que calcula el top gifter acumulado
    // ================================================================
    let gifterWs = null;
    let gifterWsReconnectTimer = null;
    let GIFTER_OVERLAY_ENABLED = false;
    let GIFTER_CFG = {
        gifterTheme:    'gold',
        gifterFont:     'Orbitron, monospace',
        gifterFontSize: 22,
        gifterWidth:    280,
        gifterPosition: 'bottom-left',
        gifterAnimTime: 0,
    };

    chrome.storage.local.get(['gifterOverlayEnabled'], (r) => {
        GIFTER_OVERLAY_ENABLED = !!r.gifterOverlayEnabled;
        if (GIFTER_OVERLAY_ENABLED) gifterWsConnect();
    });
    chrome.storage.sync.get(['gifterConfig'], (r) => {
        if (r.gifterConfig) GIFTER_CFG = Object.assign({}, GIFTER_CFG, r.gifterConfig);
    });
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.gifterOverlayEnabled !== undefined) {
            const en = changes.gifterOverlayEnabled.newValue;
            if (en  && !GIFTER_OVERLAY_ENABLED) { GIFTER_OVERLAY_ENABLED = true;  gifterWsConnect(); }
            if (!en &&  GIFTER_OVERLAY_ENABLED) { GIFTER_OVERLAY_ENABLED = false; gifterWsDisconnect(); }
        }
        if (changes.gifterConfig !== undefined) {
            GIFTER_CFG = Object.assign({}, GIFTER_CFG, changes.gifterConfig.newValue);
            // Enviar la nueva config al overlay inmediatamente sin esperar un regalo
            if (gifterWs && gifterWs.readyState === WebSocket.OPEN) {
                try {
                    gifterWs.send(JSON.stringify({ type: 'tg_cfg', cfg: GIFTER_CFG }));
                } catch(e) {}
            }
        }
    });

    function gifterWsConnect() {
        if (gifterWs && gifterWs.readyState <= 1) return;
        clearTimeout(gifterWsReconnectTimer);
        try {
            gifterWs = new WebSocket('ws://localhost:7333/emit-gifter');
            gifterWs.onopen  = () => {
                console.log('👻 TanGhost Gifter WS: conectado');
                chrome.storage.local.set({ gifter_overlay_status: 'connected' });
            };
            gifterWs.onclose = () => {
                gifterWs = null;
                chrome.storage.local.set({ gifter_overlay_status: 'disconnected' });
                if (GIFTER_OVERLAY_ENABLED) gifterWsReconnectTimer = setTimeout(gifterWsConnect, 4000);
            };
            gifterWs.onerror = () => {
                chrome.storage.local.set({ gifter_overlay_status: 'error' });
                try { gifterWs.close(); } catch(e) {}
            };
        } catch(e) {
            gifterWsReconnectTimer = setTimeout(gifterWsConnect, 4000);
        }
    }

    function gifterWsDisconnect() {
        clearTimeout(gifterWsReconnectTimer);
        if (gifterWs) { gifterWs.close(); gifterWs = null; }
        chrome.storage.local.set({ gifter_overlay_status: 'disconnected' });
    }

    function gifterOverlayEvent(username, coins) {
        if (!GIFTER_OVERLAY_ENABLED) return;
        if (!gifterWs || gifterWs.readyState !== WebSocket.OPEN) return;
        try {
            gifterWs.send(JSON.stringify({
                type:     'tg_gift',
                username: username,
                coins:    coins,
                ts:       Date.now(),
                cfg:      GIFTER_CFG,
            }));
        } catch(e) {}
    }

    // Un solo evento — el overlay decide qué mostrar según pokeTheme
    function pokemonChatEvent(username, message) {
        if (!POKE_CFG.pokeEnabled) return;
        const payload = JSON.stringify({
            type: 'tg_pokemon_chat',
            username: username,
            message: message,
            ts: Date.now(),
            cfg: POKE_CFG,
        });
        if (pokeWs && pokeWs.readyState === WebSocket.OPEN) {
            try { pokeWs.send(payload); } catch(e) {}
        }
        try {
            const bc = new BroadcastChannel('tg_pokemon');
            bc.postMessage({ username, message, ts: Date.now(), cfg: POKE_CFG });
            bc.close();
        } catch(e) { /* no disponible */ }
    }

    // ================================================================
    // MENSAJES MANUALES DESDE EL POPUP (corrección de donadores)
    // ================================================================
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg.type === 'tg_manual_gift' && msg.username && msg.coins) {
            gifterOverlayEvent(msg.username, msg.coins);
        }
        // Aplicar config en tiempo real desde el botón "Guardar y aplicar"
        if (msg.type === 'tg_push_cfg' && msg.cfg) {
            GIFTER_CFG = Object.assign({}, GIFTER_CFG, msg.cfg);
            if (gifterWs && gifterWs.readyState === WebSocket.OPEN) {
                try {
                    gifterWs.send(JSON.stringify({ type: 'tg_cfg', cfg: GIFTER_CFG }));
                    sendResponse({ ok: true });
                } catch(e) {
                    sendResponse({ ok: false });
                }
            } else {
                sendResponse({ ok: false });
            }
            return true; // respuesta asíncrona
        }
    });

    // ================================================================
    // SCROLL — sellar historial cuando el usuario sube la barra del chat
    // ================================================================
    // Cuando se hace scroll hacia arriba, Tango puede cargar mensajes
    // antiguos en el DOM. Detectamos el movimiento y sellamos inmediatamente
    // + dos veces más con delay para cubrir la carga diferida de Tango.
    let   scrollContainer   = null;
    let   lastScrollTop     = 0;
    let   scrollSealTimer1  = null;
    let   scrollSealTimer2  = null;

    function findScrollContainer() {
        // Buscar el ancestro scrolleable más cercano de los nodos del chat
        const el = document.querySelector(SEL_ROOT) || document.querySelector(SEL_INIT);
        if (!el) return null;
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
            const style = getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') return parent;
            parent = parent.parentElement;
        }
        return null;
    }

    function attachScrollListener() {
        const container = findScrollContainer();
        if (!container || container === scrollContainer) return;
        if (scrollContainer) scrollContainer.removeEventListener('scroll', onChatScroll);
        scrollContainer = container;
        lastScrollTop   = container.scrollTop;
        container.addEventListener('scroll', onChatScroll, { passive: true });
        console.log('👻 TanGhost: scroll listener activo en', container.className || container.tagName);
    }

    function onChatScroll() {
        const st = scrollContainer.scrollTop;
        if (st < lastScrollTop) {
            // Usuario scrolleó hacia ARRIBA — Tango puede insertar nodos viejos
            // Sellar ahora mismo
            sealCurrentDOM();
            // Y también con delay para capturar carga diferida de Tango
            clearTimeout(scrollSealTimer1);
            clearTimeout(scrollSealTimer2);
            scrollSealTimer1 = setTimeout(sealCurrentDOM, 250);
            scrollSealTimer2 = setTimeout(sealCurrentDOM, 600);
        }
        lastScrollTop = st;
    }

    // ================================================================
    // OBSERVER
    // ================================================================
    let observer       = null;
    let observerTarget = null;

    function handleNode(node) {
        if (node.nodeType !== 1) return;
        // Ignorar hijos internos de SEL_ROOT — el padre ya fue o será procesado
        if (node.closest?.(SEL_ROOT) && !node.matches?.(SEL_ROOT)) return;
        if (node.matches?.(SEL_ROOT)) { processNode(node); return; }
        const children = node.querySelectorAll?.(SEL_ROOT);
        if (children?.length) { children.forEach(processNode); return; }
        if (node.matches?.(SEL_INIT)) { processNode(node); return; }
        node.querySelectorAll?.(SEL_INIT)?.forEach(processNode);
    }

    // Marca todos los nodos actuales del DOM como historial — no se procesaran.
    // DUAL: marca tanto el WeakSet (referencia exacta) como seenKeys con
    // sealed:true para sobrevivir re-renders donde Tango recrea los nodos
    // como nuevos objetos DOM pero con el mismo texto.
    //
    // Re-render (objeto nuevo, mismo texto):
    //   - No esta en WeakSet → pero SI en seenKeys con sealed:true → BLOQUEADO ✓
    //
    // Mismo usuario manda mismo texto de nuevo (mensaje real nuevo):
    //   - No esta en WeakSet (objeto nuevo)
    //   - En seenKeys con sealed:false (fue procesado antes, no sellado)
    //   - isSeen() solo bloquea si sealed:true → PASA ✓
    function sealCurrentDOM() {
        // Sellar el DOM actual: marcar cada nodo visible como historial.
        // IMPORTANTE: SIEMPRE refrescar el ts de claves ya selladas.
        // Esto evita que el sello expire (TTL 4h) mientras la sesion sigue
        // activa. Si no se refresca, despues de 4h el sello vence y el
        // re-render pasa como nuevo.
        // Las claves 'processed' (mensajes reales ya leidos) NO se pisan
        // — un mensaje que ya fue leido no se convierte en sellado.
        var count = 0;
        var now = Date.now();

        function sealEl(el) {
            processedEls.add(el);
            var key = makeContentKey(el);
            if (!key) return;
            var existing = seenKeys.get(key);
            if (!existing) {
                // Nodo nuevo en DOM que nunca fue procesado → sellar
                seenKeys.set(key, { type: 'sealed', ts: now });
            } else if (existing.type === 'sealed') {
                // Refrescar ts — critico para que el sello no expire en sesiones largas
                existing.ts = now;
            } else if (existing.type === 'processed') {
                // FIX v18.2: el nodo sigue VISIBLE en el DOM ahora mismo.
                // Si tuviera age > RERENDER_WIN ya habría escapado el filtro.
                // Refrescar ts para que no escape en el proximo re-render.
                // Cuando el usuario manda el MISMO texto de verdad, el nodo viejo
                // ya no estará en el DOM → no llega aquí → ts no se refresca → expira → PASA.
                existing.ts = now;
            }
            // 'bot' no se toca — bloquea sin TTL para siempre
            count++;
        }

        document.querySelectorAll(SEL_ROOT).forEach(sealEl);
        document.querySelectorAll(SEL_INIT).forEach(sealEl);
        console.log('👻 TanGhost: DOM sellado (' + count + ' nodos, ' + seenKeys.size + ' claves)');
    }

    function createObserver(target) {
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            if (!ENABLED) return;
            for (const m of mutations)
                for (const node of m.addedNodes) handleNode(node);
        });
        observer.observe(target, { childList:true, subtree:true });
        observerTarget = target;
        console.log('👻 TanGhost Observer ON');
    }

    function ensureObserver() {
        const targetDead = observerTarget && !document.contains(observerTarget);
        if (!observer || targetDead) {
            // El observer murio (probablemente por throttling del navegador).
            // Sellar el DOM actual antes de reconectar para no repetir nada.
            sealCurrentDOM();
            createObserver(document.body);
        }
        // Reenganche del scroll si Tango recreó el contenedor del chat
        attachScrollListener();
        if (ttsBusy && ttsLastStart > 0 && (Date.now() - ttsLastStart) > 15000) {
            speechSynthesis.cancel(); ttsBusy=false; ttsLastStart=0;
            setTimeout(ttsFlush, 200);
        }
    }

    function scanAll() {
        if (!ENABLED) return;
        document.querySelectorAll(SEL_ROOT).forEach(processNode);
        document.querySelectorAll(SEL_INIT).forEach(processNode);
    }

    // Notificar tiempo restante al popup cada segundo
    setInterval(() => {
        if (!timerStarted || !timerEnd) return;
        chrome.storage.local.set({ timerRemaining: Math.max(0, timerEnd - Date.now()) });
    }, 1000);

    // Espera a que el contenedor del chat exista en el DOM antes de arrancar.
    // PROBLEMA: Tango es SPA. Cuando la extension carga, el chat (.Pna2H)
    // todavia no existe → sealCurrentDOM() sella 0 nodos → el historial
    // completo llega despues como addedNodes → se lee todo como nuevo.
    // SOLUCION: esperar activamente con un MutationObserver temporal hasta
    // que aparezca el primer nodo .Pna2H. Cuando aparece, sellar el DOM
    // (incluyendo ese nodo y los demas que ya existan) y LUEGO iniciar el
    // observer real. Asi el historial queda sellado antes de que el observer
    // empiece a procesar addedNodes.
    function waitForChatAndStart() {
        if (!document.body) { setTimeout(waitForChatAndStart, 200); return; }
        speechSynthesis.cancel();

        // Si el chat ya esta en el DOM, arrancar directamente
        if (document.querySelector(SEL_ROOT)) {
            console.log('👻 TanGhost: chat ya presente, arrancando');
            sealCurrentDOM();
            createObserver(document.body);
            attachScrollListener();
            console.log('👻 TanGhost v18.6 listo');
            return;
        }

        // El chat no esta todavia — esperar con un observer temporal
        console.log('👻 TanGhost: esperando que cargue el chat...');
        var waitObs = new MutationObserver(function(mutations) {
            // Revisar si ya aparecio algun nodo del chat
            var chatReady = document.querySelector(SEL_ROOT) ||
                            document.querySelector(SEL_INIT);
            if (!chatReady) return;

            // Chat detectado — dar un tick para que Tango termine de renderizar
            // el historial inicial antes de sellar
            waitObs.disconnect();
            setTimeout(function() {
                console.log('👻 TanGhost: chat detectado, sellando historial...');
                sealCurrentDOM();
                createObserver(document.body);
                attachScrollListener();
                console.log('👻 TanGhost v18.6 listo');
            }, 150);
        });
        waitObs.observe(document.body, { childList: true, subtree: true });

        // Fallback: si en 8 segundos el chat no aparecio, arrancar igual
        setTimeout(function() {
            if (waitObs) { try { waitObs.disconnect(); } catch(e) {} }
            if (document.querySelector(SEL_ROOT)) {
                sealCurrentDOM();
            }
            createObserver(document.body);
            console.log('👻 TanGhost v18.6 listo (fallback)');
        }, 8000);
    }

    function start() {
        waitForChatAndStart();
    }


    // ================================================================
    // DIAGNÓSTICO — escuchar comandos del popup
    // ================================================================
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === 'tg_timer_reset') {
            timerStarted = false;
            timerEnd     = null;
            console.log('👻 TanGhost: timer reiniciado');
            return;
        }
        if (msg?.type === 'tg_force_trigger') {
            try {
                if (msg.channel === 'gift') {
                    console.log('👻 TanGhost: ⚡ DISPARO FORZADO → OBS-REGALO');
                    if (FILTERS.giftSound) playGift();
                    if (FILTERS.obsConnect) obsGiftTrigger();
                }
                if (msg.channel === 'special') {
                    console.log('👻 TanGhost: ⚡ DISPARO FORZADO → OBS-ESPECIAL');
                    playSpecial();
                    if (FILTERS.obsSpecialConnect) obsSpecialTrigger();
                }
                if (msg.channel === 'follow') {
                    console.log('👻 TanGhost: ⚡ DISPARO FORZADO → OBS-SEGUIDOR');
                    if (FILTERS.obsFollowConnect) obsFollowTrigger();
                }
                // Aplicar config al overlay sin afectar ranking ni donadores
                if (msg.channel === 'gifter_cfg') {
                    chrome.storage.sync.get(['gifterConfig'], (r) => {
                        if (r.gifterConfig) {
                            GIFTER_CFG = Object.assign({}, GIFTER_CFG, r.gifterConfig);
                        }
                        if (gifterWs && gifterWs.readyState === WebSocket.OPEN) {
                            try {
                                gifterWs.send(JSON.stringify({ type: 'tg_cfg', cfg: GIFTER_CFG }));
                                console.log('👻 TanGhost: config enviada al overlay gifter');
                                sendResponse({ ok: true });
                            } catch(e) {
                                sendResponse({ ok: false });
                            }
                        } else {
                            sendResponse({ ok: false });
                        }
                    });
                    return true; // respuesta asíncrona
                }
                sendResponse({ ok: true });
            } catch(e) {
                sendResponse({ ok: false, err: String(e) });
            }
            return true;
        }
    });

    // Notificar detecciones al popup via storage para el log de diagnóstico
    function diagLog(text, type, detail) {
        chrome.storage.local.set({ tg_diag_event: { text, type, detail, ts: Date.now() } });
    }



    start();
    setInterval(ensureObserver, 2000);
    // Refrescar sellos del historial cada 30s para que no expiren
    // aunque la sesion dure horas. Sin esto, a las 4h los sellos vencen
    // y el re-render del historial pasa como nuevo.
    setInterval(sealCurrentDOM, 30000);

    // Cuando la pestana vuelve de inactividad/throttling:
    // 1. Cancelar TTS pendiente (puede haber quedado colgado)
    // 2. Sellar el DOM actual para no repetir mensajes viejos
    // 3. Reconectar el observer si murio
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            if (ttsBusy) { speechSynthesis.cancel(); ttsBusy=false; ttsLastStart=0; ttsQueue=[]; }
            sealCurrentDOM();
            ensureObserver();
            console.log('👻 TanGhost: pestana visible — DOM sellado');
        }
    });

    // Igual para el evento freeze/resume que algunos navegadores usan
    // en lugar de visibilitychange para el throttling agresivo
    document.addEventListener('resume', () => {
        sealCurrentDOM();
        ensureObserver();
    });

})();
