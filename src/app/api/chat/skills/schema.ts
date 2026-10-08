import { z } from "zod";
import {
  MAX_SKILL_INSTRUCTIONS_CHARS,
  SKILL_DESCRIPTION_MAX,
  SKILL_EMOJI,
  SKILL_NAME_MAX,
  SKILL_SLUG,
} from "@/config/chat";

export const SkillFields = z.object({
  slug: z.string().trim().toLowerCase().regex(SKILL_SLUG),
  name: z.string().trim().min(1).max(SKILL_NAME_MAX),
  emoji: z.enum(SKILL_EMOJI as [string, ...string[]]),
  description: z.string().trim().max(SKILL_DESCRIPTION_MAX).default(""),
  instructions: z.string().trim().min(1).max(MAX_SKILL_INSTRUCTIONS_CHARS),
  /** Make it a shared skill for everyone (admins only; only when creating). */
  shared: z.boolean().optional(),
});
