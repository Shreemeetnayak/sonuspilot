import React from "react";
import { SoundFeedback } from "../services/learningService";

interface SoundFeedbackButtonsProps {
  onFeedback: (type: SoundFeedback) => void;
  disabled?: boolean;
}

export const SoundFeedbackButtons: React.FC<SoundFeedbackButtonsProps> = ({
  onFeedback,
  disabled = false,
}) => {
  const feedbackTypes: { type: SoundFeedback; label: string }[] = [
    { type: "flat", label: "Flat" },
    { type: "muddy", label: "Muddy" },
    { type: "sharp", label: "Sharp" },
    { type: "warm", label: "Warm" },
    { type: "neutral", label: "Neutral" },
  ];

  return (
    <div className="flex flex-col gap-1 p-2 bg-neutral-900 border border-neutral-800 rounded-lg">
      <span className="text-xs text-neutral-400 font-medium">Sound Feedback</span>
      <div className="flex gap-1">
        {feedbackTypes.map(({ type, label }) => (
          <button
            key={type}
            disabled={disabled}
            onClick={() => onFeedback(type)}
            className="px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded transition-colors disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};
