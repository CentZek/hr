import * as XLSX from 'xlsx';
import { EmployeeRecord, TimeRecord, DailyRecord } from '../types';
import { format, parse, parseISO, isFriday } from 'date-fns';
import { determineShiftType, calculatePayableHours, isLikelyNightShiftWorker } from './shiftCalculations';

// Function to parse and process an Excel file
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error('Failed to read file'));
          return;
        }
        
        // Parse the Excel file
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert sheet to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in the file'));
          return;
        }
        
        // Process the raw data
        const records = processRawData(jsonData);
        
        // Group records by employee
        const employeeRecords = groupByEmployee(records);
        
        resolve(employeeRecords);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading the file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Process raw data from Excel
const processRawData = (jsonData: any[]): TimeRecord[] => {
  const records: TimeRecord[] = [];
  const requiredColumns = ['Department', 'Name', 'Employee Number', 'Timestamp', 'Status'];
  
  // Check if the first row has required columns
  const firstRow = jsonData[0];
  const hasRequiredColumns = requiredColumns.every(column => 
    Object.keys(firstRow).some(key => key.includes(column))
  );
  
  if (!hasRequiredColumns) {
    throw new Error('The Excel file is missing required columns. Please make sure it includes: ' + 
      requiredColumns.join(', '));
  }
  
  // Normalize column names (they might have different capitalizations or extra spaces)
  const normalizeColumnName = (key: string): string => {
    key = key.toLowerCase();
    if (key.includes('department')) return 'department';
    if (key.includes('name') && !key.includes('employee')) return 'name';
    if (key.includes('employee') && key.includes('number')) return 'employeeNumber';
    if (key.includes('timestamp')) return 'timestamp';
    if (key.includes('status')) return 'status';
    return key;
  };
  
  // Process each row
  jsonData.forEach((row, index) => {
    const normalizedRow: any = {};
    
    // Normalize column names
    Object.keys(row).forEach(key => {
      normalizedRow[normalizeColumnName(key)] = row[key];
    });
    
    // Skip rows without the required data
    if (!normalizedRow.name || !normalizedRow.timestamp || !normalizedRow.status) {
      return;
    }
    
    // Parse the timestamp
    let timestamp: Date;
    try {
      // Try different formats
      if (typeof normalizedRow.timestamp === 'string') {
        // Try as ISO string first
        timestamp = new Date(normalizedRow.timestamp);
        
        // If invalid, try parsing with format
        if (isNaN(timestamp.getTime())) {
          // Try with various formats
          const formats = [
            'M/d/yyyy h:mm:ss a',
            'M/d/yyyy h:mm a',
            'MM/dd/yyyy h:mm:ss a',
            'yyyy-MM-dd HH:mm:ss',
            'yyyy/MM/dd HH:mm:ss'
          ];
          
          // Try each format until one works
          for (const fmt of formats) {
            try {
              timestamp = parse(normalizedRow.timestamp, fmt, new Date());
              if (!isNaN(timestamp.getTime())) break;
            } catch (e) {
              // Try next format
            }
          }
        }
      } else if (typeof normalizedRow.timestamp === 'number') {
        // If it's a number, try to parse as Excel serial date
        timestamp = XLSX.SSF.parse_date_code(normalizedRow.timestamp);
      } else {
        // Default to current date if all else fails
        timestamp = new Date();
      }
      
      // If still invalid, throw error
      if (isNaN(timestamp.getTime())) {
        throw new Error(`Invalid timestamp format at row ${index + 2}`);
      }
    } catch (e) {
      console.error(`Error parsing timestamp at row ${index + 2}:`, e);
      // Skip this row
      return;
    }
    
    // Normalize the status
    const status = normalizeStatus(normalizedRow.status);
    
    // Skip rows with invalid status
    if (!status) return;
    
    // Create the record
    const record: TimeRecord = {
      department: normalizedRow.department || '',
      name: normalizedRow.name,
      employeeNumber: (normalizedRow.employeeNumber || '').toString(),
      timestamp,
      status,
      originalIndex: index
    };
    
    records.push(record);
  });
  
  return records;
};

