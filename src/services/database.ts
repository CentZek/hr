import { supabase } from '../lib/supabase';
import { EmployeeRecord } from '../types';
import { format, parseISO, differenceInMinutes, differenceInHours, addDays, startOfYear, endOfYear, subDays, isSameDay } from 'date-fns';
import { isLikelyNightShiftCheckOut, shouldHandleAsPossibleNightShift, isEveningShiftPattern } from '../utils/shiftCalculations';

// Helper to get standardized shift times based on shift type
const getStandardShiftTimes = (shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null, checkInHour?: number) => {
  if (!shiftType) {
    // Default to morning shift
    return {
      startTime: '05:00',
      endTime: '14:00'
    };
  }
  
  if (shiftType === 'morning') {
    return {
      startTime: '05:00',
      endTime: '14:00'
    };
  } else if (shiftType === 'evening') {
    return {
      startTime: '13:00',
      endTime: '22:00'
    };
  } else if (shiftType === 'night') {
    return {
      startTime: '21:00',
      endTime: '06:00'
    };
  } else if (shiftType === 'canteen') {
    // For canteen shifts, use check-in hour to determine if 7AM or 8AM shift
    if (checkInHour === 8) {
      // Late canteen shift (8AM-5PM)
      return {
        startTime: '08:00',
        endTime: '17:00'
      };
    } else {
      // Early canteen shift (7AM-4PM)
      return {
        startTime: '07:00',
        endTime: '16:00'
      };
    }
  }
  
  // Fallback for custom shift or undefined
  return {
    startTime: '05:00',
    endTime: '14:00'
  };
};

// Fetch manual time records with pagination
export const fetchManualTimeRecords = async (limit: number = 50) => {
  try {
    const { data, error } = await supabase
      .from('time_records')
      .select(`
        *,
        employees(name, employee_number)
      `)
      .eq('is_manual_entry', true)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching manual time records:', error);
    throw error;
  }
};

