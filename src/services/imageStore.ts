/**
 * IndexedDB-based image store for persisting generated images across page refreshes.
 *
 * localStorage has a ~5-10MB limit and strips base64 data on save.
 * IndexedDB can hold GBs of data and is the correct storage for image blobs.
 * This serves as the primary local persistence layer for generated images,
 * with Supabase as an optional cloud backup.
 *
 * Key format: "{jobId}/{productId}/{imageId}"
 */

const DB_NAME = 'shopify-image-gen';
const STORE_NAME = 'images';
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      // Reset instance if database is closed unexpectedly
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Build a storage key for an image
 */
export const imageKey = (jobId: string, productId: number, imageId: string): string =>
  `${jobId}/${productId}/${imageId}`;

/**
 * Save a generated image's base64 data to IndexedDB
 */
export const saveImageToStore = async (key: string, base64: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(base64, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB not available - silently fail (images won't persist across refreshes)
  }
};

/**
 * Load an image's base64 data from IndexedDB
 */
export const loadImageFromStore = async (key: string): Promise<string | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
};

/**
 * Delete all images for a specific job
 */
export const deleteJobImagesFromStore = async (jobId: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(jobId + '/')) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cleanup failed silently - non-fatal
  }
};

/**
 * Delete a specific image from the store
 */
export const deleteImageFromStore = async (key: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cleanup failed silently - non-fatal
  }
};
