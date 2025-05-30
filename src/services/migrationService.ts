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
    let successCount = 0;
    let errorCount = 0;
    
    for (const emp of employeesNeedingCredentials) {
      try {
        // Generate a sanitized base username - remove spaces and special characters
        const sanitizedName = emp.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
          .trim();
        
        // Start with a base username that includes the employee number for uniqueness
        let baseUsername = `${sanitizedName}_${emp.employee_number}`.toLowerCase();
        let username = baseUsername;
        let counter = 1;
        let maxAttempts = 10; // Limit retry attempts
        let inserted = false;
        
        while (!inserted && counter <= maxAttempts) {
          try {
            // If this is not the first attempt, modify the username
            if (counter > 1) {
              username = `${baseUsername}_${counter}`;
            }
            
            // Check if username exists in our local set
            if (existingUsernameSet.has(username.toLowerCase())) {
              counter++;
              continue;
            }
            
            // Double-check with database to ensure uniqueness
            const { data: usernameCheck, error: checkError } = await supabase
              .from('user_credentials')
              .select('id')
              .ilike('username', username)
              .maybeSingle();
              
            if (checkError) {
              console.error(`Error checking username uniqueness for ${username}:`, checkError);
              throw checkError;
            }
            
            if (usernameCheck) {
              counter++;
              continue;
            }
            
            // Try to insert the credential
            const { error: insertError } = await supabase
              .from('user_credentials')
              .insert([{
                employee_id: emp.id,
                username: username,
                password: emp.employee_number
              }]);
              
            if (insertError) {
              // If it's a duplicate key error, try a different username
              if (insertError.code === '23505' && insertError.message.includes('user_credentials_username_key')) {
                console.warn(`Username ${username} collision detected. Trying a different username.`);
                counter++;
                continue;
              }
              
              // For other errors, throw to be caught by outer try/catch
              throw insertError;
            }
            
            // If we get here, insertion was successful
            console.log(`Created credential for employee ${emp.id} with username ${username}`);
            existingUsernameSet.add(username.toLowerCase());
            successCount++;
            inserted = true;
          } catch (innerError) {
            if (counter >= maxAttempts) {
              throw innerError; // Throw to outer catch after max attempts
            }
            counter++;
          }
        }
        
        if (!inserted) {
          throw new Error(`Failed to create unique username for employee ${emp.id} after ${maxAttempts} attempts`);
        }
      } catch (err) {
        console.error(`Error creating credential for employee ${emp.id}:`, err);
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
    
    // Prevent multiple clicks
    if (isMigrating) {
      return;
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
export const checkSupabaseConnection = async () => {
  try {
    // Try a simple query to check connection
    const { error } = await supabase.from('employees').select('count', { count: 'exact', head: true });
    return { connected: !error, error: error?.message };
  } catch (err) {
    console.error('Supabase connection check failed:', err);
    return { connected: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
};

// Global variable to track migration status
let isMigrating = false;

// Update the migration status
export const setMigrationStatus = (status: boolean) => {
  isMigrating = status;
};

// Get the current migration status
export const getMigrationStatus = () => {
  return isMigrating;
};

// Function to create or update user credentials for a new employee
export const createUserCredentialsForNewEmployee = async (
  employeeId: string, 
  employeeName: string,
  employeeNumber: string
): Promise<boolean> => {
  try {
    // Check if credentials already exist
    const { data: existingCreds, error: checkError } = await supabase
      .from('user_credentials')
      .select('id')
      .eq('employee_id', employeeId)
      .maybeSingle();
      
    if (checkError) throw checkError;
    
    // If credentials already exist, no need to create new ones
    if (existingCreds) {
      return true;
    }
    
    // Generate username from employee name
    // Sanitize the name to create a valid username
    const sanitizedName = employeeName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') // Remove all non-alphanumeric characters
      .trim();
      
    let baseUsername = `${sanitizedName}_${employeeNumber}`;
    let username = baseUsername;
    let counter = 1;
    let maxAttempts = 10;
    let inserted = false;
    
    while (!inserted && counter <= maxAttempts) {
      try {
        // If this is not the first attempt, modify the username
        if (counter > 1) {
          username = `${baseUsername}${counter}`;
        }
        
        // Check if username already exists
        const { data: usernameCheck, error: usernameError } = await supabase
          .from('user_credentials')
          .select('id')
          .ilike('username', username)
          .maybeSingle();
          
        if (usernameError) throw usernameError;
        
        if (usernameCheck) {
          counter++;
          continue;
        }
        
        // Try to insert credentials
        const { error: insertError } = await supabase
          .from('user_credentials')
          .insert([{
            employee_id: employeeId,
            username: username,
            password: employeeNumber // Use employee number as default password
          }]);
          
        if (insertError) {
          // If it's a duplicate key error, try a different username
          if (insertError.code === '23505' && insertError.message.includes('user_credentials_username_key')) {
            console.warn(`Username ${username} collision detected. Trying a different username.`);
            counter++;
            continue;
          }
          
          // For other errors, throw to be caught by outer try/catch
          throw insertError;
        }
        
        console.log(`Successfully created credentials for new employee ${employeeName} (${employeeNumber}) with username: ${username}`);
        inserted = true;
        return true;
      } catch (innerError) {
        if (counter >= maxAttempts) {
          throw innerError; // Throw to outer catch after max attempts
        }
        counter++;
      }
    }
    
    if (!inserted) {
      throw new Error(`Failed to create unique username for employee ${employeeId} after ${maxAttempts} attempts`);
    }
    
    return true;
  } catch (error) {
    console.error('Error creating user credentials for new employee:', error);
    return false;
  }
};