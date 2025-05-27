import { utils, write as xlsxWrite } from 'xlsx';
import { EmployeeRecord, DailyRecord } from '../types';
import { format, parseISO, isValid } from 'date-fns';

// Parse the uploaded Excel file and convert to EmployeeRecords
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  const readExcelPromise = () => {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        if (event.target?.result) {
          resolve(event.target.result as ArrayBuffer);
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      
      reader.onerror = (error) => {
        reject(error);
      };
      
      reader.readAsArrayBuffer(file);
    });
  };
  
  // First, read the file
  const data = await readExcelPromise();
  
  try {
    // Parse the Excel file
    const workbook = await import('xlsx').then(xlsx => xlsx.read(data, { type: 'array' }));
    
    if (!workbook.SheetNames.length) {
      throw new Error('Excel file has no sheets');
    }
    
    // Get the first sheet
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    
    // Convert sheet data to JSON
    const jsonData = await import('xlsx').then(xlsx => xlsx.utils.sheet_to_json<any>(worksheet));
    
    if (!jsonData.length) {
      throw new Error('No data found in Excel file');
    }
    
    console.log('Raw Excel data:', jsonData);
    
    // First, identify the column names
    const columnMapping = identifyColumns(jsonData[0]);
    
    // Group data by employee
    const employeeMap = groupDataByEmployee(jsonData, columnMapping);
    
    // Convert to EmployeeRecord array
    const employeeRecords = convertToEmployeeRecords(employeeMap);
    
    return employeeRecords;
  } catch (error) {
    console.error('Error processing Excel file:', error);
    throw error;
  }
};

// Helper function to identify column names in the Excel file
const identifyColumns = (firstRow: any) => {
  const mapping: Record<string, string> = {};
  
  // Check all keys in the first row
  for (const key of Object.keys(firstRow)) {
    const lowerKey = key.toLowerCase();
    
    // Identify name column
    if (lowerKey.includes('name') || lowerKey.includes('employee name')) {
      mapping.name = key;
    }
    // Identify employee number/ID column
    else if (
      lowerKey.includes('employee no') || 
      lowerKey.includes('id') || 
      lowerKey.includes('emp no') || 
      lowerKey.includes('employee number') ||
      lowerKey.includes('number')
    ) {
      mapping.employeeNumber = key;
    }
    // Identify department column
    else if (lowerKey.includes('dept') || lowerKey.includes('department')) {
      mapping.department = key;
    }
    // Identify timestamp column
    else if (
      lowerKey.includes('time') || 
      lowerKey.includes('date') || 
      lowerKey.includes('checkin') || 
      lowerKey.includes('check-in') ||
      lowerKey.includes('check in')
    ) {
      mapping.timestamp = key;
    }
    // Identify status column (check-in/check-out)
    else if (
      lowerKey.includes('status') || 
      lowerKey.includes('check') || 
      lowerKey.includes('in/out') ||
      lowerKey.includes('type')
    ) {
      mapping.status = key;
    }
  }
  
  console.log('Column mapping:', mapping);
  
  // Verify required columns
  if (!mapping.name) throw new Error('Name column not found in Excel file');
  if (!mapping.employeeNumber) throw new Error('Employee number column not found in Excel file');
  if (!mapping.timestamp) throw new Error('Timestamp column not found in Excel file');
  if (!mapping.status) throw new Error('Status (check-in/check-out) column not found in Excel file');
  
  return mapping;
};

