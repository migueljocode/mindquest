import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIZ_QUESTIONS } from './questions.ts';
import {
  getStreakMultiplier,
  getBasePoints,
  getTimePerQuestion,
  calculateQuestionScore,
  calculateAccuracy,
  selectQuizQuestions,
  saveRecordToList,
  getPerformanceFeedback,
} from './quizLogic.ts';
import {
  createInternalRoom,
  addOrReconnectPlayer,
  startRoomMatch,
  beginQuestionRound,
  submitPlayerAnswer,
  finalizeQuestionRound,
  advanceToNextQuestionOrFinish,
  buildClientRoomSnapshot,
  resetRoomToLobby,
} from './multiplayerEngine.ts';

test('QUIZ_QUESTIONS contains 180 valid questions (30 per domain) across all 6 bgThemes', () => {
  assert.equal(QUIZ_QUESTIONS.length, 180);
  const perTheme = new Map<string, number>();
  const ids = new Set<number>();
  const imageKeys = new Set<string>();

  for (const q of QUIZ_QUESTIONS) {
    assert.equal(ids.has(q.id), false, `Duplicate question id ${q.id}`);
    ids.add(q.id);
    perTheme.set(q.bgTheme, (perTheme.get(q.bgTheme) || 0) + 1);
    imageKeys.add(q.bgImageKey);
    assert.equal(q.options.length, 4);
    assert.ok(q.correctIndex >= 0 && q.correctIndex <= 3);
    assert.ok(q.explanation.length > 10);
    assert.ok(typeof q.bgImageKey === 'string' && q.bgImageKey.length > 0);
  }

  assert.equal(perTheme.size, 6);
  for (const [theme, count] of perTheme.entries()) {
    assert.equal(count, 30, `Expected 30 questions for ${theme}, got ${count}`);
  }
  assert.ok(imageKeys.size >= 18);
  assert.equal(QUIZ_QUESTIONS.find((q) => q.id === 60)?.bgImageKey, 'einstein_physics');
  assert.equal(QUIZ_QUESTIONS.find((q) => q.id === 1)?.bgImageKey, 'mars_planet');
});

test('getBasePoints and getTimePerQuestion scale by difficulty', () => {
  assert.equal(getBasePoints('easy'), 100);
  assert.equal(getBasePoints('medium'), 200);
  assert.equal(getBasePoints('hard'), 300);
  assert.equal(getTimePerQuestion('easy'), 25);
  assert.equal(getTimePerQuestion('medium'), 20);
  assert.equal(getTimePerQuestion('hard'), 15);
});

test('getStreakMultiplier and calculateQuestionScore compute bonus accurately', () => {
  assert.equal(getStreakMultiplier(0), 1.0);
  assert.equal(getStreakMultiplier(3), 1.25);
  assert.equal(getStreakMultiplier(5), 1.5);

  const res = calculateQuestionScore({
    isCorrect: true,
    difficulty: 'medium',
    timeLeft: 20,
    totalTime: 20,
    currentStreak: 3,
  });
  assert.equal(res.earnedScore, 350);
  assert.equal(res.timeBonus, 80);

  const wrong = calculateQuestionScore({
    isCorrect: false,
    difficulty: 'hard',
    timeLeft: 10,
    totalTime: 15,
    currentStreak: 5,
  });
  assert.equal(wrong.earnedScore, 0);
});

test('selectQuizQuestions filters by difficulty and theme', () => {
  const spaceHard = selectQuizQuestions(QUIZ_QUESTIONS, 'hard', 20, 'space');
  assert.ok(spaceHard.length > 0);
  assert.ok(spaceHard.every((q) => q.difficulty === 'hard' && q.bgTheme === 'space'));
});

test('calculateAccuracy, saveRecordToList, and getPerformanceFeedback', () => {
  assert.equal(calculateAccuracy(9, 10), 90);
  assert.equal(getPerformanceFeedback(95).badge, 'طلایی');

  const list = saveRecordToList(
    [{ id: '1', name: 'A', score: 300, accuracy: 60, difficulty: 'آسان', date: '۱۴۰۵', timestamp: '' }],
    { name: 'B', score: 800, accuracy: 90 }
  );
  assert.equal(list[0].name, 'B');
});

