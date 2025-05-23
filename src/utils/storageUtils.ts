// Helper functions for storage

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