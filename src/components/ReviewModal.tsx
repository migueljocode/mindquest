import { BookOpen, CheckCircle2, Clock, X, XCircle } from 'lucide-react';

export interface HistoryItem {
  question: string;
  selectedOption: string;
  correctOption: string;
  isCorrect: boolean;
  isTimeout: boolean;
  explanation: string;
}

interface ReviewModalProps {
  open: boolean;
  history: HistoryItem[];
  onClose: () => void;
}

export function ReviewModal({ open, history, onClose }: ReviewModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-5 w-5 text-indigo-500" aria-hidden="true" />
            <h3 id="review-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
              مرور پاسخ‌ها و نکات آموزشی
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن پنجره مرور"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {history.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
              سؤالی برای مرور ثبت نشده است.
            </div>
          ) : (
            history.map((item, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60"
              >
                <div className="mb-2.5 text-sm font-bold text-slate-900 dark:text-white">
                  {idx + 1}. {item.question}
                </div>
                <div className="mb-2.5 space-y-1 text-xs">
                  <div
                    className={`flex items-center gap-1.5 font-semibold ${
                      item.isCorrect
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : item.isTimeout
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {item.isCorrect ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                    ) : item.isTimeout ? (
                      <Clock className="h-4 w-4 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 shrink-0" />
                    )}
                    <span>پاسخ شما: {item.selectedOption}</span>
                  </div>
                  {!item.isCorrect && (
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                      پاسخ صحیح: {item.correctOption}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">نکته آموزشی: </span>
                  {item.explanation}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
