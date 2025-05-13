import * as XLSX from 'xlsx';
import { format, isFriday, parseISO, parse } from 'date-fns';
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
        console.log("Starting to process Excel file...");
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        console.log("File read as array buffer, parsing with XLSX...");
        
        // Try to read the workbook with different options if the default fails
        let workbook;
        try {
          workbook = XLSX.read(data, { type: 'array' });
        } catch (readError) {
          console.error("Error with default reading, trying with different options:", readError);
          // Try with different options
          workbook = XLSX.read(data, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' });
        }
        
        console.log("Workbook parsed, sheets:", workbook.SheetNames);
        
        // Get the first sheet name
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          throw new Error("No sheets found in the workbook");
        }
        
        // Get the worksheet
        const worksheet = workbook.Sheets[sheetName];
        console.log("Got worksheet:", sheetName);
        
        // Convert to JSON with different options
        let jsonData;
        try {
          // Try with dates enabled
          jsonData = XLSX.utils.sheet_to_json(worksheet, { raw: false, dateNF: 'yyyy-mm-dd' });
        } catch (jsonError) {
          console.error("Error converting to JSON with dates, trying without:", jsonError);
          // Fall back to basic conversion
          jsonData = XLSX.utils.sheet_to_json(worksheet);
        }
        
        console.log("Converted to JSON, row count:", jsonData.length);
        console.log("First row sample:", jsonData.length > 0 ? jsonData[0] : "No data");
        
        // Process the data into the required format
        console.log("Processing Face ID data...");
        const processedData = processFaceIDData(jsonData);
        console.log("Processing complete, employee count:", processedData.length);
        
        resolve(processedData);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file. Please check the format.'));
      }
    };
    
    reader.onerror = (error) => {
      console.error('FileReader error:', error);
      reject(new Error('Failed to read file. Please try again.'));
    };
    
    console.log("Starting to read file as array buffer...");
    reader.readAsArrayBuffer(file);
  });
};

// Function to process Face ID data from Excel into EmployeeRecord[]
const processFaceIDData = (data: any[]): EmployeeRecord[] => {
  if (!Array.isArray(data) || data.length === 0) {
    console.error("Invalid or empty data array:", data);
    throw new Error("No valid data found in the Excel file");
  }
  
  console.log("Processing", data.length, "rows of data");
  
  // Detect column names from the first row to make it more flexible
  const firstRow = data[0];
  const columnMap = detectColumnNames(firstRow);
  
  console.log("Detected column mapping:", columnMap);
  
  // Map to store employees by employee number
  const employeeMap: Map<string, EmployeeRecord> = new Map();
  
  // Process each row in the Excel data
  data.forEach((row, index) => {
    try {
      // Extract data using the detected column names
      const department = getValueByPossibleKeys(row, columnMap.department) || '';
      const name = getValueByPossibleKeys(row, columnMap.name) || '';
      const employeeNumberRaw = getValueByPossibleKeys(row, columnMap.employeeNumber);
      const employeeNumber = String(employeeNumberRaw || '').trim();
      
      const timestampRaw = getValueByPossibleKeys(row, columnMap.timestamp);
      const timestamp = parseTimestamp(timestampRaw);
      
      const statusRaw = getValueByPossibleKeys(row, columnMap.status);
      const status = determineStatus(String(statusRaw || ''));
      
      if (!timestamp) {
        console.warn(`Row ${index + 1}: Invalid or missing timestamp:`, timestampRaw);
        return;
      }
      
      if (!employeeNumber) {
        console.warn(`Row ${index + 1}: Missing employee number`);
        return;
      }
      
      if (!name) {
        console.warn(`Row ${index + 1}: Missing employee name`);
        // We can continue with a placeholder name if needed
      }
      
      // For debugging
      console.log(`Row ${index + 1}: Processing ${name} (${employeeNumber}) - ${format(timestamp, 'yyyy-MM-dd HH:mm:ss')} - ${status}`);
      
      // Get or create employee record
      let employee = employeeMap.get(employeeNumber);
      if (!employee) {
        employee = {
          employeeNumber,
          name: name || `Employee ${employeeNumber}`, // Fallback name
          department,
          days: [],
          totalDays: 0,
          expanded: false
        };
        employeeMap.set(employeeNumber, employee);
      }
      
      // Process the timestamp into the appropriate day record
      processTimeRecord(employee, timestamp, status, index);
    } catch (rowError) {
      console.error(`Error processing row ${index + 1}:`, rowError, "Row data:", row);
      // Continue to next row
    }
  });
  
  // Format the results and count the total days
  const results = Array.from(employeeMap.values());
  console.log(`Processed ${results.length} employees`);
  
  results.forEach(emp => {
    // Sort days chronologically
    emp.days.sort((a, b) => a.date.localeCompare(b.date));
    
    // Count total days
    emp.totalDays = emp.days.length;
    
    console.log(`Employee ${emp.name} has ${emp.days.length} days`);
  });
  
  return results;
};

