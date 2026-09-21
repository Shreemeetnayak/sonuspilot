import { useState, useRef, useEffect, useCallback } from "react";
import "./EQChatAssistant.css";
import { addUserFeedback, getUserFeedback, applyFeedbackCorrections, type UserFeedback, type FeedbackRating, type TastePreferences } from "../services/cloudEqService";
import { ISO_BANDS, type TastePreferences as TastePreferencesType } from "./Equalizer31Band";

/** Map natural language to feedback ratings */
const FEEDBACK_KEYWORDS: Record<FeedbackRating, string[]> = {
  flat: ["flat", "lifeless", "dull", "boring", "no energy", "dead"],
  muddy: ["muddy", "muddled", "muffled", "boomy", "unclear", "bloated", "congested", "thick"],
  sharp: ["sharp", "harsh", "piercing", "shrill", "sibilant", "bright", "fatiguing", "ear-piercing", "edgy"],
  warm: ["warm", "dark", "bass-heavy", "thick", "full", "heavy"],
  neutral: ["neutral", "balanced", "reference", "flat response", "accurate"],
  good: ["good", "great", "perfect", "amazing", "love it", "sounds good", "sounds great", "excellent", "awesome"],
};

/** Parse user message into feedback rating */
export function parseFeedback(message: string): FeedbackRating | null {
  const lower = message.toLowerCase();
  for (const [rating, keywords] of Object.entries(FEEDBACK_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return rating as FeedbackRating;
    }
  }
  return null;
}

/** Generate AI response based on feedback */
function generateResponse(rating: FeedbackRating): string {
  const responses: Record<FeedbackRating, string[]> = {
    flat: [
      "Boosting midrange presence and adding some treble air to bring life back.",
      "Adding energy around 1-4kHz and some sparkle above 8kHz.",
      "Applying a presence boost — vocals and instruments should pop more now.",
    ],
    muddy: [
      "Cutting the low-mid buildup around 200-500Hz and adding clarity in the 1-3kHz range.",
      "Reducing boominess and adding definition. The mud should clear up.",
      "Cleaning up the low-mids and boosting articulation frequencies.",
    ],
    sharp: [
      "Taming the harsh peaks around 4-12kHz. Your ears will thank you.",
      "Smoothing out the treble — reducing sibilance and fatigue.",
      "Rolling off the sharp edges. Much more relaxed now.",
    ],
    warm: [
      "Reducing low-mid warmth and adding some presence for balance.",
      "Lightening the low end and bringing forward the mids.",
      "Balancing the warmth with more clarity in the upper mids.",
    ],
    neutral: [
      "Flattening the response toward a reference tuning.",
      "Applying a more neutral, studio-flat curve.",
      "Removing coloration for accurate monitoring.",
    ],
    good: [
      "Love to hear it! Reinforcing this profile for future tracks.",
      "Saved! This combination works well for your taste.",
      "Noted. Learning your preference for this headphone/genre.",
    ],
  };
  const arr = responses[rating];
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Chat message type */
interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  rating?: FeedbackRating;
  timestamp: number;
}

interface EQChatAssistantProps {
  headphoneId: string;
  genre: string;
  subgenres: string[];
  baseGains: number[];
  baseTaste: TastePreferencesType;
  onGainsChange: (gains: number[]) => void;
  onTasteChange?: (taste: TastePreferencesType) => void;
  isReadOnly?: boolean;
}

