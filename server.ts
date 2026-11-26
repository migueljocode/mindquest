import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { QUIZ_QUESTIONS } from './shared/questions.ts';
import type {
  ClientToServerMessage,
  ServerToClientMessage,
} from './shared/multiplayerTypes.ts';
import {
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
} from './shared/multiplayerEngine.ts';
import type { InternalRoom } from './shared/multiplayerEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

interface ClientMeta {
  ws: WebSocket;
  playerId: string;
  roomCode: string | null;
  subscribedToLobbyList: boolean;
}

const rooms = new Map<string, InternalRoom>();
const roomTimers = new Map<string, ReturnType<typeof setTimeout>>();
const clients = new Set<ClientMeta>();

function sendJson(ws: WebSocket, payload: ServerToClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function clearRoomTimer(code: string): void {
  const existing = roomTimers.get(code);
  if (existing) {
    clearTimeout(existing);
    roomTimers.delete(code);
  }
}

function broadcastRoomState(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  const snapshot = buildClientRoomSnapshot(room, Date.now());
  for (const client of clients) {
    if (client.roomCode === code) {
      sendJson(client.ws, { type: 'room:state', room: snapshot });
    }
  }
}

function broadcastToRoom(code: string, message: ServerToClientMessage): void {
  for (const client of clients) {
    if (client.roomCode === code) {
      sendJson(client.ws, message);
    }
  }
}

function getJoinableRooms() {
  return Array.from(rooms.values())
    .filter((r) => r.phase === 'waiting' && r.players.some((p) => p.connected))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(buildPublicRoomSummary);
}

function broadcastRoomsList(): void {
  const list = getJoinableRooms();
  for (const client of clients) {
    if (client.subscribedToLobbyList) {
      sendJson(client.ws, { type: 'rooms:list', rooms: list });
    }
  }
}

function scheduleCountdownTransition(code: string): void {
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

function scheduleQuestionTimeout(code: string): void {
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

function scheduleRevealAdvance(code: string): void {
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

function cleanupRoomIfEmpty(code: string): void {
  const room = rooms.get(code);
  if (!room) return;
  const anyConnected = room.players.some((p) => p.connected);
  if (!anyConnected) {
    clearRoomTimer(code);
    rooms.delete(code);
    broadcastRoomsList();
  }
}

function isPrivateLanIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function getLanUrls(listenPort: number): string[] {
  const preferred: string[] = [];
  const other: string[] = [];
  const linkLocal: string[] = [];
  const seen = new Set<string>();
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        const url = `http://${entry.address}:${listenPort}`;
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

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size, questionCount: QUIZ_QUESTIONS.length });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getJoinableRooms() });
  });

  app.get('/api/server-info', (_req, res) => {
    res.json({ port: PORT, lanUrls: getLanUrls(PORT) });
  });

  const server = http.createServer(app);

  if (IS_PROD) {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server, path: '/vite-hmr' },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const reqPath = (request.url || '/').split('?')[0];
    if (reqPath !== '/ws') return;
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws) => {
    const meta: ClientMeta = {
      ws,
      playerId: crypto.randomUUID(),
      roomCode: null,
      subscribedToLobbyList: true,
    };
    clients.add(meta);

    sendJson(ws, { type: 'rooms:list', rooms: getJoinableRooms() });

    ws.on('message', (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServerMessage;
      } catch {
        sendJson(ws, { type: 'room:error', message: 'فرمت پیام نامعتبر است.' });
        return;
      }

      if (msg.type === 'rooms:subscribe') {
        meta.subscribedToLobbyList = true;
        sendJson(ws, { type: 'rooms:list', rooms: getJoinableRooms() });
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
        sendJson(ws, {
          type: 'room:joined',
          playerId: meta.playerId,
          room: buildClientRoomSnapshot(room, Date.now()),
        });
        broadcastRoomsList();
        return;
      }

      if (msg.type === 'room:join') {
        const cleanCode = msg.code.trim().toUpperCase();
        const room = rooms.get(cleanCode);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: `اتاقی با کد «${cleanCode}» پیدا نشد.` });
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
          sendJson(ws, { type: 'room:error', message: result.error });
          return;
        }

        meta.playerId = result.player.id;
        meta.roomCode = cleanCode;
        sendJson(ws, {
          type: 'room:joined',
          playerId: meta.playerId,
          room: buildClientRoomSnapshot(room, Date.now()),
        });
        broadcastRoomState(cleanCode);
        broadcastRoomsList();
        return;
      }

      if (msg.type === 'room:rejoin') {
        const cleanCode = msg.code.trim().toUpperCase();
        const room = rooms.get(cleanCode);
        if (!room) {
          sendJson(ws, { type: 'room:error', message: 'اتاق منقضی شده یا بسته شده است.' });
          return;
        }
        const existing = room.players.find((p) => p.id === msg.playerId);
        if (!existing) {
          sendJson(ws, { type: 'room:error', message: 'نشست بازیکن در این اتاق یافت نشد.' });
          return;
        }
        existing.connected = true;
        meta.playerId = existing.id;
        meta.roomCode = cleanCode;
        sendJson(ws, {
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
          sendJson(ws, { type: 'room:error', message: res.error || 'خطا در شروع مسابقه' });
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
            emoji: String(msg.emoji).slice(0, 4),
          });
        }
      }
    });

    ws.on('close', () => {
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
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`MindQuest server listening on http://0.0.0.0:${PORT}`);
    for (const url of getLanUrls(PORT)) {
      console.log(`Phone/LAN: ${url}`);
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start MindQuest server:', err);
  process.exit(1);
});
