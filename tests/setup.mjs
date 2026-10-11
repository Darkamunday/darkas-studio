// Loaded before every test file (see the "test" script). Each file runs in its own process, so each gets
// a fresh, empty database and media folder in a temp directory: the app keeps its database in
// <cwd>/data, and media in MEDIA_DIR. Nothing here can touch the live data.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "music-app-test-"));
mkdirSync(path.join(dir, "media", "chat-images"), { recursive: true });
process.env.MEDIA_DIR = path.join(dir, "media");
process.chdir(dir);
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
