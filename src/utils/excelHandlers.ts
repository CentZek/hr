import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';
import { isDoubleTimeDay } from '../services/holidayService';
import { calculateDoubleTimeHours } from '../services/holidayService';

// Export to Excel function
export const exportToExcel = (employeeRecords: EmployeeRecord[]) => {
  // Create a workbook
  const wb = XLSX.utils.book_new();

  // Create a worksheet for employee data
  const employeeData: any[] = [];
  
  // Summary data
  let totalDays = 0;
  let totalHours = 0;
  let totalDoubleTimeHours = 0;
  let totalPayableHours = 0;
  let totalFridaysOrDoubleDays = 0;
  let totalOvertimeHours = 0;
  let totalOffDays = 0;
  let totalWorkingDays = 0;

  // Track column names used
  const columnNames = new Set<string>();
  
  // Process each employee
  employeeRecords.forEach(employee => {
    // Create a record for the employee
    const record: any = {
      'Employee Number': employee.employeeNumber,
      'Name': employee.name,
      'Department': employee.department || '',
      'Total Days': employee.days.length,
    };

    // Track all days with statistics for this employee
    let employeeTotalHours = 0;
    let employeeDoubleTimeHours = 0;
    let employeeFridaysOrDoubleDays = 0;
    let employeeOvertimeHours = 0;
    let employeeOffDays = 0;
    let employeeWorkingDays = 0;

    // Process each day
    employee.days.forEach(day => {
      // Count statistics
      totalDays++;
      
      // Add to off days or working days
      if (day.hoursWorked === 0) {
        totalOffDays++;
        employeeOffDays++;
      } else {
        totalWorkingDays++;
        employeeWorkingDays++;
      }
      
      // Add hours to total
      totalHours += day.hoursWorked;
      employeeTotalHours += day.hoursWorked;
      
      // Check for double time (Fridays and holidays)
      if (day.date.includes('Friday') || isDoubleTimeDay(day.date)) {
        totalFridaysOrDoubleDays++;
        employeeFridaysOrDoubleDays++;
        
        const doubleTimeHours = day.hoursWorked; // All hours on these days count as double
        totalDoubleTimeHours += doubleTimeHours;
        employeeDoubleTimeHours += doubleTimeHours;
      }
      
      // Count overtime (hours > 9)
      if (day.hoursWorked > 9) {
        const overtimeHours = day.hoursWorked - 9;
        totalOvertimeHours += overtimeHours;
        employeeOvertimeHours += overtimeHours;
      }

      // Add day columns (e.g., Day 1, Day 2, etc.)
      const dayIndex = employee.days.indexOf(day) + 1;
      const dayKey = `Day ${dayIndex}`;
      const dateKey = `Date ${dayIndex}`;
      const hourKey = `Hours ${dayIndex}`;
      const approvedKey = `Approved ${dayIndex}`;

      // Track column names
      columnNames.add(dayKey);
      columnNames.add(dateKey);
      columnNames.add(hourKey);
      columnNames.add(approvedKey);

      // Add day data
      record[dateKey] = day.date;
      record[dayKey] = day.shiftType ? day.shiftType.charAt(0).toUpperCase() + day.shiftType.slice(1) : '';
      record[hourKey] = day.hoursWorked.toFixed(2);
      record[approvedKey] = day.approved ? 'Yes' : 'No';
    });

    // Add employee total statistics
    record['Total Hours'] = employeeTotalHours.toFixed(2);
    record['Double-Time Hours'] = employeeDoubleTimeHours.toFixed(2);
    record['Payable Hours'] = (employeeTotalHours + employeeDoubleTimeHours).toFixed(2);
    record['Fridays/Double Days'] = employeeFridaysOrDoubleDays;
    record['Overtime Hours'] = employeeOvertimeHours.toFixed(2);
    record['Off Days'] = employeeOffDays;
    record['Working Days'] = employeeWorkingDays;

    // Add to total payable hours
    totalPayableHours = totalHours + totalDoubleTimeHours;

    // Add the record to the worksheet data
    employeeData.push(record);
  });

  // Create the employee worksheet
  const ws = XLSX.utils.json_to_sheet(employeeData);

  // Add the worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Employee Data');

  // Create statistics worksheet
  const statsData: any[] = [];
  
  // Add statistics rows
  statsData.push(['Total Employees', employeeRecords.length]);
  statsData.push(['Total Days', totalDays]);
  statsData.push(['Total Regular Hours', totalHours.toFixed(2)]);
  statsData.push(['Total Double-Time Hours', totalDoubleTimeHours.toFixed(2)]);
  statsData.push(['Total Payable Hours', totalPayableHours.toFixed(2)]);
  statsData.push(['Fridays or Double Days', totalFridaysOrDoubleDays]);
  statsData.push(['Overtime Hours', totalOvertimeHours.toFixed(2)]);
  statsData.push(['Off Days', totalOffDays]);
  statsData.push(['Working Days', totalWorkingDays]);

  // Create the statistics worksheet
  const statsWs = XLSX.utils.aoa_to_sheet(statsData);

  // Add the statistics worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, statsWs, 'Statistics');

  // Generate filename with timestamp
  const filename = `employee_data_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;

  // Save the workbook
  XLSX.writeFile(wb, filename);
};

// Export approved hours to Excel
export const exportApprovedHoursToExcel = (data: any) => {
  // Create a workbook
  const wb = XLSX.utils.book_new();
  
  // Summary worksheet data
  const summaryData: any[] = [];
  let totalEmployees = 0;
  let totalRegularHours = 0;
  let totalDoubleTimeHours = 0;
  let totalPayableHours = 0;
  let totalOffDays = 0;
  let totalWorkingDays = 0;
  
  // Format for date display
  const dateFormat = 'MM/dd/yyyy';
  
  // Add headers to summary data
  summaryData.push([
    'Employee Number',
    'Name',
    'Total Days',
    'Working Days',
    'Regular Hours',
    'Double-Time Hours',
    'Total Payable Hours',
    'Avg Hours/Day',
    'Off Days'
  ]);
  
  // Process summary data
  data.summary.forEach((employee: any) => {
    totalEmployees++;
    const regularHours = employee.total_hours || 0;
    const doubleTimeHours = employee.double_time_hours || 0;
    const payableHours = regularHours + doubleTimeHours;
    const totalDays = employee.total_days || 0;
    
    // Calculate working days (days with hours > 0)
    let workingDays = 0;
    let offDays = 0;
    
    if (employee.working_week_dates) {
      employee.working_week_dates.forEach((date: string) => {
        const hours = employee.hours_by_date?.[date] || 0;
        if (hours === 0) {
          offDays++;
          totalOffDays++;
        } else {
          workingDays++;
          totalWorkingDays++;
        }
      });
    }
    
    const avgHoursPerDay = workingDays > 0 ? (regularHours / workingDays) : 0;
    
    // Add row to summary data
    summaryData.push([
      employee.employee_number,
      employee.name,
      totalDays,
      workingDays,
      regularHours.toFixed(2),
      doubleTimeHours.toFixed(2),
      payableHours.toFixed(2),
      avgHoursPerDay.toFixed(2),
      offDays
    ]);
    
    // Add to totals
    totalRegularHours += regularHours;
    totalDoubleTimeHours += doubleTimeHours;
    totalPayableHours += payableHours;
  });
  
  // Add totals row
  summaryData.push([
    'TOTALS',
    `${totalEmployees} Employees`,
    '',
    totalWorkingDays,
    totalRegularHours.toFixed(2),
    totalDoubleTimeHours.toFixed(2),
    totalPayableHours.toFixed(2),
    '',
    totalOffDays
  ]);
  
  // Create summary worksheet
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  
  // Add column widths
  const summaryColWidths = [
    { wch: 15 }, // Employee Number
    { wch: 25 }, // Name
    { wch: 12 }, // Total Days
    { wch: 12 }, // Working Days
    { wch: 15 }, // Regular Hours
    { wch: 15 }, // Double-Time Hours
    { wch: 15 }, // Total Payable Hours
    { wch: 15 }, // Avg Hours/Day
    { wch: 12 }  // Off Days
  ];
  summaryWs['!cols'] = summaryColWidths;
  
  // Add the summary worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Employee Summary');
  
  // Create details worksheet if details data is available
  if (data.details && data.details.length > 0) {
    const detailsData: any[] = [];
    
    // Add headers to details data
    detailsData.push([
      'Date',
      'Employee',
      'Employee Number',
      'Shift Type',
      'Check In',
      'Check Out',
      'Hours',
      'Double-Time',
      'Total Payable'
    ]);
    
    // Process details data
    data.details.forEach((record: any) => {
      // Skip off-day records - we'll add them separately with clear marking
      if (record.status === 'off_day' || record.notes?.includes('OFF-DAY')) {
        detailsData.push([
          record.timestamp ? format(new Date(record.timestamp), dateFormat) : '',
          record.employees?.name || '',
          record.employees?.employee_number || '',
          'OFF-DAY',
          'OFF-DAY',
          'OFF-DAY',
          '0.00',
          '0.00',
          '0.00'
        ]);
        return;
      }
      
      // Group by working_week_start to ensure night shifts are properly grouped
      let dateKey = record.working_week_start || '';
      if (!dateKey && record.timestamp) {
        const date = new Date(record.timestamp);
        dateKey = format(date, 'yyyy-MM-dd');
      }
      
      // Get shift type
      const shiftType = record.shift_type ? 
        (record.shift_type.charAt(0).toUpperCase() + record.shift_type.slice(1)) : 
        '';
      
      // Format check-in and check-out times
      const checkIn = record.display_check_in || 'Missing';
      const checkOut = record.display_check_out || 'Missing';
      
      // Get hours and double-time hours
      const hours = parseFloat(record.exact_hours || 0);
      const isDoubleTime = data.doubleDays ? data.doubleDays.includes(dateKey) : false;
      const doubleTimeHours = isDoubleTime ? hours : 0;
      const totalPayable = hours + doubleTimeHours;
      
      // Add row to details data
      detailsData.push([
        record.timestamp ? format(new Date(record.timestamp), dateFormat) : '',
        record.employees?.name || '',
        record.employees?.employee_number || '',
        shiftType,
        checkIn,
        checkOut,
        hours.toFixed(2),
        doubleTimeHours.toFixed(2),
        totalPayable.toFixed(2)
      ]);
    });
    
    // Create details worksheet
    const detailsWs = XLSX.utils.aoa_to_sheet(detailsData);
    
    // Add column widths
    const detailsColWidths = [
      { wch: 15 }, // Date
      { wch: 25 }, // Employee
      { wch: 15 }, // Employee Number
      { wch: 15 }, // Shift Type
      { wch: 12 }, // Check In
      { wch: 12 }, // Check Out
      { wch: 12 }, // Hours
      { wch: 12 }, // Double-Time
      { wch: 12 }  // Total Payable
    ];
    detailsWs['!cols'] = detailsColWidths;
    
    // Add the details worksheet to the workbook
    XLSX.utils.book_append_sheet(wb, detailsWs, 'Daily Records');
  }
  
  // Create statistics worksheet
  const statsData: any[] = [];
  
  // Filter info
  let filterInfo = 'All Time';
  if (data.dateRange) {
    filterInfo = `${format(new Date(data.dateRange.startDate), dateFormat)} to ${format(new Date(data.dateRange.endDate), dateFormat)}`;
  } else if (data.filterMonth && data.filterMonth !== 'all') {
    filterInfo = data.filterMonth;
  }
  
  // Add statistics rows
  statsData.push(['Report Information']);
  statsData.push(['Generated On', format(new Date(), 'MM/dd/yyyy HH:mm:ss')]);
  statsData.push(['Date Range', filterInfo]);
  statsData.push(['']);
  
  statsData.push(['Total Employees', totalEmployees]);
  statsData.push(['Total Working Days', totalWorkingDays]);
  statsData.push(['Total Off Days', totalOffDays]);
  statsData.push(['Total Regular Hours', totalRegularHours.toFixed(2)]);
  statsData.push(['Total Double-Time Hours', totalDoubleTimeHours.toFixed(2)]);
  statsData.push(['Total Payable Hours', totalPayableHours.toFixed(2)]);
  
  // Create the statistics worksheet
  const statsWs = XLSX.utils.aoa_to_sheet(statsData);
  
  // Add the statistics worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, statsWs, 'Statistics');
  
  // Generate filename with timestamp
  const filename = `approved_hours_${format(new Date(), 'yyyy-MM-dd_HH-mm-ss')}.xlsx`;
  
  // Save the workbook
  XLSX.writeFile(wb, filename);
};

// Function to handle Excel file import
export const handleExcelFile = async (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Assumes the first sheet is the one we want
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        // Process the data as needed
        // ...
        
        resolve(jsonData as any[]);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = (error) => {
      reject(error);
    };
    
    reader.readAsArrayBuffer(file);
  });
};