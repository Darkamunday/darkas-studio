import { z } from "zod";
import { MAX_FILES_PER_USER, MAX_PROJECT_INSTRUCTIONS_CHARS, PROJECT_EMOJI, PROJECT_NAME_MAX } from "@/config/chat";

/** What a project create/update may contain (every field optional; create also needs a name). */
export const ProjectFields = z.object({
  name: z.string().trim().min(1).max(PROJECT_NAME_MAX).optional(),
  emoji: z.enum(PROJECT_EMOJI as [string, ...string[]]).optional(),
  instructions: z.string().max(MAX_PROJECT_INSTRUCTIONS_CHARS).nullable().optional(),
  model: z.string().nullable().optional(),
  think: z.boolean().nullable().optional(),
  fileIds: z.array(z.number().int().positive()).max(MAX_FILES_PER_USER).optional(),
  skillIds: z.array(z.number().int().positive()).max(50).optional(),
  memberIds: z.array(z.number().int().positive()).max(500).optional(),
  /** Admins only. */
  everyone: z.boolean().optional(),
});
