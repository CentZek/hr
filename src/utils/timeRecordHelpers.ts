/**
 * Time record helper functions for applying changes to daily records
 */
import { DailyRecord } from '../types';
import { calculatePayableHours, determineShiftType } from './shiftCalculations';

// Ensure we have a Date object
const ensureDate = (dateInput: Date | string | null): Date | null => {
  if (!dateInput) return null;
  return dateInput instanceof Date ? dateInput : new Date(dateInput);
};

// Apply a penalty to a specific day
export const applyPenaltyToDay = (day: DailyRecord, penaltyMinutes: number): DailyRecord => {
  const updatedDay = { ...day };
  
  // Update penalty minutes
  updatedDay.penaltyMinutes = penaltyMinutes;
  
  // Recalculate hours worked with the penalty applied
  if (updatedDay.firstCheckIn && updatedDay.lastCheckOut) {
    // Ensure we have Date objects
    const firstCheckIn = ensureDate(updatedDay.firstCheckIn);
    const lastCheckOut = ensureDate(updatedDay.lastCheckOut);
    
    // Derive shift type if missing
    const shiftType = updatedDay.shiftType || determineShiftType(firstCheckIn!);
    
    // Update the shift type if it was missing
    if (!updatedDay.shiftType) {
      updatedDay.shiftType = shiftType;
    }
    
    console.log(`TimeRecordHelpers - Before recalculation, hours were: ${updatedDay.hoursWorked.toFixed(2)}`);
    
    // Calculate new hours with penalty applied
    updatedDay.hoursWorked = calculatePayableHours(
      firstCheckIn, 
      lastCheckOut, 
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
  checkIn: Date | string | null,
  checkOut: Date | string | null
): DailyRecord => {
  const updatedDay = { ...day };
  let didUpdate = false;
  
  // Ensure we have proper Date objects (or null)
  const checkInDate = checkIn ? ensureDate(checkIn) : null;
  const checkOutDate = checkOut ? ensureDate(checkOut) : null;
  
  // If both check-in and check-out are null, mark as OFF-DAY
  if (checkInDate === null && checkOutDate === null) {
    updatedDay.firstCheckIn = null;
    updatedDay.lastCheckOut = null;
    updatedDay.missingCheckIn = true;
    updatedDay.missingCheckOut = true;
    updatedDay.hoursWorked = 0;
    updatedDay.notes = 'OFF-DAY';
    updatedDay.shiftType = null;
    updatedDay.isLate = false;
    updatedDay.earlyLeave = false;
    updatedDay.excessiveOvertime = false;
    updatedDay.penaltyMinutes = 0;
    
    return updatedDay;
  }
  
  // Update check-in and check-out times
  if (checkInDate !== null && (!updatedDay.firstCheckIn || 
      (updatedDay.firstCheckIn instanceof Date && checkInDate.getTime() !== updatedDay.firstCheckIn.getTime()) ||
      (!(updatedDay.firstCheckIn instanceof Date)))) {
    updatedDay.firstCheckIn = checkInDate;
    updatedDay.missingCheckIn = false;
    didUpdate = true;
  }
  
  if (checkOutDate !== null && (!updatedDay.lastCheckOut || 
      (updatedDay.lastCheckOut instanceof Date && checkOutDate.getTime() !== updatedDay.lastCheckOut.getTime()) ||
      (!(updatedDay.lastCheckOut instanceof Date)))) {
    updatedDay.lastCheckOut = checkOutDate;
    updatedDay.missingCheckOut = false;
    didUpdate = true;
  }
  
  // Determine shift type if not already set
  if (!updatedDay.shiftType && updatedDay.firstCheckIn) {
    updatedDay.shiftType = determineShiftType(updatedDay.firstCheckIn);
  }
  
  // Recalculate hours and flags
  if (updatedDay.firstCheckIn && updatedDay.lastCheckOut && didUpdate) {
    // Ensure we have Date objects
    const firstCheckIn = ensureDate(updatedDay.firstCheckIn);
    const lastCheckOut = ensureDate(updatedDay.lastCheckOut);
    
    const shiftType = updatedDay.shiftType || determineShiftType(firstCheckIn!);
    
    // Always recalculate hours when either check-in or check-out changes
    updatedDay.hoursWorked = calculatePayableHours(
      firstCheckIn, 
      lastCheckOut, 
      shiftType,
      updatedDay.penaltyMinutes,
      true // Mark as manual edit to use exact time calculation
    );
    
    console.log(`Calculated ${updatedDay.hoursWorked.toFixed(2)} hours for edited time records with ${updatedDay.penaltyMinutes} minute penalty`);
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