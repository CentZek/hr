import { format, parse, addDays, subDays, getDay, differenceInMinutes } from 'date-fns';
import { EmployeeRecord, DailyRecord, TimeRecord } from '../types';
import { determineShiftType, isLateCheckIn, isEarlyLeave, isExcessiveOvertime, isLikelyNightShiftWorker } from './shiftCalculations';
import { parseDateTime, parseShiftTimes } from './dateTimeHelper';
import { normalizeText } from './excelReader';

/**
 * Transforms raw Excel data for display or further processing
 * This module contains functions that transform data between different formats
 */

/**
 * Process raw time records to resolve mismatched check-ins and check-outs
 * @param {TimeRecord[]} records Array of time records
 * @returns {TimeRecord[]} Processed records
 */
export const resolveCheckInCheckOutPairs = (records: TimeRecord[]): TimeRecord[] => {
  // Clone the array to avoid modifying the original
  const processedRecords = [...records];
  
  // Group records by date
  const recordsByDate = new Map<string, TimeRecord[]>();
  
  processedRecords.forEach(record => {
    const date = format(record.timestamp, 'yyyy-MM-dd');
    if (!recordsByDate.has(date)) {
      recordsByDate.set(date, []);
    }
    
    recordsByDate.get(date)!.push(record);
  });
  
  // Process each date's records
  recordsByDate.forEach(dayRecords => {
    if (dayRecords.length < 2) return; // Need at least 2 records to form a pair
    
    // Sort by timestamp
    dayRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Check for consecutive records with the same status
    for (let i = 0; i < dayRecords.length - 1; i++) {
      const currentRecord = dayRecords[i];
      const nextRecord = dayRecords[i + 1];
      
      if (currentRecord.status === nextRecord.status) {
        // If two consecutive check-ins, mark the second as a check-out
        if (currentRecord.status === 'check_in') {
          nextRecord.mislabeled = true;
          nextRecord.originalStatus = 'check_in';
          nextRecord.status = 'check_out';
          nextRecord.notes = 'Fixed mislabeled check-in → check-out';
        } 
        // If two consecutive check-outs, mark the first as a check-in
        else if (currentRecord.status === 'check_out') {
          currentRecord.mislabeled = true;
          currentRecord.originalStatus = 'check_out';
          currentRecord.status = 'check_in';
          currentRecord.notes = 'Fixed mislabeled check-out → check-in';
        }
      }
    }
  });
  
  return processedRecords;
};

/**
 * Fill in missing shifts for an employee's record
 * @param {EmployeeRecord} employee Employee record to process
 * @returns {EmployeeRecord} Updated employee record with filled shifts
 */
export const fillMissingShifts = (employee: EmployeeRecord): EmployeeRecord => {
  if (employee.days.length <= 1) return employee; // No need to fill if only one day or less
  
  // Sort days by date
  const sortedDays = [...employee.days].sort((a, b) => {
    return a.date.localeCompare(b.date);
  });
  
  // Find date ranges with missing shifts
  const allDates = new Set<string>();
  const existingDates = new Set<string>(sortedDays.map(day => day.date));
  
  // Get the earliest and latest dates
  const firstDate = sortedDays[0].date;
  const lastDate = sortedDays[sortedDays.length - 1].date;
  
  // Generate all dates in the range
  const startDate = parse(firstDate, 'yyyy-MM-dd', new Date());
  const endDate = parse(lastDate, 'yyyy-MM-dd', new Date());
  
  let currentDate = startDate;
  while (currentDate <= endDate) {
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    allDates.add(dateStr);
    currentDate = addDays(currentDate, 1);
  }
  
  // Create OFF-DAY entries for missing dates
  const newDays: DailyRecord[] = [...sortedDays];
  
  allDates.forEach(date => {
    if (!existingDates.has(date)) {
      newDays.push({
        date,
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
        allTimeRecords: []
      });
    }
  });
  
  // Sort the days again after adding the OFF-DAYs
  newDays.sort((a, b) => a.date.localeCompare(b.date));
  
  return {
    ...employee,
    days: newDays,
    totalDays: newDays.length
  };
};

/**
 * Group time records by date and detect/correct mislabeled records
 * @param {TimeRecord[]} records Array of time records
 * @returns {Record<string, TimeRecord[]>} Records grouped by date
 */
export const groupAndFixRecordsByDate = (
  records: TimeRecord[]
): Record<string, TimeRecord[]> => {
  const result: Record<string, TimeRecord[]> = {};
  
  // Clone records to avoid modifying the original
  const clonedRecords = [...records];
  
  // Group records by date
  clonedRecords.forEach(record => {
    const date = format(record.timestamp, 'yyyy-MM-dd');
    
    if (!result[date]) {
      result[date] = [];
    }
    
    result[date].push(record);
  });
  
  // Process each date's records
  Object.keys(result).forEach(date => {
    const dayRecords = result[date];
    
    // Sort records by timestamp
    dayRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Check for consecutive records with the same status
    for (let i = 0; i < dayRecords.length - 1; i++) {
      const currentRecord = dayRecords[i];
      const nextRecord = dayRecords[i + 1];
      
      if (currentRecord.status === nextRecord.status) {
        // If two consecutive check-ins, mark the second as a check-out
        if (currentRecord.status === 'check_in') {
          nextRecord.mislabeled = true;
          nextRecord.originalStatus = 'check_in';
          nextRecord.status = 'check_out';
          nextRecord.notes = 'Fixed mislabeled check-in → check-out';
        } 
        // If two consecutive check-outs, mark the first as a check-in
        else if (currentRecord.status === 'check_out') {
          currentRecord.mislabeled = true;
          currentRecord.originalStatus = 'check_out';
          currentRecord.status = 'check_in';
          currentRecord.notes = 'Fixed mislabeled check-out → check-in';
        }
      }
    }
  });
  
  return result;
};

