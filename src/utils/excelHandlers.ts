import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { EmployeeRecord } from '../types';

/**
 * Export employee time records to Excel
 */
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  try {
    const workbook = XLSX.utils.book_new();
    
    // Create summary sheet
    const summaryData = createSummarySheet(employeeRecords);
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    
    // Create a detailed sheet for each employee
    employeeRecords.forEach((employee, index) => {
      const sheetData = createEmployeeDetailSheet(employee);
      const sheet = XLSX.utils.aoa_to_sheet(sheetData);
      const sheetName = `Employee ${index + 1}`;
      XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    });
    
    // Save workbook
    XLSX.writeFile(workbook, `Employee Hours Export ${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Failed to export to Excel. Please try again later.');
  }
};

/**
 * Create summary sheet data
 */
const createSummarySheet = (employeeRecords: EmployeeRecord[]): any[][] => {
  // Create header row
  const header = [
    'Employee Number',
    'Name',
    'Total Days',
    'Regular Hours',
    'Double-Time Hours',
    'Fridays Worked',
    'Off-Days', // New column for Off-Days
    'Over Time (Hours)',
    'Over Time (Days)',
    'Total Payable Hours'
  ];
  
  // Create data rows
  const data = employeeRecords.map(employee => {
    // Count days with > 0 hours
    const workDays = employee.days.filter(day => day.hoursWorked > 0).length;
    
    // Count off days (days with 0 hours or marked as OFF-DAY)
    const offDays = employee.days.filter(day => 
      day.hoursWorked === 0 || day.notes === 'OFF-DAY'
    ).length;
    
    // Calculate regular hours and special case hours
    const regularHours = employee.days.reduce((sum, day) => {
      const is2x = day.date.includes('2x') || 
                   (day.date.includes('Fri') && !day.date.includes('2x'));
                   
      return is2x ? sum : sum + day.hoursWorked;
    }, 0);
    
    // Calculate double-time hours (any day marked with 2x)
    const doubleTimeHours = employee.days.reduce((sum, day) => {
      const is2x = day.date.includes('2x');
      return is2x ? sum + day.hoursWorked : sum;
    }, 0);
    
    // Calculate Fridays worked (not marked with 2x but is Friday)
    const fridaysWorked = employee.days.reduce((sum, day) => {
      return day.date.includes('Fri') && !day.date.includes('2x') ? sum + 1 : sum;
    }, 0);
    
    // Calculate overtime
    const overTimeHours = employee.days.reduce((sum, day) => {
      return day.hoursWorked > 9 ? sum + (day.hoursWorked - 9) : sum;
    }, 0);
    
    // Count days with overtime
    const overTimeDays = employee.days.filter(day => day.hoursWorked > 9).length;
    
    // Calculate total payable hours (regular + double-time)
    const totalPayableHours = regularHours + doubleTimeHours;
    
    return [
      employee.employeeNumber,
      employee.name,
      workDays + offDays, // Total days (work days + off days)
      parseFloat(regularHours.toFixed(2)),
      parseFloat(doubleTimeHours.toFixed(2)),
      fridaysWorked,
      offDays, // New Off-Days count
      parseFloat(overTimeHours.toFixed(2)),
      overTimeDays,
      parseFloat(totalPayableHours.toFixed(2))
    ];
  });
  
  // Combine header and data
  return [header, ...data];
};

/**
 * Create detailed sheet data for a single employee
 */
const createEmployeeDetailSheet = (employee: EmployeeRecord): any[][] => {
  // Create header row
  const header = [
    'Date',
    'Check In',
    'Check Out',
    'Shift Type',
    'Hours',
    'Double-Time',
    'Status'
  ];
  
  // Create data rows
  const data = employee.days.map(day => {
    // Format check-in and check-out times
    const checkIn = day.displayCheckIn || 
                   (day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 
                   (day.notes === 'OFF-DAY' ? 'OFF-DAY' : 'Missing'));
                   
    const checkOut = day.displayCheckOut || 
                    (day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 
                    (day.notes === 'OFF-DAY' ? 'OFF-DAY' : 'Missing'));
    
    // Format shift type
    const shiftType = day.notes === 'OFF-DAY' ? 'OFF-DAY' : 
                     (day.shiftType ? day.shiftType.charAt(0).toUpperCase() + day.shiftType.slice(1) : '');
    
    // Check if this is a double-time day
    const is2x = day.date.includes('2x');
    
    // Calculate double-time hours (double the hours if marked as 2x)
    const doubleTimeHours = is2x ? day.hoursWorked : 0;
    
    return [
      day.date,
      day.isLate ? `⚠️ ${checkIn}` : checkIn,
      day.earlyLeave ? `⚠️ ${checkOut}` : checkOut,
      shiftType,
      parseFloat(day.hoursWorked.toFixed(2)),
      parseFloat(doubleTimeHours.toFixed(2)),
      day.approved ? 'Approved' : 'Pending'
    ];
  });
  
  // Add employee summary row
  const totalHours = parseFloat(employee.days.reduce((sum, day) => sum + day.hoursWorked, 0).toFixed(2));
  const doubleTimeHours = parseFloat(employee.days.reduce((sum, day) => {
    const is2x = day.date.includes('2x');
    return is2x ? sum + day.hoursWorked : sum;
  }, 0).toFixed(2));
  
  // Count off days
  const offDays = employee.days.filter(day => 
    day.hoursWorked === 0 || day.notes === 'OFF-DAY'
  ).length;
  
  const summary = [
    `Total (${employee.days.length} days, ${offDays} off-days)`, // Include off-days count in summary
    '',
    '',
    '',
    totalHours,
    doubleTimeHours,
    ''
  ];
  
  // Combine header, data, and summary
  return [header, ...data, summary];
};

/**
 * Export approved hours data to Excel
 */
export const exportApprovedHoursToExcel = (data: any): void => {
  try {
    const workbook = XLSX.utils.book_new();
    
    // Extract relevant data
    const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
    
    // Create summary sheet
    const summaryData = createApprovedHoursSummarySheet(summary, doubleDays);
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    
    // If we have details for an employee, create a detail sheet
    if (details && details.length > 0) {
      const detailData = createApprovedHoursDetailSheet(details, doubleDays);
      const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Daily Details');
    }
    
    // Create a date range string for the filename
    let dateStr = '';
    if (dateRange) {
      const { startDate, endDate } = dateRange;
      dateStr = `_${startDate}_to_${endDate}`;
    } else if (filterMonth && filterMonth !== 'all') {
      dateStr = `_${filterMonth}`;
    }
    
    // Save workbook
    XLSX.writeFile(workbook, `Approved Hours${dateStr}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    alert('Failed to export approved hours to Excel. Please try again later.');
  }
};

