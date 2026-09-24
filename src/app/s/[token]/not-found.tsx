import { Equalizer } from "@/components/equalizer";
import { LogoMark } from "@/components/logo";
import { card } from "@/components/ui";

export default function SharedSongNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className={`${card} flex w-full max-w-md flex-col items-center px-8 py-12 text-center`}>
        <Equalizer className="h-10" bars={5} still />
        <h1 className="mt-6 text-2xl font-semibold">This song has left the building</h1>
        <p className="mt-2 text-muted">The link might be mistyped, or whoever made it has stopped sharing it.</p>
      </div>
      <p className="mt-8 flex items-center gap-2 text-sm text-subtle">
        <LogoMark className="h-6 w-6" /> Darka&apos;s Studio
      </p>
    </main>
  );
}
