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
    const response = await fetch(url, options);
    
    // Check if the response is ok (status in the range 200-299)
    if (!response.ok) {
      // For non-2xx responses, throw an error to trigger retry
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
    }
    
    return response;
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
      return fetchWithRetry(url, options, 5, 500); // Increased retries and initial backoff
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

// Function to perform a connectivity test before making critical requests
export const testSupabaseConnectivity = async () => {
  try {
    const testResponse = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseAnonKey}`, {
      method: 'HEAD',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
    });
    
    return testResponse.ok;
  } catch (error) {
    console.error('Supabase connectivity test failed:', error);
    return false;
  }
};