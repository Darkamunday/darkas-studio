import type { Locale } from "./config";
import { en, type Messages } from "./messages/en";
import { fr } from "./messages/fr";
import { id } from "./messages/id";
import { ms } from "./messages/ms";
import { pt } from "./messages/pt";

export type { Messages };

// All five are small, so they're bundled together rather than loaded on demand.
export const MESSAGES: Record<Locale, Messages> = { en, fr, id, pt, ms };
