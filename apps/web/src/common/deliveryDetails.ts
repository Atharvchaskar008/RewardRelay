import { z } from "zod";

/**
 * Where the Sharer of a Buy-for-you deal delivers. Checked in the browser before the Seeker pays (so
 * no payment is ever locked without an address) and again by the API.
 */
export const deliveryDetailsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Enter the full name for delivery.")
      .max(80, "Keep the name under 80 characters."),
    phone: z
      .string()
      .trim()
      .regex(
        /^(\+91[\s-]?)?[6-9]\d{9}$|^\+[1-9]\d{7,14}$/,
        "Enter a valid mobile number for delivery.",
      ),
    addressLines: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Remove the empty address line.")
          .max(120, "Keep each address line under 120 characters."),
      )
      .min(1, "Enter the delivery address.")
      .max(4, "Use at most 4 address lines."),
    pincode: z
      .string()
      .trim()
      .regex(/^[1-9]\d{5}$/, "Enter a 6-digit PIN code."),
  })
  .strict();

export type DeliveryDetails = z.output<typeof deliveryDetailsSchema>;

/** The first problem with the details as one sentence, or undefined when they are complete. */
export function deliveryDetailsProblem(details: unknown): string | undefined {
  if (details === undefined || details === null) return "Enter the delivery address first.";
  const result = deliveryDetailsSchema.safeParse(details);
  return result.success ? undefined : result.error.issues[0]?.message;
}
