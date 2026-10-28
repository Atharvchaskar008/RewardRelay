import Link from "next/link";
import AsciiEye from "@/components/AsciiEye";
import AsciiFooter from "@/components/AsciiFooter";
import TextScramble from "@/components/TextScramble";

/** Landing: the idea in three lines and the two ways in. */
export default function Home() {
  return (
    <>
      <main style={{ minHeight: "calc(100vh - 400px)" }}>
        {/* ASCII Eye Hero Section */}
        <section
          style={{
            backgroundColor: "#020306",
            padding: "48px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "32px",
          }}
        >
          <AsciiEye width={840} height={560} className="ascii-eye-hero" />
          <div style={{ maxWidth: "800px", textAlign: "center", color: "#ffffff" }}>
            <h1
              style={{
                fontSize: "clamp(32px, 5vw, 48px)",
                fontWeight: "bold",
                marginBottom: "16px",
              }}
            >
              RewardRelay
            </h1>
            <p style={{ fontSize: "18px", color: "#aaa", lineHeight: "1.6" }}>
              A trusted marketplace for unused rewards on MST Blockchain
            </p>
          </div>
        </section>

        {/* Main Content */}
        <section style={{ padding: "48px 16px", maxWidth: "900px", margin: "0 auto" }}>
          <p style={{ fontSize: "18px", lineHeight: "1.8", marginBottom: "24px" }}>
            Got a card offer, wallet credit or promo code you will not use in time? Someone else
            wants that discount. RewardRelay lets a <strong>Sharer</strong> buy it for a{" "}
            <strong>Seeker</strong> (or pass on a shareable code), with the payment held in an
            escrow smart contract on MST Blockchain until delivery.
          </p>

          <ol
            style={{
              fontSize: "18px",
              lineHeight: "1.8",
              paddingLeft: "24px",
              marginBottom: "32px",
            }}
          >
            <li style={{ marginBottom: "12px" }}>The Seeker pays in MSTC; the escrow holds it.</li>
            <li style={{ marginBottom: "12px" }}>
              The Sharer orders in their own account and submits proof, or the code is revealed.
            </li>
            <li style={{ marginBottom: "12px" }}>
              The payment is released after the check window. Cheaters lose their deposit.
            </li>
          </ol>

          <TextScramble>
            <p
              className="row"
              style={{
                display: "flex",
                gap: "16px",
                flexWrap: "wrap",
                fontSize: "16px",
              }}
            >
              <Link
                href="/explore"
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#6f42c1",
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "6px",
                  fontWeight: "500",
                }}
              >
                Browse offers
              </Link>
              <Link
                href="/login"
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#333",
                  color: "white",
                  textDecoration: "none",
                  borderRadius: "6px",
                  fontWeight: "500",
                }}
              >
                Sign in with your phone
              </Link>
              <Link
                href="/terms"
                style={{
                  padding: "12px 24px",
                  backgroundColor: "transparent",
                  color: "#333",
                  textDecoration: "none",
                  border: "1px solid #333",
                  borderRadius: "6px",
                  fontWeight: "500",
                }}
              >
                Terms and blocked categories
              </Link>
            </p>
          </TextScramble>
        </section>
      </main>

      {/* ASCII Fire Footer */}
      <AsciiFooter />
    </>
  );
}
