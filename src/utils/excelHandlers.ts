import { utils, writeFile } from 'xlsx';
import { format, parseISO } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';
import toast from 'react-hot-toast';

// Helper to calculate hours with penalty applied
const calculateHoursWithPenalty = (hoursWorked: number, penaltyMinutes: number): number => {
  if (penaltyMinutes > 0) {
    const penaltyHours = penaltyMinutes / 60;
    return Math.max(0, hoursWorked - penaltyHours);
  }
  return hoursWorked;
};

// Parse Excel file and extract time records
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        if (!e.target || !e.target.result) {
          reject(new Error('Failed to read file'));
          return;
        }
        
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        
        // Import XLSX dynamically to avoid SSR issues
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Assume the first sheet is the one we want
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in the Excel file'));
          return;
        }
        
        // Process and organize the data
        const records = processExcelData(jsonData);
        resolve(records);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file. Please make sure it\'s in the correct format.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Function to process the raw JSON data from Excel
const processExcelData = (jsonData: any[]): EmployeeRecord[] => {
  // Check if data has expected structure
  if (jsonData.length === 0 || !jsonData[0]) {
    throw new Error('Invalid data format in Excel file');
  }
  
  // Sample keys from first row to determine format
  const firstRow = jsonData[0];
  const keys = Object.keys(firstRow);
  
  // Check if this is a standard Face ID Data export format
  const isFaceIDFormat = keys.some(key => 
    key.includes('Employee ID') || 
    key.includes('Emp ID') || 
    key.includes('ID') ||
    key.includes('No.')
  ) && keys.some(key => 
    key.includes('Name') || 
    key.includes('Employee Name')
  ) && keys.some(key => 
    key.includes('Time') || 
    key.includes('Date/Time') || 
    key.includes('DateTime')
  );
  
  if (!isFaceIDFormat) {
    throw new Error('Invalid Face ID data format. Please use the standard export format.');
  }
  
  // Map key names for flexibility
  const idKey = keys.find(k => k.includes('Employee ID') || k.includes('Emp ID') || k.includes('ID') || k.includes('No.')) || 'ID';
  const nameKey = keys.find(k => k.includes('Name') || k.includes('Employee Name')) || 'Name';
  const deptKey = keys.find(k => k.includes('Dept') || k.includes('Department')) || 'Department';
  const dateTimeKey = keys.find(k => 
    k.includes('Time') || 
    k.includes('Date/Time') || 
    k.includes('DateTime') || 
    k.includes('Date Time')
  ) || 'Time';
  const statusKey = keys.find(k => 
    k.includes('Status') || 
    k.includes('Check') || 
    k.includes('C/In') || 
    k.includes('C/Out')
  ) || 'Status';
  
  console.log('Using key mappings:', { idKey, nameKey, deptKey, dateTimeKey, statusKey });
  
  // Map to standardized records
  let timeRecords: {
    department: string;
    name: string;
    employeeNumber: string;
    timestamp: Date;
    status: 'check_in' | 'check_out';
    originalIndex: number;
  }[] = [];
  
  // First pass: convert to standard format
  jsonData.forEach((row, index) => {
    // Extract values
    const employeeNumber = String(row[idKey] || '').trim();
    const name = String(row[nameKey] || '').trim();
    const department = String(row[deptKey] || '').trim();
    const dateTimeStr = row[dateTimeKey];
    let status = String(row[statusKey] || '').trim();
    
    // Skip if missing critical data
    if (!employeeNumber || !name || !dateTimeStr) {
      console.warn('Skipping row due to missing data:', row);
      return;
    }
    
    // Parse date/time
    let timestamp: Date;
    
    try {
      // Try different date formats
      if (typeof dateTimeStr === 'number') {
        // Excel serial date
        timestamp = new Date((dateTimeStr - 25569) * 86400 * 1000);
      } else if (typeof dateTimeStr === 'string') {
        // Try to parse string date
        const dateParts = dateTimeStr.split(/[/ :]/);
        if (dateParts.length >= 6) {
          // Format like "MM/DD/YYYY HH:MM:SS"
          const [month, day, year, hours, minutes, seconds] = dateParts;
          timestamp = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
        } else {
          // Try standard parsing
          timestamp = new Date(dateTimeStr);
        }
      } else if (dateTimeStr instanceof Date) {
        timestamp = dateTimeStr;
      } else {
        throw new Error('Unrecognized date format');
      }
      
      // Validate date
      if (isNaN(timestamp.getTime())) {
        throw new Error('Invalid date');
      }
    } catch (error) {
      console.warn('Could not parse date:', dateTimeStr, error);
      // Skip this row
      return;
    }
    
    // Standardize status
    if (status.toLowerCase().includes('in') || status.toLowerCase().includes('i') || status === '1') {
      status = 'check_in';
    } else if (status.toLowerCase().includes('out') || status.toLowerCase().includes('o') || status === '0') {
      status = 'check_out';
    } else {
      // Skip rows with unclear status
      console.warn('Skipping row with unclear status:', status);
      return;
    }
    
    // Add to records
    timeRecords.push({
      department,
      name,
      employeeNumber,
      timestamp,
      status: status as 'check_in' | 'check_out',
      originalIndex: index
    });
  });
  
  if (timeRecords.length === 0) {
    throw new Error('No valid time records found in the Excel file');
  }
  
  // Group by employee
  const employeeRecords: Record<string, EmployeeRecord> = {};
  
  // Initialize records for each employee
  timeRecords.forEach(record => {
    if (!employeeRecords[record.employeeNumber]) {
      employeeRecords[record.employeeNumber] = {
        employeeNumber: record.employeeNumber,
        name: record.name,
        department: record.department,
        days: [],
        totalDays: 0,
        expanded: false
      };
    }
  });
  
  // Group records by date for each employee
  Object.keys(employeeRecords).forEach(employeeNumber => {
    const employeeTimeRecords = timeRecords.filter(record => 
      record.employeeNumber === employeeNumber
    );
    
    // Group by date
    const recordsByDate: Record<string, any[]> = {};
    employeeTimeRecords.forEach(record => {
      const dateStr = format(record.timestamp, 'yyyy-MM-dd');
      if (!recordsByDate[dateStr]) {
        recordsByDate[dateStr] = [];
      }
      recordsByDate[dateStr].push(record);
    });
    
    // Process daily records
    const dailyRecords: DailyRecord[] = [];
    
    Object.keys(recordsByDate).forEach(dateStr => {
      const dayRecords = recordsByDate[dateStr];
      
      // Split by check-in and check-out
      const checkIns = dayRecords.filter(r => r.status === 'check_in');
      const checkOuts = dayRecords.filter(r => r.status === 'check_out');
      
      // Determine earliest check-in and latest check-out
      checkIns.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      checkOuts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      
      const firstCheckIn = checkIns.length > 0 ? checkIns[0].timestamp : null;
      const lastCheckOut = checkOuts.length > 0 ? checkOuts[0].timestamp : null;
      
      // Determine if we have a complete record
      const missingCheckIn = firstCheckIn === null;
      const missingCheckOut = lastCheckOut === null;
      
      // Calculate hours worked and other flags
      let hoursWorked = 0;
      let isLate = false;
      let earlyLeave = false;
      let excessiveOvertime = false;
      let shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null = null;
      
      // Store all raw time records for later reference
      const allTimeRecords = [...dayRecords];
      
      if (firstCheckIn && lastCheckOut) {
        // Determine shift type based on check-in time
        shiftType = determineShiftType(firstCheckIn);
        
        // Calculate hours between check-in and check-out
        // if lastCheckOut < firstCheckIn, assume next day
        const checkoutTime = lastCheckOut.getTime();
        const checkinTime = firstCheckIn.getTime();
        let diffMs = checkoutTime - checkinTime;
        
        if (diffMs < 0) {
          // Add 24 hours if checkout appears to be before checkin
          // This handles overnight shifts
          diffMs += 24 * 60 * 60 * 1000;
        }
        
        // Convert to hours
        hoursWorked = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
        
        // Flag if excessive hours
        if (hoursWorked > 10) {
          excessiveOvertime = true;
        }
        
        // Check for lateness
        const hour = firstCheckIn.getHours();
        const minute = firstCheckIn.getMinutes();
        
        // Very simple lateness check based on hour
        if ((shiftType === 'morning' && (hour > 5 || (hour === 5 && minute > 15))) ||
            (shiftType === 'evening' && (hour > 13 || (hour === 13 && minute > 15))) ||
            (shiftType === 'night' && (hour > 21 || (hour === 21 && minute > 15))) ||
            (shiftType === 'canteen' && ((hour === 7 && minute > 15) || (hour === 8 && minute > 15) || hour > 8))) {
          isLate = true;
        }
        
        // Simple early leave check
        if ((shiftType === 'morning' && (hour < 14 || (hour === 14 && minute < 0))) ||
            (shiftType === 'evening' && (hour < 22 || (hour === 22 && minute < 0))) ||
            (shiftType === 'night' && (hour < 6 || (hour === 6 && minute < 0))) ||
            (shiftType === 'canteen' && (hour < 16 || (hour === 16 && minute < 0)))) {
          earlyLeave = true;
        }
      }
      
      // Create daily record
      dailyRecords.push({
        date: dateStr,
        firstCheckIn: firstCheckIn ? new Date(firstCheckIn) : null,
        lastCheckOut: lastCheckOut ? new Date(lastCheckOut) : null,
        hoursWorked,
        approved: false,
        shiftType,
        notes: '',
        missingCheckIn,
        missingCheckOut,
        isLate,
        earlyLeave,
        excessiveOvertime,
        penaltyMinutes: 0,
        allTimeRecords,
        hasMultipleRecords: dayRecords.length > 2
      });
    });
    
    // Sort daily records by date
    dailyRecords.sort((a, b) => a.date.localeCompare(b.date));
    
    // Update employee record
    employeeRecords[employeeNumber].days = dailyRecords;
    employeeRecords[employeeNumber].totalDays = dailyRecords.length;
  });
  
  // Convert to array
  return Object.values(employeeRecords);
};

