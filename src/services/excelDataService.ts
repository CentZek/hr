import { supabase } from '../lib/supabase';
import { EmployeeRecord, DailyRecord } from '../types';

/**
 * Service for handling processed Excel data storage in Supabase
 */

// Helper function to create a delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry function with exponential backoff
const retry = async <T>(
  fn: () => Promise<T>,
  retries = 3,
  initialDelay = 1000,
  maxDelay = 8000
): Promise<T> => {
  let attempts = 0;
  let currentDelay = initialDelay;

  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempts++;
      
      // Check if it's a foreign key constraint error
      const isFKError = error.message && (
        error.message.includes('violates foreign key constraint') || 
        error.message.includes('Key is not present in table')
      );
      
      // If we've exhausted retries or it's not a foreign key error, throw
      if (attempts >= retries || !isFKError) {
        throw error;
      }
      
      console.log(`Retry attempt ${attempts} after ${currentDelay}ms delay (foreign key constraint error)`);
      await delay(currentDelay);
      
      // Exponential backoff with jitter
      currentDelay = Math.min(currentDelay * 2, maxDelay) * (0.75 + Math.random() * 0.5);
    }
  }
};

// Helper to check if a file exists
const checkFileExists = async (fileId: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('processed_excel_files')
      .select('id')
      .eq('id', fileId)
      .maybeSingle();
      
    if (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
    
    return data !== null;
  } catch (error) {
    console.error('Exception checking file existence:', error);
    return false;
  }
};

// Save a new processed Excel file with its data
export const saveProcessedExcelFile = async (
  fileName: string,
  employeeRecords: EmployeeRecord[]
): Promise<string | null> => {
  try {
    // Step 1: Create a new file record
    const { data: fileData, error: fileError } = await supabase
      .from('processed_excel_files')
      .insert([
        {
          file_name: fileName,
          total_employees: employeeRecords.length,
          total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0),
          is_active: true
        }
      ])
      .select()
      .single();

    if (fileError) throw fileError;
    if (!fileData) throw new Error('Failed to create file record');

    const fileId = fileData.id;
    
    // Add a delay to ensure the file record is committed
    await delay(2000);  // Increased to 2000ms to ensure record is committed

    // Verify the file was actually created
    const fileExists = await checkFileExists(fileId);
    if (!fileExists) {
      throw new Error(`File record created but not found in subsequent query. ID: ${fileId}`);
    }

    // Step 2: Save employee data
    for (const employee of employeeRecords) {
      // Create employee record with retry mechanism
      const employeeData = await retry(async () => {
        const { data, error } = await supabase
          .from('processed_employee_data')
          .insert([
            {
              file_id: fileId,
              employee_number: employee.employeeNumber,
              name: employee.name,
              department: employee.department || '',
              total_days: employee.days.length
            }
          ])
          .select()
          .single();

        if (error) {
          console.error('Error inserting employee data:', error);
          throw error;
        }
        
        if (!data) {
          throw new Error('No employee data returned after insert');
        }
        
        return data;
      }, 5, 1000);  // Increased initial delay to 1000ms, with 5 retries

      const employeeId = employeeData.id;
      
      // Add a delay to ensure the employee record is committed
      await delay(1000);  // Increased delay for record commitment

      // Step 3: Save daily records for this employee
      const dailyRecordsToInsert = employee.days.map(day => ({
        employee_id: employeeId, // Use the ID from the newly created employee record
        date: day.date,
        first_check_in: day.firstCheckIn?.toISOString() || null,
        last_check_out: day.lastCheckOut?.toISOString() || null,
        hours_worked: day.hoursWorked,
        approved: day.approved,
        shift_type: day.shiftType,
        notes: day.notes || '',
        missing_check_in: day.missingCheckIn,
        missing_check_out: day.missingCheckOut,
        is_late: day.isLate,
        early_leave: day.earlyLeave,
        excessive_overtime: day.excessiveOvertime,
        penalty_minutes: day.penaltyMinutes,
        corrected_records: day.correctedRecords || false,
        display_check_in: day.displayCheckIn || null,
        display_check_out: day.displayCheckOut || null,
        working_week_start: day.working_week_start || null,
        all_time_records: day.allTimeRecords ? JSON.stringify(day.allTimeRecords) : null
      }));

      if (dailyRecordsToInsert.length > 0) {
        // Insert in batches to avoid payload size limitations
        const batchSize = 10;  // Reduced batch size
        for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
          const batch = dailyRecordsToInsert.slice(i, i + batchSize);
          
          // Use retry mechanism for batch inserts
          await retry(async () => {
            const { error } = await supabase
              .from('processed_daily_records')
              .insert(batch);

            if (error) {
              console.error('Error inserting daily records batch:', error);
              throw error;
            }
          }, 5, 1000);  // Increased initial delay to 1000ms, with 5 retries
          
          // Add a delay between batches
          if (i + batchSize < dailyRecordsToInsert.length) {
            await delay(500);
          }
        }
      }
    }

    // Return the file ID for reference
    return fileId;
  } catch (error) {
    console.error('Error saving processed Excel file:', error);
    return null;
  }
};