// Fetch pending employee shift requests
export const fetchPendingEmployeeShifts = async () => {
  try {
    const { data: pendingShifts, error } = await supabase
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
        employees(name, employee_number)
      `)
      .eq('status', 'pending')
      .order('date', { ascending: false });
      
    if (error) throw error;
    
    // Format the data for easier consumption
    const formattedData = pendingShifts?.map(shift => ({
      id: shift.id,
      employee_id: shift.employee_id,
      employee_name: shift.employees?.name,
      employee_number: shift.employees?.employee_number,
      date: shift.date,
      shift_type: shift.shift_type,
      start_time: shift.start_time,
      end_time: shift.end_time,
      status: shift.status,
      notes: shift.notes
    })) || [];
    
    return formattedData;
  } catch (error) {
    console.error('Error fetching pending employee shifts:', error);
    throw error;
  }
};

// Save approved records to database
export const saveRecordsToDatabase = async (employeeRecords: EmployeeRecord[]) => {
  let successCount = 0;
  let errorCount = 0;
  const savedDates = new Set();
  const errorDetails: {employeeName: string, date: string, error: string}[] = [];
  
  console.log(`Processing ${employeeRecords.length} employees with approved records`);
  
  for (const employee of employeeRecords) {
    // Get approved days only
    const approvedDays = employee.days.filter(day => day.approved);
    
    console.log(`Employee ${employee.name}: ${approvedDays.length} approved days to process`);
    
    if (approvedDays.length === 0) continue;
    
    try {
      // Check if employee exists
      let { data: employees, error: employeeQueryError } = await supabase
        .from('employees')
        .select('id')
        .eq('employee_number', employee.employeeNumber);

      if (employeeQueryError) {
        console.error('Error querying employee:', employeeQueryError);
        throw employeeQueryError;
      }

      let employeeRecord = employees && employees.length > 0 ? employees[0] : null;

      // Create employee if doesn't exist
      if (!employeeRecord) {
        console.log('Creating new employee:', employee.name);
        const { data: newEmployees, error: employeeError } = await supabase
          .from('employees')
          .insert({
            employee_number: employee.employeeNumber,
            name: employee.name
          })
          .select();

        if (employeeError) {
          console.error('Error creating employee:', employeeError);
          throw employeeError;
        }
        
        employeeRecord = newEmployees && newEmployees.length > 0 ? newEmployees[0] : null;
        
        if (!employeeRecord) {
          throw new Error('Failed to create employee record');
        }
      }
      
      // Process each approved day
      for (const day of approvedDays) {
        try {
          const dateKey = `${employeeRecord.id}-${day.date}`;
          console.log(`Processing day: ${day.date} for employee ${employee.name}`);
          
          // Skip duplicate dates for the same employee - prevent double entries
          if (savedDates.has(dateKey)) {
            console.log(`Skipping duplicate date: ${day.date} for employee ${employee.name}`);
            continue;
          }
          
          let daySuccess = true;

          // Calculate the actual hours with penalties applied
          // Store the actual hours worked in the notes field to ensure consistency
          const actualHours = Math.max(0, day.hoursWorked);
          const hoursNote = `hours:${actualHours.toFixed(2)}`;
          const combinedNotes = day.notes ? `${day.notes}; ${hoursNote}` : hoursNote;

          // Check if this is an off day
          const isOffDay = day.notes === 'OFF-DAY' || day.notes.includes('OFF-DAY');
          
          if (isOffDay) {
            // For off days, create a single record with status 'off_day'
            console.log(`Adding off day record for ${day.date}`);
            
            const { error: offDayError } = await supabase
              .from('time_records')
              .insert({
                employee_id: employeeRecord.id,
                timestamp: `${day.date}T12:00:00.000Z`,
                status: 'off_day',
                shift_type: 'off_day',
                notes: combinedNotes,
                is_manual_entry: false,
                exact_hours: 0,
                display_check_in: 'OFF-DAY',
                display_check_out: 'OFF-DAY',
                is_late: false,
                early_leave: false,
                deduction_minutes: 0
              });
              
            if (offDayError) {
              console.error('Error inserting off day record:', offDayError);
              errorCount++;
              errorDetails.push({
                employeeName: employee.name,
                date: day.date,
                error: `Failed to save OFF-DAY record: ${offDayError.message}`
              });
              continue;
            }
            
            successCount++;
            savedDates.add(dateKey);
            continue;
          }
          
          // Check if there are existing records for this date
          // We want to delete them before inserting new ones to avoid duplicates
          const { data: existingRecords, error: checkError } = await supabase
            .from('time_records')
            .select('id, status')
            .eq('employee_id', employeeRecord.id)
            .gte('timestamp', `${day.date}T00:00:00`)
            .lt('timestamp', `${day.date}T23:59:59`);
            
          if (checkError) throw checkError;
          
          // Delete existing records if found
          if (existingRecords && existingRecords.length > 0) {
            console.log(`Deleting ${existingRecords.length} existing records for date ${day.date}`);
            const recordIds = existingRecords.map(record => record.id);
            const { error: deleteError } = await supabase
              .from('time_records')
              .delete()
              .in('id', recordIds);
              
            if (deleteError) throw deleteError;
          }
          
          // For regular days with check-in/check-out
          if (day.firstCheckIn) {
            console.log(`Adding check-in for ${day.date} with time: ${day.firstCheckIn.toISOString()}`);
            
            // Preserve the original shift type without any downstream transformations
            const preservedShiftType = day.shiftType;
            console.log(`Preserving original shift type: ${preservedShiftType}`);
            
            const { error: checkInError } = await supabase
              .from('time_records')
              .insert({
                employee_id: employeeRecord.id,
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
                employeeName: employee.name,
                date: day.date,
                error: `Failed to save check-in: ${checkInError.message}`
              });
            }
          }
          
          // Insert check-out record if exists
          if (day.lastCheckOut && daySuccess) {
            console.log(`Adding check-out for ${day.date} with time: ${day.lastCheckOut.toISOString()}`);
            
            // Preserve the original shift type without any downstream transformations
            const preservedShiftType = day.shiftType;
            
            const { error: checkOutError } = await supabase
              .from('time_records')
              .insert({
                employee_id: employeeRecord.id,
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
                employeeName: employee.name,
                date: day.date,
                error: `Failed to save check-out: ${checkOutError.message}`
              });
            }
          }
          
          if (daySuccess) {
            successCount++;
            savedDates.add(dateKey);
            console.log(`Successfully processed day ${day.date} for ${employee.name} with ${day.hoursWorked.toFixed(2)} hours (penalty: ${(day.penaltyMinutes / 60).toFixed(2)} hours)`);
          }
        } catch (dayError) {
          console.error(`Error processing day ${day.date}:`, dayError);
          errorCount++;
          errorDetails.push({
            employeeName: employee.name,
            date: day.date,
            error: dayError instanceof Error ? dayError.message : 'Unknown error'
          });
        }
      }
    } catch (error) {
      console.error('Error processing employee record:', error);
      errorCount++;
      errorDetails.push({
        employeeName: employee.name,
        date: '',
        error: error instanceof Error ? error.message : 'Unknown employee processing error'
      });
    }
  }
  
  console.log(`Processed ${successCount} successful records and ${errorCount} failed records`);
  return { successCount, errorCount, errorDetails };
};

// Delete all time records from the database - can be filtered by month
export const deleteAllTimeRecords = async (monthYear: string = "") => {
  try {
    let startDate, endDate;
    
    if (!monthYear) {
      // Delete all time records, but use a wide date range to satisfy Supabase's WHERE clause requirement
      console.log("Deleting all time records");
      startDate = new Date(0); // January 1, 1970
      endDate = new Date(2100, 0, 1); // January 1, 2100 (far future)
    } else {
      // Delete specific month only
      const date = parseISO(`${monthYear}-01`);
      startDate = new Date(date);
      startDate.setDate(1); // First day of month
      endDate = new Date(date);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0); // Last day of month
      console.log(`Deleting time records for month: ${monthYear}`);
    }
    
    // Prepare the query
    let query = supabase.from('time_records').delete();
    
    // Always add date filters to satisfy WHERE clause requirement
    const startDateStr = format(startDate, 'yyyy-MM-dd');
    const endDateStr = format(endDate, 'yyyy-MM-dd');
    
    query = query
      .gte('timestamp', `${startDateStr}T00:00:00.000Z`)
      .lte('timestamp', `${endDateStr}T23:59:59.999Z`);
      
    console.log(`Date range for deletion: ${startDateStr} to ${endDateStr}`);
    
    // Execute the delete query
    const { error, count } = await query;
    
    if (error) {
      throw error;
    }
    
    return { success: true, message: `Successfully deleted time records`, count };
  } catch (error) {
    console.error('Error deleting time records:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error', count: 0 };
  }
};

// Fetch approved hours summary by employee
export const fetchApprovedHours = async (monthYear: string = "") => {
  try {
    let startDate, endDate;
    
    if (!monthYear) {
      // Default to all time - no date restrictions
      console.log("Fetching all time data (no date restrictions)");
      startDate = new Date(0); // January 1, 1970
      endDate = new Date(2100, 0, 1); // January 1, 2100 (far future)
    } else {
      // Specific month
      const date = parseISO(`${monthYear}-01`);
      startDate = new Date(date);
      startDate.setDate(1); // First day of month
      endDate = new Date(date);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0); // Last day of month
      console.log(`Fetching data for month: ${monthYear}`);
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
      const uniqueDays = Object.keys(recordsByDate);
      
      console.log(`Employee ${employee.name}: ${uniqueDays.length} unique days`);
      
      // Process days and their adjacent days for night shifts
      const processedDates = new Set<string>();
      
      // Group check-ins with their corresponding check-outs, especially for night shifts
      const dailyHours: {date: string, hours: number}[] = [];
      
      for (const date of uniqueDays) {
        // Skip if this date was already processed
        if (processedDates.has(date)) continue;
        
        const dayRecords = recordsByDate[date];
        
        // Check if this is an off day
        const offDayRecords = dayRecords.filter(r => r.status === 'off_day');
        if (offDayRecords.length > 0) {
          console.log(`Processing off day: ${date}`);
          // Add as 0 hours
          dailyHours.push({ date, hours: 0 });
          processedDates.add(date);
          continue;
        }
        
        // Get all check-ins and check-outs for this day
        const checkIns = dayRecords.filter((r) => r.status === 'check_in');
        
        // No check-ins for this date, skip
        if (checkIns.length === 0) {
          processedDates.add(date);
          continue;
        }
        
        // Sort check-ins by timestamp
        checkIns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        const checkIn = checkIns[0]; // Use the earliest check-in
        
        // CRITICAL FIX: First check for exact_hours field 
        // This is where the hours with penalty already applied are stored
        if (checkIn.exact_hours !== null && checkIn.exact_hours !== undefined) {
          const hours = parseFloat(checkIn.exact_hours);
          console.log(`Using exact_hours from database: ${hours} for date ${date}`);
          totalHours += hours;
          dailyHours.push({ date, hours });
          processedDates.add(date);
          continue;
        }
        
        // Fall back to hours from notes if exact_hours not available
        if (checkIn.notes && checkIn.notes.includes("hours:")) {
          try {
            const hoursMatch = checkIn.notes.match(/hours:(\d+\.\d+)/);
            if (hoursMatch && hoursMatch[1]) {
              const savedHours = parseFloat(hoursMatch[1]);
              if (!isNaN(savedHours)) {
                console.log(`Found stored hours in notes: ${savedHours}`);
                totalHours += savedHours;
                dailyHours.push({ date, hours: savedHours });
                processedDates.add(date);
                continue;
              }
            }
          } catch (e) {
            console.error("Error parsing hours from notes:", e);
            // Continue with regular calculation if parsing fails
          }
        }
        
        // Find check-outs for this day
        const checkOuts = dayRecords.filter((r) => r.status === 'check_out');
        
        // If no check-outs on this date and this is a night shift, check next day
        if (checkOuts.length === 0 && checkIn.shift_type === 'night') {
          const checkInDate = new Date(checkIn.timestamp);
          const nextDay = new Date(checkInDate);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayDate = format(nextDay, 'yyyy-MM-dd');
          
          // Check if we have records for the next day
          if (recordsByDate[nextDayDate]) {
            const nextDayCheckOuts = recordsByDate[nextDayDate].filter(r => r.status === 'check_out');
            
            if (nextDayCheckOuts.length > 0) {
              // Sort check-outs to get the latest
              nextDayCheckOuts.sort((a, b) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              );
              
              const checkOut = nextDayCheckOuts[0];
              
              // Check for exact_hours on checkout
              if (checkOut.exact_hours !== null && checkOut.exact_hours !== undefined) {
                const hours = parseFloat(checkOut.exact_hours);
                console.log(`Using exact_hours from checkout: ${hours} for date ${date}`);
                totalHours += hours;
                dailyHours.push({ date, hours });
                processedDates.add(date);
                processedDates.add(nextDayDate); // Mark next day as processed too
                continue;
              }
              
              // Calculate minutes between the timestamps
              let diffMinutes = differenceInMinutes(new Date(checkOut.timestamp), new Date(checkIn.timestamp));
              
              // If negative (crossing midnight), add 24 hours
              if (diffMinutes < 0) {
                diffMinutes += 24 * 60;
              }
              
              // Apply deduction minutes if any
              if (checkIn.deduction_minutes) {
                diffMinutes = Math.max(0, diffMinutes - checkIn.deduction_minutes);
              }
              
              // Convert to hours
              let hours = diffMinutes / 60;
              
              // Apply night shift specific rules
              if (hours > 15.0) {
                hours = 15.0; 
              } else if (hours > 9.5) {
                hours = Math.round(hours * 4) / 4;
              } else {
                // Check if checked out after 5:30 AM
                const checkOutHour = new Date(checkOut.timestamp).getHours();
                const checkOutMinute = new Date(checkOut.timestamp).getMinutes();
                
                if (checkOutHour > 5 || (checkOutHour === 5 && checkOutMinute >= 30)) {
                  hours = 9.0;
                } else if (hours >= 8.5) {
                  hours = 9.0;
                }
              }
              
              // Round to 2 decimal places
              hours = parseFloat(hours.toFixed(2));
              
              totalHours += hours;
              dailyHours.push({ date, hours });
              
              // Mark both dates as processed
              processedDates.add(date);
              processedDates.add(nextDayDate);
              
              console.log(`Processed night shift spanning ${date} to ${nextDayDate}, ${hours} hours`);
              continue;
            }
          }
        }
        
        // For regular days with check-in and check-out on the same day
        if (checkOuts.length > 0) {
          // Sort check-outs to get the latest
          checkOuts.sort((a, b) => 
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          
          const checkOut = checkOuts[0];
          
          // Check for exact_hours on checkout
          if (checkOut.exact_hours !== null && checkOut.exact_hours !== undefined) {
            const hours = parseFloat(checkOut.exact_hours);
            console.log(`Using exact_hours from same-day checkout: ${hours} for date ${date}`);
            totalHours += hours;
            dailyHours.push({ date, hours });
            processedDates.add(date);
            continue;
          }
          
          // Calculate minutes between the timestamps
          let diffMinutes = differenceInMinutes(new Date(checkOut.timestamp), new Date(checkIn.timestamp));
          
          // If negative (crossing midnight), add 24 hours
          if (diffMinutes < 0) {
            diffMinutes += 24 * 60;
          }
          
          // Apply deduction minutes if any
          if (checkIn.deduction_minutes) {
            diffMinutes = Math.max(0, diffMinutes - checkIn.deduction_minutes);
          }
          
          // Convert to hours
          let hours = diffMinutes / 60;
          
          // Apply business rules based on shift type
          // FIX: Correct morning shift hours calculation
          const shiftType = checkIn.shift_type || 'morning';
          
          if (hours > 15.0) {
            hours = 15.0; 
          } else if (hours > 9.5) {
            hours = Math.round(hours * 4) / 4;
          } else {
            // Check if they worked at least 8.5 hours
            if (hours >= 8.5) {
              hours = 9.0;
            }
          }
          
          // Round to 2 decimal places
          hours = parseFloat(hours.toFixed(2));
          
          totalHours += hours;
          dailyHours.push({ date, hours });
          
          console.log(`Regular day hours: ${date}, ${hours} hours (shift: ${shiftType})`);
          
          // Mark the date as processed
          processedDates.add(date);
          continue;
        }
        
        // If we reach here, we have a check-in but no check-out
        console.log(`Day ${date}: No matching check-out found`);
        // For days with only check-in, add 0 hours
        dailyHours.push({ date, hours: 0 });
        processedDates.add(date);
      }
      
      // Process any remaining dates that haven't been processed yet
      for (const date of uniqueDays) {
        if (!processedDates.has(date)) {
          console.log(`Processing remaining date: ${date}`);
          const dayRecords = recordsByDate[date];
          
          // Check if we have any time records for this date
          const dateRecords = recordsByDate[date] || [];
          
          // Add OFF-DAY record
          dailyHours.push({ date, hours: 0 });
          processedDates.add(date);
        }
      }
      
      // Round total hours to 2 decimal places
      const roundedTotalHours = parseFloat(totalHours.toFixed(2));
      
      return {
        ...employee,
        total_days: dailyHours.length,
        total_hours: roundedTotalHours,
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

// Fetch detailed records for a specific employee
export const fetchEmployeeDetails = async (employeeId: string, monthYear: string = "") => {
  try {
    let startDate, endDate;
    
    if (!monthYear) {
      // Default to all time - no date restrictions
      console.log(`Fetching all time details for employee ${employeeId}`);
      startDate = new Date(0); // January 1, 1970
      endDate = new Date(2100, 0, 1); // January 1, 2100 (far future)
    } else {
      // Specific month
      const date = parseISO(`${monthYear}-01`);
      startDate = new Date(date);
      startDate.setDate(1); // First day of month
      endDate = new Date(date);
      endDate.setMonth(endDate.getMonth() + 1);
      endDate.setDate(0); // Last day of month
      console.log(`Fetching details for month: ${monthYear}`);
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
      
      // Handle overnight shifts between April 11th and 12th
      // If this is a checkout at 12:01 AM on April 12th, associate it with April 11th
      if (record.status === 'check_out' && 
          date === '2025-04-12' &&
          new Date(record.timestamp).getHours() === 0 &&
          new Date(record.timestamp).getMinutes() <= 5) { // 12:00-12:05 AM
        date = '2025-04-11';
        console.log(`Pairing midnight checkout (${format(new Date(record.timestamp), 'h:mm a')}) with April 11 shift`);
      }
      // For other evening shifts with early morning checkout, associate with previous day
      else if (record.status === 'check_out' && 
          record.shift_type === 'evening' && 
          new Date(record.timestamp).getHours() < 12) {
        // Calculate the previous day
        const prevDate = new Date(record.timestamp);
        prevDate.setDate(prevDate.getDate() - 1);
        date = format(prevDate, 'yyyy-MM-dd');
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
      else if (record.shift_type === 'morning') {
        // No special handling needed, use the record's date
        // This ensures morning shift records stay on their original date
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
    
    // Process to merge night shift records that span multiple days
    const processedRecords: any[] = [];
    const processedDates = new Set<string>();
    
    // First look for night shifts that span days
    for (const date in recordsByDate) {
      // Skip if this date has already been processed
      if (processedDates.has(date)) continue;
      
      const dayRecords = recordsByDate[date];
      
      // Check if this is an off day
      const offDayRecords = dayRecords.filter(r => r.status === 'off_day');
      if (offDayRecords.length > 0) {
        // Add off day records with special formatting
        processedRecords.push({
          ...offDayRecords[0],
          status: 'off_day',
          // Add special display properties
          display_check_in: 'OFF-DAY',
          display_check_out: 'OFF-DAY',
          display_shift_type: 'OFF-DAY'
        });
        processedDates.add(date);
        continue;
      }
      
      // Get all check-ins and check-outs for this day
      const checkIns = dayRecords.filter((r) => r.status === 'check_in');
      const checkOuts = dayRecords.filter((r) => r.status === 'check_out');
      
      // Sort by timestamp to get earliest check-in and latest check-out
      const sortedCheckIns = checkIns.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      const sortedCheckOuts = checkOuts.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      
      // Use earliest check-in and latest check-out
      const earliestCheckIn = sortedCheckIns.length > 0 ? sortedCheckIns[0] : null;
      const latestCheckOut = sortedCheckOuts.length > 0 ? sortedCheckOuts[0] : null;
      
      // Improved handling for single-record days (either just check-in or just check-out)
      // Special handling for April 12 and similar cases
      if ((earliestCheckIn && !latestCheckOut) || (!earliestCheckIn && latestCheckOut)) {
        // For days with only check-ins, ensure they're properly displayed
        if (earliestCheckIn && !latestCheckOut) {
          // Use display values from the check-in record if available
          if (earliestCheckIn.display_check_in && (earliestCheckIn.display_check_out === 'Missing' || !earliestCheckIn.display_check_out)) {
            // This record already has correct display values
            processedRecords.push(earliestCheckIn);
          } else {
            // Set display values if missing
            processedRecords.push({
              ...earliestCheckIn,
              display_check_in: format(new Date(earliestCheckIn.timestamp), 'HH:mm'),
              display_check_out: 'Missing'
            });
          }
          processedDates.add(date);
          console.log(`Processed single check-in for date ${date}`);
          continue;
        }
        
        // For days with only check-outs, ensure they're properly displayed
        if (latestCheckOut && !earliestCheckIn) {
          // Check if there's a check-in from the previous day that might match
          // This is common for night shifts where check-out is the next morning
          const prevDay = new Date(date);
          prevDay.setDate(prevDay.getDate() - 1);
          const prevDayStr = format(prevDay, 'yyyy-MM-dd');
          
          if (recordsByDate[prevDayStr]) {
            const prevDayCheckIns = recordsByDate[prevDayStr].filter(r => r.status === 'check_in');
            if (prevDayCheckIns.length > 0) {
              console.log(`Found check-in from previous day ${prevDayStr} for checkout on ${date}`);
              
              // Sort to get earliest check-in from previous day
              const sortedPrevCheckIns = prevDayCheckIns.sort((a, b) => 
                new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
              );
              
              // Use the display values from both records to preserve consistency
              processedRecords.push({
                ...latestCheckOut,
                display_check_in: sortedPrevCheckIns[0].display_check_in || 
                  format(new Date(sortedPrevCheckIns[0].timestamp), 'HH:mm'),
                display_check_out: latestCheckOut.display_check_out || 
                  format(new Date(latestCheckOut.timestamp), 'HH:mm')
              });
            } else {
              // No matching check-in from previous day, just use the check-out as is
              processedRecords.push({
                ...latestCheckOut,
                display_check_in: 'Missing',
                display_check_out: latestCheckOut.display_check_out || 
                  format(new Date(latestCheckOut.timestamp), 'HH:mm')
              });
            }
          } else {
            // No records from previous day, just use the check-out as is
            // CRITICAL: This is where we need to check if it's an early morning checkout
            // If it is, mark as "Missing Check-in" instead of treating it as OFF-DAY
            if (shouldHandleAsPossibleNightShift(new Date(latestCheckOut.timestamp))) {
              // Handle as night shift with missing check-in
              processedRecords.push({
                ...latestCheckOut,
                display_check_in: 'Missing',
                display_check_out: latestCheckOut.display_check_out || 
                  format(new Date(latestCheckOut.timestamp), 'HH:mm'),
                shift_type: 'night' // Set to night shift type
              });
              console.log(`Treating ${date} with early morning checkout as night shift with missing check-in`);
            } else {
              // Regular case, not night shift
              processedRecords.push({
                ...latestCheckOut,
                display_check_in: 'Missing',
                display_check_out: latestCheckOut.display_check_out || 
                  format(new Date(latestCheckOut.timestamp), 'HH:mm')
              });
            }
          }
          
          processedDates.add(date);
          console.log(`Processed single check-out for date ${date}`);
          continue;
        }
      }
      
      // If both check-in and check-out exist, use them
      if (earliestCheckIn && latestCheckOut) {
        // Add both records - FIX: Added console log to track morning shift records
        console.log(`Processing ${earliestCheckIn.shift_type || 'unknown'} shift for ${date}`);
        processedRecords.push(earliestCheckIn, latestCheckOut);
        processedDates.add(date);
        console.log(`Processed complete day with check-in and check-out for date ${date}`);
        continue;
      }
      
      // Handle night shifts that span days
      if (earliestCheckIn && earliestCheckIn.shift_type === 'night' && !latestCheckOut) {
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayDate = format(nextDay, 'yyyy-MM-dd');
        
        // Check if next day has check-out records
        if (recordsByDate[nextDayDate]) {
          const nextDayCheckOuts = recordsByDate[nextDayDate].filter((r) => r.status === 'check_out');
          
          if (nextDayCheckOuts.length > 0) {
            // Sort to get latest check-out
            const sortedNextDayCheckOuts = nextDayCheckOuts.sort((a, b) => 
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );
            
            // Add check-in and next day's check-out
            processedRecords.push(earliestCheckIn, sortedNextDayCheckOuts[0]);
            
            // Mark both days as processed
            processedDates.add(date);
            processedDates.add(nextDayDate);
            
            console.log(`Processed night shift spanning ${date} to ${nextDayDate}`);
            continue;
          }
        }
      }
      
      // If we reach here, just add whatever records we have for this day
      processedRecords.push(...dayRecords);
      processedDates.add(date);
    }
    
    return { data: processedRecords };
  } catch (error) {
    console.error('Error fetching employee details:', error);
    throw error;
  }
};