// Function to determine shift type based on check-in time
const determineShiftType = (
  checkInTime: Date
): 'morning' | 'evening' | 'night' | 'canteen' | 'custom' => {
  const hour = checkInTime.getHours();
  const minute = checkInTime.getMinutes();
  
  // CANTEEN SHIFT DETECTION - Must come first!
  // Check for 7 AM canteen shift (allow 6:30-7:30)
  if ((hour === 6 && minute >= 30) || (hour === 7 && minute <= 30)) {
    return 'canteen';
  }
  
  // Check for 8 AM canteen shift (allow 7:30-8:30)
  if ((hour === 7 && minute >= 30) || (hour === 8 && minute <= 30)) {
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
  if (hour >= 5 && hour < 13) {
    return 'morning';
  } 
  
  // Evening shift: 1:00 PM - 8:59 PM
  if (hour >= 13 && hour < 21) {
    return 'evening';
  }
  
  // Default to evening shift if we can't determine
  return 'evening';
};

// Export data to Excel file
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  try {
    // Create a new workbook
    const wb = utils.book_new();
    
    // Data for main summary sheet
    const summaryData = employeeRecords.map(employee => {
      const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
      
      // Calculate WORKING days (days with hours > 0)
      const workingDays = employee.days.filter(day => day.hoursWorked > 0).length;
      
      // Calculate OFF days (days with hours = 0)
      const offDays = employee.days.filter(day => day.hoursWorked === 0).length;
      
      // Calculate days with issues
      const lateDays = employee.days.filter(day => day.isLate).length;
      const earlyLeaveDays = employee.days.filter(day => day.earlyLeave).length;
      const missingRecordDays = employee.days.filter(day => 
        (day.missingCheckIn || day.missingCheckOut) && day.notes !== 'OFF-DAY'
      ).length;
      const overtimeDays = employee.days.filter(day => day.excessiveOvertime).length;
      
      return {
        'Employee Number': employee.employeeNumber,
        'Name': employee.name,
        'Department': employee.department,
        'Total Days': employee.totalDays,
        'Working Days': workingDays,
        'Off Days': offDays,
        'Hours Worked': totalHours.toFixed(2),
        'Late Days': lateDays,
        'Early Leave Days': earlyLeaveDays,
        'Missing Records': missingRecordDays,
        'Overtime Days': overtimeDays
      };
    });
    
    // Create sheet for summary
    const summaryWs = utils.json_to_sheet(summaryData);
    utils.book_append_sheet(wb, summaryWs, 'Summary');
    
    // Create detailed sheets for each employee
    employeeRecords.forEach(employee => {
      // Format each day's data
      const detailedData = employee.days.map(day => {
        return {
          'Date': day.date,
          'Check In': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm:ss') : 'Missing',
          'Check Out': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm:ss') : 'Missing',
          'Hours': day.hoursWorked.toFixed(2),
          'Shift Type': day.shiftType || 'Unknown',
          'Late': day.isLate ? 'Yes' : 'No',
          'Early Leave': day.earlyLeave ? 'Yes' : 'No',
          'Excessive OT': day.excessiveOvertime ? 'Yes' : 'No',
          'Approved': day.approved ? 'Yes' : 'No',
          'Penalty (Minutes)': day.penaltyMinutes,
          'Notes': day.notes
        };
      });
      
      // Create sheet for this employee
      if (detailedData.length > 0) {
        const detailWs = utils.json_to_sheet(detailedData);
        const safeSheetName = employee.name
          .replace(/[^\w\s-]/g, '') // Remove special characters
          .replace(/[\s-]+/g, ' ') // Replace spaces and hyphens with a single space
          .trim()
          .substring(0, 31); // Excel sheet names have a 31 char limit
        utils.book_append_sheet(wb, detailWs, safeSheetName);
      }
    });
    
    // Save the file
    writeFile(wb, 'Employee_Time_Records.xlsx');
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    toast.error('Failed to export data to Excel');
  }
};

