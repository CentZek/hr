import * as XLSX from 'xlsx';
import { EmployeeRecord, DailyRecord } from '../types';
import { format, parseISO, isValid } from 'date-fns';

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
        
        // Process data into the format we need
        const processedData = processExcelData(jsonData);
        resolve(processedData);
      } catch (error) {
        reject(new Error(`Failed to process Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read the Excel file.'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Process raw Excel data into our application format
const processExcelData = (data: any[]): EmployeeRecord[] => {
  // Group by employee
  const employeeMap = new Map<string, EmployeeRecord>();
  
  // First, find all unique employees and dates
  data.forEach(row => {
    // Skip rows without necessary data
    if (!row['Employee No'] || !row['Name'] || !row['Timestamp']) {
      return;
    }
    
    const employeeNumber = String(row['Employee No']).trim();
    const name = String(row['Name']).trim();
    
    // Create employee record if it doesn't exist
    if (!employeeMap.has(employeeNumber)) {
      employeeMap.set(employeeNumber, {
        employeeNumber,
        name,
        department: row['Department'] || '',
        days: [],
        totalDays: 0,
        expanded: false
      });
    }
  });
  
  // Then process each row to build daily records
  data.forEach(row => {
    // Skip rows without necessary data
    if (!row['Employee No'] || !row['Name'] || !row['Timestamp']) {
      return;
    }
    
    const employeeNumber = String(row['Employee No']).trim();
    const timestamp = new Date(row['Timestamp']);
    const status = row['Status'];
    
    if (!isValid(timestamp) || !status) {
      return;
    }
    
    // Get formatted date string for grouping
    const dateStr = format(timestamp, 'yyyy-MM-dd');
    
    // Get employee record
    const employee = employeeMap.get(employeeNumber);
    if (!employee) return;
    
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
        allTimeRecords: []
      };
      employee.days.push(dayRecord);
      employee.totalDays++;
    }
    
    // Add the raw time record to allTimeRecords
    if (!dayRecord.allTimeRecords) {
      dayRecord.allTimeRecords = [];
    }
    
    dayRecord.allTimeRecords.push({
      department: row['Department'] || '',
      name: String(row['Name']).trim(),
      employeeNumber,
      timestamp,
      status,
      originalIndex: row['OriginalIndex'] || dayRecord.allTimeRecords.length
    });
    
    // Update hasMultipleRecords flag
    dayRecord.hasMultipleRecords = (dayRecord.allTimeRecords.length > 1);
    
    // Update check-in/check-out times
    if (status.toLowerCase() === 'check_in' || status.toLowerCase() === 'c/in') {
      if (!dayRecord.firstCheckIn || timestamp < dayRecord.firstCheckIn) {
        dayRecord.firstCheckIn = timestamp;
        dayRecord.missingCheckIn = false;
      }
    } else if (status.toLowerCase() === 'check_out' || status.toLowerCase() === 'c/out') {
      if (!dayRecord.lastCheckOut || timestamp > dayRecord.lastCheckOut) {
        dayRecord.lastCheckOut = timestamp;
        dayRecord.missingCheckOut = false;
      }
    }
  });
  
  // Return as array
  return Array.from(employeeMap.values());
};

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
  const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
  
  // Create period string for title
  let periodStr = "All Time";
  if (filterMonth && filterMonth !== "all") {
    if (filterMonth === "custom" && dateRange) {
      const { startDate, endDate } = dateRange;
      const startStr = startDate && isValid(parseISO(startDate)) ? format(parseISO(startDate), 'MMM d, yyyy') : 'Start';
      const endStr = endDate && isValid(parseISO(endDate)) ? format(parseISO(endDate), 'MMM d, yyyy') : 'End';
      periodStr = `${startStr} to ${endStr}`;
    } else if (filterMonth.includes('-')) {
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
  }
  
  // Create summary sheet data
  const summaryData = summary.map((employee: any) => {
    // Count working days (excluding OFF-DAY and 0 hours)
    const workingDays = details.filter((record: any) => 
      record.date && 
      record.employeeId === employee.id && 
      !record.isOffDay && 
      (record.exactHours > 0 || (record.checkIn && record.checkOut))
    ).length;
    
    // Calculate double-time hours if available
    const doubleTimeHours = employee.double_time_hours || 0;
    
    return {
      'Employee Number': employee.employee_number,
      'Name': employee.name,
      'Total Days': employee.total_days,
      'Working Days': workingDays,
      'Regular Hours': employee.total_hours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Total Payable Hours': (employee.total_hours + doubleTimeHours).toFixed(2),
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
      const doubleTimeHours = isDoubleTime ? record.exactHours || 0 : 0;
      
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
      { wch: 10 }  // Status
    ];
    detailWs['!cols'] = colWidths;
    
    // Add employee sheet to workbook
    XLSX.utils.book_append_sheet(wb, detailWs, sheetName);
  });
  
  // Generate Excel file
  XLSX.writeFile(wb, `Approved_Hours_${periodStr.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.xlsx`);
};