// Fetch the most recent active processed file
export const getActiveProcessedFile = async (): Promise<{
  fileId: string;
  fileName: string;
  totalEmployees: number;
  totalDays: number;
} | null> => {
  try {
    const { data, error } = await supabase
      .from('processed_excel_files')
      .select('id, file_name, total_employees, total_days')
      .eq('is_active', true)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return {
      fileId: data.id,
      fileName: data.file_name,
      totalEmployees: data.total_employees,
      totalDays: data.total_days
    };
  } catch (error) {
    console.error('Error fetching active processed file:', error);
    return null;
  }
};

// Get all employees for a specific file
export const getProcessedEmployees = async (fileId: string): Promise<EmployeeRecord[]> => {
  try {
    // Verify the file exists first
    const fileExists = await checkFileExists(fileId);
    if (!fileExists) {
      console.error('File does not exist:', fileId);
      return [];
    }

    // Step 1: Fetch employee data
    const { data: employeesData, error: employeesError } = await supabase
      .from('processed_employee_data')
      .select('id, employee_number, name, department, total_days')
      .eq('file_id', fileId);

    if (employeesError) throw employeesError;
    if (!employeesData || employeesData.length === 0) return [];

    // Step 2: For each employee, fetch their daily records
    const employeeRecords: EmployeeRecord[] = [];

    for (const emp of employeesData) {
      const { data: daysData, error: daysError } = await supabase
        .from('processed_daily_records')
        .select('*')
        .eq('employee_id', emp.id);

      if (daysError) {
        console.error(`Error fetching daily records for employee ${emp.id}:`, daysError);
        continue;
      }

      // Convert database records to DailyRecord format
      const days: DailyRecord[] = (daysData || []).map(day => ({
        date: day.date,
        firstCheckIn: day.first_check_in ? new Date(day.first_check_in) : null,
        lastCheckOut: day.last_check_out ? new Date(day.last_check_out) : null,
        hoursWorked: day.hours_worked,
        approved: day.approved,
        shiftType: day.shift_type as any, // Cast to the expected type
        notes: day.notes,
        missingCheckIn: day.missing_check_in,
        missingCheckOut: day.missing_check_out,
        isLate: day.is_late,
        earlyLeave: day.early_leave,
        excessiveOvertime: day.excessive_overtime,
        penaltyMinutes: day.penalty_minutes,
        correctedRecords: day.corrected_records,
        displayCheckIn: day.display_check_in,
        displayCheckOut: day.display_check_out,
        working_week_start: day.working_week_start,
        allTimeRecords: day.all_time_records ? JSON.parse(day.all_time_records) : [],
        hasMultipleRecords: (day.all_time_records && JSON.parse(day.all_time_records).length > 1) || false
      }));

      employeeRecords.push({
        employeeNumber: emp.employee_number,
        name: emp.name,
        department: emp.department,
        days,
        totalDays: emp.total_days,
        expanded: false
      });
    }

    return employeeRecords;
  } catch (error) {
    console.error('Error fetching processed employees:', error);
    return [];
  }
};

