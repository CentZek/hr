// This file handles Excel import and export operations
import * as XLSX from 'xlsx';
import { format, differenceInMinutes, parseISO, isValid } from 'date-fns';
import { EmployeeRecord, DailyRecord, TimeRecord } from '../types';
import { determineShiftType, isLateCheckIn, isEarlyLeave, isExcessiveOvertime, calculatePayableHours } from './shiftCalculations';
import { checkEmployeeShiftPattern } from './shiftPatternAnalyzer';

/**
 * Processes an Excel file to extract employee check-in/out data
 * @param file The Excel file to process
 * @returns Array of EmployeeRecord objects
 */
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        // Parse the Excel file
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in the Excel file'));
          return;
        }
        
        // Extract the required data
        const timeRecords = extractTimeRecords(jsonData);
        
        // Process the records into the required format
        const employeeRecords = processTimeRecords(timeRecords);
        
        if (employeeRecords.length === 0) {
          reject(new Error('No valid employee records found'));
          return;
        }
        
        resolve(employeeRecords);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file. Please check the format.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Helper function to extract time records from Excel data
const extractTimeRecords = (data: any[]): TimeRecord[] => {
  // Get column names from first row
  const headerRow = data[0];
  const columns = Object.keys(headerRow);
  
  // Initialize arrays for expected columns
  let departmentColumn = '';
  let nameColumn = '';
  let employeeNumberColumn = '';
  let timeColumn = '';
  let statusColumn = '';
  
  // Detect columns by matching common patterns
  for (const col of columns) {
    const lowerCol = col.toLowerCase();
    if (lowerCol.includes('dept') || lowerCol.includes('department')) {
      departmentColumn = col;
    } else if (lowerCol.includes('name')) {
      nameColumn = col;
    } else if (lowerCol.includes('no') || lowerCol.includes('number') || lowerCol.includes('id') || lowerCol.includes('emp')) {
      employeeNumberColumn = col;
    } else if (lowerCol.includes('time') || lowerCol.includes('date') || lowerCol.includes('dt')) {
      timeColumn = col;
    } else if (lowerCol.includes('status') || lowerCol.includes('type') || lowerCol.includes('event')) {
      statusColumn = col;
    }
  }
  
  // Validate that we found all required columns
  if (!nameColumn || !employeeNumberColumn || !timeColumn) {
    throw new Error('Required columns not found in Excel file. Please ensure the file includes employee name, number, and time columns.');
  }
  
  console.log('Detected columns:', {
    departmentColumn,
    nameColumn,
    employeeNumberColumn,
    timeColumn,
    statusColumn
  });
  
  // Extract time records
  const timeRecords: TimeRecord[] = [];
  data.forEach((row, index) => {
    // Skip header row
    if (index === 0) return;
    
    const name = row[nameColumn]?.toString().trim();
    const employeeNumber = row[employeeNumberColumn]?.toString().trim();
    const timeString = row[timeColumn]?.toString().trim();
    let status = row[statusColumn]?.toString().toLowerCase().trim();
    const department = departmentColumn ? row[departmentColumn]?.toString().trim() : '';
    
    // Skip rows without required fields
    if (!name || !employeeNumber || !timeString) return;
    
    // Parse date/time (try multiple formats)
    const timestamp = parseTimestamp(timeString);
    if (!timestamp) return;
    
    // Normalize status
    let normalizedStatus: 'check_in' | 'check_out' = 'check_in';
    if (status) {
      // Look for check-out related terms
      if (status.includes('out') || 
          status.includes('exit') || 
          status.includes('logout') || 
          status.includes('co') || 
          status === 'c/o') {
        normalizedStatus = 'check_out';
      }
      // Look for check-in related terms
      else if (status.includes('in') || 
              status.includes('entry') || 
              status.includes('login') || 
              status.includes('ci') || 
              status === 'c/i') {
        normalizedStatus = 'check_in';
      }
    }
    
    // Add record
    timeRecords.push({
      department,
      name,
      employeeNumber,
      timestamp,
      status: normalizedStatus,
      originalIndex: index
    });
  });
  
  return timeRecords;
};

