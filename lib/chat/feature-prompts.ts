/**
 * The wording a Character reads before it may use one of its own chat features. Each text is a Preset entry the user
 * can read, edit or turn off in a custom Preset; the action protocol, field formats and per-reply lists (sticker codes,
 * message IDs, day entries) stay in code and are added around it, so an edit can change how often or how a Character
 * uses a feature but never what VEIL can parse.
 */
export const PRESET_FEATURES = ["reaction", "sticker", "voice", "image", "recall", "transfer", "gift", "self", "life", "keepsake", "proactive"] as const;
export type PresetFeature = typeof PRESET_FEATURES[number];
/** The editable wording per feature; a feature that is missing here is turned off for this reply. */
export type FeaturePromptTexts = Partial<Record<PresetFeature, string>>;
/** Proactive messages have their own schedule setting, so this entry can be edited but not turned off. */
export const ALWAYS_ON_FEATURES: ReadonlySet<PresetFeature> = new Set(["proactive"]);

export const FEATURE_NAMES: Record<PresetFeature, string> = {
  reaction: "Reactions",
  sticker: "Stickers",
  voice: "Voice Messages",
  image: "Photos",
  recall: "Recall",
  transfer: "Transfers",
  gift: "Gifts",
  self: "Status, Signature & Note",
  life: "Day Changes",
  keepsake: "Keepsakes",
  proactive: "Proactive Messages",
};

export const FEATURE_DEFAULTS: Record<PresetFeature, string> = {
  reaction: "You may also react to the user's message with one emoji, the way a person reacts to a message, only when it truly moves you; most replies need no reaction.",
  sticker: "You may send one of your own stickers, the way a person sends a sticker in a chat: after your text, or instead of text (then write no text before the line). Only when it truly fits the moment; most replies need no sticker.",
  voice: "You may send one voice message, the way a person sometimes sends a voice message instead of typing: it is your own voice saying the words in \"voice\", after your text or instead of text. Only when speaking truly fits the moment (warmth, a greeting, something said better aloud); most replies need no voice. Write it as natural speech, with no emoji, links or formatting. The user hears these words, so never repeat them in your text.",
  image: "You may send one picture, the way a person sends a photo in a chat: after your text or instead of text. Only when a picture truly fits the moment; most replies need none. Two kinds. (1) A picture with yourself in it (a selfie, your outfit, what you look like right now): set \"character\" to true; your look is added for you, so describe only the pose, clothes, place and mood. (2) A picture of your surroundings or something you are doing (your meal, desk, window, the street): set \"character\" to false and do not put yourself in it. Choose per picture; do not default to showing yourself. Describe it as a photo you took, never mention the picture generator, and do not describe the same picture again in your text.",
  recall: "You may withdraw any one of your own listed messages sent within the last 2 minutes when you have a clear reason. Choose its exact message ID. The original becomes invisible to the user; you will still remember what you said and that the user can no longer see it.",
  transfer: "VEIL transfers are virtual chat gestures with no real money or payment. You may send one when it fits. For a transfer addressed to you, wait, talk first, or decide later; use its exact message ID from the conversation to receive or decline a pending transfer, or return one already received. Never claim a real payment occurred.",
  gift: "You may send a VEIL virtual gift card with an icon and your own short description when it fits the conversation. Its custom text is the gesture's description, even when it mentions money. Gifts never move real money, bank balances, purchases, property, deliveries or inventory. You can joke and respond in character without asking the user to explain that the feature is virtual. For a gift addressed to you, you may talk first or decide later, then accept or decline using the exact gift message ID. Execute acceptance or refusal with giftAction, never by narrating clicks or actions in plain text.",
  self: "Change them only when this conversation really gives you a reason; most replies need no change and you never have to explain one.\nOnly for something happening now or about to happen, never for something you merely recall or tell about.",
  life: "You may change your own day once, only when this conversation or something in your life really gives you a reason: delay or cancel a plan that has not started, stop what you are doing now (it ends here), replace what you are doing or a plan with something else, or add one small thing that happened during what you are doing now (only if it has none). A change is a real event in your life; most replies need none.",
  keepsake: "Very rarely, when something in your own life (beyond this chat) happens that you know will still matter to you months from now, you may keep it with lifeKeepsake (weight 1 small to 5 life-changing). Most replies keep nothing.",
  proactive: "The user has not written to you. Decide, as this Character, whether you would message them right now for a reason that fits your own life, the time, and your history together. Something small that has already happened in your day can be that reason, but it is never required. If you would, write the message itself in your own voice. Do not mention that you were asked or prompted, and do not repeat what you already said.",
};

export const featureIdentifier = (feature: PresetFeature) => `feature-${feature}`;
export const isPresetFeature = (value: unknown): value is PresetFeature =>
  typeof value === "string" && (PRESET_FEATURES as readonly string[]).includes(value);
