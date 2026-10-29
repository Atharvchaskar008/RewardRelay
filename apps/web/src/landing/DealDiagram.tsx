"use client";

/**
 * DealDiagram: High-contrast, responsive visual representation of the SAKER
 * escrow transaction flow between Seeker, RelayEscrow smart contract, and Sharer.
 */
export function DealDiagram() {
  return (
    <div className="deal-diagram-wrapper" role="region" aria-label="Deal escrow flow diagram">
      <div className="deal-diagram-grid">
        {/* 1. SEEKER */}
        <div className="deal-diagram-node deal-node-seeker">
          <div className="deal-node-header">
            <span className="deal-node-badge mono">SEEKER</span>
            <span className="deal-node-sub mono">Buyer</span>
          </div>
          <h3 className="deal-node-title">wants the deal</h3>
          <div className="deal-node-action">
            <span className="deal-chip deal-chip-seeker mono">Locks payment in escrow</span>
          </div>
        </div>

        {/* CONNECTOR 1: Seeker -> Escrow */}
        <div className="deal-diagram-connector">
          <div className="deal-conn-pill">
            <span className="deal-conn-label mono">PRICE + 5% DEPOSIT</span>
            <div className="deal-conn-arrow" aria-hidden="true">
              <span className="deal-conn-line" />
              <span className="deal-conn-head">→</span>
            </div>
          </div>
        </div>

        {/* 2. RELAYESCROW */}
        <div className="deal-diagram-node deal-node-escrow">
          <div className="deal-node-header">
            <span className="deal-node-badge deal-badge-escrow mono">RELAYESCROW</span>
            <span className="deal-node-network mono">ON MST BLOCKCHAIN</span>
          </div>
          <h3 className="deal-node-title deal-title-escrow">holds the money</h3>
          <p className="deal-node-desc mono">Autonomous code · Zero middleman</p>
        </div>

        {/* CONNECTOR 2: Sharer -> Escrow */}
        <div className="deal-diagram-connector">
          <div className="deal-conn-pill">
            <span className="deal-conn-label mono">DEPOSIT</span>
            <div className="deal-conn-arrow" aria-hidden="true">
              <span className="deal-conn-head">←</span>
              <span className="deal-conn-line" />
            </div>
          </div>
        </div>

        {/* 3. SHARER */}
        <div className="deal-diagram-node deal-node-sharer">
          <div className="deal-node-header">
            <span className="deal-node-badge mono">SHARER</span>
            <span className="deal-node-sub mono">Cardholder</span>
          </div>
          <h3 className="deal-node-title">has the card</h3>
          <div className="deal-node-action">
            <span className="deal-chip deal-chip-sharer mono">Places merchant order</span>
          </div>
        </div>
      </div>

      {/* RESOLUTION FLOW BAR */}
      <div className="deal-diagram-footer">
        <div className="deal-flow-step deal-flow-refund">
          <span className="deal-flow-icon" aria-hidden="true">
            ↩
          </span>
          <span className="deal-flow-text mono">REFUND IF NEVER DELIVERED</span>
        </div>
        <div className="deal-flow-divider" aria-hidden="true" />
        <div className="deal-flow-step deal-flow-release">
          <span className="deal-flow-text mono">RELEASE AFTER THE RETURN WINDOW</span>
          <span className="deal-flow-icon" aria-hidden="true">
            ✓
          </span>
        </div>
      </div>
    </div>
  );
}
