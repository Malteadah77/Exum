import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { formatTime } from '../dist/renderer/audioEngine.js';
import { PlaylistManager } from '../dist/renderer/playlistManager.js';
import wszService from '../dist/main/wszService.js';

const { parseWszSkin } = wszService;

function makeTrack(id, title, artist = 'Artist', duration = 180) {
  return {
    id,
    filePath: `C:\\Music\\${id}.mp3`,
    fileUrl: `file:///C:/Music/${id}.mp3`,
    fileName: `${id}.mp3`,
    title,
    artist,
    album: 'Album',
    duration,
  };
}

test('formatTime formatea segundos correctamente y maneja valores inválidos', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(5), '00:05');
  assert.equal(formatTime(125), '02:05');
  assert.equal(formatTime(3599), '59:59');
  assert.equal(formatTime(-10), '00:00');
  assert.equal(formatTime(Number.NaN), '00:00');
  assert.equal(formatTime(Number.POSITIVE_INFINITY), '00:00');
});

test('PlaylistManager agrega sin duplicados y calcula duración total', () => {
  const pm = new PlaylistManager();
  const t1 = makeTrack('1', 'Alpha', 'Zed', 100);
  const t2 = makeTrack('2', 'Beta', 'Amy', 200);

  pm.addTracks([t1, t2]);
  pm.addTracks([t1]); // duplicado por id

  assert.equal(pm.allTracks.length, 2);
  assert.equal(pm.getTotalDuration(), 300);
});

test('PlaylistManager navega con next, previous y modos de repeat (off / all / one)', () => {
  const pm = new PlaylistManager();
  pm.setTracks([makeTrack('1', 'One'), makeTrack('2', 'Two')]);
  pm.selectIndex(0);

  // Repeat OFF: avanza hasta el final y luego devuelve null
  assert.equal(pm.next()?.id, '2');
  assert.equal(pm.handleTrackEnded(), null);

  // Repeat ALL: vuelve a la primera canción
  pm.cycleRepeat(); // off -> all
  assert.equal(pm.handleTrackEnded()?.id, '1');
  assert.equal(pm.previous()?.id, '2');

  // Repeat ONE: repite la misma pista
  pm.cycleRepeat(); // all -> one
  assert.equal(pm.handleTrackEnded()?.id, '2');
});

test('PlaylistManager soporta selección múltiple, borrar, recortar, ordenar y mover filas', () => {
  const pm = new PlaylistManager();
  pm.setTracks([
    makeTrack('1', 'Zeta', 'Artist B', 240),
    makeTrack('2', 'Alpha', 'Artist A', 120),
    makeTrack('3', 'Mid', 'Artist C', 180),
  ]);

  // Ordenar por título
  pm.sortBy('title');
  assert.deepEqual(
    pm.allTracks.map((t) => t.title),
    ['Alpha', 'Mid', 'Zeta']
  );

  // Mover fila 2 a posición 0
  pm.moveTrack(2, 0);
  assert.deepEqual(
    pm.allTracks.map((t) => t.title),
    ['Zeta', 'Alpha', 'Mid']
  );

  // Seleccionar fila 1 y quitarla
  pm.toggleRowSelection(1, false, false);
  pm.removeSelected();
  assert.deepEqual(
    pm.allTracks.map((t) => t.title),
    ['Zeta', 'Mid']
  );

  // Seleccionar fila 0 y recortar (dejar solo seleccionada)
  pm.toggleRowSelection(0, false, false);
  pm.cropSelected();
  assert.deepEqual(
    pm.allTracks.map((t) => t.title),
    ['Zeta']
  );
});

test('parseWszSkin extrae sprites, pledit.txt y viscolor.txt desde un archivo .wsz', () => {
  const tmpFile = path.join(os.tmpdir(), `exum-test-${Date.now()}.wsz`);
  const zip = new AdmZip();

  zip.addFile(
    'subdir/PLEDIT.TXT',
    Buffer.from('[Text]\r\nNormal=#112233\r\nCurrent=#ffffff\r\nNormalBG=#000000\r\nSelectedBG=#445566\r\nFont=Arial\r\n')
  );
  zip.addFile(
    'VISCOLOR.TXT',
    Buffer.from('0,0,0 // bg\r\n24,33,41 // grid\r\n255,0,0 // top\r\n')
  );
  zip.addFile('main.bmp', Buffer.from([0x42, 0x4d, 0x00, 0x00]));
  zip.writeZip(tmpFile);

  try {
    const parsed = parseWszSkin(tmpFile);
    assert.equal(parsed.pledit.normal, '#112233');
    assert.equal(parsed.pledit.current, '#ffffff');
    assert.equal(parsed.pledit.normalBg, '#000000');
    assert.equal(parsed.pledit.selectedBg, '#445566');
    assert.equal(parsed.visColors.length, 3);
    assert.equal(parsed.visColors[2], 'rgb(255, 0, 0)');
    assert.ok(parsed.sprites.main?.startsWith('data:image/bmp;base64,'));
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