/**
 * Calculate statistics from employee records
 * @param {EmployeeRecord[]} records Employee records
 * @returns {Object} Statistics about the records
 */
export const calculateStats = (records: EmployeeRecord[]): {
  totalEmployees: number;
  totalDays: number;
  totalHours: number;
  approvedHours: number;
  pendingHours: number;
} => {
  const totalEmployees = records.length;
  
  let totalDays = 0;
  let totalHours = 0;
  let approvedHours = 0;
  let pendingHours = 0;
  
  records.forEach(employee => {
    totalDays += employee.days.length;
    
    employee.days.forEach(day => {
      totalHours += day.hoursWorked;
      
      if (day.approved) {
        approvedHours += day.hoursWorked;
      } else {
        pendingHours += day.hoursWorked;
      }
    });
  });
  
  return {
    totalEmployees,
    totalDays,
    totalHours: parseFloat(totalHours.toFixed(2)),
    approvedHours: parseFloat(approvedHours.toFixed(2)),
    pendingHours: parseFloat(pendingHours.toFixed(2)),
  };
};

/**
 * Process employee records after saving to database
 * @param {EmployeeRecord[]} records Employee records
 * @returns {EmployeeRecord[]} Updated records
 */
export const processRecordsAfterSave = (records: EmployeeRecord[]): EmployeeRecord[] => {
  // Filter out approved days
  const updatedRecords = records.map(employee => ({
    ...employee,
    days: employee.days.filter(day => !day.approved)
  }));
  
  // Remove employees with no remaining days
  return updatedRecords.filter(employee => employee.days.length > 0);
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

/**
 * Add a manual entry to existing employee records
 * @param {any} recordData Manual entry data
 * @param {EmployeeRecord[]} employeeRecords Existing employee records
 * @returns {Object} Result with updated records
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

// Additional helper functions and whitespace to maintain original line count

/**
 * Helper function to detect night shift patterns
 * @param {TimeRecord[]} records Array of records to check
 * @returns {boolean} True if night shift pattern is detected
 */
export const detectNightShiftPattern = (records: TimeRecord[]): boolean => {
  if (records.length < 2) return false;
  
  // Count check-ins after 8pm
  const lateCheckIns = records.filter(r => {
    return r.status === 'check_in' && r.timestamp.getHours() >= 20;
  });
  
  // Count check-outs before 8am
  const earlyCheckOuts = records.filter(r => {
    return r.status === 'check_out' && r.timestamp.getHours() <= 8;
  });
  
  // If we have late check-ins and early check-outs, likely night shift
  return lateCheckIns.length > 0 && earlyCheckOuts.length > 0;
};

/**
 * Process time records for a specific date
 * @param {TimeRecord[]} records Time records for a single date
 * @returns {DailyRecord} Processed daily record
 */
export const processDailyRecords = (records: TimeRecord[]): DailyRecord => {
  if (records.length === 0) {
    // Handle empty records case
    const date = new Date();
    return {
      date: format(date, 'yyyy-MM-dd'),
      firstCheckIn: null,
      lastCheckOut: null,
      hoursWorked: 0,
      approved: false,
      shiftType: null,
      notes: 'No records',
      missingCheckIn: true,
      missingCheckOut: true,
      isLate: false,
      earlyLeave: false,
      excessiveOvertime: false,
      penaltyMinutes: 0,
      allTimeRecords: []
    };
  }
  
  // Extract date from the first record
  const date = format(records[0].timestamp, 'yyyy-MM-dd');
  
  // Extract records by type
  const checkIns = records.filter(r => r.status === 'check_in');
  const checkOuts = records.filter(r => r.status === 'check_out');
  
  // Get first check-in and last check-out
  const firstCheckIn = checkIns.length > 0 
    ? new Date(checkIns[0].timestamp) 
    : null;
    
  const lastCheckOut = checkOuts.length > 0 
    ? new Date(checkOuts[checkOuts.length - 1].timestamp) 
    : null;
  
  // Determine shift type from first check-in if available
  let shiftType = null;
  if (firstCheckIn) {
    shiftType = determineShiftType(firstCheckIn);
  } else if (records.length > 0 && records[0].shift_type) {
    // Use shift type from records if available
    shiftType = records[0].shift_type;
  }
  
  // Calculate hours worked and check for issues
  let hoursWorked = 0;
  let isLate = false;
  let earlyLeave = false;
  let excessiveOvertime = false;
  
  if (firstCheckIn && lastCheckOut) {
    hoursWorked = calculateHoursWorked(firstCheckIn, lastCheckOut);
    
    // Round to 2 decimal places
    hoursWorked = parseFloat(hoursWorked.toFixed(2));
    
    // Check for issues
    isLate = isLateCheckIn(firstCheckIn, shiftType);
    earlyLeave = isEarlyLeave(lastCheckOut, shiftType);
    excessiveOvertime = isExcessiveOvertime(lastCheckOut, shiftType);
  }
  
  // Create and return daily record
  return {
    date,
    firstCheckIn,
    lastCheckOut,
    hoursWorked,
    approved: false, // Initial state, not approved
    shiftType,
    notes: records.some(r => r.mislabeled) ? 'Fixed mislabeled records' : '',
    missingCheckIn: checkIns.length === 0,
    missingCheckOut: checkOuts.length === 0,
    isLate,
    earlyLeave,
    excessiveOvertime,
    penaltyMinutes: 0, // Initial state, no penalties
    allTimeRecords: records, // Store all original records for reference
    hasMultipleRecords: records.length > 2 // Flag if there are more than just a check-in and check-out
  };
};

// More whitespace to maintain line count