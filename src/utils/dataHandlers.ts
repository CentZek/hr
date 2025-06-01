/**
 * Time record helper functions for applying changes to daily records
 */
import { EmployeeRecord, DailyRecord } from '../types';
import { calculatePayableHours, determineShiftType } from './shiftCalculations';

// Calculate statistics from employee records
export const calculateStats = (records: EmployeeRecord[]) => {
  const totalEmployees = records.length;
  let totalDays = 0;
  
  records.forEach(employee => {
    totalDays += employee.days.length;
  });
  
  return { totalEmployees, totalDays };
};

// Add a manual entry to the employee records
export const addManualEntryToRecords = (
  recordData: any, 
  employeeRecords: EmployeeRecord[]
): { updatedRecords: EmployeeRecord[], employeeIndex: number, isNewEmployee: boolean } => {
  // Create a copy of the records to avoid direct state mutation
  const updatedRecords = [...employeeRecords];
  
  // Extract data from the record
  const employeeNumber = String(recordData.employee.employee_number || recordData.employee.employeeNumber || "").trim();
  const employeeName = recordData.employee.name;
  const date = recordData.date;
  const checkIn = recordData.checkIn;
  const checkOut = recordData.checkOut;
  const shiftType = recordData.shiftType;
  const notes = recordData.notes || 'Manual entry';
  
  // Check if this is an off day
  const isOffDay = !checkIn && !checkOut;
  
  // Create the daily record
  const dailyRecord: DailyRecord = {
    date,
    firstCheckIn: checkIn,
    lastCheckOut: checkOut,
    hoursWorked: recordData.hoursWorked || 0,
    approved: false,
    shiftType: isOffDay ? 'off_day' : (shiftType || (checkIn ? determineShiftType(checkIn) : null)),
    notes: isOffDay ? 'OFF-DAY' : notes,
    missingCheckIn: !checkIn,
    missingCheckOut: !checkOut,
    isLate: false,
    earlyLeave: false,
    excessiveOvertime: false,
    penaltyMinutes: 0,
    displayCheckIn: isOffDay ? 'OFF-DAY' : undefined,
    displayCheckOut: isOffDay ? 'OFF-DAY' : undefined
  };
  
  // Find employee index in records
  let employeeIndex = updatedRecords.findIndex(emp => 
    String(emp.employeeNumber).trim() === employeeNumber
  );
  
  let isNewEmployee = false;
  
  if (employeeIndex >= 0) {
    // Employee exists, add or update the day
    const dayIndex = updatedRecords[employeeIndex].days.findIndex(day => day.date === date);
    
    if (dayIndex >= 0) {
      // Update existing day
      updatedRecords[employeeIndex].days[dayIndex] = dailyRecord;
    } else {
      // Add new day
      updatedRecords[employeeIndex].days.push(dailyRecord);
      updatedRecords[employeeIndex].totalDays += 1;
    }
  } else {
    // Employee doesn't exist, create new record
    isNewEmployee = true;
    employeeIndex = updatedRecords.length;
    updatedRecords.push({
      employeeNumber,
      name: employeeName,
      department: recordData.department || '',
      days: [dailyRecord],
      totalDays: 1,
      expanded: true // Auto-expand to show the new entry
    });
  }
  
  return { updatedRecords, employeeIndex, isNewEmployee };
};

// Process records after saving (removing approved days)
export const processRecordsAfterSave = (employeeRecords: EmployeeRecord[]): EmployeeRecord[] => {
  // Create a deep copy of employee records
  const updatedRecords = employeeRecords.map(employee => {
    // Filter out approved days
    const remainingDays = employee.days.filter(day => !day.approved);
    
    return {
      ...employee,
      days: remainingDays,
      totalDays: remainingDays.length,
      // Keep expanded state for employees with remaining days
      expanded: remainingDays.length > 0 ? employee.expanded : false
    };
  });
  
  // Filter out employees with no remaining days
  return updatedRecords.filter(employee => employee.days.length > 0);
};

// Apply a penalty to a specific day
export const applyPenaltyToDay = (day: DailyRecord, penaltyMinutes: number): DailyRecord => {
  const updatedDay = { ...day };
  
  // Update penalty minutes
  updatedDay.penaltyMinutes = penaltyMinutes;
  
  // Recalculate hours worked with the penalty applied
  if (updatedDay.firstCheckIn && updatedDay.lastCheckOut) {
    // Derive shift type if missing
    const shiftType = updatedDay.shiftType || determineShiftType(updatedDay.firstCheckIn);
    
    // Update the shift type if it was missing
    if (!updatedDay.shiftType) {
      updatedDay.shiftType = shiftType;
    }
    
    console.log(`TimeRecordHelpers - Before recalculation, hours were: ${updatedDay.hoursWorked.toFixed(2)}`);
    
    // Calculate new hours with penalty applied
    updatedDay.hoursWorked = calculatePayableHours(
      updatedDay.firstCheckIn, 
      updatedDay.lastCheckOut, 
      shiftType, 
      penaltyMinutes,
      true // Mark as manual edit to use exact time calculation
    );
    
    console.log(`TimeRecordHelpers - After recalculation with ${penaltyMinutes} minute penalty, hours are: ${updatedDay.hoursWorked.toFixed(2)}`);
  } else {
    console.log(`Missing check-in or check-out for this day, cannot recalculate hours`);
  }
  
  return updatedDay;
};

