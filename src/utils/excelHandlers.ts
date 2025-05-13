import { read, utils, writeFile } from 'xlsx';
import { format, parse, isValid, addDays, subDays, eachDayOfInterval, differenceInMinutes, differenceInHours, differenceInCalendarDays, getHours, isSameDay, isFriday, parseISO } from 'date-fns';
import { TimeRecord, EmployeeRecord, DailyRecord } from '../types';
import { 
  determineShiftType, 
  isLateCheckIn, 
  isEarlyLeave, 
  calculateHoursWorked, 
  isExcessiveOvertime,
  calculatePayableHours,
  isLikelyNightShiftCheckOut,
  shouldHandleAsPossibleNightShift,
  isEveningShiftPattern,
  isNightShiftCheckIn,
  isNightShiftCheckOut,
  isNightShiftPattern,
  calculateNightShiftHours,
  isLikelyNightShiftWorker
} from './shiftCalculations';
import { parseDateTime, formatTime24H } from './dateTimeHelper';

// Handle Excel file upload and processing
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = utils.sheet_to_json(worksheet);
        
        // Process the data
        const processedData = await processExcelData(jsonData);
        resolve(processedData);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

// Function to guess shift window based on timestamp
const guessShiftWindow = (timestamp: Date): 'morning' | 'evening' | 'night' | 'canteen' => {
  const hour = timestamp.getHours();
  
  if (hour >= 20 || hour < 5) {
    return 'night';
  } else if (hour >= 5 && hour < 12) {
    if (hour === 7 || hour === 8) {
      return 'canteen';
    }
    return 'morning';
  } else if (hour >= 12 && hour < 20) {
    return 'evening';
  }
  
  // Default case
  return 'morning';
};

// Function to normalize day shifts (morning/evening) by selecting earliest check-in and latest check-out
const normalizeDayShift = (records: TimeRecord[]): TimeRecord[] => {
  // Only apply for pure morning/evening days:
  const types = new Set(records.map(r => r.shift_type));
  if (![...types].every(t => t === 'morning' || t === 'evening')) {
    return records;
  }

  // Define threshold for "close enough" duplicate records
  const DAY_SHIFT_THRESHOLD_MINUTES = 60;  // 1 hour grace

  // Separate ins & outs
  const ins = records.filter(r => r.status === 'check_in').sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const outs = records.filter(r => r.status === 'check_out').sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  if (!ins.length || !outs.length) return records;

  const earliestIn = ins[0];
  let latestOut = outs[0];

  // If there are multiple outs very close together, pick the very latest
  if (outs.length > 1 && differenceInMinutes(outs[0].timestamp, outs[1].timestamp) <= DAY_SHIFT_THRESHOLD_MINUTES) {
    latestOut = outs[0];
  }

  // Same for ins: if two ins are within the threshold, keep the earliest
  if (ins.length > 1 && differenceInMinutes(ins[1].timestamp, ins[0].timestamp) <= DAY_SHIFT_THRESHOLD_MINUTES) {
    // earliestIn is already ins[0]
  }

  // Relabel everything else
  for (const r of records) {
    if (r === earliestIn) {
      r.status = 'check_in';
    } else if (r === latestOut) {
      r.status = 'check_out';
    } else {
      // anything else that survives is likely a spam duplicate
      r.mislabeled = true;
      r.originalStatus = r.status;
      r.status = r.status === 'check_in' ? 'check_out' : 'check_in';
      r.notes = `Fixed duplicate: forced to ${r.status}`;
    }
  }

  return records;
};

// Function to detect and fix cases with exactly 2 records where flipping would make a valid shift
const detectFlippedTwoRecordDays = (records: TimeRecord[]): TimeRecord[] => {
  // Only process if there are exactly 2 records
  if (records.length !== 2) return records;
  
  // Sort by timestamp (chronological order)
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  const first = records[0];
  const second = records[1];
  
  // Skip if the records are already in the expected order (check-in followed by check-out)
  if (first.status === 'check_in' && second.status === 'check_out') {
    return records;
  }
  
  // If we have a reversed pattern (check-out followed by check-in) or both records have the same status
  if ((first.status === 'check_out' && second.status === 'check_in') || first.status === second.status) {
    // Check if these records would make a valid shift if flipped
    const hours = differenceInMinutes(second.timestamp, first.timestamp) / 60;
    
    // Only flip if the time difference falls within a typical shift duration (7-11 hours)
    if (hours >= 7 && hours <= 11) {
      console.log(`Found flipped records that would form a ${hours.toFixed(2)}-hour shift`);
      
      // Mark the first record as check-in
      first.status = 'check_in';
      first.mislabeled = true;
      first.originalStatus = first.originalStatus || 'check_out';
      first.notes = 'Fixed mislabeled: Changed to check-in (valid shift pattern detected)';
      
      // Mark the second record as check-out
      second.status = 'check_out';
      second.mislabeled = true;
      second.originalStatus = second.originalStatus || 'check_in';
      second.notes = 'Fixed mislabeled: Changed to check-out (valid shift pattern detected)';
      
      // Determine the shift type based on the first timestamp
      const shiftType = determineShiftType(first.timestamp);
      first.shift_type = shiftType;
      second.shift_type = shiftType;
      
      // If it's a night shift, set working_week_start
      if (shiftType === 'night') {
        const dateStr = format(first.timestamp, 'yyyy-MM-dd');
        first.working_week_start = dateStr;
        second.working_week_start = dateStr;
      }
    }
  }
  
  return records;
};

