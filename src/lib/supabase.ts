import { createClient } from '@supabase/supabase-js';
import { addCacheBuster } from '../utils/storageUtils';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate that we have the required environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env file.');
}

// Enhanced options to improve network reliability
const options = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
  global: {
    fetch: (...args: any[]) => {
      // Skip cache busting for Supabase REST API calls
      let url: string;
      
      if (typeof args[0] === 'string') {
        url = args[0];
      } else if (args[0] instanceof Request) {
        url = args[0].url;
      } else {
        // If it's neither a string nor a Request, proceed with the original fetch
        return fetch(...args).catch(err => {
          console.warn('Supabase fetch error, retrying:', err);
          return new Promise(resolve => setTimeout(resolve, 1000))
            .then(() => fetch(...args));
        });
      }
      
      // Skip cache busting for Supabase REST API calls
      // Check if the URL contains '/rest/v1/' which indicates it's a Supabase REST API call
      if (url.includes('/rest/v1/')) {
        // Don't add cache buster for REST API calls
        return fetch(...args).catch(err => {
          console.warn('Supabase fetch error, retrying:', err);
          return new Promise(resolve => setTimeout(resolve, 1000))
            .then(() => fetch(...args));
        });
      }
      
      // For non-REST API calls, add the cache buster
      if (typeof args[0] === 'string') {
        args[0] = addCacheBuster(args[0]);
      } else if (args[0] instanceof Request) {
        const modifiedUrl = addCacheBuster(args[0].url);
        args[0] = new Request(modifiedUrl, args[0]);
      }
      
      // Add retry logic for network errors
      return fetch(...args).catch(err => {
        console.warn('Supabase fetch error, retrying:', err);
        // Retry once after a short delay
        return new Promise(resolve => setTimeout(resolve, 1000))
          .then(() => fetch(...args));
      });
    },
    headers: {
      'X-Client-Info': 'supabase-js/2.x',
    },
  },
};

// Create the Supabase client with error handling
export const supabase = createClient(supabaseUrl, supabaseAnonKey, options);

// Add a simple health check function to test connectivity
export const checkSupabaseConnection = async () => {
  try {
    const { error } = await supabase.from('employees').select('count', { count: 'exact', head: true });
    return { connected: !error, error: error?.message };
  } catch (err) {
    console.error('Supabase connection check failed:', err);
    return { connected: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
};

console.log('Supabase client initialized with URL:', supabaseUrl);