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
          console.error('Error inserting employee data:', employeeError);
          continue; // Skip this employee and continue with the next one
        }
        
        if (!employeeData || !employeeData.id) {
          console.error('No employee data returned or missing ID for:', employee.employeeNumber);
          continue; // Skip daily records for this employee
        }

        const employeeId = employeeData.id;

        // Step 3: Save daily records for this employee
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
            const { error: dailyError } = await supabase
              .from('processed_daily_records')
              .insert(batch);

            if (dailyError) {
              console.error('Error inserting daily records batch:', dailyError);
              // Continue processing other batches
            }
          }
        }
      } catch (empError) {
        console.error('Error processing employee:', employee.employeeNumber, empError);
        // Continue with other employees
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
    if (!fileId || !employeeRecords || employeeRecords.length === 0) {
      console.warn('No fileId or employee records provided for update');
      return false;
    }
    
    // Step 1: Get all employee IDs for this file
    const { data: employeesData, error: employeesError } = await supabase
      .from('processed_employee_data')
      .select('id, employee_number')
      .eq('file_id', fileId);

    if (employeesError) {
      console.error('Error fetching employee data:', employeesError);
      return false;
    }
    
    if (!employeesData || employeesData.length === 0) {
      console.warn('No employees found for file ID:', fileId);
      return false;
    }

    // Create a map for easy lookup of employee IDs
    const employeeIdMap = new Map(
      employeesData.map(emp => [emp.employee_number, emp.id])
    );

    // Step 2: Update each employee's daily records
    for (const employee of employeeRecords) {
      const employeeId = employeeIdMap.get(employee.employeeNumber);
      
      // Skip if employee ID doesn't exist in the database
      if (!employeeId) {
        console.warn(`Employee ${employee.employeeNumber} not found in database, skipping update`);
        continue;
      }

      try {
        // Delete existing daily records for this employee
        const { error: deleteError } = await supabase
          .from('processed_daily_records')
          .delete()
          .eq('employee_id', employeeId);

        if (deleteError) {
          console.error(`Error deleting daily records for employee ${employee.employeeNumber}:`, deleteError);
          continue; // Skip to next employee if we can't delete existing records
        }

        // Only proceed with insertion if there are days to insert
        if (employee.days && employee.days.length > 0) {
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

          // Insert in batches to avoid payload size limitations
          const batchSize = 100;
          for (let i = 0; i < dailyRecordsToInsert.length; i += batchSize) {
            const batch = dailyRecordsToInsert.slice(i, i + batchSize);
            const { error: insertError } = await supabase
              .from('processed_daily_records')
              .insert(batch);

            if (insertError) {
              console.error(`Error inserting daily records batch for employee ${employee.employeeNumber}:`, insertError);
              // Continue with other batches
            }
          }
        }

        // Update employee record with new total_days
        const { error: updateError } = await supabase
          .from('processed_employee_data')
          .update({ total_days: employee.days.length })
          .eq('id', employeeId);

        if (updateError) {
          console.error(`Error updating employee ${employee.employeeNumber} total days:`, updateError);
        }
      } catch (empError) {
        console.error(`Error processing employee ${employee.employeeNumber}:`, empError);
        // Continue with other employees
      }
    }

    // Step 3: Update file record with new totals
    const { error: updateFileError } = await supabase
      .from('processed_excel_files')
      .update({
        total_employees: employeeRecords.length,
        total_days: employeeRecords.reduce((sum, emp) => sum + emp.days.length, 0)
      })
      .eq('id', fileId);

    if (updateFileError) {
      console.error('Error updating file record:', updateFileError);
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
      // Delete specific file and its associated data (cascade will handle related records)
      const { error } = await supabase
        .from('processed_excel_files')
        .delete()
        .eq('id', fileId);

      if (error) throw error;
    } else {
      // Delete all files and their associated data
      const { error } = await supabase
        .from('processed_excel_files')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to delete all

      if (error) throw error;
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