// Group Excel data by employee
const groupDataByEmployee = (jsonData: any[], columnMapping: Record<string, string>) => {
  const employeeMap = new Map<string, {
    name: string;
    department?: string;
    records: {
      timestamp: Date;
      status: string;
      originalIndex: number;
    }[];
  }>();
  
  jsonData.forEach((row, index) => {
    // Extract employee number as the key
    const employeeNumber = String(row[columnMapping.employeeNumber]).trim();
    
    // Skip rows without employee numbers
    if (!employeeNumber) return;
    
    // Extract name and timestamp
    const name = row[columnMapping.name];
    let timestamp = row[columnMapping.timestamp];
    let status = row[columnMapping.status];
    
    // If timestamp is a number, it might be an Excel serial date
    if (typeof timestamp === 'number') {
      // Convert Excel serial date to JS Date (Excel dates start from 1/1/1900)
      timestamp = new Date((timestamp - 25569) * 86400 * 1000);
    } else if (typeof timestamp === 'string') {
      // Try to parse the timestamp string
      timestamp = new Date(timestamp);
    }
    
    // Skip invalid timestamps
    if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
      console.warn(`Skipping row ${index + 1} due to invalid timestamp:`, row[columnMapping.timestamp]);
      return;
    }
    
    // Normalize status
    const normalizedStatus = normalizeStatus(status);
    if (!normalizedStatus) {
      console.warn(`Skipping row ${index + 1} due to unrecognized status:`, status);
      return;
    }
    
    // Get or create employee entry
    if (!employeeMap.has(employeeNumber)) {
      employeeMap.set(employeeNumber, {
        name,
        department: columnMapping.department ? row[columnMapping.department] : undefined,
        records: []
      });
    }
    
    // Add record
    employeeMap.get(employeeNumber)!.records.push({
      timestamp,
      status: normalizedStatus,
      originalIndex: index
    });
  });
  
  return employeeMap;
};

// Normalize status values from various formats
const normalizeStatus = (status: string): 'check_in' | 'check_out' | null => {
  if (!status) return null;
  
  const lowerStatus = String(status).toLowerCase().trim();
  
  if (
    lowerStatus.includes('check in') || 
    lowerStatus.includes('checkin') || 
    lowerStatus.includes('in') || 
    lowerStatus.includes('i') || 
    lowerStatus.includes('c/in') ||
    lowerStatus === 'c/i' ||
    lowerStatus === 'ci' ||
    lowerStatus === '1'
  ) {
    return 'check_in';
  } else if (
    lowerStatus.includes('check out') || 
    lowerStatus.includes('checkout') || 
    lowerStatus.includes('out') || 
    lowerStatus.includes('o') || 
    lowerStatus.includes('c/out') ||
    lowerStatus === 'c/o' ||
    lowerStatus === 'co' ||
    lowerStatus === '0' ||
    lowerStatus === '2'
  ) {
    return 'check_out';
  }
  
  return null;
};

