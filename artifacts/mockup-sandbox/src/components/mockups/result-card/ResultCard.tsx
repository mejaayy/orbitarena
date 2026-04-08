import { useState } from "react";

const SCENARIOS = [
  { rank: 1, name: "XxShadow99xX", kills: 7, prize: 5.94, players: 15, label: "1st — Winner" },
  { rank: 2, name: "NeonBlaze", kills: 4, prize: 4.46, players: 15, label: "2nd — Runner Up" },
  { rank: 3, name: "CryptoHunter", kills: 3, prize: 2.97, players: 15, label: "3rd — Bronze" },
  { rank: 5, name: "VoidWalker", kills: 1, prize: 0, players: 15, label: "5th — No Prize" },
];

const RANK_LABEL: Record<number, string> = { 1: "1ST PLACE", 2: "2ND PLACE", 3: "3RD PLACE" };
const RANK_COLOR: Record<number, string> = {
  1: "#FFD700",
  2: "#C0C0C0",
  3: "#CD7F32",
};

function Stars() {
  const pts = [
    [60,40],[190,95],[320,28],[510,55],[680,18],[820,70],[950,35],[1100,80],
    [130,180],[370,220],[590,160],[800,205],[1080,155],[160,330],[430,370],
    [720,295],[1020,340],[210,490],[490,510],[780,470],[1090,500],[90,570],
    [410,595],[760,560],[1120,580]
  ];
  return (
    <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} viewBox="0 0 1200 630" preserveAspectRatio="xMidYMid slice">
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1" fill="rgba(255,255,255,0.5)" />
      ))}
      <circle cx="1120" cy="-60" r="420" fill="none" stroke="rgba(120,80,255,0.10)" strokeWidth="55" />
      <circle cx="100" cy="690" r="340" fill="none" stroke="rgba(120,80,255,0.07)" strokeWidth="30" />
    </svg>
  );
}

export function ResultCard() {
  const [idx, setIdx] = useState(0);
  const s = SCENARIOS[idx];

  const rankLabel = RANK_LABEL[s.rank] ?? `#${s.rank} PLACE`;
  const rankColor = RANK_COLOR[s.rank] ?? "#666";

  return (
    <div style={{ minHeight: "100vh", background: "#111", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", gap: "20px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" }}>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
        {SCENARIOS.map((sc, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            style={{
              padding: "6px 14px",
              borderRadius: "20px",
              border: i === idx ? "1.5px solid rgba(140,90,255,0.8)" : "1.5px solid rgba(255,255,255,0.12)",
              background: i === idx ? "rgba(120,80,255,0.25)" : "rgba(255,255,255,0.05)",
              color: i === idx ? "#c4b5fd" : "rgba(255,255,255,0.5)",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {sc.label}
          </button>
        ))}
      </div>

      <div style={{
        position: "relative",
        width: "100%",
        maxWidth: "840px",
        aspectRatio: "1200 / 630",
        background: "#080812",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 0 80px rgba(100,60,255,0.25), 0 0 0 1px rgba(120,80,255,0.2)",
      }}>
        <Stars />

        <div style={{
          position: "absolute",
          left: 0, top: 0,
          width: "4px",
          height: "100%",
          background: "linear-gradient(to bottom, rgba(140,90,255,0.9), rgba(140,90,255,0))",
        }} />

        <div style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at 35% 50%, rgba(90,50,200,0.22), transparent 65%)",
        }} />

        <div style={{ position: "relative", padding: "6.5% 6%", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ fontSize: "1.5%", fontWeight: 700, letterSpacing: "0.25em", color: "rgba(160,130,255,0.65)", textTransform: "uppercase", fontSize: "clamp(9px, 1.8%, 16px)" }}>
            ORBIT ARENA
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "3%" }}>
            <div style={{
              fontSize: "clamp(28px, 8.5%, 100px)",
              fontWeight: 900,
              color: rankColor,
              lineHeight: 1.05,
              textShadow: s.rank === 1 ? "0 0 40px rgba(255,215,0,0.3)" : undefined,
            }}>
              {rankLabel}
            </div>

            <div style={{ fontSize: "clamp(16px, 4.2%, 50px)", fontWeight: 600, color: "rgba(255,255,255,0.92)" }}>
              {s.name}
            </div>

            <div style={{ fontSize: "clamp(10px, 2.4%, 28px)", color: "rgba(180,160,220,0.65)" }}>
              {s.kills} kill{s.kills !== 1 ? "s" : ""}{"   ·   "}{s.players} players
            </div>

            {s.prize > 0 ? (
              <div style={{
                display: "inline-flex",
                flexDirection: "column",
                gap: "2px",
                background: "rgba(120,80,255,0.18)",
                border: "1.5px solid rgba(140,90,255,0.45)",
                borderRadius: "14px",
                padding: "2.5% 3.5%",
                alignSelf: "flex-start",
              }}>
                <div style={{ fontSize: "clamp(20px, 5.8%, 68px)", fontWeight: 900, color: "#a78bfa", lineHeight: 1.1 }}>
                  +${s.prize.toFixed(2)} USDC
                </div>
                <div style={{ fontSize: "clamp(8px, 1.7%, 20px)", color: "rgba(160,140,200,0.55)" }}>
                  credited to in-game balance
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "clamp(10px, 2.2%, 26px)", color: "rgba(150,140,180,0.45)" }}>
                Top 3 earn USDC — try again!
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "clamp(8px, 2%, 24px)", color: "rgba(140,120,200,0.5)" }}>
              orbit-arena.replit.app
            </div>
            <div style={{ fontSize: "clamp(8px, 2.2%, 26px)", fontWeight: 600, color: "rgba(160,130,255,0.65)" }}>
              Can you beat me? →
            </div>
          </div>
        </div>
      </div>

      <p style={{ color: "rgba(255,255,255,0.3)", fontSize: "12px", textAlign: "center" }}>
        This is the image players download after a round ends. On mobile it opens the native share sheet.
      </p>
    </div>
  );
}