// Export approved hours to Excel file
export const exportApprovedHoursToExcel = (data: any): void => {
  try {
    // Create a new workbook
    const wb = utils.book_new();
    
    // Extract relevant data
    const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
    
    // Prepare date range string for the filename
    let dateRangeStr = '';
    if (filterMonth === 'custom' && dateRange) {
      dateRangeStr = `_${dateRange.startDate}_to_${dateRange.endDate}`;
    } else if (filterMonth !== 'all') {
      dateRangeStr = `_${filterMonth}`;
    }
    
    // Calculate summary data with working days and off days
    const summaryData = summary.map((employee: any) => {
      // Calculate working days (days with hours > 0)
      const workingDays = employee.working_week_dates 
        ? employee.working_week_dates.filter((date: string) => 
            (employee.hours_by_date?.[date] || 0) > 0
          ).length 
        : 0;
      
      // Calculate off days (days with hours = 0)
      const offDays = employee.working_week_dates
        ? employee.working_week_dates.filter((date: string) => 
            (employee.hours_by_date?.[date] || 0) === 0
          ).length
        : 0;
      
      // Calculate double-time hours
      const doubleTimeHours = employee.double_time_hours || 0;
      
      // Calculate total payable hours (regular + double-time)
      const totalPayableHours = employee.total_hours + doubleTimeHours;
      
      // Count Fridays worked
      const fridaysWorked = employee.working_week_dates
        ? employee.working_week_dates.filter((date: string) => {
            // Parse the date string to a Date object
            const dateObj = parseISO(date);
            // Friday is day 5 (0 = Sunday, 1 = Monday, ..., 5 = Friday)
            return dateObj.getDay() === 5 && (employee.hours_by_date?.[date] || 0) > 0;
          }).length
        : 0;
        
      // Calculate overtime hours and days
      const regularHoursPerDay = 9; // Standard hours per day
      const overtimeHours = Math.max(0, employee.total_hours - (workingDays * regularHoursPerDay));
      const overtimeDays = Math.ceil(overtimeHours / regularHoursPerDay * 10) / 10; // Round to 1 decimal place
      
      return {
        'Employee Number': employee.employee_number,
        'Name': employee.name,
        'Total Days': employee.total_days || 0,
        'Working Days': workingDays,
        'Off Days': offDays,
        'Regular Hours': employee.total_hours.toFixed(2),
        'Double-Time Hours': doubleTimeHours.toFixed(2),
        'Fridays Worked': fridaysWorked,
        'Over Time (Hours)': overtimeHours.toFixed(2),
        'Over Time (Days)': overtimeDays.toFixed(1),
        'Total Payable Hours': totalPayableHours.toFixed(2)
      };
    });
    
    // Create summary sheet
    if (summaryData.length > 0) {
      const summaryWs = utils.json_to_sheet(summaryData);
      utils.book_append_sheet(wb, summaryWs, 'Summary');
    }
    
    // Add detailed sheets for employees with details
    if (details && details.length > 0) {
      // Find employee in summary that matches the detail record
      const employeeId = details[0].employee_id;
      const employee = summary.find((emp: any) => emp.id === employeeId);
      
      if (employee) {
        // Group by date
        const recordsByDate = details.reduce((acc: any, record: any) => {
          // Use working_week_start if available, else timestamp date
          const dateKey = record.working_week_start || format(new Date(record.timestamp), 'yyyy-MM-dd');
          
          if (!acc[dateKey]) {
            acc[dateKey] = [];
          }
          acc[dateKey].push(record);
          return acc;
        }, {});
        
        // Format detailed data with double-time indicators
        const detailedData = Object.keys(recordsByDate)
          .sort() // Sort by date
          .map(date => {
            const dayRecords = recordsByDate[date];
            const checkIns = dayRecords.filter((r: any) => r.status === 'check_in');
            const checkOuts = dayRecords.filter((r: any) => r.status === 'check_out');
            const offDay = dayRecords.some((r: any) => r.status === 'off_day');
            
            // Determine if this is a double-time day
            const isDoubleTimeDay = doubleDays.includes(date);
            
            // Get hours for this day
            let hours = 0;
            if (checkIns.length > 0 && checkIns[0].exact_hours) {
              hours = parseFloat(checkIns[0].exact_hours);
            } else if (!offDay && employee.hours_by_date && employee.hours_by_date[date]) {
              hours = employee.hours_by_date[date];
            }
            
            // Check-in and check-out display time
            let checkInDisplay = 'Missing';
            let checkOutDisplay = 'Missing';
            
            if (offDay) {
              checkInDisplay = 'OFF-DAY';
              checkOutDisplay = 'OFF-DAY';
              hours = 0;
            } else {
              // Get display times
              if (checkIns.length > 0) {
                checkInDisplay = checkIns[0].display_check_in || 
                                format(new Date(checkIns[0].timestamp), 'HH:mm');
              }
              
              if (checkOuts.length > 0) {
                checkOutDisplay = checkOuts[0].display_check_out || 
                                 format(new Date(checkOuts[0].timestamp), 'HH:mm');
              }
            }
            
            return {
              'Date': date,
              'Check In': checkInDisplay,
              'Check Out': checkOutDisplay,
              'Shift Type': offDay ? 'OFF-DAY' : (checkIns[0]?.shift_type || 'Unknown'),
              'Hours': hours.toFixed(2),
              'Double-Time': isDoubleTimeDay ? `2× ${hours.toFixed(2)}` : '—',
              'Status': 'Approved'
            };
          });
        
        // Create detailed sheet for this employee
        if (detailedData.length > 0) {
          const detailWs = utils.json_to_sheet(detailedData);
          utils.book_append_sheet(wb, detailWs, 'Details');
        }
      }
    }
    
    // Create double-time days sheet
    const doubleTimeDaysData = doubleDays.map(date => {
      return {
        'Date': date,
        'Type': 'Double-Time Day'
      };
    });
    
    if (doubleTimeDaysData.length > 0) {
      const doubleTimeWs = utils.json_to_sheet(doubleTimeDaysData);
      utils.book_append_sheet(wb, doubleTimeWs, 'Double-Time Days');
    }
    
    // Save the file
    const filename = `Approved_Hours${dateRangeStr}.xlsx`;
    writeFile(wb, filename);
    
    toast.success(`Exported to ${filename}`);
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    toast.error('Failed to export approved hours data');
  }
};