// Update employee data (usually after modifications)
export const updateProcessedEmployeeData = async (
  fileId: string,
  employeeRecords: EmployeeRecord[],
  fileName: string = 'Untitled File'
): Promise<{ success: boolean; fileId: string }> => {
  try {
    let actualFileId = fileId;
    
    // First check if the file exists
    const fileExists = await checkFileExists(fileId);
    
    // If file doesn't exist, create a new one
    if (!fileExists) {
      console.log('File not found, creating a new one');
      
      try {
        const { data: newFile, error: createError } = await supabase
          .from('processed_excel_files')
          .insert({
            file_name: fileName,
            total_employees: employeeRecords.length,
            total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0),
            is_active: true
          })
          .select()
          .single();
          
        if (createError) {
          throw createError;
        }
        
        if (!newFile || !newFile.id) {
          throw new Error('File created but no ID returned');
        }
        
        // Use new file ID
        actualFileId = newFile.id;
        console.log('Created new file with ID:', actualFileId);
      } catch (err) {
        console.error('Failed to create new file:', err);
        // If we can't create a new file, return failure
        return { success: false, fileId: actualFileId };
      }
      
      // Add increased delay after creating the file
      await delay(2500);
      
      // Verify file was created
      const newFileExists = await checkFileExists(actualFileId);
      if (!newFileExists) {
        console.error('New file record was not created successfully');
        return { success: false, fileId: actualFileId };
      }
    }
    
    // For each employee, ensure their record exists before updating daily records
    for (const employee of employeeRecords) {
      try {
        // Look for existing employee
        const { data: existingEmployee, error: lookupError } = await supabase
          .from('processed_employee_data')
          .select('id')
          .eq('file_id', actualFileId)
          .eq('employee_number', employee.employeeNumber)
          .maybeSingle();
          
        if (lookupError) {
          console.error('Error looking up employee:', lookupError);
          continue;
        }
        
        let employeeId: string;
        
        if (existingEmployee) {
          // Use existing employee ID
          employeeId = existingEmployee.id;
          
          // Update employee details
          const { error: updateError } = await supabase
            .from('processed_employee_data')
            .update({
              name: employee.name,
              department: employee.department || '',
              total_days: employee.days.length
            })
            .eq('id', employeeId);
            
          if (updateError) {
            console.error('Error updating employee:', updateError);
            continue;
          }
        } else {
          // Create new employee record
          let newEmployee;
          try {
            // Verify file still exists before creating employee
            const fileStillExists = await checkFileExists(actualFileId);
            if (!fileStillExists) {
              console.error(`File ${actualFileId} no longer exists, cannot create employee`);
              continue;
            }
            
            // Use retry for employee creation
            newEmployee = await retry(async () => {
              const { data, error } = await supabase
                .from('processed_employee_data')
                .insert({
                  file_id: actualFileId,
                  employee_number: employee.employeeNumber,
                  name: employee.name,
                  department: employee.department || '',
                  total_days: employee.days.length
                })
                .select('id')
                .single();
                
              if (error) {
                console.error('Error creating employee:', error);
                throw error;
              }
              
              return data;
            }, 5, 1000); // Increased initial delay to 1000ms, with 5 retries
          } catch (err) {
            console.error('Exception creating employee:', err);
            continue;
          }
          
          if (!newEmployee || !newEmployee.id) {
            console.error('Failed to create employee record');
            continue;
          }
          
          employeeId = newEmployee.id;
        }
        
        // Add a longer delay before manipulating daily records
        await delay(1000);
        
        // Verify employee record still exists
        const { data: empCheck, error: empCheckError } = await supabase
          .from('processed_employee_data')
          .select('id')
          .eq('id', employeeId)
          .maybeSingle();
          
        if (empCheckError || !empCheck) {
          console.error(`Employee ${employeeId} no longer exists, skipping daily records`);
          continue;
        }
        
        // Delete existing daily records for this employee
        try {
          const { error: deleteError } = await supabase
            .from('processed_daily_records')
            .delete()
            .eq('employee_id', employeeId);
            
          if (deleteError) {
            console.error('Error deleting daily records:', deleteError);
            // Continue anyway to attempt insertion
          }
          
          // Wait longer for delete to complete
          await delay(1000);
        } catch (err) {
          console.error('Exception deleting daily records:', err);
          // Continue to try insertions
        }
        
        // Insert new daily records in small batches
        const dailyRecordsToInsert = employee.days.map(day => ({
          employee_id: employeeId,
          date: day.date,
          first_check_in: day.firstCheckIn?.toISOString() || null,
          last_check_out: day.lastCheckOut?.toISOString() || null,
          hours_worked: day.hoursWorked,
          approved: day.approved,
          shift_type: day.shiftType,
          notes: day.notes || '',
          missing_check_in: day.missingCheckIn,
          missing_check_out: day.missingCheckOut,
          is_late: day.isLate,
          early_leave: day.earlyLeave,
          excessive_overtime: day.excessiveOvertime,
          penalty_minutes: day.penaltyMinutes,
          corrected_records: day.correctedRecords || false,
          display_check_in: day.displayCheckIn || null,
          display_check_out: day.displayCheckOut || null,
          working_week_start: day.working_week_start || null,
          all_time_records: day.allTimeRecords ? JSON.stringify(day.allTimeRecords) : null
        }));
        
        if (dailyRecordsToInsert.length > 0) {
          const batchSize = 5; // Smaller batch size for more reliability
          for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
            const batch = dailyRecordsToInsert.slice(i, i + batchSize);
            
            try {
              // Final check before insert to ensure employee exists
              const { data: empFinalCheck } = await supabase
                .from('processed_employee_data')
                .select('id')
                .eq('id', employeeId)
                .maybeSingle();
                
              if (!empFinalCheck) {
                console.error(`Employee ${employeeId} no longer exists before batch insert`);
                break;
              }
              
              // Use retry for batch inserts
              await retry(async () => {
                const { error: insertError } = await supabase
                  .from('processed_daily_records')
                  .insert(batch);
                  
                if (insertError) {
                  console.error('Error inserting daily records batch:', insertError);
                  throw insertError;
                }
              }, 5, 1000); // Increased initial delay to 1000ms, with 5 retries
              
              // Longer delay between batches
              await delay(500);
            } catch (err) {
              console.error('Exception inserting daily records batch:', err);
              // Continue with next batch
            }
          }
        }
      } catch (employeeError) {
        console.error('Error processing employee:', employeeError);
        // Continue with next employee
      }
    }
    
    // Update file record with new totals
    try {
      const { error: updateError } = await supabase
        .from('processed_excel_files')
        .update({
          total_employees: employeeRecords.length,
          total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0)
        })
        .eq('id', actualFileId);
        
      if (updateError) {
        console.error('Error updating file record:', updateError);
        // Continue anyway as the main data is already saved
      }
    } catch (err) {
      console.error('Exception updating file record:', err);
      // Continue as the main data is already saved
    }

    return { success: true, fileId: actualFileId };
  } catch (error) {
    console.error('Error updating processed employee data:', error);
    return { success: false, fileId };
  }
};

