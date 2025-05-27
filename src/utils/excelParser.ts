import * as XLSX from 'xlsx';
import { format, parse, isValid } from 'date-fns';
import { TimeRecord } from '../types';

/**
 * Process workbook and extract time records
 */
export const processWorkbook = (workbook: XLSX.WorkBook): TimeRecord[] => {
  // Get the first sheet
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON
  const jsonData = XLSX.utils.sheet_to_json(worksheet);
  
  // Extract time records
  const records: TimeRecord[] = [];
  
  jsonData.forEach((row: any, index) => {
    // Check if row has required fields
    if (!row['Department'] || !row['Name'] || !row['Employee No'] || !row['Date/Time'] || !row['Status']) {
      return;
    }
    
    // Parse date/time
    const timestamp = parseDateTime(row['Date/Time']);
    if (!timestamp) {
      console.warn(`Invalid date/time format at row ${index + 2}: ${row['Date/Time']}`);
      return;
    }
    
    // Create time record
    const record: TimeRecord = {
      department: row['Department'],
      name: row['Name'],
      employeeNumber: String(row['Employee No']),
      timestamp,
      status: row['Status'].toLowerCase() === 'c/in' ? 'check_in' : 'check_out',
      originalIndex: index
    };
    
    records.push(record);
  });
  
  return records;
};

/**
 * Parse date/time from various formats
 */
export const parseDateTime = (dateTimeStr: string): Date | null => {
  if (!dateTimeStr) return null;
  
  // Try different date formats
  const formats = [
    'MM/dd/yyyy HH:mm:ss',
    'MM/dd/yyyy h:mm:ss a',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy/MM/dd HH:mm:ss',
    'dd/MM/yyyy HH:mm:ss',
    'dd-MM-yyyy HH:mm:ss'
  ];
  
  for (const format of formats) {
    try {
      const date = parse(dateTimeStr, format, new Date());
      if (isValid(date)) {
        return date;
      }
    } catch (e) {
      // Continue to next format
    }
  }
  
  // If all formats fail, try direct Date parsing
  try {
    const date = new Date(dateTimeStr);
    if (isValid(date)) {
      return date;
    }
  } catch (e) {
    // Failed to parse
  }
  
  return null;
};