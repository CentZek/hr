// Excel data processing utilities
import * as XLSX from 'xlsx';
import { EmployeeRecord, TimeRecord, DailyRecord } from '../types';
import { format, parse, addDays, subDays, getDay, differenceInMinutes, isValid, parseISO } from 'date-fns';
import { calculatePayableHours, determineShiftType, isLateCheckIn, isEarlyLeave, isExcessiveOvertime } from './shiftCalculations';
import { parseShiftTimes, formatTime24H } from './dateTimeHelper';

/**
 * Handles the Excel file upload and data extraction
 * @param {File} file The Excel file to process
 * @returns {Promise<EmployeeRecord[]>} Array of employee records
 */
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        if (!e.target?.result) {
          reject(new Error('Failed to read file'));
          return;
        }

        const data = e.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON with headers
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in the Excel file'));
          return;
        }
        
        console.log('Excel data loaded:', jsonData.length, 'rows');
        console.log('Sample row:', jsonData[0]);
        
        // Process the Excel data
        const employeeRecords = processExcelData(jsonData);
        
        if (!employeeRecords || employeeRecords.length === 0) {
          reject(new Error('No valid records found in the file. Please check that your Excel file:\n• Contains employee data with check-in/check-out times\n• Has the correct column headers\n• Has at least one valid employee record'));
          return;
        }
        
        resolve(employeeRecords);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsBinaryString(file);
  });
};

/**
 * Processes the raw Excel data to extract employee records
 * @param {any[]} data The JSON data from Excel
 * @returns {EmployeeRecord[]} Array of employee records
 */
