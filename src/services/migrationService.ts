import { supabase } from '../lib/supabase';

// Initialize user credentials for all existing employees
export const initializeUserCredentials = async () => {
  try {
    console.log('Starting credentials initialization...');
    
    // Get all employees
    const { data: employees, error: employeesError } = await supabase
      .from('employees')
      .select('id, name, employee_number');
    
    if (employeesError) {
      throw employeesError;
    }
    
    console.log(`Found ${employees?.length || 0} employees`);
    
    if (!employees || employees.length === 0) {
      return { success: true, message: 'No employees to process', count: 0 };
    }
    
    // For each employee, check if they already have credentials
    const { data: existingCredentials, error: credentialsError } = await supabase
      .from('user_credentials')
      .select('employee_id');
      
    if (credentialsError) {
      throw credentialsError;
    }
    
    // Get all existing usernames to avoid duplicates
    const { data: existingUsernames, error: usernamesError } = await supabase
      .from('user_credentials')
      .select('username');
      
    if (usernamesError) {
      throw usernamesError;
    }
    
    // Create sets for quick lookups - make usernames lowercase for case-insensitive comparison
    const existingEmployeeIds = new Set(existingCredentials?.map(cred => cred.employee_id) || []);
    const existingUsernameSet = new Set((existingUsernames || []).map(cred => cred.username.toLowerCase()));
    
    console.log(`Found ${existingEmployeeIds.size} existing credentials`);
    
    // Filter out employees that already have credentials
    const employeesNeedingCredentials = employees.filter(emp => !existingEmployeeIds.has(emp.id));
    console.log(`Need to create credentials for ${employeesNeedingCredentials.length} employees`);
    
    if (employeesNeedingCredentials.length === 0) {
      return { success: true, message: 'All employees already have credentials', count: 0 };
    }
    
    // Generate unique usernames and create credentials
    const credentialsToInsert = [];
    let skippedCount = 0;
    
    for (const emp of employeesNeedingCredentials) {
      // Generate a sanitized base username - remove spaces and special characters
      const sanitizedName = emp.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
        .trim();
      
      // Start with a base username that includes the employee number for uniqueness
      let baseUsername = `${sanitizedName}_${emp.employee_number}`.toLowerCase();
      let username = baseUsername;
      let counter = 1;
      
      // If username exists, append a number until we find a unique one
      while (existingUsernameSet.has(username.toLowerCase())) {
        username = `${baseUsername}_${counter}`;
        counter++;
        
        // Safety check to prevent infinite loops
        if (counter > 100) {
          console.warn(`Could not generate unique username for employee ${emp.id} after 100 attempts`);
          skippedCount++;
          continue; // Skip this employee
        }
      }
      
      // Check one more time with the database to ensure uniqueness
      // This double-check helps prevent race conditions and ensures the username is truly unique
      try {
        const { data: usernameCheck, error: checkError } = await supabase
          .from('user_credentials')
          .select('id')
          .ilike('username', username);
          
        if (checkError) {
          console.error(`Error checking username uniqueness for ${username}:`, checkError);
          skippedCount++;
          continue;
        }
        
        if (usernameCheck && usernameCheck.length > 0) {
          console.warn(`Username ${username} already exists despite our checks. Skipping.`);
          skippedCount++;
          continue;
        }
        
        // Add the username to our set to prevent duplicates in this batch
        existingUsernameSet.add(username.toLowerCase());
        
        credentialsToInsert.push({
          employee_id: emp.id,
          username: username,
          password: emp.employee_number
        });
      } catch (err) {
        console.error(`Error checking username for employee ${emp.id}:`, err);
        skippedCount++;
      }
    }
    
    console.log(`Inserting ${credentialsToInsert.length} credentials (skipped ${skippedCount} duplicates)`);
    
    // Only proceed if we have credentials to insert
    if (credentialsToInsert.length === 0) {
      return { 
        success: true, 
        message: 'No new unique credentials needed to be created',
        count: 0 
      };
    }
    
    // Insert credentials one by one to avoid batch errors
    let successCount = 0;
    let errorCount = 0;
    
    for (const cred of credentialsToInsert) {
      try {
        // Check one final time if the username exists (handles race conditions)
        const { data: finalCheck, error: finalCheckError } = await supabase
          .from('user_credentials')
          .select('id')
          .ilike('username', cred.username)
          .maybeSingle();
          
        if (finalCheckError) {
          console.error(`Error performing final check for username ${cred.username}:`, finalCheckError);
          errorCount++;
          continue;
        }
        
        if (finalCheck) {
          console.warn(`Username ${cred.username} was taken between checks. Skipping.`);
          errorCount++;
          continue;
        }
        
        // Insert the credential
        const { error } = await supabase
          .from('user_credentials')
          .insert([cred]);
          
        if (error) {
          console.error(`Error inserting credential for employee ${cred.employee_id}:`, error);
          errorCount++;
        } else {
          successCount++;
        }
      } catch (err) {
        console.error(`Exception inserting credential for employee ${cred.employee_id}:`, err);
        errorCount++;
      }
    }
    
    return { 
      success: true, 
      message: `Successfully created credentials for ${successCount} employees (${errorCount} failed)`,
      count: successCount
    };
  } catch (error) {
    console.error('Error initializing user credentials:', error);
    return { 
      success: false, 
      message: error instanceof Error ? error.message : 'An unknown error occurred',
      count: 0
    };
  }
};

// Run all migrations needed for the system
export const runAllMigrations = async () => {
  try {
    // Add a connection check before running migrations
    const { connected, error } = await checkSupabaseConnection();
    
    if (!connected) {
      console.error('Cannot run migrations: Supabase connection failed:', error);
      return {
        success: false,
        messages: [`Supabase connection failed: ${error}`],
        counts: {}
      };
    }
    
    // Initialize user credentials for all existing employees
    const credentialsResult = await initializeUserCredentials();
    
    // Return combined results
    return {
      success: credentialsResult.success,
      messages: [credentialsResult.message],
      counts: {
        credentials: credentialsResult.count
      }
    };
  } catch (error) {
    console.error('Error running migrations:', error);
    return { 
      success: false, 
      messages: [error instanceof Error ? error.message : 'An unknown error occurred'],
      counts: {}
    };
  }
};

// Helper function to check Supabase connection
const checkSupabaseConnection = async () => {
  try {
    // Try a simple query to check connection
    const { error } = await supabase.from('employees').select('count', { count: 'exact', head: true });
    return { connected: !error, error: error?.message };
  } catch (err) {
    console.error('Supabase connection check failed:', err);
    return { connected: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
};