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
        
        // Try to read the Excel file with different options to improve compatibility
        let workbook;
        try {
          // First attempt with standard options
          workbook = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd hh:mm:ss' });
        } catch (readError) {
          console.error('First attempt to read Excel file failed, trying with alternative options:', readError);
          // Second attempt with more permissive options
          workbook = XLSX.read(data, { type: 'array', raw: true });
        }

        if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
          reject(new Error('Invalid Excel file format or empty file'));
          return;
        }

        // Use the first sheet (assuming Face ID Data is there)
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        if (!worksheet) {
          reject(new Error('Worksheet not found in the Excel file'));
          return;
        }

        // Convert to JSON with more robust options
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false, 
          dateNF: 'yyyy-mm-dd hh:mm:ss',
          defval: '', // Use empty string for empty cells
          blankrows: false // Skip blank rows
        });
        
        // Log the total number of records for progress tracking
        processingStats.totalRecords = jsonData.length;
        console.log(`Processing ${processingStats.totalRecords} records from Excel file...`);

        if (jsonData.length === 0) {
          // Provide more detailed error information
          const headers = XLSX.utils.sheet_to_json(worksheet, { header: 1 })[0];
          console.error('No data found in Excel file. Headers:', headers);
          reject(new Error('No data found in the Excel file. Please check the file format and ensure it contains valid data.'));
          return;
        }

        // Analyze the first few rows to determine column structure
        console.log('Sample of first row:', JSON.stringify(jsonData[0]));
        
        // Process the data using a more efficient algorithm
        const processedData = processExcelData(jsonData);
        console.log(`Processing completed in ${(Date.now() - processingStats.startTime) / 1000} seconds.`);
        
        if (processedData.length === 0) {
          reject(new Error('Could not extract any employee records from the file. Please check that the file contains required columns: Department, Name, Number/ID, Datetime, and Status.'));
          return;
        }
        
        resolve(processedData);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(error instanceof Error 
          ? error 
          : new Error('Unknown error processing Excel file. Please try a different file format.'));
      }
    };

    reader.onerror = (e) => {
      console.error('Error reading file:', e);
      reject(new Error('Error reading file. The file may be corrupted or access denied.'));
    };

    reader.readAsArrayBuffer(file);
  });
};

// Helper function to normalize column names for robust parsing
const normalizeColumnName = (name: string): string => {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '') // Remove all spaces
    .replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric chars
};

// Helper function to get value from row with normalized column name
const getColumnValue = (row: any, columnName: string): string | null => {
  // Normalize the column name we're looking for
  const normalizedColumnName = normalizeColumnName(columnName);
  
  // If empty column name, return null
  if (!normalizedColumnName) return null;
  
  // Find the matching column in the row
  for (const key in row) {
    if (normalizeColumnName(key) === normalizedColumnName) {
      return row[key] !== undefined && row[key] !== null ? String(row[key]).trim() : null;
    }
  }
  
  return null;
};

// Function to detect column names in the data
const detectColumnNames = (jsonData: any[]): {
  departmentCol: string | null;
  nameCol: string | null;
  employeeNumberCol: string | null;
  datetimeCol: string | null;
  statusCol: string | null;
} => {
  // If no data, return all null
  if (!jsonData || jsonData.length === 0 || !jsonData[0]) {
    return {
      departmentCol: null,
      nameCol: null,
      employeeNumberCol: null,
      datetimeCol: null,
      statusCol: null
    };
  }
  
  const firstRow = jsonData[0];
  
  // Common variations of column names
  const departmentVariations = ['Department', 'Dept', 'dept', 'department', 'DEPARTMENT', 'Division'];
  const nameVariations = ['Name', 'name', 'NAME', 'EmployeeName', 'Employee Name', 'Full Name', 'Staff Name'];
  const employeeNumberVariations = ['Number', 'Employee Number', 'ID', 'EmployeeID', 'Staff ID', 'Employee ID', 'EmpNo', 'Emp No'];
  const datetimeVariations = ['Datetime', 'Date Time', 'DateTime', 'Time', 'Timestamp', 'Date', 'CheckTime', 'Check Time', 'Time Stamp'];
  const statusVariations = ['Status', 'Check Type', 'CheckType', 'Type', 'In/Out', 'InOut', 'Direction'];
  
  // Find matching columns
  let departmentCol = null;
  for (const col of departmentVariations) {
    if (getColumnValue(firstRow, col) !== null || firstRow[col] !== undefined) {
      departmentCol = col;
      break;
    }
  }
  
  let nameCol = null;
  for (const col of nameVariations) {
    if (getColumnValue(firstRow, col) !== null || firstRow[col] !== undefined) {
      nameCol = col;
      break;
    }
  }
  
  let employeeNumberCol = null;
  for (const col of employeeNumberVariations) {
    if (getColumnValue(firstRow, col) !== null || firstRow[col] !== undefined) {
      employeeNumberCol = col;
      break;
    }
  }
  
  let datetimeCol = null;
  for (const col of datetimeVariations) {
    if (getColumnValue(firstRow, col) !== null || firstRow[col] !== undefined) {
      datetimeCol = col;
      break;
    }
  }
  
  let statusCol = null;
  for (const col of statusVariations) {
    if (getColumnValue(firstRow, col) !== null || firstRow[col] !== undefined) {
      statusCol = col;
      break;
    }
  }
  
  console.log('Detected columns:', {
    departmentCol,
    nameCol,
    employeeNumberCol,
    datetimeCol,
    statusCol
  });
  
  return {
    departmentCol,
    nameCol,
    employeeNumberCol,
    datetimeCol,
    statusCol
  };
};