// Function to handle two consecutive records with the same status that are very close in time
const handleCloseConsecutiveRecords = (records: TimeRecord[]): TimeRecord[] => {
  if (records.length < 2) return records;
  
  // Define threshold for "very close" records - if within this time, consider as duplicate
  const CLOSE_RECORDS_THRESHOLD_MINUTES = 60; // 60 minutes
  const MINIMUM_SHIFT_HOURS = 6; // Minimum hours to constitute a valid shift
  
  // Sort by timestamp
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Look for consecutive same-status records that are close in time
  for (let i = 0; i < records.length - 1; i++) {
    const current = records[i];
    const next = records[i + 1];
    
    // If they have the same status and are close in time
    if (current.status === next.status) {
      const timeDiffMinutes = differenceInMinutes(next.timestamp, current.timestamp);
      
      // If the time difference is small, handle as duplicate rather than separate shift
      if (timeDiffMinutes <= CLOSE_RECORDS_THRESHOLD_MINUTES) {
        // For check-ins, keep the earlier one
        if (current.status === 'check_in') {
          next.mislabeled = true;
          next.originalStatus = 'check_in';
          next.notes = 'Fixed duplicate: consecutive check-ins close in time';
          next.status = 'check_out'; // Mark as check-out
          
          // Check if this would create a very short shift
          const nextRecord = i + 2 < records.length ? records[i + 2] : null;
          if (nextRecord) {
            const possibleShiftHours = differenceInMinutes(nextRecord.timestamp, current.timestamp) / 60;
            if (possibleShiftHours < MINIMUM_SHIFT_HOURS) {
              // This would create a very short shift, likely incorrect
              // Revert the change and mark as duplicate to ignore
              next.status = 'check_in';
              next.mislabeled = true;
              next.notes = 'Duplicate check-in, too close to previous record';
              next.processed = true; // Mark as processed to exclude it
            }
          }
        }
        // For check-outs, keep the later one
        else if (current.status === 'check_out') {
          current.mislabeled = true;
          current.originalStatus = 'check_out';
          current.notes = 'Fixed duplicate: consecutive check-outs close in time';
          current.status = 'check_in'; // Mark as check-in
          
          // Check if this would create a very short shift
          const prevRecord = i > 0 ? records[i - 1] : null;
          if (prevRecord) {
            const possibleShiftHours = differenceInMinutes(next.timestamp, prevRecord.timestamp) / 60;
            if (possibleShiftHours < MINIMUM_SHIFT_HOURS) {
              // This would create a very short shift, likely incorrect
              // Revert the change and mark as duplicate to ignore
              current.status = 'check_out';
              current.mislabeled = true;
              current.notes = 'Duplicate check-out, too close to next record';
              current.processed = true; // Mark as processed to exclude it
            }
          }
        }
      } else {
        // If they're far enough apart, they might be legitimate separate shifts
        // Let the multi-shift detection handle this case
      }
    }
  }
  
  return records;
};

// Function to detect and handle multiple shifts in a single day
const detectMultipleShifts = (records: TimeRecord[]): TimeRecord[] => {
  // Only process days with at least 3 records
  if (records.length < 3) return records;
  
  // Sort records by timestamp
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  
  // Look for patterns that suggest multiple shifts
  // A typical pattern would be: C/In -> C/Out -> C/In -> C/Out
  
  // First, check for shift transitions (time gaps between records)
  const SHIFT_TRANSITION_HOURS = 1.5; // Minimum hours between shifts
  let possibleShiftBreakpoints: number[] = [];
  
  for (let i = 1; i < records.length; i++) {
    const hourDiff = differenceInMinutes(records[i].timestamp, records[i-1].timestamp) / 60;
    
    // If there's a significant gap between records, it might be a shift transition
    if (hourDiff >= SHIFT_TRANSITION_HOURS) {
      possibleShiftBreakpoints.push(i);
    }
  }
  
  // If we found potential shift transitions, analyze the records around them
  if (possibleShiftBreakpoints.length > 0) {
    // Preserve existing shift types
    const shiftTypes: (string | null)[] = [];
    
    for (let i = 0; i < records.length; i++) {
      shiftTypes[i] = records[i].shift_type;
    }
    
    // Now analyze each segment as a separate shift
    let currentSegmentStart = 0;
    
    for (let i = 0; i <= possibleShiftBreakpoints.length; i++) {
      const segmentEnd = i < possibleShiftBreakpoints.length 
                       ? possibleShiftBreakpoints[i] 
                       : records.length;
      
      const segment = records.slice(currentSegmentStart, segmentEnd);
      
      if (segment.length >= 1) {
        // For each segment, ensure the first record is a check-in and the last is a check-out
        if (segment.length === 1) {
          // If only one record in the segment, determine based on time of day
          const hour = segment[0].timestamp.getHours();
          
          // Morning hours (5-12) are more likely check-ins, afternoon/evening (12-22) more likely check-outs
          if (hour >= 5 && hour < 12) {
            segment[0].status = 'check_in';
          } else if (hour >= 12 && hour <= 22) {
            segment[0].status = 'check_out';
          }
          // Otherwise, leave as is
        } else if (segment.length >= 2) {
          // Ensure first record in segment is check-in and last is check-out
          if (segment[0].status !== 'check_in') {
            segment[0].status = 'check_in';
            segment[0].mislabeled = true;
            segment[0].originalStatus = segment[0].originalStatus || 'check_out';
            segment[0].notes = 'Fixed mislabeled: Changed to check-in (multiple shift pattern detected)';
          }
          
          if (segment[segment.length - 1].status !== 'check_out') {
            segment[segment.length - 1].status = 'check_out';
            segment[segment.length - 1].mislabeled = true;
            segment[segment.length - 1].originalStatus = segment[segment.length - 1].originalStatus || 'check_in';
            segment[segment.length - 1].notes = 'Fixed mislabeled: Changed to check-out (multiple shift pattern detected)';
          }
          
          // Determine shift type based on start time if not already set
          const segmentShiftType = shiftTypes[currentSegmentStart] || determineShiftType(segment[0].timestamp);
          
          // Apply shift type to all records in this segment
          for (const record of segment) {
            if (!record.shift_type) {
              record.shift_type = segmentShiftType;
            }
          }
        }
      }
      
      currentSegmentStart = segmentEnd;
    }
  }
  
  return records;
};

