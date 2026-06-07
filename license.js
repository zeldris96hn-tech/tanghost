/**
 * TanGhost — Sistema de Licencias Firebase
 * =========================================
 * Flujo:
 *  1. Al abrir popup → llamar initLicense()
 *  2. Si hay serial guardado → verificar contra Firebase
 *  3. Si válido → llamar onActivated()
 *  4. Si no → mostrar pantalla de activación
 *
 * Estructura en Firestore:
 *   colección: "licenses"
 *   documento ID: <SERIAL-CODE>
 *   {
 *     active: true,
 *     used: false,           // se pone true al activar por primera vez
 *     owner: "",             // se llena al activar
 *     activatedAt: null,     // Timestamp al activar
 *     expiresAt: null,       // Timestamp o null (null = sin vencimiento)
 *     plan: "1mes",          // "7dias"|"1mes"|"2meses"|"3meses"|"4meses"|"5meses"|"6meses"|"anual"|"lifetime"
 *     maxDevices: 1,         // cuántos dispositivos puede usar
 *     devices: [],           // array de deviceIds registrados
 *     notes: ""              // tus notas internas
 *   }
 */

// ════════════════════════════════════════════════
//  ⚙️  CONFIGURACIÓN  — pon aquí tus datos Firebase
// ════════════════════════════════════════════════
const FIREBASE_CONFIG = {
    apiKey:            "AIzaSyDguNfAFxO8nb1eYlY4ArNZeStxkuQDG64",
    authDomain:        "tanghost-ea320.firebaseapp.com",
    projectId:         "tanghost-ea320",
    storageBucket:     "tanghost-ea320.firebasestorage.app",
    messagingSenderId: "61643216011",
    appId:             "1:61643216011:web:936efc34380aab5c3c708e"
};

// URL base de Firestore REST (no requiere SDK, funciona en extensiones MV3)
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;

// Clave de storage donde guardamos el serial activado
const STORAGE_KEY_SERIAL  = "tg_license_serial";
const STORAGE_KEY_CACHED  = "tg_license_cache";   // cache local para reducir lecturas
const CACHE_TTL_MS        = 60 * 60 * 1000;        // 1 hora de cache

// ════════════════════════════════════════════════
//  🔧  UTILIDADES INTERNAS
// ════════════════════════════════════════════════

/** Genera un deviceId estable basado en datos del navegador */
async function getDeviceId() {
    const stored = await chromeGet("tg_device_id");
    if (stored) return stored;
    // Crear uno nuevo aleatorio y guardarlo
    const id = "dev_" + crypto.randomUUID().replace(/-/g, "").substring(0, 16);
    await chromeSet("tg_device_id", id);
    return id;
}

function chromeGet(key) {
    return new Promise(resolve => {
        chrome.storage.local.get([key], r => resolve(r[key] ?? null));
    });
}

function chromeSet(key, val) {
    return new Promise(resolve => {
        chrome.storage.local.set({ [key]: val }, resolve);
    });
}

/** Convierte un valor de campo Firestore a JS */
function fsVal(field) {
    if (!field) return null;
    if (field.stringValue  !== undefined) return field.stringValue;
    if (field.booleanValue !== undefined) return field.booleanValue;
    if (field.integerValue !== undefined) return parseInt(field.integerValue);
    if (field.timestampValue !== undefined) return new Date(field.timestampValue);
    if (field.nullValue    !== undefined) return null;
    if (field.arrayValue) {
        const vals = field.arrayValue.values || [];
        return vals.map(fsVal);
    }
    return null;
}

/** Convierte el documento Firestore a un objeto plano */
function parseDoc(doc) {
    if (!doc || !doc.fields) return null;
    const out = {};
    for (const [k, v] of Object.entries(doc.fields)) {
        out[k] = fsVal(v);
    }
    return out;
}

/** Lee un documento de Firestore vía REST */
async function fsGet(collection, docId) {
    const url = `${FIRESTORE_BASE}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore GET error ${res.status}`);
    const json = await res.json();
    return parseDoc(json);
}

/** Convierte valor JS a campo Firestore */
function toFsField(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean")        return { booleanValue: v };
    if (typeof v === "number")         return { integerValue: String(v) };
    if (v instanceof Date)             return { timestampValue: v.toISOString() };
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return { timestampValue: v };
    if (Array.isArray(v))              return { arrayValue: { values: v.map(s => ({ stringValue: String(s) })) } };
    return { stringValue: String(v) };
}

