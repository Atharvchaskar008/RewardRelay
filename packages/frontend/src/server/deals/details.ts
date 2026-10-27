import "server-only";
import { z } from "zod";
import { DealStatus } from "rewardrelay-shared";
import { keyring } from "../crypto";
import { AppError } from "../errors";
import { encryptedBlobSchema, repos } from "../repositories";
import type { AuthUser } from "../services";
import { logAccess, requireParty } from "./access";
import { pathOf, privateDocs } from "./privateDocs";

/**
 * Delivery details, gated by the on-chain state (requireParty re-reads the deal): written by the
 * seeker while Locked, read by the sharer while Locked or Delivered; envelope-encrypted with the
 * document path as AAD; every read is logged (who and when, never what).
 */

export const deliveryDetailsSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^(\+91[\s-]?)?[6-9]\d{9}$|^\+[1-9]\d{7,14}$/, "expected a mobile number"),
    addressLines: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
    pincode: z.string().regex(/^[1-9]\d{5}$/, "expected a 6-digit PIN code"),
  })
  .strict();
export type DeliveryDetails = z.output<typeof deliveryDetailsSchema>;

export const detailsDocSchema = z.object({
  details: encryptedBlobSchema,
  submittedBy: z.string(),
  submittedAt: z.number(),
});

export async function submitDetails(
  user: AuthUser,
  idParam: string | undefined,
  details: DeliveryDetails,
) {
  const ctx = await requireParty(user, idParam, {
    roles: ["seeker"],
    statuses: [DealStatus.Locked],
    stateMessage: "Delivery details can be sent only while the payment is locked.",
  });
  await privateDocs(ctx.dealId, detailsDocSchema).set("details", {
    details: keyring().encryptJson(details, pathOf(ctx.dealId, "details", "details")),
    submittedBy: user.uid,
    submittedAt: Date.now(),
  });
  await repos.deals
    .update(ctx.dealId, { seekerUid: user.uid, updatedAt: Date.now() })
    .catch(() => undefined);
  return { dealId: ctx.dealId, submitted: true };
}

export async function readDetails(user: AuthUser, idParam: string | undefined) {
  const ctx = await requireParty(user, idParam, {
    roles: ["sharer"],
    statuses: [DealStatus.Locked, DealStatus.Delivered],
    stateMessage: "Delivery details are available only while the deal is in progress.",
  });
  const doc = await privateDocs(ctx.dealId, detailsDocSchema).get("details");
  if (!doc)
    throw new AppError("NOT_FOUND", { message: "The seeker has not sent delivery details yet." });
  const details = keyring().decryptJson<DeliveryDetails>(
    doc.details,
    pathOf(ctx.dealId, "details", "details"),
  );
  await logAccess(ctx.dealId, user.uid, "details", ctx.role);
  return { dealId: ctx.dealId, details, submittedAt: new Date(doc.submittedAt).toISOString() };
}
