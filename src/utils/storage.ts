import { isLocalStorageSupported, isSessionStorageSupported } from './browserDetection';
import { getFromIndexedDB, setInIndexedDB, removeFromIndexedDB, clearIndexedDB, isIndexedDBSupported } from './indexedDBStorage';

// Type to enforce storage key validation
export type StorageKey = 
  | 'employeeRecords' 
  | 'hasUploadedFile' 
  | 'currentFileName' 
  | 'totalEmployees' 
  | 'totalDays'
  | 'lastSyncTimestamp'
  | 'storageVersion'
  | 'storageType';

// Memory fallback when other storage options are not available
const memoryStorage: Record<string, string> = {};

// Current storage version - increment when storage format changes
export const STORAGE_VERSION = '1.1';

// Supported storage types
export enum StorageType {
  LOCAL_STORAGE = 'localStorage',
  SESSION_STORAGE = 'sessionStorage',
  INDEXED_DB = 'indexedDB',
  MEMORY = 'memory'
}

// Get the best available storage type
export const getBestAvailableStorageType = (): StorageType => {
  if (isLocalStorageSupported()) {
    return StorageType.LOCAL_STORAGE;
  } else if (isIndexedDBSupported()) {
    return StorageType.INDEXED_DB;
  } else if (isSessionStorageSupported()) {
    return StorageType.SESSION_STORAGE;
  } else {
    return StorageType.MEMORY;
  }
};

// Get the current storage type
export const getCurrentStorageType = (): StorageType => {
  if (typeof window === 'undefined') {
    return StorageType.MEMORY;
  }
  
  try {
    const storedType = localStorage.getItem('storageType');
    if (storedType && Object.values(StorageType).includes(storedType as StorageType)) {
      return storedType as StorageType;
    }
    
    // If not found, determine and save the best available storage
    const bestType = getBestAvailableStorageType();
    localStorage.setItem('storageType', bestType);
    return bestType;
  } catch (e) {
    // If localStorage fails, determine without saving
    return getBestAvailableStorageType();
  }
};

/**
 * Check if storage is supported and available
 */
export const isStorageAvailable = (): boolean => {
  const storageType = getCurrentStorageType();
  
  switch (storageType) {
    case StorageType.LOCAL_STORAGE:
      return isLocalStorageSupported();
    case StorageType.INDEXED_DB:
      return isIndexedDBSupported();
    case StorageType.SESSION_STORAGE:
      return isSessionStorageSupported();
    case StorageType.MEMORY:
      return true; // Memory storage is always available
    default:
      return false;
  }
};

/**
 * Get an item from storage with error handling and cascading fallbacks
 */
export const getStorageItem = async <T>(key: StorageKey, defaultValue: T): Promise<T> => {
  try {
    const storageType = getCurrentStorageType();
    
    // Try the preferred storage method first
    switch (storageType) {
      case StorageType.LOCAL_STORAGE:
        if (isLocalStorageSupported()) {
          const item = localStorage.getItem(key);
          if (item === null) {
            return defaultValue;
          }
          
          try {
            return JSON.parse(item);
          } catch (parseError) {
            console.warn(`Failed to parse localStorage item ${key}:`, parseError);
            
            // Try IndexedDB as fallback
            if (isIndexedDBSupported()) {
              return getFromIndexedDB(key, defaultValue);
            }
          }
        }
        // Fall through to IndexedDB if localStorage is not supported
        
      case StorageType.INDEXED_DB:
        if (isIndexedDBSupported()) {
          return await getFromIndexedDB(key, defaultValue);
        }
        // Fall through to SessionStorage if IndexedDB is not supported
        
      case StorageType.SESSION_STORAGE:
        if (isSessionStorageSupported()) {
          const item = sessionStorage.getItem(key);
          if (item === null) {
            return defaultValue;
          }
          
          try {
            return JSON.parse(item);
          } catch (parseError) {
            console.warn(`Failed to parse sessionStorage item ${key}:`, parseError);
          }
        }
        // Fall through to memory storage if sessionStorage is not supported
        
      case StorageType.MEMORY:
      default:
        const item = memoryStorage[key];
        if (!item) {
          return defaultValue;
        }
        
        try {
          return JSON.parse(item);
        } catch (parseError) {
          console.warn(`Failed to parse memory storage item ${key}:`, parseError);
          return defaultValue;
        }
    }
  } catch (error) {
    console.error(`Error getting storage item ${key}:`, error);
    return defaultValue;
  }
};

/**
 * Set an item in storage with error handling and fallbacks
 */
