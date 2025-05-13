import * as XLSX from 'xlsx';
import { format, isFriday, parseISO } from 'date-fns';
import { EmployeeRecord, DailyRecord } from '../types';

// Helper to create styles for the Excel workbook
const createStyles = () => {
  return {
    headerStyle: {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '4F81BD' } },
      alignment: { horizontal: 'center' }
    },
    dateHeaderStyle: {
      font: { bold: true },
      fill: { fgColor: { rgb: 'D9E1F2' } },
      alignment: { horizontal: 'center' }
    },
    normalCell: {
      alignment: { horizontal: 'left' }
    },
    numberCell: {
      alignment: { horizontal: 'right' },
      numFmt: '0.00'
    },
    dateCell: {
      alignment: { horizontal: 'center' },
      numFmt: 'yyyy-mm-dd'
    },
    timeCell: {
      alignment: { horizontal: 'center' },
      numFmt: 'h:mm'
    },
    highlightCell: {
      font: { color: { rgb: 'C00000' } },
      alignment: { horizontal: 'right' },
      numFmt: '0.00'
    }
  };
};

// Function to export Face ID Data to Excel
export const exportToExcel = (employeeRecords: EmployeeRecord[]) => {
  try {
    const workbook = XLSX.utils.book_new();
    const styles = createStyles();
    
    // Summary sheet data
    const summaryData = [
      ['Employee Number', 'Name', 'Department', 'Total Days', 'Approved Days', 'Total Hours'],
      ...employeeRecords.map(employee => {
        // Calculate approved days
        const approvedDays = employee.days.filter(day => day.approved).length;
        
        // Calculate total hours
        const totalHours = employee.days.reduce((sum, day) => sum + day.hoursWorked, 0);
        
        return [
          employee.employeeNumber,
          employee.name,
          employee.department,
          employee.days.length,
          approvedDays,
          totalHours.toFixed(2)
        ];
      })
    ];
    
    // Create summary sheet
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    
    // Create sheet for each employee
    employeeRecords.forEach(employee => {
      // Skip employees with no days
      if (employee.days.length === 0) return;
      
      // Format data for Excel
      const data = [
        ['Date', 'First Check-In', 'Last Check-Out', 'Hours Worked', 'Shift Type', 'Approved', 'Late', 'Early Leave', 'Penalty Minutes', 'Notes'],
        ...employee.days.map(day => {
          return [
            day.date,
            day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : 'N/A',
            day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : 'N/A',
            day.hoursWorked.toFixed(2),
            day.shiftType || 'Unknown',
            day.approved ? 'Yes' : 'No',
            day.isLate ? 'Yes' : 'No',
            day.earlyLeave ? 'Yes' : 'No',
            day.penaltyMinutes || 0,
            day.notes || ''
          ];
        })
      ];
      
      // Create sheet
      const sheet = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, sheet, `${employee.name.substring(0, 20)}`);
    });
    
    // Generate Excel file
    const fileName = `TimeTracking_Export_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    
    return fileName;
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    throw error;
  }
};

// Function to export approved hours data to Excel
export const exportApprovedHoursToExcel = (data: any) => {
  try {
    const { summary, details, filterMonth, doubleDays = [] } = data;
    const workbook = XLSX.utils.book_new();
    
    // Create summary sheet
    const summaryData = [
      ['Employee Number', 'Name', 'Total Days', 'Regular Hours', 'Double-Time Hours', 'Fridays Worked', 'Over Time (Hours)', 'Over Time (Days)', 'Total Payable Hours']
    ];
    
    // Formatting helpers
    const formatNumber = (value: number) => Number(value.toFixed(2));
    
    let totalEmployees = 0;
    let totalDays = 0;
    let totalRegularHours = 0;
    let totalDoubleTimeHours = 0;
    let totalPayableHours = 0;
    let totalFridaysWorked = 0;
    let totalOvertimeHours = 0;
    let totalOvertimeDays = 0;
    
    // Process each employee
    summary.forEach((employee: any) => {
      if (!employee || !employee.id) return;
      
      totalEmployees++;
      
      // Calculate days where the employee actually worked (hours > 0)
      const workingDays = employee.working_week_dates?.filter((date: string) => {
        return (employee.hours_by_date?.[date] || 0) > 0;
      }) || [];
      
      // Only count days with actual work hours
      const actualWorkingDaysCount = workingDays.length;
      totalDays += actualWorkingDaysCount;
      
      // Regular hours (already calculated)
      const regularHours = employee.total_hours || 0;
      totalRegularHours += regularHours;
      
      // Double-time hours (already calculated)
      const doubleTimeHours = employee.double_time_hours || 0;
      totalDoubleTimeHours += doubleTimeHours;
      
      // Total payable hours
      const payableHours = regularHours + doubleTimeHours;
      totalPayableHours += payableHours;
      
      // Calculate Fridays worked
      const fridaysWorked = workingDays.filter((dateStr: string) => {
        const date = parseISO(dateStr);
        return isFriday(date);
      }).length;
      totalFridaysWorked += fridaysWorked;
      
      // Calculate overtime hours (hours > 9 per day)
      let overtimeHours = 0;
      workingDays.forEach((dateStr: string) => {
        const hoursForDay = employee.hours_by_date?.[dateStr] || 0;
        if (hoursForDay > 9) {
          overtimeHours += (hoursForDay - 9);
        }
      });
      totalOvertimeHours += overtimeHours;
      
      // Calculate overtime days (overtime hours / 9)
      const overtimeDays = overtimeHours / 9;
      totalOvertimeDays += overtimeDays;
      
      // Add employee row to summary data
      summaryData.push([
        employee.employee_number,
        employee.name,
        actualWorkingDaysCount,
        formatNumber(regularHours),
        formatNumber(doubleTimeHours),
        fridaysWorked,
        formatNumber(overtimeHours),
        formatNumber(overtimeDays),
        formatNumber(payableHours)
      ]);
    });
    
    // Create summary sheet
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    
    // Set column widths
    const summaryColWidths = [
      { wch: 18 }, // Employee Number
      { wch: 30 }, // Name
      { wch: 12 }, // Total Days
      { wch: 15 }, // Regular Hours
      { wch: 20 }, // Double-Time Hours
      { wch: 15 }, // Fridays Worked
      { wch: 18 }, // Over Time (Hours)
      { wch: 18 }, // Over Time (Days)
      { wch: 20 }  // Total Payable Hours
    ];
    summarySheet['!cols'] = summaryColWidths;
    
    // Style the header row
    for (let i = 0; i < summaryData[0].length; i++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
      if (!summarySheet[cellRef]) continue;
      
      summarySheet[cellRef].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4F81BD' } },
        alignment: { horizontal: 'center' }
      };
    }
    
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    
    // Create statistics sheet
    const statsData = [
      ['Metric', 'Value'],
      ['Total Employees', totalEmployees],
      ['Total Working Days', totalDays],
      ['Total Regular Hours', formatNumber(totalRegularHours)],
      ['Total Double-Time Hours', formatNumber(totalDoubleTimeHours)],
      ['Total Payable Hours', formatNumber(totalPayableHours)],
      ['Total Fridays Worked', totalFridaysWorked],
      ['Total Overtime Hours', formatNumber(totalOvertimeHours)],
      ['Total Overtime Days', formatNumber(totalOvertimeDays)]
    ];
    
    const statsSheet = XLSX.utils.aoa_to_sheet(statsData);
    // Set column widths
    statsSheet['!cols'] = [
      { wch: 25 }, // Metric
      { wch: 15 }  // Value
    ];
    
    // Style the header row
    for (let i = 0; i < statsData[0].length; i++) {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
      if (!statsSheet[cellRef]) continue;
      
      statsSheet[cellRef].s = {
        font: { bold: true, color: { rgb: 'FFFFFF' } },
        fill: { fgColor: { rgb: '4F81BD' } },
        alignment: { horizontal: 'center' }
      };
    }
    
    XLSX.utils.book_append_sheet(workbook, statsSheet, 'Statistics');
    
    // Create detail sheets for each employee with detailed records
    if (details && details.length > 0) {
      // Group details by employee
      const detailsByEmployee = details.reduce((acc: any, record: any) => {
        if (!record.employee_id) return acc;
        
        if (!acc[record.employee_id]) {
          acc[record.employee_id] = [];
        }
        
        acc[record.employee_id].push(record);
        return acc;
      }, {});
      
      // Find employee data from summary
      Object.entries(detailsByEmployee).forEach(([employeeId, records]: [string, any]) => {
        if (!records || !records.length) return;
        
        const employee = summary.find((e: any) => e.id === employeeId);
        if (!employee) return;
        
        const employeeName = employee.name;
        const employeeNumber = employee.employee_number;
        
        // Format detail records for Excel
        const detailData = [
          ['Date', 'Check-In', 'Check-Out', 'Shift Type', 'Hours', 'Double-Time', 'Notes']
        ];
        
        // Group records by date
        const recordsByDate = records.reduce((acc: any, record: any) => {
          // Skip if this is an off-day record
          if (record.status === 'off_day' || record.notes?.includes('OFF-DAY')) {
            return acc;
          }
          
          // Use working_week_start if available, otherwise use timestamp date
          const dateKey = record.working_week_start || 
                         (record.timestamp ? new Date(record.timestamp).toISOString().slice(0, 10) : '');
          
          if (!dateKey) return acc;
          
          if (!acc[dateKey]) {
            acc[dateKey] = [];
          }
          
          acc[dateKey].push(record);
          return acc;
        }, {});
        
        // Process each date for this employee
        Object.entries(recordsByDate).forEach(([date, dateRecords]: [string, any]) => {
          const checkIns = dateRecords.filter((r: any) => r.status === 'check_in');
          const checkOuts = dateRecords.filter((r: any) => r.status === 'check_out');
          
          // Get the first check-in and last check-out
          const checkIn = checkIns.length > 0 ? 
            checkIns.sort((a: any, b: any) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0] 
            : null;
          
          const checkOut = checkOuts.length > 0 ? 
            checkOuts.sort((a: any, b: any) => 
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] 
            : null;
          
          // Skip if we don't have both check-in and check-out
          if (!checkIn && !checkOut) return;
          
          // Get check-in and check-out display times
          const checkInDisplay = checkIn?.display_check_in || 'Missing';
          const checkOutDisplay = checkOut?.display_check_out || 'Missing';
          
          // Get hours - prioritize exact_hours field
          let hours = 0;
          if (checkIn && checkIn.exact_hours !== null && checkIn.exact_hours !== undefined) {
            hours = parseFloat(checkIn.exact_hours);
          } else if (checkOut && checkOut.exact_hours !== null && checkOut.exact_hours !== undefined) {
            hours = parseFloat(checkOut.exact_hours);
          }
          
          // Calculate double time if this is a double time day
          const isDoubleTimeDay = doubleDays.includes(date);
          const doubleTimeHours = isDoubleTimeDay ? hours : 0;
          
          // Extract notes (remove hours part)
          const notes = (checkIn?.notes || checkOut?.notes || '')
            .replace(/hours:\d+\.\d+;?\s*/, '')
            .replace(/double-time:true;?\s*/, '');
          
          detailData.push([
            date,
            checkInDisplay,
            checkOutDisplay,
            checkIn?.shift_type || checkOut?.shift_type || 'Unknown',
            formatNumber(hours),
            isDoubleTimeDay ? formatNumber(doubleTimeHours) : 0,
            notes
          ]);
        });
        
        if (detailData.length > 1) { // Only create sheet if we have data
          const detailSheet = XLSX.utils.aoa_to_sheet(detailData);
          
          // Set column widths
          const detailColWidths = [
            { wch: 12 }, // Date
            { wch: 12 }, // Check-In
            { wch: 12 }, // Check-Out
            { wch: 15 }, // Shift Type
            { wch: 10 }, // Hours
            { wch: 12 }, // Double-Time
            { wch: 40 }  // Notes
          ];
          detailSheet['!cols'] = detailColWidths;
          
          // Style the header row
          for (let i = 0; i < detailData[0].length; i++) {
            const cellRef = XLSX.utils.encode_cell({ r: 0, c: i });
            if (!detailSheet[cellRef]) continue;
            
            detailSheet[cellRef].s = {
              font: { bold: true, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: '4F81BD' } },
              alignment: { horizontal: 'center' }
            };
          }
          
          // Highlight double-time days
          for (let r = 1; r < detailData.length; r++) {
            const dateCell = XLSX.utils.encode_cell({ r, c: 0 });
            const date = detailSheet[dateCell]?.v;
            
            if (date && doubleDays.includes(date)) {
              // Style the whole row
              for (let c = 0; c < detailData[0].length; c++) {
                const cellRef = XLSX.utils.encode_cell({ r, c });
                if (!detailSheet[cellRef]) continue;
                
                detailSheet[cellRef].s = {
                  ...detailSheet[cellRef].s, // Preserve existing style
                  fill: { fgColor: { rgb: 'FFF9C4' } } // Light yellow background
                };
              }
            }
          }
          
          XLSX.utils.book_append_sheet(workbook, detailSheet, `${employeeNumber} - ${employeeName.substring(0, 15)}`);
        }
      });
    }
    
    // Generate Excel file
    const period = filterMonth ? `_${filterMonth}` : '_AllTime';
    const fileName = `ApprovedHours${period}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    
    return fileName;
  } catch (error) {
    console.error('Error exporting approved hours to Excel:', error);
    throw error;
  }
};