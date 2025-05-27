import * as XLSX from 'xlsx';
import { format, parseISO, isValid } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';

/**
 * Processes and exports Excel file data to JSON
 */
export const handleExcelFile = async (file: File): Promise<any[]> => {
  try {
    // Read Excel file
    const data = await readExcelFile(file);
    
    if (!data || data.length === 0) {
      throw new Error('No data found in Excel file');
    }
    
    // Further processing logic specific to time records would go here
    // This part would be specific to the application's data format
    
    return processTimeRecords(data);
  } catch (error) {
    console.error('Error handling Excel file:', error);
    throw error;
  }
};

/**
 * Reads an Excel file and returns its content as JSON
 */
const readExcelFile = async (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error('Failed to read file'));
          return;
        }
        
        // Parse Excel file
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet);
        
        resolve(jsonData);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading file'));
    };
    
    reader.readAsBinaryString(file);
  });
};

/**
 * Process time records from Excel data
 * This is a placeholder for the actual processing logic
 */
const processTimeRecords = (data: any[]): any[] => {
  // Implement your specific processing logic here
  // This is just a placeholder
  return data;
};

/**
 * Export employee records to Excel
 */
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  try {
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    
    // Convert employee records to rows for Excel
    const rows = employeeRecords.map(employee => {
      const regularHours = employee.days
        .filter(day => day.notes !== 'OFF-DAY')
        .reduce((sum, day) => sum + day.hoursWorked, 0);
      
      return {
        'Employee Number': employee.employeeNumber,
        'Name': employee.name,
        'Total Days': employee.totalDays,
        'Regular Hours': regularHours.toFixed(2),
        'Double-Time Hours': 0, // Placeholder, would need calculation logic
        'Working Days': employee.days.filter(day => day.notes !== 'OFF-DAY').length,
        'Off Days': employee.days.filter(day => day.notes === 'OFF-DAY').length,
        'Fridays Worked': 0, // Placeholder
        'Over Time (Hours)': 0, // Placeholder
        'Over Time (Days)': 0, // Placeholder
        'Total Payable Hours': regularHours.toFixed(2) // Would include double time calculation
      };
    });
    
    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(rows);
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Employee Hours');
    
    // Generate Excel file and trigger download
    XLSX.writeFile(workbook, 'employee_hours.xlsx');
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Failed to export data to Excel');
  }
};

/**
 * Export approved hours to Excel (with more detailed data)
 */
export const exportApprovedHoursToExcel = (data: any): void => {
  try {
    const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
    const workbook = XLSX.utils.book_new();
    
    // Format date range for filename
    let filename = 'approved_hours';
    if (dateRange && dateRange.startDate && dateRange.endDate) {
      const startFormatted = format(new Date(dateRange.startDate), 'yyyyMMdd');
      const endFormatted = format(new Date(dateRange.endDate), 'yyyyMMdd');
      filename += `_${startFormatted}_to_${endFormatted}`;
    } else if (filterMonth && filterMonth !== 'all') {
      filename += `_${filterMonth}`;
    }
    filename += '.xlsx';
    
    // Summary sheet
    const summaryRows = summary.map(employee => {
      // Calculate total payable hours (regular + double-time)
      const regularHours = parseFloat(employee.total_hours.toFixed(2));
      const doubleTimeHours = employee.double_time_hours || 0;
      const totalPayableHours = regularHours + doubleTimeHours;
      
      // Get working days and off days counts
      const totalDays = employee.total_days || 0;
      const offDaysCount = employee.off_days_count || 0;
      const workingDays = employee.working_days !== undefined ? employee.working_days : (totalDays - offDaysCount);
      
      return {
        'Employee Number': employee.employee_number,
        'Name': employee.name,
        'Total Days': totalDays,
        'Working Days': workingDays,
        'Off Days': offDaysCount,
        'Regular Hours': regularHours.toFixed(2),
        'Double-Time Hours': doubleTimeHours.toFixed(2),
        'Fridays Worked': employee.working_week_dates?.filter((date: string) => 
          new Date(date).getDay() === 5 // 5 = Friday
        ).length || 0,
        'Over Time (Hours)': '0.00', // Placeholder, would need actual calculation
        'Over Time (Days)': '0', // Placeholder, would need actual calculation
        'Total Payable Hours': totalPayableHours.toFixed(2)
      };
    });
    
    if (summaryRows.length > 0) {
      const summaryWorksheet = XLSX.utils.json_to_sheet(summaryRows);
      XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary');
      
      // Format column widths
      const summaryColWidths = [
        { wch: 15 }, // Employee Number
        { wch: 25 }, // Name
        { wch: 10 }, // Total Days
        { wch: 12 }, // Working Days
        { wch: 10 }, // Off Days
        { wch: 15 }, // Regular Hours
        { wch: 18 }, // Double-Time Hours
        { wch: 15 }, // Fridays Worked
        { wch: 18 }, // Over Time (Hours)
        { wch: 18 }, // Over Time (Days)
        { wch: 20 }, // Total Payable Hours
      ];
      summaryWorksheet['!cols'] = summaryColWidths;
    }
    
    // Details sheet - only if details are available
    if (details && details.length > 0) {
      // Group details by employee
      const detailsByEmployee: Record<string, any[]> = {};
      
      details.forEach((record: any) => {
        const employeeId = record.employee_id;
        if (!detailsByEmployee[employeeId]) {
          detailsByEmployee[employeeId] = [];
        }
        detailsByEmployee[employeeId].push(record);
      });
      
      // Create a details sheet for each employee
      Object.entries(detailsByEmployee).forEach(([employeeId, records]) => {
        // Find the employee name
        const employee = summary.find(emp => emp.id === employeeId);
        if (!employee) return;
        
        const sheetName = `${employee.name.substring(0, 20)}_Details`; // Limit sheet name length
        
        // Format records for Excel
        const detailRows = records.map((record: any) => {
          const date = record.timestamp ? new Date(record.timestamp) : null;
          const dateStr = record.working_week_start || (date ? format(date, 'yyyy-MM-dd') : '');
          const isDoubleTime = doubleDays.includes(dateStr);
          
          return {
            'Date': dateStr,
            'Status': record.status,
            'Check In': record.display_check_in || 'Missing',
            'Check Out': record.display_check_out || 'Missing',
            'Shift Type': record.shift_type || 'Unknown',
            'Hours': parseFloat(record.exact_hours || 0).toFixed(2),
            'Double-Time': isDoubleTime ? 'Yes' : 'No',
            'Notes': (record.notes || '').replace(/hours:\d+\.\d+;?\s*/, '')
          };
        });
        
        if (detailRows.length > 0) {
          const detailWorksheet = XLSX.utils.json_to_sheet(detailRows);
          XLSX.utils.book_append_sheet(workbook, detailWorksheet, sheetName);
          
          // Format column widths
          const detailColWidths = [
            { wch: 12 }, // Date
            { wch: 10 }, // Status
            { wch: 10 }, // Check In
            { wch: 10 }, // Check Out
            { wch: 12 }, // Shift Type
            { wch: 8 },  // Hours
            { wch: 12 }, // Double-Time
            { wch: 40 }  // Notes
          ];
          detailWorksheet['!cols'] = detailColWidths;
        }
      });
    }
    
    // Generate Excel file and trigger download
    XLSX.writeFile(workbook, filename);
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    alert('Failed to export approved hours to Excel');
  }
};