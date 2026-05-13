'use strict';

// ── Map state helpers ─────────────────────────────────────────────────────────

function getFloorMap(player, floor) {
  if (!player.mapData) player.mapData = {};
  const key = String(floor);
  if (!player.mapData[key]) player.mapData[key] = { discovered: [], visited: [] };
  return player.mapData[key];
}

function discoverRoom(player, roomId, floor) {
  const m = getFloorMap(player, floor);
  if (!m.discovered.includes(roomId)) m.discovered.push(roomId);
}

function visitRoom(player, roomId, floor) {
  discoverRoom(player, roomId, floor);
  const m = getFloorMap(player, floor);
  if (!m.visited.includes(roomId)) m.visited.push(roomId);
}

// Reveal adjacent rooms from scene.map.connections, skipping secret-tagged or excluded rooms.
function revealConnected(player, scene, allScenes, floor, excludedRooms = new Set()) {
  for (const connId of (scene.map?.connections || [])) {
    if (allScenes[connId]?.map?.tag === 'secret') continue;
    if (excludedRooms.has(connId)) continue;
    discoverRoom(player, connId, floor);
  }
}

// ── Label builder ─────────────────────────────────────────────────────────────

const TAG_CHARS = { combat: '!', boss: '!', treasure: '$', secret: '~' };

function makeLabel(roomId, scene, mapState, clearedRooms, currentRoomId) {
  const { discovered, visited } = mapState;
  if (!discovered.includes(roomId)) return null;

  // Secret rooms hidden until visited
  if (scene.map.tag === 'secret' && !visited.includes(roomId)) return null;

  const name = scene.map.name || roomId.slice(0, 6).toUpperCase();
  const tag  = TAG_CHARS[scene.map.tag] || '';
  const core = name + tag;

  const isCurrent = roomId === currentRoomId;
  const wasVisited = visited.includes(roomId);
  const isCleared  = clearedRooms?.[roomId] === true;

  if (isCurrent)   return `[*${core}*]`;
  if (!wasVisited)  return `[${core}?]`;
  if (isCleared)    return `[${core}+]`;
  return `[${core}]`;
}

// ── Map renderer ──────────────────────────────────────────────────────────────

const CELL_W = 12; // characters per grid column

function renderMap(allScenes, currentRoomId, player) {
  const floor    = player.floor;
  const mapState = getFloorMap(player, floor);

  // Collect visible rooms (discovered + have map coords)
  const rooms = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const roomId of mapState.discovered) {
    const scene = allScenes[roomId];
    if (!scene?.map) continue;
    if (scene.map.tag === 'secret' && !mapState.visited.includes(roomId)) continue;
    const { x, y } = scene.map;
    rooms.push({ id: roomId, x, y, scene });
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  if (rooms.length === 0) {
    console.log('\n  (No map data available.)\n');
    return;
  }

  const gridW  = maxX - minX + 1;
  const gridH  = maxY - minY + 1;
  const lineW  = gridW * CELL_W;

  // 2D char grid: 2 lines per row (room line + connector line below)
  const grid = Array.from({ length: gridH * 2 }, () => new Array(lineW).fill(' '));

  // Index rooms by id and position for connection lookup
  const byId  = {};
  const byPos = {};
  for (const r of rooms) {
    byId[r.id] = r;
    byPos[`${r.x},${r.y}`] = r.id;
  }

  // Place room labels (centered in CELL_W)
  for (const r of rooms) {
    const label = makeLabel(r.id, r.scene, mapState, player.clearedRooms, currentRoomId);
    if (!label) continue;
    const col = (r.x - minX) * CELL_W;
    const row = (r.y - minY) * 2;
    const pad = Math.max(0, Math.floor((CELL_W - label.length) / 2));
    for (let i = 0; i < label.length; i++) {
      const c = col + pad + i;
      if (c < lineW) grid[row][c] = label[i];
    }
  }

  // Draw connections (only between adjacent discovered rooms that are connected)
  const drawn = new Set();
  for (const r of rooms) {
    for (const connId of (r.scene.map?.connections || [])) {
      const key = [r.id, connId].sort().join('|');
      if (drawn.has(key)) continue;
      drawn.add(key);

      const other = byId[connId];
      if (!other) continue; // not discovered / no map data

      const dx = other.x - r.x;
      const dy = other.y - r.y;

      if (dx === 0 && Math.abs(dy) === 1) {
        // Vertical: draw | in connector row below the top room
        const topRoom  = dy > 0 ? r : other;
        const connRow  = (topRoom.y - minY) * 2 + 1;
        const connCol  = (topRoom.x - minX) * CELL_W + Math.floor(CELL_W / 2);
        if (connRow < grid.length && connCol < lineW) grid[connRow][connCol] = '|';

      } else if (dy === 0 && Math.abs(dx) === 1) {
        // Horizontal: draw -- in the padding gap between the two cells
        const leftRoom = dx > 0 ? r : other;
        const roomRow  = (leftRoom.y - minY) * 2;
        const gapStart = (leftRoom.x - minX) * CELL_W + CELL_W - 2;
        const gapEnd   = (leftRoom.x - minX + 1) * CELL_W + 1; // 1 into right cell
        for (let c = gapStart; c < gapEnd && c < lineW; c++) {
          if (grid[roomRow][c] === ' ') grid[roomRow][c] = '-';
        }
      }
      // Diagonal or wider gaps: no line (layout implies connection)
    }
  }

  // Output
  const title  = `  Floor ${floor} — Map`;
  const border = '─'.repeat(Math.max(title.length, Math.min(lineW + 2, 60)));
  console.log('\n  ' + border);
  console.log(title);
  console.log('  ' + border);
  for (let r = 0; r < grid.length; r++) {
    const line = grid[r].join('').trimEnd();
    if (line.trim()) console.log('  ' + line);
  }
  console.log('\n  [*X*] here  [X] visited  [X?] seen  [X+] cleared  [X$] treasure  [X!] combat');
  console.log('  ' + border + '\n');
}

module.exports = { getFloorMap, discoverRoom, visitRoom, revealConnected, renderMap };
