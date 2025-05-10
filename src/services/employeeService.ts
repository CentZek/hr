import { supabase } from '../lib/supabase';
import { format, parseISO, isValid } from 'date-fns';
import { DISPLAY_SHIFT_TIMES } from '../types';
import { parseShiftTimes } from '../utils/dateTimeHelper';

// Helper to get standardized shift times
const getStandardShiftTimes = (shiftType: string, date: string) => {
  let startTime, endTime, endDate = date;
  
  switch(shiftType) {
    case 'morning':
      startTime = '05:00';
      endTime = '14:00';
      break;
    case 'evening':
      startTime = '13:00';
      endTime = '22:00';
      break;
    case 'night':
      startTime = '21:00';
      // For night shift, end time is next day
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      endDate = format(nextDay, 'yyyy-MM-dd');
      endTime = '06:00';
      break;
    default:
      startTime = '13:00';
      endTime = '22:00';
  }
  
  return { startTime, endTime, endDate };
};

// Get all shifts for an employee
export const getEmployeeShifts = async (employeeId: string) => {
  try {
    // First get the employee-submitted shifts
    const { data: shiftData, error: shiftError } = await supabase
      .from('employee_shifts')
      .select('*')
      .eq('employee_id', employeeId)
      .order('date', { ascending: false });

    if (shiftError) {
      throw shiftError;
    }

    // Then get approved time records
    const { data: timeRecords, error: recordsError } = await supabase
      .from('time_records')
      .select('*')
      .eq('employee_id', employeeId)
      .order('timestamp', { ascending: false });

    if (recordsError) {
      throw recordsError;
    }

    // Convert time records to shift format
    const approvedShifts = convertTimeRecordsToShifts(timeRecords || [], employeeId);
    
    // Combine both sets of data and remove duplicates (prefer employee_shifts over converted records)
    const combinedShifts = mergeShiftsAndRemoveDuplicates(shiftData || [], approvedShifts);

    return combinedShifts;
  } catch (error) {
    console.error('Error fetching employee shifts:', error);
    throw error;
  }
};

// Helper function to convert time_records to shift format
const convertTimeRecordsToShifts = (timeRecords: any[], employeeId: string) => {
  // Group records by date
  const recordsByDate = timeRecords.reduce((acc: Record<string, any[]>, record) => {
    // Use the UTC date portion for consistency across timezones
    const utc = parseISO(record.timestamp);
    const date = utc.toISOString().slice(0,10);  // "YYYY-MM-DD"
    
    // For check-outs after midnight, use working_week_start if available
    if (record.status === 'check_out' && record.working_week_start) {
      const workDate = record.working_week_start;
      if (!acc[workDate]) {
        acc[workDate] = [];
      }
      acc[workDate].push(record);
      return acc;
    }
    
    // If not a check-out with working_week_start, use the date
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(record);
    return acc;
  }, {});

  const shifts: any[] = [];

  // Process each date to create shifts
  Object.entries(recordsByDate).forEach(([date, records]) => {
    // Skip days without both check-in and check-out
    const checkIns = records.filter(r => r.status === 'check_in');
    const checkOuts = records.filter(r => r.status === 'check_out');
    
    if (checkIns.length === 0 || checkOuts.length === 0) {
      // If we're missing either check-in or check-out, don't create a shift
      return;
    }
    
    // Sort check-ins and check-outs by timestamp
    checkIns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    checkOuts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Get the first check-in and last check-out
    const checkIn = checkIns[0];
    const checkOut = checkOuts[0];
    
    // Extract the shift type (prefer check-in's shift type)
    const shiftType = checkIn.shift_type || checkOut.shift_type || 'morning';
    
    // Use display values directly if available
    const start_time = checkIn.display_check_in || format(new Date(checkIn.timestamp), 'HH:mm');
    const end_time = checkOut.display_check_out || format(new Date(checkOut.timestamp), 'HH:mm');
    
    // Create a shift object
    shifts.push({
      id: `tr-${checkIn.id}-${checkOut.id}`, // Unique ID combining both record IDs
      employee_id: employeeId,
      date,
      start_time,
      end_time,
      shift_type: shiftType,
      status: 'confirmed', // Time records are always confirmed
      notes: checkIn.notes || checkOut.notes || 'Approved time record',
      created_at: checkIn.created_at,
      penalty_minutes: checkIn.deduction_minutes || 0,
      hr_notes: checkIn.is_late ? 'Check-in was late' : 
                checkOut.early_leave ? 'Left early' : '',
      is_approved_record: true // Flag to indicate this is from approved time records
    });
  });

  return shifts;
};

