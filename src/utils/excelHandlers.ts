import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';

// Export data to Excel file
export const exportToExcel = (employeeRecords: EmployeeRecord[]) => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Create data for the summary sheet
  const summaryData = employeeRecords.map(employee => {
    // Calculate total days worked (excluding OFF-DAYs)
    const workingDays = employee.days.filter(day => day.notes !== 'OFF-DAY' && day.hoursWorked > 0).length;
    
    // Calculate off days
    const offDays = employee.days.filter(day => day.notes === 'OFF-DAY' || day.hoursWorked === 0).length;
    
    // Calculate total hours
    const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
    
    // Calculate overtime days (days with more than 9 hours)
    const overtimeDays = employee.days.filter(day => day.hoursWorked > 9).length;
    
    // Calculate total overtime hours
    const overtimeHours = employee.days.reduce((sum, day) => {
      const overtimeForDay = day.hoursWorked > 9 ? day.hoursWorked - 9 : 0;
      return sum + overtimeForDay;
    }, 0);
    
    // Calculate Fridays worked
    const fridaysWorked = employee.days.filter(day => {
      const date = new Date(day.date);
      return date.getDay() === 5 && day.hoursWorked > 0; // 5 = Friday
    }).length;
    
    return {
      'Employee Number': employee.employeeNumber,
      'Name': employee.name,
      'Total Days': workingDays + offDays,
      'Total Working Days': workingDays,
      'Off-Days': offDays, // Moved next to Total Working Days
      'Regular Hours': totalHours,
      'Double-Time Hours': 0, // Placeholder for double-time hours
      'Fridays Worked': fridaysWorked,
      'Over Time (Hours)': overtimeHours.toFixed(2),
      'Over Time (Days)': overtimeDays,
      'Total Payable Hours': totalHours
    };
  });
  
  // Create a worksheet for the summary
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);
  
  // Add the summary worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  
  // Create data for the detailed sheet
  const detailedData: any[] = [];
  
  employeeRecords.forEach(employee => {
    employee.days.forEach(day => {
      // Format check-in and check-out times
      let checkInDisplay = day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing';
      let checkOutDisplay = day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing';
      
      // For OFF-DAYs, show OFF-DAY instead of Missing
      if (day.notes === 'OFF-DAY') {
        checkInDisplay = 'OFF-DAY';
        checkOutDisplay = 'OFF-DAY';
      }
      
      // Add warning indicators for late check-in and early leave
      if (day.isLate) {
        checkInDisplay = '⚠ ' + checkInDisplay;
      }
      
      if (day.earlyLeave) {
        checkOutDisplay = '⚠ ' + checkOutDisplay;
      }
      
      detailedData.push({
        'Date': day.date,
        'Employee Number': employee.employeeNumber,
        'Name': employee.name,
        'Check In': checkInDisplay,
        'Check Out': checkOutDisplay,
        'Shift Type': day.shiftType || 'Unknown',
        'Hours': day.hoursWorked.toFixed(2),
        'Double-Time': day.date.includes('2x') ? day.hoursWorked.toFixed(2) : '—',
        'Status': day.approved ? 'Approved' : 'Pending',
        'Notes': day.notes || ''
      });
    });
  });
  
  // Create a worksheet for the detailed data
  const detailedWs = XLSX.utils.json_to_sheet(detailedData);
  
  // Add the detailed worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, detailedWs, 'Detailed');
  
  // Export the workbook
  XLSX.writeFile(wb, `Employee_Hours_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

// Export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any) => {
  // Create a new workbook
  const wb = XLSX.utils.book_new();
  
  // Extract data
  const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
  
  // Create data for the summary sheet
  const summaryData = summary.map((employee: any) => {
    // Calculate double-time hours
    const doubleTimeHours = employee.double_time_hours || 0;
    const regularHours = employee.total_hours || 0;
    const totalPayableHours = regularHours + doubleTimeHours;
    
    // Calculate off days if we have working_week_dates
    let offDays = 0;
    let workingDays = 0;
    
    if (employee.working_week_dates) {
      // Count days with 0 hours as off days, and days with >0 hours as working days
      employee.working_week_dates.forEach((date: string) => {
        const hours = employee.hours_by_date?.[date] || 0;
        if (hours === 0) {
          offDays++;
        } else {
          workingDays++;
        }
      });
    } else {
      // Fallback if we don't have detailed data
      workingDays = employee.total_days - offDays;
    }
    
    return {
      'Employee Number': employee.employee_number,
      'Name': employee.name,
      'Total Days': employee.total_days,
      'Total Working Days': workingDays,
      'Off-Days': offDays, // Moved next to Total Working Days
      'Regular Hours': regularHours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Total Payable Hours': totalPayableHours.toFixed(2)
    };
  });
  
  // Create a worksheet for the summary
  const summaryWs = XLSX.utils.json_to_sheet(summaryData);
  
  // Add the summary worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
  
  // Create data for the detailed sheet
  const detailedData: any[] = [];
  
  if (details && details.length > 0) {
    details.forEach((record: any) => {
      // Check if this is an off day
      const isOffDay = record.status === 'off_day';
      
      // Check if this is a double-time day
      const isDoubleTime = doubleDays.includes(record.working_week_start || '');
      
      // Format check-in and check-out times
      let checkInDisplay = isOffDay ? 'OFF-DAY' : 
                          (record.display_check_in || formatTimestamp(record.timestamp, record.status === 'check_in'));
      
      let checkOutDisplay = isOffDay ? 'OFF-DAY' : 
                           (record.display_check_out || 'Missing');
      
      // Calculate hours - use exact_hours if available
      let hours = 0;
      if (record.exact_hours !== null && record.exact_hours !== undefined) {
        hours = parseFloat(record.exact_hours);
      }
      
      // For off days, ensure hours are 0
      if (isOffDay) {
        hours = 0;
      }
      
      // Calculate double-time hours
      const doubleTimeHours = isDoubleTime ? hours : 0;
      
      detailedData.push({
        'Date': record.working_week_start || formatDate(record.timestamp),
        'Employee Number': record.employees?.employee_number || '',
        'Name': record.employees?.name || '',
        'Check In': checkInDisplay,
        'Check Out': checkOutDisplay,
        'Shift Type': isOffDay ? 'OFF-DAY' : (record.shift_type || 'Unknown'),
        'Hours': hours.toFixed(2),
        'Double-Time': doubleTimeHours.toFixed(2),
        'Status': 'Approved',
        'Notes': record.notes || ''
      });
    });
  }
  
  // Create a worksheet for the detailed data
  const detailedWs = XLSX.utils.json_to_sheet(detailedData);
  
  // Add the detailed worksheet to the workbook
  XLSX.utils.book_append_sheet(wb, detailedWs, 'Detailed');
  
  // Create a title for the export file
  let fileTitle = 'Approved_Hours';
  
  // Add date range or month to the title if available
  if (filterMonth === 'custom' && dateRange) {
    fileTitle += `_${dateRange.startDate}_to_${dateRange.endDate}`;
  } else if (filterMonth !== 'all') {
    fileTitle += `_${filterMonth}`;
  }
  
  // Export the workbook
  XLSX.writeFile(wb, `${fileTitle}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
};