// Convert the grouped data to EmployeeRecord array
const convertToEmployeeRecords = (employeeMap: Map<string, any>): EmployeeRecord[] => {
  const employeeRecords: EmployeeRecord[] = [];
  
  employeeMap.forEach((value, employeeNumber) => {
    // Create employee record
    const employee: EmployeeRecord = {
      employeeNumber,
      name: value.name,
      department: value.department || '',
      days: [],
      totalDays: 0,
      expanded: false
    };
    
    // Group records by date
    const recordsByDate = new Map<string, {
      checkIns: { timestamp: Date, originalIndex: number }[];
      checkOuts: { timestamp: Date, originalIndex: number }[];
      allTimeRecords: any[];
    }>();
    
    value.records.forEach(record => {
      // Format date as YYYY-MM-DD for grouping
      const dateStr = format(record.timestamp, 'yyyy-MM-dd');
      
      if (!recordsByDate.has(dateStr)) {
        recordsByDate.set(dateStr, {
          checkIns: [],
          checkOuts: [],
          allTimeRecords: []
        });
      }
      
      const dayData = recordsByDate.get(dateStr)!;
      
      // Save the raw record for reference
      dayData.allTimeRecords.push({
        ...record,
        department: value.department || '',
        name: value.name,
        employeeNumber,
        timestamp: record.timestamp,
        shift_type: null, // Will be determined later
        processed: false
      });
      
      // Add to check-ins or check-outs
      if (record.status === 'check_in') {
        dayData.checkIns.push({ 
          timestamp: record.timestamp,
          originalIndex: record.originalIndex
        });
      } else {
        dayData.checkOuts.push({ 
          timestamp: record.timestamp,
          originalIndex: record.originalIndex
        });
      }
    });
    
    // Process each day
    recordsByDate.forEach((dayData, dateStr) => {
      // Sort check-ins and check-outs by time
      dayData.checkIns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      dayData.checkOuts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      // Use earliest check-in and latest check-out
      const firstCheckIn = dayData.checkIns.length > 0 ? dayData.checkIns[0].timestamp : null;
      const lastCheckOut = dayData.checkOuts.length > 0 ? dayData.checkOuts[0].timestamp : null;
      
      // Determine shift type based on check-in time
      let shiftType = firstCheckIn 
        ? determineShiftType(firstCheckIn) 
        : null;
      
      // Basic validation flags
      const missingCheckIn = !firstCheckIn;
      const missingCheckOut = !lastCheckOut;
      
      // Calculate hours worked if both check-in and check-out are available
      let hoursWorked = 0;
      let isLate = false;
      let earlyLeave = false;
      let excessiveOvertime = false;
      
      if (firstCheckIn && lastCheckOut) {
        // Calculate hours
        hoursWorked = calculateHours(firstCheckIn, lastCheckOut, shiftType);
        
        // Check for issues
        isLate = checkLate(firstCheckIn, shiftType);
        earlyLeave = checkEarlyLeave(lastCheckOut, shiftType);
        excessiveOvertime = checkExcessiveOvertime(hoursWorked);
      }
      
      // Create the daily record
      const dailyRecord: DailyRecord = {
        date: dateStr,
        firstCheckIn,
        lastCheckOut,
        hoursWorked,
        approved: false, // Not approved by default
        shiftType,
        notes: '',
        missingCheckIn,
        missingCheckOut,
        isLate,
        earlyLeave,
        excessiveOvertime,
        penaltyMinutes: 0, // No penalty by default
        allTimeRecords: dayData.allTimeRecords, // Store all time records for this day
        hasMultipleRecords: dayData.allTimeRecords.length > 2 // Flag if there are more than check-in/out
      };
      
      // Add notes for days with issues
      if (missingCheckIn && missingCheckOut) {
        dailyRecord.notes = 'Missing both check-in and check-out';
      } else if (missingCheckIn) {
        dailyRecord.notes = 'Missing check-in';
      } else if (missingCheckOut) {
        dailyRecord.notes = 'Missing check-out';
      } else if (dayData.allTimeRecords.length > 2) {
        dailyRecord.notes = `Multiple records (${dayData.allTimeRecords.length})`;
      }
      
      // Add the daily record to the employee
      employee.days.push(dailyRecord);
    });
    
    // Sort days by date
    employee.days.sort((a, b) => a.date.localeCompare(b.date));
    
    // Update total days count
    employee.totalDays = employee.days.length;
    
    // Add the employee record to the result array
    employeeRecords.push(employee);
  });
  
  return employeeRecords;
};

// Helper function to determine shift type based on check-in time
const determineShiftType = (checkInTime: Date): 'morning' | 'evening' | 'night' | 'canteen' | null => {
  const hour = checkInTime.getHours();
  
  // Check for canteen shift (7 AM or 8 AM check-in)
  if (hour === 7 || hour === 8) {
    return 'canteen';
  }
  
  // Morning shift: 5 AM - 12 PM
  if (hour >= 5 && hour < 12) {
    return 'morning';
  }
  
  // Evening shift: 12 PM - 9 PM
  if (hour >= 12 && hour < 21) {
    return 'evening';
  }
  
  // Night shift: 9 PM - 5 AM
  if (hour >= 21 || hour < 5) {
    return 'night';
  }
  
  // Default to null if we can't determine
  return null;
};

// Helper function to calculate hours worked
const calculateHours = (checkIn: Date, checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | null): number => {
  // Calculate raw hours
  let diffMs = checkOut.getTime() - checkIn.getTime();
  
  // If checkout is before check-in, assume it's the next day
  if (diffMs < 0) {
    diffMs += 24 * 60 * 60 * 1000; // Add 24 hours
  }
  
  // Convert to hours
  let hours = diffMs / (1000 * 60 * 60);
  
  // Apply business rules
  if (hours > 12) {
    // Cap excessive hours at 12
    hours = 12;
  } else if (hours > 8.5) {
    // If they worked more than 8.5 hours, give them 9 hours
    hours = 9;
  }
  
  // Round to 2 decimal places
  return parseFloat(hours.toFixed(2));
};

