import * as XLSX from 'xlsx';
import { parse, format, isFriday } from 'date-fns';
import { EmployeeRecord, DailyRecord, TimeRecord } from '../types';
import { formatTimeWith24Hour, formatTime24H } from './dateTimeHelper';

/**
 * Process an Excel file from Face ID system and extract check-in/check-out records.
 * @param file The uploaded Excel file
 * @returns Array of processed employee records
 */
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!e.target?.result) {
          reject(new Error('Failed to read file'));
          return;
        }

        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        
        // Get the first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }
        
        // Extract and normalize the time records
        const timeRecords = extractTimeRecords(jsonData);
        console.log(`Extracted ${timeRecords.length} time records from Excel`);
        
        // Group the time records by employee
        const employeeRecords = processTimeRecords(timeRecords);
        console.log(`Processed into ${employeeRecords.length} employee records`);
        
        resolve(employeeRecords);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file. Please check the format.'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Extract time records from the Excel JSON data
 */
const extractTimeRecords = (jsonData: any[]): TimeRecord[] => {
  const timeRecords: TimeRecord[] = [];
  
  // Iterate through each row in the Excel file
  jsonData.forEach((row, index) => {
    // Extract fields from the row - field names may vary, so we check multiple possibilities
    const department = row.Department || row.department || row.DEPARTMENT || '';
    const name = row.Name || row.name || row.NAME || row.Employee || row['Employee Name'] || '';
    const employeeNumber = String(row['Employee No'] || row.employeeNumber || row['Employee Number'] || row['Employee NO'] || row['employee_number'] || row.ID || '').trim();
    
    // Handle various date/time formats
    let timestamp = null;
    
    // Try different field names for the timestamp
    const possibleTimestampFields = [
      'Date & Time', 'Date/Time', 'DateTime', 'Time', 'Timestamp', 
      'Check Time', 'CheckTime', 'Clock'
    ];
    
    for (const field of possibleTimestampFields) {
      if (row[field]) {
        // If it's already a Date object (from cellDates: true)
        if (row[field] instanceof Date) {
          timestamp = row[field];
          break;
        }
        
        // Try to parse as date string
        try {
          const parsedDate = new Date(row[field]);
          if (!isNaN(parsedDate.getTime())) {
            timestamp = parsedDate;
            break;
          }
        } catch (e) {
          // Continue to next field if parsing fails
        }
      }
    }
    
    // Skip row if we couldn't find a valid timestamp
    if (!timestamp) {
      console.warn(`Skipping row ${index + 2} due to missing or invalid timestamp`);
      return;
    }
    
    // Determine status (check-in or check-out)
    let status: 'check_in' | 'check_out' = 'check_in'; // Default to check-in
    
    // Check various possible field names for status
    const possibleStatusFields = [
      'Status', 'status', 'STATE', 'State', 'Event', 'event',
      'Check Type', 'CheckType', 'Type', 'type', 'C/In-Out'
    ];
    
    for (const field of possibleStatusFields) {
      if (row[field] !== undefined) {
        const statusValue = String(row[field]).trim().toLowerCase();
        
        // Check for check-in variants
        if (statusValue === 'check in' || statusValue === 'checkin' || 
            statusValue === 'in' || statusValue === 'i' || 
            statusValue === 'c/in' || statusValue === 'cin') {
          status = 'check_in';
          break;
        }
        // Check for check-out variants
        else if (statusValue === 'check out' || statusValue === 'checkout' || 
                 statusValue === 'out' || statusValue === 'o' || 
                 statusValue === 'c/out' || statusValue === 'cout') {
          status = 'check_out';
          break;
        }
      }
    }
    
    // Create and add the time record
    timeRecords.push({
      department,
      name,
      employeeNumber,
      timestamp,
      status,
      originalIndex: index // Track original position in the Excel file
    });
  });
  
  // Sort records by employee number, then by timestamp
  timeRecords.sort((a, b) => {
    if (a.employeeNumber !== b.employeeNumber) {
      return a.employeeNumber.localeCompare(b.employeeNumber);
    }
    return a.timestamp.getTime() - b.timestamp.getTime();
  });
  
  return timeRecords;
};

