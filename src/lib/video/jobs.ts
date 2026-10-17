import "server-only";
import { MAX_TRACK_SECONDS } from "@/config/video";
import { getTrack, withLocalFiles } from "../media";
import { analyseFile } from "./analyse";
import { saveAnalysis, setStatus, songFile, videoTrackId } from "./store";

// The steps of making a video that run on the server, not tied to the browser: they carry on if the
// page is closed, and the video page shows their progress.

/** Work out the track's tempo, beats and sections. */
export async function analyseVideo(userId: number, videoId: number) {
  setStatus(videoId, "analysing");
  try {
    // A catalogue song's audio may still be at the provider: fetch it first.
    const trackId = videoTrackId(userId, videoId);
    if (trackId) {
      const track = getTrack(trackId);
      if (track) await withLocalFiles(track);
    }
    const file = songFile(userId, videoId);
    if (!file) return setStatus(videoId, "failed", "no_audio");
    const a = await analyseFile(file);
    if (a.duration > MAX_TRACK_SECONDS) return setStatus(videoId, "failed", "too_long");
    if (a.duration < 5) return setStatus(videoId, "failed", "too_short");
    saveAnalysis(videoId, a);
  } catch (err) {
    // Details to the log; the page shows a short message in the person's language (videos.errors.*).
    console.error(`[video] analysing video ${videoId} failed`, err);
    setStatus(videoId, "failed", "analysis_failed");
  }
}
