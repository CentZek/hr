import * as XLSX from 'xlsx';
import { TimeRecord, EmployeeRecord } from '../types';
import { processWorkbook } from './excelParser';
import { groupRecordsByEmployee } from './recordProcessor';
import { exportToExcel, exportApprovedHoursToExcel } from './excelExporter';

/**
 * Process Excel file and extract time records
 */
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Process the workbook to extract time records
        const records = processWorkbook(workbook);
        
        // Group records by employee
        const employeeRecords = groupRecordsByEmployee(records);
        
        resolve(employeeRecords);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file. Please check the format.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read the file.'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Re-export functions from other modules for backward compatibility
export { exportToExcel, exportApprovedHoursToExcel };