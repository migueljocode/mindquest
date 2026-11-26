import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Crown,
  Link2,
  LogOut,
  Play,
  Radio,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type {
  ClientRoomSnapshot,
  MultiplayerGameMode,
  PublicRoomSummary,
  RoomSettings,
} from '../../shared/multiplayerTypes.ts';
import type { DifficultyFilter } from '../../shared/quizLogic.ts';
import type { CheerEvent } from '../hooks/useMultiplayerSocket.ts';
import { PLAYER_AVATARS, PLAYER_COLORS } from '../utils/themeAssets.ts';

interface MultiplayerLobbyProps {
  connected: boolean;
  playerId: string | null;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  avatar: string;
  onAvatarChange: (avatar: string) => void;
  color: string;
  onColorChange: (color: string) => void;
  room: ClientRoomSnapshot | null;
  publicRooms: PublicRoomSummary[];
  cheers: CheerEvent[];
  error: string | null;
  initialJoinCode?: string;
  onClearError: () => void;
  onCreateRoom: (settings: Partial<RoomSettings>) => void;
  onJoinRoom: (code: string) => void;
  onLeaveRoom: () => void;
  onUpdateSettings: (settings: Partial<RoomSettings>) => void;
  onStartMatch: () => void;
  onSendCheer: (emoji: string) => void;
}

const DIFF_LABELS: Record<DifficultyFilter, string> = {
  all: 'همه سطوح',
  easy: 'آسان',
  medium: 'متوسط',
  hard: 'سخت',
};