// Function to extract overtime data from approved hours
const extractOvertimeData = (employee: any, workingDays: number): { hours: number, days: number } => {
  const regularHoursPerDay = 9; // Standard hours per day
  const totalRegularHours = workingDays * regularHoursPerDay;
  const actualHours = employee.total_hours || 0;
  
  // Calculate overtime
  const overtimeHours = Math.max(0, actualHours - totalRegularHours);
  const overtimeDays = Math.round((overtimeHours / regularHoursPerDay) * 10) / 10; // Round to 1 decimal
  
  return {
    hours: overtimeHours,
    days: overtimeDays
  };
};

// Preprocess time records to improve accuracy
interface PreprocessedTimeRecord {
  employeeNumber: string;
  name: string;
  department: string;
  timestamp: Date;
  status: 'check_in' | 'check_out';
  isLateNight: boolean;
  originalIndex: number;
}

// Function to detect and fix mislabeled check-ins and check-outs
const fixMislabeledRecords = (
  records: PreprocessedTimeRecord[]
): PreprocessedTimeRecord[] => {
  if (records.length <= 1) return records;
  
  // Sort by timestamp
  const sortedRecords = [...records].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  // Check if sequence alternates properly between check-in and check-out
  let lastStatus: 'check_in' | 'check_out' | null = null;
  let fixedRecords: PreprocessedTimeRecord[] = [];
  
  sortedRecords.forEach(record => {
    const currentRecord = { ...record };
    
    // Skip correction for late night records (likely night shifts)
    if (currentRecord.isLateNight) {
      fixedRecords.push(currentRecord);
      lastStatus = currentRecord.status;
      return;
    }
    
    // Check if sequence is broken
    if (lastStatus === currentRecord.status) {
      // Two check-ins or two check-outs in a row
      // Flip the current status
      currentRecord.status = currentRecord.status === 'check_in' ? 'check_out' : 'check_in';
      currentRecord.mislabeled = true;
      currentRecord.originalStatus = record.status;
      
      console.log(
        `Fixed mislabeled record for ${currentRecord.name}: ` +
        `${format(currentRecord.timestamp, 'MM/dd/yyyy HH:mm:ss')} ` +
        `changed from ${record.status} to ${currentRecord.status}`
      );
    }
    
    fixedRecords.push(currentRecord);
    lastStatus = currentRecord.status;
  });
  
  return fixedRecords;
};

