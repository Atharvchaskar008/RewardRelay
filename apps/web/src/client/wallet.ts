import {
  getAddress,
  type Address,
  type Hex,
  type SignableMessage,
  type TransactionSerializable,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * The embedded wallet: a private key generated in the browser and stored only encrypted with the
 * user's PIN (WebCrypto PBKDF2-SHA-256 → AES-256-GCM, address as additional data). It is unlocked
 * into memory once per session and locks itself after 30 minutes without use. The plaintext key is
 * never written to storage, never sent to the server and never exposed by this module's API.
 */

export const PBKDF2_ITERATIONS = 310_000;
export const IDLE_LOCK_MS = 30 * 60_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** The encrypted key as stored in IndexedDB and uploaded as the server backup. */
export interface EncryptedKey {
  address: Address;
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: { name: "PBKDF2"; iterations: number; hash: "SHA-256" };
  version: 1;
}

export class WalletLockedError extends Error {
  constructor() {
    super("The wallet is locked. Enter your PIN to unlock it.");
    this.name = "WalletLockedError";
  }
}

export class WrongPinError extends Error {
  constructor() {
    super("That PIN is not correct.");
    this.name = "WrongPinError";
  }
}

export interface KeyStore {
  load(): Promise<EncryptedKey | null>;
  save(record: EncryptedKey): Promise<void>;
  clear(): Promise<void>;
}

/** IndexedDB storage (one record). */
export class IndexedDbKeyStore implements KeyStore {
  constructor(
    private readonly dbName = "rewardrelay-wallet",
    private readonly storeName = "keys",
    private readonly recordKey = "primary",
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async run<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(this.storeName, mode).objectStore(this.storeName));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async load(): Promise<EncryptedKey | null> {
    return (
      (await this.run<EncryptedKey | undefined>("readonly", (store) =>
        store.get(this.recordKey),
      )) ?? null
    );
  }

  async save(record: EncryptedKey): Promise<void> {
    await this.run("readwrite", (store) => store.put(record, this.recordKey));
  }

  async clear(): Promise<void> {
    await this.run("readwrite", (store) => store.delete(this.recordKey));
  }
}

/** In-memory storage (tests, or browsers without IndexedDB). */
export class MemoryKeyStore implements KeyStore {
  private record: EncryptedKey | null = null;
  async load() {
    return this.record;
  }
  async save(record: EncryptedKey) {
    this.record = { ...record };
  }
  async clear() {
    this.record = null;
  }
}

/** PIN rule: 6 to 12 digits. */
export function validatePin(pin: string): void {
  if (!/^\d{6,12}$/.test(pin)) throw new Error("The PIN must be 6 to 12 digits.");
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const encoder = new TextEncoder();

function hexToBytes(hex: Hex): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function deriveKey(
  pin: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptPrivateKey(
  privateKey: Hex,
  pin: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<EncryptedKey> {
  validatePin(pin);
  const address = privateKeyToAccount(privateKey).address;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(pin, salt, iterations);
  const plaintext = hexToBytes(privateKey);
  try {
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: encoder.encode(address.toLowerCase()) },
        key,
        plaintext,
      ),
    );
    return {
      address,
      ciphertext: toBase64(ciphertext),
      iv: toBase64(iv),
      salt: toBase64(salt),
      kdf: { name: "PBKDF2", iterations, hash: "SHA-256" },
      version: 1,
    };
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptPrivateKey(record: EncryptedKey, pin: string): Promise<Hex> {
  const key = await deriveKey(pin, fromBase64(record.salt), record.kdf.iterations);
  let plaintext: Uint8Array;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64(record.iv),
          additionalData: encoder.encode(getAddress(record.address).toLowerCase()),
        },
        key,
        fromBase64(record.ciphertext),
      ),
    );
  } catch {
    throw new WrongPinError();
  }
  const privateKey = bytesToHex(plaintext);
  plaintext.fill(0);
  if (privateKeyToAccount(privateKey).address !== getAddress(record.address))
    throw new WrongPinError();
  return privateKey;
}

export class EmbeddedWallet {
  private account: PrivateKeyAccount | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: KeyStore = new IndexedDbKeyStore(),
    private readonly options: { idleMs?: number; iterations?: number } = {},
  ) {}

  /** The stored wallet's address (works while locked), or null when no wallet exists here. */
  async storedAddress(): Promise<Address | null> {
    return (await this.store.load())?.address ?? null;
  }

  isUnlocked(): boolean {
    return this.account !== null;
  }

  /** Creates a new key, stores it encrypted and unlocks it. Returns the backup blob to upload. */
  async create(pin: string): Promise<{ address: Address; backup: EncryptedKey }> {
    if (await this.store.load()) throw new Error("A wallet already exists on this device.");
    const privateKey = generatePrivateKey();
    const backup = await encryptPrivateKey(privateKey, pin, this.options.iterations);
    await this.store.save(backup);
    this.activate(privateKeyToAccount(privateKey));
    return { address: backup.address, backup };
  }

  async unlock(pin: string): Promise<Address> {
    const record = await this.store.load();
    if (!record) throw new Error("No wallet on this device. Create one or restore a backup.");
    this.activate(privateKeyToAccount(await decryptPrivateKey(record, pin)));
    return record.address;
  }

  /** Restores a server backup with its PIN (wrong PIN → WrongPinError, nothing is stored). */
  async restore(backup: EncryptedKey, pin: string): Promise<Address> {
    const privateKey = await decryptPrivateKey(backup, pin);
    await this.store.save(backup);
    this.activate(privateKeyToAccount(privateKey));
    return backup.address;
  }

  /** The stored encrypted blob (for upload to /api/wallet/backup). */
  async exportBackup(): Promise<EncryptedKey> {
    const record = await this.store.load();
    if (!record) throw new Error("No wallet on this device.");
    return record;
  }

  lock(): void {
    this.account = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.listeners.forEach((listener) => listener());
  }

  /** Removes the wallet from this device (the server backup is untouched). */
  async forget(): Promise<void> {
    this.lock();
    await this.store.clear();
  }

  onLock(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The unlocked account (viem LocalAccount) for wallet clients; each use resets the idle timer. */
  getAccount(): PrivateKeyAccount {
    if (!this.account) throw new WalletLockedError();
    this.touch();
    return this.account;
  }

  signMessage(message: SignableMessage): Promise<Hex> {
    return this.getAccount().signMessage({ message });
  }

  signTransaction(transaction: TransactionSerializable): Promise<Hex> {
    return this.getAccount().signTransaction(transaction);
  }

  private activate(account: PrivateKeyAccount): void {
    this.account = account;
    this.touch();
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.lock(), this.options.idleMs ?? IDLE_LOCK_MS);
  }
}