// Helper function to format timestamp for display
const formatTimestamp = (timestamp: string, isCheckIn: boolean): string => {
  if (!timestamp) return 'Missing';
  
  try {
    const date = new Date(timestamp);
    return format(date, 'HH:mm');
  } catch (error) {
    return isCheckIn ? 'Invalid Check-In' : 'Invalid Check-Out';
  }
};

// Helper function to format date
const formatDate = (timestamp: string): string => {
  if (!timestamp) return '';
  
  try {
    const date = new Date(timestamp);
    return format(date, 'yyyy-MM-dd');
  } catch (error) {
    return 'Invalid Date';
  }
};

// Process Excel file and extract time records
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Process the workbook to extract employee records
        const records = processWorkbook(workbook);
        resolve(records);
      } catch (error) {
        reject(new Error('Failed to process Excel file. Please check the file format.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read the file. Please try again.'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Process workbook and extract employee records
const processWorkbook = (workbook: XLSX.WorkBook): EmployeeRecord[] => {
  // Get the first sheet
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert sheet to JSON
  const data = XLSX.utils.sheet_to_json(worksheet);
  
  // Process the data to extract employee records
  // This is a placeholder - you'll need to implement the actual logic
  // based on your Excel file structure
  
  // For now, return an empty array
  return [];
};