import * as XLSX from 'xlsx';
import { TimeRecord, EmployeeRecord, DailyRecord } from '../types';
import { parseDateTime, formatDate } from './dateTimeHelper';
import { determineShiftType, calculatePayableHours, isLateCheckIn, isEarlyLeave, isLikelyFromNightShift } from './shiftCalculations';

// Map to store and count processed records for performance metrics
const processingStats = {
  totalRecords: 0,
  processedRecords: 0,
  startTime: 0
};

export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  // Reset processing stats
  processingStats.totalRecords = 0;
  processingStats.processedRecords = 0;
  processingStats.startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd hh:mm:ss' });

        // Use the first sheet (assuming Face ID Data is there)
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Convert to JSON
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' });
        
        // Log the total number of records for progress tracking
        processingStats.totalRecords = jsonData.length;
        console.log(`Processing ${processingStats.totalRecords} records from Excel file...`);

        if (jsonData.length === 0) {
          reject(new Error('No data found in the Excel file'));
          return;
        }

        // Process the data using a more efficient algorithm
        const processedData = processExcelData(jsonData);
        console.log(`Processing completed in ${(Date.now() - processingStats.startTime) / 1000} seconds.`);
        
        resolve(processedData);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(error);
      }
    };

    reader.onerror = (e) => {
      console.error('Error reading file:', e);
      reject(new Error('Error reading file'));
    };

    reader.readAsArrayBuffer(file);
  });
};

// Helper function to normalize column names for robust parsing
const normalizeColumnName = (name: string): string => {
  return String(name).toLowerCase().trim();
};

// Helper function to get value from row with normalized column name
const getColumnValue = (row: any, columnName: string): string | null => {
  // Normalize the column name we're looking for
  const normalizedColumnName = normalizeColumnName(columnName);
  
  // Find the matching column in the row
  for (const key in row) {
    if (normalizeColumnName(key) === normalizedColumnName) {
      return row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : null;
    }
  }
  
  return null;
};

// More efficient data processing algorithm
const processExcelData = (jsonData: any[]): EmployeeRecord[] => {
  // Step 1: Prepare raw records by department
  const recordsByDepartment = new Map<string, Map<string, TimeRecord[]>>();

  // Pre-processing to normalize and organize data
  jsonData.forEach((row, index) => {
    processingStats.processedRecords++;
    
    // Log progress every 500 records
    if (processingStats.processedRecords % 500 === 0) {
      console.log(`Processed ${processingStats.processedRecords}/${processingStats.totalRecords} records...`);
    }
    
    // Get normalized column values
    const department = getColumnValue(row, 'Department');
    const name = getColumnValue(row, 'Name');
    const employeeNumber = getColumnValue(row, 'Number');
    const datetimeStr = getColumnValue(row, 'Datetime');
    const statusValue = getColumnValue(row, 'Status');
    
    // Check if this is a valid row with required fields
    if (!department || !name || !employeeNumber || !datetimeStr || !statusValue) {
      // Try alternative column names for common variations
      const altDepartment = getColumnValue(row, 'Dept') || getColumnValue(row, 'dept');
      const altEmployeeNumber = getColumnValue(row, 'Employee Number') || getColumnValue(row, 'ID');
      const altDatetime = getColumnValue(row, 'Date Time') || getColumnValue(row, 'DateTime');
      
      // Use alternatives if found
      if (!(altDepartment && name && (altEmployeeNumber || employeeNumber) && (altDatetime || datetimeStr) && statusValue)) {
        console.log('Skipping row due to missing required fields:', row);
        return; // Skip this row
      }
      
      // Use alternative values if primary ones are missing
      if (!department) department = altDepartment;
      if (!employeeNumber) employeeNumber = altEmployeeNumber;
      if (!datetimeStr) datetimeStr = altDatetime;
    }
    
    const timestamp = parseDateTime(datetimeStr);
    const status = statusValue.toLowerCase().includes('check in') ? 'check_in' : 'check_out';

    // Skip if timestamp is invalid
    if (!timestamp) {
      console.log('Skipping row due to invalid timestamp:', datetimeStr);
      return;
    }
    
    // Create a unique key for the employee
    const employeeKey = `${department}|${employeeNumber}`;

    // Ensure the department exists in our map
    if (!recordsByDepartment.has(department)) {
      recordsByDepartment.set(department, new Map<string, TimeRecord[]>());
    }
    
    // Ensure the employee exists in the department
    const departmentMap = recordsByDepartment.get(department)!;
    if (!departmentMap.has(employeeKey)) {
      departmentMap.set(employeeKey, []);
    }
    
    // Add the record
    departmentMap.get(employeeKey)!.push({
      department,
      name,
      employeeNumber,
      timestamp,
      status,
      originalIndex: index,
      originalStatus: status
    });
  });

  // Step 2: Process each employee's records to create daily records
  const employeeRecords: EmployeeRecord[] = [];
  
  // Process departments
  for (const [department, employeesMap] of recordsByDepartment.entries()) {
    // Process employees in this department
    for (const [employeeKey, timeRecords] of employeesMap.entries()) {
      const [dept, empNumber] = employeeKey.split('|');
      
      // Skip if we don't have employee information
      if (!timeRecords || timeRecords.length === 0) continue;
      
      // Sort records by timestamp
      timeRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      // Fix mislabeled records (experimental) - implemented for the future
      const fixedRecords = fixMislabeledRecords(timeRecords);
      
      // Group by date for daily records
      const dailyRecordsMap = createDailyRecords(fixedRecords);
      
      // Convert map to array and sort by date
      const days = Array.from(dailyRecordsMap.values())
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      // Add the employee to our records
      employeeRecords.push({
        employeeNumber: empNumber,
        name: timeRecords[0].name, // Use the name from the first record
        department: dept,
        days,
        totalDays: days.length,
        expanded: false
      });
    }
  }
  
  // Log the result
  console.log(`Processed ${employeeRecords.length} employees with time records.`);
  if (employeeRecords.length === 0) {
    console.warn('Warning: No employee records were processed. Check Excel file format.');
  }
  
  return employeeRecords;
};

