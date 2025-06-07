import { supabase } from '../lib/supabase';
import { EmployeeRecord, DailyRecord } from '../types';
import { createUserCredentialsForNewEmployee } from './migrationService';

/**
 * Service for handling processed Excel data storage in Supabase
 */

// Helper function to create a delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Worker cache to avoid duplicate work
const processingCache = new Map<string, Promise<any>>();

// Retry function with exponential backoff - increased retries from 3 to 5
const retry = async <T>(
  fn: () => Promise<T>,
  retries = 5,
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
  // Use cache to avoid redundant checks
  const cacheKey = `file_exists_${fileId}`;
  if (processingCache.has(cacheKey)) {
    return await processingCache.get(cacheKey)!;
  }
  
  const checkPromise = (async () => {
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
      
      // Cache the result for 2 minutes
      setTimeout(() => {
        processingCache.delete(cacheKey);
      }, 120000);
      
      return data !== null;
    } catch (error) {
      console.error('Exception checking file existence:', error);
      return false;
    }
  })();
  
  processingCache.set(cacheKey, checkPromise);
  return await checkPromise;
};

// Helper to verify an employee exists
const checkEmployeeExists = async (employeeId: string): Promise<boolean> => {
  // Use cache to avoid redundant checks
  const cacheKey = `employee_exists_${employeeId}`;
  if (processingCache.has(cacheKey)) {
    return await processingCache.get(cacheKey)!;
  }
  
  const checkPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('processed_employee_data')
        .select('id')
        .eq('id', employeeId)
        .maybeSingle();
        
      if (error) {
        console.error('Error checking employee existence:', error);
        return false;
      }
      
      // Cache the result for 2 minutes
      setTimeout(() => {
        processingCache.delete(cacheKey);
      }, 120000);
      
      return data !== null;
    } catch (error) {
      console.error('Exception checking employee existence:', error);
      return false;
    }
  })();
  
  processingCache.set(cacheKey, checkPromise);
  return await checkPromise;
};