/**
 * Process time records into employee records with daily check-in/check-out pairs
 */
const processTimeRecords = (timeRecords: TimeRecord[]): EmployeeRecord[] => {
  // Group records by employee
  const employeeMap = new Map<string, {
    name: string;
    department: string;
    records: TimeRecord[];
  }>();
  
  // First pass: group all records by employee
  timeRecords.forEach(record => {
    // Skip if employee number is empty
    if (!record.employeeNumber) return;
    
    if (!employeeMap.has(record.employeeNumber)) {
      employeeMap.set(record.employeeNumber, {
        name: record.name,
        department: record.department,
        records: []
      });
    }
    
    employeeMap.get(record.employeeNumber)!.records.push(record);
  });
  
  // Second pass: process each employee's records into daily records
  const employeeRecords: EmployeeRecord[] = [];
  
  employeeMap.forEach((employee, employeeNumber) => {
    // Group records by date
    const dateMap = new Map<string, TimeRecord[]>();
    
    // Group all records by date
    employee.records.forEach(record => {
      const date = format(record.timestamp, 'yyyy-MM-dd');
      if (!dateMap.has(date)) {
        dateMap.set(date, []);
      }
      dateMap.get(date)!.push(record);
    });
    
    // Process each date's records for this employee
    const dailyRecords: DailyRecord[] = [];
    
    dateMap.forEach((records, date) => {
      // Sort records by timestamp (ascending)
      records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      // Mark records with their original data for reference
      records.forEach(record => {
        record.originalStatus = record.status;
        record.mislabeled = false;
        record.processed = false;
      });
      
      // Try to find a valid check-in/check-out pair
      let firstCheckIn: Date | null = null;
      let lastCheckOut: Date | null = null;
      let shiftType = null;
      let isLate = false;
      let earlyLeave = false;
      let excessiveOvertime = false;
      let notes = '';
      let missingCheckIn = false;
      let missingCheckOut = false;
      
      // Track raw time records
      const allTimeRecords = [...records]; // Store all records for this date
      
      // For simplicity in this minimal implementation, just take the first check-in and last check-out
      const checkIns = records.filter(r => r.status === 'check_in');
      const checkOuts = records.filter(r => r.status === 'check_out');
      
      if (checkIns.length > 0) {
        firstCheckIn = checkIns[0].timestamp;
      } else {
        missingCheckIn = true;
      }
      
      if (checkOuts.length > 0) {
        // Get the last check-out
        lastCheckOut = checkOuts[checkOuts.length - 1].timestamp;
      } else {
        missingCheckOut = true;
      }
      
      // Calculate hours worked (placeholder for more sophisticated calculation)
      let hoursWorked = 0;
      if (firstCheckIn && lastCheckOut) {
        // Simple hours calculation (actual business logic would be more complex)
        const diffMs = lastCheckOut.getTime() - firstCheckIn.getTime();
        
        // Check for negative diff (might indicate overnight shift)
        if (diffMs < 0) {
          // If check-out is before check-in, assume it's next day
          const adjustedCheckOut = new Date(lastCheckOut.getTime() + 24 * 60 * 60 * 1000);
          const adjustedDiffMs = adjustedCheckOut.getTime() - firstCheckIn.getTime();
          hoursWorked = adjustedDiffMs / (1000 * 60 * 60);
        } else {
          hoursWorked = diffMs / (1000 * 60 * 60);
        }
        
        // Round to 2 decimal places
        hoursWorked = parseFloat(hoursWorked.toFixed(2));
      }
      
      dailyRecords.push({
        date,
        firstCheckIn,
        lastCheckOut,
        hoursWorked,
        approved: false, // Requires HR approval
        shiftType,
        notes,
        missingCheckIn,
        missingCheckOut,
        isLate,
        earlyLeave,
        excessiveOvertime,
        penaltyMinutes: 0, // Default to no penalty
        allTimeRecords, // Store all raw records
        hasMultipleRecords: records.length > 2 // Flag if there are unexpected additional records
      });
    });
    
    // Add the employee record if they have any daily records
    if (dailyRecords.length > 0) {
      employeeRecords.push({
        employeeNumber,
        name: employee.name,
        department: employee.department,
        days: dailyRecords,
        totalDays: dailyRecords.length,
        expanded: false // Initially collapsed in the UI
      });
    }
  });
  
  return employeeRecords;
};