// Function to parse timestamps from Excel data
function parseTimestampFromExcel(dateTimeValue: any): Date | null {
  // Try different parsing strategies
  
  // 1. If it's already a Date object
  if (dateTimeValue instanceof Date) {
    return dateTimeValue;
  }
  
  // 2. If it's an Excel serial number
  if (typeof dateTimeValue === 'number') {
    // Excel serial dates are days since 1/1/1900, but there's a leap year bug
    // So we add the number of days to 1/1/1900 (minus the leap year bug)
    const excelEpoch = new Date(1900, 0, 1);
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    
    // Fix for Excel leap year bug (Excel thinks 1900 is a leap year)
    const dayAdjustment = dateTimeValue > 59 ? 1 : 0;
    const adjustedDays = dateTimeValue - dayAdjustment;
    
    const timestamp = new Date(excelEpoch.getTime() + adjustedDays * millisecondsPerDay);
    return timestamp;
  }
  
  // 3. If it's a string, try various formats
  if (typeof dateTimeValue === 'string') {
    // Try direct parsing
    let timestamp = new Date(dateTimeValue);
    
    // Check if valid
    if (!isNaN(timestamp.getTime())) {
      return timestamp;
    }
    
    // Try parsing common formats
    const formats = [
      'MM/dd/yyyy HH:mm:ss',
      'MM/dd/yyyy HH:mm',
      'yyyy-MM-dd HH:mm:ss',
      'yyyy-MM-dd HH:mm',
      'dd/MM/yyyy HH:mm:ss',
      'dd/MM/yyyy HH:mm'
    ];
    
    for (const formatString of formats) {
      try {
        timestamp = parseISO(dateTimeValue);
        if (!isNaN(timestamp.getTime())) {
          return timestamp;
        }
      } catch {
        // Continue to next format
      }
    }
    
    // Try parsing separate components
    const dateTimeMatch = dateTimeValue.match(
      /(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{1,4})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/
    );
    
    if (dateTimeMatch) {
      const [_, part1, part2, part3, hours, minutes, seconds] = dateTimeMatch;
      let year, month, day;
      
      // Determine date format (MM/DD/YYYY vs. DD/MM/YYYY vs. YYYY-MM-DD)
      if (part1.length === 4) {
        // YYYY-MM-DD
        year = parseInt(part1);
        month = parseInt(part2) - 1;
        day = parseInt(part3);
      } else if (parseInt(part1) > 12) {
        // DD/MM/YYYY (assuming day > 12)
        day = parseInt(part1);
        month = parseInt(part2) - 1;
        year = parseInt(part3);
      } else {
        // MM/DD/YYYY (default)
        month = parseInt(part1) - 1;
        day = parseInt(part2);
        year = parseInt(part3);
      }
      
      timestamp = new Date(
        year,
        month,
        day,
        parseInt(hours),
        parseInt(minutes),
        seconds ? parseInt(seconds) : 0
      );
      
      if (!isNaN(timestamp.getTime())) {
        return timestamp;
      }
    }
  }
  
  // Failed to parse timestamp
  return null;
}