// Enhanced function to detect and resolve mislabeled records
const resolveDuplicates = (records: TimeRecord[]): TimeRecord[] => {
  if (records.length <= 1) return records;
  
  // Use records directly to maintain original file order - NO SORTING
  const result: TimeRecord[] = [...records];
  
  // Group records by date
  const recordsByDate = new Map<string, TimeRecord[]>();
  for (const record of result) {
    const dateStr = format(record.timestamp, 'yyyy-MM-dd');
    if (!recordsByDate.has(dateStr)) {
      recordsByDate.set(dateStr, []);
    }
    recordsByDate.get(dateStr)!.push(record);
  }
  
  // Special handling for specific dates and employees that need fixed pairing
  
  // 1. Check for night shift worker patterns
  const isNightShiftWorker = isLikelyNightShiftWorker(records);
  
  if (isNightShiftWorker) {
    // Process each day and its adjacent day for night shift patterns
    const dates = Array.from(recordsByDate.keys()).sort();
    
    for (let i = 0; i < dates.length - 1; i++) {
      const currentDate = dates[i];
      const nextDate = dates[i + 1];
      
      const currentDateRecords = recordsByDate.get(currentDate) || [];
      const nextDateRecords = recordsByDate.get(nextDate) || [];
      
      // Look for night shift check-in on current date (evening)
      const nightCheckIn = currentDateRecords.find(r => {
        const hour = r.timestamp.getHours();
        return hour >= 20 && hour <= 23;
      });
      
      // Look for night shift check-out on next date (morning)
      const morningCheckOut = nextDateRecords.find(r => {
        const hour = r.timestamp.getHours();
        return hour >= 5 && hour <= 7;
      });
      
      if (nightCheckIn && morningCheckOut) {
        // Set status of night check-in
        if (nightCheckIn.status !== 'check_in') {
          nightCheckIn.status = 'check_in';
          nightCheckIn.mislabeled = true;
          nightCheckIn.originalStatus = nightCheckIn.originalStatus || 'check_out';
          nightCheckIn.notes = 'Fixed mislabeled: Evening check-out to check-in (night shift pattern)';
        }
        
        // Set status of morning check-out
        if (morningCheckOut.status !== 'check_out') {
          morningCheckOut.status = 'check_out';
          morningCheckOut.mislabeled = true;
          morningCheckOut.originalStatus = morningCheckOut.originalStatus || 'check_in';
          morningCheckOut.notes = 'Fixed mislabeled: Morning check-in to check-out (night shift pattern)';
        }
        
        // Set shift type
        nightCheckIn.shift_type = 'night';
        morningCheckOut.shift_type = 'night';
        
        // Mark as cross-day records
        nightCheckIn.isCrossDay = true;
        morningCheckOut.isCrossDay = true;
        morningCheckOut.fromPrevDay = true;
        morningCheckOut.prevDayDate = currentDate;

        // FIXED: Add working_week_start to link night shift records across days
        nightCheckIn.working_week_start = currentDate;
        morningCheckOut.working_week_start = currentDate; // Use check-in date
      }
    }
  }
  
  // Process general cases by date
  const dates = Array.from(recordsByDate.keys());
  for (const date of dates) {
    let dayRecords = recordsByDate.get(date)!;
    
    // Skip days with only one record
    if (dayRecords.length <= 1) continue;
    
    // Sort by original index to maintain file order
    dayRecords.sort((a, b) => {
      // Use originalIndex if available
      if (a.originalIndex !== undefined && b.originalIndex !== undefined) {
        return a.originalIndex - b.originalIndex;
      }
      // Fall back to timestamp if no original index
      return a.timestamp.getTime() - b.timestamp.getTime();
    });
    
    // First run the handling for consecutive records that are close in time
    // This will prevent two check-outs or two check-ins that are very close together
    // from being treated as separate shifts
    dayRecords = handleCloseConsecutiveRecords(dayRecords);
    recordsByDate.set(date, dayRecords);
    
    // First try to detect and fix flipped records in 2-record days
    if (dayRecords.length === 2) {
      dayRecords = detectFlippedTwoRecordDays(dayRecords);
      recordsByDate.set(date, dayRecords);
    }
    
    // For days with 3+ records, try to detect multiple shifts pattern
    if (dayRecords.length >= 3) {
      dayRecords = detectMultipleShifts(dayRecords);
      recordsByDate.set(date, dayRecords);
    }
    
    // Apply the normalizeDayShift function to handle morning/evening shifts deterministically
    dayRecords = normalizeDayShift(dayRecords);
    recordsByDate.set(date, dayRecords);
    
    // Handle consecutive same-status records
    for (let i = 0; i < dayRecords.length - 1; i++) {
      const curr = dayRecords[i];
      const next = dayRecords[i + 1];
      
      // Skip if already processed or statuses are different
      if (curr.processed || next.processed || curr.status !== next.status) continue;
      
      // CRITICAL FIX: Only flip consecutive records if they're far enough apart
      const timeDiffMinutes = differenceInMinutes(next.timestamp, curr.timestamp);
      
      // NEW LOGIC: For consecutive check-outs, don't flip if they're less than 60 minutes apart
      if (curr.status === 'check_out' && timeDiffMinutes < 60) {
        // Instead of flipping, mark the earlier one as a duplicate to ignore
        curr.mislabeled = true;
        curr.originalStatus = curr.originalStatus || 'check_out';
        curr.notes = 'Duplicate check-out, too close to next record';
        curr.processed = true; // Mark as processed to exclude it
        continue;
      }
      
      // NEW LOGIC: For consecutive check-ins, don't flip if they're less than 60 minutes apart
      if (curr.status === 'check_in' && timeDiffMinutes < 60) {
        // Instead of flipping, mark the later one as a duplicate to ignore
        next.mislabeled = true;
        next.originalStatus = next.originalStatus || 'check_in';
        next.notes = 'Duplicate check-in, too close to previous record';
        next.processed = true; // Mark as processed to exclude it
        continue;
      }
      
      // Original logic for records that are far enough apart
      if (curr.status === 'check_in') {
        // Two consecutive check-ins: convert second to check-out
        next.status = 'check_out';
        next.mislabeled = true;
        next.originalStatus = 'check_in';
        next.notes = 'Fixed mislabeled: Changed from check-in to check-out (duplicate check-in pattern)';
      } else if (curr.status === 'check_out') {
        // Two consecutive check-outs: convert first to check-in
        curr.status = 'check_in';
        curr.mislabeled = true;
        curr.originalStatus = 'check_out';
        curr.notes = 'Fixed mislabeled: Changed from check-out to check-in (duplicate check-out pattern)';
      }
    }
    
    // For days with more than 2 records, ensure they follow the right sequence
    if (dayRecords.length > 2) {
      // Find earliest and latest by time
      dayRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const earliest = dayRecords[0];
      
      // FIX ISSUE 1: Ensure latest is check-out, regardless of the number of records
      // This fixes the issue where the last record of 3+ records is not correctly marked as checkout
      const latest = dayRecords[dayRecords.length - 1];
      
      // Ensure earliest is check-in
      if (earliest.status !== 'check_in') {
        earliest.status = 'check_in';
        earliest.mislabeled = true;
        earliest.originalStatus = earliest.originalStatus || 'check_out';
        earliest.notes = 'Fixed mislabeled: Changed earliest to check-in';
      }
      
      // Ensure latest is check-out
      if (latest.status !== 'check_out') {
        latest.status = 'check_out';
        latest.mislabeled = true;
        latest.originalStatus = latest.originalStatus || 'check_in';
        latest.notes = 'Fixed mislabeled: Changed latest to check-out';
      }
    }
  }
  
  return result;
};