/**
 * Export processed data to Excel file
 */
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Create a worksheet for each employee
  employeeRecords.forEach(employee => {
    const data = [
      ['Date', 'Check In', 'Check Out', 'Hours Worked', 'Shift Type', 'Status', 'Notes', 'Penalty']
    ];
    
    // Add rows for each day
    employee.days.forEach(day => {
      data.push([
        day.date,
        day.firstCheckIn ? formatTimeWith24Hour(day.firstCheckIn) : 'Missing',
        day.lastCheckOut ? formatTimeWith24Hour(day.lastCheckOut) : 'Missing',
        day.hoursWorked.toFixed(2),
        day.shiftType || 'Unknown',
        day.approved ? 'Approved' : 'Pending',
        day.notes,
        day.penaltyMinutes > 0 ? (day.penaltyMinutes / 60).toFixed(2) + ' hr' : 'None'
      ]);
    });
    
    // Create worksheet and add to workbook
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, employee.name.substring(0, 30)); // Limit sheet name to 30 chars
  });
  
  // Create summary sheet
  const summaryData = [
    ['Employee Number', 'Name', 'Department', 'Total Days', 'Total Hours']
  ];
  
  employeeRecords.forEach(employee => {
    const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
    summaryData.push([
      employee.employeeNumber,
      employee.name,
      employee.department,
      employee.totalDays.toString(),
      totalHours.toFixed(2)
    ]);
  });
  
  // Add summary worksheet
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  
  // Export to file
  const date = format(new Date(), 'yyyy-MM-dd');
  XLSX.writeFile(wb, `Employee_Hours_${date}.xlsx`);
};

/**
 * Export approved hours data to Excel file
 */
