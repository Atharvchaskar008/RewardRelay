import "server-only";
import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  FirestoreDataConverter,
  Query,
  QueryDocumentSnapshot,
  Transaction,
} from "firebase-admin/firestore";
import type { z } from "zod";
import { withDeadline } from "../deadline";
import { db } from "../firebaseAdmin";

/**
 * A typed Firestore collection: every document is validated with its zod schema on write *and* on
 * read, so a malformed document surfaces as an error instead of flowing into a handler. All methods
 * accept an optional transaction. Calls outside a transaction (and whole transactions) have the
 * backend deadline, so a Firestore outage fails a request fast instead of hanging it.
 */
export class Collection<T extends DocumentData> {
  private readonly converter: FirestoreDataConverter<T>;

  constructor(
    readonly name: string,
    readonly schema: z.ZodType<T>,
  ) {
    this.converter = {
      toFirestore: (value) => schema.parse(value),
      fromFirestore: (snapshot: QueryDocumentSnapshot) => schema.parse(snapshot.data()),
    };
  }

  collection(): CollectionReference<T> {
    return db().collection(this.name).withConverter(this.converter);
  }

  ref(id: string): DocumentReference<T> {
    return this.collection().doc(id);
  }

  async get(id: string, tx?: Transaction): Promise<T | undefined> {
    const snapshot = tx ? await tx.get(this.ref(id)) : await withDeadline(this.ref(id).get());
    return snapshot.exists ? snapshot.data() : undefined;
  }

  /** Creates the document; fails (ALREADY_EXISTS) when it exists. */
  async create(id: string, value: T, tx?: Transaction): Promise<void> {
    if (tx) tx.create(this.ref(id), value);
    else await withDeadline(this.ref(id).create(value));
  }

  async set(id: string, value: T, tx?: Transaction): Promise<void> {
    if (tx) tx.set(this.ref(id), value);
    else await withDeadline(this.ref(id).set(value));
  }

  /** Partial update of top-level fields (not schema-validated: keep updates small and explicit). */
  async update(id: string, patch: Partial<T>, tx?: Transaction): Promise<void> {
    const ref = db().collection(this.name).doc(id);
    if (tx) tx.update(ref, patch as DocumentData);
    else await withDeadline(ref.update(patch as DocumentData));
  }

  async delete(id: string, tx?: Transaction): Promise<void> {
    if (tx) tx.delete(this.ref(id));
    else await withDeadline(this.ref(id).delete());
  }

  query(): Query<T> {
    return this.collection();
  }
}

/** Runs `work` in a Firestore transaction (retried by the SDK on contention), with the deadline. */
export function transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return withDeadline(db().runTransaction(work));
}
