/**
 * موتور مرکزی و خالص مدیریت اتاق‌های مسابقه چندنفره (Authoritative State)
 */

import type { QuizQuestion } from './questions.ts';
import {
  calculateQuestionScore,
  getTimePerQuestion,
  selectQuizQuestions,
} from './quizLogic.ts';
import type {
  ClientRoomSnapshot,
  EliminatedSummary,
  PlayerInfo,
  PublicRoomSummary,
  RoomPhase,
  RoomRevealPayload,
  RoomSettings,
} from './multiplayerTypes.ts';

export interface InternalPlayer extends PlayerInfo {
  currentAnswerIndex: number | null;
}

export interface InternalRoom {
  code: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: InternalPlayer[];
  questions: QuizQuestion[];
  currentQuestionIndex: number;
  questionEndsAt: number | null;
  totalQuestionTime: number;
  phaseEndsAt: number | null;
  reveal: RoomRevealPayload | null;
  createdAt: number;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(existingCodes: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function createInternalRoom(params: {
  code: string;
  hostId: string;
  hostName: string;
  avatar: string;
  color: string;
  settings?: Partial<RoomSettings>;
  now?: number;
}): InternalRoom {
  const now = params.now ?? Date.now();
  const cleanName = params.hostName.trim().slice(0, 20) || 'میزبان';
  const settings: RoomSettings = {
    difficulty: params.settings?.difficulty || 'all',
    questionCount: params.settings?.questionCount || 10,
    category: params.settings?.category || 'all',
    gameMode: params.settings?.gameMode === 'classic' ? 'classic' : 'elimination',
  };

  const hostPlayer: InternalPlayer = {
    id: params.hostId,
    name: cleanName,
    avatar: params.avatar || '🧠',
    color: params.color || '#4f46e5',
    isHost: true,
    isReady: true,
    connected: true,
    score: 0,
    streak: 0,
    maxStreak: 0,
    correctCount: 0,
    wrongCount: 0,
    timeoutCount: 0,
    hasAnsweredCurrent: false,
    lastEarnedScore: 0,
    lastAnswerIndex: null,
    lastAnswerCorrect: null,
    lastAnswerElapsedMs: null,
    isEliminated: false,
    eliminatedRound: null,
    currentAnswerIndex: null,
    rank: 1,
    previousRank: 1,
  };

  return {
    code: params.code,
    phase: 'waiting',
    settings,
    players: [hostPlayer],
    questions: [],
    currentQuestionIndex: 0,
    questionEndsAt: null,
    totalQuestionTime: 20,
    phaseEndsAt: null,
    reveal: null,
    createdAt: now,
  };
}

export function addOrReconnectPlayer(
  room: InternalRoom,
  params: {
    playerId: string;
    playerName: string;
    avatar: string;
    color: string;
  }
): { room: InternalRoom; player: InternalPlayer; error?: string } {
  const existing = room.players.find((p) => p.id === params.playerId);
  if (existing) {
    existing.connected = true;
    return { room, player: existing };
  }

  if (room.players.length >= 16) {
    return { room, player: room.players[0], error: 'ظرفیت این اتاق تکمیل است (حداکثر ۱۶ بازیکن).' };
  }

  if (room.phase !== 'waiting') {
    return { room, player: room.players[0], error: 'مسابقه در حال برگزاری است و امکان ورود جدید وجود ندارد.' };
  }

  const cleanName = params.playerName.trim().slice(0, 20) || `بازیکن ${room.players.length + 1}`;
  const newPlayer: InternalPlayer = {
    id: params.playerId,
    name: cleanName,
    avatar: params.avatar || '🚀',
    color: params.color || '#06b6d4',
    isHost: false,
    isReady: true,
    connected: true,
    score: 0,
    streak: 0,
    maxStreak: 0,
    correctCount: 0,
    wrongCount: 0,
    timeoutCount: 0,
    hasAnsweredCurrent: false,
    lastEarnedScore: 0,
    lastAnswerIndex: null,
    lastAnswerCorrect: null,
    lastAnswerElapsedMs: null,
    isEliminated: false,
    eliminatedRound: null,
    currentAnswerIndex: null,
    rank: room.players.length + 1,
    previousRank: room.players.length + 1,
  };

  room.players.push(newPlayer);
  return { room, player: newPlayer };
}

export function disconnectPlayerFromRoom(room: InternalRoom, playerId: string): boolean {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return false;

  if (room.phase === 'waiting') {
    room.players = room.players.filter((p) => p.id !== playerId);
    if (player.isHost && room.players.length > 0) {
      room.players[0].isHost = true;
      room.players[0].isReady = true;
    }
  } else {
    player.connected = false;
    if (player.isHost) {
      const nextConnected = room.players.find((p) => p.connected);
      if (nextConnected) {
        player.isHost = false;
        nextConnected.isHost = true;
      }
    }
  }
  return true;
}

export function updateRoomSettings(
  room: InternalRoom,
  playerId: string,
  settings: Partial<RoomSettings>
): boolean {
  const host = room.players.find((p) => p.id === playerId && p.isHost);
  if (!host || room.phase !== 'waiting') return false;

  if (settings.difficulty) room.settings.difficulty = settings.difficulty;
  if (settings.questionCount) {
    room.settings.questionCount = Math.max(3, Math.min(30, settings.questionCount));
  }
  if (settings.category) room.settings.category = settings.category;
  if (settings.gameMode === 'classic' || settings.gameMode === 'elimination') {
    room.settings.gameMode = settings.gameMode;
  }
  return true;
}

export function startRoomMatch(
  room: InternalRoom,
  playerId: string,
  questionBank: QuizQuestion[],
  now = Date.now()
): { ok: boolean; error?: string } {
  const host = room.players.find((p) => p.id === playerId && p.isHost);
  if (!host) return { ok: false, error: 'فقط میزبان اتاق می‌تواند مسابقه را آغاز کند.' };
  if (room.phase !== 'waiting') return { ok: false, error: 'مسابقه قبلاً آغاز شده است.' };

  const selected = selectQuizQuestions(
    questionBank,
    room.settings.difficulty,
    room.settings.questionCount,
    room.settings.category
  );

  if (selected.length === 0) {
    return { ok: false, error: 'سؤالی برای این تنظیمات یافت نشد.' };
  }

  room.questions = selected;
  room.currentQuestionIndex = 0;
  room.reveal = null;

  room.players.forEach((p, idx) => {
    p.score = 0;
    p.streak = 0;
    p.maxStreak = 0;
    p.correctCount = 0;
    p.wrongCount = 0;
    p.timeoutCount = 0;
    p.hasAnsweredCurrent = false;
    p.lastEarnedScore = 0;
    p.lastAnswerIndex = null;
    p.lastAnswerCorrect = null;
    p.lastAnswerElapsedMs = null;
    p.isEliminated = false;
    p.eliminatedRound = null;
    p.currentAnswerIndex = null;
    p.rank = idx + 1;
    p.previousRank = idx + 1;
  });

  room.phase = 'countdown';
  room.phaseEndsAt = now + 3000;
  room.questionEndsAt = null;
  return { ok: true };
}

export function beginQuestionRound(room: InternalRoom, now = Date.now()): boolean {
  const currentQ = room.questions[room.currentQuestionIndex];
  if (!currentQ) {
    room.phase = 'finished';
    room.phaseEndsAt = null;
    room.questionEndsAt = null;
    return false;
  }

  const totalTime = getTimePerQuestion(currentQ.difficulty);
  room.phase = 'question';
  room.totalQuestionTime = totalTime;
  room.questionEndsAt = now + totalTime * 1000;
  room.phaseEndsAt = room.questionEndsAt;
  room.reveal = null;

  room.players.forEach((p) => {
    p.hasAnsweredCurrent = false;
    p.currentAnswerIndex = null;
    p.lastEarnedScore = 0;
    p.lastAnswerIndex = null;
    p.lastAnswerCorrect = null;
    p.lastAnswerElapsedMs = null;
  });

  return true;
}

export function submitPlayerAnswer(
  room: InternalRoom,
  playerId: string,
  optionIndex: number,
  now = Date.now()
): { accepted: boolean; allAnswered: boolean } {
  if (room.phase !== 'question') {
    return { accepted: false, allAnswered: false };
  }

  const player = room.players.find((p) => p.id === playerId);
  if (!player || player.isEliminated || player.hasAnsweredCurrent) {
    return { accepted: false, allAnswered: false };
  }

  const currentQ = room.questions[room.currentQuestionIndex];
  if (!currentQ || optionIndex < 0 || optionIndex > 3) {
    return { accepted: false, allAnswered: false };
  }

  const totalMs = room.totalQuestionTime * 1000;
  const remainingMs = Math.max(0, (room.questionEndsAt ?? now) - now);
  const elapsedMs = Math.max(0, totalMs - remainingMs);
  const timeLeftSec = remainingMs / 1000;
  const isCorrect = optionIndex === currentQ.correctIndex;

  player.hasAnsweredCurrent = true;
  player.currentAnswerIndex = optionIndex;
  player.lastAnswerIndex = optionIndex;
  player.lastAnswerCorrect = isCorrect;
  player.lastAnswerElapsedMs = elapsedMs;

  if (isCorrect) {
    player.correctCount += 1;
    player.streak += 1;
    if (player.streak > player.maxStreak) {
      player.maxStreak = player.streak;
    }
    const { earnedScore } = calculateQuestionScore({
      isCorrect: true,
      difficulty: currentQ.difficulty,
      timeLeft: timeLeftSec,
      totalTime: room.totalQuestionTime,
      currentStreak: player.streak,
    });
    player.score += earnedScore;
    player.lastEarnedScore = earnedScore;
  } else {
    player.wrongCount += 1;
    player.streak = 0;
    player.lastEarnedScore = 0;
  }

  const activeConnected = room.players.filter((p) => p.connected && !p.isEliminated);
  const allAnswered =
    activeConnected.length > 0 && activeConnected.every((p) => p.hasAnsweredCurrent);

  return { accepted: true, allAnswered };
}

function comparePlayersForStandings(a: InternalPlayer, b: InternalPlayer): number {
  if (a.isEliminated !== b.isEliminated) {
    return a.isEliminated ? 1 : -1;
  }
  if (a.isEliminated && b.isEliminated) {
    const rA = a.eliminatedRound ?? 0;
    const rB = b.eliminatedRound ?? 0;
    if (rB !== rA) return rB - rA;
  }
  if (b.score !== a.score) return b.score - a.score;
  if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
  const corrA = a.lastAnswerCorrect === true ? 1 : 0;
  const corrB = b.lastAnswerCorrect === true ? 1 : 0;
  if (corrB !== corrA) return corrB - corrA;
  const elA = a.lastAnswerElapsedMs ?? Number.MAX_SAFE_INTEGER;
  const elB = b.lastAnswerElapsedMs ?? Number.MAX_SAFE_INTEGER;
  return elA - elB;
}

export function finalizeQuestionRound(room: InternalRoom, now = Date.now()): boolean {
  if (room.phase !== 'question') return false;
  const currentQ = room.questions[room.currentQuestionIndex];
  if (!currentQ) return false;

  // ثبت اتمام وقت فقط برای بازیکنان فعالِ حذف‌نشده
  room.players.forEach((p) => {
    p.previousRank = p.rank;
    if (!p.isEliminated && !p.hasAnsweredCurrent) {
      p.timeoutCount += 1;
      p.streak = 0;
      p.lastEarnedScore = 0;
      p.lastAnswerIndex = null;
      p.lastAnswerCorrect = false;
      p.lastAnswerElapsedMs = room.totalQuestionTime * 1000 + 1;
    }
  });

  const eliminatedThisRound: EliminatedSummary[] = [];

  // در حالت حذفی، در پایان هر دور آخرین بازیکن فعال حذف می‌شود تا برنده نهایی مشخص شود
  if (room.settings.gameMode === 'elimination') {
    const activeRanked = room.players
      .filter((p) => !p.isEliminated)
      .sort(comparePlayersForStandings);

    if (activeRanked.length > 1) {
      const target = activeRanked[activeRanked.length - 1];
      target.isEliminated = true;
      target.eliminatedRound = room.currentQuestionIndex + 1;
      eliminatedThisRound.push({
        id: target.id,
        name: target.name,
        avatar: target.avatar,
        score: target.score,
        round: target.eliminatedRound,
      });
    }
  }

  const standings = [...room.players].sort(comparePlayersForStandings);
  standings.forEach((p, idx) => {
    p.rank = idx + 1;
  });

  const remainingActiveCount = room.players.filter((p) => !p.isEliminated).length;
  const willFinishByElimination =
    room.settings.gameMode === 'elimination' &&
    room.players.length > 1 &&
    remainingActiveCount <= 1;
  const willFinishByQuestions = room.currentQuestionIndex + 1 >= room.questions.length;

  room.phase = 'reveal';
  room.phaseEndsAt = now + 5500;
  room.questionEndsAt = null;
  room.reveal = {
    correctIndex: currentQ.correctIndex,
    explanation: currentQ.explanation,
    standings: standings.map(stripInternalFields),
    eliminatedThisRound,
    matchWillFinish: willFinishByElimination || willFinishByQuestions,
  };

  return true;
}

export function advanceToNextQuestionOrFinish(
  room: InternalRoom,
  now = Date.now()
): 'question' | 'finished' {
  const remainingActiveCount = room.players.filter((p) => !p.isEliminated).length;
  if (
    room.settings.gameMode === 'elimination' &&
    room.players.length > 1 &&
    remainingActiveCount <= 1
  ) {
    room.phase = 'finished';
    room.phaseEndsAt = null;
    room.questionEndsAt = null;
    return 'finished';
  }

  room.currentQuestionIndex += 1;
  if (room.currentQuestionIndex >= room.questions.length) {
    room.phase = 'finished';
    room.phaseEndsAt = null;
    room.questionEndsAt = null;
    return 'finished';
  }
  beginQuestionRound(room, now);
  return 'question';
}

export function resetRoomToLobby(room: InternalRoom, playerId: string): boolean {
  const host = room.players.find((p) => p.id === playerId && p.isHost);
  if (!host) return false;

  room.phase = 'waiting';
  room.questions = [];
  room.currentQuestionIndex = 0;
  room.questionEndsAt = null;
  room.phaseEndsAt = null;
  room.reveal = null;

  room.players = room.players.filter((p) => p.connected);
  room.players.forEach((p, idx) => {
    p.score = 0;
    p.streak = 0;
    p.maxStreak = 0;
    p.correctCount = 0;
    p.wrongCount = 0;
    p.timeoutCount = 0;
    p.hasAnsweredCurrent = false;
    p.lastEarnedScore = 0;
    p.lastAnswerIndex = null;
    p.lastAnswerCorrect = null;
    p.lastAnswerElapsedMs = null;
    p.isEliminated = false;
    p.eliminatedRound = null;
    p.currentAnswerIndex = null;
    p.rank = idx + 1;
    p.previousRank = idx + 1;
    p.isReady = true;
  });

  return true;
}

function stripInternalFields(p: InternalPlayer): PlayerInfo {
  const { currentAnswerIndex: _unused, ...rest } = p;
  return { ...rest };
}

export function buildClientRoomSnapshot(
  room: InternalRoom,
  now = Date.now()
): ClientRoomSnapshot {
  const currentQ = room.questions[room.currentQuestionIndex];
  const showQuestion = room.phase === 'question' || room.phase === 'reveal';

  const connectedPlayers = room.players.filter((p) => p.connected);
  const activePlayers = room.players.filter((p) => !p.isEliminated);
  const activeConnected = connectedPlayers.filter((p) => !p.isEliminated);
  const answeredCount = activeConnected.filter((p) => p.hasAnsweredCurrent).length;

  const sortedPlayers = [...room.players]
    .sort((a, b) => {
      if (room.phase === 'waiting') return 0;
      return comparePlayersForStandings(a, b);
    })
    .map(stripInternalFields);

  const targetEnd =
    room.phase === 'question' ? room.questionEndsAt : room.phaseEndsAt;
  const remainingMs =
    targetEnd !== null ? Math.max(0, targetEnd - now) : null;

  return {
    code: room.code,
    phase: room.phase,
    settings: { ...room.settings },
    players: sortedPlayers,
    currentQuestionIndex: room.currentQuestionIndex,
    totalQuestions: room.questions.length,
    questionEndsAt: room.questionEndsAt,
    totalQuestionTime: room.totalQuestionTime,
    phaseEndsAt: room.phaseEndsAt,
    serverNow: now,
    remainingMs,
    currentQuestion:
      showQuestion && currentQ
        ? {
            id: currentQ.id,
            difficulty: currentQ.difficulty,
            categoryLabel: currentQ.categoryLabel,
            bgTheme: currentQ.bgTheme,
            bgImageKey: currentQ.bgImageKey,
            motifLabel: currentQ.motifLabel,
            question: currentQ.question,
            options: currentQ.options,
          }
        : null,
    reveal: room.phase === 'reveal' ? room.reveal : null,
    answeredCount,
    activeCount: activePlayers.length,
    connectedCount: activeConnected.length,
  };
}

export function buildPublicRoomSummary(room: InternalRoom): PublicRoomSummary {
  const host = room.players.find((p) => p.isHost) || room.players[0];
  return {
    code: room.code,
    hostName: host?.name || 'میزبان',
    playerCount: room.players.filter((p) => p.connected).length,
    phase: room.phase,
    difficulty: room.settings.difficulty,
    questionCount: room.settings.questionCount,
    gameMode: room.settings.gameMode,
  };
}
