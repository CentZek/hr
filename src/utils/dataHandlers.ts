import { EmployeeRecord, DailyRecord } from '../types';
import { calculatePayableHours, determineShiftType } from './shiftCalculations';
import { parse, format, eachDayOfInterval } from 'date-fns';

// Handle adding a manual entry to the employee records
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
  
  // Process dates
  let firstCheckIn: Date | null = checkInDate || null;
  let lastCheckOut: Date | null = checkOutDate || null;
  
  // If date objects were not provided directly, parse them from strings
  if (!firstCheckIn && checkIn) {
    try {
      // For evening shifts, ensure checkout is on the same day
      if (shiftType === 'evening') {
        firstCheckIn = parse(`${date} ${checkIn}`, 'yyyy-MM-dd HH:mm', new Date());
      }
      // For night shifts, checkout is on next day
      else if (shiftType === 'night') {
        // Create a date object for the next day
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];
        firstCheckIn = parse(`${date} ${checkIn}`, 'yyyy-MM-dd HH:mm', new Date());
      } 
      // For morning shifts or default
      else {
        firstCheckIn = parse(`${date} ${checkIn}`, 'yyyy-MM-dd HH:mm', new Date());
      }
    } catch (error) {
      console.error("Error parsing check-in date:", error);
    }
  }
  
  if (!lastCheckOut && checkOut) {
    try {
      // For evening shifts, ensure checkout is on the same day
      if (shiftType === 'evening') {
        lastCheckOut = parse(`${date} ${checkOut}`, 'yyyy-MM-dd HH:mm', new Date());
      }
      // For night shifts, checkout is on next day
      else if (shiftType === 'night') {
        // Create a date object for the next day
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];
        lastCheckOut = parse(`${nextDateStr} ${checkOut}`, 'yyyy-MM-dd HH:mm', new Date());
      } 
      // For morning shifts or default
      else {
        lastCheckOut = parse(`${date} ${checkOut}`, 'yyyy-MM-dd HH:mm', new Date());
      }
    } catch (error) {
      console.error("Error parsing check-out date:", error);
    }
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
    checkOutNextDay: shiftType === 'night'
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

// Calculate updated statistics after data modification
export const calculateStats = (employeeRecords: EmployeeRecord[]) => {
  const totalEmployees = employeeRecords.length;
  let totalDays = 0;
  
  employeeRecords.forEach(emp => {
    totalDays += emp.days.length;
  });
  
  return { totalEmployees, totalDays };
};

// Process employee record updates after saving to database
export const processRecordsAfterSave = (employeeRecords: EmployeeRecord[]) => {
  const updatedRecords = employeeRecords
    .map(emp => ({
      ...emp,
      days: emp.days.filter(d => !d.approved) // Remove approved days
    }))
    .filter(emp => emp.days.length > 0); // Remove employees with no remaining days
    
  return updatedRecords;
};

// Add OFF-DAY markers for any missing days in the date range
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
    const dateRange = eachDayOfInterval({ start: earliestDate, end: latestDate });
    const existingDates = new Set(sortedDays.map(day => day.date));
    
    // Create OFF-DAY entries for missing dates
    const offDays: DailyRecord[] = [];
    
    dateRange.forEach(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      if (!existingDates.has(dateStr)) {
        offDays.push(createOffDayRecord(dateStr));
      }
    });
    
    // Add OFF-DAYs to the employee record
    const updatedDays = [...sortedDays, ...offDays].sort((a, b) => a.date.localeCompare(b.date));
    
    return {
      ...employee,
      days: updatedDays,
      totalDays: updatedDays.length
    };
  });
};

// Helper function to create an OFF-DAY record
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
    hasMultipleRecords: false
  };
};

// Fetch employee shift requests and convert to EmployeeRecord format
export const convertShiftRequestsToRecords = async () => {
  try {
    const { data: pendingShifts, error } = await fetch('/api/pending-shifts')
      .then(res => res.json());
    
    if (error) throw error;
    
    const employeeMap = new Map();
    
    // Group shifts by employee
    pendingShifts.forEach(shift => {
      if (!employeeMap.has(shift.employee_id)) {
        employeeMap.set(shift.employee_id, {
          employeeNumber: shift.employee_number,
          name: shift.employee_name,
          department: '',
          days: [],
          totalDays: 0,
          expanded: false
        });
      }
      
      const emp = employeeMap.get(shift.employee_id);
      
      // Convert shift to daily record
      const checkIn = parse(`${shift.date} ${shift.start_time}`, 'yyyy-MM-dd HH:mm', new Date());
      let checkOut = parse(`${shift.date} ${shift.end_time}`, 'yyyy-MM-dd HH:mm', new Date());
      
      // Handle night shifts crossing to the next day
      if (shift.shift_type === 'night') {
        const startHour = parseInt(shift.start_time.split(':')[0], 10);
        const endHour = parseInt(shift.end_time.split(':')[0], 10);
        
        if (endHour < startHour) {
          // Add a day to checkout time
          checkOut = new Date(checkOut.getTime() + 24 * 60 * 60 * 1000);
        }
      }
      
      const hoursWorked = calculatePayableHours(checkIn, checkOut, shift.shift_type);
      
      emp.days.push({
        date: shift.date,
        firstCheckIn: checkIn,
        lastCheckOut: checkOut,
        hoursWorked,
        approved: false,
        shiftType: shift.shift_type,
        notes: shift.notes || 'Employee submitted shift',
        missingCheckIn: false,
        missingCheckOut: false,
        isLate: false,
        earlyLeave: false,
        excessiveOvertime: false,
        penaltyMinutes: 0
      });
      
      emp.totalDays++;
    });
    
    return Array.from(employeeMap.values());
  } catch (error) {
    console.error('Error converting shift requests to records:', error);
    return [];
  }
};