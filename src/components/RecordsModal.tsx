import { Trophy, Trash2, X } from 'lucide-react';
import type { GameRecord } from '../../shared/quizLogic.ts';

interface RecordsModalProps {
  open: boolean;
  records: GameRecord[];
  onClose: () => void;
  onClear: () => void;
}

export function RecordsModal({ open, records, onClose, onClear }: RecordsModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="records-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Trophy className="h-5 w-5 text-amber-500" aria-hidden="true" />
            <h3 id="records-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
              تالار افتخارات MindQuest
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره رکوردها"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {records.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              هنوز رکوردی ثبت نشده است. اولین مسابقه‌تان را به پایان برسانید!
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="pb-3 font-semibold">رتبه</th>
                    <th className="pb-3 font-semibold">نام بازیکن</th>
                    <th className="pb-3 font-semibold">امتیاز</th>
                    <th className="pb-3 font-semibold">دقت</th>
                    <th className="pb-3 font-semibold">سطح</th>
                    <th className="pb-3 font-semibold">تاریخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {records.map((rec, idx) => (
                    <tr key={rec.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-3">
                        <span
                          className={`font-display-num inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                            idx === 0
                              ? 'bg-amber-400/20 text-amber-600 dark:text-amber-300'
                              : idx === 1
                                ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                                : idx === 2
                                  ? 'bg-orange-400/20 text-orange-600 dark:text-orange-300'
                                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-3 font-semibold text-slate-900 dark:text-white">{rec.name}</td>
                      <td className="font-display-num py-3 font-bold text-indigo-600 dark:text-indigo-400">
                        {rec.score.toLocaleString('fa-IR')}
                      </td>
                      <td className="font-display-num py-3 text-slate-600 dark:text-slate-300">
                        {rec.accuracy}%
                      </td>
                      <td className="py-3 text-slate-600 dark:text-slate-300">{rec.difficulty}</td>
                      <td className="py-3 text-xs text-slate-500 dark:text-slate-400">{rec.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {records.length > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-900/80">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              ذخیره‌شده به صورت خودکار در مرورگر شما
            </span>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50 whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>پاک‌سازی رکوردها</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