// Function to calculate payable hours for different shift types
function calculatePayableHours(
  checkInTime: Date,
  checkOutTime: Date,
  shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null,
  penaltyMinutes: number = 0
): number {
  // Define standard hours for each shift type
  const shiftHours = {
    morning: 9,
    evening: 9,
    night: 9,
    canteen: 9,
    custom: 8
  };
  
  // Check if we have both check-in and check-out
  if (!checkInTime || !checkOutTime) {
    return 0;
  }
  
  // Calculate actual worked hours
  let actualHours: number;
  
  // Check if checkout is before checkin (overnight shift)
  if (checkOutTime < checkInTime) {
    // Add 24 hours to checkout time for overnight shifts
    const checkOutMs = checkOutTime.getTime() + (24 * 60 * 60 * 1000);
    actualHours = (checkOutMs - checkInTime.getTime()) / (1000 * 60 * 60);
  } else {
    actualHours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
  }
  
  // Apply business rules based on shift type
  let payableHours: number = actualHours;
  
  if (shiftType) {
    const standardHours = shiftHours[shiftType];
    
    // If they worked at least 8 hours, give them the standard shift hours
    if (actualHours >= 8) {
      payableHours = standardHours;
    }
    // Special case for night shifts or if actualHours is excessively high
    else if (actualHours > 10) {
      payableHours = Math.round(actualHours * 2) / 2; // Round to nearest 0.5
    }
  }
  
  // Apply penalty
  if (penaltyMinutes > 0) {
    const penaltyHours = penaltyMinutes / 60;
    payableHours = Math.max(0, payableHours - penaltyHours);
  }
  
  // Round to 2 decimal places
  return Math.round(payableHours * 100) / 100;
}

