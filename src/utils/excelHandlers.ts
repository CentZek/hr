import * as XLSX from 'xlsx';
import { TimeRecord, EmployeeRecord, DailyRecord } from '../types';
import { 
  isLateCheckIn, 
  isEarlyLeave, 
  determineShiftType, 
  isLikelyNightShiftWorker,
  calculatePayableHours,
  isExcessiveOvertime,
  isNightShiftPattern,
  isLikelyFromNightShift
} from './shiftCalculations';
import { formatTime24H, formatTimeWithReference, parseDateTime, formatTimeString } from './dateTimeHelper';

// Process an Excel file and extract time records
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        if (!e.target?.result) {
          reject(new Error('Failed to read file'));
          return;
        }
        
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Get first sheet
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          reject(new Error('No sheets found in Excel file'));
          return;
        }
        
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        
        // Extract headers
        if (rawRows.length < 2) {
          reject(new Error('Excel file does not contain enough data'));
          return;
        }
        
        // Find column indices
        const headerRow = rawRows[0] as string[];
        const columnIndices = findColumnIndices(headerRow);
        
        if (
          columnIndices.departmentIndex === -1 || 
          columnIndices.nameIndex === -1 || 
          columnIndices.employeeNumberIndex === -1 || 
          columnIndices.dateTimeIndex === -1 || 
          columnIndices.statusIndex === -1
        ) {
          reject(new Error(
            'Excel file must contain columns for Department, Name, Employee Number, Date/Time, and Status'
          ));
          return;
        }

        // Process rows into time records
        const timeRecords: TimeRecord[] = [];
        let currentIndex = 0;
        
        for (let i = 1; i < rawRows.length; i++) {
          const row = rawRows[i] as any[];
          
          // Skip empty rows
          if (!row || row.length === 0 || !row[columnIndices.nameIndex]) {
            continue;
          }
          
          // Extract data from row
          const department = row[columnIndices.departmentIndex]?.toString() || '';
          const name = row[columnIndices.nameIndex]?.toString() || '';
          const employeeNumber = row[columnIndices.employeeNumberIndex]?.toString() || '';
          let dateTimeStr = row[columnIndices.dateTimeIndex]?.toString() || '';
          let status = row[columnIndices.statusIndex]?.toString() || '';
          
          // Skip rows with missing critical data
          if (!name || !employeeNumber || !dateTimeStr || !status) {
            continue;
          }
          
          // Normalize status
          status = normalizeStatus(status);
          
          // Skip rows with invalid status
          if (status !== 'check_in' && status !== 'check_out') {
            continue;
          }

          // Parse the datetime
          const timestamp = parseDateTime(dateTimeStr);
          
          if (!timestamp) {
            console.warn(`Invalid date time format at row ${i}: ${dateTimeStr}`);
            continue;
          }

          // Create time record
          timeRecords.push({
            department,
            name,
            employeeNumber,
            timestamp,
            status,
            originalIndex: currentIndex++,
            originalStatus: status  // Store the original status for potential correction
          });
        }

        console.log(`Processed ${timeRecords.length} time records from Excel file`);

        // Group by employee and process each employee's records
        const employeeMap = new Map<string, TimeRecord[]>();
        
        for (const record of timeRecords) {
          const key = `${record.employeeNumber}|${record.name}`;
          if (!employeeMap.has(key)) {
            employeeMap.set(key, []);
          }
          employeeMap.get(key)!.push(record);
        }

        console.log(`Found ${employeeMap.size} employees in Excel file`);
        
        // Process each employee's records
        const employeeRecords: EmployeeRecord[] = [];
        
        for (const [key, records] of employeeMap.entries()) {
          if (records.length === 0) continue;
          
          const [employeeNumber, name] = key.split('|');
          const department = records[0].department;
          
          // Process employee's records into daily records
          const employeeRecord = processEmployeeRecords(records);
          
          // Add to the final results
          employeeRecords.push({
            employeeNumber,
            name,
            department,
            days: employeeRecord.days,
            totalDays: employeeRecord.days.length,
            expanded: false
          });
        }
        
        // Sort employees by name
        employeeRecords.sort((a, b) => a.name.localeCompare(b.name));
        
        resolve(employeeRecords);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(error);
      }
    };
    
    reader.onerror = (error) => {
      console.error('Error reading Excel file:', error);
      reject(new Error('Failed to read Excel file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Process an employee's time records into daily records
const processEmployeeRecords = (records: TimeRecord[]): { days: DailyRecord[] } => {
  // Sort records by timestamp (ascending)
  const sortedRecords = [...records].sort((a, b) => {
    return a.timestamp.getTime() - b.timestamp.getTime();
  });
  
  // Group records by date
  const recordsByDate = new Map<string, TimeRecord[]>();
  const dateToWorkingWeekStart = new Map<string, string>(); // Track proper grouping for night shifts
  
  // Detect if this employee is likely a night shift worker
  const isNightShiftWorker = isLikelyNightShiftWorker(records);
  console.log(`Employee ${records[0]?.name} is night shift worker: ${isNightShiftWorker}`);
  
  // First pass: assign records to days and detect cross-day shifts (night shifts)
  for (let i = 0; i < sortedRecords.length; i++) {
    const record = sortedRecords[i];
    const recordDate = record.timestamp.toISOString().slice(0, 10);
    
    // Initialize if needed
    if (!recordsByDate.has(recordDate)) {
      recordsByDate.set(recordDate, []);
    }
    
    // Check if this is a likely night shift based on time
    const isLikelyNight = isLikelyFromNightShift(record);
    if (isLikelyNight) {
      record.shift_type = 'night';
    }
    
    // Add record to the date group
    recordsByDate.get(recordDate)!.push(record);
  }
  
  // Second pass: Fix cross-day shifts (night shifts)
  // For night shift check-outs (early morning), we want to associate them with 
  // the previous night's check-in for proper grouping
  const nightShiftDates = new Set<string>();
  
  // Look for night shift patterns (evening check-in, morning checkout)
  for (let i = 0; i < sortedRecords.length - 1; i++) {
    const current = sortedRecords[i];
    const next = sortedRecords[i + 1];
    
    const currentDate = current.timestamp.toISOString().slice(0, 10);
    const nextDate = next.timestamp.toISOString().slice(0, 10);
    
    // If dates are different, and we have check-in followed by check-out,
    // and the time pattern matches night shift (evening check-in, morning checkout)
    if (
      currentDate !== nextDate && 
      current.status === 'check_in' && 
      next.status === 'check_out' &&
      isNightShiftPattern(current.timestamp, next.timestamp)
    ) {
      // This is a night shift crossing day boundary
      current.shift_type = 'night';
      next.shift_type = 'night';
      
      // Add these dates to the night shift dates
      nightShiftDates.add(currentDate);
      nightShiftDates.add(nextDate);
      
      // Mark that the next day's checkout belongs to the current day's working week
      dateToWorkingWeekStart.set(nextDate, currentDate);
      
      // Also mark these records as cross-day
      current.isCrossDay = true;
      next.isCrossDay = true;
      next.fromPrevDay = true;
      next.prevDayDate = currentDate;
    }
  }
  
  // Process each date group into a daily record
  const dailyRecords: DailyRecord[] = [];
  
  for (const [date, dateRecords] of recordsByDate.entries()) {
    // Skip dates with no records
    if (dateRecords.length === 0) continue;
    
    // Determine shift type for this day
    let shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null = null;
    const checkIns = dateRecords.filter(r => r.status === 'check_in');
    
    // Use pre-assigned shift types or determine from check-in times
    if (dateRecords.some(r => r.shift_type === 'night')) {
      shiftType = 'night';
    } else if (dateRecords.some(r => r.shift_type === 'canteen')) {
      shiftType = 'canteen';
    } else if (checkIns.length > 0) {
      // Use first check-in to determine shift type
      shiftType = determineShiftType(checkIns[0].timestamp, isNightShiftWorker);
    }
    
    // Extract the earliest check-in and latest check-out
    let firstCheckIn: Date | null = null;
    let lastCheckOut: Date | null = null;
    
    // For each date group, handle regular records first
    const regularCheckIns = dateRecords.filter(r => 
      r.status === 'check_in' && (!r.fromPrevDay)
    );
    
    const regularCheckOuts = dateRecords.filter(r => 
      r.status === 'check_out' && (!r.fromPrevDay)
    );
    
    if (regularCheckIns.length > 0) {
      // Sort by timestamp and take the earliest check-in
      regularCheckIns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      firstCheckIn = regularCheckIns[0].timestamp;
    }
    
    if (regularCheckOuts.length > 0) {
      // Sort by timestamp and take the latest check-out
      regularCheckOuts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      lastCheckOut = regularCheckOuts[0].timestamp;
    }
    
    // Handle cross-day records (from previous day's night shift)
    if (dateToWorkingWeekStart.has(date)) {
      // This date has a checkout that belongs to previous day's night shift
      const prevDate = dateToWorkingWeekStart.get(date)!;
      
      // Get the checkout records that might belong to previous day
      const earlyMorningCheckouts = dateRecords.filter(r => 
        r.status === 'check_out' && 
        r.timestamp.getHours() < 12 && // Morning hours
        (r.fromPrevDay || r.shift_type === 'night')
      );
      
      if (earlyMorningCheckouts.length > 0) {
        // Sort by timestamp and take the earliest checkout (for night shift)
        earlyMorningCheckouts.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        
        // Find the corresponding daily record for the previous day
        const prevDayRecord = dailyRecords.find(dr => dr.date === prevDate);
        
        if (prevDayRecord) {
          // Update the previous day's checkout time with this early morning checkout
          prevDayRecord.lastCheckOut = earlyMorningCheckouts[0].timestamp;
          
          // Flag the previous day as a cross-day shift
          prevDayRecord.isCrossDay = true;
          prevDayRecord.checkOutNextDay = true;
          
          // Mark the previous day's shift type as night
          prevDayRecord.shiftType = 'night';
          
          // Recalculate hours worked for the previous day
          if (prevDayRecord.firstCheckIn) {
            prevDayRecord.hoursWorked = calculatePayableHours(
              prevDayRecord.firstCheckIn,
              prevDayRecord.lastCheckOut,
              'night',
              prevDayRecord.penaltyMinutes
            );
          }
          
          // Add these records to the previous day's raw data
          if (!prevDayRecord.allTimeRecords) {
            prevDayRecord.allTimeRecords = [];
          }
          
          prevDayRecord.allTimeRecords.push(...earlyMorningCheckouts);
          prevDayRecord.hasMultipleRecords = prevDayRecord.allTimeRecords.length > 1;
          
          // Adjust other flags
          prevDayRecord.missingCheckOut = false;
          prevDayRecord.excessiveOvertime = isExcessiveOvertime(
            prevDayRecord.lastCheckOut, 'night'
          );
          
          // Remove these checkout records from the current day to avoid duplication
          const checkoutIds = new Set(earlyMorningCheckouts.map(r => r.originalIndex));
          const filteredRecords = dateRecords.filter(r => 
            !checkoutIds.has(r.originalIndex)
          );
          
          // Update the date group with filtered records
          recordsByDate.set(date, filteredRecords);
        }
      }
    }
    
    // Get updated records for this date (might have been filtered above)
    const updatedDateRecords = recordsByDate.get(date)!;
    
    // Skip dates that now have no records after filtering
    if (updatedDateRecords.length === 0) continue;
    
    // Re-extract check-in/out if needed
    if (!firstCheckIn || !lastCheckOut) {
      const remainingCheckIns = updatedDateRecords.filter(r => r.status === 'check_in');
      const remainingCheckOuts = updatedDateRecords.filter(r => r.status === 'check_out');
      
      if (!firstCheckIn && remainingCheckIns.length > 0) {
        remainingCheckIns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        firstCheckIn = remainingCheckIns[0].timestamp;
      }
      
      if (!lastCheckOut && remainingCheckOuts.length > 0) {
        remainingCheckOuts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        lastCheckOut = remainingCheckOuts[0].timestamp;
      }
    }
    
    // If shift type is still null but we have check-in, determine shift type
    if (shiftType === null && firstCheckIn) {
      shiftType = determineShiftType(firstCheckIn, isNightShiftWorker);
    }
    
    // Check for common shift patterns in this day's records
    if (shiftType === null) {
      // Default to morning shift if we can't determine
      shiftType = 'morning';
    }
    
    // Check if this is a night shift date
    if (nightShiftDates.has(date)) {
      shiftType = 'night';
    }
    
    // Calculate hours worked
    let hoursWorked = 0;
    
    if (firstCheckIn && lastCheckOut) {
      // Calculate hours with business rules applied
      hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, shiftType);
    }
    
    // Determine various flags
    const missingCheckIn = firstCheckIn === null;
    const missingCheckOut = lastCheckOut === null;
    const isLate = firstCheckIn ? isLateCheckIn(firstCheckIn, shiftType) : false;
    const earlyLeave = lastCheckOut ? isEarlyLeave(lastCheckOut, shiftType) : false;
    const excessiveOvertime = lastCheckOut ? isExcessiveOvertime(lastCheckOut, shiftType) : false;
    
    // Format display times (use 24-hour format)
    let displayCheckIn = firstCheckIn ? formatTime24H(firstCheckIn) : 'Missing';
    let displayCheckOut = lastCheckOut ? formatTime24H(lastCheckOut) : 'Missing';
    
    // Fix display for night shifts that cross day boundaries
    if (shiftType === 'night' && dateToWorkingWeekStart.has(date) && missingCheckOut) {
      displayCheckOut = '06:00'; // Standard night shift checkout time
    }
    
    // Check for records that might be mislabeled
    let correctedRecords = false;
    let notes = '';
    
    // Detect and fix likely mislabeled records
    if (checkIns.length > 1 && regularCheckOuts.length === 0 && updatedDateRecords.length > 1) {
      // Multiple check-ins with no check-out - assume last check-in is actually a check-out
      checkIns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const lastCheckIn = checkIns[checkIns.length - 1];
      
      // Mark the last check-in as mislabeled
      lastCheckIn.mislabeled = true;
      lastCheckIn.originalStatus = lastCheckIn.status;
      lastCheckIn.status = 'check_out'; // Change to check-out
      
      // Update last check-out time
      lastCheckOut = lastCheckIn.timestamp;
      
      // Recalculate hours
      if (firstCheckIn) {
        hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, shiftType);
      }
      
      // Set flag and notes
      correctedRecords = true;
      notes = 'Fixed mislabeled check-in/out';
      
      // Update display
      displayCheckOut = formatTime24H(lastCheckOut);
      
      // Update flags
      missingCheckOut === false;
    } 
    else if (regularCheckIns.length === 0 && regularCheckOuts.length > 1 && updatedDateRecords.length > 1) {
      // Multiple check-outs with no check-in - assume first check-out is actually a check-in
      regularCheckOuts.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const firstCheckOut = regularCheckOuts[0];
      
      // Mark the first check-out as mislabeled
      firstCheckOut.mislabeled = true;
      firstCheckOut.originalStatus = firstCheckOut.status;
      firstCheckOut.status = 'check_in'; // Change to check-in
      
      // Update first check-in time
      firstCheckIn = firstCheckOut.timestamp;
      
      // Use the last check-out for last check-out time
      lastCheckOut = regularCheckOuts[regularCheckOuts.length - 1].timestamp;
      
      // Recalculate hours
      hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, shiftType);
      
      // Set flag and notes
      correctedRecords = true;
      notes = 'Fixed mislabeled check-in/out';
      
      // Update display
      displayCheckIn = formatTime24H(firstCheckIn);
      
      // Update flags
      missingCheckIn === false;
    }
    
    // Create daily record
    const dailyRecord: DailyRecord = {
      date,
      firstCheckIn,
      lastCheckOut,
      hoursWorked,
      approved: false,
      shiftType,
      notes,
      missingCheckIn,
      missingCheckOut,
      isLate,
      earlyLeave,
      excessiveOvertime,
      penaltyMinutes: 0, // Default to no penalty
      correctedRecords,
      displayCheckIn,
      displayCheckOut,
      allTimeRecords: updatedDateRecords,
      hasMultipleRecords: updatedDateRecords.length > 1,
      isCrossDay: nightShiftDates.has(date),
      working_week_start: dateToWorkingWeekStart.has(date) ? dateToWorkingWeekStart.get(date) : date
    };
    
    dailyRecords.push(dailyRecord);
  }
  
  // Sort daily records by date
  dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
  
  return { days: dailyRecords };
};