// More efficient algorithm to fix mislabeled records
const fixMislabeledRecords = (records: TimeRecord[]): TimeRecord[] => {
  if (records.length < 2) return records;
  
  const result: TimeRecord[] = [];
  const processed = new Set<number>();
  
  // First pass - find obvious consecutive pairs of same status
  for (let i = 0; i < records.length - 1; i++) {
    if (processed.has(i)) continue;
    
    const current = records[i];
    const next = records[i + 1];
    
    // If we have consecutive same status, one is likely mislabeled
    if (current.status === next.status) {
      // Determine which one is likely mislabeled based on time difference
      const timeDiff = next.timestamp.getTime() - current.timestamp.getTime();
      const hoursDiff = timeDiff / (1000 * 60 * 60);
      
      if (hoursDiff > 1 && hoursDiff < 12) {
        // If reasonable time difference, the second record is likely a checkout
        // Push current record as-is
        result.push(current);
        
        // Push corrected next record
        const correctedNext = { ...next };
        correctedNext.status = current.status === 'check_in' ? 'check_out' : 'check_in';
        correctedNext.mislabeled = true;
        correctedNext.originalStatus = next.status;
        correctedNext.notes = 'Fixed mislabeled record; original status: ' + next.status;
        result.push(correctedNext);
        
        // Mark both as processed
        processed.add(i);
        processed.add(i + 1);
      } else {
        // If time difference is too short or too long, just keep the first one
        result.push(current);
        processed.add(i);
      }
    } else {
      // Normal case - different statuses
      result.push(current);
      processed.add(i);
    }
  }
  
  // Add last record if not processed
  if (records.length > 0 && !processed.has(records.length - 1)) {
    result.push(records[records.length - 1]);
  }
  
  return result;
};

