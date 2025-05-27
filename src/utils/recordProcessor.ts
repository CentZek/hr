import { format } from 'date-fns';
import { TimeRecord, DailyRecord, EmployeeRecord } from '../types';
import { calculatePayableHours, determineShiftType, isLateCheckIn, isEarlyLeave, isExcessiveOvertime } from './shiftCalculations';

/**
 * Identify and fix mislabeled check-ins/check-outs
 */
export const identifyAndFixMislabeledRecords = (records: TimeRecord[]): TimeRecord[] => {
  // Clone records to avoid modifying the original array
  const processedRecords = [...records];
  
  // Check for potential mislabeling
  for (let i = 1; i < processedRecords.length; i++) {
    const prevRecord = processedRecords[i - 1];
    const currRecord = processedRecords[i];
    
    // Skip if records are on different days
    if (prevRecord.timestamp.getDate() !== currRecord.timestamp.getDate()) {
      continue;
    }
    
    // Check for consecutive check-ins or check-outs
    if (prevRecord.status === currRecord.status) {
      // Potential mislabeling
      
      // For consecutive check-ins, the later one might be a check-out
      if (prevRecord.status === 'check_in') {
        // Mark the second one as potentially mislabeled
        currRecord.mislabeled = true;
        currRecord.originalStatus = currRecord.status;
        currRecord.status = 'check_out';
        currRecord.notes = 'Fixed mislabeled check-in (changed to check-out)';
      }
      // For consecutive check-outs, the earlier one might be a check-in
      else if (prevRecord.status === 'check_out') {
        // Mark the first one as potentially mislabeled
        prevRecord.mislabeled = true;
        prevRecord.originalStatus = prevRecord.status;
        prevRecord.status = 'check_in';
        prevRecord.notes = 'Fixed mislabeled check-out (changed to check-in)';
      }
    }
  }
  
  return processedRecords;
};

/**
 * Group records by date
 */
export const groupRecordsByDate = (records: TimeRecord[]): DailyRecord[] => {
  // Group by date
  const dateMap = new Map<string, TimeRecord[]>();
  
  records.forEach(record => {
    const dateStr = format(record.timestamp, 'yyyy-MM-dd');
    
    if (!dateMap.has(dateStr)) {
      dateMap.set(dateStr, []);
    }
    dateMap.get(dateStr)!.push(record);
  });
  
  // Process each date's records
  const dailyRecords: DailyRecord[] = [];
  
  dateMap.forEach((dayRecords, dateStr) => {
    // Find check-ins and check-outs
    const checkIns = dayRecords.filter(r => r.status === 'check_in');
    const checkOuts = dayRecords.filter(r => r.status === 'check_out');
    
    // Get first check-in and last check-out
    const firstCheckIn = checkIns.length > 0 ? 
      checkIns.reduce((earliest, current) => 
        current.timestamp < earliest.timestamp ? current : earliest
      , checkIns[0]).timestamp : null;
    
    const lastCheckOut = checkOuts.length > 0 ? 
      checkOuts.reduce((latest, current) => 
        current.timestamp > latest.timestamp ? current : latest
      , checkOuts[0]).timestamp : null;
    
    // Determine shift type based on check-in time
    const shiftType = firstCheckIn ? determineShiftType(firstCheckIn) : null;
    
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
    
    // Create daily record
    const dailyRecord: DailyRecord = {
      date: dateStr,
      firstCheckIn,
      lastCheckOut,
      hoursWorked,
      approved: false,
      shiftType,
      notes: dayRecords.some(r => r.mislabeled) ? 'Fixed mislabeled check-in/out' : '',
      missingCheckIn,
      missingCheckOut,
      isLate,
      earlyLeave,
      excessiveOvertime,
      penaltyMinutes: 0,
      allTimeRecords: dayRecords,
      hasMultipleRecords: dayRecords.length > 2
    };
    
    dailyRecords.push(dailyRecord);
  });
  
  // Sort by date
  dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
  
  return dailyRecords;
};

/**
 * Group time records by employee
 */
export const groupRecordsByEmployee = (records: TimeRecord[]): EmployeeRecord[] => {
  // Group by employee number
  const employeeMap = new Map<string, TimeRecord[]>();
  
  records.forEach(record => {
    if (!employeeMap.has(record.employeeNumber)) {
      employeeMap.set(record.employeeNumber, []);
    }
    employeeMap.get(record.employeeNumber)!.push(record);
  });
  
  // Process each employee's records
  const employeeRecords: EmployeeRecord[] = [];
  
  employeeMap.forEach((records, employeeNumber) => {
    // Sort records by timestamp
    records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Process records to identify and fix mislabeled check-ins/check-outs
    const processedRecords = identifyAndFixMislabeledRecords(records);
    
    // Group records by date
    const dailyRecords = groupRecordsByDate(processedRecords);
    
    // Create employee record
    const employeeRecord: EmployeeRecord = {
      employeeNumber,
      name: records[0].name,
      department: records[0].department,
      days: dailyRecords,
      totalDays: dailyRecords.length,
      expanded: false
    };
    
    employeeRecords.push(employeeRecord);
  });
  
  return employeeRecords;
};