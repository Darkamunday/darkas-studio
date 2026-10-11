"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { btnSecondary } from "@/components/ui";
import { AlbumPicker } from "@/components/album-picker";

/** "Add to album" on a song: pick music albums for it, or start a new one with it. */
export function AddToAlbum({ trackId, title }: { trackId: number; title: string }) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
        <span aria-hidden>💿</span> {m.albums.addToAlbum}
      </button>
      {open && <AlbumPicker kind="music" itemId={trackId} title={title} onClose={close} />}
    </>
  );
}
