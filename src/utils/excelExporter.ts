import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { EmployeeRecord } from '../types';
import { formatTime24H } from './dateTimeHelper';

/**
 * Export data to Excel
 */
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Create worksheet for summary
  const summaryData = employeeRecords.map(employee => {
    const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
    const approvedHours = employee.days
      .filter(day => day.approved)
      .reduce((sum, day) => sum + day.hoursWorked, 0);
    
    return {
      'Employee Number': employee.employeeNumber,
      'Name': employee.name,
      'Department': employee.department,
      'Total Days': employee.totalDays,
      'Total Hours': totalHours.toFixed(2),
      'Approved Hours': approvedHours.toFixed(2)
    };
  });
  
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  
  // Create worksheet for details
  const detailsData: any[] = [];
  
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      detailsData.push({
        'Employee Number': employee.employeeNumber,
        'Name': employee.name,
        'Date': day.date,
        'Check In': day.firstCheckIn ? formatTime24H(day.firstCheckIn) : 'Missing',
        'Check Out': day.lastCheckOut ? formatTime24H(day.lastCheckOut) : 'Missing',
        'Hours': day.hoursWorked.toFixed(2),
        'Shift Type': day.shiftType || 'Unknown',
        'Late': day.isLate ? 'Yes' : 'No',
        'Early Leave': day.earlyLeave ? 'Yes' : 'No',
        'Penalty (min)': day.penaltyMinutes,
        'Approved': day.approved ? 'Yes' : 'No',
        'Notes': day.notes
      });
    });
  });
  
  const detailsWs = XLSX.utils.json_to_sheet(detailsData);
  XLSX.utils.book_append_sheet(wb, detailsWs, 'Details');
  
  // Export to file
  XLSX.writeFile(wb, `Time_Records_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

/**
 * Export approved hours to Excel
 */
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Create worksheet for summary
  const summaryData = data.summary.map((employee: any) => {
    // Calculate double-time hours if available
    const doubleTimeHours = employee.double_time_hours || 0;
    const regularHours = employee.total_hours || 0;
    const totalPayableHours = regularHours + doubleTimeHours;
    
    // Calculate working days (days where hours > 0)
    const workingDays = employee.working_week_dates ? 
      employee.working_week_dates.filter((date: string) => 
        (employee.hours_by_date?.[date] || 0) > 0
      ).length : 
      0;
    
    return {
      'Employee Number': employee.employee_number,
      'Name': employee.name,
      'Total Days': employee.total_days,
      'Working Days': workingDays,
      'Regular Hours': regularHours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Total Payable Hours': totalPayableHours.toFixed(2)
    };
  });
  
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  
  // Create worksheet for details if available
  if (data.details && data.details.length > 0) {
    const detailsData: any[] = [];
    
    data.details.forEach((record: any) => {
      // Check if this is an off day
      if (record.status === 'off_day' || record.notes?.includes('OFF-DAY')) {
        detailsData.push({
          'Date': record.working_week_start || record.timestamp.split('T')[0],
          'Employee': record.employees?.name || 'Unknown',
          'Employee Number': record.employees?.employee_number || 'Unknown',
          'Status': 'OFF-DAY',
          'Hours': '0.00',
          'Double-Time': '0.00'
        });
        return;
      }
      
      // Skip if not a check-in record (to avoid duplicates)
      if (record.status !== 'check_in') return;
      
      // Get date from working_week_start or timestamp
      const dateStr = record.working_week_start || record.timestamp.split('T')[0];
      
      // Check if this is a double-time day
      const isDoubleTime = data.doubleDays?.includes(dateStr) || false;
      
      // Get hours from exact_hours field
      const hours = parseFloat(record.exact_hours || 0);
      
      detailsData.push({
        'Date': dateStr,
        'Employee': record.employees?.name || 'Unknown',
        'Employee Number': record.employees?.employee_number || 'Unknown',
        'Check In': record.display_check_in || formatTime24H(new Date(record.timestamp)),
        'Check Out': record.display_check_out || 'Missing',
        'Shift Type': record.shift_type || 'Unknown',
        'Hours': hours.toFixed(2),
        'Double-Time': isDoubleTime ? hours.toFixed(2) : '0.00',
        'Total Payable': isDoubleTime ? (hours * 2).toFixed(2) : hours.toFixed(2)
      });
    });
    
    const detailsWs = XLSX.utils.json_to_sheet(detailsData);
    XLSX.utils.book_append_sheet(wb, detailsWs, 'Details');
  }
  
  // Export to file
  const fileName = `Approved_Hours_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
  XLSX.writeFile(wb, fileName);
};