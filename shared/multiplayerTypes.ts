/**
 * تایپ‌ها و قراردادهای ارتباطی حالت چندنفره (Multiplayer) تحت شبکه
 */

import type { BgImageKey, BgTheme, Difficulty } from './questions.ts';
import type { DifficultyFilter } from './quizLogic.ts';

export type RoomPhase = 'waiting' | 'countdown' | 'question' | 'reveal' | 'finished';
export type MultiplayerGameMode = 'elimination' | 'classic';

export interface PlayerInfo {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isHost: boolean;
  isReady: boolean;
  connected: boolean;
  score: number;
  streak: number;
  maxStreak: number;
  correctCount: number;
  wrongCount: number;
  timeoutCount: number;
  hasAnsweredCurrent: boolean;
  lastEarnedScore: number;
  lastAnswerIndex: number | null;
  lastAnswerCorrect: boolean | null;
  lastAnswerElapsedMs: number | null;
  isEliminated: boolean;
  eliminatedRound: number | null;
  rank: number;
  previousRank: number;
}

export interface PublicQuestionPayload {
  id: number;
  difficulty: Difficulty;
  categoryLabel: string;
  bgTheme: BgTheme;
  bgImageKey: BgImageKey;
  motifLabel: string;
  question: string;
  options: [string, string, string, string];
}

export interface EliminatedSummary {
  id: string;
  name: string;
  avatar: string;
  score: number;
  round: number;
}

export interface RoomRevealPayload {
  correctIndex: number;
  explanation: string;
  standings: PlayerInfo[];
  eliminatedThisRound: EliminatedSummary[];
  matchWillFinish: boolean;
}

export interface RoomSettings {
  difficulty: DifficultyFilter;
  questionCount: number;
  category: string;
  gameMode: MultiplayerGameMode;
}

export interface PublicRoomSummary {
  code: string;
  hostName: string;
  playerCount: number;
  phase: RoomPhase;
  difficulty: DifficultyFilter;
  questionCount: number;
  gameMode: MultiplayerGameMode;
}

export interface ClientRoomSnapshot {
  code: string;
  phase: RoomPhase;
  settings: RoomSettings;
  players: PlayerInfo[];
  currentQuestionIndex: number;
  totalQuestions: number;
  questionEndsAt: number | null;
  totalQuestionTime: number;
  phaseEndsAt: number | null;
  serverNow: number;
  remainingMs: number | null;
  currentQuestion: PublicQuestionPayload | null;
  reveal: RoomRevealPayload | null;
  answeredCount: number;
  activeCount: number;
  connectedCount: number;
}

export type ClientToServerMessage =
  | {
      type: 'room:create';
      playerName: string;
      avatar: string;
      color: string;
      settings?: Partial<RoomSettings>;
    }
  | {
      type: 'room:join';
      code: string;
      playerName: string;
      avatar: string;
      color: string;
      playerId?: string;
    }
  | {
      type: 'room:rejoin';
      code: string;
      playerId: string;
    }
  | {
      type: 'room:leave';
    }
  | {
      type: 'room:ready';
      isReady: boolean;
    }
  | {
      type: 'room:settings';
      settings: Partial<RoomSettings>;
    }
  | {
      type: 'room:start';
    }
  | {
      type: 'answer:submit';
      optionIndex: number;
    }
  | {
      type: 'room:next';
    }
  | {
      type: 'room:rematch';
    }
  | {
      type: 'room:cheer';
      emoji: string;
    }
  | {
      type: 'rooms:subscribe';
    };

export type ServerToClientMessage =
  | {
      type: 'room:joined';
      playerId: string;
      room: ClientRoomSnapshot;
    }
  | {
      type: 'room:state';
      room: ClientRoomSnapshot;
    }
  | {
      type: 'room:cheer';
      playerId: string;
      playerName: string;
      emoji: string;
    }
  | {
      type: 'rooms:list';
      rooms: PublicRoomSummary[];
    }
  | {
      type: 'room:error';
      message: string;
    };
