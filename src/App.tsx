import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Flame,
  Gamepad2,
  Lightbulb,
  Moon,
  RotateCcw,
  Settings,
  ShieldQuestion,
  Sparkles,
  Sun,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  XCircle,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { QUIZ_QUESTIONS } from '../shared/questions.ts';
import type { BgImageKey, BgTheme, QuizQuestion } from '../shared/questions.ts';
import {
  calculateAccuracy,
  calculateQuestionScore,
  getPerformanceFeedback,
  getStreakMultiplier,
  getTimePerQuestion,
  saveRecordToList,
  selectQuizQuestions,
} from '../shared/quizLogic.ts';
import type { DifficultyFilter, GameRecord } from '../shared/quizLogic.ts';
import { CircularTimer } from './components/CircularTimer.tsx';
import { ConfettiBurst } from './components/ConfettiBurst.tsx';
import { DynamicBackdrop } from './components/DynamicBackdrop.tsx';
import { MultiplayerArena } from './components/MultiplayerArena.tsx';
import { MultiplayerLobby } from './components/MultiplayerLobby.tsx';
import { RecordsModal } from './components/RecordsModal.tsx';
import { ReviewModal } from './components/ReviewModal.tsx';
import type { HistoryItem } from './components/ReviewModal.tsx';
import { useMultiplayerSocket } from './hooks/useMultiplayerSocket.ts';
import { soundEngine } from './utils/soundEngine.ts';
import { PLAYER_AVATARS, PLAYER_COLORS, THEME_VISUALS } from './utils/themeAssets.ts';

type AppTab = 'solo' | 'multiplayer';
type SoloPhase = 'setup' | 'playing' | 'results';

const OPTION_LETTERS = ['الف', 'ب', 'ج', 'د'];
const DIFF_LABELS: Record<DifficultyFilter, string> = {
  all: 'همه سطوح',
  easy: 'آسان',
  medium: 'متوسط',
  hard: 'سخت',
};

const TOPIC_OPTIONS: { id: string; label: string }[] = [
  { id: 'all', label: 'همه قلمروها' },
  { id: 'space', label: 'نجوم و کیهان' },
  { id: 'science', label: 'علوم و زیست' },
  { id: 'tech', label: 'فناوری و کد' },
  { id: 'history', label: 'تاریخ و تمدن' },
  { id: 'geography', label: 'جغرافیا' },
  { id: 'arts_math', label: 'هنر و ریاضی' },
];

