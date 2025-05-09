import { supabase } from '../lib/supabase';
import { format, parseISO, differenceInMinutes, differenceInHours, addDays, getDay, getMonth, parseJSON, isAfter, isBefore } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';
import toast from 'react-hot-toast';
import { addOffDaysToRecords, formatTimeWith24Hour } from '../utils/dateTimeHelper';

// Save approved records to the database
export const saveRecordsToDatabase = async (employeeRecords: EmployeeRecord[]) => {
  let successCount = 0;
  let errorCount = 0;
  const errorDetails: {employeeName: string, date: string, error: string}[] = [];
  
  try {
    // Process each employee's records
    for (const employeeRecord of employeeRecords) {
      console.log(`Processing records for ${employeeRecord.name}`);
      
      // First, check if this employee exists in the database
      const { data, error } = await supabase
        .from('employees')
        .select('id, name')
        .eq('employee_number', employeeRecord.employeeNumber)
        .maybeSingle();
      
      if (error) {
        console.error("Error checking employee:", error);
        throw error;
      }
      
      // If employee doesn't exist, create them
      let employeeId;
      if (!data) {
        console.log(`Employee ${employeeRecord.name} does not exist. Creating...`);
        const { data: newEmployee, error: createError } = await supabase
          .from('employees')
          .insert({
            name: employeeRecord.name,
            employee_number: employeeRecord.employeeNumber
          })
          .select();
        
        if (createError) {
          console.error("Error creating employee:", createError);
          throw createError;
        }
        
        if (!newEmployee || newEmployee.length === 0) {
          const errMsg = `Failed to create employee: No ID returned for ${employeeRecord.name}`;
          console.error(errMsg);
          throw new Error(errMsg);
        }
        
        employeeId = newEmployee[0]?.id;
        
        if (!employeeId) {
          const errMsg = `Could not get employee ID for newly created employee ${employeeRecord.name}`;
          console.error(errMsg);
          throw new Error(errMsg);
        }
      } else {
        employeeId = data.id;
      }
      
      if (!employeeId) {
        throw new Error(`Could not get employee ID for ${employeeRecord.name}`);
      }
      
      console.log(`Using employee ID: ${employeeId}`);
      
      // Process only approved days
      const approvedDays = employeeRecord.days.filter(day => day.approved);
      
      console.log(`Processing ${approvedDays.length} approved days`);
      
      // Process each day
      for (const day of approvedDays) {
        let daySuccess = true;
        
        try {
          // Check if this day is an OFF-DAY
          if (day.notes === 'OFF-DAY') {
            console.log(`Processing OFF-DAY for ${employeeRecord.name} on ${day.date}`);
            
            // Clear any existing records for this date
            const { error: deleteError } = await supabase
              .from('time_records')
              .delete()
              .eq('employee_id', employeeId)
              .gte('timestamp', `${day.date}T00:00:00`)
              .lt('timestamp', `${day.date}T23:59:59.999`);
            
            if (deleteError) {
              console.error(`Error deleting existing records for ${day.date}:`, deleteError);
            }
            
            // Combine all notes into one field
            const combinedNotes = day.notes === 'Manual entry' 
              ? 'Manual entry OFF-DAY'
              : day.notes;
            
            // Add an OFF-DAY record
            const { error: offDayError } = await supabase
              .from('time_records')
              .insert({
                employee_id: employeeId,
                timestamp: `${day.date}T12:00:00.000Z`,
                status: 'off_day',
                shift_type: 'off_day',
                notes: combinedNotes,
                is_manual_entry: day.notes === 'Manual entry' || day.notes.includes('Employee submitted'),
                display_check_in: 'OFF-DAY',
                display_check_out: 'OFF-DAY'
              });
            
            if (offDayError) {
              console.error(`Error saving OFF-DAY record for ${day.date}:`, offDayError);
              daySuccess = false;
              errorCount++;
              errorDetails.push({
                employeeName: employeeRecord.name,
                date: day.date,
                error: offDayError.message || 'Error saving OFF-DAY record'
              });
            } else {
              successCount++;
            }
            
            continue; // Skip to the next day
          }
          
          // Check if this day has missing check-in or check-out
          const hasMissingTime = day.missingCheckIn || day.missingCheckOut;
          
          // Calculate hours worked with any penalties applied
          let actualHours = day.hoursWorked;
          
          // Format display values
          const combinedNotes = day.notes === 'Manual entry' 
            ? `Manual entry; hours:${actualHours.toFixed(2)}`
            : day.notes.includes('Employee submitted') 
            ? `${day.notes}; hours:${actualHours.toFixed(2)}`
            : day.notes ? `${day.notes}; hours:${actualHours.toFixed(2)}` : `hours:${actualHours.toFixed(2)}`;
          
          console.log(`Saving day ${day.date} with ${actualHours.toFixed(2)} hours, shift type: ${day.shiftType}`);
          
          // First, check if we already have records for this employee on this date
          const { data: existingRecords, error: existingError } = await supabase
            .from('time_records')
            .select('id')
            .eq('employee_id', employeeId)
            .gte('timestamp', `${day.date}T00:00:00`)
            .lt('timestamp', `${day.date}T23:59:59.999`);
          
          if (existingError) {
            console.error(`Error checking existing records for ${day.date}:`, existingError);
          }
          
          // If records exist, delete them
          if (existingRecords && existingRecords.length > 0) {
            console.log(`Found ${existingRecords.length} existing records for ${day.date}. Deleting...`);
            
            const { error: deleteError } = await supabase
              .from('time_records')
              .delete()
              .in('id', existingRecords.map(r => r.id));
            
            if (deleteError) {
              console.error(`Error deleting existing records for ${day.date}:`, deleteError);
              daySuccess = false;
              errorCount++;
              errorDetails.push({
                employeeName: employeeRecord.name,
                date: day.date,
                error: deleteError.message || 'Error deleting existing records'
              });
              continue; // Skip to the next day
            }
          }
          
          // For night shift checkout early next day, check if there are records for the next day
          if (day.shiftType === 'night' && day.lastCheckOut) {
            const checkOutDate = format(day.lastCheckOut, 'yyyy-MM-dd');
            // If checkout is a different date (next day), delete those records too
            if (checkOutDate !== day.date) {
              console.log(`Night shift checkout on next day: ${checkOutDate}. Checking for records to delete...`);
              
              const { data: nextDayRecords, error: nextDayError } = await supabase
                .from('time_records')
                .select('id')
                .eq('employee_id', employeeId)
                .eq('status', 'check_out')
                .gte('timestamp', `${checkOutDate}T00:00:00`)
                .lt('timestamp', `${checkOutDate}T12:00:00`); // First half of the next day
              
              if (nextDayError) {
                console.error(`Error checking next day records for ${checkOutDate}:`, nextDayError);
              } else if (nextDayRecords && nextDayRecords.length > 0) {
                console.log(`Found ${nextDayRecords.length} records for early morning checkout on ${checkOutDate}. Deleting...`);
                
                const { error: deleteNextDayError } = await supabase
                  .from('time_records')
                  .delete()
                  .in('id', nextDayRecords.map(r => r.id));
                
                if (deleteNextDayError) {
                  console.error(`Error deleting next day records for ${checkOutDate}:`, deleteNextDayError);
                }
              }
            }
          }
          
          // Save records based on what data we have
          if (day.firstCheckIn && !day.missingCheckIn) {
            // We have a check-in time
            console.log(`Saving check-in for ${day.date} at ${format(day.firstCheckIn, 'HH:mm')}`);
            
            // Preserve original shift type
            const preservedShiftType = day.shiftType;
            
            const { error: checkInError } = await supabase
              .from('time_records')
              .insert({
                employee_id: employeeId, // Use employeeId instead of employeeRecord.id
                timestamp: day.firstCheckIn.toISOString(),
                status: 'check_in',
                shift_type: preservedShiftType,
                is_late: day.isLate,
                early_leave: day.earlyLeave,
                notes: combinedNotes,
                deduction_minutes: day.penaltyMinutes, // Store penalty minutes here
                is_manual_entry: day.notes === 'Manual entry' || day.notes.includes('Employee submitted'),
                exact_hours: actualHours, // Store exact hours with penalty applied
                display_check_in: day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
                display_check_out: day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing',
                mislabeled: day.correctedRecords || false,
                original_status_value: day.correctedRecords ? 'CORRECTED' : null
              });

            if (checkInError) {
              console.error('Error inserting check-in record:', checkInError);
              daySuccess = false;
              errorCount++;
              errorDetails.push({
                employeeName: employeeRecord.name,
                date: day.date,
                error: checkInError.message || 'Error saving check-in record'
              });
              continue; // Skip to the next day
            }
          }
          
          if (day.lastCheckOut && !day.missingCheckOut) {
            // We have a check-out time
            console.log(`Saving check-out for ${day.date} at ${format(day.lastCheckOut, 'HH:mm')}`);
            
            // Preserve original shift type
            const preservedShiftType = day.shiftType;
            
            const { error: checkOutError } = await supabase
              .from('time_records')
              .insert({
                employee_id: employeeId, // Use employeeId instead of employeeRecord.id
                timestamp: day.lastCheckOut.toISOString(),
                status: 'check_out',
                shift_type: preservedShiftType,
                is_late: day.isLate,                 
                deduction_minutes: day.penaltyMinutes, 
                early_leave: day.earlyLeave,
                notes: combinedNotes,
                is_manual_entry: day.notes === 'Manual entry' || day.notes.includes('Employee submitted'),
                exact_hours: actualHours, // Store exact hours with penalty applied 
                display_check_in: day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
                display_check_out: format(day.lastCheckOut, 'HH:mm'),
                mislabeled: day.correctedRecords || false,
                original_status_value: day.correctedRecords ? 'CORRECTED' : null
              });

            if (checkOutError) {
              console.error('Error inserting check-out record:', checkOutError);
              daySuccess = false;
              errorCount++;
              errorDetails.push({
                employeeName: employeeRecord.name,
                date: day.date,
                error: checkOutError.message || 'Error saving check-out record'
              });
              continue; // Skip to the next day
            }
          }
          
          // If we got here, day was processed successfully
          if (daySuccess) {
            successCount++;
          }
        } catch (error) {
          console.error(`Unexpected error processing day ${day.date} for ${employeeRecord.name}:`, error);
          errorCount++;
          errorDetails.push({
            employeeName: employeeRecord.name,
            date: day.date,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }
    
    console.log(`Successfully processed ${successCount} days with ${errorCount} errors`);
    return { successCount, errorCount, errorDetails };
  } catch (error) {
    console.error("Error in saveRecordsToDatabase:", error);
    throw error;
  }
};

// Fetch manual time entries
export const fetchManualTimeRecords = async (limit = 50) => {
  try {
    const { data, error } = await supabase
      .from('time_records')
      .select(`
        id,
        employee_id,
        timestamp,
        status,
        shift_type,
        notes,
        is_late,
        early_leave,
        exact_hours,
        display_time,
        display_check_in,
        display_check_out,
        employees (
          id,
          name,
          employee_number
        )
      `)
      .eq('is_manual_entry', true)
      .order('timestamp', { ascending: false })
      .limit(limit);
      
    if (error) {
      throw error;
    }
    
    return data || [];
  } catch (error) {
    console.error("Error fetching manual time records:", error);
    throw error;
  }
};

// Fetch pending employee shift requests
export const fetchPendingEmployeeShifts = async () => {
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
        employees (
          id,
          name,
          employee_number
        )
      `)
      .eq('status', 'pending')
      .order('date', { ascending: false });
      
    if (error) {
      throw error;
    }
    
    return data || [];
  } catch (error) {
    console.error("Error fetching pending employee shifts:", error);
    throw error;
  }
};

// Delete all approved time records
export const deleteAllTimeRecords = async (monthStr = '') => {
  try {
    let query = supabase.from('time_records').delete();
    
    if (monthStr) {
      // Parse month string format 'yyyy-MM'
      const [year, month] = monthStr.split('-').map(Number);
      
      if (!year || !month) {
        throw new Error('Invalid month format. Expected yyyy-MM');
      }
      
      // Create start and end dates for the month
      const startDate = new Date(year, month - 1, 1); // Month is 0-based in JavaScript
      const endDate = new Date(year, month, 0); // Last day of the month
      
      // Format dates for query
      const startDateStr = format(startDate, 'yyyy-MM-dd');
      const endDateStr = format(endDate, 'yyyy-MM-dd');
    
      query = query
        .gte('timestamp', `${startDateStr}T00:00:00.000Z`)
        .lte('timestamp', `${endDateStr}T23:59:59.999Z`);
        
      console.log(`Date range for deletion: ${startDateStr} to ${endDateStr}`);
    } else {
      console.log('Deleting ALL time records (no date filter)');
    }
    
    const result = await query.select('count');
    
    if (result.error) {
      throw result.error;
    }
    
    console.log(`Deleted ${result.count} time records`);
    
    return {
      success: true,
      message: `Successfully deleted ${result.count} time records`,
      count: result.count || 0
    };
  } catch (error) {
    console.error("Error deleting time records:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      count: 0
    };
  }
};

// Fetch approved hours summary
export const fetchApprovedHours = async (monthStr = '') => {
  try {
    const currentDate = new Date();
    let startDate: Date;
    let endDate: Date;
    
    if (monthStr) {
      // Parse month string format 'yyyy-MM'
      const [year, month] = monthStr.split('-').map(Number);
      
      if (!year || !month) {
        throw new Error('Invalid month format. Expected yyyy-MM');
      }
      
      startDate = new Date(year, month - 1, 1); // Month is 0-based in JavaScript
      endDate = new Date(year, month, 0); // Last day of the month
    } else {
      // Default to all time (with a reasonable lower bound)
      startDate = new Date(2000, 0, 1); // January 1, 2000
      endDate = currentDate;
    }
    
    // Format dates for query
    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');
    
    console.log(`Date range: ${startDateStr} to ${endDateStr}`);
    
    // First, get all employees with time records in the date range
    const { data: employeeData, error: employeeError } = await supabase
      .from('employees')
      .select(`
        id,
        name,
        employee_number,
        time_records!inner(timestamp)
      `)
      .gte('time_records.timestamp', `${startDateStr}T00:00:00.000Z`)
      .lte('time_records.timestamp', `${endDateStr}T23:59:59.999Z`);
      
    if (employeeError) {
      throw employeeError;
    }
    
    console.log(`Found ${employeeData?.length} employees with time records`);
    
    // Get distinct employees
    const distinctEmployeeMap = new Map();
    employeeData?.forEach(e => {
      distinctEmployeeMap.set(e.id, {
        id: e.id,
        name: e.name,
        employee_number: e.employee_number
      });
    });
    
    const distinctEmployees = Array.from(distinctEmployeeMap.values());
    
    console.log(`Processing ${distinctEmployees.length} distinct employees`);
    
    // Calculate summary data for each employee
    const summaryPromises = distinctEmployees.map(async (employee) => {
      // Get all time records for this employee
      const { data: timeRecords, error: timeRecordsError } = await supabase
        .from('time_records')
        .select('*')
        .eq('employee_id', employee.id)
        .gte('timestamp', `${startDateStr}T00:00:00.000Z`)
        .lte('timestamp', `${endDateStr}T23:59:59.999Z`)
        .order('timestamp', { ascending: true });
        
      if (timeRecordsError) {
        throw timeRecordsError;
      }
      
      console.log(`Employee ${employee.name}: ${timeRecords?.length} time records`);
      
      // Group records by date
      const recordsByDate = (timeRecords || []).reduce((acc: Record<string, any[]>, record: any) => {
        let date = format(new Date(record.timestamp), 'yyyy-MM-dd');
        
        // For evening shifts with early morning checkout, associate with previous day
        if (record.status === 'check_out' && 
            record.shift_type === 'evening' && 
            new Date(record.timestamp).getHours() < 12) {
          // This is likely an evening shift checkout on the next day
          // Calculate the previous day to group it correctly
          const prevDate = new Date(record.timestamp);
          prevDate.setDate(prevDate.getDate() - 1);
          date = format(prevDate, 'yyyy-MM-dd');
        }
        
        // For night shift check-outs early in the morning, associate with previous day's check-in
        if (record.status === 'check_out' && 
            record.shift_type === 'night' && 
            new Date(record.timestamp).getHours() < 12) {
          // Calculate the previous day to group it correctly
          const prevDate = new Date(record.timestamp);
          prevDate.setDate(prevDate.getDate() - 1);
          date = format(prevDate, 'yyyy-MM-dd');
        }

        if (!acc[date]) {
          acc[date] = [];
        }
        
        acc[date].push({
          ...record,
          date
        });
        
        return acc;
      }, {});
      
      // Calculate hours for each day
      let totalHours = 0;
      let totalDays = 0;
      const dailyHours: Record<string, number> = {};
      
      // Process each date's records
      Object.entries(recordsByDate).forEach(([date, records]) => {
        // Skip dates outside our range (can happen with night shifts)
        const recordDate = new Date(date);
        if (recordDate < startDate || recordDate > endDate) {
          return;
        }
        
        // Skip OFF-DAYs from hours calculation
        if (records.some(r => r.status === 'off_day')) {
          dailyHours[date] = 0;
          totalDays++;
          return;
        }
        
        // Get check-in and check-out records
        const checkIn = records.find(r => r.status === 'check_in');
        const checkOut = records.find(r => r.status === 'check_out');
        
        // Determine hours worked
        let hoursForDay = 0;
        
        // If we have explicit exact_hours field, use that
        if ((checkIn && typeof checkIn.exact_hours === 'number') || 
            (checkOut && typeof checkOut.exact_hours === 'number')) {
          
          hoursForDay = typeof checkIn?.exact_hours === 'number' 
            ? parseFloat(checkIn.exact_hours.toFixed(2))
            : parseFloat((checkOut?.exact_hours || 0).toFixed(2));
        } 
        // Try parsing from notes field
        else if ((checkIn?.notes && checkIn.notes.includes('hours:')) || 
                 (checkOut?.notes && checkOut.notes.includes('hours:'))) {
          
          const pattern = /hours:(\d+\.\d+)/;
          const hoursMatch = (checkIn?.notes || checkOut?.notes || '').match(pattern);
          
          if (hoursMatch && hoursMatch[1]) {
            hoursForDay = parseFloat(hoursMatch[1]);
            if (isNaN(hoursForDay)) hoursForDay = 0;
          }
        }
        // Calculate based on timestamps if both exist
        else if (checkIn && checkOut) {
          // Get hour difference with proper wraparound for night shifts
          const checkInTime = new Date(checkIn.timestamp);
          const checkOutTime = new Date(checkOut.timestamp);
          
          // If checkout is earlier than checkin, it likely means checkout was next day
          if (checkOutTime < checkInTime) {
            // Adjust checkout time to next day
            const adjustedCheckOut = new Date(checkOutTime);
            adjustedCheckOut.setDate(adjustedCheckOut.getDate() + 1);
            
            // Calculate hours
            const diffMinutes = differenceInMinutes(adjustedCheckOut, checkInTime);
            hoursForDay = diffMinutes / 60;
          } else {
            // Normal same-day calculation
            const diffMinutes = differenceInMinutes(checkOutTime, checkInTime);
            hoursForDay = diffMinutes / 60;
          }
          
          // Apply deduction if any
          if (checkIn.deduction_minutes) {
            hoursForDay = Math.max(0, hoursForDay - (checkIn.deduction_minutes / 60));
          }
          
          // Round to 2 decimal places
          hoursForDay = parseFloat(hoursForDay.toFixed(2));
        }
        
        // Set daily hour and update totals
        dailyHours[date] = hoursForDay;
        totalHours += hoursForDay;
        totalDays++;
      });
      
      // Round total hours to 2 decimal places for consistency
      totalHours = parseFloat(totalHours.toFixed(2));
      
      return {
        id: employee.id,
        name: employee.name,
        employee_number: employee.employee_number,
        total_days: totalDays,
        total_hours: totalHours,
        daily_records: dailyHours // Keep track of daily breakdown for debugging if needed
      };
    });
    
    const employeeSummary = await Promise.all(summaryPromises);
    
    // Sort employees by name
    employeeSummary.sort((a, b) => a.name.localeCompare(b.name));
    
    // Calculate overall total hours (sum and round to 2 decimal places)
    const totalHoursSum = parseFloat(employeeSummary.reduce((sum, emp) => sum + emp.total_hours, 0).toFixed(2));
    
    console.log(`Total summary: ${employeeSummary.length} employees, ${totalHoursSum} hours`);
    
    return { data: employeeSummary, totalHoursSum };
  } catch (error) {
    console.error('Error fetching approved hours:', error);
    throw error;
  }
};

// Helper function to group records by date and employee
const groupRecordsByDateAndEmployee = (records: any[]) => {
  return records.reduce((acc: Record<string, Record<string, any[]>>, record: any) => {
    const date = format(new Date(record.timestamp), 'yyyy-MM-dd');
    const employeeId = record.employee_id;
    
    if (!acc[date]) {
      acc[date] = {};
    }
    
    if (!acc[date][employeeId]) {
      acc[date][employeeId] = [];
    }
    
    acc[date][employeeId].push(record);
    return acc;
  }, {});
};

// Fetch detailed records for an employee
export const fetchEmployeeDetails = async (employeeId: string, monthStr = '') => {
  try {
    const currentDate = new Date();
    let startDate: Date;
    let endDate: Date;
    
    if (monthStr) {
      // Parse month string format 'yyyy-MM'
      const [year, month] = monthStr.split('-').map(Number);
      
      if (!year || !month) {
        throw new Error('Invalid month format. Expected yyyy-MM');
      }
      
      startDate = new Date(year, month - 1, 1); // Month is 0-based in JavaScript
      endDate = new Date(year, month, 0); // Last day of the month
    } else {
      // Default to all time (with a reasonable lower bound)
      startDate = new Date(2000, 0, 1); // January 1, 2000
      endDate = currentDate;
    }
    
    // Format dates for query
    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');
    
    console.log(`Date range: ${startDateStr} to ${endDateStr}`);
    
    // Get all time records for this employee in the date range
    const { data, error } = await supabase
      .from('time_records')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('timestamp', `${startDateStr}T00:00:00.000Z`)
      .lte('timestamp', `${endDateStr}T23:59:59.999Z`)
      .order('timestamp', { ascending: true });
      
    if (error) {
      throw error;
    }
    
    console.log(`Found ${data?.length} time records for employee`);
    
    // Group records by date
    const recordsByDate = (data || []).reduce((acc: Record<string, any[]>, record: any) => {
      let date = format(new Date(record.timestamp), 'yyyy-MM-dd');
      
      // Special handling for OFF-DAY records
      if (record.status === 'off_day') {
        if (!acc[date]) {
          acc[date] = [];
        }
        
        acc[date].push(record);
        return acc;
      }
      
      // For regular evening shifts, group on timestamp date
      if (record.shift_type === 'evening') {
        // Special case: early morning check-out for evening shift
        if (record.status === 'check_out') {
          const hour = new Date(record.timestamp).getHours();
          if (hour < 12) {
            // Early morning checkout (next day) - associate with previous day's evening check-in
            const prevDate = new Date(record.timestamp);
            prevDate.setDate(prevDate.getDate() - 1);
            date = format(prevDate, 'yyyy-MM-dd');
          }
        }
      }
      // For night shift check-outs early in the morning, associate with previous day's check-in
      else if (record.status === 'check_out' && 
          record.shift_type === 'night' && 
          new Date(record.timestamp).getHours() < 12) {
        // Calculate the previous day
        const prevDate = new Date(record.timestamp);
        prevDate.setDate(prevDate.getDate() - 1);
        date = format(prevDate, 'yyyy-MM-dd');
      }
      // FIX: Ensure morning shift records are properly grouped by date
      else if (record.shift_type === 'morning' && record.status === 'check_out') {
        // Morning shift check-out at the end of the day - keep on the same day
        const hour = new Date(record.timestamp).getHours();
        if (hour >= 12 && hour <= 14) {
          // This is a normal morning shift checkout (12-2 PM)
          // Just use the record's date without modification
        }
      }
      
      if (!acc[date]) {
        acc[date] = [];
      }
      
      acc[date].push(record);
      return acc;
    }, {});
    
    // Process each date to extract check-in and check-out
    const processedRecords: any[] = [];
    const processedDates = new Set<string>();
    
    // Helper functions for specific dates
    const getFormattedCheckInDisplay = (record: any) => {
      if (!record) return null;
      
      if (record.display_check_in) {
        return record.display_check_in;
      }
      
      return format(new Date(record.timestamp), 'HH:mm');
    };
    
    const getFormattedCheckOutDisplay = (record: any) => {
      if (!record) return null;
      
      if (record.display_check_out) {
        return record.display_check_out;
      }
      
      return format(new Date(record.timestamp), 'HH:mm');
    };
    
    // First pass for night shifts that span days
    const dates = Object.keys(recordsByDate).sort();
    
    for (let i = 0; i < dates.length - 1; i++) {
      const currentDate = dates[i];
      const nextDate = dates[i + 1];
      
      // Skip if either date is already processed
      if (processedDates.has(currentDate) || processedDates.has(nextDate)) continue;
      
      const currentDateRecords = recordsByDate[currentDate] || [];
      const nextDateRecords = recordsByDate[nextDate] || [];
      
      // Check if current date has any night shift records
      const nightShiftCurrentDay = currentDateRecords.some(r => r.shift_type === 'night');
      
      // Check if any records on the next date are early morning hours
      const earlyMorningNextDay = nextDateRecords.some(r => {
        const hour = new Date(r.timestamp).getHours(); 
        return hour < 12;
      });
      
      if (nightShiftCurrentDay && earlyMorningNextDay) {
        console.log(`Detected possible night shift spanning ${currentDate} to ${nextDate}`);
        
        // Find check-in on current date
        const checkInsCurrentDay = currentDateRecords.filter(r => r.status === 'check_in' && r.shift_type === 'night');
        
        if (checkInsCurrentDay.length > 0) {
          // Sort by timestamp
          const sortedCheckIns = checkInsCurrentDay.sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
          
          // Find check-out on next date
          const checkOutsNextDay = nextDateRecords.filter(r => {
            return r.status === 'check_out' && 
                   new Date(r.timestamp).getHours() < 12 &&
                   r.shift_type === 'night';
          });
          
          if (checkOutsNextDay.length > 0) {
            // Sort by timestamp
            const sortedCheckOuts = checkOutsNextDay.sort(
              (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
            
            // Add check-in and check-out to processed records
            // Use current date as the display date
            const checkInRecord = sortedCheckIns[0];
            const checkOutRecord = sortedCheckOuts[0];
            
            // Add both records with the same date for display
            processedRecords.push({
              ...checkInRecord,
              display_date: currentDate
            });
            
            processedRecords.push({
              ...checkOutRecord,
              display_date: currentDate
            });
            
            // Mark both dates as processed
            processedDates.add(currentDate);
            // Don't fully process next date - just mark these specific records
            sortedCheckOuts.forEach(r => {
              r.processed = true;
            });
          }
        }
      }
    }
    
    // Second pass for remaining dates
    for (const date in recordsByDate) {
      const dateRecords = recordsByDate[date].filter(r => !r.processed);
      
      // If no unprocessed records, skip
      if (dateRecords.length === 0) continue;
      
      // Skip dates already completely processed
      if (processedDates.has(date)) continue;
      
      // Check if this is an OFF-DAY
      if (dateRecords.some(r => r.status === 'off_day')) {
        // Add OFF-DAY record
        const offDayRecord = dateRecords.find(r => r.status === 'off_day');
        
        processedRecords.push({
          ...offDayRecord,
          display_date: date
        });
        
        processedDates.add(date);
        continue;
      }
      
      // Add all records for this date
      dateRecords.forEach(record => {
        processedRecords.push({
          ...record,
          display_date: date
        });
      });
    }
    
    // Sort by timestamp and date
    processedRecords.sort((a, b) => {
      // First by date
      if (a.display_date !== b.display_date) {
        return a.display_date.localeCompare(b.display_date);
      }
      
      // Then by timestamp
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
    
    return { data: processedRecords };
  } catch (error) {
    console.error('Error fetching employee details:', error);
    throw error;
  }
};

export const fetchManualTimeRecordsCount = async () => {
  try {
    const { count, error } = await supabase
      .from('time_records')
      .select('*', { count: 'exact', head: true })
      .eq('is_manual_entry', true);
      
    if (error) {
      throw error;
    }
    
    return count || 0;
  } catch (error) {
    console.error("Error counting manual time records:", error);
    return 0;
  }
};