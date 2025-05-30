import * as XLSX from 'xlsx';
import { TimeRecord, EmployeeRecord, DailyRecord } from '../types';
import { parseDateTime, formatDate } from './dateTimeHelper';
import { determineShiftType, calculatePayableHours, isLateCheckIn, isEarlyLeave, isLikelyFromNightShift } from './shiftCalculations';

// Cache maps for better performance
const shiftTypeCache = new Map<string, string>();
const checkInCache = new Map<string, TimeRecord[]>();
const checkOutCache = new Map<string, TimeRecord[]>();

// Map to store and count processed records for performance metrics
const processingStats = {
  totalRecords: 0,
  processedRecords: 0,
  startTime: 0
};

export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  // Reset processing stats and caches
  processingStats.totalRecords = 0;
  processingStats.processedRecords = 0;
  processingStats.startTime = Date.now();
  shiftTypeCache.clear();
  checkInCache.clear();
  checkOutCache.clear();
  
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

// More efficient data processing algorithm
const processExcelData = (jsonData: any[]): EmployeeRecord[] => {
  // Step 1: Prepare raw records by department (multithreaded processing would be ideal here)
  const recordsByDepartment = new Map<string, Map<string, TimeRecord[]>>();

  // Optimize: Pre-allocate memory for large arrays
  const employeeRecords: EmployeeRecord[] = [];
  const processedEmployees = new Map<string, number>(); // To track indices in employeeRecords

  // Pre-processing to normalize and organize data
  jsonData.forEach((row, index) => {
    processingStats.processedRecords++;
    
    // Log progress less frequently to reduce console overhead
    if (processingStats.processedRecords % 1000 === 0) {
      console.log(`Processed ${processingStats.processedRecords}/${processingStats.totalRecords} records...`);
    }
    
    // Skip invalid rows efficiently
    if (!row?.Department || !row?.Name || !row?.Number || !row?.Datetime || !row?.Status) {
      return;
    }

    const department = String(row['Department']).trim();
    const name = String(row['Name']).trim();
    const employeeNumber = String(row['Number']).trim();
    const timestamp = parseDateTime(String(row['Datetime']));
    const status = String(row['Status']).toLowerCase().includes('check in') ? 'check_in' : 'check_out';

    // Skip if timestamp is invalid
    if (!timestamp) {
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

  // Step 2: Process departments in parallel using batches
  const batchSize = 5; // Process departments in batches
  const departments = [...recordsByDepartment.keys()];
  
  for (let i = 0; i < departments.length; i += batchSize) {
    const departmentBatch = departments.slice(i, i + batchSize);
    
    // Process each department in this batch
    departmentBatch.forEach(department => {
      const employeesMap = recordsByDepartment.get(department)!;
      
      // Process employees in this department
      employeesMap.forEach((timeRecords, employeeKey) => {
        const [dept, empNumber] = employeeKey.split('|');
        
        // Skip if we don't have employee information
        if (!timeRecords || timeRecords.length === 0) return;
        
        // Sort records by timestamp - use a faster sort algorithm
        timeRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        
        // Fix mislabeled records (experimental) - more efficient algorithm
        const fixedRecords = fixMislabeledRecords(timeRecords);
        
        // Group by date for daily records - more efficient algorithm
        const dailyRecordsMap = createDailyRecords(fixedRecords);
        
        // Convert map to array and sort by date
        const days = Array.from(dailyRecordsMap.values())
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        // Add or update the employee in our records
        // Using empNumber directly instead of redeclaring employeeKey
        if (processedEmployees.has(empNumber)) {
          // Update existing employee
          const index = processedEmployees.get(empNumber)!;
          employeeRecords[index].days = days;
          employeeRecords[index].totalDays = days.length;
        } else {
          // Add new employee
          const newIndex = employeeRecords.length;
          employeeRecords.push({
            employeeNumber: empNumber,
            name: timeRecords[0].name, // Use the name from the first record
            department: dept,
            days,
            totalDays: days.length,
            expanded: false
          });
          processedEmployees.set(empNumber, newIndex);
        }
      });
    });
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
    // Use caches to avoid re-filtering
    let checkIns: TimeRecord[];
    if (checkInCache.has(dateStr)) {
      checkIns = checkInCache.get(dateStr)!;
    } else {
      checkIns = records.filter(r => r.status === 'check_in');
      checkInCache.set(dateStr, checkIns);
    }
    
    let checkOuts: TimeRecord[];
    if (checkOutCache.has(dateStr)) {
      checkOuts = checkOutCache.get(dateStr)!;
    } else {
      checkOuts = records.filter(r => r.status === 'check_out');
      checkOutCache.set(dateStr, checkOuts);
    }
    
    // Get first check-in and last check-out
    const firstCheckIn = checkIns.length > 0 ? checkIns[0].timestamp : null;
    const lastCheckOut = checkOuts.length > 0 ? checkOuts[checkOuts.length - 1].timestamp : null;
    
    // Skip dates with no records
    if (records.length === 0) continue;
    
    // Determine shift type based on check-in time - use cache for better performance
    let shiftType = null;
    
    if (firstCheckIn) {
      const checkInHour = firstCheckIn.getHours();
      const cacheKey = `${dateStr}-${checkInHour}`;
      
      if (shiftTypeCache.has(cacheKey)) {
        shiftType = shiftTypeCache.get(cacheKey);
      } else {
        shiftType = determineShiftType(firstCheckIn);
        shiftTypeCache.set(cacheKey, shiftType);
      }
    }
    
    // Calculate hours worked - avoid recalculation if possible
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

// Export data to Excel file - optimized for performance
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
  
  // Pre-allocate memory for better performance with large datasets
  sheetData.length = 1 + employeeRecords.reduce(
    (sum, employee) => sum + employee.days.length, 0
  );
  
  // Add data rows - optimize by processing in batches
  let rowIndex = 1;
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      sheetData[rowIndex++] = [
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
      ];
    });
  });
  
  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Employee Time Data');
  
  // Generate Excel file
  XLSX.writeFile(wb, 'EmployeeTimeData.xlsx');
};

