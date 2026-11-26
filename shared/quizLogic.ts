/**
 * منطق خالص محاسباتی بازی MindQuest (مشترک بین کلاینت و سرور)
 */

import type { Difficulty, QuizQuestion } from './questions.ts';

export type DifficultyFilter = Difficulty | 'all';

export interface ScoreResult {
  earnedScore: number;
  timeBonus: number;
  multiplier: number;
}

export interface GameRecord {
  id: string;
  name: string;
  score: number;
  accuracy: number;
  difficulty: string;
  date: string;
  timestamp: string;
}

export interface PerformanceFeedback {
  title: string;
  message: string;
  badge: string;
}

export function getStreakMultiplier(streak: number): number {
  if (streak >= 5) return 1.5;
  if (streak >= 3) return 1.25;
  return 1.0;
}

export function getBasePoints(difficulty: string): number {
  switch (difficulty) {
    case 'hard':
      return 300;
    case 'medium':
      return 200;
    case 'easy':
    default:
      return 100;
  }
}

export function getTimePerQuestion(difficulty: string): number {
  switch (difficulty) {
    case 'hard':
      return 15;
    case 'medium':
      return 20;
    case 'easy':
    default:
      return 25;
  }
}

export function calculateQuestionScore(params: {
  isCorrect: boolean;
  difficulty: string;
  timeLeft: number;
  totalTime: number;
  currentStreak: number;
}): ScoreResult {
  const { isCorrect, difficulty, timeLeft, totalTime, currentStreak } = params;
  if (!isCorrect) {
    return { earnedScore: 0, timeBonus: 0, multiplier: 1.0 };
  }

  const basePoints = getBasePoints(difficulty);
  const safeTotal = totalTime > 0 ? totalTime : 20;
  const timeRatio = Math.max(0, Math.min(1, timeLeft / safeTotal));
  const timeBonus = Math.round(timeRatio * (basePoints * 0.4));
  const multiplier = getStreakMultiplier(currentStreak);
  const earnedScore = Math.round((basePoints + timeBonus) * multiplier);

  return { earnedScore, timeBonus, multiplier };
}

export function calculateAccuracy(correctCount: number, totalAnswered: number): number {
  if (!totalAnswered || totalAnswered <= 0) return 0;
  return Math.round((correctCount / totalAnswered) * 100);
}

export function selectQuizQuestions(
  questions: QuizQuestion[],
  difficulty: DifficultyFilter = 'all',
  limit = 10,
  categoryFilter = 'all'
): QuizQuestion[] {
  let pool = [...questions];
  if (difficulty && difficulty !== 'all') {
    pool = pool.filter((q) => q.difficulty === difficulty);
  }
  if (categoryFilter && categoryFilter !== 'all') {
    pool = pool.filter((q) => q.bgTheme === categoryFilter);
  }
  if (pool.length === 0) {
    pool = [...questions];
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(limit, pool.length));
}

export function saveRecordToList(
  records: GameRecord[] = [],
  newRecord: Partial<GameRecord> & { score: number },
  maxEntries = 10
): GameRecord[] {
  const entry: GameRecord = {
    id: newRecord.id || Date.now().toString(),
    name: newRecord.name || 'دانش‌پژوه',
    score: newRecord.score,
    accuracy: newRecord.accuracy ?? 0,
    difficulty: newRecord.difficulty || 'متوسط',
    date: newRecord.date || new Date().toLocaleDateString('fa-IR'),
    timestamp: newRecord.timestamp || new Date().toISOString(),
  };

  const updated = [...records, entry];
  updated.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.accuracy || 0) - (a.accuracy || 0);
  });
  return updated.slice(0, maxEntries);
}

export function getPerformanceFeedback(accuracy: number): PerformanceFeedback {
  if (accuracy >= 90) {
    return {
      title: 'نابغه و استاد کوییز!',
      message: 'عملکرد شما خیره‌کننده بود! تسلط فوق‌العاده‌ای بر مطالب دارید.',
      badge: 'طلایی',
    };
  }
  if (accuracy >= 70) {
    return {
      title: 'عالی و تحسین‌برانگیز!',
      message: 'دانش عمومی و دقت شما بسیار خوب است. با کمی تمرین به قله می‌رسید.',
      badge: 'نقره‌ای',
    };
  }
  if (accuracy >= 50) {
    return {
      title: 'خوب و امیدوارکننده!',
      message: 'پایه‌ای محکم دارید، با مرور توضیحات سؤالات به تسلط بالاتری خواهید رسید.',
      badge: 'برنزی',
    };
  }
  return {
    title: 'تلاش شایسته احترام!',
    message: 'هر اشتباه فرصتی برای یادگیری است. دوباره امتحان کنید و رکورد جدیدی بسازید!',
    badge: 'مشارکت',
  };
}
