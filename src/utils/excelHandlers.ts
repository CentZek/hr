import { utils, write } from 'xlsx';
import { saveAs } from 'file-saver';
import { format, parseISO } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';

/**
 * Utility functions for handling Excel files
 */

// Function to handle importing Excel data
export const handleExcelFile = async (file: File): Promise<EmployeeRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = await import('xlsx').then(xlsx => xlsx.read(data, { type: 'array' }));
        
        // Process the Excel file and convert to EmployeeRecord[]
        const records = processExcelData(workbook);
        
        resolve(records);
      } catch (error) {
        console.error('Error processing Excel file:', error);
        reject(new Error('Failed to process Excel file. Please make sure it is a valid Excel file with the correct format.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read the file. Please try again.'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

// Process Excel data and convert to EmployeeRecord[]
const processExcelData = (workbook: any): EmployeeRecord[] => {
  // Process logic here
  // This would be your existing implementation to process Excel data
  
  // For the sake of this example, return empty array
  return [];
};

// Function to export data to Excel
export const exportToExcel = (employeeRecords: EmployeeRecord[]): void => {
  try {
    // Create a new workbook
    const wb = utils.book_new();
    
    // Create employee summary sheet
    const summaryData = employeeRecords.map(emp => {
      // Calculate working days (days with hours > 0)
      const workingDays = emp.days.filter(day => day.hoursWorked > 0).length;
      
      return {
        'Employee Number': emp.employeeNumber,
        'Name': emp.name,
        'Total Days': emp.days.length,
        'Working Days': workingDays,  // Add Working Days column
        'Regular Hours': emp.days.reduce((sum, day) => sum + day.hoursWorked, 0).toFixed(2),
        'Approved Days': emp.days.filter(day => day.approved).length,
        'Pending Days': emp.days.filter(day => !day.approved).length,
      };
    });
    
    // Create summary worksheet
    const summaryWs = utils.json_to_sheet(summaryData);
    utils.book_append_sheet(wb, summaryWs, 'Employee Summary');
    
    // Create detail sheet for each employee
    employeeRecords.forEach(emp => {
      const detailData = emp.days.map(day => ({
        'Date': day.date,
        'Check-In': day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : day.missingCheckIn ? 'Missing' : 'OFF-DAY',
        'Check-Out': day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : day.missingCheckOut ? 'Missing' : 'OFF-DAY',
        'Shift Type': day.shiftType || 'Unknown',
        'Hours': day.hoursWorked.toFixed(2),
        'Is Late': day.isLate ? 'Yes' : 'No',
        'Early Leave': day.earlyLeave ? 'Yes' : 'No',
        'Penalty Minutes': day.penaltyMinutes,
        'Notes': day.notes || '',
        'Approved': day.approved ? 'Yes' : 'No',
      }));
      
      const detailWs = utils.json_to_sheet(detailData);
      utils.book_append_sheet(wb, detailWs, emp.name.substring(0, 30)); // Limit sheet name length
    });
    
    // Export the workbook
    const wbout = write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    saveAs(blob, `employee_time_records_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    alert('Failed to export data to Excel.');
  }
};

// Export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any): void => {
  try {
    // Create a new workbook
    const wb = utils.book_new();
    
    // Extract relevant data
    const { summary, details, filterMonth, dateRange, doubleDays = [] } = data;
    
    // Prepare summary sheet data
    const summaryData = summary.map((emp: any) => {
      // Calculate working days (days with hours > 0)
      const workingDays = emp.working_week_dates ? 
        emp.working_week_dates.filter((date: string) => (emp.hours_by_date?.[date] || 0) > 0).length : 
        0;
        
      // Calculate double-time hours
      const doubleTimeHours = emp.double_time_hours || 0;
      const totalPayableHours = emp.total_hours + doubleTimeHours;
      
      return {
        'Employee Number': emp.employee_number,
        'Name': emp.name,
        'Total Days': emp.total_days,
        'Working Days': workingDays,  // Add Working Days column
        'Regular Hours': emp.total_hours.toFixed(2),
        'Double-Time Hours': doubleTimeHours.toFixed(2),
        'Fridays Worked': emp.fridays_worked || '',
        'Over Time (Hours)': emp.overtime_hours || 0,
        'Over Time (Days)': emp.overtime_days || 0,
        'Total Payable Hours': totalPayableHours.toFixed(2)
      };
    });
    
    // Add summary sheet
    const summaryWs = utils.json_to_sheet(summaryData);
    utils.book_append_sheet(wb, summaryWs, 'Summary');
    
    // Add details for each employee if available
    if (details && details.length > 0) {
      // Group details by employee
      const employeeDetails: Record<string, any[]> = {};
      details.forEach((record: any) => {
        const employeeId = record.employee_id;
        if (!employeeDetails[employeeId]) {
          employeeDetails[employeeId] = [];
        }
        employeeDetails[employeeId].push(record);
      });
      
      // Add a sheet for each employee's details
      Object.entries(employeeDetails).forEach(([employeeId, records]) => {
        // Find the employee name from the summary
        const employee = summary.find((emp: any) => emp.id === employeeId);
        if (!employee) return;
        
        // Process each record for the details sheet
        const detailsData = records.map((record: any) => {
          // Determine if this is a double-time day
          const isDoubleTime = doubleDays.includes(record.working_week_start);
          
          // Get standard values from record
          const checkInDisplay = record.display_check_in || 'Missing';
          const checkOutDisplay = record.display_check_out || 'Missing';
          
          const exactHours = record.exact_hours || 0;
          const doubleTimeValue = isDoubleTime ? exactHours : 0;
          
          return {
            'Date': record.working_week_start || format(parseISO(record.timestamp), 'yyyy-MM-dd'),
            'Check In': checkInDisplay,
            'Check Out': checkOutDisplay,
            'Shift Type': record.shift_type || 'Unknown',
            'Hours': exactHours.toFixed(2),
            'Double-Time': isDoubleTime ? `2× ${doubleTimeValue.toFixed(2)}` : '',
            'Status': 'Approved',
            'Notes': (record.notes || '').replace(/hours:\d+\.\d+;?\s*/, '')
          };
        });
        
        // Create and add the sheet
        const detailsWs = utils.json_to_sheet(detailsData);
        utils.book_append_sheet(wb, detailsWs, employee.name.substring(0, 30) || `Employee ${employeeId.substring(0, 8)}`);
      });
    }
    
    // Add report metadata
    const metaData = [
      { 'Report Type': 'Approved Hours Export' },
      { 'Generated On': format(new Date(), 'yyyy-MM-dd HH:mm:ss') },
      { 'Filter': filterMonth === 'all' ? 'All Time' : 
               filterMonth === 'custom' ? `Custom Range (${dateRange?.startDate} to ${dateRange?.endDate})` : 
               `Month: ${filterMonth}` }
    ];
    
    const metaWs = utils.json_to_sheet(metaData);
    utils.book_append_sheet(wb, metaWs, 'Report Info');
    
    // Export the workbook
    const wbout = write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    saveAs(blob, `approved_hours_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    alert('Failed to export approved hours data to Excel.');
  }
};