document.addEventListener("DOMContentLoaded", () => {

// ════════════════════════════════════════════════
// 🔑 SISTEMA DE LICENCIAS FIREBASE
// ════════════════════════════════════════════════
(function initLicenseUI() {
    const licScreen    = document.getElementById("licenseScreen");
    const mainContainer= document.getElementById("mainContainer");
    const serialInput  = document.getElementById("serialInput");
    const activateBtn  = document.getElementById("licActivateBtn");
    const licMsg       = document.getElementById("licMsg");
    const licBadge     = document.getElementById("licBadge");

    function showMsg(text, type) {
        licMsg.textContent = text;
        licMsg.className   = type; // "error" | "success" | "loading"
    }

    function showMain(licData) {
        licScreen.classList.add("hidden");
        mainContainer.style.display = "block";
        // Mostrar badge con el plan
        if (licBadge) {
            const plan = (licData && licData.plan) ? licData.plan.toUpperCase() : "PRO";
            licBadge.textContent = "✓ " + plan;
            licBadge.classList.add("visible");
        }
    }

    function showLicScreen(errorMsg) {
        licScreen.classList.remove("hidden");
        mainContainer.style.display = "none";
        if (errorMsg && errorMsg !== "no_serial") {
            showMsg(errorMsg, "error");
        }
    }

    // Botón desactivar (desde badge en header)
    if (licBadge) {
        licBadge.addEventListener("click", async () => {
            if (!confirm("¿Desactivar licencia en este dispositivo?")) return;
            await window.TGLicense.deactivate();
            showLicScreen("Licencia desvinculada. Ingresa tu serial de nuevo.");
            if (licBadge) licBadge.classList.remove("visible");
        });
    }

    // Botón activar
    activateBtn.addEventListener("click", async () => {
        const serial = serialInput.value.trim();
        if (!serial) { showMsg("Ingresa el código de serial.", "error"); return; }
        activateBtn.disabled = true;
        showMsg("Verificando...", "loading");
        const result = await window.TGLicense.verify(serial);
        if (result.ok) {
            showMsg("✓ Licencia activada correctamente.", "success");
            setTimeout(() => showMain(result.data), 800);
        } else {
            showMsg(result.error || "Error desconocido.", "error");
            activateBtn.disabled = false;
        }
    });

    // Enter en el input
    serialInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") activateBtn.click();
    });

    // Auto-formato: mayúsculas mientras escribe
    serialInput.addEventListener("input", () => {
        serialInput.value = serialInput.value.toUpperCase();
    });

    // ── Verificar licencia guardada al abrir ──
    window.TGLicense.init(
        (res) => showMain(res.data),   // licencia válida
        (err) => showLicScreen(err)    // sin licencia / error
    );
})();


    // ── Elementos principales ──
    const toggle     = document.getElementById("toggle");
    const voiceSel   = document.getElementById("voiceSelect");
    const rateSlider = document.getElementById("rateSlider");
    const rateVal    = document.getElementById("rateValue");
    const statusDot  = document.getElementById("statusDot");
    const statusTxt  = document.getElementById("statusText");
    const timerEl    = document.getElementById("timerDisplay");

    const obsPortEl  = document.getElementById("obsPort");
    const obsPassEl  = document.getElementById("obsPassword");

    // LEDs
    const obsGiftLed    = document.getElementById("obsGiftLed");
    const obsGiftTxt    = document.getElementById("obsGiftTxt");
    const obsFollowLed  = document.getElementById("obsFollowLed");
    const obsFollowTxt  = document.getElementById("obsFollowTxt");
    const obsSpecialLed = document.getElementById("obsSpecialLed");
    const obsSpecialTxt = document.getElementById("obsSpecialTxt");

    // Slots
    let obsSlots = [
        { scene:'', source:'' },{ scene:'', source:'' },{ scene:'', source:'' },
    ];
    let obsFollowSlots = [
        { scene:'', source:'' },{ scene:'', source:'' },{ scene:'', source:'' },
    ];
    let obsSpecialSlots = [
        { scene:'', source:'' },{ scene:'', source:'' },{ scene:'', source:'' },
    ];

    // ── Defaults filtros ──
    const DEFAULTS = {
        readEmojis: true, readLinks: true, readNumbers: true,
        readAllCaps: true, readShort: true, readUsername: true,
        giftSound: true, readJoined: true,
        obsConnect: false, obsFollowConnect: false, obsSpecialConnect: false,
    };

    const COLOR_CLASS = {
        cyan: 'active', purple: 'active-purple', orange: 'active-orange',
        red: 'active-red', gold: 'active-gold',
    };

    let filters = Object.assign({}, DEFAULTS);

    // ── LOAD ──
    chrome.storage.sync.get(
        ["enabled","voice","rate","filters","obsPort","obsPassword","obsSlots","obsFollowSlots","obsSpecialSlots","obsScene","obsSource","muteTts"],
        (res) => {
            toggle.checked = res.enabled ?? true;
            updateStatus(toggle.checked);

            const r = res.rate ?? 1.05;
            rateSlider.value = r;
            rateVal.textContent = parseFloat(r).toFixed(2);

            loadVoices(res.voice);

            filters = Object.assign({}, DEFAULTS, res.filters || {});
            renderBtns();
            updateMuteBtn(!!res.muteTts);

            obsPortEl.value = res.obsPort     || '4455';
            obsPassEl.value = res.obsPassword || '';

            if (res.obsSlots) {
                obsSlots = res.obsSlots;
            } else if (res.obsScene || res.obsSource) {
                obsSlots[0] = { scene: res.obsScene || '', source: res.obsSource || '' };
            }
            if (res.obsFollowSlots)  obsFollowSlots  = res.obsFollowSlots;
            if (res.obsSpecialSlots) obsSpecialSlots = res.obsSpecialSlots;

            renderSlots();
            renderFollowSlots();
            renderSpecialSlots();
        }
    );

    // ── TIMER — leer y actualizar ──
    function fmtTimer(ms) {
        if (ms <= 0) return '00:00:00';
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    }

    function updateTimerDisplay(remaining) {
        if (remaining === undefined || remaining === null) {
            timerEl.className = 'timer-value waiting';
            timerEl.textContent = 'EN ESPERA...';
        } else if (remaining <= 0) {
            timerEl.className = 'timer-value expired';
            timerEl.textContent = '00:00:00';
        } else {
            timerEl.className = 'timer-value';
            timerEl.textContent = fmtTimer(remaining);
        }
    }

    // Leer estado inicial del timer
    chrome.storage.local.get(['timerRemaining','timerStarted'], (r) => {
        if (r.timerStarted) updateTimerDisplay(r.timerRemaining ?? 0);
    });

    // Botón reiniciar timer
    document.getElementById('timerReset').addEventListener('click', () => {
        chrome.storage.local.set({ timerEnd: null, timerStarted: false, timerRemaining: null });
        timerEl.className = 'timer-value waiting';
        timerEl.textContent = 'EN ESPERA...';
        // Notificar al content script para que reinicie su estado interno
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'tg_timer_reset' }).catch(() => {});
            }
        });
    });

    // Escuchar actualizaciones del timer en tiempo real
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.timerRemaining !== undefined) {
                updateTimerDisplay(changes.timerRemaining.newValue);
            }
            if (changes.obs_gift_status)    updateObsStatus('gift',    changes.obs_gift_status.newValue);
            if (changes.obs_follow_status)  updateObsStatus('follow',  changes.obs_follow_status.newValue);
            if (changes.obs_special_status) updateObsStatus('special', changes.obs_special_status.newValue);
            if (changes.chat_overlay_status) updateChatOverlayStatus(changes.chat_overlay_status.newValue);
        }
    });

    // Estado inicial OBS
    chrome.storage.local.get(['obs_gift_status','obs_follow_status','obs_special_status','chat_overlay_status','chatOverlayEnabled'], (r) => {
        if (r.obs_gift_status)    updateObsStatus('gift',    r.obs_gift_status);
        if (r.obs_follow_status)  updateObsStatus('follow',  r.obs_follow_status);
        if (r.obs_special_status) updateObsStatus('special', r.obs_special_status);
        if (r.chat_overlay_status) updateChatOverlayStatus(r.chat_overlay_status);
        // Sincronizar toggle chat overlay
        const chatToggleEl = document.getElementById('chatOverlayEnabled');
        if (chatToggleEl) chatToggleEl.checked = !!r.chatOverlayEnabled;
        // Sincronizar botones OBS con el estado real de conexión
        let changed = false;
        if (r.obs_follow_status  === 'connected' && !filters.obsFollowConnect)  { filters.obsFollowConnect  = true; changed = true; }
        if (r.obs_gift_status    === 'connected' && !filters.obsConnect)         { filters.obsConnect        = true; changed = true; }
        if (r.obs_special_status === 'connected' && !filters.obsSpecialConnect)  { filters.obsSpecialConnect = true; changed = true; }
        if (changed) renderBtns();
    });

    // ── SECCIONES COLAPSABLES ──
    document.querySelectorAll('.section-header').forEach(header => {
        const key   = header.dataset.section;
        const arrow = document.getElementById('arrow-' + key);
        const body  = document.getElementById('body-' + key);
        header.addEventListener('click', () => {
            const collapsed = body.classList.toggle('collapsed');
            arrow.classList.toggle('open', !collapsed);
        });
    });

    // ── TOGGLE PRINCIPAL ──
    toggle.addEventListener("change", () => {
        chrome.storage.sync.set({ enabled: toggle.checked });
        updateStatus(toggle.checked);
    });
    function updateStatus(on) {
        statusDot.className = 'status-dot' + (on ? '' : ' off');
        statusTxt.className = 'status-text' + (on ? '' : ' off');
        statusTxt.textContent = on ? 'ACTIVO' : 'INACTIVO';
    }

    // ── MUTE VOZ ──
    const muteTtsBtn   = document.getElementById('muteTtsBtn');
    const muteIcon     = document.getElementById('muteIcon');
    const muteTtsSt    = document.getElementById('muteTtsState');
    let   mutedTts     = false;

    function updateMuteBtn(muted) {
        mutedTts = muted;
        muteTtsBtn.classList.toggle('muted',   muted);
        muteTtsBtn.classList.toggle('unmuted', !muted);
        muteIcon.textContent      = muted ? '🔇' : '🔊';
        muteTtsSt.textContent     = muted ? 'SILENCIADA' : 'ACTIVA';
    }

    // Cargar estado guardado
    chrome.storage.sync.get(['muteTts'], (r) => updateMuteBtn(!!r.muteTts));

    muteTtsBtn.addEventListener('click', () => {
        const next = !mutedTts;
        chrome.storage.sync.set({ muteTts: next });
        updateMuteBtn(next);
    });

    // ── GIFTER OVERLAY ────────────────────────────────────────────────
    const gifterOverlayEnabled = document.getElementById('gifterOverlayEnabled');
    const gifterOverlayLed     = document.getElementById('gifterOverlayLed');
    const gifterOverlayTxt     = document.getElementById('gifterOverlayTxt');
    const gifterTheme          = document.getElementById('gifterTheme');
    const gifterFont           = document.getElementById('gifterFont');
    const gifterFontSize       = document.getElementById('gifterFontSize');
    const gifterFontSizeVal    = document.getElementById('gifterFontSizeVal');
    const gifterAnimTime       = document.getElementById('gifterAnimTime');
    const gifterAnimTimeVal    = document.getElementById('gifterAnimTimeVal');
    const gifterPosition       = document.getElementById('gifterPosition');
    const gifterUiScale        = document.getElementById('gifterUiScale');
    const gifterUiScaleVal     = document.getElementById('gifterUiScaleVal');

    function updateGifterLed(status) {
        const on  = status === 'connected';
        const err = status === 'error';
        gifterOverlayLed.className = 'obs-led' + (on ? ' on' : err ? ' err' : '');
        gifterOverlayTxt.className = 'obs-status-text' + (on ? ' on' : err ? ' err' : '');
        gifterOverlayTxt.textContent = on ? 'CONECTADO' : err ? 'ERROR' : 'DESCONECTADO';
    }

    function saveGifterConfig() {
        const timeVal = parseInt(gifterAnimTime.value, 10);
        const cfg = {
            gifterTheme:    gifterTheme.value,
            gifterFont:     gifterFont.value,
            gifterFontSize: parseInt(gifterFontSize.value, 10),
            gifterAnimTime: timeVal,
            gifterPosition: gifterPosition.value,
            gifterUiScale:  parseFloat(gifterUiScale.value),
        };
        chrome.storage.sync.set({ gifterConfig: cfg });
    }

    // Cargar estado guardado
    chrome.storage.sync.get(['gifterConfig'], (r) => {
        const c = r.gifterConfig || {};
        if (c.gifterTheme)    gifterTheme.value    = c.gifterTheme;
        if (c.gifterFont)     gifterFont.value     = c.gifterFont;
        if (c.gifterFontSize){ gifterFontSize.value = c.gifterFontSize; gifterFontSizeVal.textContent = c.gifterFontSize + 'px'; }
        // Ancho y alto controlados desde OBS — sin sliders
        if (c.gifterPosition) gifterPosition.value  = c.gifterPosition;
        if (c.gifterAnimTime != null) {
            gifterAnimTime.value      = c.gifterAnimTime;
            gifterAnimTimeVal.textContent = c.gifterAnimTime === 0 ? 'Permanente' : c.gifterAnimTime + 's';
        }
        if (c.gifterUiScale != null) {
            gifterUiScale.value = c.gifterUiScale;
            gifterUiScaleVal.textContent = parseFloat(c.gifterUiScale).toFixed(1) + '×';
        } else {
            gifterUiScale.value = 1.5;
            gifterUiScaleVal.textContent = '1.5×';
        }
    });
    chrome.storage.local.get(['gifterOverlayEnabled','gifter_overlay_status'], (r) => {
        gifterOverlayEnabled.checked = !!r.gifterOverlayEnabled;
        updateGifterLed(r.gifter_overlay_status || 'disconnected');
    });

    // Escuchar LED en tiempo real
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.gifter_overlay_status) updateGifterLed(changes.gifter_overlay_status.newValue);
    });

    // Toggle enable
    gifterOverlayEnabled.addEventListener('change', () => {
        chrome.storage.local.set({ gifterOverlayEnabled: gifterOverlayEnabled.checked });
    });

    // Sliders
    gifterFontSize.addEventListener('input', () => {
        gifterFontSizeVal.textContent = gifterFontSize.value + 'px';
        saveGifterConfig();
    });

    gifterAnimTime.addEventListener('input', () => {
        const v = parseInt(gifterAnimTime.value, 10);
        gifterAnimTimeVal.textContent = v === 0 ? 'Permanente' : v + 's';
        saveGifterConfig();
    });
    gifterTheme.addEventListener('change',    saveGifterConfig);
    gifterFont.addEventListener('change',     saveGifterConfig);
    gifterPosition.addEventListener('change', saveGifterConfig);

    gifterUiScale.addEventListener('input', () => {
        gifterUiScaleVal.textContent = parseFloat(gifterUiScale.value).toFixed(1) + '×';
        saveGifterConfig();
    });

    // ── BOTÓN APLICAR AL OVERLAY ─────────────────────────────────
    const gifterApplyBtn    = document.getElementById('gifterApplyBtn');
    const gifterApplyStatus = document.getElementById('gifterApplyStatus');

    gifterApplyBtn.addEventListener('click', () => {
        saveGifterConfig();
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0]?.id) {
                gifterApplyStatus.textContent = '⚠ abre tango primero';
                gifterApplyStatus.style.color = '#ff3860';
                setTimeout(() => { gifterApplyStatus.textContent = ''; }, 2500);
                return;
            }
            chrome.tabs.sendMessage(tabs[0].id, { type: 'tg_force_trigger', channel: 'gifter_cfg' }, (resp) => {
                if (chrome.runtime.lastError || !resp?.ok) {
                    gifterApplyStatus.textContent = '⚠ recarga la página de tango';
                    gifterApplyStatus.style.color = '#ff3860';
                } else {
                    gifterApplyStatus.textContent = '✔ aplicado';
                    gifterApplyStatus.style.color = '#00ffc8';
                }
                setTimeout(() => { gifterApplyStatus.textContent = ''; }, 2500);
            });
        });
    });

    // ── PANEL DONADORES ──────────────────────────────────────────────
    const donorsList  = document.getElementById('donorsList');
    const donorsClear = document.getElementById('donorsClear');

    function renderDonors(donors) {
        if (!donors || Object.keys(donors).length === 0) {
            donorsList.innerHTML = '<div class="donors-empty">— sin regalos aún —</div>';
            return;
        }
        // Ordenar por coins descendente
        const sorted = Object.values(donors).sort((a, b) => b.coins - a.coins);
        donorsList.innerHTML = '';
        sorted.forEach((d, i) => {
            const row = document.createElement('div');
            row.className = 'donor-row';
            const rankClass = i === 0 ? 'donor-rank gold' : 'donor-rank';
            const rankIcon  = i === 0 ? '👑' : (i + 1);
            row.innerHTML = `
              <div class="donor-row-top">
                <span class="${rankClass}">${rankIcon}</span>
                <span class="donor-name" title="${esc(d.username)}">${esc(d.username)}</span>
                <span class="donor-coins">🪙 ${d.coins.toLocaleString()}</span>
              </div>
              <div class="donor-add">
                <input class="donor-input" type="number" min="1" max="9999" placeholder="cantidad" data-user="${esc(d.username.toLowerCase())}">
                <button class="donor-btn" data-user="${esc(d.username.toLowerCase())}">+SUMAR</button>
                <button class="donor-btn-sub" data-user="${esc(d.username.toLowerCase())}">−RESTAR</button>
              </div>`;
            donorsList.appendChild(row);
        });

        // Eventos de los botones −RESTAR
        donorsList.querySelectorAll('.donor-btn-sub').forEach(btn => {
            btn.addEventListener('click', () => {
                const key    = btn.dataset.user;
                const input  = donorsList.querySelector(`.donor-input[data-user="${key}"]`);
                const amount = parseInt(input.value, 10);
                if (!amount || amount < 1) return;
                chrome.storage.local.get(['gifterDonors'], (r) => {
                    const donors = r.gifterDonors || {};
                    if (!donors[key]) return;
                    donors[key].coins = Math.max(0, donors[key].coins - amount);
                    chrome.storage.local.set({ gifterDonors: donors }, () => {
                        input.value = '';
                        renderDonors(donors);
                    });
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                type:     'tg_manual_gift',
                                username: donors[key].username,
                                coins:    -amount,
                            });
                        }
                    });
                });
            });
        });

        // Eventos de los botones +SUMAR
        donorsList.querySelectorAll('.donor-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key    = btn.dataset.user;
                const input  = donorsList.querySelector(`.donor-input[data-user="${key}"]`);
                const amount = parseInt(input.value, 10);
                if (!amount || amount < 1) return;
                // Aplicar corrección manual
                chrome.storage.local.get(['gifterDonors'], (r) => {
                    const donors = r.gifterDonors || {};
                    if (!donors[key]) return;
                    donors[key].coins += amount;
                    chrome.storage.local.set({ gifterDonors: donors }, () => {
                        input.value = '';
                        renderDonors(donors);
                    });
                    // También notificar al servidor de gifter para actualizar el overlay
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                type:     'tg_manual_gift',
                                username: donors[key].username,
                                coins:    amount,
                            });
                        }
                    });
                });
            });
        });
    }

    function esc(s) {
        return String(s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // Cargar y renderizar al abrir popup
    chrome.storage.local.get(['gifterDonors'], (r) => renderDonors(r.gifterDonors || {}));

    // Escuchar cambios en tiempo real (llegan regalos mientras el popup está abierto)
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.gifterDonors) renderDonors(changes.gifterDonors.newValue || {});
    });

    // Resetear lista
    donorsClear.addEventListener('click', () => {
        chrome.storage.local.set({ gifterDonors: {} });
        renderDonors({});
    });

    // ── VOCES ──
    function loadVoices(sel) {
        const vs = speechSynthesis.getVoices();
        voiceSel.innerHTML = "";
        vs.forEach(v => {
            const o = document.createElement("option");
            o.value = v.name;
            o.textContent = v.name + (v.lang ? ' (' + v.lang + ')' : '');
            if (sel === v.name) o.selected = true;
            voiceSel.appendChild(o);
        });
    }
    speechSynthesis.onvoiceschanged = () => chrome.storage.sync.get(["voice"], r => loadVoices(r.voice));
    voiceSel.addEventListener("change", () => chrome.storage.sync.set({ voice: voiceSel.value }));

    // ── VELOCIDAD ──
    rateSlider.addEventListener("input", () => {
        const r = parseFloat(rateSlider.value).toFixed(2);
        rateVal.textContent = r;
        chrome.storage.sync.set({ rate: parseFloat(r) });
    });

    // ── FILTROS ──
    function renderBtns() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            const key   = btn.dataset.filter;
            const color = btn.dataset.color || 'cyan';
            const on    = filters[key] ?? true;
            btn.classList.remove('active','active-purple','active-orange','active-red','active-gold');
            if (on) btn.classList.add(COLOR_CLASS[color] || 'active');
            const st = btn.querySelector('.filter-state');
            if (st) st.textContent = on ? 'ON' : 'OFF';
        });
    }
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.filter;
            filters[key] = !filters[key];
            chrome.storage.sync.set({ filters: { ...filters } });
            renderBtns();
        });
    });

    // ── SLOTS ──
    function renderSlots() {
        document.querySelectorAll('.obs-slot-scene').forEach(el => { el.value = obsSlots[+el.dataset.slot]?.scene || ''; });
        document.querySelectorAll('.obs-slot-source').forEach(el => { el.value = obsSlots[+el.dataset.slot]?.source || ''; });
    }
    function renderFollowSlots() {
        document.querySelectorAll('.obs-follow-scene').forEach(el => { el.value = obsFollowSlots[+el.dataset.slot]?.scene || ''; });
        document.querySelectorAll('.obs-follow-source').forEach(el => { el.value = obsFollowSlots[+el.dataset.slot]?.source || ''; });
    }
    function renderSpecialSlots() {
        document.querySelectorAll('.obs-special-scene').forEach(el => { el.value = obsSpecialSlots[+el.dataset.slot]?.scene || ''; });
        document.querySelectorAll('.obs-special-source').forEach(el => { el.value = obsSpecialSlots[+el.dataset.slot]?.source || ''; });
    }

    function saveAll() {
        document.querySelectorAll('.obs-slot-scene').forEach(el => { obsSlots[+el.dataset.slot].scene = el.value.trim(); });
        document.querySelectorAll('.obs-slot-source').forEach(el => { obsSlots[+el.dataset.slot].source = el.value.trim(); });
        document.querySelectorAll('.obs-follow-scene').forEach(el => { obsFollowSlots[+el.dataset.slot].scene = el.value.trim(); });
        document.querySelectorAll('.obs-follow-source').forEach(el => { obsFollowSlots[+el.dataset.slot].source = el.value.trim(); });
        document.querySelectorAll('.obs-special-scene').forEach(el => { obsSpecialSlots[+el.dataset.slot].scene = el.value.trim(); });
        document.querySelectorAll('.obs-special-source').forEach(el => { obsSpecialSlots[+el.dataset.slot].source = el.value.trim(); });
        chrome.storage.sync.set({
            obsPort:         obsPortEl.value.trim() || '4455',
            obsPassword:     obsPassEl.value,
            obsSlots:        obsSlots,
            obsFollowSlots:  obsFollowSlots,
            obsSpecialSlots: obsSpecialSlots,
        });
    }

    [obsPortEl, obsPassEl].forEach(el => { el.addEventListener('change', saveAll); el.addEventListener('blur', saveAll); });
    document.querySelectorAll('.obs-slot-scene,.obs-slot-source,.obs-follow-scene,.obs-follow-source,.obs-special-scene,.obs-special-source').forEach(el => {
        el.addEventListener('change', saveAll);
        el.addEventListener('blur', saveAll);
    });

    // ── ESTADO OBS ──
    function updateObsStatus(channel, status) {
        const led = channel === 'gift' ? obsGiftLed : channel === 'follow' ? obsFollowLed : obsSpecialLed;
        const txt = channel === 'gift' ? obsGiftTxt : channel === 'follow' ? obsFollowTxt : obsSpecialTxt;
        const isGold = channel === 'special';
        led.className = 'obs-led';
        txt.className = 'obs-status-text';
        if (status === 'connected') {
            led.classList.add(isGold ? 'gold' : 'on');
            txt.classList.add(isGold ? 'gold' : 'on');
            txt.textContent = 'CONECTADO';
        } else if (status === 'error') {
            led.classList.add('err'); txt.classList.add('err');
            txt.textContent = 'ERROR DE CONEXIÓN';
        } else {
            txt.textContent = 'DESCONECTADO';
        }
    }

    function updateChatOverlayStatus(status) {
        const led = document.getElementById('chatOverlayLed');
        const txt = document.getElementById('chatOverlayTxt');
        if (!led || !txt) return;
        led.className = 'obs-led';
        txt.className = 'obs-status-text';
        if (status === 'connected') {
            led.classList.add('on'); txt.classList.add('on');
            txt.textContent = 'CONECTADO';
        } else if (status === 'error') {
            led.classList.add('err'); txt.classList.add('err');
            txt.textContent = 'ERROR';
        } else {
            txt.textContent = 'DESCONECTADO';
        }
    }

    // Toggle Chat Overlay
    const chatOverlayToggle = document.getElementById('chatOverlayEnabled');
    if (chatOverlayToggle) {
        chatOverlayToggle.addEventListener('change', () => {
            chrome.storage.local.set({ chatOverlayEnabled: chatOverlayToggle.checked });
        });
    }

    // ════════════════════════════════════════════
    // 💬 CHAT OVERLAY — controles del popup
    // ════════════════════════════════════════════
    const chatTheme      = document.getElementById('chatTheme');
    const chatPosition   = document.getElementById('chatPosition');
    const chatTime       = document.getElementById('chatTime');
    const chatTimeVal    = document.getElementById('chatTimeVal');
    const chatMax        = document.getElementById('chatMax');
    const chatMaxVal     = document.getElementById('chatMaxVal');
    const chatFontFamily = document.getElementById('chatFontFamily');
    const chatFontSize   = document.getElementById('chatFontSize');
    const chatFontSizeVal= document.getElementById('chatFontSizeVal');
    const chatWidth      = document.getElementById('chatWidth');
    const chatWidthVal   = document.getElementById('chatWidthVal');
    const chatOpacity    = document.getElementById('chatOpacity');
    const chatOpacityVal = document.getElementById('chatOpacityVal');

    const CHAT_DEFAULTS = {
        chatTheme:      'dark',
        chatPosition:   'bottom',
        chatTime:       12,
        chatMax:        12,
        chatFontFamily: 'Segoe UI, Arial, sans-serif',
        chatFontSize:   13,
        chatWidth:      400,
        chatOpacity:    72,
    };

    function saveChatSettings() {
        const cfg = {
            chatTheme:      chatTheme.value,
            chatPosition:   chatPosition.value,
            chatTime:       parseInt(chatTime.value),
            chatMax:        parseInt(chatMax.value),
            chatFontFamily: chatFontFamily.value,
            chatFontSize:   parseInt(chatFontSize.value),
            chatWidth:      parseInt(chatWidth.value),
            chatOpacity:    parseInt(chatOpacity.value),
        };
        chrome.storage.sync.set({ chatConfig: cfg });
    }

    chrome.storage.sync.get(['chatConfig'], (res) => {
        const cfg = Object.assign({}, CHAT_DEFAULTS, res.chatConfig || {});
        chatTheme.value            = cfg.chatTheme      || 'dark';
        chatPosition.value         = cfg.chatPosition   || 'bottom';
        chatTime.value             = cfg.chatTime;
        chatTimeVal.textContent    = cfg.chatTime + 's';
        chatMax.value              = cfg.chatMax;
        chatMaxVal.textContent     = cfg.chatMax;
        chatFontFamily.value       = cfg.chatFontFamily || 'Segoe UI, Arial, sans-serif';
        chatFontSize.value         = cfg.chatFontSize;
        chatFontSizeVal.textContent= cfg.chatFontSize + 'px';
        chatWidth.value            = cfg.chatWidth;
        chatWidthVal.textContent   = cfg.chatWidth + 'px';
        chatOpacity.value          = cfg.chatOpacity;
        chatOpacityVal.textContent = cfg.chatOpacity + '%';
    });

    chatTheme.addEventListener('change', saveChatSettings);
    chatPosition.addEventListener('change', saveChatSettings);
    chatTime.addEventListener('input', () => {
        chatTimeVal.textContent = chatTime.value + 's';
        saveChatSettings();
    });
    chatMax.addEventListener('input', () => {
        chatMaxVal.textContent = chatMax.value;
        saveChatSettings();
    });
    chatFontFamily.addEventListener('change', saveChatSettings);
    chatFontSize.addEventListener('input', () => {
        chatFontSizeVal.textContent = chatFontSize.value + 'px';
        saveChatSettings();
    });
    chatWidth.addEventListener('input', () => {
        chatWidthVal.textContent = chatWidth.value + 'px';
        saveChatSettings();
    });
    chatOpacity.addEventListener('input', () => {
        chatOpacityVal.textContent = chatOpacity.value + '%';
        saveChatSettings();
    });

    // ════════════════════════════════════════════
    // 🎮 OVERLAY PERSONAJES — controles del popup
    // ════════════════════════════════════════════
    const pokeEnabled    = document.getElementById('pokeEnabled');
    const pokeTheme      = document.getElementById('pokeTheme');
    const pokeTime       = document.getElementById('pokeTime');
    const pokeTimeVal    = document.getElementById('pokeTimeVal');
    const pokeSpeed      = document.getElementById('pokeSpeed');
    const pokeSpeedVal   = document.getElementById('pokeSpeedVal');
    const pokeMax        = document.getElementById('pokeMax');
    const pokeMaxVal     = document.getElementById('pokeMaxVal');
    const pokeSize       = document.getElementById('pokeSize');
    const pokeSizeVal    = document.getElementById('pokeSizeVal');
    const pokeFontFamily = document.getElementById('pokeFontFamily');
    const pokeFontSize   = document.getElementById('pokeFontSize');
    const pokeFontSizeVal= document.getElementById('pokeFontSizeVal');

    const POKE_DEFAULTS = {
        pokeEnabled:    true,
        pokeTheme:      'pokemon',
        pokeTime:       120,
        pokeSpeed:      2.2,
        pokeMax:        8,
        pokeSize:       128,
        pokeFontFamily: 'Press Start 2P',
        pokeFontSize:   13,
    };

    // Formatea segundos como string legible
    function fmtTime(sec) {
        sec = parseInt(sec);
        if (sec < 60) return sec + 's';
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return s === 0 ? m + ':00 min' : m + ':' + (s < 10 ? '0' : '') + s + ' min';
    }

    function savePokeSettings() {
        const cfg = {
            pokeEnabled:    pokeEnabled.checked,
            pokeTheme:      pokeTheme.value,
            pokeTime:       parseInt(pokeTime.value),
            pokeSpeed:      parseFloat(pokeSpeed.value),
            pokeMax:        parseInt(pokeMax.value),
            pokeSize:       parseInt(pokeSize.value),
            pokeFontFamily: pokeFontFamily.value,
            pokeFontSize:   parseInt(pokeFontSize.value),
        };
        chrome.storage.sync.set({ pokeConfig: cfg });
    }

    // Cargar configuración guardada
    chrome.storage.sync.get(['pokeConfig'], (res) => {
        const cfg = Object.assign({}, POKE_DEFAULTS, res.pokeConfig || {});
        pokeEnabled.checked        = cfg.pokeEnabled;
        pokeTheme.value            = cfg.pokeTheme      || 'pokemon';
        pokeTime.value             = cfg.pokeTime;
        pokeTimeVal.textContent    = fmtTime(cfg.pokeTime);
        pokeSpeed.value            = cfg.pokeSpeed;
        pokeSpeedVal.textContent   = parseFloat(cfg.pokeSpeed).toFixed(1);
        pokeMax.value              = cfg.pokeMax;
        pokeMaxVal.textContent     = cfg.pokeMax;
        pokeSize.value             = cfg.pokeSize;
        pokeSizeVal.textContent    = cfg.pokeSize + 'px';
        pokeFontFamily.value       = cfg.pokeFontFamily || 'Press Start 2P';
        pokeFontSize.value         = cfg.pokeFontSize   || 13;
        pokeFontSizeVal.textContent= (cfg.pokeFontSize || 13) + 'px';
    });

    // Listeners
    pokeEnabled.addEventListener('change', savePokeSettings);
    pokeTheme.addEventListener('change', savePokeSettings);

    pokeTime.addEventListener('input', () => {
        pokeTimeVal.textContent = fmtTime(pokeTime.value);
        savePokeSettings();
    });
    pokeSpeed.addEventListener('input', () => {
        pokeSpeedVal.textContent = parseFloat(pokeSpeed.value).toFixed(1);
        savePokeSettings();
    });
    pokeMax.addEventListener('input', () => {
        pokeMaxVal.textContent = pokeMax.value;
        savePokeSettings();
    });
    pokeSize.addEventListener('input', () => {
        pokeSizeVal.textContent = pokeSize.value + 'px';
        savePokeSettings();
    });
    pokeFontFamily.addEventListener('change', savePokeSettings);
    pokeFontSize.addEventListener('input', () => {
        pokeFontSizeVal.textContent = pokeFontSize.value + 'px';
        savePokeSettings();
    });


    // ════════════════════════════════════════════
    // 🔬 DIAGNÓSTICO DE REGALOS
    // ════════════════════════════════════════════
    (function() {
        // Patrones internos duplicados para analizar sin acceder al content script
        const RX_EMOJI = new RegExp(
            '(?:[\\u{1F000}-\\u{1FFFF}]|[\\u{2600}-\\u{27BF}]|[\\u{2300}-\\u{23FF}]' +
            '|[\\u{2B00}-\\u{2BFF}]|[\\u{FE00}-\\u{FEFF}]|[\\u{E0000}-\\u{E007F}]' +
            '|\\u{200D}|\\u{20E3}|[#*0-9]\\u{FE0F}?\\u{20E3}|\\u{FE0F})+', 'gu'
        );
        const SPECIAL_GIFT_NUMS = new Set([999, 1000, 1100, 1111, -1]); // -1 = NaN de Tango
        const FOLLOW_PATS = [/¡Nuevo seguidor!/i,/Nuevo seguidor/i,/new follower/i,/started following/i,/empezó a seguir/i,/comenzó a seguir/i,/is now following/i];
        const JOINED_PATS = [/empezó a ver/i,/started watching/i,/joined/i,/se unió/i,/entró a ver/i,/is watching/i,/comenzó a ver/i];

        function isFollow(t) { return FOLLOW_PATS.some(p => p.test(t)); }
        function isJoined(t) { if (isFollow(t)) return false; return JOINED_PATS.some(p => p.test(t)); }

        // Igual que content.js: número al final, o NaN al final → -1 → especial
        function extractGiftNumber(text) {
            const clean = text.replace(RX_EMOJI, '').trim();
            if (/\bNaN\s*$/.test(clean)) return -1;
            const m = /\b(\d{1,6})\s*$/.exec(clean);
            if (!m) return null;
            return parseInt(m[1], 10);
        }

        function diagnose(text) {
            const clean = text.replace(RX_EMOJI, '').trim();
            const n = extractGiftNumber(text);
            const follow  = isFollow(text);
            const joined  = isJoined(text);
            const special = !follow && !joined && n !== null && SPECIAL_GIFT_NUMS.has(n);
            const normal  = !follow && !joined && !special && n !== null && n >= 1 && n <= 99999;
            return { input: text, clean, giftNumber: n, follow, joined, special, normal };
        }

        // Log de detecciones: escuchar mensajes del content script
        const diagLog = document.getElementById('diagLog');
        const diagResult = document.getElementById('diagResult');
        const diagResultInner = document.getElementById('diagResultInner');
        const diagInput = document.getElementById('diagInput');

        if (!diagLog) return; // Panel no está en el DOM

        let logEntries = [];
        function addLog(text, type, detail) {
            const colors = { gift:'#7b2fff', special:'#ffd700', follow:'#00ffc8', joined:'#ff9500', chat:'#555577', forced:'#ff3860' };
            const icons  = { gift:'🎁', special:'⭐', follow:'👤', joined:'👁', chat:'💬', forced:'⚡' };
            const ts = new Date().toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
            const entry = `<div style="border-bottom:1px solid #1a1a2e;padding:3px 0;"><span style="color:#333355;">[${ts}]</span> <span style="color:${colors[type]||'#555'}">${icons[type]||'?'} ${text}</span>${detail ? '<br><span style="color:#333;font-size:10px;padding-left:12px;">' + detail + '</span>' : ''}</div>`;
            logEntries.unshift(entry);
            if (logEntries.length > 20) logEntries.pop();
            diagLog.innerHTML = logEntries.join('');
        }

        // Recibir eventos del content script vía storage
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            if (changes.tg_diag_event) {
                const ev = changes.tg_diag_event.newValue;
                if (!ev) return;
                addLog(ev.text || '(sin texto)', ev.type, ev.detail);
            }
        });

        // Botón ANALIZAR
        document.getElementById('diagAnalyze').addEventListener('click', () => {
            const text = diagInput.value;
            if (!text.trim()) return;
            const r = diagnose(text);
            let tipo = '—';
            let color = '#555577';
            if (r.follow)  { tipo = '👤 SEGUIDOR';        color = '#00ffc8'; }
            if (r.joined)  { tipo = '👁 ENTRÓ A VER';     color = '#ff9500'; }
            if (r.normal)  { tipo = '🎁 REGALO NORMAL';   color = '#7b2fff'; }
            if (r.special) { tipo = '⭐ REGALO ESPECIAL'; color = '#ffd700'; }
            if (!r.follow && !r.joined && !r.normal && !r.special) { tipo = '💬 MENSAJE DE CHAT'; color = '#555577'; }

            diagResultInner.innerHTML = `
                <div><span style="color:#555577;font-size:10px;">TIPO:</span> <strong style="color:${color};font-size:13px;">${tipo}</strong></div>
                <div><span style="color:#555577;font-size:10px;">TEXTO LIMPIO (sin emojis):</span> <span style="color:#aaa;">${r.clean || '(vacío)'}</span></div>
                <div><span style="color:#555577;font-size:10px;">NÚMERO DETECTADO:</span> <span style="color:${r.giftNumber !== null ? '#00ffc8' : '#ff3860'};">${r.giftNumber !== null ? r.giftNumber : '✗ ninguno'}</span></div>
                <div><span style="color:#555577;font-size:10px;">¿ES ESPECIAL? (999/1000/1100):</span> <span style="color:${r.special ? '#ffd700' : '#333355'};">${r.special ? '✔ SÍ' : '✗ NO'}</span></div>
                <div><span style="color:#555577;font-size:10px;">¿DISPARA OBS-REGALO?:</span> <span style="color:${r.normal ? '#7b2fff' : '#333355'};">${r.normal ? '✔ SÍ' : '✗ NO'}</span></div>
                <div><span style="color:#555577;font-size:10px;">¿DISPARA OBS-ESPECIAL?:</span> <span style="color:${r.special ? '#ffd700' : '#333355'};">${r.special ? '✔ SÍ' : '✗ NO'}</span></div>
            `;
            diagResult.style.display = 'block';
            addLog(text.substring(0, 40), r.normal ? 'gift' : r.special ? 'special' : r.follow ? 'follow' : r.joined ? 'joined' : 'chat', `Núm: ${r.giftNumber ?? 'ninguno'}`);
        });

        // Botón FORZAR REGALO
        document.getElementById('diagFireGift').addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]?.id) { addLog('No hay tab activa', 'forced'); return; }
                chrome.tabs.sendMessage(tabs[0].id, { type: 'tg_force_trigger', channel: 'gift' }, (resp) => {
                    addLog('Disparo manual → OBS REGALO', 'forced', resp?.ok ? '✔ enviado' : '✗ content script no respondió (recargá la página de Tango)');
                });
            });
        });

        // Botón FORZAR ESPECIAL
        document.getElementById('diagFireSpecial').addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]?.id) { addLog('No hay tab activa', 'forced'); return; }
                chrome.tabs.sendMessage(tabs[0].id, { type: 'tg_force_trigger', channel: 'special' }, (resp) => {
                    addLog('Disparo manual → OBS ESPECIAL', 'forced', resp?.ok ? '✔ enviado' : '✗ content script no respondió (recargá la página de Tango)');
                });
            });
        });

        // Botón FORZAR SEGUIDOR
        document.getElementById('diagFireFollow').addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]?.id) { addLog('No hay tab activa', 'forced'); return; }
                chrome.tabs.sendMessage(tabs[0].id, { type: 'tg_force_trigger', channel: 'follow' }, (resp) => {
                    addLog('Disparo manual → OBS SEGUIDOR', 'forced', resp?.ok ? '✔ enviado' : '✗ content script no respondió (recargá la página de Tango)');
                });
            });
        });

        // Botón LIMPIAR LOG
        document.getElementById('diagClearLog').addEventListener('click', () => {
            logEntries = [];
            diagLog.innerHTML = '<span style="color:#333355;font-size:10px;">— sin eventos aún —</span>';
        });

        // Tecla Enter en textarea → analizar
        diagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById('diagAnalyze').click();
            }
        });
    })();


});

