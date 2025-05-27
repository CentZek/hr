import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { EmployeeRecord } from '../types';

// Parse Excel file containing time records
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error('No data could be read from the file'));
          return;
        }

        // Parse the Excel file
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

        // Check if we have data
        if (!jsonData.length) {
          reject(new Error('No data found in the Excel file'));
          return;
        }

        // Process the records (implementation specific to your application)
        const processedRecords = processExcelData(jsonData);
        resolve(processedRecords);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => {
      reject(new Error('Error reading the file'));
    };
    reader.readAsBinaryString(file);
  });
};

// Process the Excel data (mock implementation - replace with your actual processing logic)
const processExcelData = (data: any[]): EmployeeRecord[] => {
  // This is a mock implementation - replace with your actual logic
  const employeeMap = new Map<string, EmployeeRecord>();

  data.forEach((row, index) => {
    // Mock processing - replace with your actual data extraction
    const employeeNumber = row['EmployeeNumber'] || row['Employee Number'] || 'Unknown';
    const name = row['Name'] || row['Employee Name'] || 'Unknown';
    const department = row['Department'] || 'Unknown';
    
    // Create employee if not exists
    if (!employeeMap.has(employeeNumber)) {
      employeeMap.set(employeeNumber, {
        employeeNumber,
        name,
        department,
        days: [],
        totalDays: 0,
        expanded: false
      });
    }
  });

  return Array.from(employeeMap.values());
};

// Export data to Excel file
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  // Create a new workbook
  const workbook = XLSX.utils.book_new();
  
  // Convert employee data to sheet
  const sheetData = employeeRecords.map(employee => ({
    'Employee Number': employee.employeeNumber,
    'Name': employee.name,
    'Department': employee.department,
    'Total Days': employee.totalDays,
    // Add more fields as needed
  }));
  
  const worksheet = XLSX.utils.json_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Employee Data');
  
  // Export to file
  XLSX.writeFile(workbook, `Employee_Data_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

// Export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any): void => {
  // Create a new workbook
  const workbook = XLSX.utils.book_new();
  
  // Extract data from the input
  const { summary, details, filterMonth, dateRange, doubleDays } = data;
  
  // Create summary sheet
  const summaryData = [];
  
  // Add header row
  summaryData.push([
    'Employee Number',
    'Name',
    'Total Days',
    'Regular Hours',
    'Double-Time Hours',
    'Fridays Worked',
    'Over Time (Hours)',
    'Over Time (Days)',
    'Total Payable Hours',
    'Off-Days (Days)',
    'Holidays Worked (Days)'
  ]);
  
  // Add employee data rows
  summary.forEach(employee => {
    // Calculate overtime (hours > 9 per day)
    const overtimeHours = employee.working_week_dates?.reduce((total, date) => {
      const hoursForDay = employee.hours_by_date?.[date] || 0;
      const overtimeForDay = Math.max(0, hoursForDay - 9);
      return total + overtimeForDay;
    }, 0) || 0;
    
    // Count days with overtime
    const overtimeDays = employee.working_week_dates?.filter(date => 
      (employee.hours_by_date?.[date] || 0) > 9
    ).length || 0;
    
    // Calculate total payable hours (regular + double-time)
    const totalPayableHours = (employee.total_hours || 0) + (employee.double_time_hours || 0);
    
    // Add row
    summaryData.push([
      employee.employee_number,
      employee.name,
      employee.total_days,
      employee.total_hours.toFixed(2),
      employee.double_time_hours?.toFixed(2) || '0.00',
      employee.fridaysWorked || '0',
      overtimeHours.toFixed(2),
      overtimeDays,
      totalPayableHours.toFixed(2),
      employee.offDays || '0',
      employee.holidaysWorked || '0'
    ]);
  });
  
  // Create and append summary sheet
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summaryWs, 'Summary');
  
  // Set column widths
  const summaryColWidths = [
    { wch: 15 }, // Employee Number
    { wch: 25 }, // Name
    { wch: 10 }, // Total Days
    { wch: 12 }, // Regular Hours
    { wch: 15 }, // Double-Time Hours
    { wch: 15 }, // Fridays Worked
    { wch: 15 }, // Over Time (Hours)
    { wch: 15 }, // Over Time (Days)
    { wch: 18 }, // Total Payable Hours
    { wch: 15 }, // Off-Days (Days)
    { wch: 18 }  // Holidays Worked (Days)
  ];
  summaryWs['!cols'] = summaryColWidths;
  
  // Create details sheet if we have details
  if (details && details.length > 0) {
    const detailsData = [];
    
    // Add header row
    detailsData.push([
      'Employee',
      'Employee Number',
      'Date',
      'Day of Week',
      'Check In',
      'Check Out',
      'Hours',
      'Shift Type',
      'Is Double-Time',
      'Notes'
    ]);
    
    // Add record data rows
    details.forEach(record => {
      const recordDate = new Date(record.timestamp);
      const dayOfWeek = format(recordDate, 'EEEE');
      
      // Check if this is a double-time day
      const isDoubleTime = doubleDays?.includes(format(recordDate, 'yyyy-MM-dd')) || false;
      
      // Get display values or actual timestamp
      const checkInTime = record.display_check_in || format(recordDate, 'HH:mm');
      
      // For check-out, we need to find the paired record
      let checkOutTime = 'Missing';
      let hours = 0;
      
      detailsData.push([
        record.employees?.name || 'Unknown',
        record.employees?.employee_number || 'Unknown',
        format(recordDate, 'yyyy-MM-dd'),
        dayOfWeek,
        checkInTime,
        checkOutTime,
        hours.toFixed(2),
        record.shift_type || 'Unknown',
        isDoubleTime ? 'Yes' : 'No',
        record.notes || ''
      ]);
    });
    
    // Create and append details sheet
    const detailsWs = XLSX.utils.aoa_to_sheet(detailsData);
    XLSX.utils.book_append_sheet(workbook, detailsWs, 'Details');
    
    // Set column widths
    const detailsColWidths = [
      { wch: 25 }, // Employee
      { wch: 15 }, // Employee Number
      { wch: 12 }, // Date
      { wch: 12 }, // Day of Week
      { wch: 10 }, // Check In
      { wch: 10 }, // Check Out
      { wch: 8 },  // Hours
      { wch: 12 }, // Shift Type
      { wch: 12 }, // Is Double-Time
      { wch: 30 }  // Notes
    ];
    detailsWs['!cols'] = detailsColWidths;
  }
  
  // Generate filename with date range or month
  let filename = 'Approved_Hours';
  if (dateRange && dateRange.startDate && dateRange.endDate) {
    filename += `_${dateRange.startDate}_to_${dateRange.endDate}`;
  } else if (filterMonth && filterMonth !== 'all') {
    filename += `_${filterMonth}`;
  } else {
    filename += `_${format(new Date(), 'yyyy-MM-dd')}`;
  }
  
  // Export to file
  XLSX.writeFile(workbook, `${filename}.xlsx`);
};