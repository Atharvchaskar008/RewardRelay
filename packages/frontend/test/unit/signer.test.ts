import { afterAll, describe, expect, it, vi } from "vitest";
import { keccak256, parseTransaction, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AppError } from "@/src/server/errors";
import { TxManager, classifyTxError } from "@/src/server/signer";

const silence = (["log", "warn", "error"] as const).map((method) =>
  vi.spyOn(console, method).mockImplementation(() => undefined),
);
afterAll(() => silence.forEach((spy) => spy.mockRestore()));

const TO = "0x00000000000000000000000000000000000000aa" as const;

/** A scripted fake of the viem public client: records raw transactions, fails on demand. */
function fakeClient(
  script: { failures?: unknown[]; chainNonce?: number[]; receipt?: "timeout" } = {},
) {
  const failures = [...(script.failures ?? [])];
  const chainNonces = [...(script.chainNonce ?? [5])];
  const sent: Hex[] = [];
  let nonceReads = 0;
  const client = {
    async getTransactionCount() {
      nonceReads++;
      return chainNonces.length > 1 ? (chainNonces.shift() as number) : chainNonces[0];
    },
    async estimateGas() {
      return 50_000n;
    },
    async sendRawTransaction({ serializedTransaction }: { serializedTransaction: Hex }) {
      sent.push(serializedTransaction);
      const failure = failures.shift();
      if (failure) throw failure;
      return keccak256(serializedTransaction);
    },
    async getTransaction() {
      return null;
    },
    async waitForTransactionReceipt({ hash }: { hash: Hex }) {
      if (script.receipt === "timeout") throw new Error("Timed out while waiting for transaction");
      return { status: "success", blockNumber: 10n, gasUsed: 21_000n, transactionHash: hash };
    },
  };
  return { client: client as unknown as PublicClient, sent, nonceReads: () => nonceReads };
}

function manager(client: PublicClient) {
  return new TxManager({
    account: privateKeyToAccount(generatePrivateKey()),
    client,
    chain: { id: 31337 } as never,
    label: "test",
    baseDelayMs: 1,
  });
}

const nonceOf = (raw: Hex) => parseTransaction(raw).nonce;

describe("TxManager", () => {
  it("sends legacy 1 gwei transactions with sequential nonces under concurrency", async () => {
    const fake = fakeClient({ chainNonce: [5] });
    const tx = manager(fake.client);
    const results = await Promise.all([1n, 2n, 3n].map((value) => tx.send({ to: TO, value })));
    expect(results.map((result) => result.status)).toEqual(["success", "success", "success"]);
    expect(fake.sent.map(nonceOf)).toEqual([5, 6, 7]);
    expect(fake.nonceReads()).toBe(1);
    const parsed = parseTransaction(fake.sent[0]);
    expect(parsed.type).toBe("legacy");
    expect(parsed.gasPrice).toBe(1_000_000_000n);
    expect(parsed.gas).toBe(60_000n); // estimate + 20%
    expect(parsed.chainId).toBe(31337);
  });

  it("rebroadcasts the same signed transaction after a network error", async () => {
    const fake = fakeClient({ failures: [new Error("fetch failed: ECONNRESET")] });
    const result = await manager(fake.client).send({ to: TO, value: 1n });
    expect(fake.sent).toHaveLength(2);
    expect(fake.sent[0]).toBe(fake.sent[1]);
    expect(result.hash).toBe(keccak256(fake.sent[0]));
  });

  it("resyncs the nonce and re-signs after 'nonce too low'", async () => {
    const fake = fakeClient({ failures: [new Error("nonce too low")], chainNonce: [5, 9] });
    await manager(fake.client).send({ to: TO });
    expect(fake.sent.map(nonceOf)).toEqual([5, 9]);
    expect(fake.nonceReads()).toBe(2);
  });

  it("treats 'already known' as success", async () => {
    const fake = fakeClient({ failures: [new Error("already known")] });
    const result = await manager(fake.client).send({ to: TO });
    expect(fake.sent).toHaveLength(1);
    expect(result.hash).toBe(keccak256(fake.sent[0]));
  });

  it("fails fast on reverts and reports missing gas funds", async () => {
    const reverted = fakeClient({ failures: [new Error("execution reverted: InvalidStatus")] });
    await expect(manager(reverted.client).send({ to: TO })).rejects.toMatchObject({
      code: "TX_FAILED",
    });
    expect(reverted.sent).toHaveLength(1);

    const broke = fakeClient({
      failures: [new Error("insufficient funds for gas * price + value")],
    });
    const error = await manager(broke.client)
      .send({ to: TO })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).toMatch(/cannot pay for gas/);
  });

  it("gives up after the maximum number of attempts", async () => {
    const network = () => new Error("HTTP request failed. Status: 503");
    const fake = fakeClient({ failures: [network(), network(), network(), network(), network()] });
    await expect(manager(fake.client).send({ to: TO })).rejects.toMatchObject({
      code: "TX_FAILED",
    });
    expect(fake.sent).toHaveLength(4);
  });

  it("does not reuse a nonce after a failed broadcast", async () => {
    const fake = fakeClient({ failures: [new Error("execution reverted")], chainNonce: [5] });
    const tx = manager(fake.client);
    await expect(tx.send({ to: TO })).rejects.toBeInstanceOf(AppError);
    await tx.send({ to: TO });
    expect(fake.sent.map(nonceOf)).toEqual([5, 5]);
  });

  it("reports a receipt timeout with the hash", async () => {
    const fake = fakeClient({ receipt: "timeout" });
    const error = (await manager(fake.client)
      .send({ to: TO })
      .catch((caught: unknown) => caught)) as AppError;
    expect(error.code).toBe("TX_FAILED");
    expect(error.details?.hash).toBe(keccak256(fake.sent[0]));
  });
});

describe("classifyTxError", () => {
  it.each([
    ["nonce too low: next nonce 7, tx nonce 6", "nonce"],
    ["replacement transaction underpriced", "underpriced"],
    ["already known", "known"],
    ["insufficient funds for gas", "funds"],
    ["The request took too long to respond. Timed out", "network"],
    ["execution reverted: DealNotFound(9)", "fatal"],
    ["something unexpected", "fatal"],
  ])("%s → %s", (message, kind) => {
    expect(classifyTxError(new Error(message))).toBe(kind);
  });

  it("follows the cause chain", () => {
    const wrapped = new Error("Transaction failed", { cause: new Error("nonce too low") });
    expect(classifyTxError(wrapped)).toBe("nonce");
  });
});
