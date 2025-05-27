import * as XLSX from 'xlsx';
import { EmployeeRecord, TimeRecord, DailyRecord } from '../types';
import { calculateHoursWorked, determineShiftType, isExcessiveOvertime, isLateCheckIn, isEarlyLeave } from './shiftCalculations';
import { parseShiftTimes } from './dateTimeHelper';
import { format, parse, addDays, subDays, getDay } from 'date-fns';

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
        // Parse the Excel file
        const data = e.target?.result;
        if (!data) {
          reject(new Error('Failed to read file'));
          return;
        }
        
        console.log('File read successfully, parsing Excel data...');
        const workbook = XLSX.read(data, { type: 'array' }); // Changed from 'binary' to 'array'
        
        // Check if workbook has sheets
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          reject(new Error('Excel file contains no sheets'));
          return;
        }
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: '' });
        
        console.log('Excel data parsed successfully:', jsonData.length, 'rows');
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in the Excel file'));
          return;
        }

        // Log a sample row for debugging
        console.log('Sample row:', jsonData[0]);
        // Debug the Excel data structure
        debugExcelData(jsonData);
        
        // Process data
        const result = processExcelData(jsonData);
        console.log('Processed data into', result.length, 'employee records');
        resolve(result);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(error);
      }
    };
    
    reader.onerror = (error) => {
      console.error('Error reading file:', error);
      reject(new Error('Failed to read file'));
    };
    
    console.log('Starting to read file as array buffer...');
    reader.readAsArrayBuffer(file); // Changed from readAsBinaryString to readAsArrayBuffer
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
  
  console.log('Processing Excel data, sample row:', data[0]);
  
  // Normalize the column names
  const sampleRow = data[0];
  const keys = Object.keys(sampleRow);
  
  console.log('Available columns:', keys);

  // Required columns
  let departmentColumn = '';
  let nameColumn = '';
  let employeeNumberColumn = '';
  let timestampColumn = '';
  let statusColumn = '';
  
  // Find the matching columns with more flexible matching (case-insensitive)
  for (const key of keys) {
    const lowerKey = key.toLowerCase().trim();
    
    // Department column patterns
    if (
      lowerKey.includes('department') || 
      lowerKey.includes('dept') || 
      lowerKey === 'dept' || 
      lowerKey === 'dep' || 
      lowerKey.includes('division') ||
      lowerKey.includes('section')
    ) {
      departmentColumn = key;
      console.log('Found department column:', key);
    } 
    // Name column patterns
    else if (
      lowerKey.includes('name') || 
      lowerKey.includes('employee name') || 
      lowerKey === 'name' || 
      lowerKey === 'emp name' || 
      lowerKey.includes('person') ||
      lowerKey.includes('staff')
    ) {
      nameColumn = key;
      console.log('Found name column:', key);
    } 
    // Employee number column patterns
    else if (
      lowerKey.includes('employee no') || 
      lowerKey.includes('employee number') || 
      lowerKey.includes('number') || 
      lowerKey.includes('emp no') || 
      lowerKey.includes('emp #') || 
      lowerKey.includes('employee id') || 
      lowerKey.includes('emp id') || 
      lowerKey.includes('id') || 
      lowerKey.includes('code') || 
      lowerKey.includes('staff id') ||
      lowerKey === 'no.' || 
      lowerKey === 'no' || 
      lowerKey === '#'
    ) {
      employeeNumberColumn = key;
      console.log('Found employee number column:', key);
    } 
    // Timestamp column patterns
    else if (
      lowerKey.includes('date') || 
      lowerKey.includes('time') || 
      lowerKey.includes('timestamp') || 
      lowerKey.includes('check time') || 
      lowerKey.includes('clock') || 
      lowerKey.includes('punch') || 
      lowerKey === 'date' || 
      lowerKey === 'time' ||
      lowerKey === 'clock in' ||
      lowerKey === 'clock out' ||
      lowerKey === 'datetime'
    ) {
      timestampColumn = key;
      console.log('Found timestamp column:', key);
    } 
    // Status column patterns
    else if (
      lowerKey.includes('status') || 
      lowerKey.includes('type') || 
      lowerKey.includes('check type') ||
      lowerKey.includes('c/type') ||
      lowerKey.includes('c/in c/out') ||
      lowerKey.includes('in/out') ||
      lowerKey.includes('event') ||
      lowerKey.includes('action') ||
      lowerKey.includes('direction') ||
      lowerKey.includes('io') ||
      lowerKey === 'in' ||
      lowerKey === 'out' ||
      lowerKey === 'io type' ||
      lowerKey === 'i/o'
    ) {
      statusColumn = key;
      console.log('Found status column:', key);
    }
  }
  
  console.log('Identified columns:', {
    departmentColumn,
    nameColumn,
    employeeNumberColumn,
    timestampColumn,
    statusColumn
  });
  
  // If we're missing required columns, try to infer from data patterns
  if (!nameColumn || !employeeNumberColumn || !timestampColumn || !statusColumn) {
    console.log('Missing required columns, attempting to infer from data...');
    
    // Attempt to infer columns based on content patterns
    for (const key of keys) {
      const sampleValue = String(sampleRow[key]).trim();
      
      // If we're missing employee number and this looks like an ID
      if (!employeeNumberColumn && /^[A-Z0-9]{3,10}$/i.test(sampleValue)) {
        employeeNumberColumn = key;
        console.log('Inferred employee number column from pattern:', key);
      }
      
      // If we're missing name and this looks like a name
      if (!nameColumn && sampleValue.length > 2 && sampleValue.includes(' ') && !/^\d/.test(sampleValue)) {
        nameColumn = key;
        console.log('Inferred name column from pattern:', key);
      }
      
      // If we're missing timestamp and this looks like a date/time
      if (!timestampColumn && (
        sampleValue.includes('/') || 
        sampleValue.includes('-') || 
        sampleValue.includes(':') ||
        /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(sampleValue)
      )) {
        timestampColumn = key;
        console.log('Inferred timestamp column from pattern:', key);
      }
      
      // If we're missing status and this looks like a status
      if (!statusColumn && (
        sampleValue.toUpperCase() === 'IN' || 
        sampleValue.toUpperCase() === 'OUT' ||
        sampleValue.toUpperCase() === 'CI' ||
        sampleValue.toUpperCase() === 'CO'
      )) {
        statusColumn = key;
        console.log('Inferred status column from pattern:', key);
      }
    }
  }
  
  // Build detailed error message if still missing columns
  if (!nameColumn || !employeeNumberColumn || !timestampColumn || !statusColumn) {
    let errorMsg = 'Missing required columns in Excel file.\n\n';
    
    if (!nameColumn) {
      errorMsg += '• Employee Name column not found. Expected headers like: "Name", "Employee Name", etc.\n';
    }
    
    if (!employeeNumberColumn) {
      errorMsg += '• Employee Number/ID column not found. Expected headers like: "Employee No", "ID", "Code", etc.\n';
    }
    
    if (!timestampColumn) {
      errorMsg += '• Timestamp/DateTime column not found. Expected headers like: "Date", "Time", "Check Time", etc.\n';
    }
    
    if (!statusColumn) {
      errorMsg += '• Status/Check Type column not found. Expected headers like: "Status", "Type", "In/Out", etc.\n';
    }
    
    errorMsg += '\nAvailable columns: ' + keys.join(', ') + '\n';
    errorMsg += '\nPlease ensure your Excel file has the required columns with appropriate headers.';
    
    throw new Error(errorMsg);
  }
  
  // Extract time records
  const timeRecords: TimeRecord[] = [];
  let skipCount = 0;
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // Skip if missing required fields
    if (!row[nameColumn] || !row[employeeNumberColumn] || !row[timestampColumn] || !row[statusColumn]) {
      console.log('Skipping row due to missing required fields:', row);
      skipCount++;
      continue;
    }
    
    // Normalize status (CI, C/I, Check In, C IN, etc. all become "check_in")
    const rawStatus = String(row[statusColumn]).trim().toUpperCase();
    let status: 'check_in' | 'check_out';
    
    // Parse status with expanded patterns
    if (
      rawStatus === 'CI' || 
      rawStatus === 'C/I' || 
      rawStatus === 'CHECK IN' || 
      rawStatus === 'CHECK-IN' || 
      rawStatus === 'C IN' || 
      rawStatus === 'IN' ||
      rawStatus === 'F1' ||
      rawStatus === 'CHECKIN' ||
      rawStatus === 'C I' ||
      rawStatus === 'I' ||
      rawStatus === '1' ||
      rawStatus === 'CLOCK IN' ||
      rawStatus === 'ENTER' ||
      rawStatus === 'ARRIVAL'
    ) {
      status = 'check_in';
    } else {
      status = 'check_out';
    }
    
    // Parse timestamp with multiple approaches
    let timestamp: Date | null = null;
    const rawTimestamp = String(row[timestampColumn]).trim();
    
    try {
      // Try standard Date constructor first
      timestamp = new Date(rawTimestamp);
      
      // If invalid, try various parsing approaches
      if (isNaN(timestamp.getTime())) {
        console.log('Standard date parsing failed for:', rawTimestamp);
        
        // Try Excel serial date format
        const serialDate = parseFloat(rawTimestamp);
        if (!isNaN(serialDate)) {
          // Convert Excel serial date to JS Date
          const millisecondsPerDay = 24 * 60 * 60 * 1000;
          timestamp = new Date((serialDate - 25569) * millisecondsPerDay);
          console.log('Parsed as Excel serial date:', serialDate, 'to', timestamp);
        } 
        // Try common date formats
        else {
          // Try common date formats with date-fns
          const dateFormats = [
            'MM/dd/yyyy HH:mm:ss',
            'MM/dd/yyyy HH:mm',
            'dd/MM/yyyy HH:mm:ss',
            'dd/MM/yyyy HH:mm',
            'yyyy-MM-dd HH:mm:ss',
            'yyyy-MM-dd HH:mm',
            'MM-dd-yyyy HH:mm:ss',
            'MM-dd-yyyy HH:mm',
            'dd-MM-yyyy HH:mm:ss',
            'dd-MM-yyyy HH:mm',
            'MM/dd/yy HH:mm:ss',
            'MM/dd/yy HH:mm',
            'dd/MM/yy HH:mm:ss',
            'dd/MM/yy HH:mm',
          ];
          
          for (const format of dateFormats) {
            try {
              timestamp = parse(rawTimestamp, format, new Date());
              if (!isNaN(timestamp.getTime())) {
                console.log('Parsed with format:', format, timestamp);
                break;
              }
            } catch (err) {
              // Continue to next format
            }
          }
        }
      }
      
      // If still invalid, try parsing components
      if (timestamp === null || isNaN(timestamp.getTime())) {
        // Handle special case where date and time might be in separate columns
        const dateTimePattern = /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})(?:[\sT]+(\d{1,2}:\d{1,2}(?::\d{1,2})?(?:\s*[AP]M)?)?)?/i;
        const match = rawTimestamp.match(dateTimePattern);
        
        if (match) {
          const datePart = match[1];
          const timePart = match[2] || '00:00:00';
          
          // Try to parse the combined date and time
          try {
            const dateTimeStr = `${datePart} ${timePart}`;
            timestamp = new Date(dateTimeStr);
            console.log('Parsed from components:', dateTimeStr, timestamp);
          } catch (err) {
            console.error('Failed to parse from components:', err);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse timestamp:', rawTimestamp, e);
    }
    
    // Skip if we couldn't parse the timestamp
    if (timestamp === null || isNaN(timestamp.getTime())) {
      console.warn('Skipping row due to invalid timestamp:', rawTimestamp);
      skipCount++;
      continue;
    }
    
    // Add to time records
    timeRecords.push({
      department: row[departmentColumn] || '',
      name: String(row[nameColumn]).trim(),
      employeeNumber: String(row[employeeNumberColumn]).trim(),
      timestamp,
      status,
      originalIndex: i,  // Store original index for reference
    });
  }
  
  console.log(`Processed ${timeRecords.length} time records (skipped ${skipCount} rows)`);
  
  // Verify we have at least some valid records
  if (timeRecords.length === 0) {
    throw new Error(
      "No valid time records found in the file. Please check that:\n\n" +
      "• Your Excel file has the correct column headers\n" +
      "• There are valid check-in and check-out records\n" +
      "• Date/time values are in a recognized format\n" +
      "• Employee names and numbers are properly formatted\n\n" +
      "Detected columns: " + 
      `Name: ${nameColumn || 'Not found'}, ` +
      `Employee Number: ${employeeNumberColumn || 'Not found'}, ` +
      `Timestamp: ${timestampColumn || 'Not found'}, ` +
      `Status: ${statusColumn || 'Not found'}`
    );
  }
  
  // Group time records by employee
  const employeeRecords = processTimeRecords(timeRecords);
  
  // Final validation - ensure we have employee records with days
  if (employeeRecords.length === 0) {
    throw new Error(
      "Could not generate employee records from the time data. Please check that:\n\n" +
      "• Each employee has at least one check-in or check-out record\n" +
      "• The timestamp values are correctly formatted\n" +
      "• The in/out status values are correctly identified\n\n" +
      `Found ${timeRecords.length} time records but could not group them by employee.`
    );
  }
  
  console.log(`Final result: ${employeeRecords.length} employee records with data`);
  return employeeRecords;
};