// Process Excel data from the uploaded file
export const processExcelData = async (data: any[]): Promise<EmployeeRecord[]> => {
  console.log('Processing Excel data with strict file chronology:', data.length, 'rows');
  const timeRecords: TimeRecord[] = [];
  const parseErrors: string[] = [];

  // STEP 1: Parse all rows from the Excel file in EXACT order
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row['Date/Time'] || !row['Name'] || !row['No.'] || !row['Status']) {
      const errorMsg = `Missing required fields in row ${i+1}`;
      console.error(errorMsg, row);
      parseErrors.push(errorMsg);
      continue; // Skip this row but continue processing
    }

    const dateTimeStr = row['Date/Time'];
    const employeeName = row['Name'];
    const employeeNumber = row['No.'].toString();
    const status = row['Status'];
    const department = row['Department'] || '';
    
    // Parse the date/time
    let timestamp = parseDateTime(dateTimeStr);
    
    // If parsing failed, record the error but continue processing
    if (!timestamp) {
      const errorMsg = `Failed to parse date: ${dateTimeStr} for ${employeeName} in row ${i+1}`;
      console.error(errorMsg);
      parseErrors.push(errorMsg);
      continue; // Skip this row but continue processing
    }
    
    // Extract C/In or C/Out from Status field directly
    const recordStatus = status.toLowerCase().includes('in') ? 'check_in' : 'check_out';
    
    // Determine shift type immediately to use for setting working_week_start correctly
    const shiftType = determineShiftType(timestamp);

    // FIXED: Set working_week_start based on the shift type and record status
    let working_week_start = format(timestamp, 'yyyy-MM-dd');
    
    // For night shifts, make sure check-out records are linked to their check-in day
    if (shiftType === 'night' && recordStatus === 'check_out' && getHours(timestamp) < 12) {
      // For night shift check-outs in early morning, use previous day
      working_week_start = format(subDays(timestamp, 1), 'yyyy-MM-dd');
    }
    
    // Add to our collection, preserving original order in file
    timeRecords.push({
      department,
      name: employeeName,
      employeeNumber,
      timestamp,
      status: recordStatus,
      originalIndex: i,
      processed: false,
      shift_type: shiftType,
      originalStatus: recordStatus,
      working_week_start // FIXED: Include working_week_start in the record
    });
  }
  
  if (parseErrors.length > 0) {
    console.warn(`Encountered ${parseErrors.length} parsing errors but continuing with valid records`);
  }
  
  // STEP 2: Group by employee number while maintaining strict file order
  const employeeMap = new Map<string, TimeRecord[]>();
  
  // Group records by employee number
  for (const record of timeRecords) {
    const employeeKey = record.employeeNumber.trim();
    if (!employeeMap.has(employeeKey)) {
      employeeMap.set(employeeKey, []);
    }
    employeeMap.get(employeeKey)!.push(record);
  }
  
  // Initialize result map for employee records
  const employeeRecordsMap = new Map<string, {
    employeeData: {
      name: string;
      employeeNumber: string;
      department: string;
    },
    dailyRecords: Map<string, DailyRecord>
  }>();
  
  // STEP 3: Process each employee's records
  for (const [employeeNumber, records] of employeeMap.entries()) {
    // Sort by original index to preserve file order
    records.sort((a, b) => a.originalIndex! - b.originalIndex!);
    
    const employeeName = records[0].name;
    const department = records[0].department;
    
    console.log(`Processing ${records.length} records for employee ${employeeName} (${employeeNumber})`);
    
    // Initialize employee record if not exists
    if (!employeeRecordsMap.has(employeeNumber)) {
      employeeRecordsMap.set(employeeNumber, {
        employeeData: {
          name: employeeName,
          employeeNumber,
          department
        },
        dailyRecords: new Map<string, DailyRecord>()
      });
    }
    
    const employeeData = employeeRecordsMap.get(employeeNumber)!;
    
    // First pass: resolve mislabeled records
    const resolvedRecords = resolveDuplicates(records);
    
    // Group records by date for processing
    const recordsByDate = new Map<string, TimeRecord[]>();
    for (const record of resolvedRecords) {
      const dateStr = format(record.timestamp, 'yyyy-MM-dd');
      if (!recordsByDate.has(dateStr)) {
        recordsByDate.set(dateStr, []);
      }
      recordsByDate.get(dateStr)!.push(record);
    }
    
    // First, process night shift records that span across days
    const processedDates = new Set<string>();
    const dates = Array.from(recordsByDate.keys()).sort();
    
    for (let i = 0; i < dates.length - 1; i++) {
      const currentDate = dates[i];
      const nextDate = dates[i + 1];
      
      // Skip if either date is already processed
      if (processedDates.has(currentDate) || processedDates.has(nextDate)) continue;
      
      const currentDateRecords = recordsByDate.get(currentDate) || [];
      const nextDateRecords = recordsByDate.get(nextDate) || [];
      
      // Look for night shift pattern: evening check-in followed by morning check-out
      const eveningCheckIns = currentDateRecords.filter(r => 
        r.status === 'check_in' && getHours(r.timestamp) >= 20 && getHours(r.timestamp) <= 23
      );
      
      const morningCheckOuts = nextDateRecords.filter(r => 
        r.status === 'check_out' && getHours(r.timestamp) >= 5 && getHours(r.timestamp) <= 7
      );
      
      if (eveningCheckIns.length > 0 && morningCheckOuts.length > 0) {
        // We have a night shift that spans days
        const checkIn = eveningCheckIns[0]; // Use first evening check-in
        const checkOut = morningCheckOuts[0]; // Use first morning check-out
        
        // Calculate hours for night shift
        const hoursWorked = calculateNightShiftHours(checkIn.timestamp, checkOut.timestamp);
        
        
        // Store original check-in and check-out times as display values
        const checkInDisplayTime = format(checkIn.timestamp, 'HH:mm');
        const checkOutDisplayTime = format(checkOut.timestamp, 'HH:mm');
        
        // FIXED: Set working_week_start for both records to link them properly
        const working_week_start = currentDate;
        checkIn.working_week_start = working_week_start;
        checkOut.working_week_start = working_week_start;
        
        // Create daily record for the current date
        employeeData.dailyRecords.set(currentDate, {
          date: currentDate,
          firstCheckIn: checkIn.timestamp,
          lastCheckOut: checkOut.timestamp,
          hoursWorked: hoursWorked,
          approved: false,
          shiftType: 'night',
          notes: 'Night shift (spans to next day)',
          missingCheckIn: false,
          missingCheckOut: false,
          isLate: isLateCheckIn(checkIn.timestamp, 'night'),
          earlyLeave: isEarlyLeave(checkOut.timestamp, 'night'),
          excessiveOvertime: isExcessiveOvertime(checkOut.timestamp, 'night'),
          penaltyMinutes: 0,
          correctedRecords: checkIn.mislabeled || checkOut.mislabeled,
          allTimeRecords: [...currentDateRecords, ...morningCheckOuts], // Include all relevant records
          hasMultipleRecords: true,
          isCrossDay: true,
          checkOutNextDay: true,
          working_week_start: currentDate, // Set working_week_start for proper grouping
          // Store the actual timestamp values for correct display
          displayCheckIn: checkInDisplayTime,
          displayCheckOut: checkOutDisplayTime
        });
        
        // Mark dates as processed
        processedDates.add(currentDate);
        
        // Don't fully process the next date, we'll process remaining records later
        // Just mark the specific checkout as processed
        checkIn.processed = true;
        checkOut.processed = true;
        
        console.log(`Processed night shift spanning ${currentDate} to ${nextDate}`);
      }
    }
    
    // Now process remaining records
    let openCheckIn: TimeRecord | null = null;
    
    for (const record of resolvedRecords) {
      // Skip already processed records
      if (record.processed) continue;
      
      const dateStr = format(record.timestamp, 'yyyy-MM-dd');
      const dateRecords = recordsByDate.get(dateStr) || [];
      
      // Check if this date has already been processed as a cross-day shift
      if (processedDates.has(dateStr)) {
        // Only mark this record as processed
        record.processed = true;
        continue;
      }
      
      if (record.status === 'check_in') {
        // If we already have an open check-in, close it first
        if (openCheckIn) {
          // Handle orphaned check-in (mark as missing check-out)
          const openCheckInDate = format(openCheckIn.timestamp, 'yyyy-MM-dd');
          const openDateRecords = recordsByDate.get(openCheckInDate) || [];
          
          // Store original check-in time as display value
          const checkInDisplayTime = format(openCheckIn.timestamp, 'HH:mm');
          
          // FIXED: Use openCheckIn's working_week_start if available
          const working_week_start = openCheckIn.working_week_start || openCheckInDate;
          
          employeeData.dailyRecords.set(openCheckInDate, {
            date: openCheckInDate,
            firstCheckIn: openCheckIn.timestamp,
            lastCheckOut: null,
            hoursWorked: 0,
            approved: false,
            shiftType: openCheckIn.shift_type || determineShiftType(openCheckIn.timestamp),
            notes: 'Missing check-out',
            missingCheckIn: false,
            missingCheckOut: true,
            isLate: isLateCheckIn(openCheckIn.timestamp, openCheckIn.shift_type as any),
            earlyLeave: false,
            excessiveOvertime: false,
            penaltyMinutes: 0,
            correctedRecords: openCheckIn.mislabeled,
            allTimeRecords: openDateRecords,
            hasMultipleRecords: openDateRecords.length > 1,
            working_week_start: working_week_start, // Set working_week_start for proper grouping
            displayCheckIn: checkInDisplayTime, // Store actual timestamp for display
            displayCheckOut: 'Missing'
          });
          
          openCheckIn.processed = true;
        }
        
        // Start a new open check-in
        openCheckIn = record;
      }
      else if (record.status === 'check_out') {
        if (openCheckIn) {
          // We have a matching check-in/check-out pair
          const checkInDate = format(openCheckIn.timestamp, 'yyyy-MM-dd');
          const checkOutDate = format(record.timestamp, 'yyyy-MM-dd');
          const isCrossDay = checkInDate !== checkOutDate;
          
          // FIXED: Set working_week_start based on the check-in date
          const working_week_start = openCheckIn.working_week_start || checkInDate;
          record.working_week_start = working_week_start; // Ensure checkout has same working_week_start
          
          // Determine shift type
          const shiftType = isCrossDay && getHours(openCheckIn.timestamp) >= 20 ? 
                           'night' : 
                           openCheckIn.shift_type || determineShiftType(openCheckIn.timestamp);
          
          // Calculate hours
          const hoursWorked = calculatePayableHours(
            openCheckIn.timestamp, 
            record.timestamp, 
            shiftType as any
          );
          
          // Collect all records for this day
          const allDayRecords = recordsByDate.get(checkInDate) || [];
          
          // Store original check-in and check-out times as display values
          const checkInDisplayTime = format(openCheckIn.timestamp, 'HH:mm');
          const checkOutDisplayTime = format(record.timestamp, 'HH:mm');
          
          // Create daily record
          employeeData.dailyRecords.set(checkInDate, {
            date: checkInDate,
            firstCheckIn: openCheckIn.timestamp,
            lastCheckOut: record.timestamp,
            hoursWorked: hoursWorked,
            approved: false,
            shiftType: shiftType as any,
            notes: isCrossDay ? 'Cross-day shift' : '',
            missingCheckIn: false,
            missingCheckOut: false,
            isLate: isLateCheckIn(openCheckIn.timestamp, shiftType as any),
            earlyLeave: isEarlyLeave(record.timestamp, shiftType as any),
            excessiveOvertime: isExcessiveOvertime(record.timestamp, shiftType as any),
            penaltyMinutes: 0,
            correctedRecords: openCheckIn.mislabeled || record.mislabeled,
            allTimeRecords: [...allDayRecords, ...(isCrossDay ? [record] : [])],
            hasMultipleRecords: allDayRecords.length > 2 || isCrossDay,
            isCrossDay,
            checkOutNextDay: isCrossDay,
            working_week_start: working_week_start, // Set working_week_start for proper grouping
            displayCheckIn: checkInDisplayTime, // Store actual timestamp for display
            displayCheckOut: checkOutDisplayTime // Store actual timestamp for display
          });
          
          // Mark as processed
          openCheckIn.processed = true;
          record.processed = true;
          
          // Mark date as processed
          processedDates.add(checkInDate);
          
          if (isCrossDay) {
            // Also mark checkout date as partially processed
            // (We don't fully mark it as processed so we can still process any check-ins/check-outs on that day)
            record.processed = true;
          }
          
          // Reset open check-in
          openCheckIn = null;
        }
        else {
          // No matching check-in for this check-out
          const checkOutDate = format(record.timestamp, 'yyyy-MM-dd');
          const dateRecords = recordsByDate.get(checkOutDate) || [];
          
          // Check if this is likely a night shift check-out (5-7 AM)
          const hour = getHours(record.timestamp);
          if (hour >= 5 && hour <= 7) {
            // This is likely from a night shift - check if previous day has a check-in
            const prevDay = format(subDays(new Date(checkOutDate), 1), 'yyyy-MM-dd');
            const prevDayRecords = recordsByDate.get(prevDay) || [];
            
            // Look for evening check-in on previous day
            const prevEveningCheckIn = prevDayRecords.find(r => 
              r.status === 'check_in' && getHours(r.timestamp) >= 20
            );
            
            if (prevEveningCheckIn) {
              // We have a cross-day night shift - already processed above
              record.processed = true;
              
              // FIXED: Set working_week_start to previous day
              record.working_week_start = prevDay;
              
              continue;
            }
          }
          
          // Store original check-out time as display value
          const checkOutDisplayTime = format(record.timestamp, 'HH:mm');
          
          // Create record with missing check-in
          employeeData.dailyRecords.set(checkOutDate, {
            date: checkOutDate,
            firstCheckIn: null,
            lastCheckOut: record.timestamp,
            hoursWorked: 0, // Can't calculate hours without check-in
            approved: false,
            shiftType: record.shift_type || determineShiftType(record.timestamp),
            notes: 'Missing check-in',
            missingCheckIn: true,
            missingCheckOut: false,
            isLate: false,
            earlyLeave: isEarlyLeave(record.timestamp, record.shift_type as any),
            excessiveOvertime: false,
            penaltyMinutes: 0,
            correctedRecords: record.mislabeled,
            allTimeRecords: dateRecords,
            hasMultipleRecords: dateRecords.length > 1,
            working_week_start: record.working_week_start || checkOutDate, // Use record's working_week_start or checkout date
            displayCheckIn: 'Missing', 
            displayCheckOut: checkOutDisplayTime // Store actual timestamp for display
          });
          
          record.processed = true;
        }
      }
    }
    
    // Handle any leftover open check-in
    if (openCheckIn && !openCheckIn.processed) {
      const checkInDate = format(openCheckIn.timestamp, 'yyyy-MM-dd');
      const dateRecords = recordsByDate.get(checkInDate) || [];
      
      // Store original check-in time as display value
      const checkInDisplayTime = format(openCheckIn.timestamp, 'HH:mm');
      
      // FIXED: Use openCheckIn's working_week_start if available
      const working_week_start = openCheckIn.working_week_start || checkInDate;
      
      employeeData.dailyRecords.set(checkInDate, {
        date: checkInDate,
        firstCheckIn: openCheckIn.timestamp,
        lastCheckOut: null,
        hoursWorked: 0,
        approved: false,
        shiftType: openCheckIn.shift_type || determineShiftType(openCheckIn.timestamp),
        notes: 'Missing check-out',
        missingCheckIn: false,
        missingCheckOut: true,
        isLate: isLateCheckIn(openCheckIn.timestamp, openCheckIn.shift_type as any),
        earlyLeave: false,
        excessiveOvertime: false,
        penaltyMinutes: 0,
        correctedRecords: openCheckIn.mislabeled,
        allTimeRecords: dateRecords,
        hasMultipleRecords: dateRecords.length > 1,
        working_week_start: working_week_start, // Set working_week_start for proper grouping
        displayCheckIn: checkInDisplayTime, // Store actual timestamp for display
        displayCheckOut: 'Missing'
      });
      
      openCheckIn.processed = true;
    }
    
    // Add any dates that have records but weren't processed
    for (const [dateStr, dateRecords] of recordsByDate.entries()) {
      // Skip dates that have already been processed
      if (processedDates.has(dateStr) || employeeData.dailyRecords.has(dateStr)) continue;
      
      // Find any unprocessed records
      const unprocessedRecords = dateRecords.filter(r => !r.processed);
      
      if (unprocessedRecords.length > 0) {
        // Group records by status
        const checkIns = unprocessedRecords.filter(r => r.status === 'check_in');
        const checkOuts = unprocessedRecords.filter(r => r.status === 'check_out');
        
        // Use the earliest check-in and latest check-out
        const firstCheckIn = checkIns.length > 0 ? 
                      checkIns.reduce((earliest, curr) => 
                        curr.timestamp < earliest.timestamp ? curr : earliest, checkIns[0]) : null;
        
        const lastCheckOut = checkOuts.length > 0 ?
                      checkOuts.reduce((latest, curr) =>
                        curr.timestamp > latest.timestamp ? curr : latest, checkOuts[0]) : null;
        
        // Determine shift type
        const shiftType = firstCheckIn ? 
                      (firstCheckIn.shift_type || determineShiftType(firstCheckIn.timestamp)) : 
                      (lastCheckOut ? 
                        (lastCheckOut.shift_type || determineShiftType(lastCheckOut.timestamp)) : null);
        
        // Calculate hours if we have both check-in and check-out
        const hoursWorked = (firstCheckIn && lastCheckOut) ? 
                      calculatePayableHours(firstCheckIn.timestamp, lastCheckOut.timestamp, shiftType as any) : 0;
        
        // Store original check-in and check-out times as display values
        const checkInDisplayTime = firstCheckIn ? format(firstCheckIn.timestamp, 'HH:mm') : 'Missing';
        const checkOutDisplayTime = lastCheckOut ? format(lastCheckOut.timestamp, 'HH:mm') : 'Missing';
        
        // FIXED: Determine the working_week_start properly
        let working_week_start = dateStr;
        
        // If this is a night shift checkout in early morning, link to previous day
        if (shiftType === 'night' && lastCheckOut && !firstCheckIn && getHours(lastCheckOut.timestamp) < 12) {
          // For night shift checkouts, set working_week_start to previous day
          working_week_start = format(subDays(new Date(dateStr), 1), 'yyyy-MM-dd');
        } else if (firstCheckIn && firstCheckIn.working_week_start) {
          // Use check-in's working_week_start if available
          working_week_start = firstCheckIn.working_week_start;
        } else if (lastCheckOut && lastCheckOut.working_week_start) {
          // Use check-out's working_week_start if available
          working_week_start = lastCheckOut.working_week_start;
        }
        
        // Create daily record
        employeeData.dailyRecords.set(dateStr, {
          date: dateStr,
          firstCheckIn: firstCheckIn ? firstCheckIn.timestamp : null,
          lastCheckOut: lastCheckOut ? lastCheckOut.timestamp : null,
          hoursWorked: hoursWorked,
          approved: false,
          shiftType: shiftType as any,
          notes: unprocessedRecords.some(r => r.mislabeled) ? 'Contains corrected records' : '',
          missingCheckIn: !firstCheckIn,
          missingCheckOut: !lastCheckOut,
          isLate: firstCheckIn ? isLateCheckIn(firstCheckIn.timestamp, shiftType as any) : false,
          earlyLeave: lastCheckOut ? isEarlyLeave(lastCheckOut.timestamp, shiftType as any) : false,
          excessiveOvertime: (firstCheckIn && lastCheckOut) ? 
                           isExcessiveOvertime(lastCheckOut.timestamp, shiftType as any) : false,
          penaltyMinutes: 0,
          correctedRecords: unprocessedRecords.some(r => r.mislabeled),
          allTimeRecords: dateRecords,
          hasMultipleRecords: dateRecords.length > 1,
          working_week_start: working_week_start, // Set working_week_start for proper grouping
          // Store actual timestamp values for display
          displayCheckIn: checkInDisplayTime,
          displayCheckOut: checkOutDisplayTime
        });
        
        // Mark records as processed
        for (const record of unprocessedRecords) {
          record.processed = true;
        }
      }
    }
    
    // STEP 4: Fill in any gaps with OFF-DAY records
    addOffDaysToEmployeeRecords(employeeData.dailyRecords, recordsByDate);
  }
  
  // STEP 5: Convert the map to the expected array format
  const employeeRecordsArray: EmployeeRecord[] = [];
  
  for (const [employeeNumber, data] of employeeRecordsMap.entries()) {
    const dailyRecords = Array.from(data.dailyRecords.values());
    
    // Sort daily records by date for display
    dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
    
    employeeRecordsArray.push({
      employeeNumber,
      name: data.employeeData.name,
      department: data.employeeData.department,
      days: dailyRecords,
      totalDays: dailyRecords.length,
      expanded: false
    });
  }
  
  // Sort employees by name
  employeeRecordsArray.sort((a, b) => a.name.localeCompare(b.name));
  
  return employeeRecordsArray;
};

