import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Crown,
  Flame,
  LogOut,
  RotateCcw,
  ShieldAlert,
  Skull,
  Trophy,
  Users,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ClientRoomSnapshot } from '../../shared/multiplayerTypes.ts';
import { CircularTimer } from './CircularTimer.tsx';
import { ConfettiBurst } from './ConfettiBurst.tsx';
import { soundEngine } from '../utils/soundEngine.ts';
import { THEME_VISUALS } from '../utils/themeAssets.ts';

interface MultiplayerArenaProps {
  room: ClientRoomSnapshot;
  playerId: string | null;
  onSubmitAnswer: (idx: number) => void;
  onNextQuestion: () => void;
  onRematch: () => void;
  onLeaveRoom: () => void;
}

const OPTION_LETTERS = ['الف', 'ب', 'ج', 'د'];
const DIFF_LABELS: Record<string, string> = {
  easy: 'آسان',
  medium: 'متوسط',
  hard: 'سخت',
};

export function MultiplayerArena({
  room,
  playerId,
  onSubmitAnswer,
  onNextQuestion,
  onRematch,
  onLeaveRoom,
}: MultiplayerArenaProps) {
  const [timeLeft, setTimeLeft] = useState(room.totalQuestionTime);
  const [countdownSec, setCountdownSec] = useState(3);
  const [selectedLocalIdx, setSelectedLocalIdx] = useState<number | null>(null);
  const lastBeepRef = useRef<number>(-1);
  const lastPhaseRef = useRef<string>(room.phase);

  // هماهنگ‌سازی ساعت سرور با ساعت یکنواخت دستگاه (بدون وابستگی به ساعت/تاریخ گوشی!)
  const syncAnchorRef = useRef<{ remainingMs: number | null; receivedPerf: number }>({
    remainingMs: room.remainingMs,
    receivedPerf: typeof performance !== 'undefined' ? performance.now() : 0,
  });

  useEffect(() => {
    const serverRemaining =
      room.remainingMs !== null && room.remainingMs !== undefined
        ? room.remainingMs
        : room.phase === 'question' && room.questionEndsAt
          ? Math.max(0, room.questionEndsAt - (room.serverNow || Date.now()))
          : room.phaseEndsAt
            ? Math.max(0, room.phaseEndsAt - (room.serverNow || Date.now()))
            : null;

    syncAnchorRef.current = {
      remainingMs: serverRemaining,
      receivedPerf: performance.now(),
    };
  }, [room]);

  const me = room.players.find((p) => p.id === playerId);
  const isHost = Boolean(me?.isHost);
  const isEliminationMode = room.settings.gameMode === 'elimination';
  const amEliminated = Boolean(me?.isEliminated);

  // ریست انتخاب محلی هنگام رفتن به سؤال جدید
  useEffect(() => {
    setSelectedLocalIdx(null);
    lastBeepRef.current = -1;
  }, [room.currentQuestionIndex, room.phase === 'question']);

  // پخش افکت صوتی تغییر فاز
  useEffect(() => {
    if (lastPhaseRef.current !== room.phase) {
      if (room.phase === 'reveal' && me) {
        if (me.lastAnswerCorrect) {
          soundEngine.correct(me.streak, me.lastAnswerIndex ?? 0);
        } else if (me.lastAnswerIndex === null) {
          soundEngine.timeout();
        } else {
          soundEngine.wrong(me.lastAnswerIndex);
        }
      } else if (room.phase === 'finished') {
        soundEngine.victory();
      }
      lastPhaseRef.current = room.phase;
    }
  }, [room.phase, me]);

  // تایمر دقیق مستقل از ساعت سیستم گوشی یا کامپیوتر
  useEffect(() => {
    const tick = () => {
      const anchor = syncAnchorRef.current;
      const elapsedSinceSync = performance.now() - anchor.receivedPerf;
      const liveRemainingMs =
        anchor.remainingMs !== null ? Math.max(0, anchor.remainingMs - elapsedSinceSync) : 0;

      if (room.phase === 'countdown') {
        const rem = Math.max(1, Math.ceil(liveRemainingMs / 1000));
        setCountdownSec(rem);
      } else if (room.phase === 'question') {
        const rem = +(liveRemainingMs / 1000).toFixed(1);
        setTimeLeft(rem);
        const ceilRem = Math.ceil(rem);
        if (
          ceilRem <= 5 &&
          ceilRem > 0 &&
          ceilRem !== lastBeepRef.current &&
          !me?.hasAnsweredCurrent &&
          !amEliminated
        ) {
          lastBeepRef.current = ceilRem;
          soundEngine.tick();
        }
      }
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [room.phase, room.currentQuestionIndex, me?.hasAnsweredCurrent, amEliminated]);

  // کلیدهای میانبر ۱ تا ۴ در بازی چندنفره
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (room.phase === 'question' && !me?.hasAnsweredCurrent && !amEliminated) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 4) {
          setSelectedLocalIdx(num - 1);
          soundEngine.optionTap(num - 1);
          onSubmitAnswer(num - 1);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [room.phase, me?.hasAnsweredCurrent, amEliminated, onSubmitAnswer]);

  // فاز شمارش معکوس ۳-۲-۱
  if (room.phase === 'countdown') {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-2xl flex-col items-center justify-center text-center">
        <motion.div
          key={countdownSec}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          className="font-display-num mb-6 flex h-36 w-36 items-center justify-center rounded-full border-4 border-indigo-400/50 bg-indigo-600/25 text-7xl font-extrabold text-white shadow-2xl backdrop-blur-md"
        >
          {countdownSec}
        </motion.div>
        <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white">
          آماده شوید! مسابقه هم‌زمان تا لحظاتی دیگر آغاز می‌شود
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {isEliminationMode
            ? 'حالت حذفی فعال است: در پایان هر دور، تیم یا بازیکنِ رده آخر حذف می‌شود!'
            : 'پاسخ سریع‌تر = امتیاز بالاتر · پاسخ‌های متوالی درست = ضریب استریک!'}
        </p>
      </div>
    );
  }

  // فاز نتیجه نهایی و سکوی قهرمانی (Podium)
  if (room.phase === 'finished') {
    const sorted = [...room.players];
    const first = sorted[0];
    const second = sorted[1];
    const third = sorted[2];

    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto w-full max-w-4xl rounded-3xl border border-slate-200/80 bg-white/92 p-6 shadow-2xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/92 sm:p-8"
      >
        <ConfettiBurst active={true} />

        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/30">
            <Trophy className="h-8 w-8" />
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900 dark:text-white sm:text-3xl">
            {isEliminationMode && first
              ? `قهرمان رقابت حذفی: ${first.name}`
              : 'پایان رقابت شبکه MindQuest'}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            رتبه‌بندی نهایی تمامی بازیکنان حاضر در اتاق {room.code}
          </p>
        </div>

        {/* سکوی قهرمانی سه‌نفره */}
        <div className="mb-8 flex items-end justify-center gap-3 sm:gap-6">
          {second && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="flex w-28 flex-col items-center sm:w-36"
            >
              <div className="mb-2 text-3xl">{second.avatar}</div>
              <div className="mb-1 max-w-full truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                {second.name}
              </div>
              <div className="font-display-num mb-2 text-xs font-extrabold text-slate-500 dark:text-slate-400">
                {second.score.toLocaleString('fa-IR')} امتیاز
              </div>
              <div className="flex h-24 w-full flex-col items-center justify-center rounded-t-2xl border border-slate-300 bg-gradient-to-b from-slate-200 to-slate-300 text-slate-800 shadow-inner dark:border-slate-700 dark:from-slate-700 dark:to-slate-800 dark:text-white">
                <span className="font-display-num text-2xl font-extrabold">۲</span>
              </div>
            </motion.div>
          )}

          {first && (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="flex w-32 flex-col items-center sm:w-44"
            >
              <Crown className="mb-1 h-7 w-7 text-amber-500 drop-shadow" aria-hidden="true" />
              <div className="mb-2 text-4xl">{first.avatar}</div>
              <div className="mb-1 max-w-full truncate text-sm font-extrabold text-slate-900 dark:text-white">
                {first.name}
              </div>
              <div className="font-display-num mb-2 text-sm font-extrabold text-amber-600 dark:text-amber-400">
                {first.score.toLocaleString('fa-IR')} امتیاز
              </div>
              <div className="flex h-32 w-full flex-col items-center justify-center rounded-t-2xl border border-amber-400/60 bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-xl">
                <span className="font-display-num text-3xl font-extrabold">۱</span>
                <span className="text-[11px] font-bold">
                  {isEliminationMode ? 'قهرمان و بازمانده' : 'قهرمان'}
                </span>
              </div>
            </motion.div>
          )}

          {third && (
            <motion.div
              initial={{ opacity: 0, y: 25 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex w-28 flex-col items-center sm:w-36"
            >
              <div className="mb-2 text-3xl">{third.avatar}</div>
              <div className="mb-1 max-w-full truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                {third.name}
              </div>
              <div className="font-display-num mb-2 text-xs font-extrabold text-slate-500 dark:text-slate-400">
                {third.score.toLocaleString('fa-IR')} امتیاز
              </div>
              <div className="flex h-20 w-full flex-col items-center justify-center rounded-t-2xl border border-orange-300 bg-gradient-to-b from-orange-200 to-orange-400 text-orange-950 shadow-inner dark:border-orange-900/60 dark:from-orange-900/70 dark:to-orange-950 dark:text-orange-200">
                <span className="font-display-num text-2xl font-extrabold">۳</span>
              </div>
            </motion.div>
          )}
        </div>

        {/* جدول کامل رتبه‌بندی */}
        <div className="mb-6 space-y-2">
          {sorted.map((p, idx) => (
            <div
              key={p.id}
              className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                p.id === playerId
                  ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                  : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="font-display-num w-6 text-center text-sm font-extrabold text-slate-500 dark:text-slate-400">
                  #{idx + 1}
                </span>
                <span className="text-xl">{p.avatar}</span>
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <span>
                      {p.name} {p.id === playerId && '(شما)'}
                    </span>
                    {p.isEliminated && (
                      <span className="rounded-lg bg-rose-500/15 px-2 py-0.5 text-[10px] font-extrabold text-rose-600 dark:text-rose-400">
                        حذف در دور {p.eliminatedRound}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {p.correctCount} صحیح · {p.wrongCount} غلط · بیشترین استریک: {p.maxStreak}
                  </div>
                </div>
              </div>
              <div className="font-display-num text-base font-extrabold text-indigo-600 dark:text-indigo-400">
                {p.score.toLocaleString('fa-IR')}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {isHost ? (
            <button
              type="button"
              onClick={onRematch}
              className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-500"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>مسابقه مجدد در همین اتاق</span>
            </button>
          ) : (
            <div className="rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              در انتظار میزبان برای شروع مسابقه مجدد...
            </div>
          )}
          <button
            type="button"
            onClick={onLeaveRoom}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>بازگشت به صفحه اصلی</span>
          </button>
        </div>
      </motion.div>
    );
  }

  // فاز سؤال یا نمایش پاسخ و رتبه‌بندی بین دور
  const q = room.currentQuestion;
  if (!q) return null;

  const visual = THEME_VISUALS[q.bgTheme] || THEME_VISUALS.space;
  const isReveal = room.phase === 'reveal';
  const reveal = room.reveal;
  const answeredLocallyOrServer =
    amEliminated || Boolean(me?.hasAnsweredCurrent) || selectedLocalIdx !== null;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-12 lg:items-start">
      {/* کارت اصلی سؤال */}
      <motion.div
        key={`q-${q.id}`}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl border border-slate-200/80 bg-white/92 p-5 shadow-2xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 sm:p-7 lg:col-span-8"
      >
        {/* HUD */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            <span className="font-bold text-slate-900 dark:text-white">
              سؤال {room.currentQuestionIndex + 1} از {room.totalQuestions}
            </span>
            <span aria-hidden="true">·</span>
            <span className={`font-bold ${visual.badgeClasses}`}>{q.categoryLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{DIFF_LABELS[q.difficulty] || 'متوسط'}</span>
            {isEliminationMode && (
              <>
                <span aria-hidden="true">·</span>
                <span className="rounded-lg bg-rose-500/15 px-2 py-0.5 font-extrabold text-rose-600 dark:text-rose-400">
                  حالت حذفی ({room.activeCount} بازمانده)
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1 rounded-xl bg-orange-500/15 px-2.5 py-1 text-xs font-bold text-orange-600 dark:text-orange-400">
              <Flame className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="font-display-num">{me?.streak ?? 0}</span>
            </div>
            <div className="font-display-num rounded-xl bg-indigo-600/15 px-3 py-1 text-xs font-extrabold text-indigo-600 dark:text-indigo-300">
              {(me?.score ?? 0).toLocaleString('fa-IR')} امتیاز
            </div>
          </div>
        </div>

        {/* اعلان حالت تماشاگر برای بازیکن حذف‌شده */}
        {amEliminated && (
          <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-300">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              شما در دور {me?.eliminatedRound} حذف شدید؛ می‌توانید ادامه مسابقه و تعیین قهرمان را زنده تماشا کنید.
            </span>
          </div>
        )}

        {/* تایمر */}
        <div className="mb-5">
          <CircularTimer
            timeLeft={isReveal ? 0 : timeLeft}
            totalTime={room.totalQuestionTime}
          />
        </div>

        {/* موضوع تصویری + صورت سؤال */}
        <div className="mb-6">
          <div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
            فضای موضوعی: {q.motifLabel}
          </div>
          <h2 className="text-lg font-extrabold leading-relaxed text-slate-900 dark:text-white sm:text-xl">
            {q.question}
          </h2>
        </div>

        {/* گزینه‌ها */}
        <div className="space-y-3" role="group" aria-label="گزینه‌های پاسخ">
          {q.options.map((opt, idx) => {
            const isChosen = (me?.lastAnswerIndex ?? selectedLocalIdx) === idx;
            const isCorrectOpt = isReveal && reveal?.correctIndex === idx;
            const isWrongChosen = isReveal && isChosen && reveal?.correctIndex !== idx;

            let btnStyle =
              'border-slate-200 bg-slate-50/90 text-slate-800 hover:border-indigo-500 hover:bg-indigo-50/70 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-100 dark:hover:border-indigo-400 dark:hover:bg-indigo-950/40';
            if (isCorrectOpt) {
              btnStyle =
                'border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-100';
            } else if (isWrongChosen) {
              btnStyle =
                'border-red-500 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950/60 dark:text-red-100 animate-wrong-shake';
            } else if (isChosen && !isReveal) {
              btnStyle =
                'border-indigo-500 bg-indigo-50 text-indigo-900 ring-2 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-950/60 dark:text-indigo-100';
            }

            return (
              <motion.button
                key={`q-${q.id}-opt-${idx}`}
                type="button"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.05 }}
                disabled={answeredLocallyOrServer || isReveal}
                onClick={() => {
                  if (amEliminated) return;
                  setSelectedLocalIdx(idx);
                  soundEngine.optionTap(idx);
                  onSubmitAnswer(idx);
                }}
                className={`flex w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3.5 text-right text-sm font-semibold transition-all disabled:cursor-default sm:text-base ${btnStyle}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ${
                    isCorrectOpt
                      ? 'bg-emerald-500 text-white'
                      : isWrongChosen
                        ? 'bg-red-500 text-white'
                        : isChosen
                          ? 'bg-indigo-600 text-white'
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

        {/* وضعیت ثبت پاسخ یا کارت توضیح + اعلان حذف دور */}
        <AnimatePresence>
          {!isReveal && !amEliminated && answeredLocallyOrServer && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50/80 px-4 py-3 text-center text-xs font-bold text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300"
            >
              پاسخ شما ثبت شد! منتظر بقیه بازیکنان ({room.answeredCount} از {room.connectedCount} نفر پاسخ داده‌اند)
            </motion.div>
          )}

          {isReveal && reveal && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-sm font-extrabold ${
                    amEliminated
                      ? 'text-slate-600 dark:text-slate-300'
                      : me?.lastAnswerCorrect
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {amEliminated
                    ? 'حالت تماشاگر (حذف‌شده در دورهای قبل)'
                    : me?.lastAnswerCorrect
                      ? `عالی! (+${me.lastEarnedScore} امتیاز)`
                      : 'پاسخ نادرست یا اتمام زمان'}
                </span>
                {isHost && (
                  <button
                    type="button"
                    onClick={onNextQuestion}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-indigo-500"
                  >
                    <span>{reveal.matchWillFinish ? 'اعلام قهرمان' : 'سؤال بعدی'}</span>
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              {reveal.eliminatedThisRound && reveal.eliminatedThisRound.length > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-300/80 bg-rose-50 px-3 py-2 text-xs font-extrabold text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-300">
                  <Skull className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    حذف این دور:{' '}
                    {reveal.eliminatedThisRound
                      .map((e) => `${e.avatar} ${e.name} (${e.score.toLocaleString('fa-IR')} امتیاز)`)
                      .join('، ')}
                  </span>
                </div>
              )}

              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300 sm:text-sm">
                {reveal.explanation}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ستون جدول رتبه‌بندی زنده بازیکنان */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 lg:col-span-4">
        <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white">
            <Users className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            <span>جدول زنده مسابقه</span>
          </div>
          <span className="font-display-num text-xs font-semibold text-slate-500 dark:text-slate-400">
            {room.answeredCount}/{room.connectedCount} پاسخ
          </span>
        </div>

        <div className="space-y-2.5">
          {room.players.map((p, idx) => (
            <motion.div
              key={p.id}
              layout
              className={`flex items-center justify-between rounded-2xl border px-3 py-2.5 ${
                p.isEliminated
                  ? 'border-rose-200/60 bg-rose-50/40 opacity-65 dark:border-rose-950/60 dark:bg-rose-950/20'
                  : p.id === playerId
                    ? 'border-indigo-500/60 bg-indigo-50/70 dark:bg-indigo-950/40'
                    : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="font-display-num w-5 text-center text-xs font-extrabold text-slate-500 dark:text-slate-400">
                  {idx + 1}
                </span>
                <span className="text-lg">{p.avatar}</span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-900 dark:text-white">
                    {p.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {p.isEliminated
                      ? `حذف‌شده (دور ${p.eliminatedRound})`
                      : !p.connected
                        ? 'قطع ارتباط'
                        : isReveal
                          ? p.lastAnswerCorrect
                            ? `+${p.lastEarnedScore} امتیاز`
                            : 'بدون امتیاز'
                          : p.hasAnsweredCurrent
                            ? 'پاسخ داد ✓'
                            : 'در حال فکر...'}
                  </div>
                </div>
              </div>
              <span className="font-display-num text-sm font-extrabold text-indigo-600 dark:text-indigo-400">
                {p.score.toLocaleString('fa-IR')}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
