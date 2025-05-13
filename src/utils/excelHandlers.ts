import * as XLSX from 'xlsx';
import { format, isFriday, parseISO } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';

// Export face ID data to Excel
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  try {
    // Create a workbook
    const wb = XLSX.utils.book_new();

    // Process data for the summary sheet
    const summaryData = employeeRecords.map(employee => {
      // Calculate total hours
      const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
      
      // Calculate days with penalties
      const daysWithPenalty = employee.days.filter(day => day.penaltyMinutes > 0).length;
      
      // Calculate late days
      const lateDays = employee.days.filter(day => day.isLate).length;
      
      // Calculate early leave days
      const earlyLeaveDays = employee.days.filter(day => day.earlyLeave).length;
      
      // Calculate approved days
      const approvedDays = employee.days.filter(day => day.approved).length;
      
      // Calculate missing records
      const missingRecordDays = employee.days.filter(day => 
        (day.missingCheckIn || day.missingCheckOut) && day.notes !== 'OFF-DAY'
      ).length;

      return {
        'Employee Number': employee.employeeNumber,
        'Name': employee.name,
        'Department': employee.department,
        'Total Days': employee.totalDays,
        'Total Hours': totalHours.toFixed(2),
        'Approved Days': approvedDays,
        'Late Days': lateDays,
        'Early Leave Days': earlyLeaveDays,
        'Days With Penalty': daysWithPenalty,
        'Missing Records': missingRecordDays
      };
    });

    // Create the summary sheet
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // Process data for the detailed sheet
    const detailedData: any[] = [];

    employeeRecords.forEach(employee => {
      employee.days.forEach(day => {
        detailedData.push({
          'Employee Number': employee.employeeNumber,
          'Name': employee.name,
          'Date': day.date,
          'Check-In': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
          'Check-Out': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing',
          'Hours': day.hoursWorked.toFixed(2),
          'Shift Type': day.shiftType,
          'Is Late': day.isLate ? 'Yes' : 'No',
          'Early Leave': day.earlyLeave ? 'Yes' : 'No',
          'Penalty Minutes': day.penaltyMinutes,
          'Notes': day.notes,
          'Approved': day.approved ? 'Yes' : 'No'
        });
      });
    });

    // Create the detailed sheet
    const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
    XLSX.utils.book_append_sheet(wb, detailedSheet, 'Details');

    // Generate and download the file
    XLSX.writeFile(wb, `Face_ID_Data_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Failed to export data. Please try again.');
  }
};

// Export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any): void => {
  try {
    // Create a workbook
    const wb = XLSX.utils.book_new();

    // Extract data
    const { summary, details, filterMonth, doubleDays = [] } = data;
    
    // Prepare summary data with the new required fields
    const summaryData = summary.map((employee: any) => {
      // Calculate total days worked
      const totalWorkingDays = employee.total_days || 0;
      
      // Calculate Fridays worked
      const fridaysWorked = (employee.working_week_dates || []).filter((date: string) => {
        const dateObj = new Date(date);
        return isFriday(dateObj);
      }).length;
      
      // Calculate holidays worked (excluding Fridays to avoid double counting)
      const holidaysWorked = (employee.working_week_dates || []).filter((date: string) => {
        const dateObj = new Date(date);
        return !isFriday(dateObj) && doubleDays.includes(date);
      }).length;
      
      // Calculate overtime hours and days
      let overtimeHours = 0;
      
      // Iterate through days to find overtime
      if (employee.working_week_dates && employee.hours_by_date) {
        employee.working_week_dates.forEach((date: string) => {
          const dayHours = employee.hours_by_date[date] || 0;
          if (dayHours > 9) {
            overtimeHours += (dayHours - 9);
          }
        });
      }
      
      const overtimeDays = overtimeHours / 9;
      
      // Calculate regular hours (total minus double time)
      const regularHours = employee.total_hours || 0;
      
      // Calculate double-time hours
      const doubleTimeHours = employee.double_time_hours || 0;
      
      // Calculate total payable hours (regular + double time)
      const totalPayableHours = regularHours + doubleTimeHours;

      return {
        'Employee Number': employee.employee_number,
        'Name': employee.name,
        'Total Working Days': totalWorkingDays,
        'Total Hours': regularHours.toFixed(2),
        'Fridays Worked (Days)': fridaysWorked,
        'Holidays Worked (Days)': holidaysWorked,
        'Total Double-Time Days': fridaysWorked + holidaysWorked,
        'Double-Time Hours': doubleTimeHours.toFixed(2),
        'Overtime Hours': overtimeHours.toFixed(2),
        'Overtime Days': overtimeDays.toFixed(2),
        'Total Payable Hours': totalPayableHours.toFixed(2),
        'Average Hours/Day': ((totalWorkingDays > 0) ? (regularHours / totalWorkingDays) : 0).toFixed(2)
      };
    });

    // Create the summary sheet
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    // Process data for the detailed sheet
    const detailedData: any[] = [];

    if (details && details.length > 0) {
      details.forEach((record: any) => {
        // Get the status (check-in or check-out or off-day)
        const status = record.status || 'unknown';
        
        // Get the date
        const date = record.timestamp ? format(new Date(record.timestamp), 'yyyy-MM-dd') : 
                     record.working_week_start || '';
        
        // Check if this is a Friday
        const isFridayWorked = date ? isFriday(new Date(date)) : false;
        
        // Check if this is a holiday (excluding Fridays to avoid double counting)
        const isHolidayWorked = !isFridayWorked && doubleDays.includes(date);
        
        // Calculate overtime if hours > 9
        const hours = parseFloat(record.exact_hours || '0');
        const overtimeHours = Math.max(0, hours - 9);
        const overtimeDays = overtimeHours / 9;

        detailedData.push({
          'Employee Number': record.employees?.employee_number || '',
          'Name': record.employees?.name || '',
          'Date': date,
          'Shift Type': record.shift_type || '',
          'Status': status,
          'Check-In': record.display_check_in || 'Missing',
          'Check-Out': record.display_check_out || 'Missing',
          'Hours': hours.toFixed(2),
          'Is Friday': isFridayWorked ? 'Yes' : 'No',
          'Is Holiday': isHolidayWorked ? 'Yes' : 'No',
          'Is Double-Time': (isFridayWorked || isHolidayWorked) ? 'Yes' : 'No',
          'Overtime Hours': overtimeHours.toFixed(2),
          'Notes': record.notes || ''
        });
      });
    }

    // Create the detailed sheet
    const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
    XLSX.utils.book_append_sheet(wb, detailedSheet, 'Details');
    
    // Create a Double-Time Days sheet
    const doubleTimeDaysData = doubleDays.map((date: string) => {
      const dateObj = new Date(date);
      return {
        'Date': date,
        'Day': format(dateObj, 'EEEE'),
        'Is Friday': isFriday(dateObj) ? 'Yes' : 'No',
        'Is Holiday': !isFriday(dateObj) ? 'Yes' : 'No'
      };
    });
    
    const doubleTimeDaysSheet = XLSX.utils.json_to_sheet(doubleTimeDaysData);
    XLSX.utils.book_append_sheet(wb, doubleTimeDaysSheet, 'Double-Time Days');

    // Generate and download the file
    const monthLabel = filterMonth && filterMonth !== 'all' 
      ? format(new Date(filterMonth + '-01'), 'MMM_yyyy')
      : 'All_Time';
    
    XLSX.writeFile(wb, `Approved_Hours_${monthLabel}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Failed to export data. Please try again.');
  }
};

