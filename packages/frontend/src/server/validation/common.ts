import "server-only";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { z } from "zod";

/** Shared request-field schemas. */

export const addressInput = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), "expected a 20-byte hex address")
  .transform((value): Address => getAddress(value));

export const signatureInput = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, "expected a 65-byte hex signature")
  .transform((value) => value as Hex);

export const base64Input = (maxLength: number) =>
  z
    .string()
    .min(4)
    .max(maxLength)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "expected base64");