// Delete processed Excel data
export const deleteProcessedExcelData = async (fileId?: string): Promise<boolean> => {
  try {
    if (fileId) {
      // Delete just the file - cascade should handle the rest
      try {
        const { error } = await supabase
          .from('processed_excel_files')
          .delete()
          .eq('id', fileId);

        if (error) {
          console.error('Error deleting file record:', error);
          return false;
        }
      } catch (err) {
        console.error('Exception deleting file:', err);
        return false;
      }
    } else {
      // Delete everything in reverse order of dependency
      try {
        console.log('Deleting all processed daily records...');
        await supabase
          .from('processed_daily_records')
          .delete()
          .neq('employee_id', '00000000-0000-0000-0000-000000000000');
          
        // Wait for deletion to complete
        await delay(2000);
        
        console.log('Deleting all processed employee data...');
        await supabase
          .from('processed_employee_data')
          .delete()
          .neq('file_id', '00000000-0000-0000-0000-000000000000');
          
        // Wait for deletion to complete
        await delay(2000);
        
        console.log('Deleting all processed excel files...');
        const { error } = await supabase
          .from('processed_excel_files')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');

        if (error) {
          console.error('Error in bulk deletion of files:', error);
          return false;
        }
      } catch (err) {
        console.error('Exception during bulk deletion:', err);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Error deleting processed Excel data:', error);
    return false;
  }
};

// Set a specific file as active (and optionally deactivate others)
export const setActiveProcessedFile = async (
  fileId: string,
  deactivateOthers: boolean = true
): Promise<boolean> => {
  try {
    // Verify the file exists first
    const fileExists = await checkFileExists(fileId);
    if (!fileExists) {
      console.error('File does not exist:', fileId);
      return false;
    }
    
    // Step 1: Set the specified file as active
    const { error: updateError } = await supabase
      .from('processed_excel_files')
      .update({ is_active: true })
      .eq('id', fileId);

    if (updateError) throw updateError;

    // Step 2: Deactivate other files if requested
    if (deactivateOthers) {
      const { error: deactivateError } = await supabase
        .from('processed_excel_files')
        .update({ is_active: false })
        .neq('id', fileId);

      if (deactivateError) throw deactivateError;
    }

    return true;
  } catch (error) {
    console.error('Error setting active processed file:', error);
    return false;
  }
};

// Get all processed Excel files
export const getAllProcessedFiles = async (): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('processed_excel_files')
      .select('*')
      .order('uploaded_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching processed files:', error);
    return [];
  }
};