/**
 * Group time records by employee and prepare for display
 * @param {TimeRecord[]} timeRecords Array of time records
 * @returns {EmployeeRecord[]} Array of employee records
 */
export const processTimeRecords = (timeRecords: TimeRecord[]): EmployeeRecord[] => {
  const employeeMap = new Map<string, {
    name: string;
    department: string;
    days: Map<string, {
      date: string;
      records: TimeRecord[];
    }>;
  }>();
  
  // Step 1: Pre-process records to mark mislabeled check-ins and check-outs
  identifyMislabeledRecords(timeRecords);
  
  // Step 2: Group records by employee and date
  timeRecords.forEach(record => {
    // Get the date string in YYYY-MM-DD format
    const date = format(record.timestamp, 'yyyy-MM-dd');
    
    if (!employeeMap.has(record.employeeNumber)) {
      employeeMap.set(record.employeeNumber, {
        name: record.name,
        department: record.department,
        days: new Map(),
      });
    }
    
    const employeeData = employeeMap.get(record.employeeNumber)!;
    
    if (!employeeData.days.has(date)) {
      employeeData.days.set(date, {
        date,
        records: [],
      });
    }
    
    employeeData.days.get(date)!.records.push(record);
  });
  
  console.log(`Found ${employeeMap.size} employees with time records`);
  
  // Step 3: Process days for each employee
  const employeeRecords: EmployeeRecord[] = [];
  
  employeeMap.forEach((employeeData, employeeNumber) => {
    const days: DailyRecord[] = [];
    
    employeeData.days.forEach(dayData => {
      // Preprocess to determine shift types
      assignShiftTypesToDayRecords(dayData.records);
      
      // Process daily records - this handles check-ins and check-outs
      const dailyRecord = processDailyTimeRecords(dayData.records, dayData.date);
      days.push(dailyRecord);
    });
    
    // Add employee data
    employeeRecords.push({
      employeeNumber,
      name: employeeData.name,
      department: employeeData.department,
      days: days,
      totalDays: days.length,
      expanded: false,
    });
  });
  
  console.log(`Processed ${employeeRecords.length} employee records`);
  
  return employeeRecords;
};

