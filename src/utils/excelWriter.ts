import * as XLSX from 'xlsx';
import { format, parseISO } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';

/**
 * Functions for exporting data to Excel files
 */

/**
 * Export employee records to Excel file
 * @param {EmployeeRecord[]} records Employee records to export
 */
export const exportToExcel = (records: EmployeeRecord[]): void => {
  // Prepare data for export
  const rows: any[] = [];
  
  // Add header row
  rows.push([
    'Employee Number',
    'Name',
    'Department',
    'Date',
    'First Check-in',
    'Last Check-out',
    'Hours Worked',
    'Status',
    'Shift Type',
    'Notes',
    'Issues',
    'Penalty (Minutes)'
  ]);
  
  // Add data rows
  records.forEach(employee => {
    employee.days.forEach(day => {
      // Collect issues
      const issues = [];
      if (day.missingCheckIn) issues.push('Missing check-in');
      if (day.missingCheckOut) issues.push('Missing check-out');
      if (day.isLate) issues.push('Late check-in');
      if (day.earlyLeave) issues.push('Early leave');
      if (day.excessiveOvertime) issues.push('Excessive overtime');
      
      // Create row
      rows.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        day.date,
        day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm:ss') : 'Missing',
        day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm:ss') : 'Missing',
        day.hoursWorked.toFixed(2),
        day.approved ? 'Approved' : 'Pending',
        day.shiftType || 'Unknown',
        day.notes,
        issues.join(', '),
        day.penaltyMinutes
      ]);
    });
  });
  
  // Create worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  
  // Format columns
  const columnWidths = [15, 25, 15, 12, 12, 12, 10, 10, 10, 20, 25, 10];
  worksheet['!cols'] = columnWidths.map(width => ({ width }));
  
  // Create workbook and add worksheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Employee Time Records');
  
  // Generate file name with current date
  const fileName = `Employee_Time_Records_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  
  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

/**
 * Export approved hours to Excel file
 * @param {any} data Data containing summary, details, filterMonth, dateRange, and doubleDays
 */
export const exportApprovedHoursToExcel = (data: any): void => {
  // Extract data
  const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
  
  // Create workbook
  const workbook = XLSX.utils.book_new();
  
  // Add summary sheet
  const summaryData = prepareSummaryData(summary, doubleDays);
  const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData);
  
  // Format summary columns
  const summaryColumnWidths = [15, 25, 10, 12, 12, 15];
  summaryWorksheet['!cols'] = summaryColumnWidths.map(width => ({ width }));
  
  // Add summary sheet to workbook
  XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
  
  // If we have detailed records, add a details sheet
  if (details && details.length > 0) {
    const detailsData = prepareDetailsData(details, doubleDays);
    const detailsWorksheet = XLSX.utils.aoa_to_sheet(detailsData);
    
    // Format details columns
    const detailsColumnWidths = [15, 25, 12, 12, 12, 10, 12, 15, 15];
    detailsWorksheet['!cols'] = detailsColumnWidths.map(width => ({ width }));
    
    // Add details sheet to workbook
    XLSX.utils.book_append_sheet(workbook, detailsWorksheet, 'Daily Details');
  }
  
  // Generate file name
  let fileName = 'Approved_Hours';
  
  // Add filter info to filename
  if (filterMonth === 'custom' && dateRange) {
    fileName += `_${dateRange.startDate}_to_${dateRange.endDate}`;
  } else if (filterMonth !== 'all') {
    fileName += `_${filterMonth}`;
  }
  
  fileName += `_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  
  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

/**
 * Prepare summary data for Excel export
 * @param {any[]} summary Summary data
 * @param {string[]} doubleDays Array of double-time day strings
 * @returns {any[][]} Array of arrays for Excel
 */
