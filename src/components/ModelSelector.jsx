// AiG — ModelSelector.jsx
// Grouped model selector dropdown — Classical ML vs Deep Learning (Phase 3).
//
// Props:
//   value    — string  — currently selected model key
//   onChange — (value: string) => void
//   phase    — 'classical' | 'deep' | 'all'  (default: 'all')
//   disabled — bool (optional)
//   size     — 'sm' | 'md' (default: 'md')
//
// Consumed by: Classify.jsx, Detect.jsx, Settings.jsx (defaultModel select)

const CLASSICAL_MODELS = [
  { value: 'ensemble',           label: 'Ensemble (k-NN + Naïve Bayes)',  badge: 'recommended' },
  { value: 'knn',                label: 'k-NN (cosine similarity)'                              },
  { value: 'naiveBayes',         label: 'Naïve Bayes'                                           },
  { value: 'logisticRegression', label: 'Logistic Regression'                                   },
  { value: 'svm',                label: 'SVM (linear kernel)'                                   },
  { value: 'decisionTree',       label: 'Decision Tree'                                         },
  { value: 'randomForest',       label: 'Random Forest',                  badge: 'phase 2'      },
  { value: 'xgboost',            label: 'XGBoost',                        badge: 'phase 2'      },
];

const DEEP_MODELS = [
  { value: 'yolo',    label: 'YOLOv8 (object detection)', badge: 'phase 3' },
  { value: 'unet',    label: 'U-Net (segmentation)',       badge: 'phase 3' },
  { value: 'cnn',     label: 'CNN (classification)',        badge: 'phase 3' },
  { value: 'vae',     label: 'VAE (anomaly detection)',     badge: 'phase 3' },
];

const BADGE_STYLES = {
  recommended: 'bg-amber-100 text-[#C9971A]',
  'phase 2':   'bg-amber-500/20 text-amber-400',
  'phase 3':   'bg-violet-500/20 text-violet-600',
};

export default function ModelSelector({
  value,
  onChange,
  phase    = 'all',
  disabled = false,
  size     = 'md',
}) {
  const classical = phase !== 'deep'  ? CLASSICAL_MODELS : [];
  const deep      = phase !== 'classical' ? DEEP_MODELS : [];

  const sizeClass = size === 'sm'
    ? 'text-xs px-2.5 py-1.5'
    : 'text-sm px-3 py-2';

  // Find current label for display
  const all     = [...classical, ...deep];
  const current = all.find((m) => m.value === value);

  return (
    <div className="relative">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`w-full bg-[#F7F3D0] border border-[#E8DFA0] text-stone-700 rounded-lg
                    appearance-none cursor-pointer transition-colors
                    hover:border-[#E8DFA0] focus:outline-none focus:border-[#C9971A]
                    disabled:opacity-50 disabled:cursor-not-allowed
                    ${sizeClass}`}
      >
        {!value && (
          <option value="" disabled>Select model…</option>
        )}

        {classical.length > 0 && (
          <optgroup label="── Classical ML ──────────────">
            {classical.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}{m.badge ? `  [${m.badge}]` : ''}
              </option>
            ))}
          </optgroup>
        )}

        {deep.length > 0 && (
          <optgroup label="── Deep Learning (Phase 3) ───">
            {deep.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}{m.badge ? `  [${m.badge}]` : ''}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Chevron icon */}
      <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
        <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Badge for current selection */}
      {current?.badge && (
        <span className={`absolute right-8 top-1/2 -translate-y-1/2 text-xs px-1.5 py-0.5
                          rounded font-mono ${BADGE_STYLES[current.badge] ?? ''}`}>
          {current.badge}
        </span>
      )}
    </div>
  );
}
