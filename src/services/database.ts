import { supabase } from '../lib/supabase';
import { format, parseISO, startOfMonth, endOfMonth, addDays, isValid, subDays } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';
import toast from 'react-hot-toast';
import { parseShiftTimes } from '../utils/dateTimeHelper';

// Fetch approved hours summary
export const fetchApprovedHours = async (monthFilter: string = ''): Promise<{
  data: any[];
  totalHoursSum: number;
}> => {
  try {
    // First, select only check-in records (to avoid double-counting hours)
    let query = supabase
      .from('time_records')
      .select(`
        employee_id,
        timestamp,
        status,
        exact_hours,
        working_week_start,
        employees (
          id,
          name,
          employee_number
        )
      `)
      .in('status', ['check_in', 'off_day'])  // Include both check-in and off-day records
      .not('exact_hours', 'is', null);
    
    // Apply month filter if provided
    if (monthFilter) {
      const [year, month] = monthFilter.split('-');
      const startDate = startOfMonth(new Date(parseInt(year), parseInt(month) - 1, 1));
      const endDate = endOfMonth(startDate);
      
      query = query
        .gte('timestamp', format(startDate, 'yyyy-MM-dd'))
        .lte('timestamp', format(endDate, 'yyyy-MM-dd'));
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    // Group by employee and calculate totals
    const employeeSummary = new Map();
    let totalHoursSum = 0;
    
    data?.forEach(record => {
      if (!record.employees) return;
      
      const employeeId = record.employee_id;
      const hours = parseFloat(record.exact_hours || 0);
      
      if (isNaN(hours)) return;
      
      totalHoursSum += hours;
      
      if (!employeeSummary.has(employeeId)) {
        employeeSummary.set(employeeId, {
          id: employeeId,
          name: record.employees.name,
          employee_number: record.employees.employee_number,
          total_days: new Set(),
          total_hours: 0
        });
      }
      
      const employee = employeeSummary.get(employeeId);
      employee.total_hours += hours;
      
      // Add date to set of days - Only if timestamp is valid
      if (record.timestamp && isValid(new Date(record.timestamp))) {
        // Use working_week_start if available, otherwise use timestamp date
        if (record.working_week_start) {
          employee.total_days.add(record.working_week_start);
        } else {
          // Use the UTC date portion so nothing shifts under local timezones
          const utc = parseISO(record.timestamp);
          const date = utc.toISOString().slice(0,10); // "YYYY-MM-DD"
          employee.total_days.add(date);
        }
      }
    });
    
    // Add OFF-DAY records separately
    const { data: offDayData, error: offDayError } = await supabase
      .from('time_records')
      .select(`
        employee_id,
        timestamp,
        status,
        working_week_start,
        employees (
          id,
          name,
          employee_number
        )
      `)
      .eq('status', 'off_day');
    
    if (offDayError) throw offDayError;
    
    // Add OFF-DAY records to the employee totals
    offDayData?.forEach(record => {
      if (!record.employees) return;
      
      const employeeId = record.employee_id;
      
      if (!employeeSummary.has(employeeId)) {
        employeeSummary.set(employeeId, {
          id: employeeId,
          name: record.employees.name,
          employee_number: record.employees.employee_number,
          total_days: new Set(),
          total_hours: 0
        });
      }
      
      const employee = employeeSummary.get(employeeId);
      
      // Add date to set of days for OFF-DAY
      if (record.working_week_start) {
        employee.total_days.add(record.working_week_start);
      } else if (record.timestamp && isValid(new Date(record.timestamp))) {
        // Use the UTC date portion so nothing shifts under local timezones
        const utc = parseISO(record.timestamp);
        const date = utc.toISOString().slice(0,10); // "YYYY-MM-DD"
        employee.total_days.add(date);
      }
    });
    
    // Convert to array and calculate days
    const result = Array.from(employeeSummary.values()).map(emp => ({
      ...emp,
      total_days: emp.total_days.size,
      total_hours: parseFloat(emp.total_hours.toFixed(2))
    }));
    
    // Sort by name
    result.sort((a, b) => a.name.localeCompare(b.name));
    
    return { 
      data: result, 
      totalHoursSum: parseFloat(totalHoursSum.toFixed(2))
    };
  } catch (error) {
    console.error('Error fetching approved hours:', error);
    throw error;
  }
};

// Fetch employee details for approved hours
export const fetchEmployeeDetails = async (employeeId: string, monthFilter: string = ''): Promise<{
  data: any[];
}> => {
  try {
    let query = supabase
      .from('time_records')
      .select(`
        id,
        employee_id,
        timestamp,
        status,
        shift_type,
        is_late,
        early_leave,
        deduction_minutes,
        notes,
        exact_hours,
        display_time,
        display_check_in,
        display_check_out,
        mislabeled,
        working_week_start,
        employees (
          name,
          employee_number
        )
      `)
      .eq('employee_id', employeeId)
      .order('timestamp', { ascending: true });
    
    // Apply month filter if provided
    if (monthFilter) {
      const [year, month] = monthFilter.split('-');
      const startDate = startOfMonth(new Date(parseInt(year), parseInt(month) - 1, 1));
      const endDate = endOfMonth(startDate);
      
      query = query
        .gte('timestamp', format(startDate, 'yyyy-MM-dd'))
        .lte('timestamp', format(endDate, 'yyyy-MM-dd'));
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return { data: data || [] };
  } catch (error) {
    console.error('Error fetching employee details:', error);
    throw error;
  }
};

// Save records to database
export const saveRecordsToDatabase = async (employeeRecords: EmployeeRecord[]): Promise<{
  successCount: number;
  errorCount: number;
  errorDetails: { employeeName: string; date: string; error: string }[];
}> => {
  let successCount = 0;
  let errorCount = 0;
  const errorDetails: { employeeName: string; date: string; error: string }[] = [];
  
  // Process each employee's approved days
  for (const employee of employeeRecords) {
    const approvedDays = employee.days.filter(day => day.approved);
    
    for (const day of approvedDays) {
      try {
        // Skip if this is an OFF-DAY with no hours
        if (day.notes === 'OFF-DAY' && day.hoursWorked === 0) {
          // Create an OFF-DAY record
          const { error } = await supabase.from('time_records').insert([
            {
              employee_id: await getEmployeeId(employee.employeeNumber),
              timestamp: `${day.date}T12:00:00`, // Use local date-time string
              status: 'off_day',
              shift_type: 'off_day',
              notes: 'OFF-DAY',
              is_manual_entry: true,
              exact_hours: 0,
              working_week_start: day.date // Set working_week_start for proper grouping
            }
          ]);
          
          if (error) throw error;
          successCount++;
          continue;
        }
        
        // Skip if missing both check-in and check-out
        if (!day.firstCheckIn && !day.lastCheckOut) {
          errorCount++;
          errorDetails.push({
            employeeName: employee.name,
            date: day.date,
            error: 'Missing both check-in and check-out times'
          });
          continue;
        }
        
        // Get employee ID
        const employeeId = await getEmployeeId(employee.employeeNumber);
        
        // Prepare records to insert
        const records = [];
        
        // Add check-in record if available
        if (day.firstCheckIn) {
          // FIXED: Use local date-time string instead of UTC timestamp
          const checkInDateStr = format(day.firstCheckIn, 'yyyy-MM-dd');
          const checkInTimeStr = format(day.firstCheckIn, 'HH:mm:ss');
          const checkInTimestamp = `${checkInDateStr}T${checkInTimeStr}`;
          
          records.push({
            employee_id: employeeId,
            timestamp: checkInTimestamp,
            status: 'check_in',
            shift_type: day.shiftType,
            is_late: day.isLate,
            early_leave: false,
            deduction_minutes: day.penaltyMinutes,
            notes: day.notes ? `${day.notes}; hours:${day.hoursWorked.toFixed(2)}` : `hours:${day.hoursWorked.toFixed(2)}`,
            exact_hours: day.hoursWorked,
            display_check_in: day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
            display_check_out: day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing',
            is_fixed: day.correctedRecords || false,
            corrected_records: day.correctedRecords || false,
            mislabeled: false,
            // For night shifts, set working_week_start to help with grouping
            working_week_start: day.date
          });
        }
        
        // Add check-out record if available
        if (day.lastCheckOut) {
          // FIXED: Use local date-time string instead of UTC timestamp
          const checkOutDateStr = format(day.lastCheckOut, 'yyyy-MM-dd');
          const checkOutTimeStr = format(day.lastCheckOut, 'HH:mm:ss');
          const checkOutTimestamp = `${checkOutDateStr}T${checkOutTimeStr}`;
          
          records.push({
            employee_id: employeeId,
            timestamp: checkOutTimestamp,
            status: 'check_out',
            shift_type: day.shiftType,
            is_late: false,
            early_leave: day.earlyLeave,
            deduction_minutes: day.penaltyMinutes,
            notes: day.notes ? `${day.notes}; hours:${day.hoursWorked.toFixed(2)}` : `hours:${day.hoursWorked.toFixed(2)}`,
            exact_hours: day.hoursWorked,
            display_check_in: day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
            display_check_out: format(day.lastCheckOut, 'HH:mm'),
            is_fixed: day.correctedRecords || false,
            corrected_records: day.correctedRecords || false,
            mislabeled: false,
            // For night shifts with early morning checkout, set working_week_start to the check-in date
            working_week_start: day.shiftType === 'night' && day.lastCheckOut.getHours() < 12 ? day.date : day.date
          });
        }
        
        // Insert records
        if (records.length > 0) {
          const { error } = await supabase.from('time_records').insert(records);
          
          if (error) throw error;
          successCount++;
        }
      } catch (error) {
        console.error(`Error saving record for ${employee.name} on ${day.date}:`, error);
        errorCount++;
        errorDetails.push({
          employeeName: employee.name,
          date: day.date,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }
  
  return { successCount, errorCount, errorDetails };
};

// Helper function to get employee ID from employee number
const getEmployeeId = async (employeeNumber: string): Promise<string> => {
  // Check if employee exists
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('employee_number', employeeNumber)
    .maybeSingle();
  
  if (error) throw error;
  
  if (data) {
    return data.id;
  }
  
  // Create new employee if not exists
  const { data: newEmployee, error: createError } = await supabase
    .from('employees')
    .insert([
      { employee_number: employeeNumber, name: 'Unknown Employee' }
    ])
    .select('id')
    .single();
  
  if (createError) throw createError;
  
  return newEmployee.id;
};

// Fetch manual time records
export const fetchManualTimeRecords = async (limit: number = 50): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('time_records')
      .select(`
        id,
        employee_id,
        timestamp,
        status,
        shift_type,
        is_late,
        early_leave,
        deduction_minutes,
        notes,
        is_manual_entry,
        display_check_in,
        display_check_out,
        exact_hours,
        working_week_start,
        employees (
          name,
          employee_number
        )
      `)
      .eq('is_manual_entry', true)
      .not('status', 'eq', 'off_day')  // Exclude off-day records
      .order('timestamp', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    
    // FIXED: Ensure display values are set correctly for all shift types
    const processedData = data?.map(record => {
      // Make sure all records have properly set display values
      let updatedRecord = { ...record };
      
      if (record.shift_type) {
        const shiftType = record.shift_type;
        
        // Set standard display times based on shift type if missing
        if (!record.display_check_in || record.display_check_in === 'Missing') {
          if (shiftType === 'morning') {
            updatedRecord.display_check_in = '05:00';
          } else if (shiftType === 'evening') {
            updatedRecord.display_check_in = '13:00';
          } else if (shiftType === 'night') {
            updatedRecord.display_check_in = '21:00';
          } else if (shiftType === 'canteen') {
            updatedRecord.display_check_in = record.timestamp && new Date(record.timestamp).getHours() === 7 ? '07:00' : '08:00';
          }
        }
        
        if (!record.display_check_out || record.display_check_out === 'Missing') {
          if (shiftType === 'morning') {
            updatedRecord.display_check_out = '14:00';
          } else if (shiftType === 'evening') {
            updatedRecord.display_check_out = '22:00';
          } else if (shiftType === 'night') {
            updatedRecord.display_check_out = '06:00';
          } else if (shiftType === 'canteen') {
            updatedRecord.display_check_out = record.timestamp && new Date(record.timestamp).getHours() === 7 ? '16:00' : '17:00';
          }
        }
      }
      
      return updatedRecord;
    }) || [];
    
    return processedData;
  } catch (error) {
    console.error('Error fetching manual time records:', error);
    return [];
  }
};

// Fetch pending employee shifts
export const fetchPendingEmployeeShifts = async (): Promise<any[]> => {
  try {
    const { data, error } = await supabase
      .from('employee_shifts')
      .select(`
        id,
        employee_id,
        date,
        shift_type,
        start_time,
        end_time,
        status,
        notes,
        working_week_start,
        employees (
          name,
          employee_number
        )
      `)
      .eq('status', 'pending')
      .order('date', { ascending: false });
    
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error fetching pending employee shifts:', error);
    return [];
  }
};

// Delete all time records
export const deleteAllTimeRecords = async (monthFilter: string = ''): Promise<{
  success: boolean;
  message: string;
  count: number;
}> => {
  try {
    let query = supabase.from('time_records').delete();
    
    // Apply month filter if provided
    if (monthFilter) {
      const [year, month] = monthFilter.split('-');
      const startDate = startOfMonth(new Date(parseInt(year), parseInt(month) - 1, 1));
      const endDate = endOfMonth(startDate);
      
      // Get count first
      const { count, error: countError } = await supabase
        .from('time_records')
        .select('*', { count: 'exact', head: true })
        .gte('timestamp', format(startDate, 'yyyy-MM-dd'))
        .lte('timestamp', format(endDate, 'yyyy-MM-dd'));
      
      if (countError) throw countError;
      
      // Then delete
      const { error } = await supabase
        .from('time_records')
        .delete()
        .gte('timestamp', format(startDate, 'yyyy-MM-dd'))
        .lte('timestamp', format(endDate, 'yyyy-MM-dd'));
      
      if (error) throw error;
      
      return {
        success: true,
        message: `Deleted ${count} records for ${format(startDate, 'MMMM yyyy')}`,
        count: count || 0
      };
    } else {
      // Get count first
      const { count, error: countError } = await supabase
        .from('time_records')
        .select('*', { count: 'exact', head: true });
      
      if (countError) throw countError;
      
      // Then delete all
      const { error } = await supabase
        .from('time_records')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy condition to delete all
      
      if (error) throw error;
      
      return {
        success: true,
        message: `Deleted all ${count} time records`,
        count: count || 0
      };
    }
  } catch (error) {
    console.error('Error deleting time records:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      count: 0
    };
  }
};