export const processExcelData = (data: any[]): EmployeeRecord[] => {
  if (!data || data.length === 0) {
    throw new Error('No data found in the Excel file');
  }
  
  // Get all column keys from the data
  const allKeys = new Set<string>();
  data.forEach(row => {
    Object.keys(row).forEach(key => allKeys.add(key));
  });
  const keys = Array.from(allKeys);
  
  // Log available columns for debugging
  console.log('Available columns:', keys);
  
  // Find required column names with flexible matching
  let departmentColumn = '';
  let nameColumn = '';
  let employeeNumberColumn = '';
  let timestampColumn = '';
  let statusColumn = '';
  
  // Look for column names with various patterns
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    
    // Department column
    if (
      lowerKey.includes('department') || 
      lowerKey.includes('dept') || 
      lowerKey === 'department' || 
      lowerKey === 'dept' || 
      lowerKey === 'dep'
    ) {
      departmentColumn = key;
    } 
    // Name column
    else if (
      lowerKey.includes('name') || 
      lowerKey.includes('employee name') || 
      lowerKey === 'name' || 
      lowerKey === 'employee name'
    ) {
      nameColumn = key;
    } 
    // Employee number column
    else if (
      lowerKey.includes('employee no') || 
      lowerKey.includes('employee number') || 
      lowerKey.includes('number') || 
      lowerKey.includes('emp no') || 
      lowerKey.includes('emp #') || 
      lowerKey === 'employee number' || 
      lowerKey === 'no.' || 
      lowerKey === 'no' || 
      lowerKey === '#'
    ) {
      employeeNumberColumn = key;
    } 
    // Timestamp column
    else if (
      lowerKey.includes('date') || 
      lowerKey.includes('time') || 
      lowerKey.includes('timestamp') || 
      lowerKey.includes('check time') || 
      lowerKey === 'date' || 
      lowerKey === 'time' ||
      lowerKey === 'check time'
    ) {
      timestampColumn = key;
    } 
    // Status column
    else if (
      lowerKey.includes('status') || 
      lowerKey.includes('type') || 
      lowerKey.includes('check type') || 
      lowerKey === 'status' || 
      lowerKey === 'type' ||
      lowerKey === 'check type'
    ) {
      statusColumn = key;
    }
  }
  
  console.log('Identified columns:', {
    departmentColumn,
    nameColumn,
    employeeNumberColumn,
    timestampColumn,
    statusColumn
  });

  // If we couldn't identify columns by name, try to infer from data
  if (!nameColumn || !employeeNumberColumn || !timestampColumn || !statusColumn) {
    console.log('Could not identify all required columns by name. Attempting to infer from data patterns.');
    
    // Find columns by data patterns
    for (const key of keys) {
      // Skip already identified columns
      if (
        key === departmentColumn || 
        key === nameColumn || 
        key === employeeNumberColumn || 
        key === timestampColumn || 
        key === statusColumn
      ) {
        continue;
      }
      
      // Check sample values
      const sampleValues = data.slice(0, Math.min(10, data.length)).map(row => String(row[key] || ''));
      
      // Name column typically has space characters and not just numbers
      if (!nameColumn && sampleValues.some(val => val.includes(' ') && !/^\d+$/.test(val))) {
        nameColumn = key;
        console.log('Inferred name column:', key);
      }
      // Employee number often has only digits or short codes
      else if (!employeeNumberColumn && sampleValues.some(val => /^\d+$/.test(val) || /^[A-Z0-9]{2,10}$/i.test(val))) {
        employeeNumberColumn = key;
        console.log('Inferred employee number column:', key);
      }
      // Timestamp usually contains date/time separators
      else if (!timestampColumn && sampleValues.some(val => val.includes('/') || val.includes('-') || val.includes(':'))) {
        timestampColumn = key;
        console.log('Inferred timestamp column:', key);
      }
      // Status often contains keywords like "in" or "out"
      else if (!statusColumn && sampleValues.some(val => 
        ['in', 'out', 'check in', 'check out', 'ci', 'co'].includes(val.toLowerCase())
      )) {
        statusColumn = key;
        console.log('Inferred status column:', key);
      }
    }
  }
  
  // If still missing critical columns, throw an error
  if (!nameColumn || !employeeNumberColumn || !timestampColumn) {
    throw new Error(
      `Unable to find required columns in Excel file. Please ensure the file contains:\n` +
      `- Employee name column (found: ${nameColumn || 'No'})\n` +
      `- Employee number column (found: ${employeeNumberColumn || 'No'})\n` +
      `- Timestamp column (found: ${timestampColumn || 'No'})\n\n` +
      `Available columns: ${keys.join(', ')}`
    );
  }

  // Extract time records from the Excel data
  const timeRecords: TimeRecord[] = [];
  
  for (const row of data) {
    // Skip rows with missing required data
    if (!row[nameColumn] || !row[employeeNumberColumn] || !row[timestampColumn]) {
      continue;
    }
    
    // Parse status - default to check_in if missing
    let status: 'check_in' | 'check_out';
    if (statusColumn && row[statusColumn]) {
      const statusValue = String(row[statusColumn]).trim().toLowerCase();
      
      if (
        statusValue === 'check in' || 
        statusValue === 'checkin' || 
        statusValue === 'ci' || 
        statusValue === 'in' || 
        statusValue === 'c/i' || 
        statusValue === 'c i' ||
        statusValue === 'i'
      ) {
        status = 'check_in';
      } else {
        status = 'check_out';
      }
    } else {
      // Default to check_in if no status column
      status = 'check_in';
    }
    
    // Parse timestamp with better error handling
    let timestamp: Date | null = null;
    try {
      // Try parsing directly first
      const rawTimestamp = String(row[timestampColumn]);
      
      // Try standard Date parsing
      timestamp = new Date(rawTimestamp);
      
      // If that doesn't work, try common date formats
      if (isNaN(timestamp.getTime())) {
        // Try Excel serial date format
        const serialDate = parseFloat(rawTimestamp);
        if (!isNaN(serialDate)) {
          // Convert Excel serial date to JS Date
          const millisecondsPerDay = 24 * 60 * 60 * 1000;
          timestamp = new Date((serialDate - 25569) * millisecondsPerDay);
        } else {
          // Try common date formats
          const dateFormats = [
            'MM/dd/yyyy HH:mm:ss',
            'dd/MM/yyyy HH:mm:ss',
            'yyyy-MM-dd HH:mm:ss',
            'MM/dd/yyyy HH:mm',
            'dd/MM/yyyy HH:mm',
            'yyyy-MM-dd HH:mm'
          ];
          
          for (const formatStr of dateFormats) {
            try {
              timestamp = parse(rawTimestamp, formatStr, new Date());
              if (!isNaN(timestamp.getTime())) {
                break;
              }
            } catch (e) {
              // Try next format
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse timestamp, skipping record');
      continue;
    }
    
    // Skip if timestamp is invalid
    if (!timestamp || isNaN(timestamp.getTime())) {
      continue;
    }
    
    // Add valid record to timeRecords
    timeRecords.push({
      department: departmentColumn ? row[departmentColumn] || '' : '',
      name: String(row[nameColumn]),
      employeeNumber: String(row[employeeNumberColumn]),
      timestamp,
      status,
      originalIndex: timeRecords.length // Store original position
    });
  }
  
  console.log('Processed time records:', timeRecords.length);
  
  // Process time records to group by employee
  return processTimeRecords(timeRecords);
};

/**
 * Process time records to group them by employee and date
 * @param {TimeRecord[]} timeRecords Time records to process
 * @returns {EmployeeRecord[]} Processed employee records
 */
export const processTimeRecords = (timeRecords: TimeRecord[]): EmployeeRecord[] => {
  // First fix any potentially mislabeled records
  const fixedRecords = fixMislabeledRecords(timeRecords);
  
  // Group time records by employee and date
  const employeeMap = new Map<string, {
    name: string;
    department: string;
    days: Map<string, {
      date: string;
      records: TimeRecord[];
    }>
  }>();
  
  fixedRecords.forEach(record => {
    const date = format(record.timestamp, 'yyyy-MM-dd');
    const employeeNumber = String(record.employeeNumber).trim();
    
    // Initialize employee data if not exists
    if (!employeeMap.has(employeeNumber)) {
      employeeMap.set(employeeNumber, {
        name: record.name,
        department: record.department,
        days: new Map()
      });
    }
    
    // Get employee data
    const employeeData = employeeMap.get(employeeNumber)!;
    
    // Initialize day data if not exists
    if (!employeeData.days.has(date)) {
      employeeData.days.set(date, {
        date,
        records: []
      });
    }
    
    // Add record to day
    employeeData.days.get(date)!.records.push(record);
  });
  
  console.log('Employee count:', employeeMap.size);
  
  // Process each employee's data
  const employeeRecords: EmployeeRecord[] = [];
  
  employeeMap.forEach((employeeData, employeeNumber) => {
    const days: DailyRecord[] = [];
    
    // Process each day's records
    employeeData.days.forEach(dayData => {
      // Determine shift type for all records in the day
      assignShiftType(dayData.records);
      
      // Process day records
      const day = processDay(dayData.date, dayData.records);
      days.push(day);
    });
    
    // Add employee record
    employeeRecords.push({
      employeeNumber,
      name: employeeData.name,
      department: employeeData.department,
      days,
      totalDays: days.length,
      expanded: false
    });
  });
  
  return employeeRecords;
};

/**
 * Fix potentially mislabeled check-in/check-out records
 * @param {TimeRecord[]} records Time records to fix
 * @returns {TimeRecord[]} Fixed records
 */
export const fixMislabeledRecords = (records: TimeRecord[]): TimeRecord[] => {
  // Group records by employee and date
  const recordsByEmployeeDate = new Map<string, TimeRecord[]>();
  
  records.forEach(record => {
    const date = format(record.timestamp, 'yyyy-MM-dd');
    const key = `${record.employeeNumber}|${date}`;
    
    if (!recordsByEmployeeDate.has(key)) {
      recordsByEmployeeDate.set(key, []);
    }
    
    recordsByEmployeeDate.get(key)!.push({ ...record }); // Clone record
  });
  
  // Process each employee's daily records
  recordsByEmployeeDate.forEach(dayRecords => {
    if (dayRecords.length < 2) return; // Skip if only one record
    
    // Sort by timestamp
    dayRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Check for consecutive records with the same status
    for (let i = 0; i < dayRecords.length - 1; i++) {
      const currentRecord = dayRecords[i];
      const nextRecord = dayRecords[i + 1];
      
      if (currentRecord.status === nextRecord.status) {
        // If two consecutive check-ins, mark the second as check-out
        if (currentRecord.status === 'check_in') {
          nextRecord.mislabeled = true;
          nextRecord.originalStatus = 'check_in';
          nextRecord.status = 'check_out';
          nextRecord.notes = 'Fixed mislabeled check-in → check-out';
        } 
        // If two consecutive check-outs, mark the first as check-in
        else if (currentRecord.status === 'check_out') {
          currentRecord.mislabeled = true;
          currentRecord.originalStatus = 'check_out';
          currentRecord.status = 'check_in';
          currentRecord.notes = 'Fixed mislabeled check-out → check-in';
        }
      }
    }
  });
  
  // Flatten back to a single array
  const fixedRecords: TimeRecord[] = [];
  recordsByEmployeeDate.forEach(records => {
    fixedRecords.push(...records);
  });
  
  return fixedRecords;
};

/**
 * Assign a shift type to all records in a day
 * @param {TimeRecord[]} records Records for a single day
 */
export const assignShiftType = (records: TimeRecord[]): void => {
  if (records.length === 0) return;
  
  // Sort by timestamp
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Get check-in records
  const checkIns = records.filter(r => r.status === 'check_in');
  
  // If no check-ins, try to determine from check-outs
  if (checkIns.length === 0) {
    const checkOuts = records.filter(r => r.status === 'check_out');
    if (checkOuts.length > 0) {
      // Use first check-out to determine shift type
      const shiftType = determineShiftType(checkOuts[0].timestamp);
      
      // Assign shift type to all records
      records.forEach(r => {
        r.shift_type = shiftType;
      });
    }
    return;
  }
  
  // Use first check-in to determine shift type
  const shiftType = determineShiftType(checkIns[0].timestamp);
  
  // Assign shift type to all records
  records.forEach(r => {
    r.shift_type = shiftType;
  });
};

/**
 * Process a single day's records
 * @param {string} date Date string in YYYY-MM-DD format
 * @param {TimeRecord[]} records Time records for this day
 * @returns {DailyRecord} Processed daily record
 */
export const processDay = (date: string, records: TimeRecord[]): DailyRecord => {
  // Sort records by timestamp
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Get check-in and check-out records
  const checkIns = records.filter(r => r.status === 'check_in');
  const checkOuts = records.filter(r => r.status === 'check_out');
  
  // Get earliest check-in and latest check-out
  const firstCheckIn = checkIns.length > 0 ? checkIns[0].timestamp : null;
  const lastCheckOut = checkOuts.length > 0 ? checkOuts[checkOuts.length - 1].timestamp : null;
  
  // Determine shift type
  let shiftType = null;
  if (firstCheckIn) {
    shiftType = determineShiftType(firstCheckIn);
  } else if (checkOuts.length > 0) {
    // Try to determine from check-out if no check-in
    shiftType = determineShiftType(checkOuts[0].timestamp);
  }
  
  // Calculate hours worked and check for issues
  let hoursWorked = 0;
  let isLate = false;
  let earlyLeave = false;
  let excessiveOvertime = false;
  let isCrossDay = false;
  
  if (firstCheckIn && lastCheckOut) {
    // Check if this is a night shift that crosses days
    if (shiftType === 'night') {
      // For night shifts, ensure proper day handling
      const { checkIn, checkOut } = parseShiftTimes(
        date,
        format(firstCheckIn, 'HH:mm'),
        format(lastCheckOut, 'HH:mm'),
        'night'
      );
      
      hoursWorked = calculatePayableHours(checkIn, checkOut, 'night', 0, true);
      isCrossDay = true;
    } else {
      // For day shifts, use standard calculation
      hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, shiftType, 0, true);
    }
    
    // Check for issues
    if (firstCheckIn) {
      isLate = isLateCheckIn(firstCheckIn, shiftType);
    }
    
    if (lastCheckOut) {
      earlyLeave = isEarlyLeave(lastCheckOut, shiftType);
      excessiveOvertime = isExcessiveOvertime(lastCheckOut, shiftType);
    }
  }
  
  // Get display values for check-in and check-out
  let displayCheckIn = '';
  let displayCheckOut = '';
  
  if (firstCheckIn) {
    displayCheckIn = formatTime24H(firstCheckIn);
  } else {
    displayCheckIn = 'Missing';
  }
  
  if (lastCheckOut) {
    displayCheckOut = formatTime24H(lastCheckOut);
  } else {
    displayCheckOut = 'Missing';
  }

  // Create and return daily record
  return {
    date,
    firstCheckIn: firstCheckIn ? new Date(firstCheckIn) : null,
    lastCheckOut: lastCheckOut ? new Date(lastCheckOut) : null,
    hoursWorked,
    approved: false,
    shiftType,
    notes: checkIns.some(r => r.mislabeled) || checkOuts.some(r => r.mislabeled) ? 'Fixed mislabeled records' : '',
    missingCheckIn: checkIns.length === 0,
    missingCheckOut: checkOuts.length === 0,
    isLate,
    earlyLeave,
    excessiveOvertime,
    penaltyMinutes: 0,
    correctedRecords: checkIns.some(r => r.mislabeled) || checkOuts.some(r => r.mislabeled),
    allTimeRecords: records,
    hasMultipleRecords: records.length > 2,
    isCrossDay,
    displayCheckIn,
    displayCheckOut
  };
};

/**
 * Export employee records to Excel file
 * @param {EmployeeRecord[]} records Employee records to export
 */
export const exportToExcel = (records: EmployeeRecord[]): void => {
  // Prepare data for export
  const rows: any[] = [];
  
  // Add header row
  rows.push([
    'Employee Number',
    'Name',
    'Department',
    'Date',
    'First Check-in',
    'Last Check-out',
    'Hours Worked',
    'Status',
    'Shift Type',
    'Notes',
    'Issues',
    'Penalty (Minutes)'
  ]);
  
  // Add data rows
  records.forEach(employee => {
    employee.days.forEach(day => {
      // Collect issues
      const issues = [];
      if (day.missingCheckIn) issues.push('Missing check-in');
      if (day.missingCheckOut) issues.push('Missing check-out');
      if (day.isLate) issues.push('Late check-in');
      if (day.earlyLeave) issues.push('Early leave');
      if (day.excessiveOvertime) issues.push('Excessive overtime');
      
      // Add row
      rows.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        day.date,
        day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm:ss') : 'Missing',
        day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm:ss') : 'Missing',
        day.hoursWorked.toFixed(2),
        day.approved ? 'Approved' : 'Pending',
        day.shiftType || 'Unknown',
        day.notes,
        issues.join(', '),
        day.penaltyMinutes
      ]);
    });
  });
  
  // Create worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  
  // Create workbook and add worksheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Employee Time Records');
  
  // Generate file name
  const fileName = `Employee_Time_Records_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  
  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

/**
 * Export approved hours to Excel
 * @param {any} data Data to export
 */
export const exportApprovedHoursToExcel = (data: any): void => {
  // Extract data
  const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
  
  // Create workbook
  const workbook = XLSX.utils.book_new();
  
  // Prepare summary sheet
  const summaryRows: any[] = [
    [
      'Employee Number',
      'Employee Name',
      'Total Days',
      'Regular Hours',
      'Double-Time Hours',
      'Total Payable Hours'
    ]
  ];
  
  // Add summary data
  summary.forEach((employee: any) => {
    // Calculate double-time hours
    let doubleTimeHours = 0;
    if (employee.working_week_dates && employee.hours_by_date) {
      employee.working_week_dates.forEach((date: string) => {
        if (doubleDays.includes(date)) {
          doubleTimeHours += employee.hours_by_date[date] || 0;
        }
      });
    } else if (employee.double_time_hours) {
      // Use pre-calculated value if available
      doubleTimeHours = employee.double_time_hours;
    }
    
    // Add row
    summaryRows.push([
      employee.employee_number,
      employee.name,
      employee.total_days,
      employee.total_hours.toFixed(2),
      doubleTimeHours.toFixed(2),
      (employee.total_hours + doubleTimeHours).toFixed(2)
    ]);
  });
  
  // Add summary worksheet
  const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
  
  // Prepare details sheet if we have details
  if (details && details.length > 0) {
    const detailsRows: any[] = [
      [
        'Employee Number',
        'Employee Name',
        'Date',
        'Check In',
        'Check Out',
        'Shift Type',
        'Hours',
        'Double-Time',
        'Status'
      ]
    ];
    
    // Group records by date and employee
    const recordsByDateEmployee: Record<string, Record<string, any[]>> = {};
    
    details.forEach(record => {
      if (!record.working_week_start) return;
      
      const dateKey = record.working_week_start;
      const employeeId = record.employee_id;
      
      if (!recordsByDateEmployee[dateKey]) {
        recordsByDateEmployee[dateKey] = {};
      }
      
      if (!recordsByDateEmployee[dateKey][employeeId]) {
        recordsByDateEmployee[dateKey][employeeId] = [];
      }
      
      recordsByDateEmployee[dateKey][employeeId].push(record);
    });
    
    // Process each date's records
    Object.keys(recordsByDateEmployee).sort().forEach(dateStr => {
      const dateRecords = recordsByDateEmployee[dateStr];
      
      Object.keys(dateRecords).forEach(employeeId => {
        const employeeRecords = dateRecords[employeeId];
        const checkIns = employeeRecords.filter(r => r.status === 'check_in');
        const checkOuts = employeeRecords.filter(r => r.status === 'check_out');
        const offDays = employeeRecords.filter(r => r.status === 'off_day');
        
        // If this is an OFF-DAY, add a special row
        if (offDays.length > 0) {
          const offDay = offDays[0];
          detailsRows.push([
            offDay.employees?.employee_number || '',
            offDay.employees?.name || '',
            dateStr,
            'OFF-DAY',
            'OFF-DAY',
            'OFF-DAY',
            '0.00',
            '0.00',
            'Approved'
          ]);
          return;
        }
        
        // Get check-in and check-out times
        const checkIn = checkIns.length > 0 ? checkIns[0] : null;
        const checkOut = checkOuts.length > 0 ? checkOuts[0] : null;
        
        // Skip if no records
        if (!checkIn && !checkOut) return;
        
        // Calculate hours - prefer exact_hours field
        let hours = 0;
        if (checkIn && checkIn.exact_hours !== null && checkIn.exact_hours !== undefined) {
          hours = parseFloat(checkIn.exact_hours);
        } else if (checkOut && checkOut.exact_hours !== null && checkOut.exact_hours !== undefined) {
          hours = parseFloat(checkOut.exact_hours);
        } else if (checkIn && checkOut) {
          // Calculate from timestamps if exact_hours not available
          const checkInTime = new Date(checkIn.timestamp);
          const checkOutTime = new Date(checkOut.timestamp);
          const diffMinutes = differenceInMinutes(checkOutTime, checkInTime);
          hours = diffMinutes / 60;
        }
        
        // Get the check-in and check-out display times
        const checkInDisplay = checkIn ? 
          (checkIn.display_check_in && checkIn.display_check_in !== 'Missing' ? 
            checkIn.display_check_in : 
            formatTime24H(new Date(checkIn.timestamp))) : 
          'Missing';
            
        const checkOutDisplay = checkOut ? 
          (checkOut.display_check_out && checkOut.display_check_out !== 'Missing' ? 
            checkOut.display_check_out : 
            formatTime24H(new Date(checkOut.timestamp))) : 
          'Missing';
        
        // Check if this is a double-time day
        const isDoubleTime = doubleDays.includes(dateStr);
        const doubleTimeHours = isDoubleTime ? hours : 0;
        
        // Add row
        detailsRows.push([
          checkIn?.employees?.employee_number || checkOut?.employees?.employee_number || '',
          checkIn?.employees?.name || checkOut?.employees?.name || '',
          dateStr,
          checkInDisplay,
          checkOutDisplay,
          checkIn?.shift_type || checkOut?.shift_type || 'Unknown',
          hours.toFixed(2),
          doubleTimeHours.toFixed(2),
          'Approved'
        ]);
      });
    });
    
    // Add details worksheet
    const detailsWorksheet = XLSX.utils.aoa_to_sheet(detailsRows);
    XLSX.utils.book_append_sheet(workbook, detailsWorksheet, 'Daily Details');
  }
  
  // Generate file name
  let fileName = 'Approved_Hours';
  
  if (filterMonth === 'custom' && dateRange) {
    fileName += `_${dateRange.startDate}_to_${dateRange.endDate}`;
  } else if (filterMonth !== 'all') {
    fileName += `_${filterMonth}`;
  }
  
  fileName += `_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  
  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

/**
 * Calculate statistics from employee records
 * @param {EmployeeRecord[]} records Employee records
 * @returns {Object} Statistics about the records
 */
export const calculateStats = (records: EmployeeRecord[]): {
  totalEmployees: number;
  totalDays: number;
} => {
  const totalEmployees = records.length;
  let totalDays = 0;
  
  records.forEach(employee => {
    totalDays += employee.days.length;
  });
  
  return {
    totalEmployees,
    totalDays
  };
};

/**
 * Process employee records after saving to database
 * @param {EmployeeRecord[]} records Employee records
 * @returns {EmployeeRecord[]} Updated records
 */
export const processRecordsAfterSave = (records: EmployeeRecord[]): EmployeeRecord[] => {
  // Filter out approved days and remove employees with no days left
  return records
    .map(employee => ({
      ...employee,
      days: employee.days.filter(day => !day.approved)
    }))
    .filter(employee => employee.days.length > 0);
};

/**
 * Add a manual entry to existing employee records
 * @param {any} recordData Manual entry data
 * @param {EmployeeRecord[]} employeeRecords Existing employee records
 * @returns {Object} Result with updated records and index
 */
export const addManualEntryToRecords = (
  recordData: any,
  employeeRecords: EmployeeRecord[],
): {
  updatedRecords: EmployeeRecord[];
  employeeIndex: number;
  isNewEmployee: boolean;
} => {
  const { employee, date, checkIn, checkOut, shiftType, checkInDate, checkOutDate } = recordData;
  
  if (!employee || !date) {
    throw new Error("Missing required data for manual entry");
  }
  
  // Use provided date objects if available, otherwise parse from strings
  let firstCheckIn: Date | null;
  let lastCheckOut: Date | null;
  
  if (checkInDate) {
    firstCheckIn = checkInDate;
  } else if (checkIn) {
    const { checkIn: parsedCheckIn } = parseShiftTimes(date, checkIn, checkOut || '00:00', shiftType);
    firstCheckIn = parsedCheckIn;
  } else {
    firstCheckIn = null;
  }
  
  if (checkOutDate) {
    lastCheckOut = checkOutDate;
  } else if (checkOut) {
    const { checkOut: parsedCheckOut } = parseShiftTimes(date, checkIn || '00:00', checkOut, shiftType);
    lastCheckOut = parsedCheckOut;
  } else {
    lastCheckOut = null;
  }
  
  // Calculate hours - always use standard 9 hours for manual entries
  const hoursWorked = 9.0;
  
  // Create dummy time records for the raw data view
  const allTimeRecords = [];
  if (firstCheckIn) {
    allTimeRecords.push({
      timestamp: firstCheckIn,
      status: 'check_in',
      shift_type: shiftType,
      notes: 'Manual entry',
      originalIndex: 0
    });
  }
  
  if (lastCheckOut) {
    allTimeRecords.push({
      timestamp: lastCheckOut,
      status: 'check_out',
      shift_type: shiftType,
      notes: 'Manual entry',
      originalIndex: 1
    });
  }
  
  // Get standard display times based on shift
  const getStandardDisplayTime = (type: string, timeType: 'start' | 'end') => {
    const displayTimes = {
      morning: { startTime: '05:00', endTime: '14:00' },
      evening: { startTime: '13:00', endTime: '22:00' },
      night: { startTime: '21:00', endTime: '06:00' },
      canteen: { startTime: '07:00', endTime: '16:00' } // Default to early canteen
    };
    
    if (!type || !displayTimes[type as keyof typeof displayTimes]) return '';
    
    return timeType === 'start' ? 
      displayTimes[type as keyof typeof displayTimes].startTime : 
      displayTimes[type as keyof typeof displayTimes].endTime;
  };
  
  // Create daily record
  const newDay: DailyRecord = {
    date,
    firstCheckIn,
    lastCheckOut,
    hoursWorked,
    approved: false, // Start as pending, not auto-approved
    shiftType,
    notes: 'Manual entry',
    missingCheckIn: !firstCheckIn,
    missingCheckOut: !lastCheckOut,
    isLate: false,
    earlyLeave: false,
    excessiveOvertime: false,
    penaltyMinutes: 0,
    allTimeRecords: allTimeRecords,
    hasMultipleRecords: allTimeRecords.length > 0,
    isCrossDay: shiftType === 'night',
    checkOutNextDay: shiftType === 'night',
    // Add display values for consistent viewing
    displayCheckIn: getStandardDisplayTime(shiftType, 'start'),
    displayCheckOut: getStandardDisplayTime(shiftType, 'end')
  };
  
  // Get normalized employee info for matching
  const empNumber = String(employee.employee_number || employee.employeeNumber || "").trim();
  const empName = employee.name || "";

  // Find employee by number or name
  let employeeIndex = -1;
  
  for (let i = 0; i < employeeRecords.length; i++) {
    const emp = employeeRecords[i];
    
    // Try exact match on employee number
    if (String(emp.employeeNumber).trim() === empNumber) {
      employeeIndex = i;
      break;
    }
    
    // If no match by number, try matching by name
    if (emp.name.toLowerCase() === empName.toLowerCase()) {
      employeeIndex = i;
      break;
    }
  }
  
  // Create copy of records to modify
  const newRecords = [...employeeRecords];
  let isNewEmployee = false;
  
  if (employeeIndex >= 0) {
    // Employee exists, add or update day
    const existingDayIndex = newRecords[employeeIndex].days.findIndex(
      d => d.date === date
    );
    
    if (existingDayIndex >= 0) {
      // Update existing day
      newRecords[employeeIndex].days[existingDayIndex] = newDay;
    } else {
      // Add new day
      newRecords[employeeIndex].days.push(newDay);
      newRecords[employeeIndex].totalDays += 1;
    }
    
    // Sort days by date
    newRecords[employeeIndex].days.sort((a, b) => a.date.localeCompare(b.date));
    
    newRecords[employeeIndex].expanded = true; // Auto-expand to show the new entry
  } else {
    // Employee doesn't exist in current records, create a new entry
    isNewEmployee = true;
    newRecords.push({
      employeeNumber: empNumber,
      name: empName,
      department: '',
      days: [newDay],
      totalDays: 1,
      expanded: true // Auto-expand to show the new entry
    });
    employeeIndex = newRecords.length - 1;
  }
  
  return { 
    updatedRecords: newRecords,
    employeeIndex,
    isNewEmployee
  };
};

/**
 * Add OFF-DAY markers for any missing days in the date range
 * @param {EmployeeRecord[]} employeeRecords Array of employee records
 * @returns {EmployeeRecord[]} Updated employee records with OFF-DAYs
 */
export const addOffDaysToRecords = (employeeRecords: EmployeeRecord[]): EmployeeRecord[] => {
  return employeeRecords.map(employee => {
    // Skip if no days or only one day
    if (employee.days.length <= 1) return employee;
    
    // Sort days by date
    const sortedDays = [...employee.days].sort((a, b) => a.date.localeCompare(b.date));
    
    // Find earliest and latest dates
    const earliestDate = new Date(sortedDays[0].date);
    const latestDate = new Date(sortedDays[sortedDays.length - 1].date);
    
    // Get all dates in the range
    const allDates = new Set<string>();
    const existingDates = new Set<string>(sortedDays.map(day => day.date));
    
    // Generate all dates in between
    let currentDate = earliestDate;
    while (currentDate <= latestDate) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      allDates.add(dateStr);
      currentDate = addDays(currentDate, 1);
    }
    
    // Create OFF-DAY entries for missing dates
    const newDays: DailyRecord[] = [...sortedDays];
    
    allDates.forEach(date => {
      if (!existingDates.has(date)) {
        newDays.push(createOffDayRecord(date));
      }
    });
    
    // Sort the days again after adding the OFF-DAYs
    newDays.sort((a, b) => a.date.localeCompare(b.date));
    
    return {
      ...employee,
      days: newDays,
      totalDays: newDays.length
    };
  });
};