// Helper function to check if check-in is late
const checkLate = (checkIn: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | null): boolean => {
  const hour = checkIn.getHours();
  const minute = checkIn.getMinutes();
  
  if (shiftType === 'morning') {
    // Morning shift starts at 5 AM, consider late if after 5:15 AM
    return (hour === 5 && minute > 15) || hour > 5;
  } else if (shiftType === 'evening') {
    // Evening shift starts at 1 PM, consider late if after 1:15 PM
    return (hour === 13 && minute > 15) || hour > 13;
  } else if (shiftType === 'night') {
    // Night shift starts at 9 PM, consider late if after 9:30 PM
    return (hour === 21 && minute > 30) || hour > 21;
  } else if (shiftType === 'canteen') {
    // Canteen shift starts at 7 AM or 8 AM, consider late if 10+ minutes late
    return (hour === 7 && minute > 10) || (hour === 8 && minute > 10) || hour > 8;
  }
  
  return false;
};

// Helper function to check if check-out is early leave
const checkEarlyLeave = (checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | null): boolean => {
  const hour = checkOut.getHours();
  const minute = checkOut.getMinutes();
  
  if (shiftType === 'morning') {
    // Morning shift ends at 2 PM, consider early if before 1:30 PM
    return hour < 13 || (hour === 13 && minute < 30);
  } else if (shiftType === 'evening') {
    // Evening shift ends at 10 PM, consider early if before 9:30 PM
    return hour < 21 || (hour === 21 && minute < 30);
  } else if (shiftType === 'night') {
    // Night shift ends at 6 AM, consider early if before 5:30 AM
    return hour < 5 || (hour === 5 && minute < 30);
  } else if (shiftType === 'canteen') {
    // Canteen shift (7 AM start) ends at 4 PM, consider early if before 3:30 PM
    // Canteen shift (8 AM start) ends at 5 PM, consider early if before 4:30 PM
    return hour < 15 || (hour === 15 && minute < 30);
  }
  
  return false;
};

// Helper function to check if hours worked is excessive overtime
const checkExcessiveOvertime = (hours: number): boolean => {
  return hours > 10;
};

// Export data to Excel file
export const exportToExcel = (employeeRecords: EmployeeRecord[]) => {
  // Create workbook and worksheet
  const wb = utils.book_new();
  const wsName = 'Employee Time Records';
  
  // Prepare data for worksheet
  const data: any[][] = [];
  
  // Add header row
  data.push([
    'Employee Number', 
    'Name', 
    'Department', 
    'Date', 
    'Check-In',
    'Check-Out',
    'Hours Worked',
    'Shift Type',
    'Approved',
    'Issues',
    'Penalty Minutes'
  ]);
  
  // Add data rows
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      // Get issues
      const issues = [];
      if (day.missingCheckIn) issues.push('Missing check-in');
      if (day.missingCheckOut) issues.push('Missing check-out');
      if (day.isLate) issues.push('Late');
      if (day.earlyLeave) issues.push('Early leave');
      if (day.excessiveOvertime) issues.push('Excessive overtime');
      
      // Format time
      const checkInTime = day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing';
      const checkOutTime = day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing';
      
      data.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        day.date,
        checkInTime,
        checkOutTime,
        day.hoursWorked,
        day.shiftType || 'Unknown',
        day.approved ? 'Yes' : 'No',
        issues.join(', '),
        day.penaltyMinutes
      ]);
    });
    
    // Add a summary row for the employee
    data.push([
      employee.employeeNumber,
      employee.name,
      employee.department,
      'TOTAL',
      '', 
      '',
      employee.days.reduce((sum, day) => sum + day.hoursWorked, 0).toFixed(2),
      '',
      `${employee.days.filter(d => d.approved).length}/${employee.days.length} approved`,
      '',
      employee.days.reduce((sum, day) => sum + day.penaltyMinutes, 0)
    ]);
    
    // Add an empty row for spacing
    data.push([]);
  });
  
  // Create worksheet
  const ws = utils.aoa_to_sheet(data);
  
  // Add worksheet to workbook
  utils.book_append_sheet(wb, ws, wsName);
  
  // Generate Excel file
  const wbout = xlsxWrite(wb, { bookType: 'xlsx', type: 'array' });
  
  // Create Blob and download
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Employee_Time_Records.xlsx';
  a.click();
  URL.revokeObjectURL(url);
};

