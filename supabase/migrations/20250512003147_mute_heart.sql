/*
  # Restore user credentials

  1. New Functions
     - `generate_unique_username`: Creates unique usernames from employee names
  
  2. Operations
     - Restores user credentials for all employees by checking which employees don't have credentials
     - Generates usernames based on employee names and numbers
     - Creates credentials with employee number as default password
     
  3. Security
     - No changes to security policies
*/

-- Function to generate a unique username from an employee name
CREATE OR REPLACE FUNCTION generate_unique_username(employee_name text, employee_number text)
RETURNS text AS $$
DECLARE
  base_username text;
  sanitized_name text;
  candidate_username text;
  counter integer := 1;
  username_exists boolean;
BEGIN
  -- Sanitize name (remove special characters and spaces)
  sanitized_name := regexp_replace(lower(employee_name), '[^a-z0-9]', '', 'g');
  
  -- Create base username combining sanitized name and employee number
  base_username := sanitized_name || '_' || employee_number;
  
  -- Start with base username
  candidate_username := base_username;
  
  -- Check if username exists
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM user_credentials 
      WHERE lower(username) = lower(candidate_username)
    ) INTO username_exists;
    
    EXIT WHEN NOT username_exists;
    
    -- Append counter to create a unique username
    candidate_username := base_username || '_' || counter;
    counter := counter + 1;
    
    -- Safety check to prevent infinite loop
    IF counter > 100 THEN
      RAISE NOTICE 'Could not generate unique username after 100 attempts';
      RETURN base_username || '_' || now()::text; -- Fallback with timestamp
    END IF;
  END LOOP;
  
  RETURN candidate_username;
END;
$$ LANGUAGE plpgsql;

-- Restore user credentials for all employees
DO $$
DECLARE
  emp RECORD;
  username text;
  total_restored integer := 0;
  already_exists integer := 0;
BEGIN
  RAISE NOTICE 'Starting user credentials restoration...';
  
  -- Loop through all employees
  FOR emp IN 
    SELECT id, name, employee_number FROM employees
  LOOP
    -- Check if employee already has credentials
    IF NOT EXISTS (
      SELECT 1 FROM user_credentials WHERE employee_id = emp.id
    ) THEN
      -- Generate a unique username
      username := generate_unique_username(emp.name, emp.employee_number);
      
      -- Insert new credentials
      INSERT INTO user_credentials (
        employee_id, 
        username, 
        password
      ) VALUES (
        emp.id, 
        username, 
        emp.employee_number
      );
      
      total_restored := total_restored + 1;
    ELSE
      already_exists := already_exists + 1;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'User credentials restoration complete: % credentials restored, % already existed', 
    total_restored, already_exists;
END $$;