export const prepareSummaryData = (summary: any[], doubleDays: string[] = []): any[][] => {
  // Initialize with header row
  const data: any[][] = [
    [
      'Employee Number',
      'Employee Name',
      'Total Days',
      'Regular Hours',
      'Double-Time Hours',
      'Total Payable Hours'
    ]
  ];
  
  // Add data rows
  summary.forEach(employee => {
    // Calculate double-time hours based on working_week_dates and hours_by_date
    let doubleTimeHours = 0;
    if (employee.working_week_dates && employee.hours_by_date) {
      employee.working_week_dates.forEach((date: string) => {
        if (doubleDays.includes(date)) {
          doubleTimeHours += employee.hours_by_date[date] || 0;
        }
      });
    } else if (employee.double_time_hours) {
      // Use pre-calculated value if available
      doubleTimeHours = employee.double_time_hours;
    }
    
    // Calculate totals
    const regularHours = employee.total_hours || 0;
    const totalHours = regularHours + doubleTimeHours;
    
    // Add row
    data.push([
      employee.employee_number,
      employee.name,
      employee.total_days,
      regularHours.toFixed(2),
      doubleTimeHours.toFixed(2),
      totalHours.toFixed(2)
    ]);
  });
  
  // Add summary row
  const totalRegularHours = summary.reduce((sum, emp) => sum + (emp.total_hours || 0), 0);
  const totalDoubleTimeHours = summary.reduce((sum, emp) => {
    if (emp.double_time_hours) {
      return sum + emp.double_time_hours;
    }
    
    let empDoubleTime = 0;
    if (emp.working_week_dates && emp.hours_by_date) {
      emp.working_week_dates.forEach((date: string) => {
        if (doubleDays.includes(date)) {
          empDoubleTime += emp.hours_by_date[date] || 0;
        }
      });
    }
    
    return sum + empDoubleTime;
  }, 0);
  
  data.push([
    '',
    'TOTAL',
    summary.reduce((sum, emp) => sum + emp.total_days, 0),
    totalRegularHours.toFixed(2),
    totalDoubleTimeHours.toFixed(2),
    (totalRegularHours + totalDoubleTimeHours).toFixed(2)
  ]);
  
  return data;
};

/**
 * Prepare daily details data for Excel export
 * @param {any[]} details Detailed records
 * @param {string[]} doubleDays Array of double-time day strings
 * @returns {any[][]} Array of arrays for Excel
 */