// More efficient algorithm to create daily records
const createDailyRecords = (timeRecords: TimeRecord[]): Map<string, DailyRecord> => {
  const dailyRecordsMap = new Map<string, DailyRecord>();
  
  // Group time records by date
  const recordsByDate = new Map<string, TimeRecord[]>();
  
  timeRecords.forEach(record => {
    const dateStr = formatDate(record.timestamp);
    if (!recordsByDate.has(dateStr)) {
      recordsByDate.set(dateStr, []);
    }
    recordsByDate.get(dateStr)!.push(record);
  });
  
  // Process each date's records
  for (const [dateStr, records] of recordsByDate.entries()) {
    // Sort by timestamp
    records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Identify check-ins and check-outs
    const checkIns = records.filter(r => r.status === 'check_in');
    const checkOuts = records.filter(r => r.status === 'check_out');
    
    // Get first check-in and last check-out
    const firstCheckIn = checkIns.length > 0 ? checkIns[0].timestamp : null;
    const lastCheckOut = checkOuts.length > 0 ? checkOuts[checkOuts.length - 1].timestamp : null;
    
    // Skip dates with no records
    if (records.length === 0) continue;
    
    // Determine shift type based on check-in time
    const shiftType = firstCheckIn ? determineShiftType(firstCheckIn) : null;
    
    // Calculate hours worked
    const hoursWorked = firstCheckIn && lastCheckOut 
      ? calculatePayableHours(firstCheckIn, lastCheckOut, shiftType)
      : 0;
    
    // Create daily record
    const dailyRecord: DailyRecord = {
      date: dateStr,
      firstCheckIn,
      lastCheckOut,
      hoursWorked,
      approved: false,
      shiftType,
      notes: '',
      missingCheckIn: !firstCheckIn,
      missingCheckOut: !lastCheckOut,
      isLate: firstCheckIn ? isLateCheckIn(firstCheckIn, shiftType) : false,
      earlyLeave: lastCheckOut ? isEarlyLeave(lastCheckOut, shiftType) : false,
      excessiveOvertime: hoursWorked > 12,
      penaltyMinutes: 0,
      allTimeRecords: records,
      hasMultipleRecords: records.length > 1,
      showRawData: false,
      correctedRecords: records.some(r => r.mislabeled),
      isCrossDay: firstCheckIn && lastCheckOut && lastCheckOut < firstCheckIn
    };
    
    dailyRecordsMap.set(dateStr, dailyRecord);
  }
  
  // Find and fix night shifts that cross day boundaries
  findAndFixNightShifts(dailyRecordsMap, timeRecords);
  
  return dailyRecordsMap;
};

// Find and fix night shifts that cross day boundaries
const findAndFixNightShifts = (
  dailyRecordsMap: Map<string, DailyRecord>, 
  timeRecords: TimeRecord[]
): void => {
  // Iterate through time records looking for night shift patterns
  for (let i = 0; i < timeRecords.length - 1; i++) {
    const current = timeRecords[i];
    const next = timeRecords[i + 1];
    
    // Check if this could be a night shift pair
    if (
      current.status === 'check_in' && 
      next.status === 'check_out' &&
      current.timestamp.getHours() >= 20 && // Late evening check-in (8 PM or later)
      next.timestamp.getHours() <= 10 && // Early morning check-out (10 AM or earlier)
      formatDate(current.timestamp) !== formatDate(next.timestamp) // Different days
    ) {
      // This looks like a night shift that crosses days
      const checkInDate = formatDate(current.timestamp);
      const checkOutDate = formatDate(next.timestamp);
      
      // Update both daily records
      if (dailyRecordsMap.has(checkInDate)) {
        const checkInRecord = dailyRecordsMap.get(checkInDate)!;
        checkInRecord.shiftType = 'night';
        checkInRecord.isCrossDay = true;
        
        // If this day has a check-in but no check-out, it might be a night shift
        if (checkInRecord.firstCheckIn && !checkInRecord.lastCheckOut) {
          // Look for the checkout on the next day
          if (dailyRecordsMap.has(checkOutDate)) {
            const checkOutRecord = dailyRecordsMap.get(checkOutDate)!;
            
            // If the next day has a check-out but no check-in, it's likely the night shift's check-out
            if (!checkOutRecord.firstCheckIn && checkOutRecord.lastCheckOut) {
              // Update the check-in day with this check-out
              checkInRecord.lastCheckOut = checkOutRecord.lastCheckOut;
              checkInRecord.missingCheckOut = false;
              checkInRecord.hoursWorked = calculatePayableHours(
                checkInRecord.firstCheckIn!, 
                checkInRecord.lastCheckOut!, 
                'night'
              );
              
              // Flag the checkout day record to be skipped or merged
              checkOutRecord.notes = 'Part of previous day night shift';
            }
          }
        }
      }
    }
  }
};

