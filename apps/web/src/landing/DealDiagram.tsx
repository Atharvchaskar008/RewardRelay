/** The money flow of one deal, drawn as a technical diagram: Seeker → Escrow → Sharer. */
export function DealDiagram() {
  const mono = { fontFamily: "var(--font-mono-stack)", fontSize: 12, letterSpacing: "0.06em" };
  return (
    <svg
      viewBox="0 0 960 260"
      role="img"
      aria-label="The Seeker pays the price and a 5% deposit into the escrow; the Sharer locks a deposit; the escrow releases the payment to the Sharer after the return window, or refunds the Seeker if nothing is delivered."
      style={{ width: "100%", height: "auto" }}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 10 5 0 10z" fill="var(--ink)" />
        </marker>
        <marker
          id="arrow-accent"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 10 5 0 10z" fill="var(--accent)" />
        </marker>
      </defs>

      {/* Seeker */}
      <rect
        x="20"
        y="80"
        width="200"
        height="88"
        rx="8"
        fill="var(--surface)"
        stroke="var(--line-strong)"
      />
      <text x="40" y="112" style={mono} fill="var(--ink-3)">
        SEEKER
      </text>
      <text x="40" y="142" fontFamily="var(--font-display-stack)" fontSize="26" fill="var(--ink)">
        wants the deal
      </text>

      {/* Escrow */}
      <rect x="380" y="64" width="200" height="120" rx="8" fill="var(--accent)" />
      {[
        [380, 64],
        [580, 64],
        [380, 184],
        [580, 184],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 3} y={y - 3} width="6" height="6" fill="var(--ink)" />
      ))}
      <text x="400" y="98" style={mono} fill="rgba(255,255,255,0.75)">
        RELAYESCROW
      </text>
      <text x="400" y="132" fontFamily="var(--font-display-stack)" fontSize="28" fill="#fff">
        holds the money
      </text>
      <text x="400" y="162" style={mono} fill="rgba(255,255,255,0.75)">
        ON MST BLOCKCHAIN
      </text>

      {/* Sharer */}
      <rect
        x="740"
        y="80"
        width="200"
        height="88"
        rx="8"
        fill="var(--surface)"
        stroke="var(--line-strong)"
      />
      <text x="760" y="112" style={mono} fill="var(--ink-3)">
        SHARER
      </text>
      <text x="760" y="142" fontFamily="var(--font-display-stack)" fontSize="26" fill="var(--ink)">
        has the card
      </text>

      {/* Payments in */}
      <line
        x1="220"
        y1="112"
        x2="372"
        y2="112"
        stroke="var(--ink)"
        strokeWidth="1.5"
        markerEnd="url(#arrow)"
      />
      <text x="232" y="100" style={mono} fill="var(--ink-2)">
        PRICE + 5% DEPOSIT
      </text>
      <line
        x1="740"
        y1="112"
        x2="588"
        y2="112"
        stroke="var(--ink)"
        strokeWidth="1.5"
        markerEnd="url(#arrow)"
      />
      <text x="626" y="100" style={mono} fill="var(--ink-2)">
        DEPOSIT
      </text>

      {/* Release and refund */}
      <path
        d="M560 184 C 560 236, 840 240, 840 176"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        markerEnd="url(#arrow-accent)"
      />
      <text x="606" y="252" style={mono} fill="var(--accent)">
        RELEASE AFTER THE RETURN WINDOW
      </text>
      <path
        d="M400 184 C 400 236, 120 240, 120 176"
        fill="none"
        stroke="var(--ink-3)"
        strokeWidth="1.5"
        strokeDasharray="4 5"
        markerEnd="url(#arrow)"
      />
      <text x="150" y="252" style={mono} fill="var(--ink-3)">
        REFUND IF NEVER DELIVERED
      </text>
    </svg>
  );
}
