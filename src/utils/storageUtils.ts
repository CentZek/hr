// Storage utilities to handle data corruption and version management
import toast from 'react-hot-toast';

// Current storage version - update this when making breaking changes to data structure
export const STORAGE_VERSION = 'v3';

// Key names with versioning
export const getKeyName = (baseName: string) => `${baseName}_${STORAGE_VERSION}`;

// Custom reviver function to convert ISO date strings back to Date objects
export const dateReviver = (_key: string, value: any): any => {
  // Check if the value is a string and matches ISO date format with more permissive regex
  if (
    typeof value === 'string' && 
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+\-]\d{2}:\d{2})?$/.test(value)
  ) {
    return new Date(value);
  }
  
  // If the value is an object (but not null), recursively check for date strings
  if (value !== null && typeof value === 'object') {
    // For arrays, just return as-is (the array elements will be processed individually)
    if (Array.isArray(value)) {
      return value;
    }
    
    // For objects, handle special fields that we know should be dates
    const dateFieldNames = [
      'firstCheckIn', 'lastCheckOut', 'timestamp', 
      'date', 'checkIn', 'checkOut', 'checkInDate', 
      'checkOutDate', 'created_at', 'updated_at'
    ];
    
    for (const field of dateFieldNames) {
      if (value[field] && typeof value[field] === 'string') {
        try {
          value[field] = new Date(value[field]);
        } catch (e) {
          console.warn(`Failed to convert ${field} to Date:`, e);
        }
      }
    }
  }
  
  return value;
};

// Parse JSON with Date object restoration
export const parseWithDates = (jsonString: string): any => {
  try {
    return JSON.parse(jsonString, dateReviver);
  } catch (error) {
    console.error('Error parsing JSON with dates:', error);
    throw error;
  }
};

// Clear all data for a specific version
export const clearVersionData = (version: string) => {
  // Get all localStorage keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.endsWith(`_${version}`)) {
      localStorage.removeItem(key);
    }
  }
};

// Clear all app data (all versions)
export const clearAllAppData = () => {
  // Get all localStorage keys that match our app's pattern
  const appKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('employeeRecords') || 
                key.startsWith('hasUploadedFile') || 
                key.startsWith('currentFileName') || 
                key.startsWith('totalEmployees') || 
                key.startsWith('totalDays'))) {
      appKeys.push(key);
    }
  }
  
  // Remove all matching keys
  appKeys.forEach(key => localStorage.removeItem(key));
};

// Check data integrity 
export const checkDataIntegrity = (): boolean => {
  try {
    // Check if employee records exists and is valid
    const recordsKey = getKeyName('employeeRecords');
    const recordsData = localStorage.getItem(recordsKey);
    
    if (recordsData) {
      // Try to parse the data
      parseWithDates(recordsData);
    }
    
    return true;
  } catch (error) {
    console.error('Data integrity check failed:', error);
    return false;
  }
};

// Auto-recovery system - call this on app startup
export const runDataRecovery = (): boolean => {
  try {
    // First check data integrity
    if (!checkDataIntegrity()) {
      // Clear current version data if it's corrupted
      clearVersionData(STORAGE_VERSION);
      toast.error('Data corruption detected. Your data has been reset.', {
        duration: 5000,
        id: 'data-corruption',
      });
      return true; // Recovery performed
    }
    
    // Check for old versions and clean them up
    const oldVersions = ['v1', 'v2'];
    let oldDataCleared = false;
    
    oldVersions.forEach(version => {
      if (version !== STORAGE_VERSION) {
        // Check if we have data for this old version
        let hasOldVersion = false;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.endsWith(`_${version}`)) {
            hasOldVersion = true;
            break;
          }
        }
        
        if (hasOldVersion) {
          clearVersionData(version);
          oldDataCleared = true;
        }
      }
    });
    
    // Also clear any unversioned data
    let hasUnversionedData = false;
    const unversionedKeys = ['employeeRecords', 'hasUploadedFile', 'currentFileName', 'totalEmployees', 'totalDays'];
    
    unversionedKeys.forEach(key => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        hasUnversionedData = true;
      }
    });
    
    // Show a notification if we cleaned up old data
    if (oldDataCleared || hasUnversionedData) {
      toast.success('App data has been updated to the latest version.', { 
        duration: 3000,
        id: 'data-version-update'
      });
      return true; // Recovery performed
    }
    
    return false; // No recovery needed
  } catch (error) {
    console.error('Error in data recovery:', error);
    // If recovery itself fails, do a full clear as a last resort
    clearAllAppData();
    toast.error('Unable to recover data. All data has been reset.', { 
      duration: 5000,
      id: 'data-recovery-failed'
    });
    return true; // Recovery performed (emergency full clear)
  }
};

// Initialize caching system for app stability
export const initializeCache = () => {
  // Set a cache version timestamp in sessionStorage
  const cacheTimestamp = Date.now().toString();
  sessionStorage.setItem('app_cache_timestamp', cacheTimestamp);
  
  // Attach it as a query parameter to fetch requests to avoid browser cache
  return cacheTimestamp;
};

// Add a timestamp to URLs to bust cache
export const addCacheBuster = (url: string): string => {
  const timestamp = sessionStorage.getItem('app_cache_timestamp') || Date.now().toString();
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${timestamp}`;
};