// Helper function to parse timestamp from string
const parseTimestamp = (timeString: string): Date | null => {
  // Trim any excess whitespace
  timeString = timeString.trim();
  
  // Try different date/time formats
  // List of common formats to try
  const formats = [
    // Standard formats
    new Date(timeString), 
    // Excel date serial number conversion
    new Date((parseFloat(timeString) - 25569) * 86400 * 1000)
  ];
  
  // Try each format
  for (const parsedDate of formats) {
    if (isValid(parsedDate)) {
      return parsedDate;
    }
  }
  
  // If all else fails, parse as ISO
  try {
    const parsed = parseISO(timeString);
    if (isValid(parsed)) {
      return parsed;
    }
  } catch (e) {
    // Ignore parsing errors
  }
  
  // Custom parsing for common Excel formats
  try {
    if (timeString.includes('/')) {
      // Try MM/DD/YYYY HH:MM:SS format
      const [datePart, timePart] = timeString.split(' ');
      const [month, day, year] = datePart.split('/');
      if (timePart) {
        const [hours, minutes, seconds] = timePart.split(':');
        return new Date(
          parseInt(year), 
          parseInt(month) - 1, 
          parseInt(day),
          parseInt(hours),
          parseInt(minutes),
          seconds ? parseInt(seconds) : 0
        );
      }
    }
  } catch (e) {
    console.warn('Error parsing custom format:', e);
  }
  
  return null;
};

// Process time records into employee records
const processTimeRecords = (records: TimeRecord[]): EmployeeRecord[] => {
  // Group by employee
  const employeeMap = new Map<string, {
    name: string;
    department: string;
    records: TimeRecord[];
  }>();
  
  // Track all records by employee
  records.forEach(record => {
    if (!employeeMap.has(record.employeeNumber)) {
      employeeMap.set(record.employeeNumber, {
        name: record.name,
        department: record.department || '',
        records: []
      });
    }
    employeeMap.get(record.employeeNumber)!.records.push(record);
  });
  
  // Process each employee's records
  const employeeRecords: EmployeeRecord[] = [];
  
  // Process each employee
  employeeMap.forEach((employee, employeeNumber) => {
    // Sort records by timestamp
    const sortedRecords = [...employee.records].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    // Group records by day
    const dayMap = new Map<string, TimeRecord[]>();
    sortedRecords.forEach(record => {
      // Format date as YYYY-MM-DD
      const dateString = format(record.timestamp, 'yyyy-MM-dd');
      if (!dayMap.has(dateString)) {
        dayMap.set(dateString, []);
      }
      dayMap.get(dateString)!.push(record);
    });
    
    // Determine the employee's typical work pattern (common shift type)
    const employeeShiftPattern = checkEmployeeShiftPattern(sortedRecords);
    
    // Process each day
    const dailyRecords: DailyRecord[] = [];
    dayMap.forEach((dayRecords, date) => {
      const { firstCheckIn, lastCheckOut, allRecords, shiftType, missingCheckIn, missingCheckOut, correctedRecords } = 
        processDailyRecords(dayRecords, employeeShiftPattern);
      
      // Skip days with no valid check-ins or check-outs
      if (!firstCheckIn && !lastCheckOut) return;
      
      // Calculate hours
      let hoursWorked = 0;
      if (firstCheckIn && lastCheckOut) {
        // Calculate hours based on shift type
        const derivedShiftType = shiftType || (firstCheckIn ? determineShiftType(firstCheckIn) : null);
        hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, derivedShiftType);
      }
      
      // Detect issues
      const isLate = firstCheckIn ? isLateCheckIn(firstCheckIn, shiftType) : false;
      const earlyLeave = lastCheckOut ? isEarlyLeave(lastCheckOut, shiftType) : false;
      const excessiveOvertime = firstCheckIn && lastCheckOut ? isExcessiveOvertime(lastCheckOut, shiftType) : false;
      
      // Set "working_week_start" field for cross-day shifts like night shift
      // Use the date of the check-in for all records
      const working_week_start = date;
      
      // Create daily record
      const dailyRecord: DailyRecord = {
        date,
        firstCheckIn,
        lastCheckOut,
        hoursWorked,
        approved: false,
        shiftType,
        notes: '',
        missingCheckIn,
        missingCheckOut,
        isLate,
        earlyLeave,
        excessiveOvertime,
        penaltyMinutes: 0,
        allTimeRecords: allRecords, // Store all raw time records for this day
        hasMultipleRecords: allRecords.length > 2, // Flag indicating there are unexpected records
        correctedRecords,
        working_week_start
      };
      
      dailyRecords.push(dailyRecord);
    });
    
    // Sort daily records by date
    dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
    
    // Create employee record
    employeeRecords.push({
      employeeNumber,
      name: employee.name,
      department: employee.department,
      days: dailyRecords,
      totalDays: dailyRecords.length,
      expanded: false
    });
  });
  
  return employeeRecords;
};