// Helper function to fill in off-days for an employee's records
const addOffDaysToEmployeeRecords = (dailyRecords: Map<string, DailyRecord>, recordsByDate: Map<string, TimeRecord[]>): void => {
  if (dailyRecords.size < 2) return;
  
  // Get all dates in order
  const dates = Array.from(dailyRecords.keys()).sort();
  
  if (dates.length < 2) return;
  
  // Get date range
  const firstDate = new Date(dates[0]);
  const lastDate = new Date(dates[dates.length - 1]);
  
  // Get all dates in the range
  const allDates = eachDayOfInterval({ start: firstDate, end: lastDate });
  
  // Add OFF-DAY for any missing date
  for (const date of allDates) {
    const dateStr = format(date, 'yyyy-MM-dd');
    
    if (!dailyRecords.has(dateStr)) {
      // Check if we have any time records for this date
      const dateRecords = recordsByDate.get(dateStr) || [];
      
      // Add OFF-DAY record
      dailyRecords.set(dateStr, {
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
        allTimeRecords: dateRecords,
        hasMultipleRecords: dateRecords.length > 0,
        isCrossDay: false,
        checkOutNextDay: false,
        working_week_start: dateStr, // Set working_week_start for proper grouping
        displayCheckIn: 'OFF-DAY', 
        displayCheckOut: 'OFF-DAY'
      });
    }
  }
};