/**
 * Identifies mislabeled check-in/check-out records
 * @param {TimeRecord[]} records Array of time records
 */
export const identifyMislabeledRecords = (records: TimeRecord[]): void => {
  // Group records by employee and date
  const recordsByEmployeeDate = new Map<string, TimeRecord[]>();
  
  records.forEach(record => {
    const date = format(record.timestamp, 'yyyy-MM-dd');
    const key = `${record.employeeNumber}|${date}`;
    
    if (!recordsByEmployeeDate.has(key)) {
      recordsByEmployeeDate.set(key, []);
    }
    
    recordsByEmployeeDate.get(key)!.push(record);
  });
  
  // Process each employee's daily records
  recordsByEmployeeDate.forEach(dayRecords => {
    if (dayRecords.length < 2) return; // Skip if only one record for the day
    
    // Sort by timestamp
    dayRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Check for possible mislabeled records
    for (let i = 0; i < dayRecords.length - 1; i++) {
      const currentRecord = dayRecords[i];
      const nextRecord = dayRecords[i + 1];
      
      // Check if two consecutive records have the same status
      if (currentRecord.status === nextRecord.status) {
        // If two check-ins in a row, mark the second as likely mislabeled
        if (currentRecord.status === 'check_in') {
          nextRecord.mislabeled = true;
          nextRecord.originalStatus = 'check_in';
          nextRecord.status = 'check_out'; // Correct it
          nextRecord.notes = 'Fixed mislabeled check-in → check-out';
        } 
        // If two check-outs in a row, mark the first as likely mislabeled
        else if (currentRecord.status === 'check_out') {
          currentRecord.mislabeled = true;
          currentRecord.originalStatus = 'check_out';
          currentRecord.status = 'check_in'; // Correct it
          currentRecord.notes = 'Fixed mislabeled check-out → check-in';
        }
      }
    }
  });
};