export function MultiplayerLobby({
  connected,
  playerId,
  playerName,
  onPlayerNameChange,
  avatar,
  onAvatarChange,
  color,
  onColorChange,
  room,
  publicRooms,
  cheers,
  error,
  initialJoinCode = '',
  onClearError,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onUpdateSettings,
  onStartMatch,
  onSendCheer,
}: MultiplayerLobbyProps) {
  const [joinCode, setJoinCode] = useState(initialJoinCode);
  const [createDiff, setCreateDiff] = useState<DifficultyFilter>('all');
  const [createCount, setCreateCount] = useState<number>(10);
  const [createGameMode, setCreateGameMode] = useState<MultiplayerGameMode>('elimination');
  const [copiedType, setCopiedType] = useState<'code' | 'link' | 'lan' | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [httpsLanUrls, setHttpsLanUrls] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.protocol === 'file:') return;
    let active = true;
    fetch('/api/server-info')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { lanUrls?: string[]; httpsLanUrls?: string[] } | null) => {
        if (!active || !data) return;
        if (Array.isArray(data.lanUrls)) setLanUrls(data.lanUrls);
        if (Array.isArray(data.httpsLanUrls)) setHttpsLanUrls(data.httpsLanUrls);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const primaryLanUrl =
    (typeof window !== 'undefined' && window.location.protocol === 'https:' && httpsLanUrls[0]) ||
    lanUrls[0] ||
    null;

  const copyToClipboard = (text: string, type: 'code' | 'link' | 'lan') => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 1800);
  };

  // اگر بازیکن داخل اتاق انتظار است
  if (room && room.phase === 'waiting') {
    const me = room.players.find((p) => p.id === playerId);
    const isHost = Boolean(me?.isHost);
    const isLocalHost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '0.0.0.0');
    const shareBase = isLocalHost && primaryLanUrl ? primaryLanUrl : window.location.origin;
    const shareUrl = `${shareBase}/?room=${room.code}`;

    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative mx-auto w-full max-w-4xl rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-2xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 sm:p-8"
      >
        {/* Floating Cheers */}
        <div className="pointer-events-none absolute top-4 left-4 z-20 flex flex-col gap-2">
          <AnimatePresence>
            {cheers.map((c) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12 }}
                className="flex items-center gap-2 rounded-xl border border-indigo-500/30 bg-white/95 px-3 py-1.5 text-xs font-bold shadow-lg dark:bg-slate-800/95"
              >
                <span className="text-base">{c.emoji}</span>
                <span className="text-slate-700 dark:text-slate-200">{c.playerName}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Room Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              <span>اتاق انتظار مسابقه شبکه</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">کد اتاق:</h2>
              <span className="font-display-num rounded-xl bg-indigo-600 px-4 py-1 text-2xl font-extrabold tracking-widest text-white shadow-md">
                {room.code}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(room.code, 'code')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                {copiedType === 'code' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedType === 'code' ? 'کپی شد' : 'کپی کد'}</span>
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard(shareUrl, 'link')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
              >
                {copiedType === 'link' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5" />}
                <span>{copiedType === 'link' ? 'لینک کپی شد' : 'کپی لینک دعوت'}</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onLeaveRoom}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-950/70 whitespace-nowrap"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>خروج از اتاق</span>
          </button>
        </div>

        {primaryLanUrl && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-50/70 px-4 py-2.5 text-xs dark:border-cyan-500/25 dark:bg-cyan-950/30">
            <div className="flex flex-wrap items-center gap-2 text-cyan-900 dark:text-cyan-200">
              <Wifi className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
              <span className="font-bold">آدرس اتصال گوشی‌ها در شبکه:</span>
              <code dir="ltr" className="font-display-num rounded-lg bg-white/80 px-2.5 py-1 font-bold text-cyan-700 dark:bg-slate-900/80 dark:text-cyan-300">
                {shareUrl}
              </code>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(shareUrl, 'lan')}
              className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-cyan-500 whitespace-nowrap"
            >
              {copiedType === 'lan' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedType === 'lan' ? 'کپی شد' : 'کپی آدرس شبکه'}</span>
            </button>
          </div>
        )}

        {/* Main Grid: Players + Settings */}
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Players List */}
          <div className="lg:col-span-7">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
                <Users className="h-4 w-4 text-indigo-500" aria-hidden="true" />
                <span>بازیکنان متصل ({room.players.length})</span>
              </div>
              <div className="flex items-center gap-1.5">
                {['🔥', '⚡', '👏', '🧠'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onSendCheer(emoji)}
                    aria-label={`ارسال واکنش ${emoji}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-sm transition-transform hover:scale-110 active:scale-95 dark:border-slate-700 dark:bg-slate-800"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <AnimatePresence>
                {room.players.map((p) => (
                  <motion.div
                    key={p.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`flex items-center justify-between rounded-2xl border p-3 transition-colors ${
                      p.id === playerId
                        ? 'border-indigo-500/60 bg-indigo-50/70 dark:bg-indigo-950/35'
                        : 'border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl shadow-sm"
                        style={{ backgroundColor: `${p.color}22`, border: `2px solid ${p.color}` }}
                      >
                        {p.avatar}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 truncate text-sm font-bold text-slate-900 dark:text-white">
                          <span className="truncate">{p.name}</span>
                          {p.isHost && (
                            <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="میزبان" />
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {p.id === playerId ? 'شما' : p.isHost ? 'میزبان اتاق' : 'آماده رقابت'}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Match Configuration */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/90 p-5 dark:border-slate-800 dark:bg-slate-950/50 lg:col-span-5">
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">تنظیمات مسابقه</h3>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">سطح دشواری</div>
                <div className="grid grid-cols-2 gap-2">
                  {(['all', 'easy', 'medium', 'hard'] as DifficultyFilter[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ difficulty: d })}
                      className={`rounded-xl border px-3 py-2 text-xs font-bold transition-all whitespace-nowrap ${
                        room.settings.difficulty === d
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-400 disabled:opacity-65 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {DIFF_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">سناریوی مسابقه</div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'elimination', label: 'حذفی (حذف آخرین تیم)' },
                      { id: 'classic', label: 'کلاسیک (امتیازی)' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ gameMode: m.id })}
                      className={`rounded-xl border px-2 py-2 text-[11px] sm:text-xs font-bold leading-snug transition-all ${
                        room.settings.gameMode === m.id
                          ? 'border-rose-600 bg-rose-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-rose-400 disabled:opacity-65 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">تعداد سؤالات</div>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 15, 20].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      disabled={!isHost}
                      onClick={() => onUpdateSettings({ questionCount: cnt })}
                      className={`font-display-num rounded-xl border px-2 py-2 text-xs font-bold transition-all whitespace-nowrap ${
                        room.settings.questionCount === cnt
                          ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-400 disabled:opacity-65 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {cnt} سؤال
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6">
              {isHost ? (
                <button
                  type="button"
                  onClick={onStartMatch}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-indigo-600 to-violet-600 px-6 py-3.5 text-base font-extrabold text-white shadow-lg shadow-indigo-600/30 transition-all hover:brightness-110 active:scale-[0.98]"
                >
                  <Play className="h-5 w-5 fill-current" aria-hidden="true" />
                  <span>شروع مسابقه هم‌زمان</span>
                </button>
              ) : (
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-center text-xs font-semibold text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-300">
                  در انتظار شروع مسابقه توسط میزبان اتاق...
                </div>
              )}
              {room.players.length < 2 && isHost && (
                <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
                  کد اتاق را با دوستانتان در شبکه به اشتراک بگذارید (یا برای تست همین‌جا شروع کنید).
                </p>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // صفحه ورود یا ساخت اتاق چندنفره
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 dark:border-red-900/70 dark:bg-red-950/60 dark:text-red-300"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onClearError}
            className="rounded-lg px-2 py-1 text-xs underline hover:no-underline"
          >
            بستن
          </button>
        </div>
      )}

      {/* پروفایل بازیکن در شبکه */}
      <div className="rounded-3xl border border-slate-200/80 bg-white/90 p-5 shadow-xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
            مسابقه چندنفره تحت شبکه
          </h2>
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            {connected ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                متصل به سرور زنده
              </span>
            ) : typeof window !== 'undefined' && window.location.protocol === 'file:' ? (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                برای بازی چندنفره، فایل start-windows.bat یا سرور را اجرا کنید
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                در حال اتصال به سرور...
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-12 md:items-end">
          <div className="md:col-span-5">
            <label htmlFor="mp-player-name" className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              نام نمایشی شما در مسابقه
            </label>
            <input
              id="mp-player-name"
              type="text"
              value={playerName}
              onChange={(e) => onPlayerNameChange(e.target.value)}
              maxLength={20}
              placeholder="مثلاً: آوا، سهراب، کیهان"
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          <div className="md:col-span-3">
            <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">آواتار</div>
            <div className="grid w-fit grid-cols-4 gap-1.5">
              {PLAYER_AVATARS.map((av) => (
                <button
                  key={av}
                  type="button"
                  onClick={() => onAvatarChange(av)}
                  aria-label={`انتخاب آواتار ${av}`}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border text-lg transition-transform hover:scale-105 ${
                    avatar === av
                      ? 'border-indigo-500 bg-indigo-50 shadow-sm dark:bg-indigo-950/60'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/60'
                  }`}
                >
                  {av}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-4">
            <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">رنگ نمایه</div>
            <div className="flex flex-wrap items-center gap-2 pb-1.5">
              {PLAYER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onColorChange(c)}
                  aria-label={`انتخاب رنگ ${c}`}
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c ? 'border-slate-900 scale-110 dark:border-white' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        {primaryLanUrl && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-500/25 bg-cyan-50/60 px-4 py-2.5 text-xs dark:border-cyan-500/20 dark:bg-cyan-950/25">
            <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-200">
              <Wifi className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
              <span className="font-semibold">اتصال گوشی‌ها روی وای‌فای مشترک:</span>
              <code dir="ltr" className="font-display-num rounded-lg bg-white/90 px-2.5 py-1 font-bold text-cyan-700 dark:bg-slate-900/90 dark:text-cyan-300">
                {primaryLanUrl}
              </code>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(primaryLanUrl, 'lan')}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-white px-2.5 py-1 text-[11px] font-bold text-cyan-700 transition hover:bg-cyan-50 dark:bg-slate-900 dark:text-cyan-300 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              {copiedType === 'lan' ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedType === 'lan' ? 'کپی شد' : 'کپی آدرس'}</span>
            </button>
          </div>
        )}
      </div>

      {/* دو ستون: ایجاد اتاق جدید / پیوستن با کد */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* ایجاد اتاق */}
        <div className="flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
          <div>
            <div className="mb-3 flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-white">
              <Sparkles className="h-5 w-5 text-indigo-500" aria-hidden="true" />
              <span>ساخت اتاق جدید (میزبان)</span>
            </div>
            <p className="mb-4 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              یک اتاق اختصاصی بسازید و کد آن را به دوستان یا هم‌تیمی‌های متصل به شبکه بدهید.
            </p>

            <div className="mb-4 space-y-3">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">سطح سؤالات</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['all', 'easy', 'medium', 'hard'] as DifficultyFilter[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCreateDiff(d)}
                      className={`rounded-xl border py-2 text-xs font-bold transition-colors whitespace-nowrap ${
                        createDiff === d
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-200'
                      }`}
                    >
                      {DIFF_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">سناریوی رقابت</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'elimination', label: 'حذفی (حذف نفر/تیم آخر)' },
                      { id: 'classic', label: 'کلاسیک (بدون حذف)' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setCreateGameMode(m.id)}
                      className={`rounded-xl border px-2 py-2 text-[11px] sm:text-xs font-bold leading-snug transition-colors ${
                        createGameMode === m.id
                          ? 'border-rose-600 bg-rose-600 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-rose-400 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">تعداد سؤالات</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[5, 10, 15, 20].map((cnt) => (
                    <button
                      key={cnt}
                      type="button"
                      onClick={() => setCreateCount(cnt)}
                      className={`font-display-num rounded-xl border py-2 text-xs font-bold transition-colors whitespace-nowrap ${
                        createCount === cnt
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-400 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-200'
                      }`}
                    >
                      {cnt} سؤال
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={!connected}
            onClick={() =>
              onCreateRoom({
                difficulty: createDiff,
                questionCount: createCount,
                gameMode: createGameMode,
              })
            }
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-l from-indigo-600 to-violet-600 px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-indigo-600/25 transition-all hover:brightness-110 disabled:opacity-50"
          >
            <span>ایجاد اتاق مسابقه</span>
          </button>
        </div>

        {/* پیوستن با کد + اتاق‌های باز شبکه */}
        <div className="flex flex-col justify-between rounded-3xl border border-slate-200/80 bg-white/90 p-6 shadow-xl backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-900/90">
          <div>
            <div className="mb-3 flex items-center gap-2 text-base font-extrabold text-slate-900 dark:text-white">
              <Users className="h-5 w-5 text-cyan-500" aria-hidden="true" />
              <span>ورود به اتاق فعال</span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (joinCode.trim()) onJoinRoom(joinCode.trim());
              }}
              className="mb-5 flex gap-2"
            >
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                placeholder="کد ۴ حرفی اتاق (مثلاً A7K2)"
                aria-label="کد اتاق مسابقه"
                className="font-display-num w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-center text-sm font-bold tracking-widest uppercase text-slate-900 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="submit"
                disabled={!connected || !joinCode.trim()}
                className="shrink-0 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-extrabold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50 whitespace-nowrap"
              >
                ورود
              </button>
            </form>

            <div>
              <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                اتاق‌های در انتظار روی شبکه ({publicRooms.length})
              </div>
              {publicRooms.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  در حال حاضر اتاق بازی فعالی روی شبکه وجود ندارد. می‌توانید اولین اتاق را بسازید!
                </div>
              ) : (
                <div className="max-h-40 space-y-2 overflow-y-auto pr-0.5">
                  {publicRooms.map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => onJoinRoom(r.code)}
                      className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-right transition-colors hover:border-cyan-500 hover:bg-cyan-50/40 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-cyan-500/60"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          اتاق میزبان: {r.hostName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {r.gameMode === 'elimination' ? 'حالت حذفی' : 'کلاسیک'} · {DIFF_LABELS[r.difficulty]} · {r.questionCount} سؤال · {r.playerCount} بازیکن
                        </div>
                      </div>
                      <span className="font-display-num rounded-lg bg-cyan-600/15 px-2.5 py-1 text-xs font-extrabold text-cyan-600 dark:text-cyan-400">
                        {r.code}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
