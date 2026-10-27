import "server-only";
import { randomUUID } from "crypto";
import { keyring, type EncryptedBlob } from "../crypto";
import { serverEnv } from "../env";
import { AppError } from "../errors";
import { db } from "../firebaseAdmin";

/**
 * Uploaded files (invoices, dispute evidence). Every file is envelope-encrypted before it is stored
 * (AAD = its logical path) and is only ever served back through the API after the deal's parties
 * check, so the storage backend never holds readable personal data.
 *
 * Backends behind one interface:
 * - Firestore (default, tested): ciphertext split into ≤ 512 KiB Bytes chunks (a document is ≤ 1 MiB).
 * - Vercel Blob (when BLOB_READ_WRITE_TOKEN is set; not exercised by the test suite): the ciphertext is
 *   uploaded under a random path; the blob URL is useless without the data key.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

/** Content type from the file's magic bytes (the declared type is never trusted on its own). */
export function sniffType(bytes: Buffer): AllowedType | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  return null;
}

/** Validates an upload: size, declared type in the allowlist and matching the sniffed type. */
export function validateUpload(bytes: Buffer, declaredType: string): AllowedType {
  if (bytes.length === 0)
    throw new AppError("VALIDATION_FAILED", { message: "The file is empty." });
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new AppError("VALIDATION_FAILED", { message: "Files must be 2 MB or smaller." });
  }
  const sniffed = sniffType(bytes);
  if (
    !sniffed ||
    !(ALLOWED_TYPES as readonly string[]).includes(declaredType) ||
    sniffed !== declaredType
  ) {
    throw new AppError("VALIDATION_FAILED", { message: "Upload a PDF, JPEG or PNG file." });
  }
  return sniffed;
}

export interface StoredFile {
  fileId: string;
  backend: "firestore" | "blob";
  contentType: AllowedType;
  size: number;
  /** Blob URL (blob backend only). */
  url?: string;
}

export interface FileStore {
  put(scope: string, bytes: Buffer, contentType: AllowedType): Promise<StoredFile>;
  get(scope: string, file: StoredFile): Promise<Buffer>;
  delete(scope: string, file: StoredFile): Promise<void>;
}

const CHUNK_BYTES = 512 * 1024;
const aadFor = (scope: string, fileId: string) => `${scope}/files/${fileId}`;

/** Wrapped data key + IV + tag in the header doc; ciphertext in chunk docs. */
export class FirestoreFileStore implements FileStore {
  async put(scope: string, bytes: Buffer, contentType: AllowedType): Promise<StoredFile> {
    const fileId = randomUUID();
    const sealed = keyring().encrypt(bytes, aadFor(scope, fileId));
    const ciphertext = Buffer.from(sealed.ct, "base64");
    const header = db().doc(`${scope}/files/${fileId}`);
    const chunks = Math.ceil(ciphertext.length / CHUNK_BYTES);
    const batch = db().batch();
    for (let index = 0; index < chunks; index++) {
      batch.set(header.collection("chunks").doc(String(index).padStart(4, "0")), {
        index,
        data: ciphertext.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES),
      });
    }
    batch.set(header, {
      sealed: { ...sealed, ct: "" },
      chunks,
      contentType,
      size: bytes.length,
      createdAt: Date.now(),
    });
    await batch.commit();
    return { fileId, backend: "firestore", contentType, size: bytes.length };
  }

  async get(scope: string, file: StoredFile): Promise<Buffer> {
    const header = db().doc(`${scope}/files/${file.fileId}`);
    const meta = (await header.get()).data() as
      { sealed: EncryptedBlob; chunks: number } | undefined;
    if (!meta) throw new AppError("NOT_FOUND", { message: "The file is no longer available." });
    const parts = await header.collection("chunks").orderBy("index").get();
    if (parts.size !== meta.chunks)
      throw new AppError("INTERNAL", { message: "The file is incomplete." });
    const ciphertext = Buffer.concat(
      parts.docs.map((doc) => Buffer.from(doc.get("data") as Uint8Array)),
    );
    return keyring().decrypt(
      { ...meta.sealed, ct: ciphertext.toString("base64") },
      aadFor(scope, file.fileId),
    );
  }

  async delete(scope: string, file: StoredFile): Promise<void> {
    await db().recursiveDelete(db().doc(`${scope}/files/${file.fileId}`));
  }
}

/** Vercel Blob backend (ciphertext only). Not covered by the automated tests. */
export class VercelBlobFileStore implements FileStore {
  constructor(private readonly token: string) {}

  async put(scope: string, bytes: Buffer, contentType: AllowedType): Promise<StoredFile> {
    const { put } = await import("@vercel/blob");
    const fileId = randomUUID();
    const sealed = keyring().encrypt(bytes, aadFor(scope, fileId));
    const blob = await put(`rr/${randomUUID()}`, Buffer.from(JSON.stringify(sealed)), {
      access: "public",
      contentType: "application/octet-stream",
      token: this.token,
      addRandomSuffix: true,
    });
    return { fileId, backend: "blob", contentType, size: bytes.length, url: blob.url };
  }

  async get(scope: string, file: StoredFile): Promise<Buffer> {
    if (!file.url) throw new AppError("NOT_FOUND", { message: "The file is no longer available." });
    const res = await fetch(file.url, { cache: "no-store" });
    if (!res.ok) throw new AppError("NOT_FOUND", { message: "The file is no longer available." });
    const sealed = (await res.json()) as EncryptedBlob;
    return keyring().decrypt(sealed, aadFor(scope, file.fileId));
  }

  async delete(_scope: string, file: StoredFile): Promise<void> {
    if (!file.url) return;
    const { del } = await import("@vercel/blob");
    await del(file.url, { token: this.token });
  }
}

let store: FileStore | undefined;

export function fileStore(): FileStore {
  if (!store) {
    const token = serverEnv().BLOB_READ_WRITE_TOKEN;
    store = token ? new VercelBlobFileStore(token) : new FirestoreFileStore();
  }
  return store;
}

/** The store that holds `file` (files keep working if the backend setting changes later). */
export function storeFor(file: StoredFile): FileStore {
  if (file.backend === "firestore") return new FirestoreFileStore();
  const token = serverEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) throw new AppError("INTERNAL", { message: "File storage is not configured." });
  return new VercelBlobFileStore(token);
}

export function resetFileStoreForTests(): void {
  store = undefined;
}
