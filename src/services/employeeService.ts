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
  // Group records by working_week_start or date
  const recordsByDate = timeRecords.reduce((acc: Record<string, any[]>, record) => {
    // Use working_week_start if available, otherwise use timestamp date
    const dateKey = record.working_week_start || format(parseISO(record.timestamp), 'yyyy-MM-dd');
    
    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(record);
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
    const shiftType = checkIn ? 
                  (checkIn.shift_type || determineShiftType(checkIn.timestamp)) : 
                  (checkOut ? 
                    (checkOut.shift_type || determineShiftType(checkOut.timestamp)) : null);
    
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

// Helper function to determine shift type from timestamp
const determineShiftType = (timestamp: string): string => {
  const date = new Date(timestamp);
  const hour = date.getHours();
  
  if (hour >= 4 && hour < 12) {
    return 'morning';
  } else if (hour >= 12 && hour < 20) {
    return 'evening';
  } else {
    return 'night';
  }
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
    
    // Create shift with standardized times and working_week_start
    const shiftToSave = {
      ...shiftData,
      start_time: startTime,
      end_time: endTime,
      working_week_start: shiftData.date // Set working_week_start to original date
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
    
    // Create check-in record with local date-time string for consistent timezone handling
    const checkInTimestamp = `${format(checkIn, 'yyyy-MM-dd')}T${shiftData.start_time}:00`;
    
    // Create check-out record with local date-time string
    const checkOutTimestamp = `${format(checkOut, 'yyyy-MM-dd')}T${shiftData.end_time}:00`;
    
    // Always use the original date as the working_week_start for both records
    const workingWeekStart = shiftData.date;
    
    // Get standard display values
    const displayTimes = DISPLAY_SHIFT_TIMES[shiftData.shift_type as keyof typeof DISPLAY_SHIFT_TIMES];
    const displayCheckIn = displayTimes?.startTime || shiftData.start_time;
    const displayCheckOut = displayTimes?.endTime || shiftData.end_time;
    
    const timeRecords = [
      {
        employee_id: shiftData.employee_id,
        timestamp: checkInTimestamp,
        status: 'check_in',
        shift_type: shiftData.shift_type,
        notes: 'Employee submitted; hours:9.00',
        is_manual_entry: true,
        exact_hours: 9.0,
        display_check_in: displayCheckIn,
        display_check_out: displayCheckOut,
        working_week_start: workingWeekStart // Always use original date
      },
      {
        employee_id: shiftData.employee_id,
        timestamp: checkOutTimestamp,
        status: 'check_out',
        shift_type: shiftData.shift_type,
        notes: 'Employee submitted; hours:9.00',
        is_manual_entry: true,
        exact_hours: 9.0,
        display_check_in: displayCheckIn,
        display_check_out: displayCheckOut,
        working_week_start: workingWeekStart // Always use original date
      }
    ];
    
    const { error: insertError } = await supabase.from('time_records').insert(timeRecords);
    if (insertError) throw insertError;
    
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