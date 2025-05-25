import * as XLSX from 'xlsx';
import { EmployeeRecord, DailyRecord, TimeRecord } from '../types';
import { format, parseISO, isValid } from 'date-fns';
import { calculatePayableHours, determineShiftType } from './shiftCalculations';
import { parseDateTime } from './dateTimeHelper';

// Handle processing of uploaded Excel files
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // Parse Excel file
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get the first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        // Check if data is valid
        if (!Array.isArray(jsonData) || jsonData.length === 0) {
          reject(new Error('No valid data found in the Excel file.'));
          return;
        }

        console.log('Excel data loaded:', jsonData.length, 'rows');
        
        // Process data into the format we need
        const processedData = processExcelData(jsonData);
        
        console.log('Processed data:', processedData.length, 'employees');
        resolve(processedData);
      } catch (error) {
        console.error('Excel processing error:', error);
        reject(new Error(`Failed to process Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };
    
    reader.onerror = (error) => {
      console.error('FileReader error:', error);
      reject(new Error('Failed to read the Excel file.'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Process raw Excel data into our application format
const processExcelData = (data: any[]): EmployeeRecord[] => {
  console.log('Processing Excel data, sample row:', data[0]);
  
  // Group by employee
  const employeeMap = new Map<string, EmployeeRecord>();
  
  // Find all required fields in the data
  const firstRow = data[0] || {};
  const employeeNoField = findField(firstRow, ['Employee No', 'EmployeeNo', 'Employee Number', 'ID']);
  const nameField = findField(firstRow, ['Name', 'Employee Name', 'EmployeeName']);
  const timestampField = findField(firstRow, ['Timestamp', 'DateTime', 'Date Time', 'Time']);
  const statusField = findField(firstRow, ['Status', 'Event', 'Type']);
  const departmentField = findField(firstRow, ['Department', 'Dept', 'Section']);
  
  if (!employeeNoField || !nameField || !timestampField || !statusField) {
    console.error('Required fields missing in Excel data:', {
      employeeNoField, nameField, timestampField, statusField
    });
    throw new Error('Required fields missing in Excel file. Please ensure the file contains Employee No, Name, Timestamp, and Status columns.');
  }
  
  // First, find all unique employees
  data.forEach((row, index) => {
    // Skip rows without necessary data
    if (!row[employeeNoField] || !row[nameField] || !row[timestampField]) {
      console.log(`Skipping row ${index} due to missing required data`);
      return;
    }
    
    const employeeNumber = String(row[employeeNoField]).trim();
    const name = String(row[nameField]).trim();
    
    // Create employee record if it doesn't exist
    if (!employeeMap.has(employeeNumber)) {
      employeeMap.set(employeeNumber, {
        employeeNumber,
        name,
        department: row[departmentField] || '',
        days: [],
        totalDays: 0,
        expanded: false
      });
    }
  });
  
  console.log('Found', employeeMap.size, 'unique employees');
  
  // Add an index to each record to preserve original order
  const indexedData = data.map((row, index) => ({
    ...row,
    OriginalIndex: index
  }));
  
  // Then process each row to build daily records
  indexedData.forEach((row, rowIndex) => {
    // Skip rows without necessary data
    if (!row[employeeNoField] || !row[nameField] || !row[timestampField]) {
      return;
    }
    
    const employeeNumber = String(row[employeeNoField]).trim();
    
    // Parse timestamp - handle different format possibilities
    const timestamp = parseDateTime(String(row[timestampField]));
    
    if (!timestamp || !isValid(timestamp)) {
      console.log(`Row ${rowIndex}: Invalid timestamp:`, row[timestampField]);
      return;
    }
    
    // Parse status field - normalize to "check_in" or "check_out"
    const rawStatus = String(row[statusField] || '').trim().toLowerCase();
    
    let status: 'check_in' | 'check_out';
    if (rawStatus.includes('in') || rawStatus.includes('enter') || rawStatus === 'i' || rawStatus === '1') {
      status = 'check_in';
    } else if (rawStatus.includes('out') || rawStatus.includes('exit') || rawStatus === 'o' || rawStatus === '0') {
      status = 'check_out';
    } else {
      console.log(`Row ${rowIndex}: Unrecognized status:`, rawStatus);
      return; // Skip unrecognized status
    }
    
    // Get formatted date string for grouping (YYYY-MM-DD)
    const dateStr = format(timestamp, 'yyyy-MM-dd');
    
    // Get employee record
    const employee = employeeMap.get(employeeNumber);
    if (!employee) {
      console.log(`Row ${rowIndex}: Employee not found:`, employeeNumber);
      return;
    }
    
    // Create raw time record
    const timeRecord: TimeRecord = {
      department: row[departmentField] || '',
      name: String(row[nameField]).trim(),
      employeeNumber,
      timestamp,
      status,
      originalIndex: rowIndex
    };
    
    // Find existing day record or create new one
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
        allTimeRecords: [],
        hasMultipleRecords: false
      };
      employee.days.push(dayRecord);
      employee.totalDays++;
    }
    
    // Add the raw time record to allTimeRecords
    if (!dayRecord.allTimeRecords) {
      dayRecord.allTimeRecords = [];
    }
    
    dayRecord.allTimeRecords.push(timeRecord);
    
    // Update hasMultipleRecords flag
    dayRecord.hasMultipleRecords = (dayRecord.allTimeRecords.length > 1);
    
    // Update check-in/check-out times
    if (status === 'check_in') {
      if (!dayRecord.firstCheckIn || timestamp < dayRecord.firstCheckIn) {
        dayRecord.firstCheckIn = timestamp;
        dayRecord.missingCheckIn = false;
      }
    } else if (status === 'check_out') {
      if (!dayRecord.lastCheckOut || timestamp > dayRecord.lastCheckOut) {
        dayRecord.lastCheckOut = timestamp;
        dayRecord.missingCheckOut = false;
      }
    }
  });
  
  // Post-processing: calculate hours and determine shift types
  employeeMap.forEach(employee => {
    employee.days.forEach(day => {
      // Skip if missing both check-in and check-out
      if (!day.firstCheckIn && !day.lastCheckOut) return;
      
      // Determine shift type based on check-in time if available
      if (day.firstCheckIn) {
        day.shiftType = determineShiftType(day.firstCheckIn);
      }
      
      // Calculate hours worked if both check-in and check-out are available
      if (day.firstCheckIn && day.lastCheckOut) {
        day.hoursWorked = calculatePayableHours(
          day.firstCheckIn,
          day.lastCheckOut,
          day.shiftType
        );
      }
      
      // Sort allTimeRecords by timestamp
      if (day.allTimeRecords && day.allTimeRecords.length > 0) {
        day.allTimeRecords.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      }
    });
    
    // Sort days by date
    employee.days.sort((a, b) => a.date.localeCompare(b.date));
  });
  
  console.log('Processed', Array.from(employeeMap.values()).length, 'employees with data');
  
  // Return as array
  return Array.from(employeeMap.values());
};

// Helper function to find a field in the data based on common names
function findField(row: any, possibleNames: string[]): string | null {
  for (const name of possibleNames) {
    if (row.hasOwnProperty(name)) {
      return name;
    }
  }
  return null;
}

// Export data to Excel file
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Create summary sheet
  const summaryData = employeeRecords.map(employee => {
    const workingDays = employee.days.filter(day => 
      day.notes !== 'OFF-DAY' && day.hoursWorked > 0
    ).length;
    
    return {
      'Employee Number': employee.employeeNumber,
      'Name': employee.name,
      'Department': employee.department,
      'Total Days': employee.totalDays,
      'Working Days': workingDays,
      'Total Hours': employee.days.reduce((sum, day) => sum + day.hoursWorked, 0).toFixed(2)
    };
  });
  
  // Create worksheet from data
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);
  
  // Add summary sheet to workbook
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  
  // Create detailed data for each employee
  employeeRecords.forEach(employee => {
    const employeeName = `${employee.name} (${employee.employeeNumber})`;
    
    // Create employee sheet with detailed data
    const employeeData = employee.days
      .sort((a, b) => a.date.localeCompare(b.date)) // Sort by date
      .map(day => {
        return {
          'Date': day.date,
          'Check-In': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
          'Check-Out': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing',
          'Shift Type': day.shiftType || 'Unknown',
          'Hours Worked': day.hoursWorked.toFixed(2),
          'Status': day.approved ? 'Approved' : 'Pending',
          'Notes': day.notes,
          'Late': day.isLate ? 'Yes' : 'No',
          'Early Leave': day.earlyLeave ? 'Yes' : 'No',
          'Penalty Minutes': day.penaltyMinutes > 0 ? day.penaltyMinutes.toString() : '',
          'Penalty Hours': day.penaltyMinutes > 0 ? (day.penaltyMinutes / 60).toFixed(2) : ''
        };
    });
    
    // Create worksheet for this employee
    const employeeWs = XLSX.utils.json_to_sheet(employeeData);
    
    // Add employee sheet to workbook (ensure name is valid for Excel)
    const safeSheetName = employeeName.replace(/[*?:/\\[\]]/g, '_').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, employeeWs, safeSheetName);
  });
  
  // Generate Excel file
  XLSX.writeFile(wb, `Employee_Hours_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

// Export data from the Approved Hours page
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Extract and prepare data
  const { summary, details, filterMonth, doubleDays = [] } = data;
  
  // Create period string for title
  let periodStr = "All Time";
  if (filterMonth && filterMonth !== "all") {
    const [year, month] = filterMonth.split('-');
    try {
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      if (isValid(date)) {
        periodStr = format(date, 'MMMM yyyy');
      }
    } catch (e) {
      // Keep default if parsing fails
    }
  }
  
  // Create summary sheet data
  const summaryData = summary.map((employee: any) => {
    // Calculate working days (excluding OFF-DAY and 0 hours)
    const workingDays = details.filter((record: any) => 
      record.employeeId === employee.id && 
      !record.isOffDay && 
      record.exactHours > 0
    ).length;
    
    // Calculate double-time hours if available
    const doubleTimeHours = employee.double_time_hours || 0;
    const totalPayableHours = employee.total_hours + doubleTimeHours;
    
    return {
      'Employee Number': employee.employee_number,
      'Name': employee.name,
      'Total Days': employee.total_days,
      'Working Days': workingDays,
      'Regular Hours': employee.total_hours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Total Payable Hours': totalPayableHours.toFixed(2),
      'Avg Hours/Day': employee.total_days > 0 ? (employee.total_hours / employee.total_days).toFixed(2) : '0.00',
      'Period': periodStr
    };
  });
  
  // Add sheet title with information
  const title = [{
    'Period': `Approved Hours - ${periodStr}`,
    'Generated On': format(new Date(), 'MMMM d, yyyy h:mm a')
  }, {}]; // Empty row for spacing
  
  const finalSummaryData = [...title, ...summaryData];
  
  // Create summary worksheet
  const summaryWs = XLSX.utils.json_to_sheet(finalSummaryData);
  
  // Set column widths for better readability
  const colWidths = [
    { wch: 15 }, // Employee Number
    { wch: 25 }, // Name
    { wch: 10 }, // Total Days
    { wch: 12 }, // Working Days
    { wch: 12 }, // Regular Hours
    { wch: 16 }, // Double-Time Hours
    { wch: 18 }, // Total Payable Hours
    { wch: 12 }, // Avg Hours/Day
    { wch: 15 }  // Period
  ];
  summaryWs['!cols'] = colWidths;
  
  // Add summary sheet to workbook
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  
  // For each employee with expanded details, create a detailed sheet
  summary.forEach((employee: any) => {
    // Get all records for this employee
    const employeeDetails = details.filter((record: any) => 
      record.employeeId === employee.id
    );
    
    if (employeeDetails.length === 0) return;
    
    // Create employee sheet name
    const sheetName = `${employee.name.slice(0, 28)}`;
    
    // Create detailed data for the employee
    const detailedData = employeeDetails.map((record: any) => {
      // Calculate double-time hours if applicable
      const isDoubleTime = doubleDays.includes(record.date);
      const doubleTimeHours = isDoubleTime ? (record.exactHours || 0) : 0;
      
      // Determine shift type display
      let shiftTypeDisplay = record.shiftType;
      if (record.isOffDay) {
        shiftTypeDisplay = 'OFF-DAY';
      } else if (record.shiftType === 'canteen') {
        if (record.checkIn && record.checkIn.getHours() === 7) {
          shiftTypeDisplay = 'Canteen (07:00-16:00)';
        } else {
          shiftTypeDisplay = 'Canteen (08:00-17:00)';
        }
      } else if (shiftTypeDisplay) {
        shiftTypeDisplay = shiftTypeDisplay.charAt(0).toUpperCase() + shiftTypeDisplay.slice(1);
      }
      
      return {
        'Date': record.date ? format(new Date(record.date), 'yyyy-MM-dd') : '',
        'Check In': record.checkIn ? (record.displayCheckIn || format(record.checkIn, 'HH:mm')) : 'Missing',
        'Check Out': record.checkOut ? (record.displayCheckOut || format(record.checkOut, 'HH:mm')) : 'Missing',
        'Shift Type': shiftTypeDisplay || 'Unknown',
        'Hours': record.isOffDay ? 0 : (record.exactHours || 0).toFixed(2),
        'Double-Time Hours': doubleTimeHours.toFixed(2),
        'Total Hours': (record.isOffDay ? 0 : (record.exactHours || 0) + doubleTimeHours).toFixed(2),
        'Status': 'Approved'
      };
    });
    
    // Create worksheet for this employee
    const detailWs = XLSX.utils.json_to_sheet(detailedData);
    
    // Set column widths for better readability
    const colWidths = [
      { wch: 12 }, // Date
      { wch: 10 }, // Check In
      { wch: 10 }, // Check Out
      { wch: 20 }, // Shift Type
      { wch: 8 },  // Hours
      { wch: 16 }, // Double-Time Hours
      { wch: 12 }, // Total Hours
      { wch: 10 }  // Status
    ];
    detailWs['!cols'] = colWidths;
    
    // Add employee sheet to workbook
    XLSX.utils.book_append_sheet(wb, detailWs, sheetName);
  });
  
  // Generate Excel file
  XLSX.writeFile(wb, `Approved_Hours_${periodStr.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.xlsx`);
};