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

// Cache for file existence to avoid redundant queries
const fileExistsCache = new Map<string, boolean>();

// Helper to check if a file exists with retries - optimized version
const checkFileExistsWithRetry = async (
  fileId: string, 
  maxRetries = 5,
  initialDelay = 500
): Promise<boolean> => {
  // Check cache first
  if (fileExistsCache.has(fileId)) {
    return fileExistsCache.get(fileId)!;
  }
  
  let attempts = 0;
  let currentDelay = initialDelay;
  
  while (attempts < maxRetries) {
    const exists = await checkFileExists(fileId);
    if (exists) {
      // Cache the result
      fileExistsCache.set(fileId, true);
      return true;
    }
    
    attempts++;
    if (attempts >= maxRetries) {
      console.log(`File ${fileId} not found after ${maxRetries} attempts`);
      fileExistsCache.set(fileId, false);
      return false;
    }
    
    // Only log on certain attempts to reduce console noise
    if (attempts === 1 || attempts % 3 === 0) {
      console.log(`File verification attempt ${attempts} - waiting ${currentDelay}ms before retry`);
    }
    
    await delay(currentDelay);
    
    // Increase delay with each retry (exponential backoff)
    currentDelay = Math.min(currentDelay * 1.5, 3000);
  }
  
  fileExistsCache.set(fileId, false);
  return false;
};

// Cache for employee existence to avoid redundant queries
const employeeExistsCache = new Map<string, boolean>();

// Helper to check if an employee exists with retries - optimized version
const checkEmployeeExistsWithRetry = async (
  employeeId: string,
  maxRetries = 5,
  initialDelay = 500
): Promise<boolean> => {
  // Check cache first
  if (employeeExistsCache.has(employeeId)) {
    return employeeExistsCache.get(employeeId)!;
  }
  
  let attempts = 0;
  let currentDelay = initialDelay;
  
  while (attempts < maxRetries) {
    try {
      const { data, error } = await supabase
        .from('processed_employee_data')
        .select('id')
        .eq('id', employeeId)
        .maybeSingle();
        
      if (error) {
        console.error('Error checking employee existence:', error);
      } else if (data) {
        employeeExistsCache.set(employeeId, true);
        return true;
      }
    } catch (err) {
      console.error('Exception checking employee existence:', err);
    }
    
    attempts++;
    if (attempts >= maxRetries) {
      console.log(`Employee ${employeeId} not found after ${maxRetries} attempts`);
      employeeExistsCache.set(employeeId, false);
      return false;
    }
    
    // Only log on certain attempts to reduce console noise
    if (attempts === 1 || attempts % 3 === 0) {
      console.log(`Employee verification attempt ${attempts} - waiting ${currentDelay}ms before retry`);
    }
    
    await delay(currentDelay);
    
    // Increase delay with each retry (exponential backoff)
    currentDelay = Math.min(currentDelay * 1.5, 3000);
  }
  
  employeeExistsCache.set(employeeId, false);
  return false;
};

// Prepare batch of records with optimized structure
const prepareBatches = (records: any[], batchSize: number) => {
  const batches = [];
  for (let i = 0; i < records.length; i += batchSize) {
    batches.push(records.slice(i, i + batchSize));
  }
  return batches;
};

