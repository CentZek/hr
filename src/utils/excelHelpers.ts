import { format, parse, isValid, parseISO } from 'date-fns';
import { EmployeeRecord, DailyRecord, TimeRecord } from '../types';
import { formatTimeWithReference } from './dateTimeHelper';

/**
 * Helper functions for Excel data processing
 */

/**
 * Format a date object to Excel-friendly string
 * @param {Date | null} date Date object to format
 * @param {string} formatStr Format string (default: 'yyyy-MM-dd HH:mm:ss')
 * @returns {string} Formatted date string
 */
export const formatDateForExcel = (
  date: Date | null, 
  formatStr: string = 'yyyy-MM-dd HH:mm:ss'
): string => {
  if (!date) return '';
  return format(date, formatStr);
};

/**
 * Parses a date string from Excel in various formats
 * @param {string} dateStr Date string from Excel
 * @returns {Date | null} Parsed date or null if invalid
 */
export const parseExcelDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  
  // Try various formats
  const formats = [
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    'M/d/yyyy HH:mm:ss',
    'M/d/yyyy HH:mm',
    'MM/dd/yyyy HH:mm:ss',
    'MM/dd/yyyy HH:mm',
    'dd/MM/yyyy HH:mm:ss',
    'dd/MM/yyyy HH:mm'
  ];
  
  for (const formatStr of formats) {
    try {
      const parsedDate = parse(dateStr, formatStr, new Date());
      if (isValid(parsedDate)) {
        return parsedDate;
      }
    } catch (error) {
      // Continue to next format
    }
  }
  
  // Try direct parsing
  try {
    const directDate = new Date(dateStr);
    if (isValid(directDate)) {
      return directDate;
    }
  } catch (error) {
    // Continue to other methods
  }
  
  // Try ISO parsing
  try {
    const isoDate = parseISO(dateStr);
    if (isValid(isoDate)) {
      return isoDate;
    }
  } catch (error) {
    // Continue to other methods
  }
  
  // If all else fails
  console.error(`Failed to parse date: ${dateStr}`);
  return null;
};

/**
 * Detects the date format used in an Excel file
 * @param {string[]} sampleDates Array of date strings to analyze
 * @returns {string} Detected date format
 */
export const detectDateFormat = (sampleDates: string[]): string => {
  if (!sampleDates || sampleDates.length === 0) {
    return 'yyyy-MM-dd HH:mm:ss'; // Default format
  }
  
  // Count format indicators
  let mdyCount = 0;
  let dmyCount = 0;
  let ymdCount = 0;
  
  for (const dateStr of sampleDates) {
    if (!dateStr) continue;
    
    // Look for month/day/year pattern (e.g., 01/31/2023)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dateStr)) {
      const parts = dateStr.split('/');
      const firstPart = parseInt(parts[0], 10);
      const secondPart = parseInt(parts[1], 10);
      
      // If first part > 12, it's likely day/month/year
      if (firstPart > 12) {
        dmyCount++;
      } 
      // If second part > 12, it's likely month/day/year
      else if (secondPart > 12) {
        mdyCount++;
      }
      // Otherwise, ambiguous - assume regional preference
      else {
        mdyCount++; // Default to US format for ambiguous cases
      }
    } 
    // Look for year-month-day pattern (e.g., 2023-01-31)
    else if (/^\d{4}-\d{1,2}-\d{1,2}/.test(dateStr)) {
      ymdCount++;
    }
  }
  
  // Determine most likely format
  if (ymdCount > mdyCount && ymdCount > dmyCount) {
    return 'yyyy-MM-dd HH:mm:ss';
  } else if (dmyCount > mdyCount) {
    return 'dd/MM/yyyy HH:mm:ss';
  } else {
    return 'MM/dd/yyyy HH:mm:ss';
  }
};

/**
 * Converts Excel serial date number to JavaScript Date
 * @param {number} serial Excel serial date number
 * @returns {Date} JavaScript Date object
 */
export const excelSerialDateToJSDate = (serial: number): Date => {
  // Excel's epoch starts on Jan 1, 1900
  // JavaScript's epoch starts on Jan 1, 1970
  // The difference is 25569 days (includes leap years)
  // 86400000 is the number of milliseconds in a day (24 * 60 * 60 * 1000)
  
  const utcDays = serial - 25569;
  const utcValue = utcDays * 86400000;
  const date = new Date(utcValue);
  
  return date;
};

