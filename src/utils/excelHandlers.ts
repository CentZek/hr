import * as XLSX from 'xlsx';
import { format, parseISO, isFriday } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';

// Helper function to create a workbook
const createWorkbook = () => {
  return XLSX.utils.book_new();
};

// Helper function to add a worksheet to a workbook
const addWorksheet = (workbook: any, data: any[], sheetName: string) => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
};

// Helper function to download a workbook
const downloadWorkbook = (workbook: any, fileName: string) => {
  XLSX.writeFile(workbook, fileName);
};

// Function to handle Excel file processing
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get the first sheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        // Process the data and convert to employee records
        const records: EmployeeRecord[] = processExcelData(jsonData);
        
        resolve(records);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Error processing file'));
      }
    };
    
    reader.onerror = (error) => {
      reject(new Error('Error reading file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Helper function to process Excel data
const processExcelData = (jsonData: any[]): EmployeeRecord[] => {
  // Group data by employee
  const employeeMap = new Map<string, EmployeeRecord>();
  
  jsonData.forEach((row) => {
    // Extract employee data from row
    const employeeNumber = row.EmployeeNumber || row.employee_number || '';
    const name = row.Name || row.name || '';
    const department = row.Department || row.department || '';
    
    // Extract date and time data
    const date = row.Date || row.date || '';
    const checkInTime = row.CheckIn || row['Check In'] || row.check_in || null;
    const checkOutTime = row.CheckOut || row['Check Out'] || row.check_out || null;
    
    // Skip rows without employee number or date
    if (!employeeNumber || !date) return;
    
    // Convert check-in and check-out to Date objects
    let firstCheckIn = null;
    let lastCheckOut = null;
    
    if (checkInTime) {
      try {
        const dateTime = typeof date === 'string' ? 
          `${date} ${checkInTime}` : 
          new Date(date).toISOString().split('T')[0] + ` ${checkInTime}`;
        firstCheckIn = new Date(dateTime);
      } catch (e) {
        console.error('Error parsing check-in time:', e);
      }
    }
    
    if (checkOutTime) {
      try {
        const dateTime = typeof date === 'string' ? 
          `${date} ${checkOutTime}` : 
          new Date(date).toISOString().split('T')[0] + ` ${checkOutTime}`;
        lastCheckOut = new Date(dateTime);
      } catch (e) {
        console.error('Error parsing check-out time:', e);
      }
    }
    
    // Determine if this is an existing employee
    if (!employeeMap.has(employeeNumber)) {
      // Create new employee record
      employeeMap.set(employeeNumber, {
        employeeNumber,
        name,
        department,
        days: [],
        totalDays: 0,
        expanded: false
      });
    }
    
    // Get the employee record
    const employee = employeeMap.get(employeeNumber)!;
    
    // Create a daily record
    const dailyRecord: DailyRecord = {
      date: typeof date === 'string' ? date : format(new Date(date), 'yyyy-MM-dd'),
      firstCheckIn,
      lastCheckOut,
      hoursWorked: calculateHoursWorked(firstCheckIn, lastCheckOut),
      approved: false,
      shiftType: determineShiftType(firstCheckIn),
      notes: row.Notes || row.notes || '',
      missingCheckIn: !firstCheckIn,
      missingCheckOut: !lastCheckOut,
      isLate: false, // This will be calculated later
      earlyLeave: false, // This will be calculated later
      excessiveOvertime: false, // This will be calculated later
      penaltyMinutes: 0
    };
    
    // Add the daily record to the employee
    employee.days.push(dailyRecord);
    employee.totalDays++;
  });
  
  // Convert map to array and sort days
  const employees = Array.from(employeeMap.values());
  
  // Sort days for each employee
  employees.forEach(employee => {
    employee.days.sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  });
  
  return employees;
};

// Helper function to calculate hours worked between check-in and check-out
const calculateHoursWorked = (checkIn: Date | null, checkOut: Date | null): number => {
  if (!checkIn || !checkOut) return 0;
  
  // Calculate the time difference in milliseconds
  const diffMs = checkOut.getTime() - checkIn.getTime();
  
  // Convert to hours
  return diffMs / (1000 * 60 * 60);
};

// Helper function to determine shift type based on check-in time
const determineShiftType = (checkIn: Date | null): string | null => {
  if (!checkIn) return null;
  
  const hour = checkIn.getHours();
  
  if (hour >= 4 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 18) return 'evening';
  return 'night';
};

// Export employee records to Excel
export const exportToExcel = (employeeRecords: EmployeeRecord[]) => {
  // Create a new workbook
  const workbook = createWorkbook();

  // Prepare data for summary sheet
  const summaryData = employeeRecords.map(employee => {
    // Calculate total hours
    const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
    
    // Calculate total days with hours > 0
    const totalDaysWithHours = employee.days.filter(day => day.hoursWorked > 0).length;
    
    return {
      'Employee Number': employee.employeeNumber,
      'Name': employee.name,
      'Department': employee.department,
      'Total Days': totalDaysWithHours,
      'Total Hours': totalHours.toFixed(2),
      'Average Hours/Day': totalDaysWithHours > 0 ? (totalHours / totalDaysWithHours).toFixed(2) : '0.00'
    };
  });

  // Add summary sheet
  addWorksheet(workbook, summaryData, 'Summary');

  // Add detailed sheets for each employee
  employeeRecords.forEach(employee => {
    const detailedData = employee.days.map(day => {
      return {
        'Date': day.date,
        'Check In': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'Missing',
        'Check Out': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'Missing',
        'Hours': day.hoursWorked.toFixed(2),
        'Shift Type': day.shiftType || 'Unknown',
        'Status': day.approved ? 'Approved' : 'Pending',
        'Penalty (min)': day.penaltyMinutes,
        'Notes': day.notes
      };
    });

    // Add detailed sheet
    addWorksheet(workbook, detailedData, `${employee.name.substring(0, 20)}`);
  });

  // Download the workbook
  downloadWorkbook(workbook, 'Employee_Time_Records.xlsx');
};

// Export approved hours to Excel with additional metrics
export const exportApprovedHoursToExcel = (data: any) => {
  const { summary, details, filterMonth, doubleDays } = data;
  
  // Create a new workbook
  const workbook = createWorkbook();
  
  // Prepare data for summary sheet with additional metrics
  const summaryData = summary.map((employee: any) => {
    // Calculate total days with hours > 0
    const workingDates = employee.working_week_dates || [];
    const daysWithHours = workingDates.filter((date: string) => 
      (employee.hours_by_date?.[date] || 0) > 0
    ).length;
    
    // Calculate total regular hours
    const regularHours = employee.total_hours || 0;
    
    // Calculate double-time hours
    const doubleTimeHours = employee.double_time_hours || 0;
    
    // Calculate total payable hours (regular + double-time)
    const totalPayableHours = regularHours + doubleTimeHours;
    
    // Calculate Fridays worked
    const fridaysWorked = workingDates.filter((date: string) => {
      try {
        return isFriday(parseISO(date));
      } catch (e) {
        return false;
      }
    }).length;
    
    // Calculate overtime hours (hours over 9 per day)
    let overtimeHours = 0;
    workingDates.forEach((date: string) => {
      const hoursForDay = employee.hours_by_date?.[date] || 0;
      if (hoursForDay > 9) {
        overtimeHours += (hoursForDay - 9);
      }
    });
    
    // Calculate overtime days
    const overtimeDays = overtimeHours > 0 ? (overtimeHours / 9).toFixed(2) : '0.00';
    
    return {
      'Employee Number': employee.employee_number,
      'Name': employee.name,
      'Total Days': daysWithHours,
      'Regular Hours': regularHours.toFixed(2),
      'Double-Time Hours': doubleTimeHours.toFixed(2),
      'Fridays Worked': fridaysWorked,
      'Over Time (Hours)': overtimeHours.toFixed(2),
      'Over Time (Days)': overtimeDays,
      'Total Payable Hours': totalPayableHours.toFixed(2)
    };
  });

  // Add summary sheet
  addWorksheet(workbook, summaryData, 'Summary');
  
  // Add detailed sheets for each employee with records
  summary.forEach((employee: any) => {
    // Get details for this employee
    const employeeDetails = details.filter((record: any) => record.employeeId === employee.id);
    
    if (employeeDetails.length === 0) return; // Skip if no details
    
    const detailedData = employeeDetails.map((record: any) => {
      // Determine if this is a double-time day
      const isDoubleTime = doubleDays.includes(record.date);
      
      // Get hours for this day
      const hoursForDay = employee.hours_by_date?.[record.date] || 0;
      
      // Calculate overtime (hours over 9)
      const overtimeHours = hoursForDay > 9 ? (hoursForDay - 9).toFixed(2) : '0.00';
      
      // Determine if this is a Friday
      let isFridayDay = false;
      try {
        isFridayDay = isFriday(parseISO(record.date));
      } catch (e) {
        // Handle parsing error
      }
      
      return {
        'Date': record.date,
        'Check In': record.checkIn ? formatRecordTime(record.checkIn, 'check_in') : 'Missing',
        'Check Out': record.checkOut ? formatRecordTime(record.checkOut, 'check_out') : 'Missing',
        'Hours': hoursForDay.toFixed(2),
        'Shift Type': record.shiftType || 'Unknown',
        'Double-Time': isDoubleTime ? 'Yes' : 'No',
        'Friday': isFridayDay ? 'Yes' : 'No',
        'Overtime Hours': overtimeHours,
        'Notes': record.notes || ''
      };
    });

    // Add detailed sheet
    const sheetName = `${employee.name.substring(0, 20)}`;
    addWorksheet(workbook, detailedData, sheetName);
  });

  // Download the workbook
  const fileName = filterMonth ? 
    `Approved_Hours_${filterMonth}.xlsx` : 
    `Approved_Hours_All_Time.xlsx`;
  
  downloadWorkbook(workbook, fileName);
};

// Helper function to format record time
const formatRecordTime = (record: any, field: 'check_in' | 'check_out'): string => {
  // For Excel-imported data, prefer the display value
  if (!record.is_manual_entry && record[`display_${field}`] && record[`display_${field}`] !== 'Missing') {
    return record[`display_${field}`];
  }
  
  // For manual entries, use the standard display logic
  if (record.is_manual_entry) {
    // Check if the record has a display value to use
    if (record[`display_${field}`] && record[`display_${field}`] !== 'Missing') {
      return record[`display_${field}`];
    }
    
    // If we have a shift type, use standard times
    if (record.shift_type) {
      const displayTimes = {
        morning: { check_in: '05:00', check_out: '14:00' },
        evening: { check_in: '13:00', check_out: '22:00' },
        night: { check_in: '21:00', check_out: '06:00' },
        canteen: { check_in: '07:00', check_out: '16:00' }
      };
      
      const shiftType = record.shift_type;
      if (displayTimes[shiftType as keyof typeof displayTimes]) {
        return displayTimes[shiftType as keyof typeof displayTimes][field];
      }
    }
  }
  
  // Fallback to the actual timestamp if available
  if (record.timestamp) {
    try {
      const date = parseISO(record.timestamp);
      return format(date, 'HH:mm');
    } catch (err) {
      console.error("Error formatting time record:", err);
    }
  }
  
  return 'Missing';
};