import "server-only";
import type { DocumentData } from "firebase-admin/firestore";
import type { z } from "zod";
import { Collection } from "../repositories/collection";

/** deals/{id}/private/{details|proof}: encrypted per field; the field path is the AAD. */
export const privateDocs = <T extends DocumentData>(dealId: string, schema: z.ZodType<T>) =>
  new Collection<T>(`deals/${dealId}/private`, schema);

export const pathOf = (dealId: string, doc: "details" | "proof", field: string) =>
  `deals/${dealId}/private/${doc}#${field}`;