export const exportApprovedHoursToExcel = (exportData: any): void => {
  const { summary, details, filterMonth, dateRange } = exportData;
  const doubleDays = exportData.doubleDays || [];
  
  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Create a worksheet for summary information
  const summaryData: any[][] = [
    [
      'Employee Number', 'Name', 'Total Days', 'Regular Hours', 'Double-Time Hours',
      'Fridays Worked', 'Overtime Hours', 'Overtime Days', 'Total Payable Hours',
      'Off-Days (Days)', 'Holidays Worked (Days)'
    ]
  ];
  
  summary.forEach((emp: any) => {
    // Calculate various metrics
    const totalRegularHours = emp.total_hours || 0;
    const doubleTimeHours = emp.double_time_hours || 0;
    const totalPayableHours = totalRegularHours + doubleTimeHours;
    
    // Calculate overtime
    const overtimeHours = totalRegularHours > emp.total_days * 9 ? (totalRegularHours - emp.total_days * 9) : 0;
    const overtimeDays = overtimeHours > 0 ? Math.ceil(overtimeHours / 9) : 0;
    
    // Count Fridays worked
    const fridaysWorked = emp.fridaysWorked || 0;
    
    // Add row for this employee
    summaryData.push([
      emp.employee_number,
      emp.name,
      emp.total_days,
      totalRegularHours.toFixed(2),
      doubleTimeHours.toFixed(2),
      fridaysWorked,
      overtimeHours.toFixed(2),
      overtimeDays.toFixed(2),
      totalPayableHours.toFixed(2),
      emp.offDays || 0,
      emp.holidaysWorked || 0
    ]);
  });
  
  // Add stats row with totals
  const statsData: any[][] = [];
  
  // Calculate totals for stats
  let totalEmployees = summary.length;
  let totalDays = 0;
  let totalRegularHours = 0;
  let totalDoubleTimeHours = 0;
  let totalFridaysWorked = 0;
  let totalOvertimeHours = 0;
  let totalOvertimeDays = 0;
  let totalPayableHours = 0;
  let totalOffDays = 0;
  let totalHolidaysWorked = 0;
  
  // Process each row (starting from index 1 to skip header)
  for (let i = 1; i < summaryData.length; i++) {
    totalDays += parseFloat(summaryData[i][2]) || 0;
    totalRegularHours += parseFloat(summaryData[i][3]) || 0;
    totalDoubleTimeHours += parseFloat(summaryData[i][4]) || 0;
    totalFridaysWorked += parseFloat(summaryData[i][5]) || 0;
    totalOvertimeHours += parseFloat(summaryData[i][6]) || 0;
    totalOvertimeDays += parseFloat(summaryData[i][7]) || 0;
    totalPayableHours += parseFloat(summaryData[i][8]) || 0;
    totalOffDays += parseFloat(summaryData[i][9]) || 0;
    totalHolidaysWorked += parseFloat(summaryData[i][10]) || 0;
  }
  
  // Add stats to the separate stats worksheet
  statsData.push(['Total Employees', totalEmployees]);
  statsData.push(['Total Days Worked', totalDays]);
  statsData.push(['Total Regular Hours', totalRegularHours.toFixed(2)]);
  statsData.push(['Total Double-Time Hours', totalDoubleTimeHours.toFixed(2)]);
  statsData.push(['Total Fridays Worked', totalFridaysWorked]);
  statsData.push(['Total Overtime Hours', totalOvertimeHours.toFixed(2)]);
  statsData.push(['Total Overtime Days', totalOvertimeDays.toFixed(2)]);
  statsData.push(['Total Payable Hours', totalPayableHours.toFixed(2)]);
  
  // Add filter period information
  if (filterMonth === "all") {
    statsData.push(['Filter Period', 'All Time']);
  } else if (filterMonth === "custom" && dateRange) {
    statsData.push(['Filter Period', `${dateRange.startDate} to ${dateRange.endDate}`]);
  } else if (filterMonth) {
    const [year, month] = filterMonth.split('-');
    statsData.push(['Filter Period', `${year}/${month}`]);
  }
  
  // Add new stats for Off-Days and Holidays Worked
  statsData.push(['Total Off-Days (Days)', totalOffDays]);
  statsData.push(['Total Holidays Worked (Days)', totalHolidaysWorked]);
  
  // Add metadata for double-time days
  if (doubleDays && doubleDays.length > 0) {
    statsData.push(['']);
    statsData.push(['Double-Time Days', 'Type']);
    
    doubleDays.forEach((day: string) => {
      try {
        const date = parse(day, 'yyyy-MM-dd', new Date());
        const isFri = isFriday(date);
        statsData.push([day, isFri ? 'Friday' : 'Holiday']);
      } catch (e) {
        statsData.push([day, 'Unknown']);
      }
    });
  }
  
  // Create worksheets and add to workbook
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  const statsWs = XLSX.utils.aoa_to_sheet(statsData);
  
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Employee Summary');
  XLSX.utils.book_append_sheet(wb, statsWs, 'Statistics');
  
  // If we have detailed daily records for employees, add them as separate sheets
  if (details && details.length > 0) {
    // We might be showing details for just one employee
    const detailedEmployee = summary.find((emp: any) => emp.id === details[0].employee_id);
    
    if (detailedEmployee) {
      // Create a detailed worksheet for this employee
      const detailData = [
        ['Date', 'Check In', 'Check Out', 'Shift Type', 'Hours', 'Double-Time', 'Status', 'Notes']
      ];
      
      // Group records by date for better display
      const recordsByDate = details.reduce((acc: any, record: any) => {
        // FIXED: Always use working_week_start as the key for grouping
        let dateKey = record.working_week_start || '';
        
        // If working_week_start is not available, extract from timestamp
        if (!dateKey) {
          // Use the UTC date portion so nothing shifts under local timezones
          const utc = parseISO(record.timestamp);
          dateKey = utc.toISOString().slice(0,10);  // "YYYY-MM-DD"
        }

        if (!acc[dateKey]) {
          acc[dateKey] = [];
        }
        acc[dateKey].push(record);
        return acc;
      }, {});
      
      // Process each date's records
      Object.entries(recordsByDate).forEach(([date, dayRecords]: [string, any]) => {
        // Group by shift type within each date
        const recordsByShiftType: Record<string, any[]> = {};
        
        dayRecords.forEach((record: any) => {
          const shiftType = record.shift_type || 'unknown';
          if (!recordsByShiftType[shiftType]) {
            recordsByShiftType[shiftType] = [];
          }
          recordsByShiftType[shiftType].push(record);
        });
        
        // Process each shift type
        Object.entries(recordsByShiftType).forEach(([shiftType, shiftRecords]: [string, any]) => {
          // Handle off-days
          if (shiftType === 'off_day' || shiftRecords.some((r: any) => r.status === 'off_day')) {
            detailData.push([
              date, 
              'OFF-DAY', 
              'OFF-DAY', 
              'OFF-DAY', 
              '0.00',
              doubleDays.includes(date) ? (isFriday(parseISO(date)) ? 'Friday' : 'Holiday') : '-',
              'Approved', 
              'OFF-DAY'
            ]);
            return;
          }
          
          // Find check-in and check-out records
          const checkIns = shiftRecords.filter((r: any) => r.status === 'check_in');
          const checkOuts = shiftRecords.filter((r: any) => r.status === 'check_out');
          
          // Get the earliest check-in and latest check-out
          let checkIn = checkIns.length > 0 ? 
            checkIns.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0] : null;
            
          let checkOut = checkOuts.length > 0 ? 
            checkOuts.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] : null;
            
          // Format time with display values if available
          const checkInTime = checkIn ? 
            (checkIn.display_check_in !== 'Missing' ? checkIn.display_check_in : formatTime24H(new Date(checkIn.timestamp))) : 'Missing';
            
          const checkOutTime = checkOut ? 
            (checkOut.display_check_out !== 'Missing' ? checkOut.display_check_out : formatTime24H(new Date(checkOut.timestamp))) : 'Missing';
          
          // Calculate hours - use exact_hours from the record
          const hours = checkIn?.exact_hours || checkOut?.exact_hours || 0;
          
          // Check if this is a double-time day
          const isDoubleTimeDay = doubleDays.includes(date);
          
          // Add a row for this shift
          detailData.push([
            date,
            checkInTime,
            checkOutTime,
            shiftType.charAt(0).toUpperCase() + shiftType.slice(1),
            hours.toFixed(2),
            isDoubleTimeDay ? (isFriday(parseISO(date)) ? 'Friday' : 'Holiday') : '-',
            'Approved',
            checkIn?.notes || checkOut?.notes || ''
          ]);
        });
      });
      
      // Create worksheet for detailed employee records
      const detailWs = XLSX.utils.aoa_to_sheet(detailData);
      XLSX.utils.book_append_sheet(wb, detailWs, `${detailedEmployee.name.substring(0, 25)} Details`);
    }
  }
  
  // Export to file
  const date = format(new Date(), 'yyyy-MM-dd');
  const periodStr = filterMonth === "all" ? "All_Time" : 
                    filterMonth === "custom" ? `${dateRange?.startDate.replace(/-/g, '')}_to_${dateRange?.endDate.replace(/-/g, '')}` :
                    filterMonth;
  
  XLSX.writeFile(wb, `Approved_Hours_${periodStr}_${date}.xlsx`);
};