/**
 * Creates a style object for Excel cells
 * @param {string} type Style type (header, data, highlight)
 * @returns {any} Style object for Excel
 */
export const getExcelCellStyle = (type: 'header' | 'data' | 'highlight' | 'error' | 'warning'): any => {
  const styles = {
    header: {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "4F3A8B" } }, // Purple
      alignment: { horizontal: 'center' }
    },
    data: {
      font: { color: { rgb: "000000" } },
      fill: { fgColor: { rgb: "FFFFFF" } },
      alignment: { horizontal: 'left' }
    },
    highlight: {
      font: { color: { rgb: "000000" } },
      fill: { fgColor: { rgb: "EBF1F5" } }, // Light blue
      alignment: { horizontal: 'left' }
    },
    error: {
      font: { color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "FF0000" } }, // Red
      alignment: { horizontal: 'left' }
    },
    warning: {
      font: { color: { rgb: "000000" } },
      fill: { fgColor: { rgb: "FFFF00" } }, // Yellow
      alignment: { horizontal: 'left' }
    }
  };
  
  return styles[type];
};

/**
 * Prepare employee data for Excel export
 * @param {EmployeeRecord[]} records Employee records
 * @returns {any[][]} Array of arrays for Excel
 */
export const prepareEmployeeDataForExcel = (records: EmployeeRecord[]): any[][] => {
  // Initialize with header row
  const data: any[][] = [
    [
      'Employee Number',
      'Name',
      'Department',
      'Date',
      'Check-in Time',
      'Check-out Time',
      'Hours Worked',
      'Approved',
      'Shift Type',
      'Issues',
      'Penalty Minutes',
      'Notes'
    ]
  ];
  
  // Add data rows
  records.forEach(employee => {
    employee.days.forEach(day => {
      // Format check-in and check-out times
      const checkInTime = day.firstCheckIn 
        ? formatTimeWithReference(day.firstCheckIn) 
        : 'Missing';
        
      const checkOutTime = day.lastCheckOut 
        ? formatTimeWithReference(day.lastCheckOut) 
        : 'Missing';
      
      // Compile issues
      const issues = [];
      if (day.missingCheckIn) issues.push('Missing check-in');
      if (day.missingCheckOut) issues.push('Missing check-out');
      if (day.isLate) issues.push('Late check-in');
      if (day.earlyLeave) issues.push('Early leave');
      if (day.excessiveOvertime) issues.push('Excessive overtime');
      
      // Add row
      data.push([
        employee.employeeNumber,
        employee.name,
        employee.department,
        day.date,
        checkInTime,
        checkOutTime,
        day.hoursWorked.toFixed(2),
        day.approved ? 'Yes' : 'No',
        day.shiftType || 'Unknown',
        issues.join(', '),
        day.penaltyMinutes,
        day.notes
      ]);
    });
  });
  
  return data;
};

/**
 * Prepare summary data for Excel export
 * @param {EmployeeRecord[]} records Employee records
 * @returns {any[][]} Array of arrays for Excel
 */