test('multiplayer classic room lifecycle: create, join, start, answer, reveal, finish, rematch', () => {
  const now = 1_700_000_000_000;
  const room = createInternalRoom({
    code: 'MQ24',
    hostId: 'host-1',
    hostName: 'سارا',
    avatar: '🦊',
    color: '#4f46e5',
    settings: { difficulty: 'easy', questionCount: 2, gameMode: 'classic' },
    now,
  });

  const joinRes = addOrReconnectPlayer(room, {
    playerId: 'guest-2',
    playerName: 'علی',
    avatar: '🚀',
    color: '#06b6d4',
  });
  assert.equal(joinRes.error, undefined);
  assert.equal(room.players.length, 2);

  const startRes = startRoomMatch(room, 'host-1', QUIZ_QUESTIONS, now);
  assert.equal(startRes.ok, true);
  assert.equal(room.phase, 'countdown');

  beginQuestionRound(room, now + 3000);
  assert.equal(room.phase, 'question');

  // Snapshot provides server-relative remainingMs without leaking correctIndex
  const snapshotDuringQ = buildClientRoomSnapshot(room, now + 5000);
  assert.equal(snapshotDuringQ.reveal, null);
  assert.equal(snapshotDuringQ.serverNow, now + 5000);
  assert.equal(snapshotDuringQ.remainingMs, 23000);
  assert.ok(snapshotDuringQ.currentQuestion !== null);
  assert.equal('correctIndex' in snapshotDuringQ.currentQuestion, false);

  const q1 = room.questions[0];
  const wrongIdx = (q1.correctIndex + 1) % 4;

  const ans1 = submitPlayerAnswer(room, 'host-1', q1.correctIndex, now + 5000);
  assert.equal(ans1.accepted, true);
  assert.equal(ans1.allAnswered, false);

  const ans2 = submitPlayerAnswer(room, 'guest-2', wrongIdx, now + 6000);
  assert.equal(ans2.accepted, true);
  assert.equal(ans2.allAnswered, true);

  finalizeQuestionRound(room, now + 6000);
  assert.equal(room.phase, 'reveal');
  assert.ok(room.reveal !== null);
  assert.equal(room.reveal.standings[0].id, 'host-1');
  assert.ok(room.reveal.standings[0].score > 0);
  assert.equal(room.reveal.standings[1].score, 0);

  assert.equal(advanceToNextQuestionOrFinish(room, now + 12000), 'question');
  finalizeQuestionRound(room, now + 20000);
  assert.equal(advanceToNextQuestionOrFinish(room, now + 26000), 'finished');
  assert.equal(room.phase, 'finished');

  assert.equal(resetRoomToLobby(room, 'host-1'), true);
  assert.equal(room.phase, 'waiting');
  assert.equal(room.players[0].score, 0);
});

test('multiplayer elimination mode knocks out last player each round until champion remains', () => {
  const now = 1_700_000_000_000;
  const room = createInternalRoom({
    code: 'KO99',
    hostId: 'p1',
    hostName: 'تیم ۱',
    avatar: '🦊',
    color: '#4f46e5',
    settings: { difficulty: 'easy', questionCount: 10, gameMode: 'elimination' },
    now,
  });

  addOrReconnectPlayer(room, { playerId: 'p2', playerName: 'تیم ۲', avatar: '🚀', color: '#0ea5e9' });
  addOrReconnectPlayer(room, { playerId: 'p3', playerName: 'تیم ۳', avatar: '⚡', color: '#10b981' });

  assert.equal(startRoomMatch(room, 'p1', QUIZ_QUESTIONS, now).ok, true);
  beginQuestionRound(room, now + 3000);

  const q1 = room.questions[0];
  const wrongIdx = (q1.correctIndex + 1) % 4;

  // p1 fastest correct, p2 slower correct, p3 wrong -> p3 eliminated in Round 1
  submitPlayerAnswer(room, 'p1', q1.correctIndex, now + 4000);
  submitPlayerAnswer(room, 'p2', q1.correctIndex, now + 6000);
  submitPlayerAnswer(room, 'p3', wrongIdx, now + 5000);

  finalizeQuestionRound(room, now + 6000);
  assert.equal(room.reveal?.eliminatedThisRound.length, 1);
  assert.equal(room.reveal?.eliminatedThisRound[0].id, 'p3');
  assert.equal(room.reveal?.matchWillFinish, false);
  assert.equal(room.players.find((p) => p.id === 'p3')?.isEliminated, true);

  // Eliminated player cannot submit in Round 2
  assert.equal(advanceToNextQuestionOrFinish(room, now + 12000), 'question');
  const q2 = room.questions[1];
  assert.equal(submitPlayerAnswer(room, 'p3', q2.correctIndex, now + 13000).accepted, false);

  // p1 answers right, p2 answers wrong -> p2 eliminated -> p1 sole survivor -> match finishes
  submitPlayerAnswer(room, 'p1', q2.correctIndex, now + 13000);
  const r2p2 = submitPlayerAnswer(room, 'p2', (q2.correctIndex + 1) % 4, now + 14000);
  assert.equal(r2p2.allAnswered, true);

  finalizeQuestionRound(room, now + 14000);
  assert.equal(room.reveal?.eliminatedThisRound[0].id, 'p2');
  assert.equal(room.reveal?.matchWillFinish, true);

  assert.equal(advanceToNextQuestionOrFinish(room, now + 20000), 'finished');
  assert.equal(room.phase, 'finished');
  const snap = buildClientRoomSnapshot(room, now + 20000);
  assert.equal(snap.players[0].id, 'p1');
  assert.equal(snap.players[0].isEliminated, false);
  assert.equal(snap.activeCount, 1);
});
