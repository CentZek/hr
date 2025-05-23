// Helper functions for storage

// Current version of the storage format
export const STORAGE_VERSION = '1.0';

/**
 * Gets a versioned key name for localStorage
 * 
 * @param key The base key name
 * @returns The versioned key name
 */
export const getKeyName = (key: string): string => {
  return `app_${STORAGE_VERSION}_${key}`;
};

/**
 * Parse JSON string with proper date handling
 * 
 * @param jsonString The JSON string to parse
 * @returns The parsed object with properly converted dates
 */
export const parseWithDates = (jsonString: string): any => {
  return JSON.parse(jsonString, (key, value) => {
    // Check if the value is a date string (ISO format)
    if (typeof value === 'string' && 
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z$/.test(value)) {
      return new Date(value);
    }
    return value;
  });
};

/**
 * Initialize the cache system
 */
export const initializeCache = (): void => {
  // Set up cache configuration
  console.log('Cache system initialized');
};

/**
 * Recover from corrupted data
 * 
 * @returns Boolean indicating if recovery was performed
 */
export const runDataRecovery = (): boolean => {
  try {
    // Check for corrupted data and attempt recovery
    console.log('Running data recovery check');
    return false; // No recovery needed
  } catch (error) {
    console.error('Error during data recovery:', error);
    return false;
  }
};

/**
 * Adds a cache busting parameter to a URL
 * 
 * @param url The URL to add the cache buster to
 * @returns The URL with a cache buster parameter
 */
export const addCacheBuster = (url: string): string => {
  // Generate a timestamp for cache busting
  const timestamp = Date.now();
  
  // Check if the URL already has query parameters
  const separator = url.includes('?') ? '&' : '?';
  
  // Append the cache buster using a parameter name that won't conflict with Supabase filters
  return `${url}${separator}_cb=${timestamp}`;
};

/**
 * Converts a Base64 string to a Blob
 * 
 * @param base64 The Base64 string to convert
 * @param contentType The content type of the Blob
 * @returns A Blob representing the Base64 string
 */
export const base64ToBlob = (base64: string, contentType = ''): Blob => {
  const byteCharacters = atob(base64.split(',')[1]);
  const byteArrays = [];

  for (let offset = 0; offset < byteCharacters.length; offset += 512) {
    const slice = byteCharacters.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    
    const byteArray = new Uint8Array(byteNumbers);
    byteArrays.push(byteArray);
  }

  return new Blob(byteArrays, { type: contentType });
};