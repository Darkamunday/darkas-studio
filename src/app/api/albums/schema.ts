import { z } from "zod";
import { ALBUM_DESCRIPTION_MAX, ALBUM_NAME_MAX } from "@/lib/albums";

/** What an album create/update may contain (create also needs a name). */
export const AlbumFields = z.object({
  name: z.string().trim().min(1).max(ALBUM_NAME_MAX).optional(),
  description: z.string().max(ALBUM_DESCRIPTION_MAX).nullable().optional(),
  memberIds: z.array(z.number().int().positive()).max(500).optional(),
  /** Admins only. */
  everyone: z.boolean().optional(),
  coverTrackId: z.number().int().positive().nullable().optional(),
});
