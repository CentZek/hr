import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { EmployeeRecord } from '../types';

/**
 * Export employee records to Excel
 */
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create workbook and worksheets
  const wb = XLSX.utils.book_new();
  
  // Create summary worksheet
  const summaryData = createSummaryData(employeeRecords);
  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  
  // Create detailed worksheet
  const detailedData = createDetailedData(employeeRecords);
  const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
  XLSX.utils.book_append_sheet(wb, detailedSheet, 'Detailed');
  
  // Format column widths
  setColumnWidths(summarySheet, [15, 30, 10, 15, 15, 15, 15, 15, 15]);
  setColumnWidths(detailedSheet, [15, 30, 15, 15, 15, 15, 15, 15, 15]);
  
  // Export the workbook
  XLSX.writeFile(wb, `Employee_Hours_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

/**
 * Export approved hours to Excel
 */
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Create summary sheet
  const summaryData = createApprovedHoursSummary(data.summary);
  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Employee Summary');
  
  // Create detailed sheet if detail data is available
  if (data.details && data.details.length > 0) {
    const detailedData = createApprovedHoursDetail(data.details, data.doubleDays);
    const detailedSheet = XLSX.utils.json_to_sheet(detailedData);
    XLSX.utils.book_append_sheet(wb, detailedSheet, 'Daily Breakdown');
  }
  
  // Set column widths
  setColumnWidths(summarySheet, [15, 30, 10, 15, 15, 15, 15]);
  
  // Generate filename based on date range if available
  let filename = 'Approved_Hours_';
  if (data.dateRange) {
    filename += `${data.dateRange.startDate}_to_${data.dateRange.endDate}`;
  } else if (data.filterMonth && data.filterMonth !== 'all') {
    filename += data.filterMonth;
  } else {
    filename += format(new Date(), 'yyyy-MM-dd');
  }
  
  // Export the workbook
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

/**
 * Create summary data for Excel export
 */
const createSummaryData = (employeeRecords: EmployeeRecord[]): any[] => {
  return employeeRecords.map(employee => {
    const approvedDays = employee.days.filter(day => day.approved).length;
    const totalApprovedHours = employee.days
      .filter(day => day.approved)
      .reduce((sum, day) => sum + day.hoursWorked, 0);
    
    const pendingDays = employee.days.filter(day => !day.approved).length;
    const totalPendingHours = employee.days
      .filter(day => !day.approved)
      .reduce((sum, day) => sum + day.hoursWorked, 0);
    
    return {
      'Employee Number': employee.employeeNumber,
      'Name': employee.name,
      'Department': employee.department || '',
      'Total Days': employee.days.length,
      'Approved Days': approvedDays,
      'Approved Hours': totalApprovedHours.toFixed(2),
      'Pending Days': pendingDays,
      'Pending Hours': totalPendingHours.toFixed(2),
      'Total Hours': employee.days.reduce((sum, day) => sum + day.hoursWorked, 0).toFixed(2)
    };
  });
};

/**
 * Create detailed data for Excel export
 */
const createDetailedData = (employeeRecords: EmployeeRecord[]): any[] => {
  const detailedRows: any[] = [];
  
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      detailedRows.push({
        'Employee Number': employee.employeeNumber,
        'Name': employee.name,
        'Date': day.date,
        'Check In': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm:ss') : 'Missing',
        'Check Out': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm:ss') : 'Missing',
        'Shift Type': day.shiftType || 'Unknown',
        'Hours Worked': day.hoursWorked.toFixed(2),
        'Approved': day.approved ? 'Yes' : 'No',
        'Issues': [
          day.missingCheckIn ? 'Missing Check In' : '',
          day.missingCheckOut ? 'Missing Check Out' : '',
          day.isLate ? 'Late' : '',
          day.earlyLeave ? 'Early Leave' : '',
          day.excessiveOvertime ? 'Excessive Overtime' : '',
          day.penaltyMinutes > 0 ? `Penalty: ${day.penaltyMinutes} min` : ''
        ].filter(Boolean).join(', ') || 'None'
      });
    });
  });
  
  return detailedRows;
};

/**
 * Create summary data for approved hours export
 */
const createApprovedHoursSummary = (employees: any[]): any[] => {
  return employees.map(employee => {
    // Calculate any double-time hours if available
    const doubleTimeHours = employee.double_time_hours || 0;
    const regularHours = employee.total_hours || 0;
    const totalPayableHours = regularHours + doubleTimeHours;
    
    return {
      'Employee Number': employee.employee_number,
      'Name': employee.name,
      'Total Days': employee.total_days || 0,
      'Regular Hours': regularHours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Total Payable Hours': totalPayableHours.toFixed(2),
      'Average Hours/Day': employee.total_days > 0 
        ? (regularHours / employee.total_days).toFixed(2) 
        : '0.00'
    };
  });
};

/**
 * Create detailed data for approved hours export
 */
const createApprovedHoursDetail = (records: any[], doubleDays: string[] = []): any[] => {
  return records.map(record => {
    // Determine if this is a double-time day
    const isDoubleTime = doubleDays.includes(record.timestamp?.split('T')[0] || '');
    const hours = record.exact_hours || 0;
    
    return {
      'Date': record.timestamp ? format(new Date(record.timestamp), 'yyyy-MM-dd') : '',
      'Employee': record.employees?.name || '',
      'Employee Number': record.employees?.employee_number || '',
      'Check In': record.display_check_in || record.status === 'check_in' ? 
                 format(new Date(record.timestamp), 'HH:mm') : '',
      'Check Out': record.display_check_out || record.status === 'check_out' ? 
                  format(new Date(record.timestamp), 'HH:mm') : '',
      'Shift Type': record.shift_type || 'Unknown',
      'Regular Hours': hours.toFixed(2),
      'Double-Time': isDoubleTime ? 'Yes' : 'No',
      'Double-Time Hours': isDoubleTime ? hours.toFixed(2) : '0.00',
      'Total Payable Hours': isDoubleTime ? (hours * 2).toFixed(2) : hours.toFixed(2)
    };
  });
};

/**
 * Set column widths for a worksheet
 */
const setColumnWidths = (worksheet: XLSX.WorkSheet, widths: number[]): void => {
  worksheet['!cols'] = widths.map(w => ({ width: w }));
};