// Save a new processed Excel file with its data
export const saveProcessedExcelFile = async (
  fileName: string,
  employeeRecords: EmployeeRecord[]
): Promise<string | null> => {
  try {
    // Reset caches for a clean start
    fileExistsCache.clear();
    employeeExistsCache.clear();
    
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
    await delay(500);

    // Verify the file was actually created - use simpler check to improve speed
    fileExistsCache.set(fileId, true); // Assume it exists since we just created it

    // Step 2: Prepare data for batch insert
    const employeeDataBatch = employeeRecords.map(employee => ({
      file_id: fileId,
      employee_number: employee.employeeNumber,
      name: employee.name,
      department: employee.department || '',
      total_days: employee.days.length
    }));

    // Create a Map to track employee IDs by employee number
    const employeeMap = new Map<string, string>();

    // Step 3: Insert employee data in smaller batches
    const employeeBatchSize = 10; // Smaller batch size for better reliability
    const employeeBatches = prepareBatches(employeeDataBatch, employeeBatchSize);

    for (const batch of employeeBatches) {
      try {
        const { data: insertedEmployees, error } = await supabase
          .from('processed_employee_data')
          .insert(batch)
          .select('id, employee_number');

        if (error) {
          console.error('Error inserting employee batch:', error);
          // Continue to try next batch
          continue;
        }

        // Map employee numbers to their IDs
        if (insertedEmployees) {
          insertedEmployees.forEach(emp => {
            employeeMap.set(emp.employee_number, emp.id);
            // Cache employee existence
            employeeExistsCache.set(emp.id, true);
          });
        }
      } catch (err) {
        console.error('Exception inserting employee batch:', err);
        // Continue with next batch
      }
    }

    // Step 4: Insert daily records for each employee
    for (const employee of employeeRecords) {
      const employeeId = employeeMap.get(employee.employeeNumber);
      if (!employeeId) {
        console.error(`Could not find ID for employee ${employee.employeeNumber}`);
        continue;
      }
      
      // Prepare daily records for this employee
      const dailyRecordsBatch = employee.days.map(day => ({
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

      // Insert daily records in smaller batches
      const dailyBatchSize = 10;
      const dailyBatches = prepareBatches(dailyRecordsBatch, dailyBatchSize);
      
      for (const batch of dailyBatches) {
        try {
          const { error } = await supabase
            .from('processed_daily_records')
            .insert(batch);

          if (error) {
            console.error('Error inserting daily records batch:', error);
            // Try each record individually on error
            for (const record of batch) {
              try {
                await supabase
                  .from('processed_daily_records')
                  .insert([record]);
              } catch (err) {
                // Silently continue - just try to save what we can
              }
            }
          }
        } catch (error) {
          console.error('Error in daily records batch:', error);
          // Continue with next batch
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
    const fileExists = await checkFileExistsWithRetry(fileId);
    if (!fileExists) {
      console.error('File does not exist:', fileId);
      return [];
    }

    // Step 1: Fetch employee data
    const { data: employeesData, error: employeesError } = await supabase
      .from('processed_employee_data')
      .select('id, employee_number, name, department, total_days')
      .eq('file_id', fileId)
      .order('name');

    if (employeesError) throw employeesError;
    if (!employeesData || employeesData.length === 0) return [];

    // Step 2: Create a map to store employee records by ID
    const employeeRecordsMap = new Map<string, EmployeeRecord>();
    employeesData.forEach(emp => {
      employeeRecordsMap.set(emp.id, {
        employeeNumber: emp.employee_number,
        name: emp.name,
        department: emp.department || '',
        days: [],
        totalDays: emp.total_days,
        expanded: false
      });
    });

    // Step 3: Fetch daily records in batches for better performance
    const employeeIds = employeesData.map(emp => emp.id);
    const BATCH_SIZE = 25;
    
    for (let i = 0; i < employeeIds.length; i += BATCH_SIZE) {
      const batchIds = employeeIds.slice(i, i + BATCH_SIZE);
      
      const { data: batchDaysData, error: batchDaysError } = await supabase
        .from('processed_daily_records')
        .select('*')
        .in('employee_id', batchIds);
        
      if (batchDaysError) {
        console.error('Error fetching batch of daily records:', batchDaysError);
        continue;
      }
      
      // Process this batch of daily records
      batchDaysData?.forEach(day => {
        if (!employeeRecordsMap.has(day.employee_id)) return;
        
        const employeeRecord = employeeRecordsMap.get(day.employee_id)!;
        
        // Convert database record to DailyRecord format
        employeeRecord.days.push({
          date: day.date,
          firstCheckIn: day.first_check_in ? new Date(day.first_check_in) : null,
          lastCheckOut: day.last_check_out ? new Date(day.last_check_out) : null,
          hoursWorked: day.hours_worked,
          approved: day.approved,
          shiftType: day.shift_type as any, // Cast to the expected type
          notes: day.notes || '',
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
        });
      });
    }

    // Step 4: Convert the map to an array and sort by name
    return Array.from(employeeRecordsMap.values());
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
    // Reset caches for a clean start
    fileExistsCache.clear();
    employeeExistsCache.clear();
    
    let actualFileId = fileId;
    
    // First check if the file exists
    const fileExists = await checkFileExistsWithRetry(fileId);
    
    // If file doesn't exist, create a new one
    if (!fileExists) {
      console.log('File not found, creating a new one');
      
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
      fileExistsCache.set(actualFileId, true);
      console.log('Created new file with ID:', actualFileId);
    }
    
    // Process each employee's data in batches
    // Map to track existing vs new employees
    const employeeIdMap = new Map<string, string>();
    
    for (const employee of employeeRecords) {
      try {
        // Check if employee exists for this file
        const { data: existingEmployee } = await supabase
          .from('processed_employee_data')
          .select('id')
          .eq('file_id', actualFileId)
          .eq('employee_number', employee.employeeNumber)
          .maybeSingle();
          
        let employeeId: string;
        
        if (existingEmployee) {
          // Update existing employee
          employeeId = existingEmployee.id;
          employeeIdMap.set(employee.employeeNumber, employeeId);
          employeeExistsCache.set(employeeId, true);
          
          await supabase
            .from('processed_employee_data')
            .update({
              name: employee.name,
              department: employee.department || '',
              total_days: employee.days.length
            })
            .eq('id', employeeId);
        } else {
          // Create new employee
          const { data: newEmployee } = await supabase
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
            
          if (!newEmployee) {
            console.error('Failed to create employee record');
            continue;
          }
          
          employeeId = newEmployee.id;
          employeeIdMap.set(employee.employeeNumber, employeeId);
          employeeExistsCache.set(employeeId, true);
        }
        
        // Delete existing daily records for this employee
        await supabase
          .from('processed_daily_records')
          .delete()
          .eq('employee_id', employeeId);
        
        // Prepare batch of daily records
        const dailyRecords = employee.days.map(day => ({
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
        
        // Insert daily records in batches
        const batchSize = 10; // Smaller batch size for better reliability
        for (let i = 0; i < dailyRecords.length; i += batchSize) {
          const batch = dailyRecords.slice(i, i + batchSize);
          
          try {
            const { error } = await supabase
              .from('processed_daily_records')
              .insert(batch);
              
            if (error) {
              console.error('Error inserting batch of daily records:', error);
              // Try inserting one by one
              for (const record of batch) {
                await supabase
                  .from('processed_daily_records')
                  .insert([record])
                  .catch(err => console.error('Error inserting single record:', err));
              }
            }
          } catch (err) {
            console.error('Exception inserting batch of daily records:', err);
          }
        }
      } catch (err) {
        console.error(`Error processing employee ${employee.employeeNumber}:`, err);
      }
    }
    
    // Update file record with new totals
    await supabase
      .from('processed_excel_files')
      .update({
        total_employees: employeeRecords.length,
        total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0),
        updated_at: new Date().toISOString()
      })
      .eq('id', actualFileId);

    return { success: true, fileId: actualFileId };
  } catch (error) {
    console.error('Error updating processed employee data:', error);
    return { success: false, fileId };
  }
};

// Delete processed Excel data
export const deleteProcessedExcelData = async (fileId?: string): Promise<boolean> => {
  try {
    // Clear caches when deleting data
    fileExistsCache.clear();
    employeeExistsCache.clear();
    
    if (fileId) {
      // Delete just the file - cascade should handle the rest
      const { error } = await supabase
        .from('processed_excel_files')
        .delete()
        .eq('id', fileId);

      if (error) {
        console.error('Error deleting file record:', error);
        return false;
      }
    } else {
      // For better performance, delete in parallel but wait for all operations to complete
      await Promise.all([
        // Delete daily records
        supabase
          .from('processed_daily_records')
          .delete()
          .neq('employee_id', '00000000-0000-0000-0000-000000000000'),
          
        // Delete employee data
        supabase
          .from('processed_employee_data')
          .delete()
          .neq('file_id', '00000000-0000-0000-0000-000000000000')
      ]);
      
      // Finally delete files
      await supabase
        .from('processed_excel_files')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
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
    const fileExists = await checkFileExistsWithRetry(fileId);
    if (!fileExists) {
      console.error('File does not exist:', fileId);
      return false;
    }
    
    // Do the updates in parallel for better performance
    await Promise.all([
      // Set the specified file as active
      supabase
        .from('processed_excel_files')
        .update({ is_active: true })
        .eq('id', fileId),
        
      // Deactivate other files if requested
      deactivateOthers ? 
        supabase
          .from('processed_excel_files')
          .update({ is_active: false })
          .neq('id', fileId) : 
        Promise.resolve()
    ]);

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