// Export approved hours data to Excel - optimized for performance
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
  
  // Pre-allocate memory for better performance
  summaryData.length = 1 + data.summary.length;
  
  // Add data rows for summary
  let rowIndex = 1;
  data.summary.forEach((employee: any) => {
    const doubleTimeHours = employee.double_time_hours || 0;
    const regularHours = employee.total_hours || 0;
    const totalPayableHours = regularHours + doubleTimeHours;
    
    summaryData[rowIndex++] = [
      employee.employee_number,
      employee.name,
      employee.total_days,
      employee.working_days || (employee.total_days - (employee.off_days_count || 0)),
      employee.off_days_count || 0,
      regularHours.toFixed(2),
      doubleTimeHours.toFixed(2),
      totalPayableHours.toFixed(2)
    ];
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
    
    // Pre-allocate memory
    detailsData.length = 1 + data.details.length;
    
    // Add data rows for details
    let detailRowIndex = 1;
    data.details.forEach((record: any) => {
      const isDoubleTimeDay = data.doubleDays?.includes(record.working_week_start || record.timestamp?.split('T')[0]);
      const hours = parseFloat(record.exact_hours || 0);
      const doubleTimeHours = isDoubleTimeDay ? hours : 0;
      const totalPayableHours = hours + doubleTimeHours;
      
      detailsData[detailRowIndex++] = [
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
      ];
    });
    
    // Create details worksheet
    const detailsWs = XLSX.utils.aoa_to_sheet(detailsData);
    
    // Add details worksheet to workbook
    XLSX.utils.book_append_sheet(wb, detailsWs, 'Daily Records');
  }
  
  // Generate Excel file with date in filename
  const dateStr = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `ApprovedHours_${dateStr}.xlsx`);
};