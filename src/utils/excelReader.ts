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
        const workbook = XLSX.read(data, { type: 'array' }); // Use 'array' instead of 'binary'
        
        // Check if workbook has sheets
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          reject(new Error('Excel file contains no sheets'));
          return;
        }
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON with options to handle different data types
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          raw: false, // Convert all data to strings
          defval: '',  // Default value for empty cells
          header: 'A'  // Use A,B,C as column headers if no headers exist
        });
        
        console.log('Excel data parsed successfully:', jsonData.length, 'rows');
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in the Excel file'));
          return;
        }

        // Log a sample row for debugging
        console.log('First row sample:', jsonData[0]);
        
        // If first row uses A,B,C as headers, the file might not have headers
        // Check if the first property of the first row is 'A'
        const firstRow = jsonData[0];
        const firstProp = Object.keys(firstRow)[0];
        const useNumericHeaders = firstProp === 'A';
        
        console.log('Using numeric headers:', useNumericHeaders);
        
        // If using A,B,C headers, check if the first row looks like real headers
        if (useNumericHeaders) {
          const potentialHeaderRow = jsonData[0];
          const rowValues = Object.values(potentialHeaderRow).map(val => String(val).toLowerCase());
          
          // Check if any of the values in the first row match expected header names
          const headerWords = ['name', 'employee', 'department', 'time', 'date', 'check', 'in', 'out'];
          const hasHeaderRow = headerWords.some(word => 
            rowValues.some(val => val.includes(word))
          );
          
          if (hasHeaderRow) {
            console.log('First row appears to be headers, re-parsing with headers');
            // Re-parse using the first row as headers
            const jsonDataWithHeaders = XLSX.utils.sheet_to_json(worksheet, {
              raw: false,
              defval: ''
            });
            
            // Verify we got data with the new headers
            if (jsonDataWithHeaders.length === 0) {
              reject(new Error('Failed to parse Excel data with headers'));
              return;
            }
            
            console.log('Re-parsed with headers:', jsonDataWithHeaders.length, 'rows');
            console.log('First row with headers:', jsonDataWithHeaders[0]);
            
            // Process data with headers
            const result = processExcelData(jsonDataWithHeaders);
            resolve(result);
          } else {
            // Process data with A,B,C headers, guessing the columns
            console.log('Processing without explicit headers, guessing column positions');
            const result = processExcelDataWithoutHeaders(jsonData);
            resolve(result);
          }
        } else {
          // Process data with existing headers
          const result = processExcelData(jsonData);
          resolve(result);
        }
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
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Process Excel data when headers are not present (A,B,C format)
 * @param {any[]} data The JSON data from Excel with A,B,C headers
 * @returns {EmployeeRecord[]} Array of employee records
 */
