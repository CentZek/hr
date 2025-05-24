import * as XLSX from 'xlsx';
import { format, parseISO, isValid } from 'date-fns';
import { TimeRecord, EmployeeRecord, DailyRecord } from '../types';

/**
 * Export processed data to Excel
 */
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();

  // Generate summary data for all employees
  const summaryData = employeeRecords.map((employee) => {
    // Count valid days (with hours > 0)
    const validDays = employee.days.filter(d => d.hoursWorked > 0 && d.notes !== 'OFF-DAY').length;
    
    // Calculate total hours
    const totalHours = parseFloat(
      employee.days.reduce((sum, day) => sum + day.hoursWorked, 0).toFixed(2)
    );
    
    // Calculate avg hours per day
    const avgHoursPerDay = validDays > 0 
      ? parseFloat((totalHours / validDays).toFixed(2))
      : 0;
    
    return {
      'Employee': employee.name,
      'Employee Number': employee.employeeNumber,
      'Working Days': validDays,
      'Total Hours': totalHours,
      'Average Hours/Day': avgHoursPerDay
    };
  });

  // Generate detailed data for each employee
  const detailedData = employeeRecords.flatMap((employee) => 
    employee.days
      .filter(day => day.approved || day.hoursWorked > 0) // Only include approved or days with hours
      .map((day) => {
        return {
          'Employee': employee.name,
          'Employee Number': employee.employeeNumber,
          'Date': day.date,
          'Check In': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : (day.notes === 'OFF-DAY' ? 'OFF-DAY' : 'Missing'),
          'Check Out': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : (day.notes === 'OFF-DAY' ? 'OFF-DAY' : 'Missing'),
          'Shift Type': day.shiftType || (day.notes === 'OFF-DAY' ? 'OFF-DAY' : ''),
          'Hours': day.hoursWorked.toFixed(2),
          'Penalty Minutes': day.penaltyMinutes,
          'Penalty Hours': (day.penaltyMinutes / 60).toFixed(2),
          'Approved': day.approved ? 'Yes' : 'No',
          'Notes': day.notes,
          'Issues': [
            day.missingCheckIn ? 'Missing Check-In' : '',
            day.missingCheckOut ? 'Missing Check-Out' : '',
            day.isLate ? 'Late' : '',
            day.earlyLeave ? 'Early Leave' : '',
            day.excessiveOvertime ? 'Excessive Overtime' : ''
          ].filter(Boolean).join(', ')
        };
      })
  );

  // Create summary worksheet
  const summaryWS = XLSX.utils.json_to_sheet(summaryData);
  
  // Create detailed worksheet
  const detailWS = XLSX.utils.json_to_sheet(detailedData);

  // Add worksheets to workbook
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');
  XLSX.utils.book_append_sheet(wb, detailWS, 'Detailed Records');

  // Generate Excel file
  const currentDate = format(new Date(), 'yyyy-MM-dd');
  XLSX.writeFile(wb, `Employee_Time_Records_${currentDate}.xlsx`);
};

