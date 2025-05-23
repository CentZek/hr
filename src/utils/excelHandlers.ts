import * as XLSX from 'xlsx';
import { DailyRecord, EmployeeRecord, TimeRecord } from '../types';
import { formatTime24H } from './dateTimeHelper';
import { calculatePayableHours, determineShiftType, isLateCheckIn, isEarlyLeave, isExcessiveOvertime, isLikelyNightShiftWorker } from './shiftCalculations';
import toast from 'react-hot-toast';

// Ensure dates are always properly normalized
const ensureDate = (dateInput: Date | string | null): Date | null => {
  if (!dateInput) return null;
  return dateInput instanceof Date ? dateInput : new Date(dateInput);
};

// Process the Excel file and return employee records
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e: ProgressEvent<FileReader>) => {
      try {
        if (!e.target?.result) {
          throw new Error('Failed to read file');
        }

        // Parse the Excel file
        const data = new Uint8Array(e.target.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        // Find the header row - this is crucial for reliable column mapping
        let headerRow = -1;
        let dateColumnIndex = -1;
        let nameColumnIndex = -1;
        let employeeNumberColumnIndex = -1;
        let statusColumnIndex = -1;
        
        // Search for header rows in first 15 rows of file to find column structure
        for (let i = 0; i < Math.min(15, jsonData.length); i++) {
          const row = jsonData[i];
          
          if (!row || row.length === 0) continue;
          
          // Convert all potential header values to lowercase strings for robust matching
          const rowAsLowerStrings = row.map(cell => String(cell).toLowerCase());
          
          // Look for key column headers in any order
          const dateIdx = rowAsLowerStrings.findIndex(h => 
            h.includes('date') || h.includes('time') || h.includes('timestamp'));
          const nameIdx = rowAsLowerStrings.findIndex(h => 
            h.includes('name') || h.includes('employee name'));
          const empNumIdx = rowAsLowerStrings.findIndex(h => 
            h.includes('employee') && (h.includes('id') || h.includes('no') || h.includes('number')));
          const statusIdx = rowAsLowerStrings.findIndex(h => 
            h.includes('status') || h.includes('check') || h.includes('type'));
          
          // If we found at least two essential columns, consider this a valid header row
          if ((dateIdx !== -1 && nameIdx !== -1) || 
              (dateIdx !== -1 && empNumIdx !== -1) ||
              (nameIdx !== -1 && statusIdx !== -1)) {
            headerRow = i;
            dateColumnIndex = dateIdx;
            nameColumnIndex = nameIdx;
            employeeNumberColumnIndex = empNumIdx;
            statusColumnIndex = statusIdx;
            break;
          }
        }
        
        if (headerRow === -1 || dateColumnIndex === -1 || 
            (nameColumnIndex === -1 && employeeNumberColumnIndex === -1)) {
          throw new Error('Could not identify required columns in the Excel file');
        }
        
        // Extract time records
        const records: TimeRecord[] = [];
        let currentIndex = 0;
        
        for (let i = headerRow + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0 || !row[dateColumnIndex]) continue;
          
          // Extract date - handle both Excel serial dates and regular date strings
          let timestamp;
          const rawDateValue = row[dateColumnIndex];
          
          if (rawDateValue instanceof Date) {
            // Direct Date object - normalize to ensure proper handling
            timestamp = new Date(rawDateValue);
          } else if (typeof rawDateValue === 'number') {
            // Excel serial date - convert to JS Date
            const excelDate = XLSX.SSF.parse_date_code(rawDateValue);
            timestamp = new Date(Date.UTC(
              excelDate.y, excelDate.m - 1, excelDate.d, 
              excelDate.H, excelDate.M, excelDate.S
            ));
          } else if (typeof rawDateValue === 'string') {
            // Try to parse string date
            const parsedDate = new Date(rawDateValue);
            if (isNaN(parsedDate.getTime())) {
              console.warn(`Skipping row ${i}, invalid date: ${rawDateValue}`);
              continue;
            }
            timestamp = parsedDate;
          } else {
            console.warn(`Skipping row ${i}, unrecognized date format`);
            continue;
          }
          
          // Get employee name
          const name = nameColumnIndex !== -1 ? 
            String(row[nameColumnIndex] || '').trim() : '';
          
          // Get employee number
          const employeeNumber = employeeNumberColumnIndex !== -1 ? 
            String(row[employeeNumberColumnIndex] || '').trim() : '';
          
          // Skip rows with empty name or employee number
          if ((!name || name.length === 0) && (!employeeNumber || employeeNumber.length === 0)) {
            continue;
          }
          
          // Get department (optional)
          const department = '';  // Default to empty if not found
          
          // Get status
          let status: 'check_in' | 'check_out' = 'check_in'; // Default
          
          if (statusColumnIndex !== -1) {
            const statusValue = row[statusColumnIndex] !== undefined ? 
              String(row[statusColumnIndex]).toLowerCase() : '';
            
            if (statusValue.includes('out') || 
                statusValue.includes('exit') || 
                statusValue.includes('leave') || 
                statusValue.includes('checkout')) {
              status = 'check_out';
            }
          }
          
          // Create and add the record
          records.push({
            department,
            name,
            employeeNumber,
            timestamp,
            status,
            originalIndex: currentIndex++,
            originalStatus: status // Store original status in case we need to swap/fix it later
          });
        }
        
        if (records.length === 0) {
          throw new Error('No valid time records found in the file');
        }
        
        // Process the raw records into employee records with daily data
        const employeeRecords = processRawRecords(records);
        resolve(employeeRecords);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(error instanceof Error ? error : new Error('Unknown error processing Excel file'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Error reading file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Group time records by employee and date
const processRawRecords = (records: TimeRecord[]): EmployeeRecord[] => {
  console.log(`Processing ${records.length} raw time records`);
  
  // Group by employee
  const employeeGroups: Record<string, TimeRecord[]> = {};
  
  records.forEach(record => {
    // Generate a consistent key for each employee
    // If employeeNumber is available, use it; otherwise fallback to name
    const employeeKey = record.employeeNumber ? 
      record.employeeNumber.trim() : 
      `name-${record.name.trim()}`;
    
    if (!employeeGroups[employeeKey]) {
      employeeGroups[employeeKey] = [];
    }
    
    employeeGroups[employeeKey].push(record);
  });
  
  // Process each employee's records
  const employeeRecords: EmployeeRecord[] = [];
  
  Object.keys(employeeGroups).forEach(employeeKey => {
    const employeeRecords = employeeGroups[employeeKey];
    const firstRecord = employeeRecords[0];
    
    // Check if this employee might be a night shift worker
    const isNightShiftWorker = isLikelyNightShiftWorker(employeeRecords);
    
    // Group by date
    const dateGroups: Record<string, TimeRecord[]> = {};
    
    employeeRecords.forEach(record => {
      // Always convert to a proper Date object first
      const timestamp = ensureDate(record.timestamp);
      if (!timestamp) return;
      
      const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD
      
      if (!dateGroups[dateStr]) {
        dateGroups[dateStr] = [];
      }
      
      dateGroups[dateStr].push(record);
    });
    
    // Process each date
    const dailyRecords: DailyRecord[] = [];
    
    Object.keys(dateGroups).sort().forEach(dateStr => {
      const dayRecords = dateGroups[dateStr];
      
      // Sort records by timestamp
      dayRecords.sort((a, b) => {
        // Ensure both are Date objects
        const aTimestamp = ensureDate(a.timestamp);
        const bTimestamp = ensureDate(b.timestamp);
        
        if (!aTimestamp || !bTimestamp) return 0;
        return aTimestamp.getTime() - bTimestamp.getTime();
      });
      
      // Group into check-ins and check-outs
      const checkIns = dayRecords.filter(r => r.status === 'check_in');
      const checkOuts = dayRecords.filter(r => r.status === 'check_out');
      
      // Simple case: If we have at least one check-in and check-out
      if (checkIns.length > 0 && checkOuts.length > 0) {
        // Get first check-in and last check-out
        const firstCheckIn = ensureDate(checkIns[0].timestamp);
        const lastCheckOut = ensureDate(checkOuts[checkOuts.length - 1].timestamp);
        
        if (firstCheckIn && lastCheckOut) {
          // Determine shift type based on check-in time
          const shiftType = determineShiftType(firstCheckIn, isNightShiftWorker);
          
          // Calculate if late based on shift type
          const isLate = isLateCheckIn(firstCheckIn, shiftType);
          
          // Calculate if early leave based on shift type
          const earlyLeave = isEarlyLeave(lastCheckOut, shiftType);
          
          // Calculate if excessive overtime
          const excessiveOvertime = isExcessiveOvertime(lastCheckOut, shiftType);
          
          // Calculate hours worked with business rules applied
          const hoursWorked = calculatePayableHours(firstCheckIn, lastCheckOut, shiftType);
          
          // Check for cross-day shift (especially night shifts)
          const isCrossDay = firstCheckIn.toDateString() !== lastCheckOut.toDateString();
          
          // Create daily record
          dailyRecords.push({
            date: dateStr,
            firstCheckIn,
            lastCheckOut,
            hoursWorked,
            approved: false,
            shiftType,
            notes: isCrossDay ? 'Cross-day shift' : '',
            missingCheckIn: false,
            missingCheckOut: false,
            isLate,
            earlyLeave,
            excessiveOvertime,
            penaltyMinutes: 0,
            isCrossDay,
            allTimeRecords: dayRecords,
            hasMultipleRecords: dayRecords.length > 2
          });
        }
      }
      // Missing one or the other
      else if (checkIns.length > 0) {
        const firstCheckIn = ensureDate(checkIns[0].timestamp);
        
        if (firstCheckIn) {
          // Determine shift type based on check-in time
          const shiftType = determineShiftType(firstCheckIn, isNightShiftWorker);
          
          // Calculate if late based on shift type
          const isLate = isLateCheckIn(firstCheckIn, shiftType);
          
          // Default hours (will be adjusted later if needed)
          const hoursWorked = 0;
          
          // Create daily record
          dailyRecords.push({
            date: dateStr,
            firstCheckIn,
            lastCheckOut: null,
            hoursWorked,
            approved: false,
            shiftType,
            notes: 'Missing check-out',
            missingCheckIn: false,
            missingCheckOut: true,
            isLate,
            earlyLeave: false,
            excessiveOvertime: false,
            penaltyMinutes: 0,
            allTimeRecords: dayRecords,
            hasMultipleRecords: dayRecords.length > 1
          });
        }
      }
      else if (checkOuts.length > 0) {
        const lastCheckOut = ensureDate(checkOuts[checkOuts.length - 1].timestamp);
        
        if (lastCheckOut) {
          // For lone check-outs, try to infer shift type from the time
          // This is less reliable but better than nothing
          let shiftType: any = null;
          const hour = lastCheckOut.getHours();
          
          if (hour >= 13 && hour <= 15) {
            shiftType = 'morning'; // Likely morning shift check-out (around 2 PM)
          } else if (hour >= 21 && hour <= 23) {
            shiftType = 'evening'; // Likely evening shift check-out (around 10 PM)
          } else if (hour >= 5 && hour <= 7) {
            shiftType = 'night'; // Likely night shift check-out (around 6 AM)
          } else if (hour >= 16 && hour <= 17) {
            shiftType = 'canteen'; // Likely canteen shift check-out (4-5 PM)
          }
          
          // Calculate if early leave based on shift type
          const earlyLeave = shiftType ? isEarlyLeave(lastCheckOut, shiftType) : false;
          
          // Default hours (will be adjusted later if needed)
          const hoursWorked = 0;
          
          // Create daily record
          dailyRecords.push({
            date: dateStr,
            firstCheckIn: null,
            lastCheckOut,
            hoursWorked,
            approved: false,
            shiftType,
            notes: 'Missing check-in',
            missingCheckIn: true,
            missingCheckOut: false,
            isLate: false,
            earlyLeave,
            excessiveOvertime: false,
            penaltyMinutes: 0,
            allTimeRecords: dayRecords,
            hasMultipleRecords: dayRecords.length > 1
          });
        }
      }
    });
    
    // Create the employee record
    employeeRecords.push({
      employeeNumber: firstRecord.employeeNumber || '',
      name: firstRecord.name || 'Unknown Employee',
      department: firstRecord.department || '',
      days: dailyRecords,
      totalDays: dailyRecords.length,
      expanded: false
    });
  });
  
  return employeeRecords;
};

// Export to Excel for sharing or backup
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  try {
    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const exportData: any[] = [];
    
    // Add data rows
    employeeRecords.forEach(employee => {
      employee.days.forEach(day => {
        // Format dates for display
        const firstCheckIn = day.firstCheckIn ? formatTime24H(ensureDate(day.firstCheckIn)!) : 'Missing';
        const lastCheckOut = day.lastCheckOut ? formatTime24H(ensureDate(day.lastCheckOut)!) : 'Missing';
        
        exportData.push({
          'Employee Name': employee.name,
          'Employee Number': employee.employeeNumber,
          'Date': day.date,
          'Check In': firstCheckIn,
          'Check Out': lastCheckOut,
          'Hours Worked': day.hoursWorked.toFixed(2),
          'Shift Type': day.shiftType || 'Unknown',
          'Is Late': day.isLate ? 'Yes' : 'No',
          'Early Leave': day.earlyLeave ? 'Yes' : 'No',
          'Penalty Minutes': day.penaltyMinutes,
          'Approved': day.approved ? 'Yes' : 'No',
          'Notes': day.notes
        });
      });
    });
    
    // Generate worksheet
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    // Add to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Employee Hours');
    
    // Generate Excel file and download
    XLSX.writeFile(wb, `EmployeeHours_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    toast.error('Failed to export data to Excel');
  }
};

// Export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any): void => {
  try {
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Create summary worksheet
    const summaryData = data.summary.map((employee: any) => {
      return {
        'Employee': employee.name,
        'Employee Number': employee.employee_number,
        'Total Days': employee.total_days,
        'Regular Hours': employee.total_hours,
        'Double-Time Hours': employee.double_time_hours || 0,
        'Total Payable Hours': (employee.total_hours + (employee.double_time_hours || 0)).toFixed(2),
        'Average Hours/Day': employee.total_days > 0 ? (employee.total_hours / employee.total_days).toFixed(2) : '0.00'
      };
    });
    
    // Generate summary worksheet
    const summaryWs = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
    
    // Create detailed worksheet if details are available
    if (data.details && data.details.length > 0) {
      const detailsData = data.details.map((record: any) => {
        // Ensure dates are properly converted
        const timestamp = record.timestamp ? ensureDate(record.timestamp) : null;
        
        // Determine if this is a double-time day
        const isDoubleTime = data.doubleDays && 
          data.doubleDays.includes(record.working_week_start || 
                                 (timestamp ? timestamp.toISOString().split('T')[0] : ''));
        
        // Calculate hours and apply double-time if applicable
        const hours = parseFloat(record.exact_hours || 0);
        const doubleTimeHours = isDoubleTime ? hours : 0;
        
        return {
          'Employee': record.employees?.name || 'Unknown',
          'Employee Number': record.employees?.employee_number || '',
          'Date': record.working_week_start || (timestamp ? timestamp.toISOString().split('T')[0] : ''),
          'Check In': record.display_check_in || 'Missing',
          'Check Out': record.display_check_out || 'Missing',
          'Shift Type': record.shift_type || 'Unknown',
          'Regular Hours': hours.toFixed(2),
          'Double-Time Hours': doubleTimeHours.toFixed(2),
          'Total Payable Hours': (hours + doubleTimeHours).toFixed(2),
          'Is Double-Time Day': isDoubleTime ? 'Yes' : 'No',
          'Notes': record.notes || ''
        };
      });
      
      // Generate details worksheet
      const detailsWs = XLSX.utils.json_to_sheet(detailsData);
      XLSX.utils.book_append_sheet(wb, detailsWs, 'Details');
    }
    
    // Generate Excel file and download
    const filename = data.filterMonth === 'all' 
      ? `ApprovedHours_AllTime_${new Date().toISOString().slice(0, 10)}.xlsx`
      : `ApprovedHours_${data.filterMonth}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    
    XLSX.writeFile(wb, filename);
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    toast.error('Failed to export approved hours to Excel');
  }
};