// Find column indices in header row
const findColumnIndices = (headerRow: string[]) => {
  let departmentIndex = -1;
  let nameIndex = -1;
  let employeeNumberIndex = -1;
  let dateTimeIndex = -1;
  let statusIndex = -1;
  
  // Normalize headers and look for relevant columns
  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i]?.toString().toLowerCase() || '';
    
    if (header.includes('department') || header.includes('dept')) {
      departmentIndex = i;
    } 
    else if (header.includes('name')) {
      nameIndex = i;
    } 
    else if (
      header.includes('employee') && (header.includes('number') || header.includes('no')) ||
      header.includes('emp') && (header.includes('number') || header.includes('no'))
    ) {
      employeeNumberIndex = i;
    } 
    else if (
      (header.includes('date') && header.includes('time')) ||
      header.includes('timestamp')
    ) {
      dateTimeIndex = i;
    } 
    else if (
      header.includes('status') || 
      header.includes('check') ||
      header.includes('type')
    ) {
      statusIndex = i;
    }
  }
  
  // If we couldn't find some columns, make our best guess based on the Excel structure
  if (nameIndex === -1 && headerRow.length > 1) {
    nameIndex = 1; // Second column is often name
  }
  
  if (employeeNumberIndex === -1 && headerRow.length > 0) {
    employeeNumberIndex = 0; // First column is often employee number
  }
  
  if (dateTimeIndex === -1 && headerRow.length > 2) {
    dateTimeIndex = 2; // Third column is often date/time
  }
  
  if (statusIndex === -1 && headerRow.length > 3) {
    statusIndex = 3; // Fourth column is often status
  }
  
  return {
    departmentIndex,
    nameIndex,
    employeeNumberIndex,
    dateTimeIndex,
    statusIndex
  };
};