// Export data to Excel
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create a new workbook
  const data: any[] = [];
  
  // Add headers
  data.push([
    'Employee Number', 'Employee Name', 'Department', 'Date', 
    'First Check-In', 'Last Check-Out', 'Hours Worked', 'Shift Type', 
    'Approved', 'Is Late', 'Early Leave', 'Excessive Overtime', 'Penalty Minutes',
    'Notes', 'Corrected Records'
  ]);
  
  // Add data rows
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      data.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        day.date,
        day.firstCheckIn ? format(day.firstCheckIn, 'yyyy-MM-dd HH:mm:ss') : 'Missing',
        day.lastCheckOut ? format(day.lastCheckOut, 'yyyy-MM-dd HH:mm:ss') : 'Missing',
        day.hoursWorked.toFixed(2),
        day.shiftType || 'Unknown',
        day.approved ? 'Yes' : 'No',
        day.isLate ? 'Yes' : 'No',
        day.earlyLeave ? 'Yes' : 'No',
        day.excessiveOvertime ? 'Yes' : 'No',
        day.penaltyMinutes,
        day.notes,
        day.correctedRecords ? 'Yes' : 'No'
      ]);
    });
  });
  
  // Create worksheet and workbook
  const ws = utils.aoa_to_sheet(data);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Employee Time Records');
  
  // Generate filename
  const fileName = `employee_time_records_${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`;
  
  // Export file
  writeFile(wb, fileName);
};

