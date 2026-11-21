import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    trial: { smoke(): Promise<unknown> };
  }
}

function App() {
  const [result, setResult] = useState<string>("(pending)");
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const r = await window.trial.smoke();
        const s = JSON.stringify(r);
        setResult(s);
        console.log("SMOKE:" + s);
      } catch (err) {
        console.log("SMOKE:" + JSON.stringify({ error: String(err) }));
        setResult("ERR:" + String(err));
      }
    }, 500);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{ fontFamily: "monospace", padding: 20 }}>
      <h1>NL Shell Trial</h1>
      <pre id="result">{result}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
