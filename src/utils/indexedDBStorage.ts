import { StorageKey, STORAGE_VERSION } from './storage';

// IndexedDB database name and version
const DB_NAME = 'employee_time_tracking';
const DB_VERSION = 1;
const STORE_NAME = 'app_data';

/**
 * Initialize the IndexedDB database
 */
export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject(new Error(`IndexedDB error: ${(event.target as IDBOpenDBRequest).error?.message}`));
    };
  });
};

/**
 * Get an item from IndexedDB
 */
export const getFromIndexedDB = async <T>(key: StorageKey, defaultValue: T): Promise<T> => {
  try {
    const db = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.value);
        } else {
          resolve(defaultValue);
        }
      };

      request.onerror = () => {
        reject(new Error(`Error getting ${key} from IndexedDB`));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error(`IndexedDB get error for ${key}:`, error);
    return defaultValue;
  }
};

/**
 * Set an item in IndexedDB
 */
export const setInIndexedDB = async <T>(key: StorageKey, value: T): Promise<boolean> => {
  try {
    const db = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({ key, value });

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(new Error(`Error setting ${key} in IndexedDB`));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error(`IndexedDB set error for ${key}:`, error);
    return false;
  }
};

/**
 * Remove an item from IndexedDB
 */
export const removeFromIndexedDB = async (key: StorageKey): Promise<boolean> => {
  try {
    const db = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(new Error(`Error removing ${key} from IndexedDB`));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error(`IndexedDB remove error for ${key}:`, error);
    return false;
  }
};

/**
 * Clear all app data from IndexedDB
 */
export const clearIndexedDB = async (): Promise<boolean> => {
  try {
    const db = await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        // Keep storage version
        setInIndexedDB('storageVersion', STORAGE_VERSION);
        resolve(true);
      };

      request.onerror = () => {
        reject(new Error('Error clearing IndexedDB'));
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('IndexedDB clear error:', error);
    return false;
  }
};

/**
 * Check if IndexedDB is supported in this browser
 */
export const isIndexedDBSupported = (): boolean => {
  return typeof window !== 'undefined' && !!window.indexedDB;
};