/**
 * Create summary sheet for approved hours
 */
const createApprovedHoursSummarySheet = (employees: any[], doubleDays: string[] = []): any[][] => {
  // Create header row
  const header = [
    'Employee Number',
    'Name',
    'Total Days',
    'Working Days',
    'Off-Days', // New column for Off-Days
    'Regular Hours',
    'Double-Time Hours',
    'Total Payable Hours',
    'Avg Hours/Day'
  ];
  
  // Create data rows
  const data = employees.map(employee => {
    // Calculate double-time hours
    let doubleTimeHours = 0;
    
    if (employee.double_time_hours !== undefined) {
      // Use pre-calculated value if available
      doubleTimeHours = employee.double_time_hours;
    } else if (employee.working_week_dates && employee.hours_by_date) {
      // Otherwise calculate based on working_week_dates and hours_by_date
      employee.working_week_dates.forEach((date: string) => {
        if (doubleDays.includes(date)) {
          doubleTimeHours += employee.hours_by_date[date] || 0;
        }
      });
    }
    
    // Calculate total payable hours
    const regularHours = employee.total_hours || 0;
    const totalPayableHours = regularHours + doubleTimeHours;
    
    // Calculate working days and off days
    const totalDays = employee.total_days || 0;
    
    // Count off-days - days with 0 hours
    // If we have working_week_dates and hours_by_date, use that to count off-days
    let offDays = 0;
    if (employee.working_week_dates && employee.hours_by_date) {
      offDays = employee.working_week_dates.filter((date: string) => 
        (employee.hours_by_date[date] || 0) === 0
      ).length;
    } else {
      // Otherwise estimate based on typical work week (6 days per week)
      const estimatedWorkingDays = Math.min(totalDays, Math.ceil(regularHours / 9));
      offDays = totalDays - estimatedWorkingDays;
    }
    
    // Calculate working days (total days - off days)
    const workingDays = totalDays - offDays;
    
    // Calculate average hours per working day
    const avgHoursPerDay = workingDays > 0 ? regularHours / workingDays : 0;
    
    return [
      employee.employee_number,
      employee.name,
      totalDays,
      workingDays,
      offDays, // Add Off-Days count
      parseFloat(regularHours.toFixed(2)),
      parseFloat(doubleTimeHours.toFixed(2)),
      parseFloat(totalPayableHours.toFixed(2)),
      parseFloat(avgHoursPerDay.toFixed(2))
    ];
  });
  
  // Combine header and data
  return [header, ...data];
};

/**
 * Create detail sheet for approved hours
 */
