interface CircularTimerProps {
  timeLeft: number;
  totalTime: number;
}

export function CircularTimer({ timeLeft, totalTime }: CircularTimerProps) {
  const safeTotal = Math.max(1, totalTime);
  const ratio = Math.max(0, Math.min(1, timeLeft / safeTotal));
  const secondsDisplay = Math.ceil(timeLeft);
  const isUrgent = secondsDisplay <= 5 && secondsDisplay > 0;
  const isWarning = secondsDisplay <= 10 && secondsDisplay > 5;

  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);

  const strokeColor = isUrgent
    ? '#ef4444'
    : isWarning
      ? '#f59e0b'
      : '#10b981';

  const barColorClass = isUrgent
    ? 'bg-red-500'
    : isWarning
      ? 'bg-amber-500'
      : 'bg-gradient-to-l from-indigo-500 via-cyan-400 to-emerald-400';

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`relative flex h-13 w-13 items-center justify-center ${isUrgent ? 'animate-pulse-urgent' : ''}`}>
            <svg className="h-13 w-13 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="4.5"
                className="text-slate-200 dark:text-slate-800"
              />
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="none"
                stroke={strokeColor}
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                className="transition-all duration-150 ease-linear"
              />
            </svg>
            <span
              className={`font-display-num absolute text-base font-extrabold ${
                isUrgent
                  ? 'text-red-500'
                  : isWarning
                    ? 'text-amber-500'
                    : 'text-slate-900 dark:text-white'
              }`}
            >
              {secondsDisplay}
            </span>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">زمان باقی‌مانده</div>
            <div
              className={`text-sm font-bold ${
                isUrgent ? 'text-red-500' : 'text-slate-800 dark:text-slate-200'
              }`}
            >
              {secondsDisplay > 0 ? `${secondsDisplay} ثانیه` : 'پایان زمان!'}
            </div>
          </div>
        </div>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800/80"
        role="progressbar"
        aria-label="زمان باقی‌مانده سؤال"
        aria-valuenow={secondsDisplay}
        aria-valuemin={0}
        aria-valuemax={totalTime}
      >
        <div
          className={`h-full rounded-full transition-all duration-150 ease-linear ${barColorClass}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
