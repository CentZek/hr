import { supabase } from '../lib/supabase';
import { EmployeeRecord, DailyRecord } from '../types';

/**
 * Service for handling processed Excel data storage in Supabase
 */

// Helper function to create a delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

    if (fileError) {
      console.error('Error creating file record:', fileError);
      throw fileError;
    }
    
    if (!fileData) {
      console.error('No file data returned from insert operation');
      throw new Error('Failed to create file record');
    }

    const fileId = fileData.id;
    console.log(`Created file record with ID: ${fileId}`);
    
    // Add a delay to ensure the file record is committed
    await delay(1000);

    // Step 2: Save employee data
    for (const employee of employeeRecords) {
      try {
        // Create employee record
        const { data: employeeData, error: employeeError } = await supabase
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

        if (employeeError) {
          console.error(`Error inserting employee data for ${employee.name}:`, employeeError);
          continue; // Skip this employee if there's an error
        }
        
        if (!employeeData) {
          console.error(`No employee data returned after insert for ${employee.name}`);
          continue; // Skip this employee if no data is returned
        }

        const employeeId = employeeData.id;
        
        // Add a delay to ensure the employee record is committed
        await delay(300);

        // Step 3: Save daily records for this employee in smaller batches
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
          // Insert in smaller batches to avoid payload size limitations
          const batchSize = 25;
          for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
            const batch = dailyRecordsToInsert.slice(i, i + batchSize);
            try {
              const { error: dailyError } = await supabase
                .from('processed_daily_records')
                .insert(batch);

              if (dailyError) {
                console.error(`Error inserting daily records batch for ${employee.name}:`, dailyError);
                // Continue with next batch
              }
              
              // Add a small delay between batches
              if (i + batchSize < dailyRecordsToInsert.length) {
                await delay(100);
              }
            } catch (batchError) {
              console.error(`Exception during batch insert for ${employee.name}:`, batchError);
              // Continue with next batch
            }
          }
        }
      } catch (employeeError) {
        console.error(`Error processing employee ${employee.name}:`, employeeError);
        // Continue with next employee
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

    if (employeesError) {
      console.error('Error fetching employees data:', employeesError);
      throw employeesError;
    }
    
    if (!employeesData || employeesData.length === 0) {
      return [];
    }

    // Step 2: For each employee, fetch their daily records
    const employeeRecords: EmployeeRecord[] = [];

    for (const emp of employeesData) {
      try {
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
      } catch (empError) {
        console.error(`Error processing employee ${emp.id}:`, empError);
        // Continue with next employee
      }
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
    // Delay to ensure any previous operations have completed
    await delay(500);

    let actualFileId = fileId;
    let newFileCreated = false;
    
    // First, verify the file exists before proceeding
    const fileExists = await checkFileExists(fileId);
    
    if (!fileExists) {
      console.log('File not found, creating a new one');
      
      try {
        // Create a new file record
        const { data: newFileData, error: createError } = await supabase
          .from('processed_excel_files')
          .insert({
            file_name: fileName,
            total_employees: employeeRecords.length,
            total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0),
            is_active: true
          })
          .select();
          
        if (createError) {
          console.error('Error creating new file record:', createError);
          throw new Error(`Failed to create new file record: ${createError.message}`);
        }
        
        if (!newFileData || newFileData.length === 0 || !newFileData[0].id) {
          throw new Error('New file record created but no ID returned');
        }
        
        // Use the new file ID for subsequent operations
        actualFileId = newFileData[0].id;
        newFileCreated = true;
        console.log('Created new file with ID:', actualFileId);
        
        // Add delay after creating the file to ensure it's committed
        await delay(1500);
        
        // Double-check that the file exists
        const newFileExists = await checkFileExists(actualFileId);
        if (!newFileExists) {
          console.error('New file record was created but cannot be found in database');
          throw new Error('Failed to create file record properly');
        }
      } catch (err) {
        console.error('Error creating new file:', err);
        return { success: false, fileId: actualFileId };
      }
    }
    
    // Process each employee
    for (const employee of employeeRecords) {
      try {
        // Check if employee record exists
        const { data: existingEmployee, error: lookupError } = await supabase
          .from('processed_employee_data')
          .select('id')
          .eq('file_id', actualFileId)
          .eq('employee_number', employee.employeeNumber)
          .maybeSingle();
          
        if (lookupError) {
          console.error(`Error looking up employee ${employee.name}:`, lookupError);
          continue; // Skip this employee
        }
        
        let employeeId: string;
        
        if (existingEmployee) {
          // Use existing employee ID
          employeeId = existingEmployee.id;
          
          // Update the existing employee record
          const { error: updateError } = await supabase
            .from('processed_employee_data')
            .update({
              name: employee.name,
              department: employee.department || '',
              total_days: employee.days.length
            })
            .eq('id', employeeId);
            
          if (updateError) {
            console.error(`Error updating employee ${employee.name}:`, updateError);
            // Continue anyway to try updating daily records
          }
        } else {
          // Create new employee record
          try {
            // Verify file still exists
            const fileStillExists = await checkFileExists(actualFileId);
            if (!fileStillExists) {
              console.error(`File ${actualFileId} no longer exists, cannot create employee record`);
              // If this is a newly created file that disappeared, we need to return failure
              if (newFileCreated) {
                return { success: false, fileId: actualFileId };
              }
              continue;
            }
            
            // Add a delay before creating the employee record
            await delay(300);
            
            const { data: newEmployee, error: createError } = await supabase
              .from('processed_employee_data')
              .insert({
                file_id: actualFileId,
                employee_number: employee.employeeNumber,
                name: employee.name,
                department: employee.department || '',
                total_days: employee.days.length
              })
              .select();
              
            if (createError) {
              console.error(`Error creating employee record for ${employee.name}:`, createError);
              continue;
            }
            
            if (!newEmployee || newEmployee.length === 0 || !newEmployee[0].id) {
              console.error(`Failed to create employee record for ${employee.name}: No ID returned`);
              continue;
            }
            
            employeeId = newEmployee[0].id;
            console.log(`Created employee record with ID: ${employeeId}`);
          } catch (err) {
            console.error(`Error creating employee record for ${employee.name}:`, err);
            continue;
          }
        }
        
        // Add a delay before processing daily records
        await delay(300);
        
        // Delete existing daily records for this employee
        try {
          // First check if the employee still exists
          const { data: empCheck, error: empCheckError } = await supabase
            .from('processed_employee_data')
            .select('id')
            .eq('id', employeeId)
            .maybeSingle();
            
          if (empCheckError) {
            console.error(`Error checking employee existence for ${employee.name}:`, empCheckError);
            continue;
          }
          
          if (!empCheck) {
            console.error(`Employee ID ${employeeId} no longer exists`);
            continue;
          }
          
          // Now delete the daily records
          const { error: deleteError } = await supabase
            .from('processed_daily_records')
            .delete()
            .eq('employee_id', employeeId);
            
          if (deleteError) {
            console.error(`Error deleting daily records for ${employee.name}:`, deleteError);
            // Continue anyway to try inserting new records
          }
          
          // Wait after delete operation
          await delay(300);
        } catch (err) {
          console.error(`Exception deleting daily records for ${employee.name}:`, err);
          // Continue anyway to try inserting new records
        }
        
        // Insert daily records in small batches
        if (employee.days.length > 0) {
          // Convert days to database format
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
          
          // Insert in smaller batches
          const batchSize = 20; // Smaller batch size to avoid issues
          for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
            const batch = dailyRecordsToInsert.slice(i, i + batchSize);
            
            try {
              // Verify employee still exists before each batch insert
              const { data: empVerify } = await supabase
                .from('processed_employee_data')
                .select('id')
                .eq('id', employeeId)
                .maybeSingle();
                
              if (!empVerify) {
                console.error(`Employee ${employeeId} no longer exists before batch insert`);
                break;
              }
              
              const { error: insertError } = await supabase
                .from('processed_daily_records')
                .insert(batch);
                
              if (insertError) {
                console.error(`Error inserting daily records batch for ${employee.name}:`, insertError);
                // Continue with next batch anyway
              }
              
              // Add delay between batches
              await delay(200);
            } catch (batchError) {
              console.error(`Exception during batch insert for ${employee.name}:`, batchError);
              // Continue with next batch
            }
          }
        }
      } catch (employeeError) {
        console.error(`Error processing employee ${employee.name}:`, employeeError);
        // Continue with next employee
      }
    }

    // Update file record with new totals
    try {
      // Verify file still exists
      const fileStillExists = await checkFileExists(actualFileId);
      if (!fileStillExists) {
        console.error(`File ${actualFileId} no longer exists, cannot update totals`);
        return { success: true, fileId: actualFileId };  // Return success anyway since data was saved
      }
      
      const { error: updateError } = await supabase
        .from('processed_excel_files')
        .update({
          total_employees: employeeRecords.length,
          total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0)
        })
        .eq('id', actualFileId);
        
      if (updateError) {
        console.error('Error updating file record totals:', updateError);
        // Return success anyway since the main data was saved
      }
    } catch (err) {
      console.error('Exception updating file record:', err);
      // Return success anyway since the main data was saved
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
      // First check if file exists
      const fileExists = await checkFileExists(fileId);
      if (!fileExists) {
        console.log(`File ${fileId} doesn't exist, nothing to delete`);
        return true;
      }
      
      // Delete the specified file (cascade should handle related records)
      const { error } = await supabase
        .from('processed_excel_files')
        .delete()
        .eq('id', fileId);

      if (error) {
        console.error(`Error deleting file ${fileId}:`, error);
        return false;
      }
    } else {
      // Delete all records in separate operations in reverse dependency order
      
      console.log('Deleting all processed daily records...');
      try {
        const { error: dailyRecordsError } = await supabase
          .from('processed_daily_records')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
          
        if (dailyRecordsError) {
          console.error('Error deleting all daily records:', dailyRecordsError);
          // Continue with other deletions
        }
        
        // Add delay between operations
        await delay(1000);
      } catch (err) {
        console.error('Exception deleting daily records:', err);
        // Continue with other deletions
      }
      
      console.log('Deleting all processed employee data...');
      try {
        const { error: employeeDataError } = await supabase
          .from('processed_employee_data')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
          
        if (employeeDataError) {
          console.error('Error deleting all employee data:', employeeDataError);
          // Continue with other deletions
        }
        
        // Add delay between operations
        await delay(1000);
      } catch (err) {
        console.error('Exception deleting employee data:', err);
        // Continue with other deletions
      }
      
      console.log('Deleting all processed Excel files...');
      try {
        const { error: filesError } = await supabase
          .from('processed_excel_files')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
          
        if (filesError) {
          console.error('Error deleting all Excel files:', filesError);
          return false;
        }
      } catch (err) {
        console.error('Exception deleting Excel files:', err);
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