// Export data to Excel file
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Create data array for the worksheet
  const sheetData: any[] = [];
  
  // Add header row
  sheetData.push([
    'Employee Number', 'Name', 'Department', 'Date', 
    'Check-In', 'Check-Out', 'Hours', 'Shift Type', 
    'Approved', 'Late', 'Early Leave', 'Penalty Minutes'
  ]);
  
  // Add data rows
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      sheetData.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        day.date,
        day.firstCheckIn ? day.firstCheckIn.toLocaleTimeString() : 'Missing',
        day.lastCheckOut ? day.lastCheckOut.toLocaleTimeString() : 'Missing',
        day.hoursWorked.toFixed(2),
        day.shiftType || 'Unknown',
        day.approved ? 'Yes' : 'No',
        day.isLate ? 'Yes' : 'No',
        day.earlyLeave ? 'Yes' : 'No',
        day.penaltyMinutes
      ]);
    });
  });
  
  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Employee Time Data');
  
  // Generate Excel file
  XLSX.writeFile(wb, 'EmployeeTimeData.xlsx');
};

// Export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Prepare summary data for the first sheet
  const summaryData: any[] = [];
  
  // Add header row
  summaryData.push([
    'Employee Number', 'Name', 'Total Days', 'Working Days',
    'Off Days', 'Regular Hours', 'Double-Time Hours', 'Total Payable Hours'
  ]);
  
  // Add data rows for summary
  data.summary.forEach((employee: any) => {
    const doubleTimeHours = employee.double_time_hours || 0;
    const regularHours = employee.total_hours || 0;
    const totalPayableHours = regularHours + doubleTimeHours;
    
    summaryData.push([
      employee.employee_number,
      employee.name,
      employee.total_days,
      employee.working_days || (employee.total_days - (employee.off_days_count || 0)),
      employee.off_days_count || 0,
      regularHours.toFixed(2),
      doubleTimeHours.toFixed(2),
      totalPayableHours.toFixed(2)
    ]);
  });
  
  // Create summary worksheet
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  
  // Add summary worksheet to workbook
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Hours Summary');
  
  // Prepare detailed data for the second sheet if available
  if (data.details && data.details.length > 0) {
    const detailsData: any[] = [];
    
    // Add header row for details
    detailsData.push([
      'Date', 'Employee', 'Number', 'Check-In', 'Check-Out', 
      'Shift Type', 'Hours', 'Double-Time', 'Total', 'Notes'
    ]);
    
    // Add data rows for details
    data.details.forEach((record: any) => {
      const isDoubleTimeDay = data.doubleDays?.includes(record.working_week_start || record.timestamp?.split('T')[0]);
      const hours = parseFloat(record.exact_hours || 0);
      const doubleTimeHours = isDoubleTimeDay ? hours : 0;
      const totalPayableHours = hours + doubleTimeHours;
      
      detailsData.push([
        record.working_week_start || (record.timestamp ? record.timestamp.split('T')[0] : ''),
        record.employees?.name || '',
        record.employees?.employee_number || '',
        record.display_check_in || (record.status === 'check_in' ? record.timestamp?.split('T')[1].substring(0, 5) : ''),
        record.display_check_out || (record.status === 'check_out' ? record.timestamp?.split('T')[1].substring(0, 5) : ''),
        record.shift_type || '',
        hours.toFixed(2),
        doubleTimeHours.toFixed(2),
        totalPayableHours.toFixed(2),
        record.notes || ''
      ]);
    });
    
    // Create details worksheet
    const detailsWs = XLSX.utils.aoa_to_sheet(detailsData);
    
    // Add details worksheet to workbook
    XLSX.utils.book_append_sheet(wb, detailsWs, 'Daily Records');
  }
  
  // Generate Excel file with date in filename
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  XLSX.writeFile(wb, `ApprovedHours_${dateStr}.xlsx`);
};