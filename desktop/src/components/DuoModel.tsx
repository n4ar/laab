import { useEffect, useRef, useState } from "react";
import { DuoHint } from "./DuoHint";

/** The peek hint's iPhone Duo as a 3D model, opening a little to show the
 *  chat and shutting again. three.js loads only when the hint first shows.
 *  Falls back to the CSS drawing where WebGL is unavailable. */
export function DuoModel({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("../lib/duoScene")
      .then(({ mountDuo }) => {
        if (gone || !host.current) return;
        stop = mountDuo(host.current, { name }, still);
      })
      .catch(() => setFailed(true));
    return () => {
      gone = true;
      stop?.();
    };
  }, [name]);
  if (failed) return <DuoHint />;
  return <div ref={host} className="mx-auto h-[200px] w-[280px]" aria-hidden />;
}