export default function EQChatAssistant({
  headphoneId,
  genre,
  subgenres,
  baseGains,
  baseTaste,
  onGainsChange,
  onTasteChange,
  isReadOnly = false,
}: EQChatAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load existing feedback on mount
  useEffect(() => {
    const existing = getUserFeedback().filter(
      (f) => f.headphoneId === headphoneId && f.genre === genre
    );
    if (existing.length) {
      const historyMessages: ChatMessage[] = existing.map((f) => [
        { id: `${f.id}-user`, role: "user" as const, content: f.rating, rating: f.rating, timestamp: f.timestamp },
        { id: `${f.id}-assistant`, role: "assistant" as const, content: generateResponse(f.rating), timestamp: f.timestamp + 1 },
      ]).flat();
      setMessages(historyMessages);
    } else {
      // Welcome message
      setMessages([{
        id: "welcome",
        role: "assistant",
        content: "Hey! Tell me how it sounds — \"flat\", \"muddy\", \"sharp\", \"warm\", \"neutral\", or \"good\". I'll adjust the EQ and learn your taste over time.",
        timestamp: Date.now(),
      }]);
    }
  }, [headphoneId, genre]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Compute learned gains from all feedback
  const feedbackHistory = getUserFeedback().filter(
    (f) => f.headphoneId === headphoneId && f.genre === genre
  );
  const learnedGains = applyFeedbackCorrections(baseGains, feedbackHistory);

  // Send learned gains to parent when they change
  useEffect(() => {
    onGainsChange(learnedGains);
  }, [learnedGains, onGainsChange]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isProcessing) return;

    const rating = parseFeedback(text);
    if (!rating) {
      // Unknown input - ask for clarification
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      }, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "I didn't catch that. Try saying: \"sounds muddy\", \"too sharp\", \"a bit flat\", \"too warm\", \"sounds neutral\", or \"sounds good\".",
        timestamp: Date.now() + 1,
      }]);
      setInput("");
      return;
    }

    setIsProcessing(true);
    setInput("");

    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      rating,
      timestamp: Date.now(),
    };

    // Save feedback
    addUserFeedback({
      headphoneId,
      trackId: `track-${Date.now()}`,
      genre,
      subgenres,
      baseGains: baseGains,
      taste: baseTaste,
      rating,
    });

    // Generate assistant response
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: generateResponse(rating),
      timestamp: Date.now() + 1,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsProcessing(false);
  }, [input, isProcessing, headphoneId, genre, subgenres, learnedGains, baseTaste]);

  const handleSuggestionClick = (rating: FeedbackRating) => {
    const phrases: Record<FeedbackRating, string> = {
      flat: "sounds flat",
      muddy: "sounds muddy",
      sharp: "too sharp",
      warm: "too warm",
      neutral: "sounds neutral",
      good: "sounds good",
    };
    setInput(phrases[rating]);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const suggestionLabels: Record<FeedbackRating, string> = {
    flat: "Flat / Dull",
    muddy: "Muddy / Boomy",
    sharp: "Sharp / Harsh",
    warm: "Too Warm",
    neutral: "Neutral",
    good: "Sounds Good",
  };

  if (isReadOnly) return null;

  return (
    <div className="eq-chat-assistant">
      <div className="chat-header">
        <div className="chat-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>EQ Assistant</span>
        </div>
        <div className="chat-status">
          <span className={`status-dot${feedbackHistory.length ? " status-dot--active" : ""}`} />
          <span className="status-text">
            {feedbackHistory.length ? `${feedbackHistory.length} feedback${feedbackHistory.length > 1 ? "s" : ""} learned` : "Learning..."}
          </span>
        </div>
      </div>

      <div className="chat-messages" role="log" aria-live="polite">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
            <div className="chat-message__bubble">
              {msg.role === "user" && msg.rating && (
                <span className="chat-message__tag">{msg.rating}</span>
              )}
              <p>{msg.content}</p>
            </div>
            <time className="chat-message__time" dateTime={new Date(msg.timestamp).toISOString()}>
              {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {showSuggestions && (
        <div className="chat-suggestions" role="listbox" aria-label="Quick feedback options">
          {(Object.keys(FEEDBACK_KEYWORDS) as FeedbackRating[]).map((rating) => (
            <button
              key={rating}
              role="option"
              className="suggestion-chip"
              onClick={() => handleSuggestionClick(rating)}
            >
              {suggestionLabels[rating]}
            </button>
          ))}
        </div>
      )}

      <form className="chat-input-wrap" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder='How does it sound? (e.g., "sounds muddy", "too sharp")'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          rows={1}
          disabled={isProcessing}
          aria-label="Describe how the audio sounds"
        />
        <button
          type="submit"
          className="chat-send"
          disabled={!input.trim() || isProcessing}
          aria-label="Send feedback"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </form>

      {feedbackHistory.length > 0 && (
        <div className="chat-insight">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>Your EQ has adapted based on {feedbackHistory.length} feedback point{feedbackHistory.length > 1 ? "s" : ""}.</span>
        </div>
      )}
    </div>
  );
}