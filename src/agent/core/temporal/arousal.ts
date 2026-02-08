/**
 * Arousal Estimation — cheap keyword-based emotional intensity scoring.
 *
 * Arousal measures how emotionally charged a memory is (0 = flat/neutral, 1 = intense).
 * Both positive and negative emotions score high; mundane factual content scores low.
 * This mirrors the psychological arousal dimension (circumplex model) where
 * "excited" and "furious" are both high-arousal, while "calm" and "bored" are low.
 *
 * No API call required — runs on keyword/pattern heuristics at encoding time.
 */

// Words/patterns that signal high emotional intensity
const HIGH_AROUSAL_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
    // Strong negative emotions
    { pattern: /\b(furious|enraged|livid|outraged|devastated|horrified|panick(?:ed|ing))\b/i, weight: 0.9 },
    { pattern: /\b(frustrated|angry|annoyed|pissed|hate|hated|disgusted|terrified)\b/i, weight: 0.7 },
    { pattern: /\b(failed|broken|crashed|disaster|nightmare|catastrophe|fucked)\b/i, weight: 0.6 },
    { pattern: /\b(stuck|struggling|confused|overwhelmed|stressed|burned out)\b/i, weight: 0.5 },
    { pattern: /\b(bug|error|broke|down|lost|missing|wrong)\b/i, weight: 0.3 },

    // Strong positive emotions
    { pattern: /\b(ecstatic|euphoric|thrilled|incredible|mind-?blown|blown away)\b/i, weight: 0.9 },
    { pattern: /\b(excited|amazing|awesome|love|loved|beautiful|brilliant|insane)\b/i, weight: 0.7 },
    { pattern: /\b(shipped|launched|solved|nailed|crushed|breakthrough|finally)\b/i, weight: 0.6 },
    { pattern: /\b(proud|happy|grateful|impressed|surprised|wow)\b/i, weight: 0.5 },
    { pattern: /\b(cool|nice|great|good|interesting|fun)\b/i, weight: 0.2 },

    // Intensity amplifiers
    { pattern: /!{2,}/,  weight: 0.3 },   // Multiple exclamation marks
    { pattern: /\b(SO|VERY|EXTREMELY|INCREDIBLY|ABSOLUTELY)\b/, weight: 0.3 }, // ALL CAPS intensifiers
    { pattern: /[A-Z]{4,}/, weight: 0.2 }, // Shouting (4+ caps letters)
];

// Explicit emotion labels → arousal mapping (for when emotion tag is provided)
const EMOTION_AROUSAL: Record<string, number> = {
    // High arousal
    'excited': 0.8, 'thrilled': 0.9, 'ecstatic': 0.95,
    'angry': 0.8, 'furious': 0.9, 'frustrated': 0.7,
    'anxious': 0.7, 'terrified': 0.9, 'panicked': 0.95,
    'amazed': 0.8, 'shocked': 0.85, 'surprised': 0.7,
    'proud': 0.6, 'triumphant': 0.8,
    'disgusted': 0.7, 'horrified': 0.85,

    // Medium arousal
    'happy': 0.5, 'amused': 0.5, 'curious': 0.4,
    'annoyed': 0.5, 'disappointed': 0.5, 'confused': 0.4,
    'hopeful': 0.4, 'determined': 0.5, 'nostalgic': 0.4,

    // Low arousal
    'calm': 0.1, 'relaxed': 0.1, 'content': 0.2,
    'bored': 0.1, 'tired': 0.15, 'neutral': 0.0,
    'sad': 0.3, 'melancholy': 0.25,
};

/**
 * Estimate emotional arousal from memory content and optional emotion label.
 * Returns a value in [0, 1].
 *
 * @param content - The memory text
 * @param emotion - Optional explicit emotion label (e.g. from save_memory action)
 */
import { isDisabled } from '../../../eval/evalConfig.js';

export function estimateArousal(content: string, emotion?: string): number {
    if (isDisabled('disableArousal')) return 0;
    let arousal = 0;

    // 1. If an explicit emotion label is provided, use it as a strong signal
    if (emotion) {
        const normalized = emotion.toLowerCase().trim();
        const mapped = EMOTION_AROUSAL[normalized];
        if (mapped !== undefined) {
            arousal = mapped;
        } else {
            // Unknown emotion label — assume moderate arousal (the agent chose to tag it)
            arousal = 0.5;
        }
    }

    // 2. Scan content for arousal keywords (additive, capped)
    let keywordScore = 0;
    for (const { pattern, weight } of HIGH_AROUSAL_PATTERNS) {
        if (pattern.test(content)) {
            keywordScore += weight;
        }
    }
    // Cap keyword contribution at 0.9
    keywordScore = Math.min(0.9, keywordScore);

    // 3. Combine: take the max of emotion-label arousal and keyword-derived arousal
    arousal = Math.max(arousal, keywordScore);

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, arousal));
}
