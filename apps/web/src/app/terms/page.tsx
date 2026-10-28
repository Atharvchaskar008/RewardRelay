import { BLOCKED_TOPICS, CATEGORIES, CATEGORY_LABELS } from "@rewardrelay/shared";
import { appConfig, isMainnet, networkName } from "@/client/config";

const rate = `₹${appConfig.inrPerMstc.toLocaleString("en-IN")} per MSTC`;

/** Terms, allowed and blocked categories, grievance contact. */
export default function TermsPage() {
  return (
    <main>
      <h1>Terms</h1>
      {isMainnet ? (
        <p>
          RewardRelay runs on {networkName}. Payments are in MSTC; ₹ amounts are estimates at {rate}
          .
        </p>
      ) : (
        <p>
          RewardRelay is a test MVP on {networkName}. Payments use test MSTC (tMSTC), which has no
          monetary value; ₹ amounts are shown at a demo rate ({rate}).
        </p>
      )}
      <h2>How a deal works</h2>
      <ul>
        <li>
          <strong>Buy-for-you</strong>: the Sharer orders in their own account with their own
          benefit and delivers to the Seeker. No card, login or OTP ever changes hands.
        </li>
        <li>
          <strong>Pass-on</strong>: only codes that are meant to be shared. The code is sealed and
          shown only to the Seeker who paid.
        </li>
        <li>
          The Seeker&apos;s payment is held by the RelayEscrow smart contract. Both sides lock a
          deposit; a party that cheats loses it to the other side.
        </li>
      </ul>
      <h2>Allowed categories</h2>
      <ul>
        {CATEGORIES.map((category) => (
          <li key={category.key}>
            {CATEGORY_LABELS[category.key]} (
            {category.dealType === "BuyForYou" ? "Buy-for-you" : "Pass-on"})
          </li>
        ))}
      </ul>
      <h2>Never allowed</h2>
      <ul>
        {BLOCKED_TOPICS.map((topic) => (
          <li key={topic.key}>{topic.label}</li>
        ))}
      </ul>
      <h2>Your data</h2>
      <p>
        Only hashes go on-chain. Delivery details, order ids and codes are encrypted, shown only to
        the other party of your deal, and deleted 7 days after the deal ends.
      </p>
      <h2>Disputes and grievances</h2>
      <p>
        Raise a dispute from the deal page within the check window. An arbiter reviews both
        sides&apos; evidence; if no ruling is made in time, either party can apply a 50/50 default
        ruling. For anything else, write to the RewardRelay team through the contact listed on our
        GitHub repository.
      </p>
    </main>
  );
}