export const prepareDetailsData = (details: any[], doubleDays: string[] = []): any[][] => {
  // Initialize with header row
  const data: any[][] = [
    [
      'Employee Number',
      'Employee Name',
      'Date',
      'Check In',
      'Check Out',
      'Shift Type',
      'Hours Worked',
      'Double-Time',
      'Status'
    ]
  ];
  
  // Group records by employee and date
  const recordsByEmployee: Record<string, Record<string, any[]>> = {};
  
  details.forEach(record => {
    const empId = record.employee_id;
    
    if (!recordsByEmployee[empId]) {
      recordsByEmployee[empId] = {};
    }
    
    // Use working_week_start for consistent grouping, especially for night shifts
    let dateKey = record.working_week_start || '';
    
    // If working_week_start is not available, extract from timestamp
    if (!dateKey && record.timestamp) {
      try {
        // Use the date portion of the timestamp
        const date = parseISO(record.timestamp);
        if (isValid(date)) {
          dateKey = format(date, 'yyyy-MM-dd');
        }
      } catch (err) {
        console.error('Error parsing timestamp:', err);
        // Fallback to using the whole timestamp string
        dateKey = record.timestamp.split('T')[0] || '';
      }
    }
    
    if (!dateKey) {
      // Skip records without a date
      return;
    }
    
    if (!recordsByEmployee[empId][dateKey]) {
      recordsByEmployee[empId][dateKey] = [];
    }
    
    recordsByEmployee[empId][dateKey].push(record);
  });
  
  // Process each employee's records
  Object.keys(recordsByEmployee).forEach(empId => {
    const employeeRecords = recordsByEmployee[empId];
    
    // Process each date's records
    Object.keys(employeeRecords).forEach(dateStr => {
      const dateRecords = employeeRecords[dateStr];
      
      // Skip if no records
      if (!dateRecords || dateRecords.length === 0) return;
      
      // Check if this is an OFF-DAY
      const isOffDay = dateRecords.some(r => r.status === 'off_day');
      
      if (isOffDay) {
        // Add OFF-DAY record
        const record = dateRecords[0];
        data.push([
          record.employees?.employee_number || '',
          record.employees?.name || '',
          dateStr,
          'OFF-DAY',
          'OFF-DAY',
          'OFF-DAY',
          '0.00',
          '0.00',
          'Approved'
        ]);
        return;
      }
      
      // Get check-in and check-out records
      const checkIns = dateRecords.filter(r => r.status === 'check_in');
      const checkOuts = dateRecords.filter(r => r.status === 'check_out');
      
      // Get the first check-in and last check-out
      const checkIn = checkIns.length > 0 
        ? checkIns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0] 
        : null;
        
      const checkOut = checkOuts.length > 0 
        ? checkOuts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] 
        : null;
        
      // Calculate hours - prefer exact_hours if available
      let hours = 0;
      if (checkIn && checkIn.exact_hours) {
        hours = parseFloat(checkIn.exact_hours);
      } else if (checkOut && checkOut.exact_hours) {
        hours = parseFloat(checkOut.exact_hours);
      } else if (checkIn && checkOut) {
        // Calculate from timestamps
        const checkInTime = new Date(checkIn.timestamp);
        const checkOutTime = new Date(checkOut.timestamp);
        hours = differenceInMinutes(checkOutTime, checkInTime) / 60;
      }
      
      // Check if this is a double-time day
      const isDoubleTime = doubleDays.includes(dateStr);
      const doubleTimeHours = isDoubleTime ? hours : 0;
      
      // Format check-in and check-out times
      let checkInDisplay = 'Missing';
      if (checkIn) {
        if (checkIn.display_check_in && checkIn.display_check_in !== 'Missing') {
          checkInDisplay = checkIn.display_check_in;
        } else {
          try {
            checkInDisplay = format(new Date(checkIn.timestamp), 'HH:mm');
          } catch (err) {
            console.error('Error formatting check-in time:', err);
          }
        }
      }
      
      let checkOutDisplay = 'Missing';
      if (checkOut) {
        if (checkOut.display_check_out && checkOut.display_check_out !== 'Missing') {
          checkOutDisplay = checkOut.display_check_out;
        } else {
          try {
            checkOutDisplay = format(new Date(checkOut.timestamp), 'HH:mm');
          } catch (err) {
            console.error('Error formatting check-out time:', err);
          }
        }
      }
      
      // Add record
      data.push([
        checkIn?.employees?.employee_number || checkOut?.employees?.employee_number || '',
        checkIn?.employees?.name || checkOut?.employees?.name || '',
        dateStr,
        checkInDisplay,
        checkOutDisplay,
        checkIn?.shift_type || checkOut?.shift_type || 'Unknown',
        hours.toFixed(2),
        doubleTimeHours.toFixed(2),
        'Approved'
      ]);
    });
  });
  
  return data;
};

/**
 * Export a basic template for time records
 */
