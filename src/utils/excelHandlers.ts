import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { TimeRecord, EmployeeRecord, DailyRecord } from '../types';
import { calculatePayableHours, determineShiftType, isLateCheckIn, isEarlyLeave, isExcessiveOvertime, isLikelyNightShiftWorker } from './shiftCalculations';
import { parseDateTime } from './dateTimeHelper';

/**
 * Processes an Excel file and extracts time records
 */
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  // Read the file
  const fileData = await readExcelFile(file);
  if (!fileData || !fileData.length) {
    throw new Error('No data found in the Excel file');
  }

  // Process records
  const timeRecords = parseExcelData(fileData);
  if (!timeRecords.length) {
    throw new Error('No valid time records found in the Excel file');
  }
  
  // Group time records by employee and date
  const employeeRecords = groupTimeRecordsByEmployee(timeRecords);
  
  // Ensure all required fields are present and fix any missing data
  validateAndFixData(employeeRecords);
  
  return employeeRecords;
};

/**
 * Read an Excel file and return the data as an array of rows
 */
const readExcelFile = async (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Assume first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        resolve(jsonData);
      } catch (error) {
        reject(new Error('Error processing Excel file: ' + error));
      }
    };
    reader.onerror = () => reject(new Error('Error reading the file'));
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Parse Excel data into TimeRecord objects
 */
const parseExcelData = (data: any[]): TimeRecord[] => {
  const timeRecords: TimeRecord[] = [];
  let currentIndex = 0;
  
  data.forEach((row, index) => {
    // Skip rows with invalid data
    if (!row['Date/Time'] || !row['Department'] || !row['Name'] || !row['Employee NO.'] || !row['Status']) {
      return;
    }

    try {
      // Extract fields
      const timestamp = parseDateTime(row['Date/Time']);
      const department = String(row['Department'] || '');
      const name = String(row['Name'] || '');
      const employeeNumber = String(row['Employee NO.'] || '');
      const status = row['Status']?.toLowerCase()?.includes('check in') ? 'check_in' : 'check_out';
      
      // Skip rows with invalid timestamp
      if (!timestamp) return;
      
      // Create time record
      const timeRecord: TimeRecord = {
        department,
        name,
        employeeNumber,
        timestamp,
        status,
        originalIndex: currentIndex++
      };
      
      timeRecords.push(timeRecord);
    } catch (error) {
      console.error(`Error parsing row ${index}:`, error);
    }
  });
  
  return timeRecords;
};

/**
 * Group time records by employee and date
 */
const groupTimeRecordsByEmployee = (timeRecords: TimeRecord[]): EmployeeRecord[] => {
  // First group by employee
  const employeeMap = new Map<string, { name: string; department: string; records: TimeRecord[] }>();
  
  timeRecords.forEach((record) => {
    const key = record.employeeNumber;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, {
        name: record.name,
        department: record.department,
        records: []
      });
    }
    employeeMap.get(key)!.records.push(record);
  });
  
  // Process each employee's records
  const employeeRecords: EmployeeRecord[] = [];
  
  employeeMap.forEach(({ name, department, records }, employeeNumber) => {
    // Sort records by timestamp
    records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Group by date
    const dateMap = new Map<string, TimeRecord[]>();
    records.forEach((record) => {
      const dateKey = format(record.timestamp, 'yyyy-MM-dd');
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, []);
      }
      dateMap.get(dateKey)!.push(record);
    });
    
    // Create daily records
    const days: DailyRecord[] = [];
    
    // Check if this employee is likely a night shift worker
    const isNightShiftWorker = isLikelyNightShiftWorker(records);
    
    dateMap.forEach((dateRecords, date) => {
      // Process this day's records
      const dailyRecord = processDailyRecords(date, dateRecords, isNightShiftWorker);
      
      // Add raw records data for debugging
      dailyRecord.allTimeRecords = dateRecords;
      dailyRecord.hasMultipleRecords = dateRecords.length > 2;
      
      days.push(dailyRecord);
    });
    
    // Sort days by date
    days.sort((a, b) => a.date.localeCompare(b.date));
    
    employeeRecords.push({
      employeeNumber,
      name,
      department,
      days,
      totalDays: days.length,
      expanded: false
    });
  });
  
  return employeeRecords;
};

