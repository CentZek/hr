import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate that we have the required environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

// Function to implement retry logic with exponential backoff
const fetchWithRetry = async (url, options, retries = 3, backoff = 300) => {
  try {
    // Enhanced fetch options with CORS credentials
    const enhancedOptions = {
      ...options,
      headers: {
        ...options?.headers,
        'Accept': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`
      }
    };
    
    return await fetch(url, enhancedOptions);
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
    detectSessionInUrl: false, // Disable URL detection which can cause CORS issues
  },
  global: {
    fetch: fetchWithRetry,
    headers: {
      'X-Client-Info': 'supabase-js/2.x',
      'Content-Type': 'application/json',
    },
  },
  // Adding specific storage configuration
  storage: {
    persistSession: true
  },
  realtime: {
    // Optimize websocket connections
    timeout: 30000, // 30 seconds
    params: {
      eventsPerSecond: 10
    }
  }
};

// Create the Supabase client with error handling
export const supabase = createClient(supabaseUrl, supabaseAnonKey, options);

// Add a simple health check function to test connectivity
export const checkSupabaseConnection = async () => {
  try {
    // Try a basic health check
    const response = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseAnonKey}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      }
    });
    
    if (!response.ok) {
      return { 
        connected: false, 
        error: `Supabase API returned ${response.status}: ${response.statusText}` 
      };
    }
    
    return { connected: true, error: null };
  } catch (err) {
    console.error('Supabase connection check failed:', err);
    return { 
      connected: false, 
      error: err instanceof Error ? err.message : 'Unknown error' 
    };
  }
};

// Function to test CORS specifically
export const testCorsAccess = async () => {
  try {
    const testUrl = `${supabaseUrl}/rest/v1/?apikey=${supabaseAnonKey}`;
    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      },
      mode: 'cors',
    });
    
    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText
    };
  } catch (err) {
    console.error('CORS test failed:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
};

// Log successful initialization
console.log('Supabase client initialized with URL:', supabaseUrl);

// Helper function to diagnose network issues
export const diagnoseSupabaseConnection = async () => {
  // Test basic fetch without Supabase client
  try {
    console.log('Testing direct fetch to Supabase...');
    const testResult = await testCorsAccess();
    console.log('Direct fetch test result:', testResult);
    
    // Test Supabase client
    console.log('Testing Supabase client connection...');
    const connectionCheck = await checkSupabaseConnection();
    console.log('Supabase connection check result:', connectionCheck);
    
    return {
      directFetch: testResult,
      clientConnection: connectionCheck
    };
  } catch (error) {
    console.error('Network diagnostic failed:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown diagnostic error'
    };
  }
};

// Export a function to check if the Supabase configuration is valid
export const isSupabaseConfigValid = () => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Invalid Supabase configuration. Please check your .env file.');
    return false;
  }
  return true;
};