// Normalize status field to 'check_in' or 'check_out'
const normalizeStatus = (status: string): string => {
  status = status.toLowerCase().trim();
  
  if (
    status === 'check in' ||
    status === 'check-in' ||
    status === 'checkin' ||
    status === 'in' ||
    status === 'i' ||
    status === '1'
  ) {
    return 'check_in';
  }
  
  if (
    status === 'check out' ||
    status === 'check-out' ||
    status === 'checkout' ||
    status === 'out' ||
    status === 'o' ||
    status === '0'
  ) {
    return 'check_out';
  }
  
  return status;
};

// Export processed employee records to an Excel file
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  try {
    // Create workbook
    const workbook = XLSX.utils.book_new();
    
    // Create worksheet for summary
    const summaryData: any[] = [];
    
    // Add header row
    summaryData.push([
      'Employee Number', 'Name', 'Department', 'Total Days', 'Approved Days',
      'Late Days', 'Early Leave Days', 'Missing Records', 'Days with Penalties', 'Penalty Hours'
    ]);
    
    // Add data rows
    for (const employee of employeeRecords) {
      const approvedDays = employee.days.filter(d => d.approved).length;
      const lateDays = employee.days.filter(d => d.isLate).length;
      const earlyLeaveDays = employee.days.filter(d => d.earlyLeave).length;
      const missingRecordDays = employee.days.filter(d => d.missingCheckIn || d.missingCheckOut).length;
      const penaltyDays = employee.days.filter(d => d.penaltyMinutes > 0).length;
      const totalPenaltyHours = employee.days.reduce((sum, day) => sum + day.penaltyMinutes, 0) / 60;
      
      summaryData.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        employee.totalDays,
        approvedDays,
        lateDays,
        earlyLeaveDays,
        missingRecordDays,
        penaltyDays,
        totalPenaltyHours.toFixed(2)
      ]);
    }
    
    // Create and add summary worksheet
    const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
    
    // Create worksheet for detailed records
    const detailData: any[] = [];
    
    // Add header row
    detailData.push([
      'Employee Number', 'Name', 'Department', 'Date', 'Check-In', 'Check-Out',
      'Hours Worked', 'Shift Type', 'Late', 'Early Leave', 'Excessive Overtime',
      'Penalty (Minutes)', 'Notes', 'Approved'
    ]);
    
    // Add data rows
    for (const employee of employeeRecords) {
      for (const day of employee.days) {
        detailData.push([
          employee.employeeNumber,
          employee.name,
          employee.department,
          day.date,
          day.firstCheckIn ? formatTime24H(day.firstCheckIn) : 'Missing',
          day.lastCheckOut ? formatTime24H(day.lastCheckOut) : 'Missing',
          day.hoursWorked.toFixed(2),
          day.shiftType || 'Unknown',
          day.isLate ? 'Yes' : 'No',
          day.earlyLeave ? 'Yes' : 'No',
          day.excessiveOvertime ? 'Yes' : 'No',
          day.penaltyMinutes,
          day.notes,
          day.approved ? 'Yes' : 'No'
        ]);
      }
    }
    
    // Create and add detailed worksheet
    const detailWorksheet = XLSX.utils.aoa_to_sheet(detailData);
    XLSX.utils.book_append_sheet(workbook, detailWorksheet, 'Detailed Records');
    
    // Export to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    XLSX.writeFile(workbook, `employee_records_${timestamp}.xlsx`);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    throw new Error('Failed to export data to Excel file');
  }
};

