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
  initialDelay = 500,
  maxDelay = 5000
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
    
    // Add a small delay to ensure the file record is committed
    await delay(500);  // Increased delay to ensure record is committed

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
      });

      const employeeId = employeeData.id;
      
      // Add a small delay to ensure the employee record is committed
      await delay(300);  // Increased delay for record commitment

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
        const batchSize = 50;  // Reduced batch size
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
          });
          
          // Add a small delay between batches
          if (i + batchSize < dailyRecordsToInsert.length) {
            await delay(200);
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
    const { data: fileExists, error: fileError } = await supabase
      .from('processed_excel_files')
      .select('id')
      .eq('id', fileId)
      .maybeSingle();
      
    if (fileError) throw fileError;
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

      if (daysError) throw daysError;

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
    
    // Check if the file exists and create it if it doesn't
    const fileExists = await retry(async () => {
      const { data, error } = await supabase
        .from('processed_excel_files')
        .select('id')
        .eq('id', fileId)
        .maybeSingle();
        
      if (error) {
        console.error('Error verifying file existence:', error);
        throw error;
      }
      
      return data !== null;
    });
    
    // If the file doesn't exist, create a new one
    if (!fileExists) {
      console.log('File not found, creating a new one');
      
      const newFileData = await retry(async () => {
        const { data, error } = await supabase
          .from('processed_excel_files')
          .insert([{
            file_name: fileName,
            total_employees: employeeRecords.length,
            total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0),
            is_active: true
          }])
          .select()
          .single();
          
        if (error) {
          console.error('Error creating new file record:', error);
          throw error;
        }
        
        if (!data || !data.id) {
          throw new Error('New file record created but no ID was returned');
        }
        
        return data;
      });
      
      // Use the new file ID for subsequent operations
      actualFileId = newFileData.id;
      console.log('Created new file with ID:', actualFileId);
      
      // Add a delay to ensure the file record is committed
      await delay(1000);  // Increased delay for better reliability
    }
    
    // Process each employee
    for (const employee of employeeRecords) {
      // Check if employee exists for this file
      const employeeExists = await retry(async () => {
        const { data, error } = await supabase
          .from('processed_employee_data')
          .select('id')
          .eq('file_id', actualFileId)
          .eq('employee_number', employee.employeeNumber)
          .maybeSingle();
          
        if (error) {
          console.error('Error checking if employee exists:', error);
          throw error;
        }
        
        return { exists: data !== null, id: data?.id };
      });
      
      let employeeId;
      
      if (employeeExists.exists) {
        // Update existing employee
        employeeId = employeeExists.id;
        
        await retry(async () => {
          const { error } = await supabase
            .from('processed_employee_data')
            .update({
              name: employee.name,
              department: employee.department || '',
              total_days: employee.days.length
            })
            .eq('id', employeeId);
            
          if (error) {
            console.error('Error updating employee record:', error);
            throw error;
          }
        });
      } else {
        // Insert new employee
        const employeeData = await retry(async () => {
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
            console.error('Error inserting employee record:', error);
            throw error;
          }
          
          if (!data) {
            throw new Error('Employee record inserted but no ID returned');
          }
          
          return data;
        });
        
        employeeId = employeeData.id;
      }
      
      // Add a delay to ensure the employee record is committed
      await delay(500);
      
      // Delete existing daily records for this employee
      await retry(async () => {
        const { error } = await supabase
          .from('processed_daily_records')
          .delete()
          .eq('employee_id', employeeId);
          
        if (error) {
          console.error('Error deleting daily records:', error);
          throw error;
        }
      });
      
      // Add a small delay to ensure deletion is processed
      await delay(300);
      
      // Insert updated daily records
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
        // Insert in smaller batches with retries
        const batchSize = 25;  // Smaller batch size for better reliability
        for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
          const batch = dailyRecordsToInsert.slice(i, i + batchSize);
          
          await retry(async () => {
            const { error } = await supabase
              .from('processed_daily_records')
              .insert(batch);

            if (error) {
              console.error('Error inserting daily records batch:', error);
              throw error;
            }
          });
          
          // Add a small delay between batches
          if (i + batchSize < dailyRecordsToInsert.length) {
            await delay(200);
          }
        }
      }
    }

    // Update file record with new totals
    await retry(async () => {
      const { error } = await supabase
        .from('processed_excel_files')
        .update({
          total_employees: employeeRecords.length,
          total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0)
        })
        .eq('id', actualFileId);

      if (error) {
        console.error('Error updating file record:', error);
        throw error;
      }
    });

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
      // First, ensure we delete all processed_daily_records associated with employees from this file
      const { data: employeesData, error: employeesError } = await supabase
        .from('processed_employee_data')
        .select('id')
        .eq('file_id', fileId);
        
      if (employeesError) {
        console.error('Error fetching employees for deletion:', employeesError);
      } else if (employeesData && employeesData.length > 0) {
        // Get all employee IDs
        const employeeIds = employeesData.map(emp => emp.id);
        
        // Delete all daily records for these employees
        for (const empId of employeeIds) {
          const { error: deleteRecordsError } = await supabase
            .from('processed_daily_records')
            .delete()
            .eq('employee_id', empId);
            
          if (deleteRecordsError) {
            console.error(`Error deleting daily records for employee ${empId}:`, deleteRecordsError);
          }
          
          // Add a small delay between deletes
          await delay(100);
        }
        
        // Now delete the employee records
        const { error: deleteEmployeesError } = await supabase
          .from('processed_employee_data')
          .delete()
          .eq('file_id', fileId);
          
        if (deleteEmployeesError) {
          console.error('Error deleting employee records:', deleteEmployeesError);
        }
        
        // Add a delay before deleting the file
        await delay(300);
      }
      
      // Finally, delete the file record
      const { error } = await supabase
        .from('processed_excel_files')
        .delete()
        .eq('id', fileId);

      if (error) {
        console.error('Error deleting file record:', error);
        return false;
      }
    } else {
      // For bulk deletion, manually delete in the correct order to respect foreign key constraints
      
      // 1. First delete all processed_daily_records
      const { error: deleteRecordsError } = await supabase
        .from('processed_daily_records')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to delete all
        
      if (deleteRecordsError) {
        console.error('Error deleting all daily records:', deleteRecordsError);
      }
      
      // Add a delay between operations
      await delay(500);
      
      // 2. Then delete all processed_employee_data
      const { error: deleteEmployeesError } = await supabase
        .from('processed_employee_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to delete all
        
      if (deleteEmployeesError) {
        console.error('Error deleting all employee records:', deleteEmployeesError);
      }
      
      // Add a delay between operations
      await delay(500);
      
      // 3. Finally delete all files
      const { error } = await supabase
        .from('processed_excel_files')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to delete all

      if (error) {
        console.error('Error deleting all file records:', error);
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
    const { data: fileExists, error: fileError } = await supabase
      .from('processed_excel_files')
      .select('id')
      .eq('id', fileId)
      .maybeSingle();
      
    if (fileError) throw fileError;
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