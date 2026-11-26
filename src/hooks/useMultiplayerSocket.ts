import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientRoomSnapshot,
  ClientToServerMessage,
  PublicRoomSummary,
  RoomSettings,
  ServerToClientMessage,
} from '../../shared/multiplayerTypes.ts';

export interface CheerEvent {
  id: string;
  playerId: string;
  playerName: string;
  emoji: string;
}

export function useMultiplayerSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(() => sessionStorage.getItem('mq_mp_playerId'));
  const [room, setRoom] = useState<ClientRoomSnapshot | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cheers, setCheers] = useState<CheerEvent[]>([]);

  const sendMessage = useCallback((msg: ClientToServerMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      setError('اتصال با سرور برقرار نیست. در حال تلاش مجدد...');
    }
  }, []);

  useEffect(() => {
    let unmounted = false;

    const isFileProtocol = typeof window !== 'undefined' && window.location.protocol === 'file:';
    if (isFileProtocol) {
      return;
    }

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        setConnected(true);
        setError(null);

        const savedRoom = sessionStorage.getItem('mq_mp_roomCode');
        const savedPid = sessionStorage.getItem('mq_mp_playerId');
        if (savedRoom && savedPid) {
          ws.send(JSON.stringify({ type: 'room:rejoin', code: savedRoom, playerId: savedPid }));
        } else {
          ws.send(JSON.stringify({ type: 'rooms:subscribe' }));
        }
      };

      ws.onmessage = (event) => {
        if (unmounted) return;
        try {
          const msg = JSON.parse(event.data) as ServerToClientMessage;
          if (msg.type === 'room:joined') {
            setPlayerId(msg.playerId);
            setRoom(msg.room);
            setError(null);
            sessionStorage.setItem('mq_mp_playerId', msg.playerId);
            sessionStorage.setItem('mq_mp_roomCode', msg.room.code);
          } else if (msg.type === 'room:state') {
            setRoom(msg.room);
          } else if (msg.type === 'rooms:list') {
            setPublicRooms(msg.rooms);
          } else if (msg.type === 'room:error') {
            setError(msg.message);
            if (msg.message.includes('منقضی') || msg.message.includes('یافت نشد')) {
              sessionStorage.removeItem('mq_mp_roomCode');
              sessionStorage.removeItem('mq_mp_playerId');
            }
          } else if (msg.type === 'room:cheer') {
            const cheerId = `${Date.now()}-${Math.random()}`;
            setCheers((prev) => [
              ...prev.slice(-6),
              { id: cheerId, playerId: msg.playerId, playerName: msg.playerName, emoji: msg.emoji },
            ]);
            setTimeout(() => {
              setCheers((prev) => prev.filter((c) => c.id !== cheerId));
            }, 2200);
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnected(false);
        reconnectTimerRef.current = setTimeout(connect, 1800);
      };
    };

    connect();
    return () => {
      unmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  const createRoom = useCallback(
    (params: { playerName: string; avatar: string; color: string; settings?: Partial<RoomSettings> }) => {
      setError(null);
      sendMessage({ type: 'room:create', ...params });
    },
    [sendMessage]
  );

  const joinRoom = useCallback(
    (params: { code: string; playerName: string; avatar: string; color: string }) => {
      setError(null);
      sendMessage({ type: 'room:join', ...params });
    },
    [sendMessage]
  );

  const leaveRoom = useCallback(() => {
    sendMessage({ type: 'room:leave' });
    setRoom(null);
    sessionStorage.removeItem('mq_mp_roomCode');
    sessionStorage.removeItem('mq_mp_playerId');
  }, [sendMessage]);

  const updateSettings = useCallback(
    (settings: Partial<RoomSettings>) => {
      sendMessage({ type: 'room:settings', settings });
    },
    [sendMessage]
  );

  const startMatch = useCallback(() => {
    sendMessage({ type: 'room:start' });
  }, [sendMessage]);

  const submitAnswer = useCallback(
    (optionIndex: number) => {
      sendMessage({ type: 'answer:submit', optionIndex });
    },
    [sendMessage]
  );

  const nextQuestion = useCallback(() => {
    sendMessage({ type: 'room:next' });
  }, [sendMessage]);

  const rematch = useCallback(() => {
    sendMessage({ type: 'room:rematch' });
  }, [sendMessage]);

  const sendCheer = useCallback(
    (emoji: string) => {
      sendMessage({ type: 'room:cheer', emoji });
    },
    [sendMessage]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    connected,
    playerId,
    room,
    publicRooms,
    error,
    cheers,
    clearError,
    createRoom,
    joinRoom,
    leaveRoom,
    updateSettings,
    startMatch,
    submitAnswer,
    nextQuestion,
    rematch,
    sendCheer,
  };
}
