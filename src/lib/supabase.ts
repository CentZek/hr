import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate that we have the required environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env file.');
}

// Function to implement retry logic with exponential backoff
const fetchWithRetry = async (url, options, retries = 3, backoff = 300) => {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (retries <= 0) {
      console.error('Supabase fetch failed after multiple retries:', err);
      throw err;
    }
    
    console.warn(`Supabase fetch error, retrying (${retries} attempts left):`, err);
    
    // Wait with exponential backoff
    await new Promise(resolve => setTimeout(resolve, backoff));
    
    // Retry with exponential backoff
    return fetchWithRetry(url, options, retries - 1, backoff * 2);
  }
};

// Enhanced options to improve network reliability
const options = {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
  global: {
    fetch: (url, options) => {
      // Add enhanced retry logic for network errors
      return fetchWithRetry(url, options);
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
    if (error) {
      console.error('Supabase connection check failed:', error.message);
      return { connected: false, error: error.message };
    }
    return { connected: true, error: null };
  } catch (err) {
    console.error('Supabase connection check failed:', err);
    return { connected: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
};

// Log successful initialization
console.log('Supabase client initialized with URL:', supabaseUrl);

// Export a function to check if the Supabase configuration is valid
export const isSupabaseConfigValid = () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Invalid Supabase configuration. Please check your .env file.');
    return false;
  }
  return true;
};