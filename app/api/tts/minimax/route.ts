import { relayMinimaxSpeech } from "../../../../lib/tts/minimax-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = (request: Request) => relayMinimaxSpeech(request);