// Helper function to merge shifts and remove duplicates by date
const mergeShiftsAndRemoveDuplicates = (employeeShifts: any[], approvedShifts: any[]) => {
  // Create a map of dates for employee-submitted shifts
  const dateMap = new Map<string, boolean>();
  employeeShifts.forEach(shift => {
    dateMap.set(shift.date, true);
  });

  // Only add approved shifts for dates that don't have employee-submitted shifts
  const filteredApprovedShifts = approvedShifts.filter(shift => !dateMap.has(shift.date));
  
  // Combine and sort by date (newest first)
  return [...employeeShifts, ...filteredApprovedShifts]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

// Add a new shift for an employee
export const addEmployeeShift = async (shiftData: any) => {
  try {
    // Get standardized times based on shift type
    const { startTime, endTime, endDate } = getStandardShiftTimes(
      shiftData.shift_type, 
      shiftData.date
    );
    
    // Create shift with standardized times
    const shiftToSave = {
      ...shiftData,
      start_time: startTime,
      end_time: endTime
    };
    
    const { data, error } = await supabase
      .from('employee_shifts')
      .insert([shiftToSave])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error adding employee shift:', error);
    throw error;
  }
};

// Delete an employee shift
export const deleteEmployeeShift = async (shiftId: string) => {
  try {
    // Don't attempt to delete approved time records
    if (shiftId.startsWith('tr-')) {
      throw new Error('Cannot delete approved time records');
    }
    
    const { error } = await supabase
      .from('employee_shifts')
      .delete()
      .eq('id', shiftId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.error('Error deleting employee shift:', error);
    throw error;
  }
};

// Update an existing shift
export const updateEmployeeShift = async (shiftId: string, updateData: any) => {
  try {
    const { data, error } = await supabase
      .from('employee_shifts')
      .update(updateData)
      .eq('id', shiftId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Error updating employee shift:', error);
    throw error;
  }
};

// Add employee shift directly to the time_records table for HR approval
export const submitShiftForApproval = async (shiftData: any) => {
  try {
    // Use our helper function to properly handle day rollover for night shifts
    const { checkIn, checkOut } = parseShiftTimes(
      shiftData.date,
      shiftData.start_time,
      shiftData.end_time,
      shiftData.shift_type
    );
    
    // Create check-in record with full ISO timestamp for consistent timezone handling
    const checkInData = {
      employee_id: shiftData.employee_id,
      timestamp: checkIn.toISOString(), // Use full ISO string with timezone
      status: 'check_in',
      shift_type: shiftData.shift_type,
      notes: 'Employee submitted; hours:9.00',
      is_manual_entry: true,
      display_check_in: shiftData.start_time,
      display_check_out: shiftData.end_time,
      working_week_start: shiftData.date // Add working_week_start for proper grouping
    };
    
    const { error: checkInError } = await supabase
      .from('time_records')
      .insert([checkInData]);
      
    if (checkInError) throw checkInError;
    
    // Create check-out record with full ISO timestamp
    const checkOutData = {
      employee_id: shiftData.employee_id,
      timestamp: checkOut.toISOString(), // Use full ISO string with timezone
      status: 'check_out',
      shift_type: shiftData.shift_type,
      notes: 'Employee submitted; hours:9.00',
      is_manual_entry: true,
      display_check_in: shiftData.start_time,
      display_check_out: shiftData.end_time,
      working_week_start: shiftData.date // Same working_week_start for consistency
    };
    
    const { error: checkOutError } = await supabase
      .from('time_records')
      .insert([checkOutData]);
      
    if (checkOutError) throw checkOutError;
    
    // Update shift status to 'submitted'
    const { data, error } = await supabase
      .from('employee_shifts')
      .update({ status: 'submitted' })
      .eq('id', shiftData.id)
      .select()
      .single();
      
    if (error) throw error;
    
    return data;
  } catch (error) {
    console.error('Error submitting shift for approval:', error);
    throw error;
  }
};

// Create or update user credentials
export const saveUserCredentials = async (employeeId: string, username: string, password: string) => {
  try {
    // First check if the username already exists for a different employee
    const { data: existingUsername, error: usernameError } = await supabase
      .from('user_credentials')
      .select('id, employee_id')
      .eq('username', username)
      .neq('employee_id', employeeId)
      .maybeSingle();
      
    if (usernameError) throw usernameError;
    
    // If username exists for another employee, we need to generate a unique one
    if (existingUsername) {
      throw new Error(`Username "${username}" is already taken by another employee`);
    }
    
    // Check if credentials already exist for this employee
    const { data: existingCreds, error: checkError } = await supabase
      .from('user_credentials')
      .select('id')
      .eq('employee_id', employeeId)
      .maybeSingle();
      
    if (checkError) throw checkError;
    
    if (existingCreds) {
      // Update existing credentials
      const { error: updateError } = await supabase
        .from('user_credentials')
        .update({ username, password })
        .eq('id', existingCreds.id);
        
      if (updateError) throw updateError;
    } else {
      // Create new credentials
      const { error: insertError } = await supabase
        .from('user_credentials')
        .insert({ employee_id: employeeId, username, password });
        
      if (insertError) throw insertError;
    }
    
    return true;
  } catch (error) {
    console.error('Error saving user credentials:', error);
    throw error;
  }
};

// Add a migration to initialize credentials from existing employees
export const initializeAllUserCredentials = async () => {
  try {
    // Fetch all employees
    const { data: employees, error: fetchError } = await supabase
      .from('employees')
      .select('id, name, employee_number');
      
    if (fetchError) throw fetchError;
    
    if (!employees || employees.length === 0) {
      return { success: true, count: 0 };
    }
    
    // Get existing credentials to avoid duplicates
    const { data: existingCreds, error: credsError } = await supabase
      .from('user_credentials')
      .select('employee_id, username');
      
    if (credsError) throw credsError;
    
    // Create maps for quick lookups
    const existingEmployeeMap = new Map();
    const existingUsernameSet = new Set();
    
    if (existingCreds) {
      existingCreds.forEach(cred => {
        existingEmployeeMap.set(cred.employee_id, true);
        existingUsernameSet.add(cred.username.toLowerCase());
      });
    }
    
    // Generate credentials for employees without them
    const insertData = [];
    
    for (const emp of employees) {
      // Skip if employee already has credentials
      if (existingEmployeeMap.has(emp.id)) continue;
      
      // Create a unique username
      let baseUsername = `${emp.name}_${emp.employee_number}`;
      let username = baseUsername;
      let counter = 1;
      
      // Check if username is unique
      while (existingUsernameSet.has(username.toLowerCase())) {
        username = `${emp.name}_${counter}`;
        counter++;
        
        // Safety check
        if (counter > 100) {
          console.warn(`Could not generate unique username for employee ${emp.id}`);
          continue;
        }
      }
      
      // Add username to set and to insert batch
      existingUsernameSet.add(username.toLowerCase());
      insertData.push({
        employee_id: emp.id,
        username: username,
        password: emp.employee_number
      });
    }
    
    if (insertData.length === 0) {
      return { success: true, count: 0 };
    }
    
    // Insert credentials one by one to avoid batch errors
    let successCount = 0;
    
    for (const cred of insertData) {
      try {
        const { error } = await supabase
          .from('user_credentials')
          .insert([cred]);
          
        if (!error) {
          successCount++;
        }
      } catch (err) {
        console.error(`Error inserting credential for employee ${cred.employee_id}:`, err);
      }
    }
    
    return { success: true, count: successCount };
  } catch (error) {
    console.error('Error initializing user credentials:', error);
    return { success: false, error };
  }
};