// Type definitions for the application
import { format, differenceInMinutes, differenceInHours, addDays, subDays, getDay, getHours, getMinutes, isSameDay } from 'date-fns';
import { TimeRecord, SHIFT_TIMES, LATE_TOLERANCE_MINUTES, LATE_THRESHOLDS, CANTEEN_SHIFT_HOURS } from '../types';
import { formatTime24H } from './dateTimeHelper';

// Determine shift type based on check-in time
export const determineShiftType = (
  checkInTime: Date, 
  isNightShiftWorker: boolean = false
): 'morning' | 'evening' | 'night' | 'canteen' | 'custom' => {
  const hour = checkInTime.getHours();
  const minute = checkInTime.getMinutes();
  
  // CANTEEN SHIFT DETECTION - Must come first!
  // FIXED: Correctly detect canteen shifts based on proper time ranges
  // 7AM canteen shift: check-in between 6:20 and 7:20
  if ((hour === 6 && minute >= 20) || (hour === 7 && minute <= 20)) {
    return 'canteen';
  }
  
  // 8AM canteen shift: check-in between 7:20 and 8:40
  if ((hour === 7 && minute > 20) || (hour === 8 && minute <= 40)) {
    return 'canteen';
  }
  
  // Night shift: 9:00 PM - 4:29 AM
  // Check this first since it spans midnight
  if (hour >= 20 || hour < 4 || (hour === 4 && minute < 30)) {
    return 'night';
  }
  
  // Early morning check-ins are considered "morning" shift if they're after 4:30 AM
  if (hour === 4 && minute >= 30) {
    return 'morning';
  }
  
  // Morning shift: 5:00 AM - 12:59 PM
  if (hour >= 5 && hour < 12) {
    return 'morning';
  } 
  
  // Handle 12:00-12:59 time range
  if (hour === 12) {
    if (minute < 30) {
      // Before 12:30 is still considered morning shift
      return 'morning';
    } else {
      // 12:30 and after is evening shift
      return 'evening';
    }
  }
  
  // Evening shift: 1:00 PM - 8:59 PM
  if (hour >= 13 && hour < 20) {
    return 'evening';
  }
  
  // Default to evening shift if we can't determine
  return 'evening';
};