/**
 * Assign shift types to each record in a day
 * @param {TimeRecord[]} records Records for a single day
 */
export const assignShiftTypesToDayRecords = (records: TimeRecord[]): void => {
  if (records.length === 0) return;
  
  // Sort records by timestamp
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Analyze check-in times to determine the most likely shift type for the day
  const checkIns = records.filter(r => r.status === 'check_in');
  if (checkIns.length === 0) return;
  
  // Look at the first check-in to determine shift type
  const firstCheckIn = checkIns[0];
  const shiftType = determineShiftType(firstCheckIn.timestamp);
  
  // Assign that shift type to all records for consistency
  records.forEach(record => {
    record.shift_type = shiftType;
  });
};

/**
 * Process daily time records to create a DailyRecord
 * @param {TimeRecord[]} records Time records for a single day
 * @param {string} date Date string in YYYY-MM-DD format
 * @returns {DailyRecord} Processed daily record
 */
export const processDailyTimeRecords = (records: TimeRecord[], date: string): DailyRecord => {
  // Sort records by timestamp
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Extract check-in and check-out times
  const checkIns = records.filter(r => r.status === 'check_in');
  const checkOuts = records.filter(r => r.status === 'check_out');
  
  const firstCheckIn = checkIns.length > 0 ? checkIns[0].timestamp : null;
  const lastCheckOut = checkOuts.length > 0 
    ? checkOuts[checkOuts.length - 1].timestamp 
    : null;
  
  // Determine shift type from first check-in if available
  let shiftType = null;
  if (firstCheckIn) {
    shiftType = determineShiftType(firstCheckIn);
  } else if (records.length > 0 && records[0].shift_type) {
    // Use shift type from records if available
    shiftType = records[0].shift_type;
  }
  
  // Calculate hours worked
  let hoursWorked = 0;
  let isLate = false;
  let earlyLeave = false;
  let excessiveOvertime = false;
  
  if (firstCheckIn && lastCheckOut) {
    // Check if this is likely a night shift
    if (shiftType === 'night') {
      // For night shift, use specific calculation
      const { checkIn, checkOut } = parseShiftTimes(
        date,
        format(firstCheckIn, 'HH:mm'),
        format(lastCheckOut, 'HH:mm'),
        'night'
      );
      
      hoursWorked = calculateHoursWorked(checkIn, checkOut);
    } else {
      // For day shifts, standard calculation
      hoursWorked = calculateHoursWorked(firstCheckIn, lastCheckOut);
    }
    
    // Round to 2 decimal places
    hoursWorked = parseFloat(hoursWorked.toFixed(2));
    
    // Check for issues
    isLate = firstCheckIn && isLateCheckIn(firstCheckIn, shiftType);
    earlyLeave = lastCheckOut && isEarlyLeave(lastCheckOut, shiftType);
    excessiveOvertime = hoursWorked > 10;
  }
  
  // Create and return daily record
  return {
    date,
    firstCheckIn: firstCheckIn ? new Date(firstCheckIn) : null,
    lastCheckOut: lastCheckOut ? new Date(lastCheckOut) : null,
    hoursWorked,
    approved: false, // Initial state, not approved
    shiftType,
    notes: records.length === 0 ? 'No records' : (records.some(r => r.mislabeled) ? 'Fixed mislabeled records' : ''),
    missingCheckIn: checkIns.length === 0,
    missingCheckOut: checkOuts.length === 0,
    isLate,
    earlyLeave,
    excessiveOvertime,
    penaltyMinutes: 0, // Initial state, no penalties
    allTimeRecords: records, // Store all original records for reference
    hasMultipleRecords: records.length > 2, // Flag if there are more than just a check-in and check-out
    isCrossDay: false, // Will be set later if needed
  };
};