// Save a new processed Excel file with its data
export const saveProcessedExcelFile = async (
  fileName: string,
  employeeRecords: EmployeeRecord[]
): Promise<string | null> => {
  try {
    // Calculate total days once instead of repeatedly
    const totalDays = employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0);
    
    // Step 1: Create a new file record
    console.time('Create file record');
    const { data: fileData, error: fileError } = await supabase
      .from('processed_excel_files')
      .insert([
        {
          file_name: fileName,
          total_employees: employeeRecords.length,
          total_days: totalDays,
          is_active: true
        }
      ])
      .select()
      .single();
    console.timeEnd('Create file record');

    if (fileError) throw fileError;
    if (!fileData) throw new Error('Failed to create file record');

    const fileId = fileData.id;
    console.log('Created file with ID:', fileId);
    
    // Removed redundant checkFileExists call after insert

    // Step 2: Prepare employee data batch
    console.time('Process employee records');
    const employeeDataPromises = employeeRecords.map(async (employee) => {
      try {
        // Create or update the employee record in the employees table
        // This way new employees from Excel get added to the system
        const { data: empInDatabase, error: empLookupError } = await supabase
          .from('employees')
          .select('id, name')
          .eq('employee_number', employee.employeeNumber)
          .maybeSingle();
          
        let systemEmployeeId: string;
        let isNewEmployee = false;
        
        if (empLookupError) {
          console.error('Error looking up employee in database:', empLookupError);
        }
        
        if (!empInDatabase) {
          // Create new employee in the system
          const { data: newEmpInSystem, error: createEmpError } = await supabase
            .from('employees')
            .insert({
              employee_number: employee.employeeNumber,
              name: employee.name
            })
            .select('id')
            .single();
            
          if (createEmpError) {
            console.error('Error creating employee in system:', createEmpError);
          } else {
            systemEmployeeId = newEmpInSystem.id;
            isNewEmployee = true;
            
            // Create user credentials for the new employee
            await createUserCredentialsForNewEmployee(
              systemEmployeeId,
              employee.name,
              employee.employeeNumber
            );
          }
        } else {
          systemEmployeeId = empInDatabase.id;
          
          // Update employee name if it's different
          if (empInDatabase.name !== employee.name) {
            await supabase
              .from('employees')
              .update({ name: employee.name })
              .eq('id', systemEmployeeId);
          }
        }
        
        // Create employee record - Use retry to handle foreign key constraints
        const empData = await retry(async () => {
          const { data, error } = await supabase
            .from('processed_employee_data')
            .insert({
              file_id: fileId,
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
          
          if (!data) {
            throw new Error('No data returned when creating employee');
          }
          
          return data;
        });
        
        const employeeId = empData.id;
        
        // Insert daily records for this employee in small batches
        const dailyRecordsPromises = [];
        const batchSize = 5; // Small batch size for better reliability
        
        for (let i = 0; i < employee.days.length; i += batchSize) {
          const batch = employee.days.slice(i, i + batchSize);
          
          // Create a promise for each batch
          const batchPromise = (async () => {
            const dailyRecordsBatch = batch.map(day => ({
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
            
            try {
              // Use retry for daily records batch insert
              await retry(async () => {
                const { error } = await supabase
                  .from('processed_daily_records')
                  .insert(dailyRecordsBatch);
                  
                if (error) {
                  throw error;
                }
              }).catch(async (error) => {
                console.error('Error inserting daily records batch:', error);
                
                // If batch insert fails, try individual inserts
                for (const record of dailyRecordsBatch) {
                  try {
                    await retry(async () => {
                      const { error } = await supabase
                        .from('processed_daily_records')
                        .insert([record]);
                        
                      if (error) throw error;
                    });
                  } catch (err) {
                    console.error('Error inserting individual daily record:', err);
                  }
                }
              });
            } catch (err) {
              console.error('Exception inserting daily records batch:', err);
            }
          })();
          
          dailyRecordsPromises.push(batchPromise);
          
          // Limit concurrency to 3 batch operations at a time
          if (dailyRecordsPromises.length >= 3) {
            await Promise.all(dailyRecordsPromises);
            dailyRecordsPromises.length = 0;
          }
        }
        
        // Wait for any remaining batch operations
        if (dailyRecordsPromises.length > 0) {
          await Promise.all(dailyRecordsPromises);
        }
        
        return {
          id: employeeId,
          isNewEmployee,
          systemEmployeeId: systemEmployeeId || null
        };
      } catch (error) {
        console.error('Error processing employee:', error);
        return null;
      }
    });
    
    // Process employees in parallel with controlled concurrency
    const batchSize = 5; // Process 5 employees at a time
    const employeeResults: any[] = [];
    
    for (let i = 0; i < employeeDataPromises.length; i += batchSize) {
      const batch = employeeDataPromises.slice(i, i + batchSize);
      const results = await Promise.all(batch);
      employeeResults.push(...results.filter(r => r !== null));
    }
    
    // Count new employees that were added to the system
    const newEmployeesCount = employeeResults.filter(r => r.isNewEmployee).length;
    if (newEmployeesCount > 0) {
      console.log(`Added ${newEmployeesCount} new employees to the system with login credentials`);
    }
    
    console.timeEnd('Process employee records');
    console.log(`Successfully created ${employeeResults.length} employee records with their daily data`);

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
    console.time('getProcessedEmployees');
    
    // Verify the file exists first
    const fileExists = await checkFileExists(fileId);
    if (!fileExists) {
      console.error('File does not exist:', fileId);
      return [];
    }

    // Step 1: Fetch employee data
    console.time('Fetch employees');
    const { data: employeesData, error: employeesError } = await supabase
      .from('processed_employee_data')
      .select('id, employee_number, name, department, total_days')
      .eq('file_id', fileId)
      .order('name', { ascending: true });
    console.timeEnd('Fetch employees');

    if (employeesError) throw employeesError;
    if (!employeesData || employeesData.length === 0) return [];

    // Step 2: Fetch all daily records in parallel batches
    console.time('Fetch daily records');
    const employeeRecords: EmployeeRecord[] = [];
    const employeeBatches = [];
    const batchSize = 10; // Process 10 employees at a time
    
    for (let i = 0; i < employeesData.length; i += batchSize) {
      const batch = employeesData.slice(i, i + batchSize);
      employeeBatches.push(batch);
    }
    
    // Process each batch in sequence to avoid overwhelming the server
    for (const batch of employeeBatches) {
      const batchPromises = batch.map(async (emp) => {
        const { data: daysData, error: daysError } = await supabase
          .from('processed_daily_records')
          .select('*')
          .eq('employee_id', emp.id);

        if (daysError) {
          console.error(`Error fetching daily records for employee ${emp.id}:`, daysError);
          return {
            employeeNumber: emp.employee_number,
            name: emp.name,
            department: emp.department,
            days: [],
            totalDays: 0,
            expanded: false
          };
        }

        // Convert database records to DailyRecord format
        const days: DailyRecord[] = (daysData || []).map(day => {
          // Parse all_time_records and convert timestamp strings to Date objects
          let allTimeRecords = [];
          if (day.all_time_records) {
            try {
              const parsedRecords = JSON.parse(day.all_time_records);
              if (Array.isArray(parsedRecords)) {
                allTimeRecords = parsedRecords.map(record => ({
                  ...record,
                  timestamp: record.timestamp ? new Date(record.timestamp) : null
                }));
              }
            } catch (error) {
              console.error('Error parsing all_time_records:', error);
              allTimeRecords = [];
            }
          }

          return {
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
            allTimeRecords: allTimeRecords,
            hasMultipleRecords: allTimeRecords.length > 1
          };
        });

        return {
          employeeNumber: emp.employee_number,
          name: emp.name,
          department: emp.department,
          days,
          totalDays: emp.total_days,
          expanded: false
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      employeeRecords.push(...batchResults);
    }
    console.timeEnd('Fetch daily records');
    
    console.timeEnd('getProcessedEmployees');
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
  console.time('updateProcessedEmployeeData');
  
  try {
    let actualFileId = fileId;
    
    // First check if the file exists
    const fileExists = await checkFileExists(fileId);
    
    // If file doesn't exist, create a new one
    if (!fileExists) {
      console.log('File not found, creating a new one');
      
      // Calculate total days once to avoid repeated calculations
      const totalDays = employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0);
      
      try {
        const { data: newFile, error: createError } = await supabase
          .from('processed_excel_files')
          .insert({
            file_name: fileName,
            total_employees: employeeRecords.length,
            total_days: totalDays,
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
        
        // Store file ID in localStorage for immediate persistence
        localStorage.setItem('activeFileId', actualFileId);
      } catch (err) {
        console.error('Failed to create new file:', err);
        // If we can't create a new file, return failure
        return { success: false, fileId: actualFileId };
      }
    }
    
    // Process employee records in batches
    const employeeBatchSize = 5; // Process 5 employees at a time
    for (let i = 0; i < employeeRecords.length; i += employeeBatchSize) {
      const batch = employeeRecords.slice(i, i + employeeBatchSize);
      
      // Process batch in parallel
      await Promise.all(batch.map(async (employee) => {
        try {
          // First, check if the employee exists in the system employees table
          // and create them if not
          const { data: systemEmployee, error: sysLookupError } = await supabase
            .from('employees')
            .select('id, name')
            .eq('employee_number', employee.employeeNumber)
            .maybeSingle();
            
          let systemEmployeeId: string | null = null;
          
          if (sysLookupError) {
            console.error('Error looking up employee in system:', sysLookupError);
          } else if (!systemEmployee) {
            // Create the employee in the system
            const { data: newSysEmp, error: createSysError } = await supabase
              .from('employees')
              .insert({
                employee_number: employee.employeeNumber,
                name: employee.name
              })
              .select('id')
              .single();
              
            if (createSysError) {
              console.error('Error creating employee in system:', createSysError);
            } else {
              systemEmployeeId = newSysEmp.id;
              
              // Create credentials for the new employee
              await createUserCredentialsForNewEmployee(
                systemEmployeeId,
                employee.name,
                employee.employeeNumber
              );
            }
          } else {
            systemEmployeeId = systemEmployee.id;
            
            // Update employee name if different
            if (systemEmployee.name !== employee.name) {
              await supabase
                .from('employees')
                .update({ name: employee.name })
                .eq('id', systemEmployeeId);
            }
          }
          
          // Look for existing employee
          const { data: existingEmp, error: lookupError } = await supabase
            .from('processed_employee_data')
            .select('id')
            .eq('file_id', actualFileId)
            .eq('employee_number', employee.employeeNumber)
            .maybeSingle();
            
          if (lookupError) {
            console.error('Error looking up employee:', lookupError);
            return;
          }
          
          let employeeId: string;
          
          if (existingEmp) {
            // Update existing employee - Use retry for foreign key constraint issues
            employeeId = existingEmp.id;
            
            await retry(async () => {
              const { error } = await supabase
                .from('processed_employee_data')
                .update({
                  name: employee.name,
                  department: employee.department || '',
                  total_days: employee.days.length
                })
                .eq('id', employeeId);
                
              if (error) throw error;
            });
          } else {
            // Create new employee - Use retry for foreign key constraint issues
            const newEmp = await retry(async () => {
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
              
              if (!data) {
                throw new Error('No data returned when creating employee');
              }
              
              return data;
            });
            
            employeeId = newEmp.id;
          }
          
          // Removed redundant checkEmployeeExists call after operations
          
          // Delete existing daily records for this employee
          await supabase
            .from('processed_daily_records')
            .delete()
            .eq('employee_id', employeeId);
            
          // Insert daily records in small batches
          const dayBatchSize = 10;
          for (let j = 0; j < employee.days.length; j += dayBatchSize) {
            const daysBatch = employee.days.slice(j, j + dayBatchSize);
            
            const recordsToInsert = daysBatch.map(day => ({
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
            
            // Removed redundant final check before batch insert
            
            // Insert the batch with retry
            await retry(async () => {
              const { error } = await supabase
                .from('processed_daily_records')
                .insert(recordsToInsert);
                
              if (error) throw error;
            });
          }
        } catch (err) {
          console.error(`Error processing employee ${employee.name}:`, err);
        }
      }));
    }
    
    // Update file record with new totals
    await supabase
      .from('processed_excel_files')
      .update({
        total_employees: employeeRecords.length,
        total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0)
      })
      .eq('id', actualFileId);

    console.timeEnd('updateProcessedEmployeeData');
    return { success: true, fileId: actualFileId };
  } catch (error) {
    console.error('Error updating processed employee data:', error);
    console.timeEnd('updateProcessedEmployeeData');
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
        await delay(3000); // Increased from 2000 to 3000
        
        console.log('Deleting all processed employee data...');
        await supabase
          .from('processed_employee_data')
          .delete()
          .neq('file_id', '00000000-0000-0000-0000-000000000000');
          
        // Wait for deletion to complete
        await delay(3000); // Increased from 2000 to 3000
        
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

    // Add a final delay after deletion to ensure all operations complete
    await delay(2000); // Increased from 1000 to 2000

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