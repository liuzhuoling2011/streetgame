import type { SaveSlot } from './types';

const DB_NAME = 'streetgame';
const STORE = 'slots';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function slotKey(gameId: string, slot: number): string {
  return `${gameId}:${slot}`;
}

export async function writeSlot(record: SaveSlot): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record, slotKey(record.gameId, record.slot));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function readSlot(gameId: string, slot: number): Promise<SaveSlot | null> {
  const db = await openDb();
  const record = await new Promise<SaveSlot | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(slotKey(gameId, slot));
    request.onsuccess = () => resolve((request.result as SaveSlot | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return record;
}

export async function listSlots(gameId: string): Promise<Array<SaveSlot | null>> {
  return Promise.all([1, 2, 3, 4].map((slot) => readSlot(gameId, slot)));
}
