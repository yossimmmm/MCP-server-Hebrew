// src/sttDedup.ts
export function createFinalDeduper(windowMs = 3000) {
  let last = "";
  let lastAt = 0;

  const norm = (s: string) =>
    s.toLowerCase().replace(/[.,!?;:"'׳״()\-–—]/g, "").replace(/\s+/g, " ").trim();

  return (t: string) => {
    const n = norm(t);
    const now = Date.now();

    // same or prefix/suffix-like duplicates within window
    const isDup = n === last || n.startsWith(last) || last.startsWith(n);

    const accept = !isDup || now - lastAt > windowMs;
    if (accept) { last = n; lastAt = now; }
    else console.log("[STT final dup] dropped");
    return accept;
  };
}