// Normalize the status field
const normalizeStatus = (status: string): 'check_in' | 'check_out' | '' => {
  if (!status) return '';
  
  status = status.toLowerCase();
  
  if (status.includes('in') || status === 'i') {
    return 'check_in';
  } else if (status.includes('out') || status === 'o') {
    return 'check_out';
  }
  
  return '';
};

// Group records by employee
const groupByEmployee = (records: TimeRecord[]): EmployeeRecord[] => {
  const employeesMap = new Map<string, TimeRecord[]>();
  
  // Group records by employee number
  records.forEach(record => {
    if (!employeesMap.has(record.employeeNumber)) {
      employeesMap.set(record.employeeNumber, []);
    }
    
    employeesMap.get(record.employeeNumber)!.push(record);
  });
  
  // Sort employees by name
  const sortedEmployeeNumbers = Array.from(employeesMap.keys()).sort((a, b) => {
    const recordsA = employeesMap.get(a)!;
    const recordsB = employeesMap.get(b)!;
    return recordsA[0].name.localeCompare(recordsB[0].name);
  });
  
  // Process each employee's records
  const employeeRecords: EmployeeRecord[] = [];
  
  for (const employeeNumber of sortedEmployeeNumbers) {
    const records = employeesMap.get(employeeNumber)!;
    
    // Skip employees with no records
    if (records.length === 0) continue;
    
    // Process employee records to create daily records
    const dailyRecords = processDailyRecords(records);
    
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
  }
  
  return employeeRecords;
};

// Process daily records for an employee
const processDailyRecords = (records: TimeRecord[]): DailyRecord[] => {
  // Group records by date
  const recordsByDate = new Map<string, TimeRecord[]>();
  
  // Is this employee likely a night shift worker based on their check-in times?
  const isNightShiftWorker = isLikelyNightShiftWorker(records);
  
  records.forEach(record => {
    const date = format(record.timestamp, 'yyyy-MM-dd');
    
    if (!recordsByDate.has(date)) {
      recordsByDate.set(date, []);
    }
    
    recordsByDate.get(date)!.push(record);
  });
  
  // Process each day's records
  const dailyRecords: DailyRecord[] = [];
  
  recordsByDate.forEach((dayRecords, date) => {
    const checkIns = dayRecords.filter(r => r.status === 'check_in');
    const checkOuts = dayRecords.filter(r => r.status === 'check_out');
    
    // Find earliest check-in and latest check-out
    let firstCheckIn: Date | null = null;
    let lastCheckOut: Date | null = null;
    let shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null = null;
    
    if (checkIns.length > 0) {
      // Sort check-ins by timestamp (ascending)
      checkIns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      firstCheckIn = checkIns[0].timestamp;
      
      // Determine shift type based on first check-in
      shiftType = determineShiftType(firstCheckIn, isNightShiftWorker);
    }
    
    if (checkOuts.length > 0) {
      // Sort check-outs by timestamp (descending to get the latest)
      checkOuts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      lastCheckOut = checkOuts[0].timestamp;
    }
    
    // Calculate hours worked and flags
    let hoursWorked = 0;
    let isLate = false;
    let earlyLeave = false;
    let excessiveOvertime = false;
    
    if (firstCheckIn && lastCheckOut && shiftType) {
      hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, shiftType);
      
      // Flags for UI
      isLate = checkIfLate(firstCheckIn, shiftType);
      earlyLeave = checkIfEarlyLeave(lastCheckOut, shiftType);
      excessiveOvertime = hoursWorked > 10; // More than 10 hours is excessive
    }
    
    // Add the daily record
    dailyRecords.push({
      date,
      firstCheckIn,
      lastCheckOut,
      hoursWorked,
      approved: false, // Default to not approved
      shiftType,
      notes: getNotesForDay(dayRecords, shiftType),
      missingCheckIn: !firstCheckIn,
      missingCheckOut: !lastCheckOut,
      isLate,
      earlyLeave,
      excessiveOvertime,
      penaltyMinutes: 0, // Default to no penalty
      allTimeRecords: dayRecords, // Store all raw time records
      hasMultipleRecords: dayRecords.length > 1, // Flag if there are multiple records for this day
      isCrossDay: shiftType === 'night' // Flag if this is a cross-day shift
    });
  });
  
  // Sort daily records by date
  dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
  
  return dailyRecords;
};