/**
 * Helper function to determine if a sequence of records likely contains a night shift
 * @param {TimeRecord[]} records Array of time records
 * @returns {boolean} True if night shift is likely
 */
export const isLikelyNightShift = (records: TimeRecord[]): boolean => {
  if (records.length < 2) return false;
  
  // Get timestamps
  const timestamps = records.map(r => r.timestamp);
  
  // Sort timestamps
  timestamps.sort((a, b) => a.getTime() - b.getTime());
  
  // Check first and last timestamps
  const firstTime = timestamps[0];
  const lastTime = timestamps[timestamps.length - 1];
  
  // If first time is after 6pm or before 5am, and last time is before noon next day
  const firstHour = firstTime.getHours();
  const lastHour = lastTime.getHours();
  
  if ((firstHour >= 18 || firstHour < 5) && lastHour < 12) {
    return true;
  }
  
  return false;
};

/**
 * Helper function to extract XLSX values safely
 * @param {any} value XLSX cell value
 * @returns {string} Sanitized value
 */
export const getXLSXValue = (value: any): string => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

/**
 * A debug helper to check the structure of Excel data
 * @param {any[]} data Excel JSON data 
 */
export const debugExcelData = (data: any[]): void => {
  if (!data || data.length === 0) {
    console.log('No data to debug');
    return;
  }
  
  const sampleRow = data[0];
  const columns = Object.keys(sampleRow);
  
  console.log('Excel Data Structure:');
  console.log('Total rows:', data.length);
  console.log('Columns:', columns);
  console.log('Sample row:', sampleRow);
  
  // Log value types for debugging
  const valueTypes: Record<string, string> = {};
  for (const key of columns) {
    const value = sampleRow[key];
    valueTypes[key] = typeof value === 'object' ? 
      (value === null ? 'null' : Object.prototype.toString.call(value)) : 
      typeof value;
  }
  console.log('Column value types:', valueTypes);
  
  // Log a few sample values for timestamp and status columns
  const timestampCandidates = columns.filter(col => 
    col.toLowerCase().includes('time') || 
    col.toLowerCase().includes('date') || 
    col.toLowerCase().includes('clock')
  );
  
  const statusCandidates = columns.filter(col => 
    col.toLowerCase().includes('type') || 
    col.toLowerCase().includes('status') || 
    col.toLowerCase().includes('in') || 
    col.toLowerCase().includes('out')
  );
  
  console.log('Potential timestamp columns:', timestampCandidates);
  console.log('Potential status columns:', statusCandidates);
  
  // Show sample values
  if (timestampCandidates.length > 0) {
    console.log('Sample timestamp values:');
    for (let i = 0; i < Math.min(3, data.length); i++) {
      const row = data[i];
      const values = timestampCandidates.map(col => `${col}: ${row[col]}`);
      console.log(`Row ${i}:`, values.join(', '));
    }
  }
  
  if (statusCandidates.length > 0) {
    console.log('Sample status values:');
    for (let i = 0; i < Math.min(3, data.length); i++) {
      const row = data[i];
      const values = statusCandidates.map(col => `${col}: ${row[col]}`);
      console.log(`Row ${i}:`, values.join(', '));
    }
  }
};

/**
 * Helper to get the total number of time records
 * @param {EmployeeRecord[]} records Employee records
 * @returns {number} Total time records
 */
export const getTotalTimeRecords = (records: EmployeeRecord[]): number => {
  return records.reduce((total, employee) => {
    return total + employee.days.reduce((dayTotal, day) => {
      return dayTotal + (day.allTimeRecords?.length || 0);
    }, 0);
  }, 0);
};

/**
 * Helper function to normalize and sanitize input text
 * @param {string} text Input text to normalize 
 * @returns {string} Normalized text
 */
export const normalizeText = (text: string): string => {
  if (!text) return '';
  return text.trim().replace(/\s+/g, ' ');
};