# Exum — Reproductor de Audio Estilo Winamp Moderno (v1.0.0)

**Exum** es un reproductor de música para Windows inspirado en el clásico **Winamp 2.x**, construido desde cero con **Electron + TypeScript + Web Audio API** siguiendo una arquitectura modular por capas.

## Instalación rápida (Windows)

No necesitas instalar nada ni configurar Node.js: **Exum** viene como ejecutable portable.

1. Entra a la sección **[Releases](https://github.com/Malteadah77/Exum/releases/latest)** y descarga **`Exum-1.0.0-portable.exe`**.
2. Haz **doble clic** en `Exum-1.0.0-portable.exe` para abrirlo.
   - *Nota de Windows SmartScreen:* como es un proyecto personal sin firma comercial de pago, la primera vez Windows puede mostrar *"Windows protegió su PC"*. Haz clic en **Más información → Ejecutar de todas formas**.
3. **Primeros pasos dentro de Exum:**
   - **Cargar tu música:** haz clic en **`ADD` → `📁 Elegir carpeta`** (o arrastra tus archivos `.mp3` / `.flac` / `.wav` directamente encima de la ventana).
   - **Cambiar skin estilo Winamp:** presiona **`SKINS`** abajo a la derecha para buscar y descargar skins del *Webamp Skin Museum* en 1 clic (o arrastra cualquier archivo `.wsz` sobre la ventana).
   - **Letras y Radios:** usa **`LRC`** para letras sincronizadas y **`NET`** para radios mundiales, YouTube o Spotify.

---

## Características principales

- **Motor propio de Skins `.wsz` + Webamp Skin Museum:**
  - Carga cualquier archivo `.wsz` clásico (local, arrastrar y soltar, o buscador online integrado en la ventana flotante `SKINS`).
  - Escalado proporcional fluido (`1x` a `2.5x`, sin bordes negros) y tema base elegante rojo vino/negro.
  - Sprites reales: `main.bmp`, `titlebar.bmp`, `cbuttons.bmp`, `posbar.bmp`, `volume.bmp`, `balance.bmp`, `shufrep.bmp`, `numbers.bmp`, `playpaus.bmp`, `monoster.bmp`, `eqmain.bmp`, `eq_ex.bmp`, `pledit.bmp`, `pledit.txt` y `viscolor.txt`.
  - **Modo Resumido (*Shade Mode*)** en ventana principal, Ecualizador (`275×14`) y Playlist (`275×14`).
- **Audio & Web Audio API:**
  - Soporte para `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aac` con lectura de metadatos ID3 (`music-metadata`: título, artista, álbum, bitrate `kbps`, frecuencia `kHz`, `Mono/Stereo`).
  - **Ecualizador gráfico de 10 bandas + Preamp + Balance estéreo (`StereoPannerNode`)**, curva gráfica `EqGraph` en vivo y presets (`Flat`, `Rock`, `Pop`, `Bass Boost`, `Vocal`, `Electronic`).
  - **Visualizador en tiempo real (`<canvas>` + `AnalyserNode`)** con modo barras + picos flotantes, osciloscopio y paleta `viscolor.txt`.
- **Playlist completa estilo Winamp (`pledit.bmp`):**
  - Carpeta dedicada de biblioteca local, Drag & Drop, selección múltiple (`Ctrl`/`Shift`), reordenar arrastrando, tecla `Supr`, buscador en vivo, `ADD / REM / SEL / MISC / LIST OPTS`.
  - Playlists guardadas dentro de Exum + Importar/Exportar `.m3u` / `.m3u8`.
- **Ventanas flotantes sincronizadas (heredan la paleta de tu skin `.wsz`):**
  - **`LRC` (Letras sincronizadas):** consulta automática a LRCLIB, scroll sincronizado y clic para saltar a cualquier línea.
  - **`SKINS` (Gestor y Museo):** búsqueda online en Webamp Skin Museum, importar `.wsz` locales y borrar skins guardadas.
  - **`NET` (Fuentes externas):** Buscador mundial de +30,000 radios (*Radio Browser API*), resolver `.m3u`/`.pls`, descarga de audio directo abierto a tu carpeta local, reproductor oficial embebido de YouTube, y conexión **Spotify OAuth 2.0 PKCE** con emparejamiento automático contra tu carpeta local de MP3.
- **Atajos de teclado:**
  - Locales: `Espacio` (Play/Pause), `←` / `→` (-5s / +5s), `Supr` (quitar seleccionadas).
  - Globales (incluso en segundo plano): teclas multimedia o `Ctrl+Alt+Espacio`, `Ctrl+Alt+←`, `Ctrl+Alt+→`.

## Comandos de desarrollo

```powershell
# Instalar dependencias
npm install

# Compilar TypeScript (Main + Renderer) y abrir Exum
npm start

# Ejecutar pruebas unitarias
npm test

# Generar ejecutable portable de Windows (.exe) en release/
npm run dist
```

## Arquitectura

- `src/shared/types.ts` — Contratos TypeScript compartidos (única fuente de verdad).
- `src/main/` — Proceso principal Node.js (`configStore`, `libraryScanner`, `lyricsService`, `wszService`, `playlistStore`, `spotifyService`, `externalSourcesService`).
- `src/preload.ts` — Puente seguro `contextBridge` con principio de mínimo privilegio (`contextIsolation: true`).
- `src/renderer/` — Interfaz y motor de audio (`audioEngine`, `playlistManager`, `visualizer`, `wszRenderer`, `lyricsController`, y ventanas flotantes).