// Export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any) => {
  const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
  
  // Create workbook
  const wb = utils.book_new();
  
  // Create summary worksheet
  const summaryData: any[][] = [];
  
  // Add headers
  summaryData.push([
    'Employee Number',
    'Name',
    'Total Days',
    'Working Days',
    'Off Days',
    'Regular Hours',
    'Double-Time Hours',
    'Total Payable Hours',
    'Avg Hours/Day'
  ]);
  
  // Filter month or date range string
  let dateFilterStr = '';
  if (filterMonth === 'custom' && dateRange) {
    dateFilterStr = `Custom Range: ${dateRange.startDate} to ${dateRange.endDate}`;
  } else if (filterMonth !== 'all') {
    // Try to format the month nicely
    try {
      const [year, month] = filterMonth.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      if (isValid(date)) {
        dateFilterStr = format(date, 'MMMM yyyy');
      } else {
        dateFilterStr = filterMonth;
      }
    } catch (err) {
      dateFilterStr = filterMonth;
    }
  }
  
  // Add title row with filter info
  summaryData.unshift([dateFilterStr || 'All Time']);
  summaryData.unshift(['Approved Hours Summary']);
  
  // Add data rows
  summary.forEach(employee => {
    // Calculate working days
    const totalDays = employee.total_days || 0;
    const offDaysCount = employee.off_days_count || 0;
    const workingDays = employee.working_days !== undefined ? employee.working_days : (totalDays - offDaysCount);
    
    // Calculate double-time hours if not provided
    let doubleTimeHours = employee.double_time_hours || 0;
    
    // Calculate average hours per day
    const avgHoursPerDay = workingDays > 0 
      ? parseFloat((employee.total_hours / workingDays).toFixed(2)) 
      : 0;
    
    summaryData.push([
      employee.employee_number,
      employee.name,
      totalDays,
      workingDays,
      offDaysCount,
      employee.total_hours.toFixed(2),
      doubleTimeHours.toFixed(2),
      (employee.total_hours + doubleTimeHours).toFixed(2),
      avgHoursPerDay.toFixed(2)
    ]);
  });
  
  // Create and add summary worksheet
  const ws1 = utils.aoa_to_sheet(summaryData);
  utils.book_append_sheet(wb, ws1, 'Summary');
  
  // Create details worksheet if details are available
  if (details && details.length > 0) {
    const detailsData: any[][] = [];
    
    // Add headers
    detailsData.push([
      'Employee Number',
      'Name',
      'Date',
      'Check In',
      'Check Out',
      'Shift Type',
      'Regular Hours',
      'Double-Time (2×)',
      'Total Hours'
    ]);
    
    // Add data rows
    details.forEach(record => {
      // Check if this is a double-time day
      const isDoubleTime = doubleDays.includes(record.working_week_start || record.date);
      const regularHours = parseFloat(record.exact_hours || 0);
      const doubleTimeHours = isDoubleTime ? regularHours : 0;
      
      detailsData.push([
        record.employees?.employee_number || '',
        record.employees?.name || '',
        record.working_week_start || record.date,
        record.display_check_in || (record.timestamp && record.status === 'check_in' ? format(new Date(record.timestamp), 'HH:mm') : 'Missing'),
        record.display_check_out || (record.timestamp && record.status === 'check_out' ? format(new Date(record.timestamp), 'HH:mm') : 'Missing'),
        record.shift_type ? record.shift_type.charAt(0).toUpperCase() + record.shift_type.slice(1) : 'Unknown',
        regularHours.toFixed(2),
        doubleTimeHours.toFixed(2),
        (regularHours + doubleTimeHours).toFixed(2)
      ]);
    });
    
    // Create and add details worksheet
    const ws2 = utils.aoa_to_sheet(detailsData);
    utils.book_append_sheet(wb, ws2, 'Details');
  }
  
  // Generate Excel file
  const wbout = xlsxWrite(wb, { bookType: 'xlsx', type: 'array' });
  
  // Create Blob and download
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Approved_Hours${dateFilterStr ? '_' + dateFilterStr.replace(/\s+/g, '_') : ''}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};