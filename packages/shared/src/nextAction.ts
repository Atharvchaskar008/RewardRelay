import { DealStatus } from "./protocol";

/**
 * The UI's single primary button per deal, derived only from on-chain state, the caller's role and
 * the current time (all times in seconds). Secondary actions are extra buttons (cancel, dispute,
 * evidence, concession, default ruling). Mirrors RelayEscrow's guards exactly; see docs/protocol.md §2.
 */

export type DealRole = "sharer" | "seeker" | "visitor";

export type NextAction =
  | "PAY"
  | "MARK_DELIVERED"
  | "CONFIRM"
  | "RELEASE_AVAILABLE"
  | "CLAIM_REFUND"
  | "RAISE_DISPUTE"
  | "WAIT"
  | "NONE";

export type SecondaryAction =
  "CANCEL" | "RAISE_DISPUTE" | "CONFIRM" | "ADD_EVIDENCE" | "DEFAULT_RESOLVE";

/** Why a visitor cannot pay (computed by the server from the visitor's wallet and the contract). */
export type AcceptBlock = "SIGN_IN" | "NO_WALLET" | "NO_BADGE" | "OVER_LIMIT" | "PAUSED";

export type ActionReason =
  | AcceptBlock
  | "EVENT_STARTED"
  | "DELIVERY_WINDOW_CLOSED"
  | "AWAITING_SEEKER"
  | "AWAITING_DELIVERY"
  | "IN_CHECK_WINDOW"
  | "AWAITING_ARBITER"
  | "NOT_A_PARTY"
  | "FINISHED";

export interface NextActionInput {
  status: DealStatus;
  role: DealRole;
  now: number;
  deliverBy: number;
  releaseAt: number;
  eventTime: number;
  disputeOpenedAt: number;
  /** Evidence window after a dispute opens (policy.disputeWindow). */
  disputeWindow: number;
  arbiterTimeout: number;
  /** Visitors only: set when the visitor may not accept (sign-in, badge, limit, pause). */
  acceptBlock?: AcceptBlock | null;
}

export interface NextActionResult {
  nextAction: NextAction;
  secondary: SecondaryAction[];
  reason?: ActionReason;
}

const result = (
  nextAction: NextAction,
  secondary: SecondaryAction[] = [],
  reason?: ActionReason,
) => (reason ? { nextAction, secondary, reason } : { nextAction, secondary });

export function computeNextAction(input: NextActionInput): NextActionResult {
  const { status, role, now } = input;

  switch (status) {
    case DealStatus.Listed: {
      if (role === "sharer") return result("WAIT", ["CANCEL"], "AWAITING_SEEKER");
      if (role === "seeker") return result("NONE", [], "NOT_A_PARTY");
      if (input.eventTime !== 0 && now >= input.eventTime)
        return result("NONE", [], "EVENT_STARTED");
      if (input.acceptBlock) return result("NONE", [], input.acceptBlock);
      return result("PAY");
    }

    case DealStatus.Locked: {
      const open = now <= input.deliverBy;
      if (role === "sharer") {
        return open ? result("MARK_DELIVERED") : result("NONE", [], "DELIVERY_WINDOW_CLOSED");
      }
      if (role === "seeker") {
        return open ? result("WAIT", [], "AWAITING_DELIVERY") : result("CLAIM_REFUND");
      }
      return result("NONE", [], "NOT_A_PARTY");
    }

    case DealStatus.Delivered: {
      const due = now >= input.releaseAt;
      if (role === "visitor") return result("NONE", [], "NOT_A_PARTY");
      if (due) return result("RELEASE_AVAILABLE");
      if (role === "seeker") return result("CONFIRM", ["RAISE_DISPUTE"]);
      return result("WAIT", [], "IN_CHECK_WINDOW");
    }

    case DealStatus.Disputed: {
      if (role === "visitor") return result("NONE", [], "NOT_A_PARTY");
      const secondary: SecondaryAction[] = [];
      if (now <= input.disputeOpenedAt + input.disputeWindow) secondary.push("ADD_EVIDENCE");
      if (now >= input.disputeOpenedAt + input.arbiterTimeout) secondary.push("DEFAULT_RESOLVE");
      if (role === "seeker") secondary.push("CONFIRM");
      return result("WAIT", secondary, "AWAITING_ARBITER");
    }

    case DealStatus.Completed:
    case DealStatus.Refunded:
    case DealStatus.Resolved:
    case DealStatus.Cancelled:
      return result("NONE", [], "FINISHED");
  }
}