// Process a single day's records
const processDailyRecords = (
  records: TimeRecord[],
  employeeShiftPattern: 'morning' | 'evening' | 'night' | 'canteen' | 'unknown' = 'unknown'
): {
  firstCheckIn: Date | null;
  lastCheckOut: Date | null;
  allRecords: TimeRecord[];
  shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null;
  missingCheckIn: boolean;
  missingCheckOut: boolean;
  correctedRecords: boolean;
} => {
  let checkIns = records.filter(r => r.status === 'check_in');
  let checkOuts = records.filter(r => r.status === 'check_out');
  
  // Preprocessed records
  const allRecords = [...records]; // Store all original records
  let correctedRecords = false; // Flag to indicate if records were fixed
  
  // If we have a single record and it's a night shift pattern
  if (records.length === 1 && employeeShiftPattern === 'night') {
    const record = records[0];
    const hour = record.timestamp.getHours();
    
    // If it's a late night check-in or early morning check-out, try to infer the missing pair
    if (record.status === 'check_in' && hour >= 20) {
      // Missing check-out - assume the person worked a standard night shift
      console.log('Detected night shift check-in without check-out');
    } else if (record.status === 'check_out' && hour <= 7) {
      // Missing check-in - assume the person worked a standard night shift
      console.log('Detected night shift check-out without check-in');
    }
  }
  
  // If numbers are wrong (1 check-in, 1 check-out is expected)
  // or if they're in the wrong order (check-out time BEFORE check-in)
  if (
    // Handle commonly mislabeled check-in/check-out for night shift
    (checkIns.length === 1 && checkOuts.length === 1 && 
     checkIns[0].timestamp > checkOuts[0].timestamp && 
     checkIns[0].timestamp.getHours() <= 7 && 
     checkOuts[0].timestamp.getHours() >= 20)
  ) {
    // This is likely a mislabeled pair - the check-in is actually check-out and vice versa
    // Swap the statuses
    const oldCheckIn = checkIns[0];
    const oldCheckOut = checkOuts[0];
    
    oldCheckIn.status = 'check_out';
    oldCheckOut.status = 'check_in';
    
    // Mark records as mislabeled
    oldCheckIn.mislabeled = true;
    oldCheckOut.mislabeled = true;
    oldCheckIn.originalStatus = 'check_in';
    oldCheckOut.originalStatus = 'check_out';
    
    // Update notes
    oldCheckIn.notes = 'Fixed mislabeled check-in (changed to check-out)';
    oldCheckOut.notes = 'Fixed mislabeled check-out (changed to check-in)';
    
    // Update our working arrays
    checkIns = records.filter(r => r.status === 'check_in');
    checkOuts = records.filter(r => r.status === 'check_out');
    
    // Set flag that records were corrected
    correctedRecords = true;
  }
  
  // Handle case where there are 3 records for non-night shift
  // Often the middle record is mislabeled
  if (records.length === 3 && employeeShiftPattern !== 'night') {
    // Sort by timestamp
    const sorted = [...records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // If middle record is oppositely labeled from its neighbors, it's likely wrong
    if (
      (sorted[0].status === sorted[2].status) && 
      (sorted[0].status !== sorted[1].status)
    ) {
      // Middle record is likely mislabeled - fix it
      const originalStatus = sorted[1].status;
      sorted[1].status = sorted[1].status === 'check_in' ? 'check_out' : 'check_in';
      sorted[1].mislabeled = true;
      sorted[1].originalStatus = originalStatus;
      sorted[1].notes = `Fixed mislabeled ${originalStatus} (changed to ${sorted[1].status})`;
      
      // Update our working arrays
      checkIns = records.filter(r => r.status === 'check_in');
      checkOuts = records.filter(r => r.status === 'check_out');
      
      // Set flag that records were corrected
      correctedRecords = true;
    }
  }

  // Determine first check-in and last check-out
  let firstCheckIn: Date | null = null;
  let lastCheckOut: Date | null = null;
  
  if (checkIns.length > 0) {
    // Get earliest check-in
    firstCheckIn = checkIns.reduce(
      (earliest, record) => 
        record.timestamp < earliest ? record.timestamp : earliest, 
      checkIns[0].timestamp
    );
  }
  
  if (checkOuts.length > 0) {
    // Get latest check-out
    lastCheckOut = checkOuts.reduce(
      (latest, record) => 
        record.timestamp > latest ? record.timestamp : latest, 
      checkOuts[0].timestamp
    );
  }
  
  // Determine shift type based on the time patterns
  let shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null = null;
  
  if (firstCheckIn) {
    // If there's a check-in, determine shift type from it
    shiftType = determineShiftType(firstCheckIn);
  } else if (lastCheckOut) {
    // If only check-out is available, try to infer from it
    const hour = lastCheckOut.getHours();
    if (hour >= 13 && hour <= 15) {
      shiftType = 'morning';
    } else if (hour >= 21 && hour <= 23) {
      shiftType = 'evening';
    } else if (hour >= 5 && hour <= 7) {
      shiftType = 'night';
    } else if (hour >= 16 && hour <= 17) {
      shiftType = 'canteen';
    }
  } else {
    // If no check-in or check-out, use employee's pattern
    shiftType = employeeShiftPattern === 'unknown' ? null : employeeShiftPattern;
  }
  
  // Return processed records
  return {
    firstCheckIn,
    lastCheckOut,
    allRecords, // Include all records for this date
    shiftType,
    missingCheckIn: !firstCheckIn,
    missingCheckOut: !lastCheckOut,
    correctedRecords
  };
};

/**
 * Exports employee records to an Excel file for download
 */
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create worksheet data
  const worksheetData: any[][] = [];

  // Add headers
  worksheetData.push([
    'Employee No.',
    'Name',
    'Department',
    'Date',
    'Check In',
    'Check Out',
    'Hours',
    'Shift Type',
    'Approved',
    'Is Late',
    'Early Leave',
    'Missing Check In',
    'Missing Check Out',
    'Excessive Overtime',
    'Notes',
    'Penalty'
  ]);

  // Add data rows
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      worksheetData.push([
        employee.employeeNumber,
        employee.name,
        employee.department || '',
        day.date,
        day.firstCheckIn ? formatDateTime(day.firstCheckIn) : 'Missing',
        day.lastCheckOut ? formatDateTime(day.lastCheckOut) : 'Missing',
        day.hoursWorked.toFixed(2),
        day.shiftType || 'Unknown',
        day.approved ? 'Yes' : 'No',
        day.isLate ? 'Yes' : 'No',
        day.earlyLeave ? 'Yes' : 'No',
        day.missingCheckIn ? 'Yes' : 'No',
        day.missingCheckOut ? 'Yes' : 'No',
        day.excessiveOvertime ? 'Yes' : 'No',
        day.notes || '',
        day.penaltyMinutes > 0 ? `${day.penaltyMinutes} min (${(day.penaltyMinutes / 60).toFixed(2)} hr)` : 'None'
      ]);
    });
  });

  // Create a new workbook and add the worksheet
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Set column widths
  const columnWidths = [
    { wch: 15 }, // Employee No
    { wch: 25 }, // Name
    { wch: 15 }, // Department
    { wch: 12 }, // Date
    { wch: 12 }, // Check In
    { wch: 12 }, // Check Out
    { wch: 10 }, // Hours
    { wch: 12 }, // Shift Type
    { wch: 10 }, // Approved
    { wch: 10 }, // Is Late
    { wch: 10 }, // Early Leave
    { wch: 15 }, // Missing Check In
    { wch: 15 }, // Missing Check Out
    { wch: 15 }, // Excessive Overtime
    { wch: 30 }, // Notes
    { wch: 15 }  // Penalty
  ];
  
  worksheet['!cols'] = columnWidths;

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Time Records');

  // Generate file name with date
  const fileName = `TimeRecords_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;

  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

// Helper function to format date and time
const formatDateTime = (date: Date): string => {
  return format(date, 'yyyy-MM-dd HH:mm');
};

// Export approved hours to Excel
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create the workbook
  const workbook = XLSX.utils.book_new();

  // Create summary worksheet
  const summaryData: any[][] = [];
  const summaryHeaders = [
    'Employee Number', 
    'Name', 
    'Total Days',
    'Working Days',
    'Off-Days',
    'Regular Hours',
    'Double-Time Hours',
    'Fridays Worked',
    'Over Time (Hours)',
    'Over Time (Days)',
    'Total Payable Hours'
  ];
  
  summaryData.push(summaryHeaders);
  
  // Add employee summary data
  let allEmployees = data.summary;
  
  // Filter by selected employee if specified
  if (data.selectedEmployee && data.selectedEmployee !== 'all') {
    allEmployees = allEmployees.filter(emp => emp.id === data.selectedEmployee);
  }
  
  // Prepare for aggregate calculations
  let totalEmployees = allEmployees.length;
  let totalRegularHours = 0;
  let totalDoubleTimeHours = 0;
  let totalPayableHours = 0;
  let totalOvertimeHours = 0;
  
  allEmployees.forEach(employee => {
    // Calculate overtime
    let regularHours = employee.total_hours || 0;
    let doubleTimeHours = employee.double_time_hours || 0;
    let overtimeHours = 0;
    let fridaysWorked = 0;
    
    // Count double-time days (typically Fridays)
    if (employee.working_week_dates && data.doubleDays) {
      fridaysWorked = employee.working_week_dates.filter((date: string) => 
        data.doubleDays.includes(date)
      ).length;
    }
    
    // Calculate overtime for hours > 9 hours per day
    const workingDays = employee.working_days !== undefined ? 
      employee.working_days : 
      (employee.total_days - (employee.off_days_count || 0));
    
    const standardHours = workingDays * 9; // 9 hours per day
    
    if (regularHours > standardHours) {
      overtimeHours = regularHours - standardHours;
      // Adjust regular hours
      regularHours = standardHours;
    }
    
    // Calculate overtimeDays - this is where the issue is
    const overtimeDays = parseFloat((overtimeHours / 9).toFixed(2));
    
    // Calculate total payable hours
    const payableHours = regularHours + doubleTimeHours + overtimeHours;
    
    // Add to running totals
    totalRegularHours += regularHours;
    totalDoubleTimeHours += doubleTimeHours;
    totalPayableHours += payableHours;
    totalOvertimeHours += overtimeHours;
    
    summaryData.push([
      employee.employee_number,
      employee.name,
      employee.total_days || 0,
      workingDays || 0,
      employee.off_days_count || 0,
      regularHours.toFixed(2),
      doubleTimeHours.toFixed(2),
      fridaysWorked || 0,
      overtimeHours.toFixed(2),
      overtimeDays,
      payableHours.toFixed(2)
    ]);
  });
  
  // Add totals row
  if (allEmployees.length > 1) {
    // Calculate totals
    const totalOvertimeDays = parseFloat((totalOvertimeHours / 9).toFixed(2));
    
    summaryData.push([
      '',
      'TOTALS',
      '', // We don't sum days columns
      '',
      '',
      totalRegularHours.toFixed(2),
      totalDoubleTimeHours.toFixed(2),
      '',
      totalOvertimeHours.toFixed(2),
      totalOvertimeDays,
      totalPayableHours.toFixed(2)
    ]);
  }
  
  // Create worksheet from data
  const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData);
  
  // Set column widths for summary
  const summaryColWidths = [
    { wch: 15 },  // Employee Number
    { wch: 25 },  // Name
    { wch: 12 },  // Total Days
    { wch: 15 },  // Working Days
    { wch: 12 },  // Off-Days
    { wch: 15 },  // Regular Hours
    { wch: 18 },  // Double-Time Hours
    { wch: 15 },  // Fridays Worked
    { wch: 18 },  // Overtime Hours
    { wch: 18 },  // Overtime Days
    { wch: 20 }   // Total Payable Hours
  ];
  
  // Apply column widths
  summaryWorksheet['!cols'] = summaryColWidths;
  
  // Add summary worksheet to workbook
  XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
  
  // Add detailed employee worksheets if we have details
  if (data.details && data.details.length > 0 && data.selectedEmployee) {
    // Create detailed worksheet for the employee
    const detailedData: any[][] = [];
    const detailedHeaders = [
      'Date', 
      'Check In', 
      'Check Out',
      'Hours',
      'Shift Type',
      'Notes',
      'Double-Time',
      'Status'
    ];
    
    detailedData.push(detailedHeaders);
    
    // Group records by date
    const recordsByDate: Record<string, any[]> = {};
    
    data.details.forEach((record: any) => {
      // Extract date from timestamp
      try {
        // FIXED: Always use working_week_start as the key date for grouping
        let dateKey = record.working_week_start || '';
        
        // If working_week_start is not available, extract from timestamp
        if (!dateKey) {
          // Use the UTC date portion so nothing shifts under local timezones
          const utc = parseISO(record.timestamp);
          dateKey = utc.toISOString().slice(0,10);  // "YYYY-MM-DD"
        }
        
        if (!recordsByDate[dateKey]) {
          recordsByDate[dateKey] = [];
        }
        
        recordsByDate[dateKey].push(record);
      } catch (err) {
        console.error('Error parsing record date:', err);
      }
    });
    
    // Process each date to create rows
    Object.entries(recordsByDate).forEach(([date, records]) => {
      // If this is an OFF-DAY
      const isOffDay = records.some(r => r.status === 'off_day' || r.notes?.includes('OFF-DAY'));
      
      if (isOffDay) {
        detailedData.push([
          date,
          'OFF-DAY',
          'OFF-DAY',
          '0.00',
          '',
          'OFF-DAY',
          isDoubleTimeDay(date, data.doubleDays) ? 'Yes' : 'No',
          'Approved'
        ]);
        return;
      }
      
      // Get check-in and check-out records
      const checkIns = records.filter(r => r.status === 'check_in');
      const checkOuts = records.filter(r => r.status === 'check_out');
      
      // If no check-in or check-out, mark as OFF-DAY
      if (checkIns.length === 0 && checkOuts.length === 0) {
        detailedData.push([
          date,
          'Missing',
          'Missing',
          '0.00',
          '',
          records[0]?.notes || '',
          isDoubleTimeDay(date, data.doubleDays) ? 'Yes' : 'No',
          'Approved'
        ]);
        return;
      }
      
      // Get the first check-in and last check-out
      const checkIn = checkIns.length > 0 ? 
        checkIns.reduce((earliest, r) => new Date(r.timestamp) < new Date(earliest.timestamp) ? r : earliest, checkIns[0]) : null;
        
      const checkOut = checkOuts.length > 0 ? 
        checkOuts.reduce((latest, r) => new Date(r.timestamp) > new Date(latest.timestamp) ? r : latest, checkOuts[0]) : null;
      
      // Format check-in and check-out times
      const checkInTime = checkIn ? formatTime(checkIn.timestamp) : 'Missing';
      const checkOutTime = checkOut ? formatTime(checkOut.timestamp) : 'Missing';
      
      // Get hours - first check for exact_hours field
      let hours = 0;
      if (checkIn?.exact_hours !== undefined && checkIn.exact_hours !== null) {
        hours = parseFloat(checkIn.exact_hours);
      } else if (checkOut?.exact_hours !== undefined && checkOut.exact_hours !== null) {
        hours = parseFloat(checkOut.exact_hours);
      } else {
        // Parse from notes as fallback
        try {
          const hoursMatch = checkIn?.notes?.match(/hours:(\d+\.\d+)/);
          if (hoursMatch && hoursMatch[1]) {
            hours = parseFloat(hoursMatch[1]);
          } else {
            const hoursMatch2 = checkOut?.notes?.match(/hours:(\d+\.\d+)/);
            if (hoursMatch2 && hoursMatch2[1]) {
              hours = parseFloat(hoursMatch2[1]);
            }
          }
        } catch (e) {
          console.warn('Error parsing hours from notes:', e);
        }
      }
      
      // Ensure valid hours
      if (isNaN(hours)) hours = 0;
      
      // Get shift type
      const shiftType = checkIn?.shift_type || checkOut?.shift_type || '';
      
      // Notes - remove hours info
      const notes = (checkIn?.notes || checkOut?.notes || '').replace(/hours:\d+\.\d+;?\s*/, '');
      
      // Double-time status
      const isDoubleTime = isDoubleTimeDay(date, data.doubleDays);
      
      // Add to detailed data
      detailedData.push([
        date,
        checkInTime,
        checkOutTime,
        hours.toFixed(2),
        shiftType === 'off_day' ? '' : (shiftType.charAt(0).toUpperCase() + shiftType.slice(1)),
        notes,
        isDoubleTime ? 'Yes' : 'No',
        'Approved'
      ]);
    });
    
    // Create worksheet from detailed data
    const detailedWorksheet = XLSX.utils.aoa_to_sheet(detailedData);
    
    // Set column widths for detailed view
    const detailedColWidths = [
      { wch: 12 },  // Date
      { wch: 12 },  // Check In
      { wch: 12 },  // Check Out
      { wch: 10 },  // Hours
      { wch: 15 },  // Shift Type
      { wch: 30 },  // Notes
      { wch: 12 },  // Double-Time
      { wch: 12 }   // Status
    ];
    
    // Apply column widths
    detailedWorksheet['!cols'] = detailedColWidths;
    
    // Get employee name for the worksheet name
    const employee = allEmployees.find(e => e.id === data.selectedEmployee);
    const worksheetName = employee ? 
      `${employee.employee_number}-${employee.name}`.substring(0, 30) : 
      'Employee Detail';
    
    // Add detailed worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, detailedWorksheet, worksheetName);
  }
  
  // Generate filename
  let fileName = 'ApprovedHours';
  
  // Add date range to filename if specified
  if (data.dateRange && data.dateRange.startDate && data.dateRange.endDate) {
    fileName += `_${data.dateRange.startDate}_to_${data.dateRange.endDate}`;
  } else if (data.filterMonth && data.filterMonth !== 'all') {
    fileName += `_${data.filterMonth}`;
  }
  
  // Add employee name if selected
  if (data.selectedEmployee && data.selectedEmployee !== 'all') {
    const employee = allEmployees.find(e => e.id === data.selectedEmployee);
    if (employee) {
      fileName += `_${employee.employee_number}_${employee.name}`;
    }
  }
  
  fileName += `_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  
  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

// Helper to check if a date is a double-time day (Friday or holiday)
const isDoubleTimeDay = (dateStr: string, doubleDays: string[] = []): boolean => {
  return doubleDays.includes(dateStr);
};

// Helper to format timestamp for Excel output
const formatTime = (timestamp: string): string => {
  try {
    const date = parseISO(timestamp);
    if (!isValid(date)) return 'Invalid Date';
    return format(date, 'HH:mm');
  } catch (err) {
    console.error('Error formatting time:', err, timestamp);
    return 'Error';
  }
};