/**
 * Create an OFF-DAY record for a specific date
 * @param {string} dateStr Date string in YYYY-MM-DD format 
 * @returns {DailyRecord} The OFF-DAY record
 */
export const createOffDayRecord = (dateStr: string): DailyRecord => {
  return {
    date: dateStr,
    firstCheckIn: null,
    lastCheckOut: null,
    hoursWorked: 0,
    approved: false,
    shiftType: null,
    notes: 'OFF-DAY',
    missingCheckIn: true,
    missingCheckOut: true,
    isLate: false,
    earlyLeave: false,
    excessiveOvertime: false,
    penaltyMinutes: 0,
    allTimeRecords: [],
    hasMultipleRecords: false,
    displayCheckIn: 'OFF-DAY',
    displayCheckOut: 'OFF-DAY'
  };
};

// Helper functions for date parsing and formatting

/**
 * Parse Excel date format
 * @param {string} dateStr Date string from Excel
 * @returns {Date | null} Parsed date or null
 */
export const parseExcelDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  
  // Try direct parsing
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch (e) {
    // Continue to other methods
  }
  
  // Try Excel serial number format
  const serialNumber = parseFloat(dateStr);
  if (!isNaN(serialNumber)) {
    return excelSerialDateToJSDate(serialNumber);
  }
  
  // Try common formats
  const formats = [
    'MM/dd/yyyy HH:mm:ss',
    'MM/dd/yyyy HH:mm',
    'dd/MM/yyyy HH:mm:ss',
    'dd/MM/yyyy HH:mm',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm'
  ];
  
  for (const formatStr of formats) {
    try {
      const parsedDate = parse(dateStr, formatStr, new Date());
      if (isValid(parsedDate)) {
        return parsedDate;
      }
    } catch (e) {
      // Try next format
    }
  }
  
  return null;
};