// Function to handle Excel file processing for the time clock data
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get the first sheet name
        const sheetName = workbook.SheetNames[0];
        
        // Get the worksheet
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];
        
        // Process the data into the required format
        const processedData = processFaceIDData(jsonData);
        
        resolve(processedData);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file. Please check the format.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file. Please try again.'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Function to process Face ID data from Excel into EmployeeRecord[]
const processFaceIDData = (data: any[]): EmployeeRecord[] => {
  // Implementation of processing logic
  // This is a placeholder - the actual implementation would depend on your data structure
  
  // Map to store employees by employee number
  const employeeMap: Map<string, EmployeeRecord> = new Map();
  
  // Process each row in the Excel data
  data.forEach((row, index) => {
    // Extract department, name, employee number, timestamp, and status
    // The exact field names will depend on your Excel structure
    const department = row.Department || '';
    const name = row.Name || '';
    const employeeNumber = String(row['Employee No'] || '').trim();
    const timestamp = parseTimestamp(row.Time || row.Timestamp || row.DateTime);
    const status = determineStatus(row.Status || '');
    
    if (!timestamp || !employeeNumber || !name) {
      console.warn(`Skipping row ${index + 1} due to missing data`);
      return;
    }
    
    // Get or create employee record
    let employee = employeeMap.get(employeeNumber);
    if (!employee) {
      employee = {
        employeeNumber,
        name,
        department,
        days: [],
        totalDays: 0,
        expanded: false
      };
      employeeMap.set(employeeNumber, employee);
    }
    
    // Process the timestamp into the appropriate day record
    processTimeRecord(employee, timestamp, status, index);
  });
  
  // Format the results and count the total days
  const results = Array.from(employeeMap.values());
  results.forEach(emp => {
    // Sort days chronologically
    emp.days.sort((a, b) => a.date.localeCompare(b.date));
    
    // Count total days
    emp.totalDays = emp.days.length;
  });
  
  return results;
};