export default function App() {
  // تنظیمات سراسری و تم
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('mindquest_theme');
    return saved ? saved === 'dark' : true;
  });
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    const saved = localStorage.getItem('mindquest_sound');
    return saved !== null ? saved === 'true' : true;
  });

  // مشخصات بازیکن
  const [playerName, setPlayerName] = useState<string>(
    () => localStorage.getItem('mindquest_player_name') || 'دانش‌پژوه'
  );
  const [avatar, setAvatar] = useState<string>(PLAYER_AVATARS[0]);
  const [playerColor, setPlayerColor] = useState<string>(PLAYER_COLORS[0]);

  // تب و مودال‌ها
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') ? 'multiplayer' : 'solo';
  });
  const [initialRoomCode] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase();
  });
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  // رکوردهای ذخیره‌شده
  const [records, setRecords] = useState<GameRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('mindquest_records') || '[]') as GameRecord[];
    } catch {
      return [];
    }
  });

  // وضعیت بازی تک‌نفره (Solo)
  const [soloPhase, setSoloPhase] = useState<SoloPhase>('setup');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');
  const [topicFilter, setTopicFilter] = useState<string>('all');
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [score, setScore] = useState<number>(0);
  const [streak, setStreak] = useState<number>(0);
  const [correctCount, setCorrectCount] = useState<number>(0);
  const [wrongCount, setWrongCount] = useState<number>(0);
  const [timeoutCount, setTimeoutCount] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(20);
  const [totalQTime, setTotalQTime] = useState<number>(20);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState<boolean>(false);
  const [isNewRecord, setIsNewRecord] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [floatingPopup, setFloatingPopup] = useState<{ id: number; text: string } | null>(null);

  // ابزارهای کمکی هیجان‌انگیز (Lifelines) در حالت تک‌نفره
  const [fiftyFiftyLeft, setFiftyFiftyLeft] = useState<number>(2);
  const [extraTimeLeft, setExtraTimeLeft] = useState<number>(1);
  const [eliminatedIndices, setEliminatedIndices] = useState<number[]>([]);

  const lastTickSecondRef = useRef<number>(-1);
  const soloDeadlinePerfRef = useRef<number>(0);
  const mp = useMultiplayerSocket();

  // همگام‌سازی تم تاریک/روشن با DOM
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('mindquest_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    soundEngine.enabled = soundOn;
    localStorage.setItem('mindquest_sound', String(soundOn));
  }, [soundOn]);

  useEffect(() => {
    localStorage.setItem('mindquest_player_name', playerName || 'دانش‌پژوه');
  }, [playerName]);

  // وضعیت برای تست‌پذیری
  useEffect(() => {
    if (activeTab === 'multiplayer' && mp.room) {
      document.body.dataset.state = mp.room.phase;
    } else {
      document.body.dataset.state = soloPhase === 'setup' ? 'title' : soloPhase;
    }
  }, [activeTab, mp.room, soloPhase]);

  // شروع خودکار با پارامتر ?autostart=1
  const startSoloQuiz = useCallback(
    (overrideCount?: number) => {
      const selected = selectQuizQuestions(
        QUIZ_QUESTIONS,
        difficulty,
        overrideCount ?? questionCount,
        topicFilter
      );
      const firstQ = selected[0];
      const firstTime = getTimePerQuestion(firstQ?.difficulty || 'medium');

      setQuestions(selected);
      setCurrentIdx(0);
      setScore(0);
      setStreak(0);
      setCorrectCount(0);
      setWrongCount(0);
      setTimeoutCount(0);
      setSelectedIdx(null);
      setIsAnswered(false);
      setIsNewRecord(false);
      setHistory([]);
      setFiftyFiftyLeft(2);
      setExtraTimeLeft(1);
      setEliminatedIndices([]);
      setTotalQTime(firstTime);
      setTimeLeft(firstTime);
      soloDeadlinePerfRef.current = performance.now() + firstTime * 1000;
      lastTickSecondRef.current = -1;
      setSoloPhase('playing');
      soundEngine.click();
    },
    [difficulty, questionCount, topicFilter]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      startSoloQuiz(5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSoloQ = questions[currentIdx];

  const finishSoloQuiz = useCallback(
    (finalScore: number, finalCorrect: number, totalQ: number) => {
      setSoloPhase('results');
      soundEngine.victory();

      const acc = calculateAccuracy(finalCorrect, totalQ);
      const bestExisting = records.length > 0 ? Math.max(...records.map((r) => r.score)) : 0;
      setIsNewRecord(finalScore > 0 && finalScore > bestExisting);

      const updated = saveRecordToList(records, {
        name: playerName.trim() || 'دانش‌پژوه',
        score: finalScore,
        accuracy: acc,
        difficulty: DIFF_LABELS[difficulty],
      });
      setRecords(updated);
      localStorage.setItem('mindquest_records', JSON.stringify(updated));
    },
    [difficulty, playerName, records]
  );

  // تایمر دقیق بازی تک‌نفره بر پایه ساعت یکنواخت (بدون انحراف در موبایل)
  useEffect(() => {
    if (activeTab !== 'solo' || soloPhase !== 'playing' || isAnswered || !currentSoloQ) {
      return;
    }

    if (soloDeadlinePerfRef.current <= 0) {
      soloDeadlinePerfRef.current = performance.now() + timeLeft * 1000;
    }

    const id = setInterval(() => {
      const remMs = Math.max(0, soloDeadlinePerfRef.current - performance.now());
      const next = +(remMs / 1000).toFixed(1);
      setTimeLeft(next);
      const ceilSec = Math.ceil(next);
      if (ceilSec <= 5 && ceilSec > 0 && ceilSec !== lastTickSecondRef.current) {
        lastTickSecondRef.current = ceilSec;
        soundEngine.tick();
      }
      if (next <= 0) {
        clearInterval(id);
        setIsAnswered(true);
        setStreak(0);
        setTimeoutCount((c) => c + 1);
        soundEngine.timeout();
        setHistory((h) => [
          ...h,
          {
            question: currentSoloQ.question,
            selectedOption: 'بدون پاسخ (اتمام وقت)',
            correctOption: currentSoloQ.options[currentSoloQ.correctIndex],
            isCorrect: false,
            isTimeout: true,
            explanation: currentSoloQ.explanation,
          },
        ]);
      }
    }, 100);

    return () => clearInterval(id);
  }, [activeTab, soloPhase, isAnswered, currentSoloQ]);

  const handleSelectSoloOption = useCallback(
    (idx: number) => {
      if (isAnswered || !currentSoloQ || eliminatedIndices.includes(idx)) return;
      setSelectedIdx(idx);
      setIsAnswered(true);

      const isCorrect = idx === currentSoloQ.correctIndex;
      setHistory((h) => [
        ...h,
        {
          question: currentSoloQ.question,
          selectedOption: currentSoloQ.options[idx],
          correctOption: currentSoloQ.options[currentSoloQ.correctIndex],
          isCorrect,
          isTimeout: false,
          explanation: currentSoloQ.explanation,
        },
      ]);

      if (isCorrect) {
        const nextStreak = streak + 1;
        setStreak(nextStreak);
        setCorrectCount((c) => c + 1);
        const { earnedScore, multiplier } = calculateQuestionScore({
          isCorrect: true,
          difficulty: currentSoloQ.difficulty,
          timeLeft,
          totalTime: totalQTime,
          currentStreak: nextStreak,
        });
        setScore((s) => s + earnedScore);
        soundEngine.correct(nextStreak, idx);
        setFloatingPopup({
          id: Date.now(),
          text:
            multiplier > 1
              ? `+${earnedScore} امتیاز! 🔥 ضریب ${multiplier}x`
              : `+${earnedScore} امتیاز!`,
        });
      } else {
        setStreak(0);
        setWrongCount((w) => w + 1);
        soundEngine.wrong(idx);
      }
    },
    [currentSoloQ, eliminatedIndices, isAnswered, streak, timeLeft, totalQTime]
  );

  const handleNextSoloQuestion = useCallback(() => {
    soundEngine.click();
    const nextIndex = currentIdx + 1;
    if (nextIndex >= questions.length) {
      finishSoloQuiz(score, correctCount, questions.length);
      return;
    }
    const nextQ = questions[nextIndex];
    const nextTime = getTimePerQuestion(nextQ.difficulty);
    setCurrentIdx(nextIndex);
    setSelectedIdx(null);
    setIsAnswered(false);
    setEliminatedIndices([]);
    setTotalQTime(nextTime);
    setTimeLeft(nextTime);
    soloDeadlinePerfRef.current = performance.now() + nextTime * 1000;
    lastTickSecondRef.current = -1;
  }, [correctCount, currentIdx, finishSoloQuiz, questions, score]);

  const useFiftyFifty = () => {
    if (fiftyFiftyLeft <= 0 || isAnswered || !currentSoloQ || eliminatedIndices.length > 0) return;
    const wrongIndices = [0, 1, 2, 3].filter((i) => i !== currentSoloQ.correctIndex);
    // بر زدن و حذف ۲ گزینه غلط
    for (let i = wrongIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrongIndices[i], wrongIndices[j]] = [wrongIndices[j], wrongIndices[i]];
    }
    setEliminatedIndices(wrongIndices.slice(0, 2));
    setFiftyFiftyLeft((n) => n - 1);
    soundEngine.powerup();
  };

  const useExtraTime = () => {
    if (extraTimeLeft <= 0 || isAnswered) return;
    soloDeadlinePerfRef.current += 8000;
    const updatedRem = Math.max(0, +((soloDeadlinePerfRef.current - performance.now()) / 1000).toFixed(1));
    setTimeLeft(updatedRem);
    setTotalQTime((tot) => Math.max(tot, updatedRem));
    setExtraTimeLeft((n) => n - 1);
    soundEngine.powerup();
  };

  // میانبرهای صفحه‌کلید در حالت تک‌نفره
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRecordsOpen(false);
        setReviewOpen(false);
        return;
      }
      if (activeTab !== 'solo') return;

      if (soloPhase === 'playing') {
        if (!isAnswered) {
          const num = parseInt(e.key, 10);
          if (num >= 1 && num <= 4) {
            handleSelectSoloOption(num - 1);
          }
        } else if (e.key === 'Enter') {
          handleNextSoloQuestion();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, handleNextSoloQuestion, handleSelectSoloOption, isAnswered, soloPhase]);

  // تعیین پس‌زمینه پویا متناسب با سؤال فعلی!
  const activeBgTheme: BgTheme = useMemo(() => {
    if (activeTab === 'multiplayer' && mp.room?.currentQuestion) {
      return mp.room.currentQuestion.bgTheme;
    }
    if (activeTab === 'solo' && soloPhase === 'playing' && currentSoloQ) {
      return currentSoloQ.bgTheme;
    }
    if (topicFilter !== 'all') {
      return topicFilter as BgTheme;
    }
    return 'space';
  }, [activeTab, currentSoloQ, mp.room?.currentQuestion, soloPhase, topicFilter]);

  const activeBgImageKey: BgImageKey = useMemo(() => {
    if (activeTab === 'multiplayer' && mp.room?.currentQuestion) {
      return mp.room.currentQuestion.bgImageKey;
    }
    if (activeTab === 'solo' && soloPhase === 'playing' && currentSoloQ) {
      return currentSoloQ.bgImageKey;
    }
    if (topicFilter !== 'all') {
      return topicFilter as BgTheme;
    }
    return 'space';
  }, [activeTab, currentSoloQ, mp.room?.currentQuestion, soloPhase, topicFilter]);

  const activeBgMotif: string | undefined = useMemo(() => {
    if (activeTab === 'multiplayer' && mp.room?.currentQuestion) {
      return mp.room.currentQuestion.motifLabel;
    }
    if (activeTab === 'solo' && soloPhase === 'playing' && currentSoloQ) {
      return currentSoloQ.motifLabel;
    }
    return undefined;
  }, [activeTab, currentSoloQ, mp.room?.currentQuestion, soloPhase]);

  const soloAccuracy = calculateAccuracy(correctCount, questions.length);
  const soloFeedback = getPerformanceFeedback(soloAccuracy);
  const activeMultiplier = getStreakMultiplier(streak);
  const currentSoloVisual = currentSoloQ ? THEME_VISUALS[currentSoloQ.bgTheme] : THEME_VISUALS.space;

  return (
    <div className="relative flex min-h-screen flex-col text-slate-900 dark:text-slate-100">
      {/* پس‌زمینه هوشمند و اختصاصی متناسب با هر سؤال */}
      <DynamicBackdrop
        theme={activeBgTheme}
        imageKey={activeBgImageKey}
        motifLabel={activeBgMotif}
        isUrgent={
          activeTab === 'solo'
            ? soloPhase === 'playing' && !isAnswered && timeLeft <= 5 && timeLeft > 0
            : false
        }
      />

      {/* نوار بالای صفحه (Top Bar Contract) */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/75">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          {/* Brand */}
          <button
            type="button"
            onClick={() => {
              if (mp.room) mp.leaveRoom();
              setSoloPhase('setup');
              setActiveTab('solo');
            }}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 text-right"
            aria-label="بازگشت به صفحه اصلی MindQuest"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/25">
              <Lightbulb className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="font-display-num text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              MindQuest
            </span>
          </button>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setRecordsOpen(true)}
              aria-label="مشاهده برترین رکوردهای بازیکنان"
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 text-xs font-bold text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-indigo-500 dark:hover:text-indigo-400 whitespace-nowrap"
            >
              <Trophy className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <span className="hidden sm:inline">برترین رکوردها</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                soundEngine.setEnabled(next);
              }}
              aria-label={soundOn ? 'قطع صدای بازی' : 'وصل صدای بازی'}
              title={soundOn ? 'قطع صدا' : 'وصل صدا'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-indigo-500"
            >
              {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4 text-slate-400" />}
            </button>

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? 'تغییر به حالت روز' : 'تغییر به حالت شب'}
              title={darkMode ? 'حالت روز' : 'حالت شب'}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/80 text-slate-700 transition-colors hover:border-indigo-400 hover:text-indigo-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-indigo-500"
            >
              {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* بخش اصلی محتوا */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
        {/* سوئیچ حالت بازی (فقط در صفحه اول یا لابی بدون اتاق فعال) */}
        {(soloPhase === 'setup' && !mp.room) && (
          <div className="mb-6 inline-flex rounded-2xl border border-slate-200/80 bg-white/85 p-1.5 shadow-lg backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/85">
            <button
              type="button"
              onClick={() => setActiveTab('solo')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all whitespace-nowrap sm:text-sm ${
                activeTab === 'solo'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <Gamepad2 className="h-4 w-4" aria-hidden="true" />
              <span>بازی تک‌نفره</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('multiplayer')}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all whitespace-nowrap sm:text-sm ${
                activeTab === 'multiplayer'
                  ? 'bg-gradient-to-l from-indigo-600 to-cyan-600 text-white shadow-md shadow-indigo-600/25'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              <span>مسابقه چندنفره تحت شبکه</span>
            </button>
          </div>
        )}

        {/* ==================== حالت چندنفره تحت شبکه ==================== */}
        {activeTab === 'multiplayer' && (
          <>
            {!mp.room || mp.room.phase === 'waiting' ? (
              <MultiplayerLobby
                connected={mp.connected}
                playerId={mp.playerId}
                playerName={playerName}
                onPlayerNameChange={setPlayerName}
                avatar={avatar}
                onAvatarChange={setAvatar}
                color={playerColor}
                onColorChange={setPlayerColor}
                room={mp.room}
                publicRooms={mp.publicRooms}
                cheers={mp.cheers}
                error={mp.error}
                initialJoinCode={initialRoomCode}
                onClearError={mp.clearError}
                onCreateRoom={(settings) =>
                  mp.createRoom({
                    playerName,
                    avatar,
                    color: playerColor,
                    settings,
                  })
                }
                onJoinRoom={(code) =>
                  mp.joinRoom({
                    code,
                    playerName,
                    avatar,
                    color: playerColor,
                  })
                }
                onLeaveRoom={mp.leaveRoom}
                onUpdateSettings={mp.updateSettings}
                onStartMatch={mp.startMatch}
                onSendCheer={mp.sendCheer}
              />
            ) : (
              <MultiplayerArena
                room={mp.room}
                playerId={mp.playerId}
                onSubmitAnswer={mp.submitAnswer}
                onNextQuestion={mp.nextQuestion}
                onRematch={mp.rematch}
                onLeaveRoom={mp.leaveRoom}
              />
            )}
          </>
        )}

        {/* ==================== حالت تک‌نفره: تنظیمات شروع ==================== */}
        {activeTab === 'solo' && soloPhase === 'setup' && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            aria-labelledby="welcome-heading"
            className="w-full max-w-3xl rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-2xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 sm:p-8"
          >
            <div className="mb-6 text-center">
              <div className="mb-2 flex items-center justify-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <span>۱۸۰ سؤال آموزشی در ۶ قلمرو با پس‌زمینه اختصاصی</span>
              </div>
              <h1
                id="welcome-heading"
                className="text-2xl font-extrabold text-slate-900 dark:text-white sm:text-3xl"
              >
                به چالش دانایی MindQuest خوش آمدید
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-300">
                با سرعت و دقت پاسخ دهید، ضریب استریک را فعال کنید و از ابزارهای کمکی برای ثبت رکورد جدید بهره ببرید.
              </p>
            </div>

            <div className="mb-6 space-y-5 rounded-2xl border border-slate-200/80 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-950/60">
              {/* نام بازیکن */}
              <div>
                <label
                  htmlFor="solo-player-name"
                  className="mb-1.5 block text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  نام بازیکن
                </label>
                <input
                  id="solo-player-name"
                  type="text"
                  maxLength={20}
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="نام یا لقب خود را بنویسید..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </div>

              {/* سطح دشواری */}
              <div>
                <div className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                  انتخاب سطح سختی
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="سطح سختی بازی">
                  {(
                    [
                      { id: 'all', title: 'همه سطوح', sub: 'ترکیبی و جامع' },
                      { id: 'easy', title: 'آسان', sub: '۲۵ ثانیه · ۱۰۰ امتیاز' },
                      { id: 'medium', title: 'متوسط', sub: '۲۰ ثانیه · ۲۰۰ امتیاز' },
                      { id: 'hard', title: 'سخت', sub: '۱۵ ثانیه · ۳۰۰ امتیاز' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setDifficulty(item.id)}
                      className={`flex flex-col items-center rounded-xl border px-3 py-2.5 transition-all ${
                        difficulty === item.id
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/25'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                    >
                      <span className="text-sm font-extrabold">{item.title}</span>
                      <span
                        className={`mt-0.5 text-[11px] ${
                          difficulty === item.id ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* انتخاب موضوع / پس‌زمینه */}
              <div>
                <div className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                  موضوع سؤالات (تغییر فضای بصری)
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="فیلتر موضوعی">
                  {TOPIC_OPTIONS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTopicFilter(t.id)}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors whitespace-nowrap ${
                        topicFilter === t.id
                          ? 'border-indigo-500 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* تعداد سؤالات */}
              <div>
                <div className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                  تعداد سؤالات این دور
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="تعداد سؤالات">
                  {[
                    { count: 5, label: '۵ سؤال', sub: 'سریع' },
                    { count: 10, label: '۱۰ سؤال', sub: 'استاندارد' },
                    { count: 15, label: '۱۵ سؤال', sub: 'کامل' },
                    { count: 20, label: '۲۰ سؤال', sub: 'ماراتن' },
                  ].map((item) => (
                    <button
                      key={item.count}
                      type="button"
                      onClick={() => setQuestionCount(item.count)}
                      className={`flex flex-col items-center rounded-xl border px-2 py-2 transition-all ${
                        questionCount === item.count
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                      }`}
                    >
                      <span className="text-xs font-extrabold sm:text-sm">{item.label}</span>
                      <span
                        className={`mt-0.5 text-[10px] sm:text-[11px] ${
                          questionCount === item.count ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              data-start="true"
              onClick={() => startSoloQuiz()}
              className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-l from-indigo-600 via-violet-600 to-indigo-600 px-6 py-4 text-base font-extrabold text-white shadow-xl shadow-indigo-600/30 transition-all hover:brightness-110 active:scale-[0.99]"
            >
              <span>شروع مسابقه تک‌نفره</span>
              <Zap className="h-5 w-5 fill-current" aria-hidden="true" />
            </button>
          </motion.section>
        )}

        {/* ==================== حالت تک‌نفره: حین بازی ==================== */}
        {activeTab === 'solo' && soloPhase === 'playing' && currentSoloQ && (
          <motion.section
            key={`solo-q-${currentSoloQ.id}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            aria-labelledby="solo-question-text"
            className="relative w-full max-w-3xl rounded-3xl border border-slate-200/80 bg-white/92 p-5 shadow-2xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 sm:p-8"
          >
            {/* Floating Score Popup */}
            <AnimatePresence>
              {floatingPopup && (
                <div
                  key={floatingPopup.id}
                  className="animate-float-score pointer-events-none absolute top-14 left-8 z-30 rounded-xl bg-emerald-500 px-3.5 py-1.5 text-sm font-extrabold text-white shadow-lg"
                >
                  {floatingPopup.text}
                </div>
              )}
            </AnimatePresence>

            {/* نوار وضعیت HUD */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span className="font-bold text-slate-900 dark:text-white">
                  سؤال {currentIdx + 1} از {questions.length}
                </span>
                <span aria-hidden="true">·</span>
                <span className={`font-bold ${currentSoloVisual.badgeClasses}`}>
                  {currentSoloQ.categoryLabel}
                </span>
                <span aria-hidden="true">·</span>
                <span>{DIFF_LABELS[currentSoloQ.difficulty]}</span>
              </div>

              <div className="flex items-center gap-2.5">
                <div
                  className={`flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-extrabold ${
                    streak >= 3
                      ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30'
                      : 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                  }`}
                  title="پاسخ‌های متوالی درست"
                >
                  <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="font-display-num">{streak}</span>
                  {activeMultiplier > 1 && (
                    <span className="font-display-num mr-0.5 text-[11px]">({activeMultiplier}x)</span>
                  )}
                </div>

                <div className="font-display-num rounded-xl bg-indigo-600/15 px-3 py-1 text-xs font-extrabold text-indigo-600 dark:text-indigo-300">
                  {score.toLocaleString('fa-IR')} امتیاز
                </div>
              </div>
            </div>

            {/* تایمر دایره‌ای + ابزارهای کمکی */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-[200px] flex-1">
                <CircularTimer timeLeft={timeLeft} totalTime={totalQTime} />
              </div>

              {/* ابزارهای کمکی تاکتیکی */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={fiftyFiftyLeft <= 0 || isAnswered || eliminatedIndices.length > 0}
                  onClick={useFiftyFifty}
                  title="حذف دو گزینه نادرست"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100/90 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:border-indigo-400 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-400 whitespace-nowrap"
                >
                  <ShieldQuestion className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                  <span>۵۰/۵۰ ({fiftyFiftyLeft})</span>
                </button>

                <button
                  type="button"
                  disabled={extraTimeLeft <= 0 || isAnswered}
                  onClick={useExtraTime}
                  title="افزودن ۸ ثانیه به تایمر"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100/90 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:border-cyan-400 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-cyan-400 whitespace-nowrap"
                >
                  <Clock className="h-4 w-4 text-cyan-500" aria-hidden="true" />
                  <span>+۸ ثانیه ({extraTimeLeft})</span>
                </button>
              </div>
            </div>

            {/* موضوع بصری و متن سؤال */}
            <div className="mb-6">
              <div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                فضای موضوعی: {currentSoloQ.motifLabel}
              </div>
              <h2
                id="solo-question-text"
                className="text-lg font-extrabold leading-relaxed text-slate-900 dark:text-white sm:text-xl"
              >
                {currentSoloQ.question}
              </h2>
            </div>

            {/* چهار گزینه */}
            <div className="space-y-3" role="group" aria-label="گزینه‌های پاسخ">
              {currentSoloQ.options.map((opt, idx) => {
                const isEliminated = eliminatedIndices.includes(idx);
                const isCorrectOpt = isAnswered && idx === currentSoloQ.correctIndex;
                const isWrongChosen = isAnswered && selectedIdx === idx && idx !== currentSoloQ.correctIndex;

                let btnClass =
                  'border-slate-200 bg-slate-50/90 text-slate-800 hover:border-indigo-500 hover:bg-indigo-50/70 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/40';
                if (isEliminated) {
                  btnClass =
                    'border-slate-200/40 bg-slate-100/40 text-slate-400 opacity-35 line-through dark:border-slate-800/40 dark:bg-slate-900/30';
                } else if (isCorrectOpt) {
                  btnClass =
                    'border-emerald-500 bg-emerald-50 text-emerald-900 shadow-sm dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-100';
                } else if (isWrongChosen) {
                  btnClass =
                    'border-red-500 bg-red-50 text-red-900 animate-wrong-shake dark:border-red-500 dark:bg-red-950/60 dark:text-red-100';
                }

                return (
                  <motion.button
                    key={idx}
                    type="button"
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    disabled={isAnswered || isEliminated}
                    onClick={() => handleSelectSoloOption(idx)}
                    aria-label={`گزینه ${OPTION_LETTERS[idx]}: ${opt}`}
                    className={`flex min-h-[52px] w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3 text-right text-sm font-semibold transition-all disabled:cursor-default sm:text-base ${btnClass}`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${
                        isCorrectOpt
                          ? 'bg-emerald-500 text-white'
                          : isWrongChosen
                            ? 'bg-red-500 text-white'
                            : 'bg-white text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {OPTION_LETTERS[idx]}
                    </span>
                    <span className="flex-1">{opt}</span>
                    {isCorrectOpt && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />}
                    {isWrongChosen && <XCircle className="h-5 w-5 shrink-0 text-red-500" />}
                  </motion.button>
                );
              })}
            </div>

            {/* کارت توضیح آموزشی پس از پاسخ */}
            <AnimatePresence>
              {isAnswered && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/70"
                >
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-extrabold">
                    {selectedIdx === currentSoloQ.correctIndex ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        ✓ کاملاً درست پاسخ دادید!
                      </span>
                    ) : selectedIdx === null ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        ⏰ زمان به پایان رسید! پاسخ درست: «{currentSoloQ.options[currentSoloQ.correctIndex]}»
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">
                        ✕ نادرست! پاسخ درست: «{currentSoloQ.options[currentSoloQ.correctIndex]}»
                      </span>
                    )}
                  </div>

                  <p className="mb-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300 sm:text-sm">
                    {currentSoloQ.explanation}
                  </p>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleNextSoloQuestion}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-md shadow-indigo-600/25 transition-all hover:bg-indigo-500"
                    >
                      <span>{currentIdx + 1 >= questions.length ? 'مشاهده کارنامه نهایی' : 'سؤال بعدی'}</span>
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        )}

        {/* ==================== حالت تک‌نفره: کارنامه نهایی ==================== */}
        {activeTab === 'solo' && soloPhase === 'results' && (
          <motion.section
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            aria-labelledby="solo-results-title"
            className="w-full max-w-2xl rounded-3xl border border-slate-200/80 bg-white/92 p-6 text-center shadow-2xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 sm:p-8"
          >
            <ConfettiBurst active={soloAccuracy >= 60} />

            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30">
              <Trophy className="h-8 w-8" aria-hidden="true" />
            </div>

            <h2 id="solo-results-title" className="text-2xl font-extrabold text-slate-900 dark:text-white">
              پایان مسابقه MindQuest
            </h2>
            <p className="mt-1 text-sm font-bold text-indigo-600 dark:text-indigo-400">
              {soloFeedback.title}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
              {soloFeedback.message}
            </p>

            {/* باکس امتیاز نهایی */}
            <div className="my-6 rounded-2xl border border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 via-cyan-500/10 to-transparent p-5">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                مجموع امتیاز {playerName}
              </div>
              <div className="font-display-num mt-1 text-4xl font-extrabold text-indigo-600 dark:text-indigo-400">
                {score.toLocaleString('fa-IR')}
              </div>
              {isNewRecord && (
                <div className="mt-2 inline-block rounded-lg bg-amber-400/20 px-3 py-1 text-xs font-extrabold text-amber-600 dark:text-amber-300">
                  🎉 رکورد جدید در مرورگر ثبت شد!
                </div>
              )}
            </div>

            {/* ماتریس آمار */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="font-display-num text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {correctCount}
                </div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">پاسخ صحیح</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="font-display-num text-xl font-extrabold text-red-600 dark:text-red-400">
                  {wrongCount}
                </div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">پاسخ نادرست</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="font-display-num text-xl font-extrabold text-amber-600 dark:text-amber-400">
                  {timeoutCount}
                </div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">اتمام وقت</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="font-display-num text-xl font-extrabold text-indigo-600 dark:text-indigo-400">
                  {soloAccuracy}%
                </div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">درصد دقت</div>
              </div>
            </div>

            {/* دکمه‌های اقدام */}
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => startSoloQuiz()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-500"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>شروع مجدد با همین تنظیمات</span>
              </button>

              <div className="grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setReviewOpen(true)}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <BookOpen className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                  <span>مرور پاسخ‌های این دور</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSoloPhase('setup')}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Settings className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  <span>تغییر تنظیمات یا حالت شبکه</span>
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </main>

      {/* مودال‌ها */}
      <RecordsModal
        open={recordsOpen}
        records={records}
        onClose={() => setRecordsOpen(false)}
        onClear={() => {
          localStorage.removeItem('mindquest_records');
          setRecords([]);
        }}
      />

      <ReviewModal open={reviewOpen} history={history} onClose={() => setReviewOpen(false)} />

      {/* فوتر */}
      <footer className="relative z-10 border-t border-slate-200/70 bg-white/70 py-3 text-center text-xs text-slate-500 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/70 dark:text-slate-400">
        MindQuest · پلتفرم کوییز آموزشی تک‌نفره و چندنفره تحت شبکه
      </footer>
    </div>
  );
}