export const processExcelDataWithoutHeaders = (data: any[]): EmployeeRecord[] => {
  console.log('Processing Excel data without headers');
  
  // Analyze data to guess column positions
  const columnMapping: {
    departmentColumn?: string;
    nameColumn?: string;
    employeeNumberColumn?: string;
    timestampColumn?: string;
    statusColumn?: string;
  } = {};
  
  // Sample several rows to find patterns
  const sampleSize = Math.min(data.length, 20);
  const sampleRows = data.slice(0, sampleSize);
  
  // Collect all column keys
  const allColumns = new Set<string>();
  sampleRows.forEach(row => {
    Object.keys(row).forEach(key => allColumns.add(key));
  });
  
  const columns = Array.from(allColumns);
  console.log('Available columns:', columns);
  
  // Analyze each column
  columns.forEach(col => {
    // Get sample values for this column
    const values = sampleRows
      .map(row => String(row[col] || '').trim())
      .filter(val => val.length > 0);
      
    if (values.length === 0) return;
    
    // Check value patterns
    const isDateTimeColumn = values.some(val => 
      val.includes('/') || 
      val.includes('-') || 
      val.includes(':') || 
      /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(val)
    );
    
    const isPossibleName = values.some(val => 
      val.includes(' ') && 
      val.length > 5 && 
      !/^\d+$/.test(val) && 
      !isDateTimeColumn
    );
    
    const isPossibleEmployeeNumber = values.some(val => 
      /^\d+$/.test(val) || 
      /^[A-Z0-9]+$/.test(val)
    );
    
    const isPossibleStatus = values.some(val => 
      ['in', 'out', 'check in', 'check out', 'ci', 'co'].includes(val.toLowerCase())
    );
    
    // Assign columns based on patterns
    if (isDateTimeColumn && !columnMapping.timestampColumn) {
      columnMapping.timestampColumn = col;
      console.log(`Guessed timestamp column: ${col}`);
    }
    
    if (isPossibleName && !columnMapping.nameColumn) {
      columnMapping.nameColumn = col;
      console.log(`Guessed name column: ${col}`);
    }
    
    if (isPossibleEmployeeNumber && !columnMapping.employeeNumberColumn) {
      columnMapping.employeeNumberColumn = col;
      console.log(`Guessed employee number column: ${col}`);
    }
    
    if (isPossibleStatus && !columnMapping.statusColumn) {
      columnMapping.statusColumn = col;
      console.log(`Guessed status column: ${col}`);
    }
  });
  
  // If we couldn't guess all required columns, make some default assumptions
  if (!columnMapping.nameColumn || !columnMapping.employeeNumberColumn || 
      !columnMapping.timestampColumn || !columnMapping.statusColumn) {
    
    // Default column mapping for common Excel exports from time clock systems
    // Typically: A=employee number, B=name, C=date/time, D=status
    if (!columnMapping.employeeNumberColumn) {
      columnMapping.employeeNumberColumn = 'A';
      console.log('Using default employee number column: A');
    }
    
    if (!columnMapping.nameColumn) {
      columnMapping.nameColumn = 'B';
      console.log('Using default name column: B');
    }
    
    if (!columnMapping.timestampColumn) {
      columnMapping.timestampColumn = 'C';
      console.log('Using default timestamp column: C');
    }
    
    if (!columnMapping.statusColumn) {
      columnMapping.statusColumn = 'D';
      console.log('Using default status column: D');
    }
    
    // Department is optional, might be E or skipped
    if (!columnMapping.departmentColumn) {
      columnMapping.departmentColumn = 'E';
      console.log('Using default department column: E');
    }
  }
  
  // Create a new array with normalized data using the guessed columns
  const normalizedData = data.map(row => {
    return {
      department: columnMapping.departmentColumn ? (row[columnMapping.departmentColumn] || '') : '',
      name: columnMapping.nameColumn ? (row[columnMapping.nameColumn] || '') : '',
      employeeNumber: columnMapping.employeeNumberColumn ? (row[columnMapping.employeeNumberColumn] || '') : '',
      timestamp: columnMapping.timestampColumn ? (row[columnMapping.timestampColumn] || '') : '',
      status: columnMapping.statusColumn ? (row[columnMapping.statusColumn] || '') : ''
    };
  });
  
  // Filter out rows with empty required fields
  const filteredData = normalizedData.filter(row => 
    row.name && 
    row.employeeNumber && 
    row.timestamp
  );
  
  if (filteredData.length === 0) {
    throw new Error(
      "Could not identify valid records in the file. Please check that:" +
      "\n• Your Excel file has data in the expected format" +
      "\n• Employee names and numbers are present" +
      "\n• Timestamp and status information is included" +
      "\n\nTip: The file should have columns for employee number, name, timestamp, and check-in/out status."
    );
  }
  
  console.log(`Identified ${filteredData.length} records after filtering`);
  
  // Now process using the standard function
  return processExcelData(filteredData);
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
  
  console.log('Processing Excel data, total rows:', data.length);
  
  // Log sample row for debugging
  const sampleRow = data[0];
  console.log('Sample row:', sampleRow);
  
  // Get all column keys from the data
  const allKeys = new Set<string>();
  data.forEach(row => {
    Object.keys(row).forEach(key => allKeys.add(key));
  });
  const keys = Array.from(allKeys);
  
  console.log('All available columns:', keys);

  // Required columns
  let departmentColumn = '';
  let nameColumn = '';
  let employeeNumberColumn = '';
  let timestampColumn = '';
  let statusColumn = '';
  
  // Find the matching columns with more flexible matching (case-insensitive)
  for (const key of keys) {
    const lowerKey = String(key).toLowerCase().trim();
    
    // Department column patterns
    if (
      lowerKey.includes('department') || 
      lowerKey.includes('dept') || 
      lowerKey === 'dept' || 
      lowerKey === 'dep' || 
      lowerKey.includes('division') ||
      lowerKey.includes('section') ||
      lowerKey === 'department'
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
      lowerKey.includes('staff') ||
      lowerKey === 'employee name'
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
      lowerKey === '#' ||
      lowerKey === 'employee number'
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
      lowerKey === 'datetime' ||
      lowerKey === 'check time'
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
      lowerKey === 'i/o' ||
      lowerKey === 'check type'
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

  // Special case: if data comes from Face ID systems, the column structure might be different
  // Sometimes status is not a separate column but indicated by having both "Check in" and "Check out" columns
  if (!statusColumn) {
    // Try to find check-in and check-out as separate columns
    let checkInColumn = '';
    let checkOutColumn = '';
    
    for (const key of keys) {
      const lowerKey = String(key).toLowerCase().trim();
      
      if (
        lowerKey.includes('check in') ||
        lowerKey.includes('checkin') ||
        lowerKey.includes('clock in') ||
        lowerKey.includes('in time') ||
        lowerKey === 'in' ||
        lowerKey === 'check in'
      ) {
        checkInColumn = key;
        console.log('Found check-in column:', key);
      } else if (
        lowerKey.includes('check out') ||
        lowerKey.includes('checkout') ||
        lowerKey.includes('clock out') ||
        lowerKey.includes('out time') ||
        lowerKey === 'out' ||
        lowerKey === 'check out'
      ) {
        checkOutColumn = key;
        console.log('Found check-out column:', key);
      }
    }
    
    // If we found both columns, we can process in a different way
    if (checkInColumn && checkOutColumn) {
      console.log('Processing Excel with separate check-in/check-out columns');
      return processExcelWithSeparateInOutColumns(
        data, 
        nameColumn, 
        employeeNumberColumn, 
        departmentColumn, 
        checkInColumn, 
        checkOutColumn
      );
    }
  }
  
  // Try to infer column positions if standard headers not found
  if (!nameColumn || !employeeNumberColumn || !timestampColumn || !statusColumn) {
    console.log('Standard columns not found, trying to infer from data patterns...');
    
    // Look at sample values in each column to infer types
    for (const key of keys) {
      // Skip already identified columns
      if (key === nameColumn || key === employeeNumberColumn || 
          key === timestampColumn || key === statusColumn ||
          key === departmentColumn) {
        continue;
      }
      
      // Get sample values from this column
      const sampleValues = data.slice(0, Math.min(10, data.length))
        .map(row => String(row[key] || '').trim())
        .filter(val => val.length > 0);
      
      if (sampleValues.length === 0) continue;
      
      console.log(`Sample values for column ${key}:`, sampleValues.slice(0, 3));
      
      // Check for employee number pattern
      if (!employeeNumberColumn) {
        // Employee numbers are often short numeric or alphanumeric strings
        const isEmployeeNumber = sampleValues.every(val => 
          /^\d+$/.test(val) || /^[A-Z0-9]{2,10}$/i.test(val)
        );
        
        if (isEmployeeNumber) {
          employeeNumberColumn = key;
          console.log(`Inferred employee number column: ${key}`);
          continue;
        }
      }
      
      // Check for name pattern
      if (!nameColumn) {
        // Names typically contain spaces and are longer than IDs
        const isName = sampleValues.some(val => 
          val.includes(' ') && val.length > 5 && !/^\d+$/.test(val)
        );
        
        if (isName) {
          nameColumn = key;
          console.log(`Inferred name column: ${key}`);
          continue;
        }
      }
      
      // Check for timestamp pattern
      if (!timestampColumn) {
        const isTimestamp = sampleValues.some(val => 
          val.includes('/') || 
          val.includes('-') || 
          val.includes(':') || 
          /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(val)
        );
        
        if (isTimestamp) {
          timestampColumn = key;
          console.log(`Inferred timestamp column: ${key}`);
          continue;
        }
      }
      
      // Check for status pattern
      if (!statusColumn) {
        const isStatus = sampleValues.some(val => {
          const lowerVal = val.toLowerCase();
          return lowerVal === 'in' || 
                lowerVal === 'out' || 
                lowerVal === 'check in' || 
                lowerVal === 'check out' ||
                lowerVal === 'ci' ||
                lowerVal === 'co';
        });
        
        if (isStatus) {
          statusColumn = key;
          console.log(`Inferred status column: ${key}`);
          continue;
        }
      }
    }
  }
  
  // Build detailed error message if still missing columns
  if (!nameColumn || !employeeNumberColumn || !timestampColumn) {
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
    
    errorMsg += '\nAvailable columns: ' + keys.join(', ') + '\n';
    errorMsg += '\nPlease ensure your Excel file has the required columns with appropriate headers.';
    
    throw new Error(errorMsg);
  }
  
  // If status column is missing but we have timestamp, try to infer status from patterns
  const inferStatus = !statusColumn;
  console.log('Will need to infer status from patterns:', inferStatus);
  
  // Extract time records
  const timeRecords: TimeRecord[] = [];
  let skipCount = 0;
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // Skip if missing required fields
    if (!row[nameColumn] || !row[employeeNumberColumn] || !row[timestampColumn]) {
      skipCount++;
      continue;
    }
    
    let status: 'check_in' | 'check_out';
    
    // Determine status - if status column exists, use it
    if (statusColumn) {
      const rawStatus = String(row[statusColumn]).trim().toUpperCase();
      
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
    } else {
      // If no status column, try to infer from the timestamp pattern
      // This is a fallback and might not be perfect
      const timestamp = String(row[timestampColumn]);
      const hour = tryExtractHour(timestamp);
      
      // Guess check_in for morning times (5AM-11AM), check_out for afternoon/evening (12PM-10PM)
      if (hour !== null) {
        status = (hour >= 5 && hour < 12) ? 'check_in' : 'check_out';
      } else {
        // Default to check_in if we can't tell
        status = 'check_in';
      }
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
            // Time-only formats (assume current date)
            'HH:mm:ss',
            'HH:mm',
          ];
          
          for (const formatStr of dateFormats) {
            try {
              timestamp = parse(rawTimestamp, formatStr, new Date());
              if (!isNaN(timestamp.getTime())) {
                console.log('Parsed with format:', formatStr, timestamp);
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
      department: departmentColumn ? (row[departmentColumn] || '') : '',
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
 * Process Excel data with separate check-in and check-out columns
 */
export const processExcelWithSeparateInOutColumns = (
  data: any[],
  nameColumn: string,
  employeeNumberColumn: string,
  departmentColumn: string,
  checkInColumn: string,
  checkOutColumn: string
): EmployeeRecord[] => {
  console.log('Processing Excel with separate check-in/check-out columns');
  
  const timeRecords: TimeRecord[] = [];
  let skipCount = 0;
  
  // Process each row
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // Skip if missing required fields
    if (!row[nameColumn] || !row[employeeNumberColumn]) {
      skipCount++;
      continue;
    }
    
    const name = String(row[nameColumn]).trim();
    const employeeNumber = String(row[employeeNumberColumn]).trim();
    const department = departmentColumn ? (row[departmentColumn] || '') : '';
    
    // Process check-in if present
    if (row[checkInColumn]) {
      const rawCheckIn = String(row[checkInColumn]).trim();
      let checkInTime: Date | null = null;
      
      try {
        checkInTime = parseTimestamp(rawCheckIn);
      } catch (e) {
        console.warn('Failed to parse check-in time:', rawCheckIn, e);
      }
      
      if (checkInTime && !isNaN(checkInTime.getTime())) {
        timeRecords.push({
          department,
          name,
          employeeNumber,
          timestamp: checkInTime,
          status: 'check_in',
          originalIndex: i
        });
      }
    }
    
    // Process check-out if present
    if (row[checkOutColumn]) {
      const rawCheckOut = String(row[checkOutColumn]).trim();
      let checkOutTime: Date | null = null;
      
      try {
        checkOutTime = parseTimestamp(rawCheckOut);
      } catch (e) {
        console.warn('Failed to parse check-out time:', rawCheckOut, e);
      }
      
      if (checkOutTime && !isNaN(checkOutTime.getTime())) {
        timeRecords.push({
          department,
          name,
          employeeNumber,
          timestamp: checkOutTime,
          status: 'check_out',
          originalIndex: i
        });
      }
    }
  }
  
  console.log(`Processed ${timeRecords.length} time records from separate columns (skipped ${skipCount} rows)`);
  
  // Verify we have at least some valid records
  if (timeRecords.length === 0) {
    throw new Error(
      "No valid time records found in the file with separate check-in/check-out columns. Please check that:\n\n" +
      "• Your Excel file has the correct column headers\n" +
      "• There are valid values in the check-in and check-out columns\n" +
      "• Date/time values are in a recognized format\n" +
      "• Employee names and numbers are properly formatted"
    );
  }
  
  // Group time records by employee
  return processTimeRecords(timeRecords);
};

/**
 * Helper function to parse various timestamp formats
 */
export const parseTimestamp = (rawTimestamp: string): Date | null => {
  if (!rawTimestamp) return null;
  
  // Try standard Date constructor first
  let timestamp = new Date(rawTimestamp);
  
  // If invalid, try various parsing approaches
  if (isNaN(timestamp.getTime())) {
    // Try Excel serial date format
    const serialDate = parseFloat(rawTimestamp);
    if (!isNaN(serialDate)) {
      // Convert Excel serial date to JS Date
      const millisecondsPerDay = 24 * 60 * 60 * 1000;
      timestamp = new Date((serialDate - 25569) * millisecondsPerDay);
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
        // More formats
        'MM-dd-yyyy HH:mm:ss',
        'MM-dd-yyyy HH:mm',
        'dd-MM-yyyy HH:mm:ss',
        'dd-MM-yyyy HH:mm',
        'MM/dd/yy HH:mm:ss',
        'MM/dd/yy HH:mm',
        'dd/MM/yy HH:mm:ss',
        'dd/MM/yy HH:mm',
        // Time only formats (assumes current date)
        'HH:mm:ss',
        'HH:mm',
        // 12-hour formats with AM/PM
        'MM/dd/yyyy h:mm:ss a',
        'MM/dd/yyyy h:mm a',
        'dd/MM/yyyy h:mm:ss a',
        'dd/MM/yyyy h:mm a',
        'h:mm:ss a',
        'h:mm a'
      ];
      
      for (const formatStr of dateFormats) {
        try {
          const parsedDate = parse(rawTimestamp, formatStr, new Date());
          if (!isNaN(parsedDate.getTime())) {
            timestamp = parsedDate;
            break;
          }
        } catch (err) {
          // Continue to next format
        }
      }
    }
  }
  
  // If still invalid, try parsing components
  if (isNaN(timestamp.getTime())) {
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
      } catch (err) {
        console.error('Failed to parse from components:', err);
        return null;
      }
    } else {
      // Maybe it's just a time without a date
      const timePattern = /(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*([AP]M))?/i;
      const timeMatch = rawTimestamp.match(timePattern);
      
      if (timeMatch) {
        const today = new Date();
        const hours = parseInt(timeMatch[1], 10);
        const minutes = parseInt(timeMatch[2], 10);
        const seconds = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const isPM = timeMatch[4]?.toUpperCase() === 'PM';
        
        // Adjust hours for PM
        const adjustedHours = isPM && hours < 12 ? hours + 12 : hours;
        
        timestamp = new Date(
          today.getFullYear(), 
          today.getMonth(), 
          today.getDate(), 
          adjustedHours, 
          minutes, 
          seconds
        );
      } else {
        return null; // Can't parse
      }
    }
  }
  
  return timestamp;
};

/**
 * Try to extract hour from a timestamp string
 */
export const tryExtractHour = (timestampStr: string): number | null => {
  // Check for common time patterns
  const timePatterns = [
    /(\d{1,2}):\d{2}(?::\d{2})?(?:\s*[AP]M)?/i, // 12:30, 12:30:45, 12:30 PM
    /(\d{1,2})(?::\d{2})?\s*([AP]M)/i,  // 12 PM, 12:30 PM
  ];
  
  for (const pattern of timePatterns) {
    const match = timestampStr.match(pattern);
    if (match) {
      let hour = parseInt(match[1], 10);
      
      // Check for AM/PM
      if (match[2] && match[2].toUpperCase() === 'PM' && hour < 12) {
        hour += 12;
      }
      
      return hour;
    }
  }
  
  return null;
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