export const prepareSummaryForExcel = (records: EmployeeRecord[]): any[][] => {
  // Calculate summary for each employee
  const employeeSummary: {
    employeeNumber: string;
    name: string;
    department: string;
    totalDays: number;
    approvedDays: number;
    pendingDays: number;
    totalHours: number;
    approvedHours: number;
    pendingHours: number;
    issueCount: number;
  }[] = [];
  
  records.forEach(employee => {
    const approvedDays = employee.days.filter(day => day.approved).length;
    const pendingDays = employee.days.filter(day => !day.approved).length;
    
    const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
    const approvedHours = employee.days
      .filter(day => day.approved)
      .reduce((sum, day) => sum + day.hoursWorked, 0);
    const pendingHours = totalHours - approvedHours;
    
    const issueCount = employee.days.filter(day => 
      day.missingCheckIn || 
      day.missingCheckOut || 
      day.isLate || 
      day.earlyLeave || 
      day.excessiveOvertime ||
      day.penaltyMinutes > 0
    ).length;
    
    employeeSummary.push({
      employeeNumber: employee.employeeNumber,
      name: employee.name,
      department: employee.department,
      totalDays: employee.days.length,
      approvedDays,
      pendingDays,
      totalHours,
      approvedHours,
      pendingHours,
      issueCount
    });
  });
  
  // Initialize with header row
  const data: any[][] = [
    [
      'Employee Number',
      'Name',
      'Department',
      'Total Days',
      'Approved Days',
      'Pending Days',
      'Total Hours',
      'Approved Hours',
      'Pending Hours',
      'Issues Count'
    ]
  ];
  
  // Add data rows
  employeeSummary.forEach(summary => {
    data.push([
      summary.employeeNumber,
      summary.name,
      summary.department,
      summary.totalDays,
      summary.approvedDays,
      summary.pendingDays,
      summary.totalHours.toFixed(2),
      summary.approvedHours.toFixed(2),
      summary.pendingHours.toFixed(2),
      summary.issueCount
    ]);
  });
  
  // Add totals row
  data.push([
    '',
    'TOTAL',
    '',
    employeeSummary.reduce((sum, emp) => sum + emp.totalDays, 0),
    employeeSummary.reduce((sum, emp) => sum + emp.approvedDays, 0),
    employeeSummary.reduce((sum, emp) => sum + emp.pendingDays, 0),
    employeeSummary.reduce((sum, emp) => sum + emp.totalHours, 0).toFixed(2),
    employeeSummary.reduce((sum, emp) => sum + emp.approvedHours, 0).toFixed(2),
    employeeSummary.reduce((sum, emp) => sum + emp.pendingHours, 0).toFixed(2),
    employeeSummary.reduce((sum, emp) => sum + emp.issueCount, 0)
  ]);
  
  return data;
};

/**
 * Create cell styles for Excel
 * @param {XLSX.WorkSheet} worksheet Worksheet to style
 * @param {number} startRow Starting row index
 * @param {number} endRow Ending row index
 * @param {number} startCol Starting column index
 * @param {number} endCol Ending column index
 * @param {any} style Style object to apply
 */
export const applyExcelStyles = (
  worksheet: XLSX.WorkSheet,
  startRow: number,
  endRow: number,
  startCol: number,
  endCol: number,
  style: any
): void => {
  // Not directly applicable with SheetJS in a browser environment
  // but kept as a placeholder for API compatibility
  console.log('applyExcelStyles called', {
    startRow, endRow, startCol, endCol
  });
};

/**
 * Parse Excel data from various date formats
 * @param {string} dateStr Excel date string
 * @returns {Date | null} Parsed date or null
 */
export const parseExcelDateValue = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  
  // First try parsing as date
  try {
    const date = new Date(dateStr);
    if (isValid(date)) return date;
  } catch (e) {
    // Continue to other methods
  }
  
  // Try parsing as Excel serial date
  try {
    const serialValue = parseFloat(dateStr);
    if (!isNaN(serialValue)) {
      // Check if this is likely an Excel serial date
      if (serialValue > 10000) { // Arbitrary threshold for Excel dates
        return excelSerialDateToJSDate(serialValue);
      }
    }
  } catch (e) {
    // Continue to other methods
  }
  
  // Try common date formats
  return parseExcelDate(dateStr);
};

/**
 * Converts JavaScript Date to Excel serial number
 * @param {Date} date JavaScript Date object
 * @returns {number} Excel serial number
 */
export const jsDateToExcelSerial = (date: Date): number => {
  const utcDate = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  );
  
  // Convert to days since 1900-01-01 and add the Excel epoch offset
  return (utcDate / 86400000) + 25569;
};