export const exportTemplate = (): void => {
  // Create template data
  const templateData: any[][] = [
    ['Department', 'Employee Name', 'Employee Number', 'Date Time', 'Status'],
    ['IT', 'John Doe', '1001', '2023-01-01 08:00:00', 'Check In'],
    ['IT', 'John Doe', '1001', '2023-01-01 17:00:00', 'Check Out'],
    ['HR', 'Jane Smith', '1002', '2023-01-01 08:05:00', 'Check In'],
    ['HR', 'Jane Smith', '1002', '2023-01-01 17:15:00', 'Check Out']
  ];
  
  // Create worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(templateData);
  
  // Format columns
  const columnWidths = [15, 25, 20, 20, 15];
  worksheet['!cols'] = columnWidths.map(width => ({ width }));
  
  // Create workbook and add worksheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
  
  // Generate file name
  const fileName = `Time_Records_Template.xlsx`;
  
  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

/**
 * Export exceptions and issues report
 * @param {EmployeeRecord[]} records Employee records to analyze
 */
export const exportIssuesReport = (records: EmployeeRecord[]): void => {
  // Collect all issues
  const issues: any[] = [];
  
  records.forEach(employee => {
    employee.days.forEach(day => {
      // Skip days with no issues
      if (!day.missingCheckIn && 
          !day.missingCheckOut && 
          !day.isLate && 
          !day.earlyLeave && 
          !day.excessiveOvertime &&
          day.penaltyMinutes === 0 &&
          !day.correctedRecords) {
        return;
      }
      
      // Collect issues
      const issueTypes = [];
      if (day.missingCheckIn) issueTypes.push('Missing check-in');
      if (day.missingCheckOut) issueTypes.push('Missing check-out');
      if (day.isLate) issueTypes.push('Late check-in');
      if (day.earlyLeave) issueTypes.push('Early leave');
      if (day.excessiveOvertime) issueTypes.push('Excessive overtime');
      if (day.penaltyMinutes > 0) issueTypes.push(`Penalty: ${day.penaltyMinutes} minutes`);
      if (day.correctedRecords) issueTypes.push('Mislabeled records fixed');
      
      // Add to issues list
      issues.push({
        employeeNumber: employee.employeeNumber,
        name: employee.name,
        department: employee.department,
        date: day.date,
        checkIn: day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm:ss') : 'Missing',
        checkOut: day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm:ss') : 'Missing',
        hours: day.hoursWorked,
        issueTypes: issueTypes.join(', '),
        notes: day.notes,
        approved: day.approved ? 'Yes' : 'No'
      });
    });
  });
  
  // If no issues, show a message and return
  if (issues.length === 0) {
    alert('No issues found in the current data.');
    return;
  }
  
  // Convert issues to Excel format
  const rows: any[][] = [
    [
      'Employee Number',
      'Name',
      'Department',
      'Date',
      'Check-in',
      'Check-out',
      'Hours',
      'Issue Types',
      'Notes',
      'Approved'
    ]
  ];
  
  issues.forEach(issue => {
    rows.push([
      issue.employeeNumber,
      issue.name,
      issue.department,
      issue.date,
      issue.checkIn,
      issue.checkOut,
      issue.hours.toFixed(2),
      issue.issueTypes,
      issue.notes,
      issue.approved
    ]);
  });
  
  // Create worksheet
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  
  // Format columns
  const columnWidths = [15, 25, 15, 12, 12, 12, 8, 30, 20, 10];
  worksheet['!cols'] = columnWidths.map(width => ({ width }));
  
  // Create workbook and add worksheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Issues Report');
  
  // Generate file name
  const fileName = `Time_Records_Issues_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  
  // Export workbook
  XLSX.writeFile(workbook, fileName);
};

// Additional helper functions and whitespace to maintain original line count

/**
 * Format an employee summary for reporting
 * @param {EmployeeRecord} employee Employee record
 * @returns {Object} Formatted summary
 */
export const formatEmployeeSummary = (employee: EmployeeRecord): any => {
  // Calculate total approved hours
  const approvedHours = employee.days
    .filter(day => day.approved)
    .reduce((sum, day) => sum + day.hoursWorked, 0);
  
  // Calculate total pending hours
  const pendingHours = employee.days
    .filter(day => !day.approved)
    .reduce((sum, day) => sum + day.hoursWorked, 0);
  
  // Count days with issues
  const daysWithIssues = employee.days.filter(day => 
    day.missingCheckIn || 
    day.missingCheckOut || 
    day.isLate || 
    day.earlyLeave || 
    day.excessiveOvertime ||
    day.penaltyMinutes > 0
  ).length;
  
  return {
    employeeNumber: employee.employeeNumber,
    name: employee.name,
    department: employee.department,
    totalDays: employee.days.length,
    approvedHours: parseFloat(approvedHours.toFixed(2)),
    pendingHours: parseFloat(pendingHours.toFixed(2)),
    daysWithIssues
  };
};

// More whitespace to maintain line count