// Determine if a given timestamp is likely a night shift check-in or check-out
function isNightShiftTime(timestamp: Date): boolean {
  const hour = timestamp.getHours();
  
  // Night shift is typically 9PM-6AM
  return hour >= 21 || hour <= 6;
}

// Process a list of time records to find potential night shifts
function findNightShifts(timeRecords: any[]): {checkIn: any, checkOut: any}[] {
  const result: {checkIn: any, checkOut: any}[] = [];
  
  // Sort by timestamp
  const sortedRecords = [...timeRecords].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  // Group by day
  const recordsByDay: Record<string, any[]> = {};
  sortedRecords.forEach(record => {
    const day = format(new Date(record.timestamp), 'yyyy-MM-dd');
    if (!recordsByDay[day]) {
      recordsByDay[day] = [];
    }
    recordsByDay[day].push(record);
  });
  
  // Look for night shifts spanning two days
  Object.entries(recordsByDay).forEach(([day, dayRecords]) => {
    // Look for check-ins in the evening
    const eveningCheckIns = dayRecords.filter(r => 
      r.status === 'check_in' && 
      new Date(r.timestamp).getHours() >= 20
    );
    
    if (eveningCheckIns.length > 0) {
      // For each evening check-in, look for a morning check-out the next day
      const nextDay = format(
        new Date(new Date(day).getTime() + 24 * 60 * 60 * 1000),
        'yyyy-MM-dd'
      );
      
      if (recordsByDay[nextDay]) {
        const morningCheckOuts = recordsByDay[nextDay].filter(r => 
          r.status === 'check_out' && 
          new Date(r.timestamp).getHours() <= 10
        );
        
        if (morningCheckOuts.length > 0) {
          // Pair them up
          eveningCheckIns.forEach(checkIn => {
            morningCheckOuts.forEach(checkOut => {
              result.push({checkIn, checkOut});
            });
          });
        }
      }
    }
  });
  
  return result;
}