/** Actualiza campos en un documento Firestore (PATCH sin updateMask) */
async function fsPatch(collection, docId, fields) {
    // Primero leer el doc completo para hacer merge
    let existing = {};
    try {
        const current = await fsGet(collection, docId);
        if (current) existing = current;
    } catch(e) {}

    // Merge: campos existentes + campos nuevos
    const merged = Object.assign({}, existing, fields);
    // Quitar campos internos
    delete merged._id;

    const url = `${FIRESTORE_BASE}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`;

    const fsFields = {};
    for (const [k, v] of Object.entries(merged)) {
        fsFields[k] = toFsField(v);
    }

    const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fsFields })
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Firestore error ${res.status}: ${txt}`);
    }
}

// ════════════════════════════════════════════════
//  🔑  LÓGICA DE LICENCIA
// ════════════════════════════════════════════════

/**
 * Verifica y activa un serial.
 * Retorna: { ok: true, data: {...} }  |  { ok: false, error: "MENSAJE" }
 */
async function verifySerial(serial) {
    serial = serial.trim().toUpperCase();
    if (!serial) return { ok: false, error: "Ingresa un código de serial." };

    let doc;
    try {
        doc = await fsGet("licenses", serial);
    } catch (e) {
        return { ok: false, error: "Error de conexión. Verifica tu internet." };
    }

    if (!doc) {
        return { ok: false, error: "Serial no encontrado. Verifica el código." };
    }
    if (!doc.active) {
        return { ok: false, error: "Este serial ha sido desactivado." };
    }

    // Verificar expiración
    if (doc.expiresAt && new Date() > new Date(doc.expiresAt)) {
        return { ok: false, error: "Este serial ha vencido." };
    }

    const deviceId = await getDeviceId();
    const devices  = doc.devices || [];
    const maxDevices = doc.maxDevices || 1;

    // ¿Ya está este dispositivo registrado?
    const alreadyRegistered = devices.includes(deviceId);

    if (!alreadyRegistered) {
        // ¿Hay espacio para más dispositivos?
        if (devices.length >= maxDevices) {
            return {
                ok: false,
                error: `Serial en uso en ${devices.length} dispositivo(s). Máximo: ${maxDevices}.`
            };
        }
        // Registrar este dispositivo
        const newDevices = [...devices, deviceId];
        try {
            await fsPatch("licenses", serial, {
                used:        true,
                activatedAt: doc.activatedAt || new Date(),
                devices:     newDevices,
            });
        } catch (e) {
            return { ok: false, error: "Error al registrar el dispositivo." };
        }
    }

    // Todo OK — guardar en local
    await chromeSet(STORAGE_KEY_SERIAL, serial);
    await chromeSet(STORAGE_KEY_CACHED, {
        serial,
        plan:      doc.plan || "1mes",
        expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
        cachedAt:  Date.now(),
    });

    return { ok: true, data: doc };
}

/**
 * Verifica el serial guardado contra Firebase.
 * Retorna: { ok: true, data, serial }  |  { ok: false, error }
 */
async function checkSavedLicense() {
    const serial = await chromeGet(STORAGE_KEY_SERIAL);
    if (!serial) return { ok: false, error: "no_serial" };

    // Intentar usar cache para no gastar lecturas Firebase
    const cache = await chromeGet(STORAGE_KEY_CACHED);
    if (cache && cache.serial === serial && (Date.now() - cache.cachedAt) < CACHE_TTL_MS) {
        // Cache válida — verificar vencimiento local
        if (cache.expiresAt && new Date() > new Date(cache.expiresAt)) {
            return { ok: false, error: "Tu licencia ha vencido." };
        }
        return { ok: true, data: cache, serial, fromCache: true };
    }

    // Cache expirada o no existe → verificar en Firebase
    let doc;
    try {
        doc = await fsGet("licenses", serial);
    } catch (e) {
        // Sin internet: usar cache aunque esté vieja (gracia offline)
        if (cache && cache.serial === serial) {
            console.warn("TanGhost: sin conexión, usando cache de licencia");
            return { ok: true, data: cache, serial, fromCache: true, offline: true };
        }
        return { ok: false, error: "Sin conexión a internet." };
    }

    if (!doc) {
        await chromeSet(STORAGE_KEY_SERIAL, null);
        await chromeSet(STORAGE_KEY_CACHED, null);
        return { ok: false, error: "Serial revocado. Contacta al administrador." };
    }
    if (!doc.active) {
        return { ok: false, error: "Licencia desactivada. Contacta al administrador." };
    }
    if (doc.expiresAt && new Date() > new Date(doc.expiresAt)) {
        return { ok: false, error: "Tu licencia ha vencido." };
    }

    // Actualizar cache
    await chromeSet(STORAGE_KEY_CACHED, {
        serial,
        plan:      doc.plan || "1mes",
        expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
        cachedAt:  Date.now(),
    });

    return { ok: true, data: doc, serial };
}

/**
 * Desvincula este dispositivo y borra la licencia local.
 */
async function deactivateLicense() {
    const serial = await chromeGet(STORAGE_KEY_SERIAL);
    if (!serial) return;
    try {
        const doc = await fsGet("licenses", serial);
        if (doc) {
            const deviceId = await getDeviceId();
            const newDevices = (doc.devices || []).filter(d => d !== deviceId);
            await fsPatch("licenses", serial, { devices: newDevices });
        }
    } catch (e) { /* ignorar errores de red al desactivar */ }
    await chromeSet(STORAGE_KEY_SERIAL, null);
    await chromeSet(STORAGE_KEY_CACHED, null);
}

// ════════════════════════════════════════════════
//  🚀  FUNCIÓN PRINCIPAL
// ════════════════════════════════════════════════

/**
 * Inicializa el sistema de licencias.
 * @param {Function} onActivated  - callback cuando la licencia es válida
 * @param {Function} onBlocked    - callback cuando no hay licencia válida
 */
async function initLicense(onActivated, onBlocked) {
    const result = await checkSavedLicense();
    if (result.ok) {
        onActivated(result);
    } else {
        onBlocked(result.error);
    }
}

// Exportar para uso en popup.js
window.TGLicense = {
    init:       initLicense,
    verify:     verifySerial,
    deactivate: deactivateLicense,
    getSerial:  () => chromeGet(STORAGE_KEY_SERIAL),
};
