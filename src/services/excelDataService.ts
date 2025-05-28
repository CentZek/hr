import { supabase } from '../lib/supabase';
import { EmployeeRecord, DailyRecord } from '../types';

/**
 * Service for handling processed Excel data storage in Supabase
 */

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

    // Step 2: Save employee data
    for (const employee of employeeRecords) {
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
        console.error('Error inserting employee data:', employeeError);
        continue; // Skip this employee if there's an error
      }
      
      if (!employeeData) {
        console.error('No employee data returned after insert');
        continue; // Skip this employee if no data is returned
      }

      const employeeId = employeeData.id;

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
        const batchSize = 100;
        for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
          const batch = dailyRecordsToInsert.slice(i, i + batchSize);
          const { error: dailyError } = await supabase
            .from('processed_daily_records')
            .insert(batch);

          if (dailyError) {
            console.error('Error inserting daily records:', dailyError);
            // Continue with next batch even if there's an error
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
  employeeRecords: EmployeeRecord[]
): Promise<boolean> => {
  try {
    let finalFileId = fileId;
    
    // First, verify the file exists before proceeding
    const { data: fileData, error: fileError } = await supabase
      .from('processed_excel_files')
      .select('id')
      .eq('id', fileId)
      .single();
      
    if (fileError || !fileData) {
      console.error('File not found or error verifying file existence:', fileError);
      
      try {
        // Create a new file record before proceeding
        const { data: newFile, error: createFileError } = await supabase
          .from('processed_excel_files')
          .insert([{
            file_name: 'Recovered File',
            total_employees: employeeRecords.length,
            total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0),
            is_active: true
          }])
          .select()
          .single();
          
        if (createFileError || !newFile) {
          console.error('Failed to create recovery file:', createFileError);
          return false; // Exit early if we can't create the file
        }
        
        console.log('Created recovery file with ID:', newFile.id);
        
        // Update fileId to use the newly created file
        finalFileId = newFile.id;
        
        // Double-check that the file was created
        const { data: checkFile, error: checkError } = await supabase
          .from('processed_excel_files')
          .select('id')
          .eq('id', finalFileId)
          .single();
          
        if (checkError || !checkFile) {
          console.error('Verification failed for newly created file:', checkError);
          return false; // Exit if we can't verify the file exists
        }
      } catch (err) {
        console.error('Error during file recovery process:', err);
        return false;
      }
    }
    
    // For each employee, ensure their record exists before updating daily records
    for (const employee of employeeRecords) {
      // Check if employee record exists
      const { data: existingEmployee, error: lookupError } = await supabase
        .from('processed_employee_data')
        .select('id')
        .eq('file_id', finalFileId)
        .eq('employee_number', employee.employeeNumber)
        .maybeSingle();
        
      if (lookupError) {
        console.error('Error looking up employee:', lookupError);
        continue; // Skip this employee if there's an error
      }
      
      let employeeId: string;
      
      if (!existingEmployee) {
        // Create the employee record if it doesn't exist
        const { data: newEmployee, error: createError } = await supabase
          .from('processed_employee_data')
          .insert([{
            file_id: finalFileId,  // Use the verified file ID
            employee_number: employee.employeeNumber,
            name: employee.name,
            department: employee.department || '',
            total_days: employee.days.length
          }])
          .select('id')
          .single();
          
        if (createError || !newEmployee) {
          console.error('Error creating employee record:', createError);
          continue; // Skip this employee if creation fails
        }
        
        employeeId = newEmployee.id;
      } else {
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
          console.error('Error updating employee record:', updateError);
          // Continue anyway to try updating daily records
        }
      }
      
      // Delete existing daily records for this employee
      const { error: deleteError } = await supabase
        .from('processed_daily_records')
        .delete()
        .eq('employee_id', employeeId);
        
      if (deleteError) {
        console.error('Error deleting daily records:', deleteError);
        // Continue anyway to try inserting new records
      }
      
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
        // Insert in batches to avoid payload size limitations
        const batchSize = 100;
        for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
          const batch = dailyRecordsToInsert.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from('processed_daily_records')
            .insert(batch);

          if (insertError) {
            console.error('Error inserting daily records:', insertError);
            // Continue with next batch even if there's an error
          }
        }
      }
    }

    // Update file record with new totals
    const { error: updateFileError } = await supabase
      .from('processed_excel_files')
      .update({
        total_employees: employeeRecords.length,
        total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0)
      })
      .eq('id', finalFileId);

    if (updateFileError) {
      console.error('Error updating file record:', updateFileError);
      // Continue anyway as the main data is already updated
    }

    return true;
  } catch (error) {
    console.error('Error updating processed employee data:', error);
    return false;
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
        }
        
        // Now delete the employee records
        const { error: deleteEmployeesError } = await supabase
          .from('processed_employee_data')
          .delete()
          .eq('file_id', fileId);
          
        if (deleteEmployeesError) {
          console.error('Error deleting employee records:', deleteEmployeesError);
        }
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
      
      // 2. Then delete all processed_employee_data
      const { error: deleteEmployeesError } = await supabase
        .from('processed_employee_data')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to delete all
        
      if (deleteEmployeesError) {
        console.error('Error deleting all employee records:', deleteEmployeesError);
      }
      
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