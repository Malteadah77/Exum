import * as crypto from 'crypto';
import { shell } from 'electron';
import * as http from 'http';
import { SpotifyAuthState, SpotifyPlaylistItem, SpotifyTrackItem } from '../shared/types';

const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const SCOPES = 'user-read-private playlist-read-private playlist-read-collaborative';

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let authState: SpotifyAuthState = { connected: false };

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(crypto.randomBytes(48));
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return { verifier, challenge: base64UrlEncode(hash) };
}

export function getSpotifyState(): SpotifyAuthState {
  if (accessToken && Date.now() >= tokenExpiresAt) {
    accessToken = null;
    authState = { connected: false };
  }
  return { ...authState };
}

export function disconnectSpotify(): SpotifyAuthState {
  accessToken = null;
  tokenExpiresAt = 0;
  authState = { connected: false };
  return { ...authState };
}

/**
 * Flujo oficial OAuth 2.0 PKCE de Spotify para apps de escritorio (sin Client Secret).
 * Abre el navegador para iniciar sesión y escucha temporalmente en 127.0.0.1:8888/callback.
 */
export async function connectSpotify(clientId: string): Promise<SpotifyAuthState> {
  const trimmedId = clientId.trim();
  if (!trimmedId) {
    return { connected: false, error: 'Ingresa tu Spotify Client ID primero.' };
  }

  const { verifier, challenge } = generatePkcePair();
  const stateParam = base64UrlEncode(crypto.randomBytes(16));

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', trimmedId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', stateParam);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', challenge);

  return new Promise<SpotifyAuthState>((resolve) => {
    let settled = false;

    const finish = (result: SpotifyAuthState): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      authState = result;
      resolve(result);
    };

    const server = http.createServer(async (req, res) => {
      if (!req.url || !req.url.startsWith('/callback')) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const url = new URL(req.url, 'http://127.0.0.1:8888');
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error || !code || returnedState !== stateParam) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>Autenticación cancelada o inválida. Puedes cerrar esta pestaña.</h3>');
        finish({ connected: false, error: error || 'Autenticación cancelada.' });
        return;
      }

      try {
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: trimmedId,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: verifier,
          }),
        });

        if (!tokenRes.ok) {
          throw new Error('No se pudo obtener el token de Spotify.');
        }

        const tokenData = (await tokenRes.json()) as {
          access_token: string;
          expires_in: number;
        };

        accessToken = tokenData.access_token;
        tokenExpiresAt = Date.now() + (tokenData.expires_in - 60) * 1000;

        const meRes = await fetch('https://api.spotify.com/v1/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const me = meRes.ok
          ? ((await meRes.json()) as { display_name?: string; product?: string })
          : {};

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>¡Conectado a Exum! Ya puedes cerrar esta pestaña y volver al reproductor.</h3>');
        finish({
          connected: true,
          displayName: me.display_name || 'Usuario Spotify',
          product: me.product || 'free',
        });
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>Error al conectar con Spotify. Puedes cerrar esta pestaña.</h3>');
        finish({
          connected: false,
          error: err instanceof Error ? err.message : 'Error de autenticación.',
        });
      }
    });

    const timeout = setTimeout(() => {
      finish({ connected: false, error: 'Tiempo agotado esperando inicio de sesión en Spotify.' });
    }, 120_000);

    server.on('error', () => {
      finish({ connected: false, error: 'El puerto local 8888 está ocupado.' });
    });

    server.listen(8888, '127.0.0.1', () => {
      void shell.openExternal(authUrl.toString());
    });
  });
}

export async function listSpotifyPlaylists(): Promise<SpotifyPlaylistItem[]> {
  if (!accessToken || Date.now() >= tokenExpiresAt) return [];

  try {
    const res = await fetch('https://api.spotify.com/v1/me/playlists?limit=30', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        name: string;
        tracks?: { total?: number };
        external_urls?: { spotify?: string };
      }>;
    };

    return (data.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      trackCount: p.tracks?.total ?? 0,
      externalUrl: p.external_urls?.spotify ?? '',
    }));
  } catch {
    return [];
  }
}

export async function getSpotifyPlaylistTracks(playlistId: string): Promise<SpotifyTrackItem[]> {
  if (!accessToken || Date.now() >= tokenExpiresAt) return [];

  try {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks?limit=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];

    const data = (await res.json()) as {
      items?: Array<{
        track?: {
          id: string;
          name: string;
          duration_ms?: number;
          preview_url?: string | null;
          artists?: Array<{ name: string }>;
          album?: { name: string };
          external_urls?: { spotify?: string };
        } | null;
      }>;
    };

    return (data.items ?? [])
      .filter((entry) => Boolean(entry.track?.id))
      .map((entry) => {
        const t = entry.track!;
        return {
          id: t.id,
          title: t.name,
          artist: (t.artists ?? []).map((a) => a.name).join(', ') || 'Artista desconocido',
          album: t.album?.name ?? '',
          duration: Math.round((t.duration_ms ?? 0) / 1000),
          previewUrl: t.preview_url ?? null,
          externalUrl: t.external_urls?.spotify ?? '',
        };
      });
  } catch {
    return [];
  }
}

export async function getSpotifyPlaylistDetails(
  playlistId: string
): Promise<{ name: string; tracks: SpotifyTrackItem[] } | null> {
  if (!accessToken || Date.now() >= tokenExpiresAt) return null;

  try {
    const [metaRes, tracks] = await Promise.all([
      fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}?fields=name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      getSpotifyPlaylistTracks(playlistId),
    ]);

    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { name?: string };
    return {
      name: meta.name || 'Playlist Spotify',
      tracks,
    };
  } catch {
    return null;
  }
}