// Export approved hours to Excel
export const exportApprovedHoursToExcel = (data: any): void => {
  try {
    // Create workbook
    const workbook = XLSX.utils.book_new();
    
    // Create worksheet for summary
    const summaryData: any[] = [];
    
    // Add header row
    summaryData.push([
      'Employee Number', 'Name', 'Total Days', 'Working Days', 'Off Days',
      'Regular Hours', 'Double-Time Hours', 'Total Payable Hours',
      'Date Range'
    ]);
    
    // Add data rows
    for (const employee of data.summary) {
      const offDaysCount = employee.off_days_count || 0;
      const workingDays = employee.working_days || (employee.total_days - offDaysCount);
      const regularHours = employee.total_hours || 0;
      const doubleTimeHours = employee.double_time_hours || 0;
      const totalPayableHours = regularHours + doubleTimeHours;
      
      summaryData.push([
        employee.employee_number,
        employee.name,
        employee.total_days,
        workingDays,
        offDaysCount,
        regularHours.toFixed(2),
        doubleTimeHours.toFixed(2),
        totalPayableHours.toFixed(2),
        data.filterMonth === "custom" ? 
          `${data.dateRange?.startDate || 'N/A'} to ${data.dateRange?.endDate || 'N/A'}` : 
          data.filterMonth === "all" ? 
          "All Time" : data.filterMonth
      ]);
    }
    
    // Create and add summary worksheet
    const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
    
    // Create worksheet for detailed records
    const detailData: any[] = [];
    
    // Add header row
    detailData.push([
      'Employee Number', 'Name', 'Date', 'Check-In', 'Check-Out',
      'Hours', 'Shift Type', 'Double-Time', 'Double-Time Hours', 'Status'
    ]);
    
    // Add data rows
    for (const record of data.details) {
      // Check if this is a double-time day
      const isDoubleTime = data.doubleDays?.includes(record.working_week_start || 
                          record.timestamp?.slice(0, 10));
      
      detailData.push([
        record.employees?.employee_number || '',
        record.employees?.name || '',
        record.working_week_start || record.timestamp?.slice(0, 10) || '',
        record.display_check_in || '',
        record.display_check_out || '',
        record.exact_hours || 0,
        record.shift_type || '',
        isDoubleTime ? 'Yes' : 'No',
        isDoubleTime ? record.exact_hours : 0,
        'Approved'
      ]);
    }
    
    // Create and add detailed worksheet
    const detailWorksheet = XLSX.utils.aoa_to_sheet(detailData);
    XLSX.utils.book_append_sheet(workbook, detailWorksheet, 'Detailed Records');
    
    // Create worksheet for double-time days
    const doubleTimeData: any[] = [];
    
    // Add header row
    doubleTimeData.push(['Date', 'Type', 'Description']);
    
    // Add data rows
    if (data.doubleDays) {
      for (const dateStr of data.doubleDays) {
        const date = new Date(dateStr);
        const isFriday = date.getDay() === 5;
        
        doubleTimeData.push([
          dateStr,
          isFriday ? 'Friday' : 'Holiday',
          ''
        ]);
      }
    }
    
    // Create and add double-time days worksheet
    const doubleTimeWorksheet = XLSX.utils.aoa_to_sheet(doubleTimeData);
    XLSX.utils.book_append_sheet(workbook, doubleTimeWorksheet, 'Double-Time Days');
    
    // Export to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    XLSX.writeFile(workbook, `approved_hours_${timestamp}.xlsx`);
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    throw new Error('Failed to export approved hours to Excel file');
  }
};