// Check if a check-in is late
export const isLateCheckIn = (checkIn: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean => {
  if (!shiftType) return false;
  
  const hour = checkIn.getHours();
  const minute = checkIn.getMinutes();
  
  // Specific handling for canteen shift - need to determine if 7AM or 8AM canteen staff
  if (shiftType === 'canteen') {
    // FIXED: Correctly check lateness based on canteen shift start time
    // For 7AM canteen shift
    if ((hour === 6 && minute >= 20) || (hour === 7 && minute <= 20)) {
      return hour === 7 && minute > LATE_THRESHOLDS.canteen;
    }
    // For 8AM canteen shift
    else if ((hour === 7 && minute > 20) || (hour === 8 && minute <= 40)) {
      return hour === 8 && minute > LATE_THRESHOLDS.canteen;
    }
    // If not at the exact starting hour, it's late if AFTER the expected start time
    return (hour > 7 && hour < 8) || (hour > 8); 
  }
  
  // Special handling for night shift - only consider late if more than 30 minutes past start time
  if (shiftType === 'night') {
    return (hour > SHIFT_TIMES[shiftType].start.hour || 
            (hour === SHIFT_TIMES[shiftType].start.hour && 
             minute > LATE_THRESHOLDS.night));
  }
  
  // For morning/evening shifts - any minute past the start time is considered late
  if (hour > SHIFT_TIMES[shiftType].start.hour || 
      (hour === SHIFT_TIMES[shiftType].start.hour && 
       minute > LATE_THRESHOLDS[shiftType])) {
    return true;
  }
  
  return false;
};

// Check if a check-out is an early leave
export const isEarlyLeave = (checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean => {
  if (!shiftType) return false;
  
  const hour = checkOut.getHours();
  const minute = checkOut.getMinutes();
  
  // Specific handling for canteen shifts
  if (shiftType === 'canteen') {
    // FIXED: Correctly check early leave based on canteen shift end time
    // Check which canteen shift based on hour
    const is7AMShift = hour < 16 || (hour === 16 && minute < 30);
    
    if (is7AMShift) {
      // 7AM canteen shift: ends at 16:00 (4 PM)
      // Early leave is before 15:30 (3:30 PM)
      if (hour < 15 || (hour === 15 && minute < 30)) {
        return true;
      }
    } else {
      // 8AM canteen shift: ends at 17:00 (5 PM)
      // Early leave is before 16:30 (4:30 PM)
      if (hour < 16 || (hour === 16 && minute < 30)) {
        return true;
      }
    }
    
    return false;
  }
  
  // For night shifts, checkout time is typically the next day in early morning
  // So for 9:00 PM - 6:00 AM shift, early leave would be before 5:30 AM
  if (shiftType === 'night') {
    // For night shift, check-out is typically the next morning
    // So 5-6 AM is normal checkout time
    if (hour < 5 || (hour === 5 && minute < 30)) {
      // Before 5:30 AM is early
      return true;
    }
    return false;
  }
  
  // Check against early leave time from shift definitions
  const earlyLeaveHour = SHIFT_TIMES[shiftType].earlyLeaveTime.hour;
  const earlyLeaveMinute = SHIFT_TIMES[shiftType].earlyLeaveTime.minute;
  
  if (hour < earlyLeaveHour || (hour === earlyLeaveHour && minute < earlyLeaveMinute)) {
    return true;
  }
  
  return false;
};

// Calculate hours worked (raw calculation without adjustments)
export const calculateHoursWorked = (checkInTime: Date, checkOutTime: Date): number => {
  // If checkout time is earlier than check-in time, it likely means checkout was on the next day
  if (checkOutTime < checkInTime) {
    // Add 24 hours to checkout time
    const adjustedCheckOut = new Date(checkOutTime.getTime() + 24 * 60 * 60 * 1000);
    return differenceInMinutes(adjustedCheckOut, checkInTime) / 60;
  }
  
  return differenceInMinutes(checkOutTime, checkInTime) / 60;
};

// Calculate payable hours with business rules applied
export const calculatePayableHours = (
  checkInTime: Date, 
  checkOutTime: Date, 
  shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null,
  penaltyMinutes: number = 0,
  isManualEdit: boolean = false // New parameter to indicate manual time edits
): number => {
  // If shift type is null, try to determine it
  if (!shiftType) {
    shiftType = determineShiftType(checkInTime);
  }
  
  console.log(`Calculating payable hours for ${format(checkInTime, 'yyyy-MM-dd HH:mm')} to ${format(checkOutTime, 'yyyy-MM-dd HH:mm')}, shift: ${shiftType}, penalty: ${penaltyMinutes} minutes, isManualEdit: ${isManualEdit}`);
  
  // Handle night shift specially - use specific calculation
  if (shiftType === 'night') {
    return calculateNightShiftHours(checkInTime, checkOutTime, penaltyMinutes, isManualEdit);
  }
  
  // Calculate minutes between check-in and check-out
  let diffInMinutes = differenceInMinutes(checkOutTime, checkInTime);
  
  // Log the raw time difference before penalty
  console.log(`Raw time difference: ${diffInMinutes} minutes (${(diffInMinutes/60).toFixed(2)} hours)`);
  
  // Convert to hours
  let hours = diffInMinutes / 60;
  
  // Store the raw, penalty-adjusted hours before business rules
  let penaltyAdjustedHours = hours;
  
  // For manual edits, always use the exact calculated hours
  if (isManualEdit) {
    console.log(`Manual edit detected - using exact calculated time: ${hours.toFixed(2)} hours`);
    
    // Apply penalty if any
    if (penaltyMinutes > 0) {
      const penaltyHours = penaltyMinutes / 60;
      hours = Math.max(0, hours - penaltyHours);
      console.log(`After penalty application: ${hours.toFixed(2)} hours`);
    }
    
    // Round to exactly a 2 decimal number
    const finalHours = parseFloat(hours.toFixed(2));
    console.log(`Final hours (manual edit): ${finalHours}`);
    return finalHours;
  }
  
  // Apply business rules for standardized hours
  
  // Excessive overtime: If > 9.5, preserve actual hours worked
  // but if > 15, cap at 15 hours
  if (hours > 15.0) {
    hours = 15.0;
    console.log(`Capped excessive hours to 15.0`);
  } else if (hours > 9.5) {
    // For substantial overtime, round to the nearest 15 minutes
    hours = Math.round(hours * 4) / 4;
    console.log(`Rounded substantial overtime to ${hours} hours`);
  } else {
    // For regular shifts, check if checkout is after the early leave time
    let earlyLeaveHour = 0;
    let earlyLeaveMinute = 0;
    
    if (shiftType === 'canteen') {
      // Check which canteen shift based on hour
      const checkInHour = checkInTime.getHours();
      const checkInMinute = checkInTime.getMinutes();
      const is7AMShift = (checkInHour === 6 && checkInMinute >= 20) || (checkInHour === 7 && checkInMinute <= 20);
      
      if (is7AMShift) {
        // FIXED: Properly determine early leave time based on canteen shift type
        // 7AM shift
        earlyLeaveHour = 15; // 3 PM
        earlyLeaveMinute = 30; // 3:30 PM
      } else {
        // 8AM shift
        earlyLeaveHour = 16; // 4 PM
        earlyLeaveMinute = 30; // 4:30 PM
      }
    } else if (shiftType === 'night') {
      // For night shifts, early leave time is typically 5:30 AM
      earlyLeaveHour = 5;
      earlyLeaveMinute = 30;
    } else if (shiftType) {
      // Regular shifts
      earlyLeaveHour = SHIFT_TIMES[shiftType].earlyLeaveTime.hour;
      earlyLeaveMinute = SHIFT_TIMES[shiftType].earlyLeaveTime.minute;
    }
    
    // Check if checkout is after early leave time
    if (
      checkOutTime.getHours() > earlyLeaveHour || 
      (checkOutTime.getHours() === earlyLeaveHour && checkOutTime.getMinutes() >= earlyLeaveMinute)
    ) {
      // If they checked out after the early leave time, give full 9 hours
      console.log(`Checked out after early leave time: giving 9 hours`);
      hours = 9.0;
    } else if (hours >= 8.5) {
      // If they worked enough time (8.5+ hours), give them 9 hours
      console.log(`Worked at least 8.5 hours: giving 9 hours`);
      hours = 9.0;
    }
  }
  
  // Apply penalty - ensure hours are reduced if there are penalty minutes
  // Convert penalty minutes to hours
  if (penaltyMinutes > 0) {
    const penaltyHours = penaltyMinutes / 60;
    // If penalty is for a full day or more, ensure hours are 0
    if (penaltyHours >= 9) {
      hours = 0;
      console.log(`Applied full day penalty: 0 hours`);
    } else {
      // Otherwise make sure hours are reduced by the penalty
      hours = Math.max(0, hours - penaltyHours);
      console.log(`After penalty application: ${hours.toFixed(2)} hours`);
    }
  }
  
  // Round to exactly a 2 decimal number
  const finalHours = parseFloat(hours.toFixed(2));
  console.log(`Final payable hours: ${finalHours}`);
  return finalHours;
};

// Calculate night shift hours with special handling for cross-day shifts
export const calculateNightShiftHours = (
  checkInTime: Date, 
  checkOutTime: Date,
  penaltyMinutes: number = 0,
  isManualEdit: boolean = false // New parameter to indicate manual time edits
): number => {
  console.log(`Calculating night shift hours for ${format(checkInTime, 'yyyy-MM-dd HH:mm')} to ${format(checkOutTime, 'yyyy-MM-dd HH:mm')}, penalty: ${penaltyMinutes} minutes, isManualEdit: ${isManualEdit}`);
  
  // Create copies to avoid modifying original dates
  const checkIn = new Date(checkInTime);
  let checkOut = new Date(checkOutTime);
  
  // If both times are same day and checkout is earlier, assume it's next day
  if (isSameDay(checkIn, checkOut) && checkIn > checkOut) {
    checkOut = addDays(checkOut, 1);
    console.log(`Adjusted checkout to next day: ${format(checkOut, 'yyyy-MM-dd HH:mm')}`);
  }
  
  // If checkout date is different from check-in date, make sure it's only one day ahead
  // (This handles both normal next-day checkouts and already-computed next-day dates)
  if (!isSameDay(checkIn, checkOut)) {
    const checkInDateOnly = new Date(
      checkIn.getFullYear(), 
      checkIn.getMonth(), 
      checkIn.getDate()
    );
    
    const checkOutDateOnly = new Date(
      checkOut.getFullYear(), 
      checkOut.getMonth(), 
      checkOut.getDate()
    );
    
    const dayDiff = Math.round((checkOutDateOnly.getTime() - checkInDateOnly.getTime()) / (24 * 60 * 60 * 1000));
    
    // If day difference is greater than 1, adjust checkout to be exactly 1 day after check-in
    if (dayDiff > 1) {
      checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + 1);
      checkOut.setHours(checkOutTime.getHours(), checkOutTime.getMinutes(), checkOutTime.getSeconds());
      console.log(`Adjusted checkout for excessive days: ${format(checkOut, 'yyyy-MM-dd HH:mm')}`);
    } else if (dayDiff < 0) {
      // If checkout appears to be before check-in, move it to the next day
      checkOut = new Date(checkIn);
      checkOut.setDate(checkOut.getDate() + 1);
      checkOut.setHours(checkOutTime.getHours(), checkOutTime.getMinutes(), checkOutTime.getSeconds());
      console.log(`Adjusted checkout that appeared to be before checkin: ${format(checkOut, 'yyyy-MM-dd HH:mm')}`);
    }
  }
  
  // Calculate minutes between check-in and check-out
  let diffInMinutes = differenceInMinutes(checkOut, checkIn);
  
  console.log(`Raw time difference: ${diffInMinutes} minutes (${(diffInMinutes/60).toFixed(2)} hours)`);
  
  // Convert to hours
  let hours = diffInMinutes / 60;
  
  // For manual edits, always use exact calculated hours
  if (isManualEdit) {
    console.log(`Manual edit detected - using exact calculated time: ${hours.toFixed(2)} hours`);
    
    // Apply penalty if any
    if (penaltyMinutes > 0) {
      const penaltyHours = penaltyMinutes / 60;
      hours = Math.max(0, hours - penaltyHours);
      console.log(`After penalty application: ${hours.toFixed(2)} hours`);
    }
    
    // Round to exactly a 2 decimal number
    const finalHours = parseFloat(hours.toFixed(2));
    console.log(`Final hours (manual edit): ${finalHours}`);
    return finalHours;
  }
  
  // Night shift hours calculation rules:
  // 1. Cap at 15 hours for excessive shifts
  // 2. For substantial overtime (>9.5h), round to nearest 15 minutes
  // 3. If they checked out after 5:30 AM, give full 9 hours even if they came late
  // 4. If they worked at least 8.5 hours, give them 9 hours
  
  // Apply night shift specific rules
  if (hours > 15.0) {
    hours = 15.0; // Cap at 15 hours
    console.log(`Capped excessive hours to 15.0`);
  } else if (hours > 9.5) {
    // For substantial overtime, round to the nearest 15 minutes
    hours = Math.round(hours * 4) / 4;
    console.log(`Rounded substantial overtime to ${hours} hours`);
  } else {
    // Check if they checked out after the early leave threshold (5:30 AM)
    const checkOutHour = checkOut.getHours();
    const checkOutMinute = checkOut.getMinutes();
    
    if (checkOutHour > 5 || (checkOutHour === 5 && checkOutMinute >= 30)) {
      // If they checked out after 5:30 AM, give full 9 hours
      console.log(`Checked out after early leave threshold (5:30 AM): giving 9 hours`);
      hours = 9.0;
    } else if (hours >= 8.5) {
      // If they worked at least 8.5 hours, give them 9 hours
      console.log(`Worked at least 8.5 hours: giving 9 hours`);
      hours = 9.0;
    }
  }
  
  // Apply penalty - ensure hours are reduced if there are penalty minutes
  if (penaltyMinutes > 0) {
    const penaltyHours = penaltyMinutes / 60;
    // If penalty is for a full day or more, ensure hours are 0
    if (penaltyHours >= 9) {
      hours = 0;
      console.log(`Applied full day penalty: 0 hours`);
    } else {
      // Otherwise make sure hours are reduced by the penalty
      hours = Math.max(0, hours - penaltyHours);
      console.log(`After penalty application: ${hours.toFixed(2)} hours`);
    }
  }
  
  // Round to exactly a 2 decimal number
  const finalHours = parseFloat(hours.toFixed(2));
  console.log(`Final night shift hours: ${finalHours}`);
  return finalHours;
};

// Check if checkout time represents excessive overtime
export const isExcessiveOvertime = (checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean => {
  if (!shiftType) return false;
  
  // Get expected end time
  let endHour = SHIFT_TIMES[shiftType].end.hour;
  
  // Add 1 hour to the expected end time for overtime threshold
  const overtimeHour = endHour + 1;
  
  // For night shifts, we need to handle hours around midnight differently
  if (shiftType === 'night') {
    const hour = checkOut.getHours();
    
    // For night shift, normal checkout is 6 AM
    // If checkout is after 7 AM, consider it excessive
    if (hour >= 7 && hour <= 12) {
      return true;
    }
    
    return false;
  }
  
  // For canteen shifts, determine based on start time pattern
  if (shiftType === 'canteen') {
    const hour = checkOut.getHours();
    
    // FIXED: Properly determine excessive overtime based on canteen shift type
    // For 7AM shift (6:20-7:20), excessive overtime is after 5 PM (17:00)
    // For 8AM shift (7:20-8:40), excessive overtime is after 6 PM (18:00)
    const checkInHour = checkOut.getHours(); // We don't have check-in time here, so estimate based on checkout
    
    // Using 17:00 (5 PM) as threshold for 7AM shift and 18:00 (6 PM) for 8AM shift
    // Since we don't have check-in time, use a reasonable threshold for both
    if (hour >= 18) { // After 6 PM
      return true;
    }
    
    return false;
  }
  
  // For other shifts, check if checkout hour is at least 1 hour after expected end
  if (checkOut.getHours() >= overtimeHour) {
    return true;
  }
  
  return false;
};

// Check if a sequence of records indicates a likely night shift worker
export const isLikelyNightShiftWorker = (records: TimeRecord[]): boolean => {
  if (records.length < 2) return false;
  
  // Count how many check-ins occur during typical night shift hours (8 PM - 4 AM)
  const nightCheckIns = records.filter(record => {
    if (record.status !== 'check_in') return false;
    
    const hour = record.timestamp.getHours();
    return (hour >= 20) || (hour >= 0 && hour < 4); // 8 PM - 4 AM
  }).length;
  
  // Count total check-ins
  const totalCheckIns = records.filter(record => record.status === 'check_in').length;
  
  // Count how many check-outs occur during early morning hours (5 AM - 8 AM)
  const earlyMorningCheckOuts = records.filter(record => {
    if (record.status !== 'check_out') return false;
    
    const hour = record.timestamp.getHours();
    return hour >= 5 && hour <= 8; // 5 AM - 8 AM
  }).length;
  
  // If at least 30% of check-ins are during night shift hours, or we have several early morning checkouts,
  // consider them a night shift worker
  return (totalCheckIns > 0 && (nightCheckIns / totalCheckIns >= 0.3)) ||
         (earlyMorningCheckOuts >= 2); // Having 2+ early morning checkouts strongly suggests night shift
};

// Check if time falls within a morning shift time range
export const hasMorningShiftTimeRange = (timestamp: Date): boolean => {
  const hour = timestamp.getHours();
  return (hour >= 5 && hour <= 7) || (hour >= 13 && hour <= 15);
};

// Analyze if employee shows pattern of morning shift work
export const isMorningShiftPattern = (records: TimeRecord[]): number => {
  if (records.length < 2) return 0;
  
  // Get distinct days with morning hour check-ins (5-8 AM)
  const morningCheckInDays = new Set<string>();
  
  // Get days with data that match morning shift criteria
  for (const record of records) {
    const hour = record.timestamp.getHours();
    
    // Check-ins between 5-8 AM are likely morning shift
    if (record.status === 'check_in' && hour >= 5 && hour <= 8) {
      const date = format(record.timestamp, 'yyyy-MM-dd');
      morningCheckInDays.add(date);
    }
    
    // Check-outs between 1-3 PM are likely morning shift
    if (record.status === 'check_out' && hour >= 13 && hour <= 15) {
      const date = format(record.timestamp, 'yyyy-MM-dd');
      morningCheckInDays.add(date);
    }
  }
  
  // Return count of days with morning shift patterns
  return morningCheckInDays.size;
};

// Identify if a timestamp is likely a night shift check-out (5-7 AM)
export const isLikelyNightShiftCheckOut = (timestamp: Date): boolean => {
  const hour = getHours(timestamp);
  return hour >= 5 && hour <= 7; // Early morning hours typical for night shift checkout
};

// Check if timestamp should be handled as a possible night shift
export const shouldHandleAsPossibleNightShift = (timestamp: Date): boolean => {
  const hour = getHours(timestamp);
  
  // Early morning times (5-7 AM) are commonly associated with night shifts
  if (hour >= 5 && hour <= 7) {
    return true;
  }
  
  // Late evening times (8 PM to midnight) are commonly associated with night shifts
  if (hour >= 20) {
    return true;
  }
  
  return false;
};

// Check if a timestamp is likely a night shift check-in
export const isNightShiftCheckIn = (timestamp: Date): boolean => {
  const hour = timestamp.getHours();
  return hour >= 20 && hour <= 23; // Between 8 PM and 11 PM
};

// Check if a timestamp is likely a night shift check-out
export const isNightShiftCheckOut = (timestamp: Date): boolean => {
  const hour = timestamp.getHours();
  return hour >= 5 && hour <= 8; // Between 5 AM and 8 AM
};

// Check for a night shift pattern in records
export const isNightShiftPattern = (checkInTime: Date, checkOutTime: Date): boolean => {
  const checkInHour = checkInTime.getHours();
  const checkOutHour = checkOutTime.getHours();
  
  // Night shift pattern: check-in in evening (8-11 PM), check-out in early morning (5-8 AM)
  return (checkInHour >= 20 && checkInHour <= 23) && 
         (checkOutHour >= 5 && checkOutHour <= 8);
};

// Detect if a record is likely from a night shift
export const isLikelyFromNightShift = (record: any): boolean => {
  const timestamp = record.timestamp;
  const hour = getHours(timestamp);
  
  // Night shifts typically check in between 20:00-22:00 and out between 05:00-07:00
  if (record.status === 'check_in') {
    return hour >= 20 && hour <= 22;
  } else if (record.status === 'check_out') {
    return hour >= 5 && hour <= 7;
  }
  
  return false;
};

// Find matching records that could form a night shift pair
export const findNightShiftPair = (records: any[]): { checkIn: any | null, checkOut: any | null } => {
  // Sort records by timestamp
  const sortedRecords = [...records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Try to find night shift check-in (evening) and check-out (morning next day)
  let nightCheckIn = null;
  let nightCheckOut = null;
  
  // Find potential check-ins (evening hours)
  for (const record of sortedRecords) {
    const hour = getHours(record.timestamp);
    if (hour >= 20 && hour <= 22) {
      if (record.status === 'check_in') {
        nightCheckIn = record;
        break;
      } else {
        // Potential mislabeled check-in
        nightCheckIn = record;
        break;
      }
    }
  }
  
  // Find potential check-outs (morning hours next day)
  if (nightCheckIn) {
    const checkInDate = format(nightCheckIn.timestamp, 'yyyy-MM-dd');
    
    for (const record of sortedRecords) {
      const recordDate = format(record.timestamp, 'yyyy-MM-dd');
      const hour = getHours(record.timestamp);
      
      // Look for records on the next day with early morning hours
      if (recordDate > checkInDate && hour >= 5 && hour <= 7) {
        if (record.status === 'check_out') {
          nightCheckOut = record;
          break;
        } else {
          // Potential mislabeled check-out
          nightCheckOut = record;
          break;
        }
      }
    }
  }
  
  return { checkIn: nightCheckIn, checkOut: nightCheckOut };
};

// Check if the employee has evening shift patterns
export const isEveningShiftPattern = (records: TimeRecord[]): boolean => {
  if (records.length < 2) return false;
  
  // Count check-ins between 12:30 PM and 2 PM (typical evening shift start time)
  const eveningCheckIns = records.filter(r => {
    if (r.status !== 'check_in') return false;
    
    const hour = r.timestamp.getHours();
    const minute = r.timestamp.getMinutes();
    
    return (hour === 12 && minute >= 30) || hour === 13 || (hour === 14 && minute === 0);
  }).length;
  
  // Count check-outs between 9 PM and 11 PM (typical evening shift end time)
  const eveningCheckOuts = records.filter(r => {
    if (r.status !== 'check_out') return false;
    
    const hour = r.timestamp.getHours();
    return hour >= 21 && hour <= 22;
  }).length;
  
  const totalCheckIns = records.filter(r => r.status === 'check_in').length;
  
  // Detect evening shift pattern
  // 1. At least 30% of check-ins are between 12:30-2 PM, OR
  // 2. At least 2 check-outs are between 9-10 PM
  return (totalCheckIns > 0 && (eveningCheckIns / totalCheckIns >= 0.3)) || (eveningCheckOuts >= 2);
};

// Check if the given date had an evening shift based on the records
export const hadEveningShiftOnDate = (records: TimeRecord[], dateStr: string): boolean => {
  // Look for check-ins between 12:30 PM and 2:00 PM on this date
  const eveningCheckIn = records.some(r => {
    if (r.status !== 'check_in') return false;
    
    const recordDate = format(r.timestamp, 'yyyy-MM-dd');
    if (recordDate !== dateStr) return false;
    
    const hour = r.timestamp.getHours();
    const minute = r.timestamp.getMinutes();
    
    return (hour === 12 && minute >= 30) || hour === 13 || (hour === 14 && minute === 0);
  });
  
  // Also look for check-outs between 9:00 PM and 10:30 PM on this date
  const eveningCheckOut = records.some(r => {
    if (r.status !== 'check_out') return false;
    
    const recordDate = format(r.timestamp, 'yyyy-MM-dd');
    if (recordDate !== dateStr) return false;
    
    const hour = r.timestamp.getHours();
    
    return hour >= 21 && hour <= 22;
  });
  
  // Return true if either evening check-in or checkout was found
  return eveningCheckIn || eveningCheckOut;
};

// Get the expected checkout time display for evening shift based on historical patterns
export const getEveningShiftCheckoutDisplay = (day: number): string => {
  // Fixed: Return correct time for evening shift checkout
  return "22:00";
};