/**
 * Time record helper functions for applying changes to daily records
 */
import { DailyRecord, TimeRecord } from '../types';
import { calculatePayableHours, determineShiftType } from './shiftCalculations';
import { parseISO, addDays, format } from 'date-fns';

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
  checkOut: Date | null
): DailyRecord => {
  const updatedDay = { ...day };
  let didUpdate = false;
  
  // If both check-in and check-out are null, mark as OFF-DAY
  if (checkIn === null && checkOut === null) {
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
  
  // Determine shift type if not already set
  if (!updatedDay.shiftType && updatedDay.firstCheckIn) {
    updatedDay.shiftType = determineShiftType(updatedDay.firstCheckIn);
  }
  
  // Recalculate hours and flags
  if (updatedDay.firstCheckIn && updatedDay.lastCheckOut && didUpdate) {
    const shiftType = updatedDay.shiftType || determineShiftType(updatedDay.firstCheckIn);
    
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

// Helper function to pair night shifts spanning across two days
export function pairNightShifts(records: any[]) {
  const pairs: { date: string; checkIn: any; checkOut: any }[] = [];
  const used = new Set<string>();  // track record IDs that get paired

  // Group by employee
  const byEmp = records.reduce<Record<string, any[]>>((acc, r) => {
    if (!acc[r.employee_id]) {
      acc[r.employee_id] = [];
    }
    acc[r.employee_id].push(r);
    return acc;
  }, {});

  Object.values(byEmp).forEach(empRecs => {
    // Pick all night-shift check-ins (e.g. 18:00–23:59)
    const ins = empRecs.filter(r =>
      r.status === 'check_in' &&
      r.shift_type === 'night' &&
      new Date(r.timestamp).getHours() >= 18
    );
    
    ins.forEach(ci => {
      // Find the matching next-day check-out (e.g. 00:00–08:00)
      const checkInDate = parseISO(ci.timestamp);
      const targetDay = format(addDays(checkInDate, 1), 'yyyy-MM-dd');
      
      const co = empRecs.find(r =>
        r.status === 'check_out' &&
        r.shift_type === 'night' &&
        format(parseISO(r.timestamp), 'yyyy-MM-dd') === targetDay &&
        new Date(r.timestamp).getHours() < 8
      );
      
      if (co) {
        pairs.push({
          date: format(parseISO(ci.timestamp), 'yyyy-MM-dd'),
          checkIn: ci,
          checkOut: co
        });
        used.add(ci.id);
        used.add(co.id);
      }
    });
  });

  return { pairs, used };
}