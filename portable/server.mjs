import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  QUIZ_QUESTIONS,
  addOrReconnectPlayer,
  advanceToNextQuestionOrFinish,
  beginQuestionRound,
  buildClientRoomSnapshot,
  buildPublicRoomSummary,
  createInternalRoom,
  disconnectPlayerFromRoom,
  finalizeQuestionRound,
  generateRoomCode,
  resetRoomToLobby,
  startRoomMatch,
  submitPlayerAnswer,
  updateRoomSettings,
} from './engine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const rooms = new Map();
const roomTimers = new Map();
const clients = new Set();

function encodeWsFrame(opcode, payloadBuffer) {
  const len = payloadBuffer.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuffer]);
}

function sendJson(client, payload) {
  if (!client || client.closed || client.socket.destroyed || !client.socket.writable) return;
  try {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    client.socket.write(encodeWsFrame(0x1, data));
  } catch {
    // Ignore socket write errors on closing sockets
  }
}

function clearRoomTimer(code) {
  const existing = roomTimers.get(code);
  if (existing) {
    clearTimeout(existing);
    roomTimers.delete(code);
  }
}

function broadcastRoomState(code) {
  const room = rooms.get(code);
  if (!room) return;
  const snapshot = buildClientRoomSnapshot(room, Date.now());
  for (const client of clients) {
    if (client.roomCode === code) {
      sendJson(client, { type: 'room:state', room: snapshot });
    }
  }
}

function broadcastToRoom(code, message) {
  for (const client of clients) {
    if (client.roomCode === code) {
      sendJson(client, message);
    }
  }
}

function getJoinableRooms() {
  return Array.from(rooms.values())
    .filter((r) => r.phase === 'waiting' && r.players.some((p) => p.connected))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(buildPublicRoomSummary);
}

function broadcastRoomsList() {
  const list = getJoinableRooms();
  for (const client of clients) {
    if (client.subscribedToLobbyList) {
      sendJson(client, { type: 'rooms:list', rooms: list });
    }
  }
}

function scheduleCountdownTransition(code) {
  clearRoomTimer(code);
  const timer = setTimeout(() => {
    const room = rooms.get(code);
    if (!room || room.phase !== 'countdown') return;
    if (beginQuestionRound(room, Date.now())) {
      broadcastRoomState(code);
      scheduleQuestionTimeout(code);
    }
  }, 3000);
  roomTimers.set(code, timer);
}

function scheduleQuestionTimeout(code) {
  clearRoomTimer(code);
  const room = rooms.get(code);
  if (!room || room.phase !== 'question' || !room.questionEndsAt) return;
  const delayMs = Math.max(250, room.questionEndsAt - Date.now());
  const timer = setTimeout(() => {
    const current = rooms.get(code);
    if (!current || current.phase !== 'question') return;
    if (finalizeQuestionRound(current, Date.now())) {
      broadcastRoomState(code);
      scheduleRevealAdvance(code);
    }
  }, delayMs);
  roomTimers.set(code, timer);
}

function scheduleRevealAdvance(code) {
  clearRoomTimer(code);
  const timer = setTimeout(() => {
    const current = rooms.get(code);
    if (!current || current.phase !== 'reveal') return;
    const outcome = advanceToNextQuestionOrFinish(current, Date.now());
    broadcastRoomState(code);
    if (outcome === 'question') {
      scheduleQuestionTimeout(code);
    } else {
      broadcastRoomsList();
    }
  }, 5500);
  roomTimers.set(code, timer);
}

function cleanupRoomIfEmpty(code) {
  const room = rooms.get(code);
  if (!room) return;
  const anyConnected = room.players.some((p) => p.connected);
  if (!anyConnected) {
    clearRoomTimer(code);
    rooms.delete(code);
    broadcastRoomsList();
  }
}