// Helper function to detect column names from the first row
const detectColumnNames = (firstRow: any) => {
  const columnMap = {
    department: ['Department', 'Dept', 'dept', 'department'],
    name: ['Name', 'Employee Name', 'EmployeeName', 'name', 'employee', 'employee_name'],
    employeeNumber: ['Employee No', 'Employee Number', 'EmployeeNo', 'employee_no', 'EmployeeID', 'ID', 'employee_id', 'emp_no', 'emp_id'],
    timestamp: ['Time', 'Timestamp', 'DateTime', 'Date Time', 'time', 'timestamp', 'datetime', 'date_time', 'Check Time', 'check_time'],
    status: ['Status', 'Check Type', 'CheckType', 'status', 'check_type', 'type', 'check', 'in_out']
  };

  // For debugging, log all keys from the first row
  console.log("Available columns in Excel:", Object.keys(firstRow));
  
  // Return the column mapping
  return columnMap;
};

// Helper function to get value by possible column names
const getValueByPossibleKeys = (row: any, possibleKeys: string[]): any => {
  for (const key of possibleKeys) {
    if (row[key] !== undefined) {
      return row[key];
    }
  }
  return null;
};

// Helper function to parse timestamps from Excel
const parseTimestamp = (timestampStr: any): Date | null => {
  if (timestampStr === null || timestampStr === undefined) {
    return null;
  }
  
  console.log("Parsing timestamp:", timestampStr, "Type:", typeof timestampStr);
  
  // Handle numeric Excel date values
  if (typeof timestampStr === 'number') {
    // Excel dates are number of days since Dec 30, 1899
    const date = new Date((timestampStr - 25569) * 86400 * 1000);
    console.log("Parsed numeric Excel date:", date);
    return date;
  }
  
  // Handle date object directly
  if (timestampStr instanceof Date) {
    console.log("Already a Date object:", timestampStr);
    return timestampStr;
  }
  
  // Try parsing string formats
  if (typeof timestampStr === 'string') {
    try {
      // Try parsing ISO format first
      const isoDate = parseISO(timestampStr);
      if (!isNaN(isoDate.getTime())) {
        console.log("Parsed as ISO date:", isoDate);
        return isoDate;
      }
      
      // Try using tryParseDate function for various formats
      const parsedDate = tryParseDate(timestampStr);
      if (parsedDate) {
        console.log("Parsed with tryParseDate:", parsedDate);
        return parsedDate;
      }
      
      // Last resort: direct Date constructor
      const date = new Date(timestampStr);
      if (!isNaN(date.getTime())) {
        console.log("Parsed with Date constructor:", date);
        return date;
      }
      
      console.error("Failed to parse timestamp:", timestampStr);
      return null;
    } catch (e) {
      console.error('Error parsing timestamp string:', timestampStr, e);
      return null;
    }
  }
  
  // If we get here, we couldn't parse the timestamp
  console.error("Unparseable timestamp format:", timestampStr);
  return null;
};

// Helper function to determine the status (check-in or check-out)
const determineStatus = (statusStr: string): 'check_in' | 'check_out' => {
  const lowerStatus = statusStr.toLowerCase();
  
  if (lowerStatus.includes('in') || lowerStatus.includes('entry') || lowerStatus === 'c/in' || lowerStatus === 'i' || lowerStatus === '1') {
    return 'check_in';
  }
  
  // Default to check-out for anything else
  return 'check_out';
};

// Helper function to process a time record into an employee's days
const processTimeRecord = (
  employee: EmployeeRecord, 
  timestamp: Date, 
  status: 'check_in' | 'check_out',
  originalIndex: number
): void => {
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
    'yyyy-MM-dd HH:mm:ss',
    'MM/dd/yyyy',
    'MM/dd/yyyy HH:mm:ss',
    'MM-dd-yyyy',
    'MM-dd-yyyy HH:mm:ss',
    'yyyy/MM/dd',
    'yyyy/MM/dd HH:mm:ss',
    'd-MMM-yyyy',
    'd-MMM-yyyy HH:mm:ss',
    'M/d/yyyy h:mm:ss a',
    'M/d/yyyy h:mm a',
    'MM/dd/yyyy hh:mm:ss a',
    'yyyy-MM-dd\'T\'HH:mm:ss',
    'yyyy-MM-dd\'T\'HH:mm:ss.SSSZ',
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