/**
 * Export approved hours data to Excel
 */
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();

  // Generate summary data for all employees
  const summaryData = data.summary.map((employee: any) => {
    // Calculate double-time hours if available
    const doubleTimeHours = employee.double_time_hours || 0;
    const regularHours = employee.total_hours || 0;
    const totalPayableHours = regularHours + doubleTimeHours;
    
    return {
      'Employee': employee.name,
      'Employee Number': employee.employee_number,
      'Working Days': employee.total_days,
      'Regular Hours': regularHours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Total Payable Hours': totalPayableHours.toFixed(2),
      'Average Hours/Day': employee.total_days > 0 
        ? (regularHours / employee.total_days).toFixed(2)
        : '0.00'
    };
  });

  // Generate detailed data for each record
  const detailedData = data.details.map((record: any) => {
    // Determine if this is a double-time day
    const isDoubleTimeDay = data.doubleDays.includes(record.working_week_start) || 
                           (record.timestamp && data.doubleDays.includes(record.timestamp.split('T')[0]));
    
    // Get hours value
    const hours = parseFloat(record.exact_hours || 0);
    const doubleTimeHours = isDoubleTimeDay ? hours : 0;
    
    return {
      'Employee': record.employees?.name || 'Unknown',
      'Employee Number': record.employees?.employee_number || 'Unknown',
      'Date': record.working_week_start || record.timestamp?.split('T')[0] || '',
      'Check In': record.status === 'check_in' ? record.display_check_in : 
                 record.display_check_in || 'Missing',
      'Check Out': record.status === 'check_out' ? record.display_check_out : 
                  record.display_check_out || 'Missing',
      'Shift Type': record.shift_type || '',
      'Status': record.status || '',
      'Regular Hours': hours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Total Payable Hours': (hours + doubleTimeHours).toFixed(2),
      'Double-Time Day': isDoubleTimeDay ? 'Yes' : 'No',
      'Notes': record.notes?.replace(/hours:\d+\.\d+;?\s*/, '') || ''
    };
  });

  // Create summary worksheet
  const summaryWS = XLSX.utils.json_to_sheet(summaryData);
  
  // Create detailed worksheet
  const detailWS = XLSX.utils.json_to_sheet(detailedData);

  // Add worksheets to workbook
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');
  XLSX.utils.book_append_sheet(wb, detailWS, 'Detailed Records');

  // Generate Excel file name based on selected filter
  let fileName = 'Approved_Hours';
  if (data.filterMonth && data.filterMonth !== 'all') {
    if (data.filterMonth === 'custom' && data.dateRange) {
      const startFormatted = data.dateRange.startDate.replace(/-/g, '');
      const endFormatted = data.dateRange.endDate.replace(/-/g, '');
      fileName += `_${startFormatted}_to_${endFormatted}`;
    } else {
      fileName += `_${data.filterMonth}`;
    }
  } else {
    fileName += `_All_Time`;
  }
  fileName += `_${format(new Date(), 'yyyy-MM-dd')}`;

  // Write the file
  XLSX.writeFile(wb, `${fileName}.xlsx`);
};