// Export approved hours to Excel
export const exportApprovedHoursToExcel = (data: { 
  summary: any[], 
  details: any[], 
  filterMonth: string,
  doubleDays?: string[] 
}): void => {
  // Create worksheets for summary and details
  const summaryData = [
    ['Employee Number', 'Name', 'Total Days', 'Regular Hours', 'Double-Time Hours', 'Total Payable Hours']
  ];
  
  const detailsData = [
    ['Employee Number', 'Name', 'Date', 'Check In', 'Check Out', 'Regular Hours', 'Double-Time', 'Payable Hours', 'Status', 'Notes']
  ];
  
  // Get double days for calculations
  const doubleDays = data.doubleDays || [];

  // Add summary data
  data.summary.forEach(emp => {
    // Calculate double-time hours if needed
    let doubleTimeHours = emp.double_time_hours || 0;
    
    // If double_time_hours isn't directly provided, estimate it
    if (!emp.double_time_hours && emp.working_week_dates) {
      doubleTimeHours = emp.working_week_dates
        .filter((date: string) => doubleDays.includes(date))
        .reduce((total: number, date: string) => {
          return total + (emp.hours_by_date?.[date] || 0);
        }, 0);
    }
    
    // Calculate total payable hours (regular hours + double-time bonus)
    const totalPayableHours = emp.total_hours + doubleTimeHours;
    
    summaryData.push([
      emp.employee_number,
      emp.name,
      emp.total_days,
      emp.total_hours.toFixed(2),
      doubleTimeHours.toFixed(2),
      totalPayableHours.toFixed(2)
    ]);
  });
  
  // Add details data
  data.details.forEach(record => {
    if (record.status === 'off_day') return; // Skip off-days in detail view
    
    const timestamp = new Date(record.timestamp);
    const dateStr = format(timestamp, 'yyyy-MM-dd');
    const isDoubleTime = doubleDays.includes(record.working_week_start || dateStr);
    
    // For Excel exports, we want to show the actual timestamp, not the standardized time
    let displayTime;
    if (!record.is_manual_entry && record.display_time) {
      displayTime = record.display_time;
    } else if (!record.is_manual_entry && record.display_check_in && record.status === 'check_in') {
      displayTime = record.display_check_in;
    } else if (!record.is_manual_entry && record.display_check_out && record.status === 'check_out') {
      displayTime = record.display_check_out;
    } else {
      displayTime = format(timestamp, 'HH:mm');
    }
    
    const regularHours = parseFloat(record.exact_hours) || 0;
    const payableHours = isDoubleTime ? regularHours * 2 : regularHours;
    
    detailsData.push([
      record.employees?.employee_number || '',
      record.employees?.name || '',
      format(timestamp, 'yyyy-MM-dd'),
      record.status === 'check_in' ? displayTime : '',
      record.status === 'check_out' ? displayTime : '',
      regularHours.toFixed(2),
      isDoubleTime ? 'Yes (2×)' : 'No',
      payableHours.toFixed(2),
      record.status,
      record.notes?.replace(/hours:\d+\.\d+;?\s*/, '') || ''
    ]);
  });
  
  // Create workbook with multiple sheets
  const wb = utils.book_new();
  
  // Add Summary sheet
  const wsSummary = utils.aoa_to_sheet(summaryData);
  utils.book_append_sheet(wb, wsSummary, 'Summary');
  
  // Add Details sheet
  const wsDetails = utils.aoa_to_sheet(detailsData);
  utils.book_append_sheet(wb, wsDetails, 'Details');
  
  // Add Double-Time Days sheet
  const doubleTimeDaysData = [
    ['Date', 'Day of Week', 'Type']
  ];
  
  doubleDays.sort().forEach(dateStr => {
    const date = parseISO(dateStr);
    doubleTimeDaysData.push([
      dateStr,
      format(date, 'EEEE'),
      isFriday(date) ? 'Friday' : 'Holiday'
    ]);
  });
  
  const wsDoubleDays = utils.aoa_to_sheet(doubleTimeDaysData);
  utils.book_append_sheet(wb, wsDoubleDays, 'Double-Time Days');
  
  // Generate filename with month if specified
  const monthStr = data.filterMonth === 'all' ? 'all_time' : data.filterMonth;
  const fileName = `approved_hours_${monthStr}_${format(new Date(), 'yyyyMMdd_HHmmss')}.xlsx`;
  
  // Export file
  writeFile(wb, fileName);
};