/**
 * Process a day's worth of time records into a DailyRecord
 */
const processDailyRecords = (date: string, records: TimeRecord[], isNightShiftWorker: boolean): DailyRecord => {
  // Determine check-in and check-out times
  let checkInRecords = records.filter(record => record.status === 'check_in');
  let checkOutRecords = records.filter(record => record.status === 'check_out');
  
  // Handle potential mislabeled records
  const correctedRecords = fixMislabeledRecords(records);
  
  // After correction, re-sort the check-in and check-out records
  checkInRecords = correctedRecords.filter(record => record.status === 'check_in');
  checkOutRecords = correctedRecords.filter(record => record.status === 'check_out');
  
  // Sort check-ins ascending (earliest first)
  checkInRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Sort check-outs descending (latest first)
  checkOutRecords.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  
  // Get first check-in and last check-out
  const firstCheckIn = checkInRecords.length > 0 ? checkInRecords[0].timestamp : null;
  const lastCheckOut = checkOutRecords.length > 0 ? checkOutRecords[0].timestamp : null;
  
  // Determine shift type
  const shiftType = firstCheckIn ? determineShiftType(firstCheckIn, isNightShiftWorker) : null;
  
  // Calculate hours worked
  let hoursWorked = 0;
  if (firstCheckIn && lastCheckOut) {
    hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, shiftType);
  }
  
  // Check for issues
  const missingCheckIn = !firstCheckIn;
  const missingCheckOut = !lastCheckOut;
  const isLate = firstCheckIn ? isLateCheckIn(firstCheckIn, shiftType) : false;
  const earlyLeave = lastCheckOut ? isEarlyLeave(lastCheckOut, shiftType) : false;
  const excessiveOvertime = lastCheckOut ? isExcessiveOvertime(lastCheckOut, shiftType) : false;
  
  // Create notes
  let notes = '';
  if (correctedRecords.some(r => r.mislabeled)) {
    notes = 'Fixed mislabeled check-in/check-out';
  }
  
  return {
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
    penaltyMinutes: 0,
    correctedRecords: correctedRecords.some(r => r.mislabeled),
    working_week_start: date
  };
};

/**
 * Attempt to fix mislabeled records (e.g., a check-in that should be a check-out or vice versa)
 */
const fixMislabeledRecords = (records: TimeRecord[]): TimeRecord[] => {
  if (records.length !== 2) return records;
  
  const [first, second] = records;
  
  // If both have the same status, they might be mislabeled
  if (first.status === second.status) {
    // Check if timestamps make sense for swapping
    if (first.timestamp < second.timestamp) {
      // More likely that first is check-in, second is check-out
      return [
        { ...first, status: 'check_in', mislabeled: first.status === 'check_out', originalStatus: first.status },
        { ...second, status: 'check_out', mislabeled: second.status === 'check_in', originalStatus: second.status }
      ];
    } else {
      // More likely that first is check-out, second is check-in
      return [
        { ...first, status: 'check_out', mislabeled: first.status === 'check_in', originalStatus: first.status },
        { ...second, status: 'check_in', mislabeled: second.status === 'check_out', originalStatus: second.status }
      ];
    }
  }
  
  // If statuses are already different, just sort by timestamp
  if (first.timestamp > second.timestamp) {
    return [second, first];
  }
  
  return records;
};

/**
 * Validate employee records and fix any issues
 */
const validateAndFixData = (employeeRecords: EmployeeRecord[]): void => {
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      // Ensure timestamps are valid Date objects
      if (day.firstCheckIn && !(day.firstCheckIn instanceof Date)) {
        day.firstCheckIn = new Date(day.firstCheckIn);
      }
      if (day.lastCheckOut && !(day.lastCheckOut instanceof Date)) {
        day.lastCheckOut = new Date(day.lastCheckOut);
      }
      
      // Recalculate hours if needed
      if (day.firstCheckIn && day.lastCheckOut && day.hoursWorked <= 0) {
        day.hoursWorked = calculatePayableHours(day.firstCheckIn, day.lastCheckOut, day.shiftType);
      }
    });
  });
};