export const setStorageItem = async <T>(key: StorageKey, value: T): Promise<boolean> => {
  try {
    const serialized = JSON.stringify(value);
    const storageType = getCurrentStorageType();
    
    // Try to store in all available storage types for redundancy
    let primarySuccess = false;
    
    switch (storageType) {
      case StorageType.LOCAL_STORAGE:
        if (isLocalStorageSupported()) {
          try {
            localStorage.setItem(key, serialized);
            primarySuccess = true;
          } catch (e) {
            console.warn(`localStorage set failed for ${key}, trying IndexedDB`, e);
          }
        }
        
        // Try IndexedDB as secondary storage
        if (isIndexedDBSupported()) {
          try {
            await setInIndexedDB(key, value);
            if (!primarySuccess) primarySuccess = true;
          } catch (e) {
            console.warn(`IndexedDB set failed for ${key}`, e);
          }
        }
        
        break;
        
      case StorageType.INDEXED_DB:
        if (isIndexedDBSupported()) {
          try {
            await setInIndexedDB(key, value);
            primarySuccess = true;
          } catch (e) {
            console.warn(`IndexedDB set failed for ${key}`, e);
          }
        }
        break;
        
      case StorageType.SESSION_STORAGE:
        if (isSessionStorageSupported()) {
          try {
            sessionStorage.setItem(key, serialized);
            primarySuccess = true;
          } catch (e) {
            console.warn(`sessionStorage set failed for ${key}`, e);
          }
        }
        break;
    }
    
    // Always store in memory as a last resort
    if (!primarySuccess) {
      memoryStorage[key] = serialized;
      console.log(`Using memory fallback for ${key}`);
      return true;
    }
    
    return primarySuccess;
  } catch (error) {
    console.error(`Error setting storage item ${key}:`, error);
    
    // Last resort: try memory storage
    try {
      memoryStorage[key] = JSON.stringify(value);
      return true;
    } catch (memError) {
      console.error(`Even memory storage failed for ${key}:`, memError);
      return false;
    }
  }
};

/**
 * Remove an item from storage with error handling
 */
export const removeStorageItem = async (key: StorageKey): Promise<boolean> => {
  try {
    const storageType = getCurrentStorageType();
    
    switch (storageType) {
      case StorageType.LOCAL_STORAGE:
        if (isLocalStorageSupported()) {
          localStorage.removeItem(key);
        }
        
        // Also remove from IndexedDB for consistency
        if (isIndexedDBSupported()) {
          await removeFromIndexedDB(key);
        }
        break;
        
      case StorageType.INDEXED_DB:
        if (isIndexedDBSupported()) {
          await removeFromIndexedDB(key);
        }
        break;
        
      case StorageType.SESSION_STORAGE:
        if (isSessionStorageSupported()) {
          sessionStorage.removeItem(key);
        }
        break;
    }
    
    // Always remove from memory storage
    delete memoryStorage[key];
    
    return true;
  } catch (error) {
    console.error(`Error removing storage item ${key}:`, error);
    return false;
  }
};

/**
 * Clear all application storage items
 */
export const clearAppStorage = async (): Promise<boolean> => {
  try {
    const keys: StorageKey[] = [
      'employeeRecords', 
      'hasUploadedFile', 
      'currentFileName', 
      'totalEmployees', 
      'totalDays',
      'lastSyncTimestamp'
    ];
    
    // Clear each storage type
    if (isLocalStorageSupported()) {
      keys.forEach(key => {
        localStorage.removeItem(key);
      });
    }
    
    if (isIndexedDBSupported()) {
      await clearIndexedDB();
    }
    
    if (isSessionStorageSupported()) {
      keys.forEach(key => {
        sessionStorage.removeItem(key);
      });
    }
    
    // Clear memory storage
    keys.forEach(key => {
      delete memoryStorage[key];
    });
    
    // Keep the storage version in all available storages
    if (isLocalStorageSupported()) {
      localStorage.setItem('storageVersion', STORAGE_VERSION);
    }
    
    if (isIndexedDBSupported()) {
      await setInIndexedDB('storageVersion', STORAGE_VERSION);
    }
    
    if (isSessionStorageSupported()) {
      sessionStorage.setItem('storageVersion', STORAGE_VERSION);
    }
    
    memoryStorage['storageVersion'] = JSON.stringify(STORAGE_VERSION);
    
    return true;
  } catch (error) {
    console.error('Error clearing app storage:', error);
    return false;
  }
};

/**
 * Initialize storage with version check
 * This helps handle migration between versions
 */
export const initializeStorage = async (): Promise<void> => {
  try {
    // Ensure we have a storage type set
    const storageType = getCurrentStorageType();
    console.log(`Using storage type: ${storageType}`);
    
    // Check storage version
    const storedVersion = await getStorageItem<string>('storageVersion', '');
    
    // If version mismatch, handle migration or reset
    if (storedVersion !== STORAGE_VERSION) {
      console.log(`Storage version mismatch: stored=${storedVersion}, current=${STORAGE_VERSION}`);
      
      // For now, just update the version
      await setStorageItem('storageVersion', STORAGE_VERSION);
    }
  } catch (error) {
    console.error('Error initializing storage:', error);
  }
};

/**
 * Check for any storage corruption issues and fix them
 */
export const validateAndFixStorage = async (): Promise<boolean> => {
  try {
    // Validate employeeRecords format
    const records = await getStorageItem('employeeRecords', null);
    if (records !== null && !Array.isArray(records)) {
      console.warn('Invalid employeeRecords format, resetting');
      await setStorageItem('employeeRecords', []);
    }
    
    // Validate numeric values
    for (const key of ['totalEmployees', 'totalDays']) {
      const value = await getStorageItem(key as StorageKey, null);
      if (value !== null && typeof value !== 'number') {
        console.warn(`Invalid ${key} format, resetting`);
        await setStorageItem(key as StorageKey, 0);
      }
    }
    
    // Validate boolean values
    const hasUploadedFile = await getStorageItem('hasUploadedFile', null);
    if (hasUploadedFile !== null && typeof hasUploadedFile !== 'boolean') {
      console.warn('Invalid hasUploadedFile format, resetting');
      await setStorageItem('hasUploadedFile', false);
    }
    
    return true;
  } catch (error) {
    console.error('Error validating storage:', error);
    return false;
  }
};