// Check if check-in is late
const checkIfLate = (checkIn: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean => {
  if (!shiftType) return false;
  
  const hour = checkIn.getHours();
  const minute = checkIn.getMinutes();
  
  switch (shiftType) {
    case 'morning':
      // After 5:00 AM is late for morning shift
      return hour > 5 || (hour === 5 && minute > 0);
    case 'evening':
      // After 1:00 PM is late for evening shift
      return hour > 13 || (hour === 13 && minute > 0);
    case 'night':
      // After 9:00 PM is late for night shift
      return hour > 21 || (hour === 21 && minute > 0);
    case 'canteen':
      // For canteen, check if after 7:10 AM or 8:10 AM depending on start time
      if (hour === 7) {
        return minute > 10; // 10 minutes grace period
      } else if (hour === 8) {
        return minute > 10; // 10 minutes grace period
      } else {
        // If not at the exact starting hour, it's late
        return hour > 8 || hour < 7;
      }
    default:
      return false;
  }
};

// Check if check-out is early
const checkIfEarlyLeave = (checkOut: Date, shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): boolean => {
  if (!shiftType) return false;
  
  const hour = checkOut.getHours();
  const minute = checkOut.getMinutes();
  
  switch (shiftType) {
    case 'morning':
      // Before 1:30 PM is early for morning shift
      return hour < 13 || (hour === 13 && minute < 30);
    case 'evening':
      // Before 9:30 PM is early for evening shift
      return hour < 21 || (hour === 21 && minute < 30);
    case 'night':
      // Before 5:30 AM is early for night shift
      return hour < 5 || (hour === 5 && minute < 30);
    case 'canteen':
      // For canteen shift, depends on which canteen shift (7 AM or 8 AM start)
      if (hour < 15) return true; // Before 3 PM is definitely early
      
      if (hour === 15) {
        return minute < 30; // Before 3:30 PM is early for 7 AM shift
      }
      
      if (hour === 16) {
        return minute < 30; // Before 4:30 PM is early for 8 AM shift
      }
      
      // After 4:30 PM is not early
      return false;
    default:
      return false;
  }
};

// Generate notes for a day based on records
const getNotesForDay = (records: TimeRecord[], shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null): string => {
  // Check for potential issues
  const hasMultipleRecords = records.length > 2;
  const checkIns = records.filter(r => r.status === 'check_in').length;
  const checkOuts = records.filter(r => r.status === 'check_out').length;
  
  if (checkIns === 0 && checkOuts === 0) {
    return 'No check-in/check-out records found';
  }
  
  if (checkIns === 0) {
    return 'Missing check-in record';
  }
  
  if (checkOuts === 0) {
    return 'Missing check-out record';
  }
  
  if (hasMultipleRecords) {
    if (checkIns === 1 && checkOuts > 1) {
      return 'Multiple check-outs for one check-in';
    }
    
    if (checkIns > 1 && checkOuts === 1) {
      return 'Multiple check-ins for one check-out';
    }
    
    if (checkIns > 1 && checkOuts > 1) {
      return 'Multiple check-ins and check-outs';
    }
  }
  
  // Shift type specific notes
  switch (shiftType) {
    case 'morning':
      return 'Morning shift (05:00-14:00)';
    case 'evening':
      return 'Evening shift (13:00-22:00)';
    case 'night':
      return 'Night shift (21:00-06:00)';
    case 'canteen':
      // Check if this is 7 AM or 8 AM canteen shift
      const checkInHour = records.find(r => r.status === 'check_in')?.timestamp.getHours();
      return checkInHour === 7 
        ? 'Canteen shift (07:00-16:00)' 
        : 'Canteen shift (08:00-17:00)';
    default:
      return '';
  }
};

// Export to Excel
export const exportToExcel = (data: EmployeeRecord[]): void => {
  try {
    // Create a workbook with multiple sheets
    const wb = XLSX.utils.book_new();
    
    // Create a summary sheet with basic employee information
    const summaryData = data.map(employee => ({
      'Employee Number': employee.employeeNumber,
      'Name': employee.name,
      'Department': employee.department,
      'Total Days': employee.totalDays,
      'Average Hours': employee.days.length > 0 
        ? (employee.days.reduce((sum, day) => sum + day.hoursWorked, 0) / employee.days.length).toFixed(2) 
        : 0
    }));
    
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Employee Summary');
    
    // Create a detailed sheet with all daily records
    const detailedData: any[] = [];
    
    data.forEach(employee => {
      employee.days.forEach(day => {
        detailedData.push({
          'Employee Number': employee.employeeNumber,
          'Name': employee.name,
          'Department': employee.department,
          'Date': day.date,
          'Check-in Time': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm:ss') : 'Missing',
          'Check-out Time': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm:ss') : 'Missing',
          'Hours Worked': day.hoursWorked.toFixed(2),
          'Shift Type': day.shiftType || 'Unknown',
          'Approved': day.approved ? 'Yes' : 'No',
          'Late': day.isLate ? 'Yes' : 'No',
          'Early Leave': day.earlyLeave ? 'Yes' : 'No',
          'Penalty (min)': day.penaltyMinutes,
          'Notes': day.notes
        });
      });
    });
    
    const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
    XLSX.utils.book_append_sheet(wb, detailedSheet, 'Daily Records');
    
    // Generate Excel file and download
    const today = format(new Date(), 'yyyy-MM-dd');
    XLSX.writeFile(wb, `Employee_Time_Records_${today}.xlsx`);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Failed to export data to Excel');
  }
};

// Enhanced export function for Approved Hours page
export const exportApprovedHoursToExcel = (exportData: any): void => {
  try {
    const { summary, details, dateRange, reportType = 'summary', doubleDays = [] } = exportData;
    
    // Create a workbook
    const wb = XLSX.utils.book_new();
    
    // Calculate summary statistics
    let totalFridaysWorked = 0;
    let totalHolidaysWorked = 0;
    let totalOffDays = 0;
    
    // Create a summary sheet with enhanced information
    const summaryData = summary.map((employee: any) => {
      // Calculate regular and double-time hours
      let regularHours = employee.total_hours || 0;
      let doubleTimeHours = employee.double_time_hours || 0;
      
      // Track statistics
      const fridaysWorked = employee.fridays_worked || 0;
      const holidaysWorked = employee.holidays_worked || 0;
      const offDays = employee.off_days || 0;
      
      // Accumulate totals
      totalFridaysWorked += fridaysWorked;
      totalHolidaysWorked += holidaysWorked;
      totalOffDays += offDays;
      
      // Calculate working days (excluding OFF-DAYs)
      const workingDays = employee.working_days || employee.total_days || 0;
      
      return {
        'Employee Number': employee.employee_number,
        'Name': employee.name,
        'Working Days': workingDays,
        'Fridays Worked': fridaysWorked,
        'Holidays Worked': holidaysWorked,
        'OFF-Days': offDays,
        'Regular Hours': regularHours.toFixed(2),
        'Double-Time Hours': doubleTimeHours.toFixed(2),
        'Total Payable Hours': (regularHours + doubleTimeHours).toFixed(2),
        'Avg Hours/Day': workingDays > 0 
          ? (regularHours / workingDays).toFixed(2) 
          : '0.00'
      };
    });
    
    // Add date range information to summary sheet
    const dateRangeInfo = [
      {
        'Employee Number': 'Date Range:',
        'Name': dateRange ? 
          `${format(new Date(dateRange.startDate), 'MMM d, yyyy')} to ${format(new Date(dateRange.endDate), 'MMM d, yyyy')}` : 
          'All Time',
        'Working Days': '',
        'Fridays Worked': '',
        'Holidays Worked': '',
        'OFF-Days': '',
        'Regular Hours': '',
        'Double-Time Hours': '',
        'Total Payable Hours': '',
        'Avg Hours/Day': ''
      },
      {
        'Employee Number': 'Total Employees:',
        'Name': summary.length.toString(),
        'Working Days': '',
        'Fridays Worked': totalFridaysWorked.toString(),
        'Holidays Worked': totalHolidaysWorked.toString(),
        'OFF-Days': totalOffDays.toString(),
        'Regular Hours': '',
        'Double-Time Hours': '',
        'Total Payable Hours': '',
        'Avg Hours/Day': ''
      },
      {
        'Employee Number': 'Report Type:',
        'Name': reportType === 'detail' ? 'Detailed' : 'Summary',
        'Working Days': '',
        'Fridays Worked': '',
        'Holidays Worked': '',
        'OFF-Days': '',
        'Regular Hours': '',
        'Double-Time Hours': '',
        'Total Payable Hours': '',
        'Avg Hours/Day': ''
      },
      {
        'Employee Number': 'Report Generated:',
        'Name': format(new Date(), 'MMM d, yyyy HH:mm'),
        'Working Days': '',
        'Fridays Worked': '',
        'Holidays Worked': '',
        'OFF-Days': '',
        'Regular Hours': '',
        'Double-Time Hours': '',
        'Total Payable Hours': '',
        'Avg Hours/Day': ''
      }
    ];
    
    const summarySheet = XLSX.utils.json_to_sheet([...dateRangeInfo, {}, ...summaryData]);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    
    // Create a detailed sheet if detailed report is requested
    if (reportType === 'detail' && details.length > 0) {
      const detailedData: any[] = [];
      
      details.forEach((record: any) => {
        // Check if this is a double-time day
        const recordDate = record.working_week_start || format(parseISO(record.timestamp), 'yyyy-MM-dd');
        const isDoubleTime = doubleDays.includes(recordDate);
        const isFridayWorked = isFriday(parseISO(recordDate));
        const isHolidayWorked = isDoubleTime && !isFridayWorked;
        const isOffDay = record.status === 'off_day' || record.notes?.includes('OFF-DAY');
        
        // Only include check-in records to avoid duplicating hours
        if (record.status === 'check_in' || record.status === 'off_day') {
          const hoursWorked = parseFloat(record.exact_hours || '0');
          
          detailedData.push({
            'Date': recordDate,
            'Employee': record.employees?.name || 'Unknown',
            'Employee #': record.employees?.employee_number || '',
            'Check-in': record.display_check_in || (record.status !== 'off_day' ? format(parseISO(record.timestamp), 'HH:mm') : 'OFF-DAY'),
            'Check-out': record.display_check_out || 'Missing',
            'Shift Type': isOffDay ? 'OFF-DAY' : (record.shift_type?.charAt(0).toUpperCase() + record.shift_type?.slice(1) || 'Unknown'),
            'Regular Hours': isDoubleTime ? '0.00' : hoursWorked.toFixed(2),
            'Double-Time Hours': isDoubleTime ? (hoursWorked * 2).toFixed(2) : '0.00',
            'Total Payable Hours': isDoubleTime ? (hoursWorked * 2).toFixed(2) : hoursWorked.toFixed(2),
            'Notes': (record.notes || '').replace(/hours:\d+\.\d+;?\s*/, ''),
            'Is Double-Time': isDoubleTime ? 'Yes' : 'No',
            'Is Friday': isFridayWorked ? 'Yes' : 'No',
            'Is Holiday': isHolidayWorked ? 'Yes' : 'No',
            'Is OFF-DAY': isOffDay ? 'Yes' : 'No'
          });
        }
      });
      
      // If we have detailed records for one employee but summary data for many,
      // add a note about which employee's details are shown
      if (details.length > 0 && summary.length > 1) {
        const employeeInfo = details[0]?.employees;
        if (employeeInfo) {
          detailedData.unshift({
            'Date': 'NOTE:',
            'Employee': 'Detailed records shown for:',
            'Employee #': employeeInfo.employee_number,
            'Check-in': employeeInfo.name,
            'Check-out': '',
            'Shift Type': '',
            'Regular Hours': '',
            'Double-Time Hours': '',
            'Total Payable Hours': '',
            'Notes': '',
            'Is Double-Time': '',
            'Is Friday': '',
            'Is Holiday': '',
            'Is OFF-DAY': ''
          });
        }
      }
      
      if (detailedData.length > 0) {
        const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
        XLSX.utils.book_append_sheet(wb, detailedSheet, 'Detailed Records');
      }
    }
    
    // Generate Excel file and download
    const dateRangeStr = dateRange ? 
      `_${format(new Date(dateRange.startDate), 'yyyyMMdd')}_to_${format(new Date(dateRange.endDate), 'yyyyMMdd')}` : 
      '_all_time';
    
    XLSX.writeFile(wb, `Approved_Hours${dateRangeStr}.xlsx`);
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    alert('Failed to export data to Excel');
  }
};