import { supabase } from '../lib/supabase';
import { format, parseISO, startOfMonth, endOfMonth, addDays, isValid, subDays, isFriday } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';
import toast from 'react-hot-toast';
import { parseShiftTimes } from '../utils/dateTimeHelper';
import { isDoubleTimeDay, getDoubleTimeDays } from '../services/holidayService';

// Fetch approved hours summary
export const fetchApprovedHours = async (dateFilter: string = ''): Promise<{
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
    
    // Apply date filter if provided
    if (dateFilter) {
      if (dateFilter.includes('|')) {
        // Custom date range: startDate|endDate
        const [startDate, endDate] = dateFilter.split('|');
        
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          // Fix: Use AND filtering instead of OR filtering
          query = query
            .gte('working_week_start', startDate)
            .lte('working_week_start', endDate);
        }
      } else {
        // Month filter: YYYY-MM
        try {
          const [year, month] = dateFilter.split('-');
          if (year && month) {
            const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            if (isValid(monthDate)) {
              const startDate = startOfMonth(monthDate);
              const endDate = endOfMonth(monthDate);
              
              if (isValid(startDate) && isValid(endDate)) {
                const startStr = format(startDate, 'yyyy-MM-dd');
                const endStr = format(endDate, 'yyyy-MM-dd');
                
                // Fix: Use AND filtering instead of OR filtering
                query = query
                  .gte('working_week_start', startStr)
                  .lte('working_week_start', endStr);
              }
            }
          }
        } catch (err) {
          console.error('Error parsing month filter:', err);
        }
      }
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
          total_hours: 0,
          working_week_dates: new Set(), // Track all working week dates for double-time calculations
          hours_by_date: {} // Track hours by date for double-time calculations
        });
      }
      
      const employee = employeeSummary.get(employeeId);
      employee.total_hours += hours;
      
      // Add date to set of days - Only if timestamp is valid
      if (record.timestamp && isValid(new Date(record.timestamp))) {
        // Use working_week_start if available, otherwise use timestamp date
        if (record.working_week_start) {
          employee.total_days.add(record.working_week_start);
          employee.working_week_dates.add(record.working_week_start);
          
          // Store hours by date
          if (!employee.hours_by_date[record.working_week_start]) {
            employee.hours_by_date[record.working_week_start] = hours;
          } else {
            employee.hours_by_date[record.working_week_start] += hours;
          }
        } else {
          // Use the UTC date portion so nothing shifts under local timezones
          const utc = parseISO(record.timestamp);
          const date = utc.toISOString().slice(0,10); // "YYYY-MM-DD"
          employee.total_days.add(date);
          employee.working_week_dates.add(date);
          
          // Store hours by date
          if (!employee.hours_by_date[date]) {
            employee.hours_by_date[date] = hours;
          } else {
            employee.hours_by_date[date] += hours;
          }
        }
      }
    });
    
    // Add OFF-DAY records separately
    let offDayQuery = supabase
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
    
    // Apply the same date filter to off-day records
    if (dateFilter) {
      if (dateFilter.includes('|')) {
        // Custom date range: startDate|endDate
        const [startDate, endDate] = dateFilter.split('|');
        
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          // Fix: Use AND filtering instead of OR filtering
          offDayQuery = offDayQuery
            .gte('working_week_start', startDate)
            .lte('working_week_start', endDate);
        }
      } else {
        // Month filter: YYYY-MM
        try {
          const [year, month] = dateFilter.split('-');
          if (year && month) {
            const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            if (isValid(monthDate)) {
              const startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
              const endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
              
              // Fix: Use AND filtering instead of OR filtering
              offDayQuery = offDayQuery
                .gte('working_week_start', startDate)
                .lte('working_week_start', endDate);
            }
          }
        } catch (err) {
          console.error('Error parsing month filter for off days:', err);
        }
      }
    }
    
    const { data: offDayData, error: offDayError } = await offDayQuery;
    
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
          total_hours: 0,
          working_week_dates: new Set(),
          hours_by_date: {}
        });
      }
      
      const employee = employeeSummary.get(employeeId);
      
      // Add date to set of days for OFF-DAY
      if (record.working_week_start) {
        employee.total_days.add(record.working_week_start);
        employee.working_week_dates.add(record.working_week_start);
      } else if (record.timestamp && isValid(new Date(record.timestamp))) {
        // Use the UTC date portion so nothing shifts under local timezones
        const utc = parseISO(record.timestamp);
        const date = utc.toISOString().slice(0,10); // "YYYY-MM-DD"
        employee.total_days.add(date);
        employee.working_week_dates.add(date);
      }
    });
    
    // Calculate double-time hours for each employee
    let startDate, endDate;
    
    if (dateFilter) {
      if (dateFilter.includes('|')) {
        // Custom date range
        [startDate, endDate] = dateFilter.split('|');
      } else {
        // Month filter
        try {
          const [year, month] = dateFilter.split('-');
          if (year && month) {
            const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            if (isValid(monthDate)) {
              startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
              endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
            } else {
              // Default to recent month if dates are invalid
              startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
              endDate = format(new Date(), 'yyyy-MM-dd');
            }
          }
        } catch (err) {
          console.error('Error parsing month filter:', err);
          startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
          endDate = format(new Date(), 'yyyy-MM-dd');
        }
      }
    } else {
      // Default to last 365 days
      startDate = format(subDays(new Date(), 365), 'yyyy-MM-dd');
      endDate = format(addDays(new Date(), 30), 'yyyy-MM-dd');
    }
    
    // Get all double-time days in the date range
    const doubleDays = await getDoubleTimeDays(startDate, endDate);
    
    // Convert to array and calculate days and double-time hours
    const result = Array.from(employeeSummary.values()).map(emp => {
      // Calculate double-time hours
      let doubleTimeHours = 0;
      const workingDates = Array.from(emp.working_week_dates);
      
      workingDates.forEach(date => {
        if (doubleDays.includes(date)) {
          const dateHours = emp.hours_by_date[date] || 0;
          doubleTimeHours += dateHours;
        }
      });
      
      return {
        ...emp,
        total_days: emp.total_days.size,
        total_hours: parseFloat(emp.total_hours.toFixed(2)),
        double_time_hours: parseFloat(doubleTimeHours.toFixed(2)),
        working_week_dates: Array.from(emp.working_week_dates)
      };
    });
    
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
export const fetchEmployeeDetails = async (employeeId: string, dateFilter: string = ''): Promise<{
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
        is_manual_entry,
        employees (
          name,
          employee_number
        )
      `)
      .eq('employee_id', employeeId)
      .order('timestamp', { ascending: true });
    
    // Apply date filter if provided
    if (dateFilter) {
      if (dateFilter.includes('|')) {
        // Custom date range: startDate|endDate
        const [startDate, endDate] = dateFilter.split('|');
        
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          // Fix: Use AND filtering instead of OR filtering
          query = query
            .gte('working_week_start', startDate)
            .lte('working_week_start', endDate);
        }
      } else {
        // Month filter: YYYY-MM
        try {
          const [year, month] = dateFilter.split('-');
          if (year && month) {
            const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            if (isValid(monthDate)) {
              const startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
              const endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
              
              // Fix: Use AND filtering instead of OR filtering
              query = query
                .gte('working_week_start', startDate)
                .lte('working_week_start', endDate);
            }
          }
        } catch (err) {
          console.error('Error parsing month filter:', err);
        }
      }
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    return { data: data || [] };
  } catch (error) {
    console.error('Error fetching employee details:', error);
    throw error;
  }
};

// Check if a time record exists before inserting
export const checkExistingTimeRecord = async (
  employeeId: string, 
  shiftType: string, 
  status: string, 
  workingWeekStart: string
): Promise<string | null> => {
  try {
    // Log the search parameters for debugging
    console.log('Checking for existing record with:', {
      employeeId,
      shiftType,
      status,
      workingWeekStart,
      is_manual_entry: true
    });

    const { data, error } = await supabase
      .from('time_records')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('shift_type', shiftType)
      .eq('status', status) // IMPORTANT: Filter by status to prevent mix-ups
      .eq('working_week_start', workingWeekStart)
      .eq('is_manual_entry', true)
      .maybeSingle();

    if (error) throw error;
    
    if (data) {
      console.log('Found existing record with ID:', data.id);
    } else {
      console.log('No existing record found');
    }
    
    return data ? data.id : null;
  } catch (error) {
    console.error('Error checking existing time record:', error);
    return null;
  }
};

// Safely insert or update time record
export const safeUpsertTimeRecord = async (recordData: any, existingId: string | null = null): Promise<boolean> => {
  try {
    // If we have an existing ID, update the record
    if (existingId) {
      console.log('Updating existing record with ID:', existingId);
      const { error } = await supabase
        .from('time_records')
        .update(recordData)
        .eq('id', existingId);
        
      if (error) throw error;
      return true;
    } 
    
    // Otherwise try to insert, but be prepared to handle conflict
    try {
      console.log('Attempting to insert new record');
      const { error } = await supabase
        .from('time_records')
        .insert([recordData]);
        
      if (error) {
        // If we get a conflict error (409), try to find the record again and update it
        if (error.code === '23505' || (error.message && error.message.includes('duplicate key value'))) {
          console.log('Duplicate key detected, attempting to find and update record');
          
          // Try to find the record based on the unique constraint
          const existingRecord = await checkExistingTimeRecord(
            recordData.employee_id,
            recordData.shift_type,
            recordData.status,
            recordData.working_week_start
          );
          
          if (existingRecord) {
            console.log('Found conflicting record, updating instead:', existingRecord);
            const { error: updateError } = await supabase
              .from('time_records')
              .update(recordData)
              .eq('id', existingRecord);
              
            if (updateError) throw updateError;
            return true;
          } else {
            throw new Error('Could not find conflicting record for update');
          }
        } else {
          throw error;
        }
      }
      return true;
    } catch (insertError) {
      console.error('Error during insert/update operation:', insertError);
      throw insertError;
    }
  } catch (error) {
    console.error('Error in safeUpsertTimeRecord:', error);
    return false;
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
  
  // Get double-time days for the date range
  const allDates: string[] = [];
  employeeRecords.forEach(employee => {
    employee.days.filter(day => day.approved).forEach(day => {
      allDates.push(day.date);
    });
  });
  
  // Sort and get min/max dates
  allDates.sort();
  const startDate = allDates[0] || format(new Date(), 'yyyy-MM-dd');
  const endDate = allDates[allDates.length - 1] || format(new Date(), 'yyyy-MM-dd');
  
  // Get all double-time days in this date range
  const doubleDays = await getDoubleTimeDays(startDate, endDate);
  console.log('Double-time days in range:', doubleDays);
  
  // Process each employee's approved days
  for (const employee of employeeRecords) {
    const approvedDays = employee.days.filter(day => day.approved);
    
    for (const day of approvedDays) {
      try {
        // Skip if this is an OFF-DAY with no hours
        if (day.notes === 'OFF-DAY' && day.hoursWorked === 0) {
          // Check if OFF-DAY record already exists
          const existingOffDayId = await checkExistingTimeRecord(
            await getEmployeeId(employee.employeeNumber),
            'off_day',
            'off_day',
            day.date
          );

          const offDayData = {
            employee_id: await getEmployeeId(employee.employeeNumber),
            timestamp: `${day.date}T12:00:00`, // Use local date-time string
            status: 'off_day',
            shift_type: 'off_day',
            notes: 'OFF-DAY',
            is_manual_entry: false, // Mark as non-manual entry since it's from Excel
            exact_hours: 0,
            working_week_start: day.date // Set working_week_start for proper grouping
          };

          // Use the safe upsert function
          const success = await safeUpsertTimeRecord(offDayData, existingOffDayId);
          
          if (success) {
            successCount++;
          } else {
            throw new Error('Failed to save OFF-DAY record');
          }
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
        
        // Check if this is a double-time day
        const isDoubleTime = doubleDays.includes(day.date);
        
        // Add check-in record if available
        if (day.firstCheckIn) {
          // Store original check-in time as display value
          const checkInDisplayTime = format(day.firstCheckIn, 'HH:mm');

          // Use date-fns format directly with the Date object
          const checkInTimestamp = format(day.firstCheckIn, "yyyy-MM-dd'T'HH:mm:ss");
          
          // Check if check-in record already exists
          const existingCheckInId = await checkExistingTimeRecord(
            employeeId,
            day.shiftType || '',
            'check_in',
            day.date
          );
          
          // Add double-time indicator to notes if applicable
          let notes = day.notes ? `${day.notes}; hours:${day.hoursWorked.toFixed(2)}` : `hours:${day.hoursWorked.toFixed(2)}`;
          if (isDoubleTime) {
            notes = `${notes}; double-time:true`;
          }

          const checkInData = {
            employee_id: employeeId,
            timestamp: checkInTimestamp,
            status: 'check_in',
            shift_type: day.shiftType,
            is_late: day.isLate,
            early_leave: false,
            deduction_minutes: day.penaltyMinutes,
            notes: notes,
            exact_hours: day.hoursWorked,
            display_check_in: checkInDisplayTime, // Store the actual time for display
            display_check_out: day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing',
            is_fixed: day.correctedRecords || false,
            corrected_records: day.correctedRecords || false,
            mislabeled: false,
            is_manual_entry: false, // Mark as non-manual entry since it's from Excel
            working_week_start: day.date
          };

          // Use the safe upsert function
          const success = await safeUpsertTimeRecord(checkInData, existingCheckInId);
          
          if (!success) {
            throw new Error('Failed to save check-in record');
          }
        }
        
        // Add check-out record if available
        if (day.lastCheckOut) {
          // Store original check-out time as display value
          const checkOutDisplayTime = format(day.lastCheckOut, 'HH:mm');
          
          // Use date-fns format directly with the Date object
          const checkOutTimestamp = format(day.lastCheckOut, "yyyy-MM-dd'T'HH:mm:ss");
          
          // Check if check-out record already exists
          const existingCheckOutId = await checkExistingTimeRecord(
            employeeId,
            day.shiftType || '',
            'check_out',
            day.date
          );
          
          // Add double-time indicator to notes if applicable
          let notes = day.notes ? `${day.notes}; hours:${day.hoursWorked.toFixed(2)}` : `hours:${day.hoursWorked.toFixed(2)}`;
          if (isDoubleTime) {
            notes = `${notes}; double-time:true`;
          }

          const checkOutData = {
            employee_id: employeeId,
            timestamp: checkOutTimestamp,
            status: 'check_out',
            shift_type: day.shiftType,
            is_late: false,
            early_leave: day.earlyLeave,
            deduction_minutes: day.penaltyMinutes,
            notes: notes,
            exact_hours: day.hoursWorked,
            display_check_in: day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
            display_check_out: checkOutDisplayTime, // Store the actual time for display
            is_fixed: day.correctedRecords || false,
            corrected_records: day.correctedRecords || false,
            mislabeled: false,
            is_manual_entry: false, // Mark as non-manual entry since it's from Excel
            working_week_start: day.date
          };

          // Use the safe upsert function
          const success = await safeUpsertTimeRecord(checkOutData, existingCheckOutId);
          
          if (!success) {
            throw new Error('Failed to save check-out record');
          }
        }
        
        successCount++;
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
export const deleteAllTimeRecords = async (dateFilter: string = '', employeeFilter: string = '', preserveApproved: boolean = false): Promise<{
  success: boolean;
  message: string;
  count: number;
}> => {
  try {
    // Initialize query with a default WHERE clause to satisfy Supabase's requirement
    // This prevents DELETE without WHERE clause errors
    let query = supabase
      .from('time_records')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Always true, provides a baseline WHERE clause
    
    let hasSpecificFilter = false;
    
    // Apply date filter if provided
    if (dateFilter) {
      hasSpecificFilter = true;
      if (dateFilter.includes('|')) {
        // Custom date range: startDate|endDate
        const [startDate, endDate] = dateFilter.split('|');
        
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          // Fix: Use AND filtering instead of OR filtering
          query = query
            .gte('working_week_start', startDate)
            .lte('working_week_start', endDate);
        } else {
          throw new Error('Invalid date range specified');
        }
      } else {
        // Month filter: YYYY-MM
        try {
          const [year, month] = dateFilter.split('-');
          if (year && month) {
            const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            if (isValid(monthDate)) {
              const startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
              const endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
              
              // Fix: Use AND filtering instead of OR filtering
              query = query
                .gte('working_week_start', startDate)
                .lte('working_week_start', endDate);
            }
          }
        } catch (err) {
          console.error('Error parsing month filter:', err);
          throw new Error('Invalid month format');
        }
      }
    }
    
    // Apply employee filter if provided
    if (employeeFilter) {
      hasSpecificFilter = true;
      if (employeeFilter.includes(',')) {
        // Multiple employees - make sure to use in() filter
        const employeeIds = employeeFilter.split(',').filter(id => id.trim() !== '');
        
        if (employeeIds.length > 0) {
          // Only apply the filter if we have valid IDs
          query = query.in('employee_id', employeeIds);
          console.log('Filtering by employee IDs:', employeeIds);
        } else {
          console.log('No valid employee IDs to filter by');
        }
      } else if (employeeFilter.trim() !== '') {
        // Single employee
        query = query.eq('employee_id', employeeFilter);
        console.log('Filtering by employee ID:', employeeFilter);
      }
    }
    
    // If preserveApproved is true, only delete non-approved records
    if (preserveApproved) {
      hasSpecificFilter = true;
      // We need to get all approved record IDs and exclude them
      const { data: approvedRecords, error: approvedError } = await supabase
        .from('time_records')
        .select('id')
        .ilike('notes', '%approved%');
        
      if (approvedError) throw approvedError;
      
      if (approvedRecords && approvedRecords.length > 0) {
        // Extract IDs
        const approvedIds = approvedRecords.map(record => record.id);
        
        // Exclude these IDs from deletion
        query = query.not('id', 'in', approvedIds);
      }
    }
    
    // For safety, if no specific filters are applied (just our base filter),
    // require an extra confirmation or default to a safer date range
    if (!hasSpecificFilter) {
      // Default to last 90 days if no other filters provided
      // This prevents accidental deletion of all records
      const ninetyDaysAgo = format(subDays(new Date(), 90), 'yyyy-MM-dd');
      query = query.lt('created_at', ninetyDaysAgo);
      console.log('No specific filters applied. Limiting deletion to records older than 90 days.');
    }
    
    // Get count before deleting
    const countQuery = supabase
      .from('time_records')
      .select('*', { count: 'exact', head: true })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Always true, provides a baseline WHERE clause
      
    // Apply the same filters to the count query
    if (dateFilter) {
      if (dateFilter.includes('|')) {
        const [startDate, endDate] = dateFilter.split('|');
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          countQuery.gte('working_week_start', startDate).lte('working_week_start', endDate);
        }
      } else {
        try {
          const [year, month] = dateFilter.split('-');
          if (year && month) {
            const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            if (isValid(monthDate)) {
              const startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
              const endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
              countQuery.gte('working_week_start', startDate).lte('working_week_start', endDate);
            }
          }
        } catch (err) {
          console.error('Error parsing month filter for count:', err);
        }
      }
    }
    
    if (employeeFilter) {
      if (employeeFilter.includes(',')) {
        const employeeIds = employeeFilter.split(',').filter(id => id.trim() !== '');
        if (employeeIds.length > 0) {
          countQuery.in('employee_id', employeeIds);
        }
      } else if (employeeFilter.trim() !== '') {
        countQuery.eq('employee_id', employeeFilter);
      }
    }
    
    if (preserveApproved) {
      const { data: approvedRecords, error: approvedError } = await supabase
        .from('time_records')
        .select('id')
        .ilike('notes', '%approved%');
        
      if (approvedError) throw approvedError;
      
      if (approvedRecords && approvedRecords.length > 0) {
        countQuery.not('id', 'in', approvedRecords.map(record => record.id));
      }
    }
    
    if (!hasSpecificFilter) {
      const ninetyDaysAgo = format(subDays(new Date(), 90), 'yyyy-MM-dd');
      countQuery.lt('created_at', ninetyDaysAgo);
    }
    
    const { count, error: countError } = await countQuery;
    
    if (countError) throw countError;
    
    console.log(`About to delete ${count} records with filters:`, {
      dateFilter,
      employeeFilter,
      preserveApproved,
      hasSpecificFilter
    });
    
    // Execute the delete
    const { error } = await query;
    
    if (error) throw error;
    
    return {
      success: true,
      message: `Deleted ${count} records`,
      count: count || 0
    };
  } catch (error) {
    console.error('Error deleting time records:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
      count: 0
    };
  }
};

// Reset all database data
export const resetAllDatabaseData = async (): Promise<{
  success: boolean;
  message: string;
}> => {
  try {
    // Delete from all related tables EXCEPT approved records
    
    // First, delete time_records but preserve approved records
    const { success: timeRecordsDeleted, count: timeRecordsCount, message: timeRecordsMessage } = 
      await deleteAllTimeRecords('', '', true); // Pass true to preserve approved records
    
    if (!timeRecordsDeleted) {
      return {
        success: false,
        message: `Failed to delete time records: ${timeRecordsMessage}`
      };
    }
    
    // Delete processed_excel_files (this will cascade to processed_employee_data and processed_daily_records)
    const { data: filesDeleted, error: filesError } = await supabase
      .from('processed_excel_files')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
    if (filesError) {
      return {
        success: false,
        message: `Failed to delete processed files: ${filesError.message}`
      };
    }
    
    // Delete employee_shifts
    const { data: shiftsDeleted, error: shiftsError } = await supabase
      .from('employee_shifts')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
    if (shiftsError) {
      return {
        success: false,
        message: `Failed to delete employee shifts: ${shiftsError.message}`
      };
    }
    
    // Delete employee_shift_patterns
    const { data: patternsDeleted, error: patternsError } = await supabase
      .from('employee_shift_patterns')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
    
    if (patternsError) {
      return {
        success: false,
        message: `Failed to delete shift patterns: ${patternsError.message}`
      };
    }
    
    return {
      success: true,
      message: `Reset complete. Deleted ${timeRecordsCount} non-approved time records.`
    };
  } catch (error) {
    console.error('Error resetting database:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error during reset'
    };
  }
};