const createApprovedHoursDetailSheet = (records: any[], doubleDays: string[] = []): any[][] => {
  // Create header row
  const header = [
    'Date',
    'Check In',
    'Check Out',
    'Shift Type',
    'Hours',
    'Double-Time',
    'Status',
    'Notes'
  ];
  
  // Create data rows
  const data = records.map(record => {
    // Check if this is an off-day record
    const isOffDay = record.status === 'off_day' || record.notes?.includes('OFF-DAY');
    
    // Format check-in time
    const checkIn = isOffDay ? 'OFF-DAY' : 
                   (record.display_check_in || 
                   (record.timestamp && record.status === 'check_in' ? 
                   format(new Date(record.timestamp), 'HH:mm') : 'Missing'));
    
    // Format check-out time
    const checkOut = isOffDay ? 'OFF-DAY' : 
                    (record.display_check_out || 'Missing');
    
    // Format shift type
    const shiftType = isOffDay ? 'OFF-DAY' : 
                     (record.shift_type ? 
                      record.shift_type.charAt(0).toUpperCase() + record.shift_type.slice(1) : '');
    
    // Calculate hours
    const hours = parseFloat((record.exact_hours || 0).toFixed(2));
    
    // Calculate double-time hours
    let doubleTimeHours = 0;
    
    // Check if this day is a double-time day
    if (record.working_week_start && doubleDays.includes(record.working_week_start)) {
      doubleTimeHours = hours;
    }
    
    // Extract notes (remove hours metadata)
    let notes = record.notes || '';
    notes = notes.replace(/hours:\d+\.\d+;?\s*/, '');
    notes = notes.replace(/double-time:(true|false);?\s*/, '');
    
    return [
      record.working_week_start || (record.timestamp ? format(new Date(record.timestamp), 'yyyy-MM-dd') : ''),
      checkIn,
      checkOut,
      shiftType,
      hours,
      doubleTimeHours,
      'Approved',
      notes
    ];
  });
  
  // Group by date and combine check-in/check-out records
  const groupedByDate = new Map();
  
  data.forEach(row => {
    const date = row[0]; // Date
    const status = row[6]; // Status
    
    // Skip if no date
    if (!date) return;
    
    // For OFF-DAY records, just add them directly
    if (row[1] === 'OFF-DAY' && row[2] === 'OFF-DAY' && row[3] === 'OFF-DAY') {
      groupedByDate.set(date, {
        date,
        checkIn: 'OFF-DAY',
        checkOut: 'OFF-DAY',
        shiftType: 'OFF-DAY',
        hours: 0,
        doubleTime: 0,
        status: 'Approved',
        notes: 'OFF-DAY'
      });
      return;
    }
    
    // For regular records, combine check-in and check-out
    if (!groupedByDate.has(date)) {
      groupedByDate.set(date, {
        date,
        checkIn: row[1], // Check In
        checkOut: row[2], // Check Out
        shiftType: row[3], // Shift Type
        hours: row[4], // Hours
        doubleTime: row[5], // Double-Time
        status: row[6], // Status
        notes: row[7] // Notes
      });
    } else {
      // Update existing entry if needed
      const existing = groupedByDate.get(date);
      
      // Update check-in/check-out if missing
      if (existing.checkIn === 'Missing' && row[1] !== 'Missing') {
        existing.checkIn = row[1];
      }
      
      if (existing.checkOut === 'Missing' && row[2] !== 'Missing') {
        existing.checkOut = row[2];
      }
      
      // Update other fields if needed
      if (!existing.shiftType && row[3]) {
        existing.shiftType = row[3];
      }
      
      if (existing.notes === '' && row[7]) {
        existing.notes = row[7];
      }
    }
  });
  
  // Convert back to rows
  const combinedData = Array.from(groupedByDate.values()).map(entry => [
    entry.date,
    entry.checkIn,
    entry.checkOut,
    entry.shiftType,
    entry.hours,
    entry.doubleTime,
    entry.status,
    entry.notes
  ]);
  
  // Sort by date
  combinedData.sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return 0;
  });
  
  // Calculate totals
  const totalWorkingDays = combinedData.filter(row => row[1] !== 'OFF-DAY').length;
  const totalOffDays = combinedData.filter(row => row[1] === 'OFF-DAY').length;
  const totalHours = parseFloat(combinedData.reduce((sum, row) => sum + (row[4] || 0), 0).toFixed(2));
  const totalDoubleTime = parseFloat(combinedData.reduce((sum, row) => sum + (row[5] || 0), 0).toFixed(2));
  
  // Add summary row
  const summary = [
    `Total (${combinedData.length} days: ${totalWorkingDays} working, ${totalOffDays} off-days)`,
    '',
    '',
    '',
    totalHours,
    totalDoubleTime,
    '',
    ''
  ];
  
  // Combine header, data, and summary
  return [header, ...combinedData, summary];
};