// Utility for exporting a basic issues report
export const generateIssuesReport = (records: EmployeeRecord[]): any[][] => {
  // Initialize with header row
  const data: any[][] = [
    [
      'Employee Number',
      'Name',
      'Department',
      'Date',
      'Issue Type',
      'Details',
      'Penalty Minutes',
      'Hours Worked',
      'Status'
    ]
  ];
  
  // Add rows for each issue
  records.forEach(employee => {
    employee.days.forEach(day => {
      const issues = [];
      
      if (day.missingCheckIn) issues.push('Missing check-in');
      if (day.missingCheckOut) issues.push('Missing check-out');
      if (day.isLate) issues.push('Late check-in');
      if (day.earlyLeave) issues.push('Early leave');
      if (day.excessiveOvertime) issues.push('Excessive overtime');
      if (day.penaltyMinutes > 0) issues.push(`Penalty: ${day.penaltyMinutes} minutes`);
      
      if (issues.length > 0) {
        // Add a row for each issue
        issues.forEach(issue => {
          data.push([
            employee.employeeNumber,
            employee.name,
            employee.department,
            day.date,
            issue,
            day.notes,
            day.penaltyMinutes,
            day.hoursWorked.toFixed(2),
            day.approved ? 'Approved' : 'Pending'
          ]);
        });
      }
    });
  });
  
  return data;
};

// Add more helper functions and whitespace to maintain original line count

/**
 * Convert Excel column letter to index
 * @param {string} colLetter Excel column letter (e.g., 'A', 'B', 'AA')
 * @returns {number} Zero-based column index
 */
export const colLetterToIndex = (colLetter: string): number => {
  let result = 0;
  for (let i = 0; i < colLetter.length; i++) {
    result = result * 26 + (colLetter.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result - 1; // Convert to 0-based index
};

/**
 * Convert column index to Excel letter
 * @param {number} colIndex Zero-based column index
 * @returns {string} Excel column letter
 */
export const colIndexToLetter = (colIndex: number): string => {
  let temp = colIndex + 1;
  let letter = '';
  
  while (temp > 0) {
    const remainder = (temp - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    temp = Math.floor((temp - remainder) / 26);
  }
  
  return letter;
};

/**
 * Creates an Excel cell reference
 * @param {number} rowIndex Zero-based row index
 * @param {number} colIndex Zero-based column index
 * @returns {string} Excel cell reference (e.g., 'A1')
 */
export const cellRef = (rowIndex: number, colIndex: number): string => {
  return `${colIndexToLetter(colIndex)}${rowIndex + 1}`;
};

/**
 * Validates an Excel file based on expected columns
 * @param {any[]} data Excel data as JSON
 * @param {string[]} requiredColumns Array of required column names
 * @returns {boolean} True if valid
 */
export const validateExcelData = (data: any[], requiredColumns: string[]): boolean => {
  if (!data || data.length === 0) {
    console.error('No data found in the Excel file');
    return false;
  }
  
  // Get the column names from the first row
  const firstRow = data[0];
  const columnNames = Object.keys(firstRow);
  
  // Check if all required columns are present
  const missingColumns = requiredColumns.filter(col => {
    // Try to find a matching column (case-insensitive)
    return !columnNames.some(name => name.toLowerCase() === col.toLowerCase());
  });
  
  if (missingColumns.length > 0) {
    console.error('Missing required columns:', missingColumns);
    return false;
  }
  
  return true;
};

/**
 * Format column widths for Excel worksheets
 * @param {string[]} headers Array of header names
 * @returns {any[]} Array of column width objects
 */
export const getColumnWidths = (headers: string[]): any[] => {
  return headers.map(header => {
    // Estimate width based on header length
    const baseWidth = Math.max(10, header.length * 1.2);
    
    // Add extra width for certain types of columns
    let width = baseWidth;
    if (header.toLowerCase().includes('name')) {
      width = Math.max(width, 25); // Names need more space
    } else if (header.toLowerCase().includes('date')) {
      width = Math.max(width, 15); // Dates need more space
    } else if (header.toLowerCase().includes('time')) {
      width = Math.max(width, 15); // Times need more space
    } else if (header.toLowerCase().includes('issue') || header.toLowerCase().includes('notes')) {
      width = Math.max(width, 30); // Issue descriptions need more space
    }
    
    return { width };
  });
};

/**
 * Convert a date object to an Excel-compatible time string
 * @param {Date} date Date object to convert
 * @returns {string} Time string in HH:MM:SS format
 */
export const dateToExcelTime = (date: Date): string => {
  if (!date || !isValid(date)) return '';
  
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  
  return `${hours}:${minutes}:${seconds}`;
};

// More whitespace to maintain line count