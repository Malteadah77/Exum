# Exum — Reproductor de Audio Estilo Winamp Moderno (v1.1.0)

**Exum** es un reproductor de música para Windows inspirado en el clásico **Winamp 2.x**, construido desde cero con **Electron + TypeScript + Web Audio API** siguiendo una arquitectura modular por capas.

## Instalación rápida (Windows)

No necesitas instalar nada ni configurar Node.js: **Exum** viene como ejecutable portable.

1. Entra a la sección **[Releases](https://github.com/Malteadah77/Exum/releases/latest)** y descarga **`Exum-1.1.0-portable.exe`**.
2. Haz **doble clic** en `Exum-1.1.0-portable.exe` para abrirlo.
   - *Nota de Windows SmartScreen:* como es un proyecto personal sin firma comercial de pago, la primera vez Windows puede mostrar *"Windows protegió su PC"*. Haz clic en **Más información → Ejecutar de todas formas**.
3. **Primeros pasos dentro de Exum:**
   - **Tu música local:** haz clic en **`LIB`** (o **`ADD` → `Elegir carpeta`**) para vincular tu carpeta de música con portadas de álbumes, filtros por artista/álbum y favoritos, o arrastra archivos `.mp3` / `.flac` / `.wav` directamente encima de la ventana.
   - **Conseguir y escuchar música libre al instante:** abre **`LIB` → `Explorar`** para reproducir música gratuita desde **Audius** o explorar álbumes Creative Commons en **Internet Archive**, cargar sus pistas en streaming o descargar pistas individuales en MP3 directo a tu carpeta local (cero cuentas, cero API keys).
   - **Cambiar skin estilo Winamp:** presiona **`SKINS`** abajo a la derecha para buscar y descargar skins del *Webamp Skin Museum* en 1 clic (o arrastra cualquier archivo `.wsz` sobre la ventana).
   - **Letras sincronizadas:** presiona **`LRC`** para abrir la ventana flotante de letras en vivo.

---

## Características principales

- **Motor propio de Skins `.wsz` + Webamp Skin Museum:**
  - Carga cualquier archivo `.wsz` clásico (local, arrastrar y soltar, o buscador online integrado en la ventana flotante `SKINS`).
  - Escalado proporcional fluido (`1x` a `2.5x`, sin bordes negros) y tema base elegante rojo vino/negro.
  - Sprites reales: `main.bmp`, `titlebar.bmp`, `cbuttons.bmp`, `posbar.bmp`, `volume.bmp`, `balance.bmp`, `shufrep.bmp`, `numbers.bmp`, `playpaus.bmp`, `monoster.bmp`, `eqmain.bmp`, `eq_ex.bmp`, `pledit.bmp`, `pledit.txt` y `viscolor.txt`.
  - **Modo Resumido (*Shade Mode*)** en ventana principal, Ecualizador (`275×14`) y Playlist (`275×14`).
- **Audio & Web Audio API:**
  - Soporte para `.mp3`, `.wav`, `.flac`, `.ogg`, `.m4a`, `.aac` con lectura de metadatos ID3 (`music-metadata`: título, artista, álbum, portada embebida, bitrate `kbps`, frecuencia `kHz`, `Mono/Stereo`).
  - **Ecualizador gráfico de 10 bandas + Preamp + Balance estéreo (`StereoPannerNode`)**, curva gráfica `EqGraph` en vivo y presets (`Flat`, `Rock`, `Pop`, `Bass Boost`, `Vocal`, `Electronic`).
  - **Visualizador en tiempo real (`<canvas>` + `AnalyserNode`)** con modo barras + picos flotantes, osciloscopio y paleta `viscolor.txt`.
- **Playlist completa estilo Winamp (`pledit.bmp`):**
  - Marco 9-slice auténtico con bordes laterales y barra de desplazamiento interactiva (`8×18`) extraídos de `pledit.bmp`.
  - Drag & Drop, selección múltiple (`Ctrl`/`Shift`), reordenar arrastrando, tecla `Supr`, buscador en vivo, `ADD / REM / SEL / MISC / LIST OPTS`.
  - Playlists guardadas dentro de Exum + Importar/Exportar `.m3u` / `.m3u8`.
- **Ventanas flotantes sincronizadas (heredan la paleta de tu skin `.wsz`):**
  - **`LIB` (Biblioteca y Explorador — cero cuentas, cero API keys):**
    - **`Mi Música`**: vista visual de tu carpeta local con portadas ID3, búsqueda en vivo, filtro por Artista / Álbum, sistema de Favoritos persistentes y envío a cola o playlist.
    - **`Explorar`**: música libre y legal al instante vía **Audius** (tendencias y búsqueda con streaming directo en Exum, EQ y visualizador) e **Internet Archive** (álbumes Netlabels & Creative Commons con streaming y descarga MP3 legal en 1 clic a tu carpeta local).
    - **`Radios`**: buscador mundial de +30,000 emisoras en vivo (*Radio Browser API*).
    - **`URL/.m3u`**: resolver `.m3u`/`.pls`, emisoras guardadas y descarga de archivos de audio abiertos directos.
  - **`LRC` (Letras sincronizadas):** consulta automática a LRCLIB, scroll sincronizado y clic para saltar a cualquier línea.
  - **`SKINS` (Gestor y Museo):** búsqueda online en Webamp Skin Museum, importar `.wsz` locales y borrar skins guardadas.
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

- `src/shared/types.d.ts` — Contratos TypeScript compartidos (única fuente de verdad, sin emisión JS duplicada).
- `src/main.ts` y `src/main/` — Proceso principal Node.js (`configStore`, `libraryScanner`, `lyricsService`, `wszService`, `playlistStore`, `externalSourcesService`).
- `src/preload.ts` — Puente seguro `contextBridge` con `contextIsolation: true` y `sandbox: true`.
- `src/renderer/` — Interfaz y motor de audio (`app`, `audioEngine`, `equalizerPresets`, `playlistManager`, `visualizer`, `wszRenderer`, `lyricsController`, y ventanas flotantes).