// Handle time records that are incorrectly labeled (check-in vs check-out)
function fixMislabeledCheckInOut(timeRecords: any[]): any[] {
  if (timeRecords.length <= 1) return timeRecords;
  
  // Clone the array to avoid modifying the original
  const records = [...timeRecords];
  
  // Sort by timestamp
  records.sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  let lastStatus = '';
  for (let i = 0; i < records.length; i++) {
    if (i > 0 && records[i].status === lastStatus) {
      // Found a duplicate status (e.g., two check-ins in a row)
      // Check if this is a night shift scenario
      const currTimestamp = new Date(records[i].timestamp);
      const prevTimestamp = new Date(records[i-1].timestamp);
      
      // If it's morning (5-10 AM) followed by evening (1-10 PM), don't fix
      if (
        (prevTimestamp.getHours() >= 5 && prevTimestamp.getHours() <= 10) &&
        (currTimestamp.getHours() >= 13 && currTimestamp.getHours() <= 22)
      ) {
        // This looks like a normal morning shift followed by evening shift
        // Don't fix this
      } 
      // If night shift hours, consider specially
      else if (isNightShiftTime(currTimestamp) || isNightShiftTime(prevTimestamp)) {
        // Special handling for night shifts
        const hourDiff = Math.abs(currTimestamp.getHours() - prevTimestamp.getHours());
        
        if (hourDiff > 8) {
          // Likely a night shift spanning midnight, don't fix
        } else {
          // Fix the label
          records[i].status = records[i].status === 'check_in' ? 'check_out' : 'check_in';
          records[i].mislabeled = true;
          records[i].originalStatus = records[i].status === 'check_in' ? 'check_out' : 'check_in';
        }
      } else {
        // Normal fix for duplicate statuses
        records[i].status = records[i].status === 'check_in' ? 'check_out' : 'check_in';
        records[i].mislabeled = true;
        records[i].originalStatus = records[i].status === 'check_in' ? 'check_out' : 'check_in';
      }
    }
    
    lastStatus = records[i].status;
  }
  
  return records;
}

// Calculate a default shift type based on check-in time
function defaultShiftType(checkIn: Date): string {
  const hour = checkIn.getHours();
  
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 20) return 'evening';
  return 'night'; // 8pm-5am
}