/**
 * Handle Excel file import and processing
 */
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Process the Excel data
        const records = processExcelData(workbook);
        
        resolve(records);
      } catch (error) {
        reject(new Error(`Failed to process Excel file: ${error instanceof Error ? error.message : String(error)}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Process Excel data to extract time records
 */
const processExcelData = (workbook: XLSX.WorkBook): EmployeeRecord[] => {
  // Get the first sheet
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // Convert to JSON
  const jsonData = XLSX.utils.sheet_to_json(worksheet);
  
  if (jsonData.length === 0) {
    throw new Error('No data found in Excel file');
  }
  
  // Check if it's a valid Face ID data file
  const requiredColumns = ['Department', 'Name', 'ID', 'Time', 'Status'];
  const headers = Object.keys(jsonData[0]);
  
  const missingColumns = requiredColumns.filter(col => 
    !headers.some(header => header.toLowerCase() === col.toLowerCase())
  );
  
  if (missingColumns.length > 0) {
    throw new Error(`Invalid file format. Missing columns: ${missingColumns.join(', ')}`);
  }
  
  // Process into our format
  const timeRecords: TimeRecord[] = [];
  let currentIndex = 0;
  
  jsonData.forEach((row: any) => {
    // Extract data
    const department = row.Department || '';
    const name = row.Name || '';
    const employeeNumber = row.ID?.toString() || '';
    let timestamp = row.Time || '';
    const status = row.Status || '';
    
    // Skip empty rows
    if (!name || !employeeNumber || !timestamp || !status) {
      return;
    }
    
    // Parse timestamp
    if (typeof timestamp === 'number') {
      // Excel stores dates as numbers, need to convert
      timestamp = XLSX.SSF.format('yyyy-mm-dd hh:mm:ss', timestamp);
    }
    
    // Try to parse the timestamp to a Date object
    const parsedDate = parseExcelTimestamp(timestamp);
    
    if (!parsedDate) {
      console.error(`Could not parse timestamp: ${timestamp}`);
      return;
    }
    
    // Create a time record
    timeRecords.push({
      department,
      name,
      employeeNumber,
      timestamp: parsedDate,
      status: status.toLowerCase() === 'check in' ? 'check_in' : 'check_out',
      originalIndex: currentIndex++
    });
  });
  
  // Group by employee
  const employeeRecordsMap = new Map<string, EmployeeRecord>();
  
  for (const record of timeRecords) {
    const key = `${record.employeeNumber}`;
    
    if (!employeeRecordsMap.has(key)) {
      employeeRecordsMap.set(key, {
        employeeNumber: record.employeeNumber,
        name: record.name,
        department: record.department,
        days: [],
        totalDays: 0,
        expanded: false
      });
    }
  }
  
  // Process records by employee
  for (const [key, employeeRecord] of employeeRecordsMap.entries()) {
    const employeeTimeRecords = timeRecords.filter(
      record => record.employeeNumber === employeeRecord.employeeNumber
    );
    
    // Organize by date
    const recordsByDate = organizeRecordsByDate(employeeTimeRecords);
    
    // Create daily records
    const dailyRecords = createDailyRecords(recordsByDate);
    
    // Update employee record
    employeeRecord.days = dailyRecords;
    employeeRecord.totalDays = dailyRecords.length;
  }
  
  return Array.from(employeeRecordsMap.values());
};

/**
 * Organize time records by date
 */
const organizeRecordsByDate = (records: TimeRecord[]): Map<string, TimeRecord[]> => {
  const recordsByDate = new Map<string, TimeRecord[]>();
  
  // First, check if we have a night shift worker
  const isNightShiftWorker = isLikelyNightShiftWorker(records);
  
  for (const record of records) {
    // Get date without time
    const dateString = format(record.timestamp, 'yyyy-MM-dd');
    
    // Create array if it doesn't exist
    if (!recordsByDate.has(dateString)) {
      recordsByDate.set(dateString, []);
    }
    
    // Add record to the day
    recordsByDate.get(dateString)!.push({
      ...record,
      fromPrevDay: false // Initially set to false, may update later
    });
    
    // If this is a night shift worker and an early morning check-out
    // We also want to associate it with the previous day
    if (isNightShiftWorker && record.status === 'check_out' && record.timestamp.getHours() < 8) {
      // Get previous day
      const prevDay = format(subDays(record.timestamp, 1), 'yyyy-MM-dd');
      
      // Create array if it doesn't exist
      if (!recordsByDate.has(prevDay)) {
        recordsByDate.set(prevDay, []);
      }
      
      // Add a copy of this record to previous day's records
      recordsByDate.get(prevDay)!.push({
        ...record,
        fromPrevDay: true,
        prevDayDate: prevDay
      });
    }
  }
  
  return recordsByDate;
};

/**
 * Check if records suggest a night shift worker
 */
function isLikelyNightShiftWorker(records: TimeRecord[]): boolean {
  // Look for patterns like check-ins at night and check-outs in early morning
  const nightCheckIns = records.filter(r => 
    r.status === 'check_in' && (r.timestamp.getHours() >= 20 || r.timestamp.getHours() <= 1)
  ).length;
  
  const earlyMorningCheckOuts = records.filter(r =>
    r.status === 'check_out' && r.timestamp.getHours() >= 5 && r.timestamp.getHours() <= 8
  ).length;
  
  // If we have a significant number of night check-ins or early morning check-outs
  return nightCheckIns >= 2 || earlyMorningCheckOuts >= 2;
}

/**
 * Create daily records from grouped time records
 */
const createDailyRecords = (recordsByDate: Map<string, TimeRecord[]>): DailyRecord[] => {
  const dailyRecords: DailyRecord[] = [];
  
  for (const [date, records] of recordsByDate.entries()) {
    // Skip dates with no records
    if (records.length === 0) continue;
    
    // Get all check-ins and check-outs for this day
    const checkIns = records.filter(r => r.status === 'check_in');
    const checkOuts = records.filter(r => r.status === 'check_out');
    
    // Sort by timestamp
    checkIns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    checkOuts.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Get first check-in and last check-out
    const firstCheckIn = checkIns.length > 0 ? checkIns[0].timestamp : null;
    const lastCheckOut = checkOuts.length > 0 ? checkOuts[checkOuts.length - 1].timestamp : null;
    
    // Determine shift type based on check-in time
    const shiftType = firstCheckIn ? determineShiftType(firstCheckIn) : null;
    
    // Calculate hours worked
    const hoursWorked = (firstCheckIn && lastCheckOut) ? 
      calculatePayableHours(firstCheckIn, lastCheckOut, shiftType) : 0;
    
    // Check for issues
    const missingCheckIn = checkIns.length === 0;
    const missingCheckOut = checkOuts.length === 0;
    const isLate = firstCheckIn && isLateCheckIn(firstCheckIn, shiftType);
    const earlyLeave = lastCheckOut && isEarlyLeave(lastCheckOut, shiftType);
    const excessiveOvertime = lastCheckOut && isExcessiveOvertime(lastCheckOut, shiftType);
    
    // Check for cross-day shift
    const isCrossDay = records.some(r => r.fromPrevDay) || shiftType === 'night';
    
    // Create daily record
    const dailyRecord: DailyRecord = {
      date,
      firstCheckIn,
      lastCheckOut,
      hoursWorked,
      approved: false, // Initially not approved
      shiftType,
      notes: records.some(r => r.fromPrevDay) ? 'Night shift from previous day' : '',
      missingCheckIn,
      missingCheckOut,
      isLate,
      earlyLeave,
      excessiveOvertime,
      penaltyMinutes: 0, // Initially no penalty
      allTimeRecords: records, // Store all records for reference
      hasMultipleRecords: records.length > 1,
      isCrossDay
    };
    
    dailyRecords.push(dailyRecord);
  }
  
  // Sort by date
  dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
  
  return dailyRecords;
};

/**
 * Determines the shift type based on the check-in time
 */
function determineShiftType(checkIn: Date): 'morning' | 'evening' | 'night' | 'canteen' | null {
  const hour = checkIn.getHours();
  
  // Very early morning is likely night shift
  if (hour >= 0 && hour < 5) {
    return 'night';
  }
  
  // Early morning is morning shift
  if (hour >= 5 && hour < 9) {
    // Special case for canteen workers
    if (hour === 7 || hour === 8) {
      return 'canteen';
    }
    return 'morning';
  }
  
  // Midday to afternoon is evening shift
  if (hour >= 12 && hour < 18) {
    return 'evening';
  }
  
  // Evening to night is night shift
  if (hour >= 20) {
    return 'night';
  }
  
  // Default to morning shift
  return 'morning';
}

/**
 * Checks if a check-in time is considered late based on shift type
 */
function isLateCheckIn(checkIn: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean {
  if (!shiftType) return false;
  
  const hour = checkIn.getHours();
  const minute = checkIn.getMinutes();
  
  switch (shiftType) {
    case 'morning':
      // Morning shift starts at 5:00 AM
      return hour > 5 || (hour === 5 && minute > 0);
      
    case 'evening':
      // Evening shift starts at 1:00 PM
      return hour > 13 || (hour === 13 && minute > 0);
      
    case 'night':
      // Night shift starts at 9:00 PM
      return hour > 21 || (hour === 21 && minute > 30);
      
    case 'canteen':
      // Canteen shift either starts at 7:00 AM or 8:00 AM
      if (hour === 7) {
        return minute > 10; // 10 min grace period
      } else if (hour === 8) {
        return minute > 10; // 10 min grace period
      }
      return hour > 8;
      
    default:
      return false;
  }
}

/**
 * Checks if a check-out time is considered early leave based on shift type
 */
function isEarlyLeave(checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean {
  if (!shiftType) return false;
  
  const hour = checkOut.getHours();
  const minute = checkOut.getMinutes();
  
  switch (shiftType) {
    case 'morning':
      // Morning shift ends at 2:00 PM, early leave before 1:30 PM
      return hour < 13 || (hour === 13 && minute < 30);
      
    case 'evening':
      // Evening shift ends at 10:00 PM, early leave before 9:30 PM
      return hour < 21 || (hour === 21 && minute < 30);
      
    case 'night':
      // Night shift ends at 6:00 AM, early leave before 5:30 AM
      return hour < 5 || (hour === 5 && minute < 30);
      
    case 'canteen':
      // Early canteen (7:00 AM) shift ends at 4:00 PM, early leave before 3:30 PM
      // Late canteen (8:00 AM) shift ends at 5:00 PM, early leave before 4:30 PM
      if (hour < 15) return true;
      if (hour === 15 && minute < 30) return true; // Before 3:30 PM
      return false;
      
    default:
      return false;
  }
}

/**
 * Checks if a check-out time indicates excessive overtime based on shift type
 */
function isExcessiveOvertime(checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean {
  if (!shiftType) return false;
  
  const hour = checkOut.getHours();
  
  switch (shiftType) {
    case 'morning':
      // Morning shift ends at 2:00 PM, excessive overtime after 3:00 PM
      return hour >= 15;
      
    case 'evening':
      // Evening shift ends at 10:00 PM, excessive overtime after 11:00 PM
      return hour >= 23;
      
    case 'night':
      // Night shift ends at 6:00 AM, excessive overtime after 7:00 AM
      return hour >= 7;
      
    case 'canteen':
      // Canteen shifts end at 4:00/5:00 PM, excessive overtime after 5:30/6:30 PM
      return hour >= 18;
      
    default:
      return false;
  }
}

/**
 * Calculate payable hours between check-in and check-out times
 */
function calculatePayableHours(checkIn: Date, checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): number {
  // Calculate raw hours (check-out time minus check-in time)
  let diffHours = (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60);
  
  // If negative (e.g. checked out next day), add 24 hours
  if (diffHours < 0) {
    diffHours += 24;
  }
  
  // Apply business rules based on shift type
  if (!shiftType) {
    // Without a shift type, just return raw hours
    return parseFloat(diffHours.toFixed(2));
  }
  
  // For valid shift types, apply business rules
  switch (shiftType) {
    case 'morning':
    case 'evening':
    case 'canteen':
      // If they worked at least 8.5 hours, give full 9 hours
      if (diffHours >= 8.5) {
        return 9.0;
      }
      // Otherwise, just round to 2 decimal places
      return parseFloat(diffHours.toFixed(2));
      
    case 'night':
      // Night shifts also get 9 hours if worked 8.5+ hours
      if (diffHours >= 8.5) {
        return 9.0;
      }
      // Otherwise, just round to 2 decimal places
      return parseFloat(diffHours.toFixed(2));
      
    default:
      return parseFloat(diffHours.toFixed(2));
  }
}

/**
 * Parse timestamp from Excel file
 */
function parseExcelTimestamp(timestamp: string): Date | null {
  try {
    // First try direct parsing
    const parsedDate = new Date(timestamp);
    if (isValid(parsedDate)) {
      return parsedDate;
    }
    
    // Try parsing common formats
    const formats = [
      'yyyy-MM-dd HH:mm:ss',
      'MM/dd/yyyy HH:mm:ss',
      'MM/dd/yyyy h:mm:ss a',
      'yyyy/MM/dd HH:mm:ss'
    ];
    
    for (const formatStr of formats) {
      try {
        const date = parseISO(timestamp);
        if (isValid(date)) {
          return date;
        }
      } catch (err) {
        // Continue to next format
      }
    }
    
    console.error('Could not parse timestamp:', timestamp);
    return null;
  } catch (err) {
    console.error('Error parsing timestamp:', err);
    return null;
  }
}

// Helper for importing missing functions
// These should be imported from date-fns in a real implementation
function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}