// Update check-in and check-out times for a day
export const updateTimeRecords = (
  day: DailyRecord,
  checkIn: Date | null,
  checkOut: Date | null,
  shiftType: string | null,
  notes: string
): DailyRecord => {
  const updatedDay = { ...day };
  let didUpdate = false;
  
  // If both check-in and check-out are null, and notes indicate a leave day
  if (checkIn === null && checkOut === null && notes !== 'OFF-DAY' && notes.trim() !== '') {
    updatedDay.firstCheckIn = null;
    updatedDay.lastCheckOut = null;
    updatedDay.missingCheckIn = true;
    updatedDay.missingCheckOut = true;
    updatedDay.hoursWorked = 0;
    updatedDay.notes = notes;
    updatedDay.shiftType = 'off_day'; // Keep shift type as 'off_day' for leave records
    updatedDay.isLate = false;
    updatedDay.earlyLeave = false;
    updatedDay.excessiveOvertime = false;
    updatedDay.penaltyMinutes = 0;
    // Set display values for leave types
    updatedDay.displayCheckIn = notes;
    updatedDay.displayCheckOut = notes;
    
    return updatedDay;
  }
  
  // If both check-in and check-out are null, mark as OFF-DAY
  if (checkIn === null && checkOut === null) {
    updatedDay.firstCheckIn = null;
    updatedDay.lastCheckOut = null;
    updatedDay.missingCheckIn = true;
    updatedDay.missingCheckOut = true;
    updatedDay.hoursWorked = 0;
    updatedDay.notes = 'OFF-DAY';
    updatedDay.shiftType = 'off_day';
    updatedDay.isLate = false;
    updatedDay.earlyLeave = false;
    updatedDay.excessiveOvertime = false;
    updatedDay.penaltyMinutes = 0;
    // Set display values for OFF-DAY
    updatedDay.displayCheckIn = 'OFF-DAY';
    updatedDay.displayCheckOut = 'OFF-DAY';
    
    return updatedDay;
  }
  
  // Update check-in and check-out times
  if (checkIn !== null && (!updatedDay.firstCheckIn || checkIn.getTime() !== updatedDay.firstCheckIn.getTime())) {
    updatedDay.firstCheckIn = checkIn;
    updatedDay.missingCheckIn = false;
    didUpdate = true;
  }
  
  if (checkOut !== null && (!updatedDay.lastCheckOut || checkOut.getTime() !== updatedDay.lastCheckOut.getTime())) {
    updatedDay.lastCheckOut = checkOut;
    updatedDay.missingCheckOut = false;
    didUpdate = true;
  }
  
  // Determine shift type if not already set or if this was an OFF-DAY
  if ((!updatedDay.shiftType || updatedDay.notes === 'OFF-DAY') && updatedDay.firstCheckIn) {
    updatedDay.shiftType = determineShiftType(updatedDay.firstCheckIn);
    // If we're changing from OFF-DAY, we need to update the notes
    if (updatedDay.notes === 'OFF-DAY') {
      updatedDay.notes = 'Manual entry';
    }
    didUpdate = true;
  }
  
  // Recalculate hours and flags
  if ((updatedDay.firstCheckIn && updatedDay.lastCheckOut && didUpdate) || 
      (updatedDay.notes === 'OFF-DAY' && (checkIn || checkOut))) {
    // If we have check-in and check-out times but this was an OFF-DAY, we need to update it
    if (updatedDay.notes === 'OFF-DAY' && checkIn && checkOut) {
      updatedDay.notes = 'Manual entry';
      updatedDay.shiftType = determineShiftType(checkIn);
    }

    const shiftType = updatedDay.shiftType || (updatedDay.firstCheckIn ? determineShiftType(updatedDay.firstCheckIn) : null);
    
    if (shiftType && updatedDay.firstCheckIn && updatedDay.lastCheckOut) {
      // Always recalculate hours when either check-in or check-out changes
      updatedDay.hoursWorked = calculatePayableHours(
        updatedDay.firstCheckIn, 
        updatedDay.lastCheckOut, 
        shiftType,
        updatedDay.penaltyMinutes,
        true // Mark as manual edit to use exact time calculation
      );
      
      console.log(`Calculated ${updatedDay.hoursWorked.toFixed(2)} hours for edited time records with ${updatedDay.penaltyMinutes} minute penalty`);
    }
  }
  
  return updatedDay;
};

// Set approval status for a day
export const setDayApprovalStatus = (day: DailyRecord, isApproved: boolean): DailyRecord => {
  return {
    ...day,
    approved: isApproved
  };
};

// Apply approval status to all days in a collection
export const approveAllDays = (days: DailyRecord[]): DailyRecord[] => {
  return days.map(day => ({
    ...day,
    approved: true
  }));
};