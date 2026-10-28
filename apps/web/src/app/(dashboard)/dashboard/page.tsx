import Link from "next/link";

/** Test dashboard home (/dashboard): the idea in three lines and the two ways in. */
export default function Home() {
  return (
    <main>
      <h1>RewardRelay</h1>
      <p>
        Got a card offer, wallet credit or promo code you will not use in time? Someone else wants
        that discount. RewardRelay lets a <strong>Sharer</strong> buy it for a{" "}
        <strong>Seeker</strong>
        (or pass on a shareable code), with the payment held in an escrow smart contract on MST
        Blockchain until delivery.
      </p>
      <ol>
        <li>The Seeker pays in MSTC; the escrow holds it.</li>
        <li>The Sharer orders in their own account and submits proof, or the code is revealed.</li>
        <li>The payment is released after the check window. Cheaters lose their deposit.</li>
      </ol>
      <p className="row">
        <Link href="/explore">Browse offers</Link>
        <Link href="/login">Sign in with your phone</Link>
        <Link href="/terms">Terms and blocked categories</Link>
      </p>
    </main>
  );
}