// Helper function to parse timestamps from Excel
const parseTimestamp = (timestampStr: any): Date | null => {
  if (!timestampStr) return null;
  
  // Handle numeric Excel date values
  if (typeof timestampStr === 'number') {
    return new Date((timestampStr - 25569) * 86400 * 1000);
  }
  
  try {
    const date = new Date(timestampStr);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    return date;
  } catch (e) {
    console.error('Error parsing timestamp:', timestampStr, e);
    return null;
  }
};

// Helper function to determine the status (check-in or check-out)
const determineStatus = (statusStr: string): 'check_in' | 'check_out' => {
  const lowerStatus = statusStr.toLowerCase();
  
  if (lowerStatus.includes('in') || lowerStatus.includes('entry')) {
    return 'check_in';
  }
  
  return 'check_out'; // Default to check-out
};

// Helper function to process a time record into an employee's days
const processTimeRecord = (
  employee: EmployeeRecord, 
  timestamp: Date, 
  status: 'check_in' | 'check_out',
  originalIndex: number
): void => {
  // Implementation depends on your specific business logic
  // This is a placeholder function
  
  // Format date as YYYY-MM-DD for grouping
  const dateStr = format(timestamp, 'yyyy-MM-dd');
  
  // Find or create day record
  let dayRecord = employee.days.find(day => day.date === dateStr);
  
  if (!dayRecord) {
    dayRecord = {
      date: dateStr,
      firstCheckIn: null,
      lastCheckOut: null,
      hoursWorked: 0,
      approved: false,
      shiftType: null,
      notes: '',
      missingCheckIn: true,
      missingCheckOut: true,
      isLate: false,
      earlyLeave: false,
      excessiveOvertime: false,
      penaltyMinutes: 0,
      
      // Store all time records for this date
      allTimeRecords: [],
      hasMultipleRecords: false
    };
    employee.days.push(dayRecord);
  }
  
  // Add to all time records
  if (!dayRecord.allTimeRecords) {
    dayRecord.allTimeRecords = [];
  }
  
  dayRecord.allTimeRecords.push({
    department: employee.department,
    name: employee.name,
    employeeNumber: employee.employeeNumber,
    timestamp,
    status,
    originalIndex
  });
  
  dayRecord.hasMultipleRecords = dayRecord.allTimeRecords.length > 1;
  
  // Update the appropriate time based on status
  if (status === 'check_in') {
    if (!dayRecord.firstCheckIn || timestamp < dayRecord.firstCheckIn) {
      dayRecord.firstCheckIn = timestamp;
      dayRecord.missingCheckIn = false;
    }
  } else { // check_out
    if (!dayRecord.lastCheckOut || timestamp > dayRecord.lastCheckOut) {
      dayRecord.lastCheckOut = timestamp;
      dayRecord.missingCheckOut = false;
    }
  }
};

// Function to parse dates in different formats
const tryParseDate = (dateStr: string): Date | null => {
  const formats = [
    'yyyy-MM-dd',
    'MM/dd/yyyy',
    'MM-dd-yyyy',
    'yyyy/MM/dd',
    'd-MMM-yyyy',
  ];
  
  for (const fmt of formats) {
    try {
      const date = parse(dateStr, fmt, new Date());
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch (e) {
      // Try next format
    }
  }
  
  try {
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch (e) {
    // Last resort failed
  }
  
  return null;
};