// More efficient data processing algorithm
const processExcelData = (jsonData: any[]): EmployeeRecord[] => {
  if (!jsonData || jsonData.length === 0) {
    console.error('No data provided to process');
    return [];
  }
  
  // First, detect the column names in the data
  const { 
    departmentCol, 
    nameCol, 
    employeeNumberCol, 
    datetimeCol, 
    statusCol 
  } = detectColumnNames(jsonData);
  
  // Validate that we have the required columns
  if (!departmentCol || !nameCol || !employeeNumberCol || !datetimeCol || !statusCol) {
    console.error('Missing required columns in Excel file', {
      departmentCol,
      nameCol,
      employeeNumberCol,
      datetimeCol,
      statusCol
    });
    return [];
  }
  
  // Step 1: Prepare raw records by department
  const recordsByDepartment = new Map<string, Map<string, TimeRecord[]>>();

  // Pre-processing to normalize and organize data
  let processedRows = 0;
  let validRows = 0;
  let skippedRows = 0;
  
  jsonData.forEach((row, index) => {
    processingStats.processedRecords++;
    processedRows++;
    
    // Log progress every 500 records
    if (processingStats.processedRecords % 500 === 0) {
      console.log(`Processed ${processingStats.processedRecords}/${processingStats.totalRecords} records...`);
    }
    
    // Get values using the detected column names
    const departmentValue = getColumnValue(row, departmentCol);
    const nameValue = getColumnValue(row, nameCol);
    const employeeNumberValue = getColumnValue(row, employeeNumberCol);
    const datetimeValue = getColumnValue(row, datetimeCol);
    const statusValue = getColumnValue(row, statusCol);
    
    // Skip rows with missing values, but log them for debugging
    if (!departmentValue || !nameValue || !employeeNumberValue || !datetimeValue || !statusValue) {
      skippedRows++;
      if (skippedRows < 10) { // Limit logging to prevent console flood
        console.log(`Skipping row ${index + 1} due to missing required values:`, {
          department: departmentValue,
          name: nameValue,
          employeeNumber: employeeNumberValue,
          datetime: datetimeValue,
          status: statusValue,
          row: row
        });
      }
      return;
    }
    
    // Normalize values
    const department = String(departmentValue).trim();
    const name = String(nameValue).trim();
    const employeeNumber = String(employeeNumberValue).trim();
    
    // Try multiple date parsing approaches
    let timestamp = parseDateTime(String(datetimeValue));
    
    // If first attempt fails, try alternative approaches
    if (!timestamp && typeof datetimeValue === 'string') {
      // Try extracting date part only
      const dateMatch = datetimeValue.match(/(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})/);
      if (dateMatch) {
        // Try to parse with different date formats
        const dateFormats = ['MM/dd/yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy'];
        for (const format of dateFormats) {
          try {
            timestamp = parseDateTime(`${datetimeValue} 12:00:00`);
            if (timestamp) break;
          } catch (e) {
            // Continue trying other formats
          }
        }
      }
    }
    
    // Skip if timestamp is still invalid after multiple attempts
    if (!timestamp) {
      skippedRows++;
      console.log(`Skipping row ${index + 1} due to invalid timestamp: ${datetimeValue}`);
      return;
    }
    
    // Determine status (check-in vs check-out)
    const status = statusValue.toLowerCase().includes('in') || 
                   statusValue.toLowerCase() === 'i' ? 
                   'check_in' : 'check_out';
    
    validRows++;
    
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

  console.log(`Processing stats: Total rows: ${processedRows}, Valid: ${validRows}, Skipped: ${skippedRows}`);
  
  // If no valid rows were processed, return empty array
  if (validRows === 0) {
    console.error('No valid rows found in Excel file');
    return [];
  }

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
        record.display_check_in || (record.status === 'check_in' ? record.timestamp?.split('T')[1]?.substring(0, 5) : ''),
        record.display_check_out || (record.status === 'check_out' ? record.timestamp?.split('T')[1]?.substring(0, 5) : ''),
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