function handleClientMessage(meta, rawText) {
  let msg;
  try {
    msg = JSON.parse(rawText);
  } catch {
    sendJson(meta, { type: 'room:error', message: 'فرمت پیام نامعتبر است.' });
    return;
  }

  if (msg.type === 'rooms:subscribe') {
    meta.subscribedToLobbyList = true;
    sendJson(meta, { type: 'rooms:list', rooms: getJoinableRooms() });
    return;
  }

  if (msg.type === 'room:create') {
    if (meta.roomCode) {
      const prev = rooms.get(meta.roomCode);
      if (prev) {
        disconnectPlayerFromRoom(prev, meta.playerId);
        cleanupRoomIfEmpty(meta.roomCode);
        broadcastRoomState(meta.roomCode);
      }
    }

    const code = generateRoomCode(new Set(rooms.keys()));
    const room = createInternalRoom({
      code,
      hostId: meta.playerId,
      hostName: msg.playerName,
      avatar: msg.avatar,
      color: msg.color,
      settings: msg.settings,
    });
    rooms.set(code, room);
    meta.roomCode = code;
    sendJson(meta, {
      type: 'room:joined',
      playerId: meta.playerId,
      room: buildClientRoomSnapshot(room, Date.now()),
    });
    broadcastRoomsList();
    return;
  }

  if (msg.type === 'room:join') {
    const cleanCode = String(msg.code || '').trim().toUpperCase();
    const room = rooms.get(cleanCode);
    if (!room) {
      sendJson(meta, { type: 'room:error', message: `اتاقی با کد «${cleanCode}» پیدا نشد.` });
      return;
    }

    if (meta.roomCode && meta.roomCode !== cleanCode) {
      const prev = rooms.get(meta.roomCode);
      if (prev) {
        disconnectPlayerFromRoom(prev, meta.playerId);
        cleanupRoomIfEmpty(meta.roomCode);
        broadcastRoomState(meta.roomCode);
      }
    }

    const targetPlayerId = msg.playerId || meta.playerId;
    const result = addOrReconnectPlayer(room, {
      playerId: targetPlayerId,
      playerName: msg.playerName,
      avatar: msg.avatar,
      color: msg.color,
    });

    if (result.error) {
      sendJson(meta, { type: 'room:error', message: result.error });
      return;
    }

    meta.playerId = result.player.id;
    meta.roomCode = cleanCode;
    sendJson(meta, {
      type: 'room:joined',
      playerId: meta.playerId,
      room: buildClientRoomSnapshot(room, Date.now()),
    });
    broadcastRoomState(cleanCode);
    broadcastRoomsList();
    return;
  }

  if (msg.type === 'room:rejoin') {
    const cleanCode = String(msg.code || '').trim().toUpperCase();
    const room = rooms.get(cleanCode);
    if (!room) {
      sendJson(meta, { type: 'room:error', message: 'اتاق منقضی شده یا بسته شده است.' });
      return;
    }
    const existing = room.players.find((p) => p.id === msg.playerId);
    if (!existing) {
      sendJson(meta, { type: 'room:error', message: 'نشست بازیکن در این اتاق یافت نشد.' });
      return;
    }
    existing.connected = true;
    meta.playerId = existing.id;
    meta.roomCode = cleanCode;
    sendJson(meta, {
      type: 'room:joined',
      playerId: meta.playerId,
      room: buildClientRoomSnapshot(room, Date.now()),
    });
    broadcastRoomState(cleanCode);
    return;
  }

  if (msg.type === 'room:leave') {
    if (meta.roomCode) {
      const code = meta.roomCode;
      const room = rooms.get(code);
      meta.roomCode = null;
      if (room) {
        disconnectPlayerFromRoom(room, meta.playerId);
        cleanupRoomIfEmpty(code);
        broadcastRoomState(code);
        broadcastRoomsList();
      }
    }
    return;
  }

  if (!meta.roomCode) return;
  const room = rooms.get(meta.roomCode);
  if (!room) return;

  if (msg.type === 'room:ready') {
    const player = room.players.find((p) => p.id === meta.playerId);
    if (player && room.phase === 'waiting') {
      player.isReady = msg.isReady;
      broadcastRoomState(room.code);
    }
    return;
  }

  if (msg.type === 'room:settings') {
    if (updateRoomSettings(room, meta.playerId, msg.settings)) {
      broadcastRoomState(room.code);
      broadcastRoomsList();
    }
    return;
  }

  if (msg.type === 'room:start') {
    const res = startRoomMatch(room, meta.playerId, QUIZ_QUESTIONS, Date.now());
    if (!res.ok) {
      sendJson(meta, { type: 'room:error', message: res.error || 'خطا در شروع مسابقه' });
      return;
    }
    broadcastRoomState(room.code);
    broadcastRoomsList();
    scheduleCountdownTransition(room.code);
    return;
  }

  if (msg.type === 'answer:submit') {
    const res = submitPlayerAnswer(room, meta.playerId, msg.optionIndex, Date.now());
    if (!res.accepted) return;
    if (res.allAnswered) {
      clearRoomTimer(room.code);
      finalizeQuestionRound(room, Date.now());
      broadcastRoomState(room.code);
      scheduleRevealAdvance(room.code);
    } else {
      broadcastRoomState(room.code);
    }
    return;
  }

  if (msg.type === 'room:next') {
    const isHost = room.players.some((p) => p.id === meta.playerId && p.isHost);
    if (!isHost || room.phase !== 'reveal') return;
    clearRoomTimer(room.code);
    const outcome = advanceToNextQuestionOrFinish(room, Date.now());
    broadcastRoomState(room.code);
    if (outcome === 'question') {
      scheduleQuestionTimeout(room.code);
    } else {
      broadcastRoomsList();
    }
    return;
  }

  if (msg.type === 'room:rematch') {
    if (resetRoomToLobby(room, meta.playerId)) {
      clearRoomTimer(room.code);
      broadcastRoomState(room.code);
      broadcastRoomsList();
    }
    return;
  }

  if (msg.type === 'room:cheer') {
    const player = room.players.find((p) => p.id === meta.playerId);
    if (player) {
      broadcastToRoom(room.code, {
        type: 'room:cheer',
        playerId: player.id,
        playerName: player.name,
        emoji: String(msg.emoji || '').slice(0, 4),
      });
    }
  }
}

