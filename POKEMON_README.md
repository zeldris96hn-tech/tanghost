# 🎮 TanGhost v12 — Pokémon Overlay

## ¿Cómo funciona?

Cada vez que alguien escribe en el chat de Tango, aparece un **Pokémon aleatorio** caminando en pantalla con el nombre del usuario. El timer se renueva con cada mensaje nuevo. Si el mismo usuario vuelve a hablar, su Pokémon "brinca" indicando actividad.

---

## Arquitectura

```
Tango.me (Chrome)
  └── content.js  →  WebSocket  →  pokemon-server.js (Node local)
                                         ↓
                              OBS Browser Source
                                pokemon-overlay.html
```

---

## Configuración paso a paso

### 1. Instalar Node.js
Descarga desde https://nodejs.org (versión LTS)

### 2. Arrancar el servidor puente
Abre una terminal (cmd.exe en Windows) en la carpeta de la extensión y ejecuta:
```
node pokemon-server.js
```
Déjalo corriendo mientras transmites.

### 3. Configurar OBS
1. En OBS, agrega una nueva fuente: **Navegador (Browser Source)**
2. Desmarca "URL remota" y usa **Archivo local**
3. Navega hasta `pokemon-overlay.html` en esta carpeta
4. Resolución: **1920 × 1080**
5. Marca **"Permitir acceso OBS" (si aparece)**
6. En "CSS personalizado" agrega: `body { background-color: rgba(0,0,0,0); }`
7. Coloca esta fuente **por encima** de tu cámara/gameplay en el orden de capas

### 4. Activar la extensión
Abre Tango.me con Chrome, activa TanGhost. Los Pokémon aparecerán automáticamente.

---

## Personalización (edita `pokemon-overlay.html`)

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `POKEMON_DISPLAY_MS` | `8000` | Tiempo visible (ms) |
| `REFRESH_ON_MSG_MS` | `8000` | Reset timer al hablar de nuevo |
| `WALK_SPEED_PX` | `1.8` | Velocidad de caminado |
| `MAX_ACTORS` | `6` | Máximo de Pokémon simultáneos |
| `SPRITE_SIZE` | `96` | Tamaño del sprite (px) |

---

## Prueba sin extensión
Abre `pokemon-overlay.html` en Chrome y presiona la tecla **P** para simular mensajes de chat.
