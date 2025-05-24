import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { EmployeeRecord } from '../types';

// Function to handle uploaded Excel file
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        const result = e.target?.result;
        if (!result) {
          reject(new Error('Failed to read file'));
          return;
        }
        
        const data = new Uint8Array(result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Assume the first sheet contains the data we need
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
          reject(new Error('No data found in Excel file'));
          return;
        }
        
        // Process the JSON data into our required format
        const processedData = processExcelData(jsonData);
        resolve(processedData);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Process the raw Excel data into our application format
const processExcelData = (data: any[]): EmployeeRecord[] => {
  // Implement your logic to transform the data
  // This is a placeholder - you'll need to adapt it based on your Excel structure
  
  // Group by employee
  const employeeMap = new Map<string, EmployeeRecord>();
  
  data.forEach((row, index) => {
    // Extract employee info
    const employeeNumber = row.EmployeeNumber?.toString() || row['Employee Number']?.toString() || '';
    const employeeName = row.Name || row.EmployeeName || '';
    const department = row.Department || '';
    
    // Skip rows without employee info
    if (!employeeNumber || !employeeName) {
      console.warn(`Row ${index} missing employee info, skipping`);
      return;
    }
    
    // Extract timestamp and status
    const timestamp = row.Timestamp || row.DateTime || row.Date || '';
    let status = row.Status?.toString().toLowerCase() || '';
    
    // Skip rows without timestamp
    if (!timestamp) {
      console.warn(`Row ${index} missing timestamp, skipping`);
      return;
    }
    
    // Normalize status values
    if (status.includes('in') || status.includes('i/n') || status === 'i') {
      status = 'check_in';
    } else if (status.includes('out') || status.includes('o/ut') || status === 'o') {
      status = 'check_out';
    } else {
      console.warn(`Row ${index} has unknown status "${status}", skipping`);
      return;
    }
    
    // Try to parse the timestamp
    let date;
    try {
      // Different Excel formats might need different parsing approaches
      if (typeof timestamp === 'number') {
        // Excel numeric date
        date = new Date((timestamp - 25569) * 86400 * 1000);
      } else if (typeof timestamp === 'string') {
        // Try various string formats
        date = new Date(timestamp);
      } else {
        date = new Date(timestamp);
      }
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        console.warn(`Row ${index} has invalid timestamp "${timestamp}", skipping`);
        return;
      }
    } catch (error) {
      console.warn(`Row ${index} has unparseable timestamp "${timestamp}", skipping`);
      return;
    }
    
    // Get or create employee record
    if (!employeeMap.has(employeeNumber)) {
      employeeMap.set(employeeNumber, {
        employeeNumber,
        name: employeeName,
        department,
        days: [],
        totalDays: 0,
        expanded: false
      });
    }
    
    // Add the record to the employee's data
    const employee = employeeMap.get(employeeNumber)!;
    
    // Process the time record
    const timeRecord = {
      department,
      name: employeeName,
      employeeNumber,
      timestamp: date,
      status,
      originalIndex: index, // Store the original row index
    };
    
    // Add the time record to the appropriate day
    const dateStr = format(date, 'yyyy-MM-dd');
    let day = employee.days.find(d => d.date === dateStr);
    
    if (!day) {
      // Create a new day record
      day = {
        date: dateStr,
        firstCheckIn: null,
        lastCheckOut: null,
        hoursWorked: 0,
        approved: false,
        shiftType: null, // Will be determined later
        notes: '',
        missingCheckIn: true,
        missingCheckOut: true,
        isLate: false,
        earlyLeave: false,
        excessiveOvertime: false,
        penaltyMinutes: 0,
        allTimeRecords: [timeRecord],
        hasMultipleRecords: false
      };
      employee.days.push(day);
      employee.totalDays++;
    } else {
      // Add to existing day's records
      day.allTimeRecords = day.allTimeRecords || [];
      day.allTimeRecords.push(timeRecord);
      day.hasMultipleRecords = day.allTimeRecords.length > 1;
    }
    
    // Update check-in/check-out times
    if (status === 'check_in') {
      if (!day.firstCheckIn || date < day.firstCheckIn) {
        day.firstCheckIn = date;
        day.missingCheckIn = false;
      }
    } else if (status === 'check_out') {
      if (!day.lastCheckOut || date > day.lastCheckOut) {
        day.lastCheckOut = date;
        day.missingCheckOut = false;
      }
    }
  });
  
  // Convert map to array and sort days for each employee
  const result: EmployeeRecord[] = [];
  employeeMap.forEach(employee => {
    // Sort days by date
    employee.days.sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate hours worked for each day - this will be done in HrPage component
    // after shift types and late/early flags are determined
    
    result.push(employee);
  });
  
  return result;
};