function disconnectClient(meta) {
  if (meta.closed) return;
  meta.closed = true;
  clients.delete(meta);
  if (meta.roomCode) {
    const code = meta.roomCode;
    const room = rooms.get(code);
    if (room) {
      disconnectPlayerFromRoom(room, meta.playerId);
      cleanupRoomIfEmpty(code);
      broadcastRoomState(code);
      broadcastRoomsList();
    }
  }
}

function serveStaticFile(reqPath, res) {
  const cleanUrlPath = reqPath.split('?')[0];
  let relativePath = decodeURIComponent(cleanUrlPath === '/' ? '/index.html' : cleanUrlPath);
  relativePath = relativePath.replace(/^\/+/, '');
  let fullPath = path.resolve(PUBLIC_DIR, relativePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    fullPath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && urlPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        portable: true,
        activeRooms: rooms.size,
        questionCount: QUIZ_QUESTIONS.length,
      })
    );
    return;
  }

  if (req.method === 'GET' && urlPath === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ rooms: getJoinableRooms() }));
    return;
  }

  if (req.method === 'GET' && urlPath === '/api/server-info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ port: PORT, lanUrls: getLanUrls(PORT) }));
    return;
  }

  serveStaticFile(req.url || '/', res);
});

server.on('upgrade', (req, socket) => {
  const reqUrl = (req.url || '/').split('?')[0];
  if (reqUrl !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + WS_MAGIC)
    .digest('base64');

  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '',
      '',
    ].join('\r\n')
  );

  const meta = {
    socket,
    playerId: crypto.randomUUID(),
    roomCode: null,
    subscribedToLobbyList: true,
    closed: false,
  };
  clients.add(meta);
  sendJson(meta, { type: 'rooms:list', rooms: getJoinableRooms() });

  let rxBuffer = Buffer.alloc(0);
  let fragmentedChunks = [];

  socket.on('data', (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);

    while (rxBuffer.length >= 2) {
      const byte1 = rxBuffer[0];
      const byte2 = rxBuffer[1];
      const fin = (byte1 & 0x80) !== 0;
      const opcode = byte1 & 0x0f;
      const masked = (byte2 & 0x80) !== 0;
      let payloadLen = byte2 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (rxBuffer.length < 4) return;
        payloadLen = rxBuffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (rxBuffer.length < 10) return;
        payloadLen = Number(rxBuffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (rxBuffer.length < offset + maskLen + payloadLen) return;

      const maskKey = masked ? rxBuffer.subarray(offset, offset + 4) : null;
      offset += maskLen;

      const payload = Buffer.from(rxBuffer.subarray(offset, offset + payloadLen));
      rxBuffer = rxBuffer.subarray(offset + payloadLen);

      if (maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x8) {
        try {
          socket.write(encodeWsFrame(0x8, Buffer.alloc(0)));
        } catch {
          // Ignore
        }
        socket.end();
        disconnectClient(meta);
        return;
      }

      if (opcode === 0x9) {
        try {
          socket.write(encodeWsFrame(0xA, payload));
        } catch {
          // Ignore
        }
        continue;
      }

      if (opcode === 0xA) {
        continue;
      }

      if (opcode === 0x1 || opcode === 0x0) {
        fragmentedChunks.push(payload);
        if (fin) {
          const fullText = Buffer.concat(fragmentedChunks).toString('utf8');
          fragmentedChunks = [];
          handleClientMessage(meta, fullText);
        }
      }
    }
  });

  socket.on('close', () => disconnectClient(meta));
  socket.on('end', () => disconnectClient(meta));
  socket.on('error', () => disconnectClient(meta));
});

function isPrivateLanIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function getLanUrls(port) {
  const preferred = [];
  const other = [];
  const linkLocal = [];
  const seen = new Set();
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        const url = `http://${entry.address}:${port}`;
        if (seen.has(url)) continue;
        seen.add(url);
        if (isPrivateLanIpv4(entry.address)) preferred.push(url);
        else if (entry.address.startsWith('169.254.')) linkLocal.push(url);
        else other.push(url);
      }
    }
  }
  const combined = [...preferred, ...other];
  return combined.length > 0 ? combined : linkLocal;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('=======================================================');
  console.log('  MindQuest Portable Server (Zero External Dependencies)');
  console.log('=======================================================');
  console.log(`  Local:   http://localhost:${PORT}`);
  const lanUrls = getLanUrls(PORT);
  for (const url of lanUrls) {
    console.log(`  Network: ${url}`);
  }
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});