/**
 * Convert Excel serial date to JavaScript Date
 * @param {number} serial Excel serial date
 * @returns {Date} JavaScript Date
 */
export const excelSerialDateToJSDate = (serial: number): Date => {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  // Excel's epoch starts on 1/1/1900, with day 1 = 1/1/1900
  // Adjust for the Excel leap year bug (1900 is not a leap year)
  const offsetDays = serial > 59 ? 25569 - 1 : 25569;
  return new Date((serial - offsetDays) * millisecondsPerDay);
};

/**
 * Detect the date format used in an Excel file
 * @param {string[]} sampleDates Sample date strings
 * @returns {string} Detected date format
 */
export const detectDateFormat = (sampleDates: string[]): string => {
  if (!sampleDates || sampleDates.length === 0) {
    return 'yyyy-MM-dd HH:mm:ss';
  }
  
  // Count patterns
  let mdyCount = 0; // Month/day/year (US format)
  let dmyCount = 0; // Day/month/year (UK/Europe format)
  let ymdCount = 0; // Year/month/day (ISO format)
  
  for (const dateStr of sampleDates) {
    if (!dateStr) continue;
    
    // Check for MM/DD/YYYY pattern
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dateStr)) {
      const parts = dateStr.split('/');
      const firstNum = parseInt(parts[0]);
      const secondNum = parseInt(parts[1]);
      
      // If first part > 12, it's likely day/month/year
      if (firstNum > 12 && firstNum <= 31) {
        dmyCount++;
      }
      // If second part > 12, it's likely month/day/year
      else if (secondNum > 12 && secondNum <= 31) {
        mdyCount++;
      }
      else {
        // Ambiguous case - count based on likeliest format
        mdyCount++;
      }
    }
    // Check for YYYY-MM-DD pattern
    else if (/^\d{4}-\d{1,2}-\d{1,2}/.test(dateStr)) {
      ymdCount++;
    }
  }
  
  // Determine most common format
  if (ymdCount >= mdyCount && ymdCount >= dmyCount) {
    return 'yyyy-MM-dd HH:mm:ss';
  } else if (dmyCount >= mdyCount) {
    return 'dd/MM/yyyy HH:mm:ss';
  } else {
    return 'MM/dd/yyyy HH:mm:ss';
  }
};

/**
 * Format a date for Excel display
 * @param {Date | null} date Date object
 * @param {string} formatStr Format string
 * @returns {string} Formatted date string
 */
export const formatDateForExcel = (
  date: Date | null,
  formatStr: string = 'yyyy-MM-dd HH:mm:ss'
): string => {
  if (!date) return '';
  if (isNaN(date.getTime())) return '';
  return format(date, formatStr);
};

/**
 * Prepare employee data for Excel export
 * @param {EmployeeRecord[]} records Employee records
 * @returns {any[][]} Data for Excel export
 */
export const prepareEmployeeDataForExcel = (records: EmployeeRecord[]): any[][] => {
  return []; // Stub implementation, not used in this file
};

/**
 * Prepare summary data for Excel export
 * @param {EmployeeRecord[]} records Employee records
 * @returns {any[][]} Data for Excel export
 */
export const prepareSummaryForExcel = (records: EmployeeRecord[]): any[][] => {
  return []; // Stub implementation, not used in this file
};

// Export all functions to maintain the same API as before
export { parseShiftTimes, formatTime24H };