// Export processed data to Excel
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create worksheet data
  const workSheetData: any[] = [];
  
  // Add headers
  workSheetData.push([
    'Employee Number', 
    'Name', 
    'Department',
    'Date',
    'Check In',
    'Check Out',
    'Hours Worked',
    'Approved',
    'Shift Type',
    'Notes',
    'Is Late',
    'Early Leave',
    'Penalty Minutes'
  ]);
  
  // Add data rows
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      workSheetData.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        day.date,
        day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm:ss') : 'Missing',
        day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm:ss') : 'Missing',
        day.hoursWorked.toFixed(2),
        day.approved ? 'Yes' : 'No',
        day.shiftType || 'Unknown',
        day.notes,
        day.isLate ? 'Yes' : 'No',
        day.earlyLeave ? 'Yes' : 'No',
        day.penaltyMinutes
      ]);
    });
  });
  
  // Create workbook and worksheet
  const workBook = XLSX.utils.book_new();
  const workSheet = XLSX.utils.aoa_to_sheet(workSheetData);
  
  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(workBook, workSheet, 'Time Records');
  
  // Export workbook
  const fileName = `Time_Records_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  XLSX.writeFile(workBook, fileName);
};

// Export approved hours to Excel with double-time calculations
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create worksheet data for summary
  const summaryData: any[] = [];
  
  // Add summary headers
  summaryData.push([
    'Employee Number', 
    'Name', 
    'Working Days', 
    'Regular Hours', 
    'Double-Time Hours', 
    'Total Payable Hours',
    'Avg Hours/Day'
  ]);
  
  // Calculate totals
  let totalWorkingDays = 0;
  let totalRegularHours = 0;
  let totalDoubleTimeHours = 0;
  let totalPayableHours = 0;
  
  // Add data rows for summary
  data.summary.forEach((employee: any) => {
    // Calculate double-time hours for this employee
    const doubleTimeHours = employee.double_time_hours || 0;
    const totalHours = employee.total_hours || 0;
    const payableHours = totalHours + doubleTimeHours;
    const avgHoursPerDay = employee.total_days > 0 ? (totalHours / employee.total_days) : 0;
    
    // Only include employees with working days > 0
    if (employee.total_days > 0) {
      summaryData.push([
        employee.employee_number,
        employee.name,
        employee.total_days,
        totalHours.toFixed(2),
        doubleTimeHours.toFixed(2),
        payableHours.toFixed(2),
        avgHoursPerDay.toFixed(2)
      ]);
      
      // Add to totals
      totalWorkingDays += employee.total_days;
      totalRegularHours += totalHours;
      totalDoubleTimeHours += doubleTimeHours;
      totalPayableHours += payableHours;
    }
  });
  
  // Add totals row
  summaryData.push([
    '',
    'TOTAL',
    totalWorkingDays,
    totalRegularHours.toFixed(2),
    totalDoubleTimeHours.toFixed(2),
    totalPayableHours.toFixed(2),
    totalWorkingDays > 0 ? (totalRegularHours / totalWorkingDays).toFixed(2) : '0.00'
  ]);
  
  // Create details worksheet data
  const detailsData: any[] = [];
  
  // Add details headers
  detailsData.push([
    'Employee Number',
    'Name',
    'Date',
    'Check In',
    'Check Out',
    'Shift Type',
    'Regular Hours',
    'Double-Time Hours',
    'Total Hours'
  ]);
  
  // Get double-time days (Fridays and holidays)
  const doubleDays = data.doubleDays || [];
  
  // Add data rows for details
  data.details.forEach((record: any) => {
    // Skip records with 0 hours or off-days
    if (!record.exact_hours || parseFloat(record.exact_hours) === 0 || 
        record.status === 'off_day' || record.notes?.includes('OFF-DAY')) {
      return;
    }
    
    // Only use check-in records to avoid duplication
    if (record.status !== 'check_in') {
      return;
    }
    
    const workingWeekStart = record.working_week_start || 
      (record.timestamp ? format(new Date(record.timestamp), 'yyyy-MM-dd') : '');
    
    // Calculate double-time hours
    const isDoubleTimeDay = doubleDays.includes(workingWeekStart);
    const hours = parseFloat(record.exact_hours || 0);
    const doubleTimeHours = isDoubleTimeDay ? hours : 0;
    const totalHours = hours + doubleTimeHours;
    
    // Get employee info
    const employeeNumber = record.employees?.employee_number || 'Unknown';
    const employeeName = record.employees?.name || 'Unknown';
    
    // Format display times
    const displayCheckIn = record.display_check_in || 'Missing';
    const displayCheckOut = record.display_check_out || 'Missing';
    
    detailsData.push([
      employeeNumber,
      employeeName,
      workingWeekStart,
      displayCheckIn,
      displayCheckOut,
      record.shift_type || 'Unknown',
      hours.toFixed(2),
      doubleTimeHours.toFixed(2),
      totalHours.toFixed(2)
    ]);
  });
  
  // Create workbook
  const workBook = XLSX.utils.book_new();
  
  // Create and add summary worksheet
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workBook, summarySheet, 'Summary');
  
  // Create and add details worksheet
  const detailsSheet = XLSX.utils.aoa_to_sheet(detailsData);
  XLSX.utils.book_append_sheet(workBook, detailsSheet, 'Details');
  
  // Add double-time days reference sheet
  const doubleTimeDaysData = [['Double-Time Days']].concat(
    doubleDays.sort().map(day => [day])
  );
  const doubleTimeDaysSheet = XLSX.utils.aoa_to_sheet(doubleTimeDaysData);
  XLSX.utils.book_append_sheet(workBook, doubleTimeDaysSheet, 'Double-Time Days');
  
  // Export workbook
  let title = 'Approved_Hours';
  if (data.filterMonth && data.filterMonth !== 'all') {
    title += `_${data.filterMonth}`;
  }
  const fileName = `${title}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  XLSX.writeFile(workBook, fileName);
};