import React, { useState, useEffect } from 'react';
import { format, parseISO, isValid } from 'date-fns';
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { DISPLAY_SHIFT_TIMES } from '../types';
import { formatTime24H } from '../utils/dateTimeHelper';

interface TimeRecord {
  id: string;
  employee_id: string;
  timestamp: string;
  status: 'check_in' | 'check_out' | 'off_day';
  shift_type: 'morning' | 'evening' | 'night' | 'canteen' | null;
  is_late: boolean;
  early_leave: boolean;
  deduction_minutes: number;
  notes?: string;
  display_check_in?: string;
  display_check_out?: string;
  working_week_start?: string;
  employees?: {
    name: string;
    employee_number: string;
  };
}

interface TimeRecordsTableProps {
  records: TimeRecord[];
  isLoading?: boolean;
  title?: string;
}

const TimeRecordsTable: React.FC<TimeRecordsTableProps> = ({ 
  records,
  isLoading = false,
  title = 'Manual Time Records'
}) => {
  const [isMobile, setIsMobile] = useState(false);

  // Helper function to determine if a timestamp should be handled as a possible night shift
  const shouldHandleAsPossibleNightShift = (timestamp: Date): boolean => {
    const hourUTC = new Date(timestamp).getUTCHours();
    // Early morning hours (midnight to 8 AM) could be night shift check-outs
    return hourUTC >= 0 && hourUTC < 8;
  };

  // Check if we're on mobile
  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    
    return () => {
      window.removeEventListener('resize', checkIfMobile);
    };
  }, []);
  
  // Group records by date and employee
  const groupedRecords = React.useMemo(() => {
    const groups: Record<string, Record<string, any[]>> = {};
    
    records.forEach(record => {
      // Handle OFF-DAY records specially
      if (record.status === 'off_day' || record.notes?.includes('OFF-DAY')) {
        // Use the UTC date portion so nothing shifts under local timezones
        const utc = parseISO(record.timestamp);
        const date = utc.toISOString().slice(0,10);  // "YYYY-MM-DD"
        
        const employeeId = record.employee_id;
        
        if (!groups[date]) {
          groups[date] = {};
        }
        
        if (!groups[date][employeeId]) {
          groups[date][employeeId] = [];
        }
        
        groups[date][employeeId].push({
          ...record,
          status: 'off_day' // Ensure status is set
        });
        
        return;
      }
      
      // For night shifts, use working_week_start to group records if available
      if (record.shift_type === 'night' && record.working_week_start) {
        const groupDate = record.working_week_start;
        const employeeId = record.employee_id;
        
        if (!groups[groupDate]) {
          groups[groupDate] = {};
        }
        
        if (!groups[groupDate][employeeId]) {
          groups[groupDate][employeeId] = [];
        }
        
        groups[groupDate][employeeId].push(record);
        return;
      }
      
      // For normal records, handle date grouping
      // Use the UTC date portion so nothing shifts under local timezones
      let utc = parseISO(record.timestamp);
      let date = utc.toISOString().slice(0,10);  // "YYYY-MM-DD"
      
      // Special handling for night shift or evening shift checkouts in early morning hours
      if (record.status === 'check_out') {
        // Use UTC hours to ensure consistency across timezones
        const recordHourUTC = utc.getUTCHours();
        
        // For night shifts with early morning checkout, associate with previous day
        if (record.shift_type === 'night' && recordHourUTC < 12) {
          // This is a night shift checkout on the next day
          const prevDate = new Date(record.timestamp);
          prevDate.setDate(prevDate.getDate() - 1);
          date = prevDate.toISOString().slice(0,10);  // "YYYY-MM-DD"
        }
        // For evening shifts with early morning checkout, associate with previous day
        else if (record.shift_type === 'evening' && recordHourUTC < 12) {
          // This is likely an evening shift checkout on the next day
          const prevDate = new Date(record.timestamp);
          prevDate.setDate(prevDate.getDate() - 1);
          date = prevDate.toISOString().slice(0,10);  // "YYYY-MM-DD"
        }
      }

      if (!groups[date]) {
        groups[date] = {};
      }
      
      const employeeId = record.employee_id;
      
      if (!groups[date][employeeId]) {
        groups[date][employeeId] = [];
      }
      
      groups[date][employeeId].push({
        ...record,
        date
      });
    });
    
    return groups;
  }, [records]);
  
  // Calculate pairs of check-in/check-out
  const processedRecords = React.useMemo(() => {
    const result: any[] = [];
    const processedDates = new Set<string>();
    
    // First look for night shifts that span days
    for (const date in groupedRecords) {
      // Skip if this date was already processed
      if (processedDates.has(date)) continue;
      
      Object.entries(groupedRecords[date]).forEach(([employeeId, records]) => {
        // Check if this is an off day
        const offDayRecords = records.filter(r => r.status === 'off_day');
        if (offDayRecords.length > 0) {
          // Add off day records with special formatting
          result.push({
            date,
            employeeId,
            employeeName: records[0]?.employees?.name || 'Unknown Employee',
            employeeNumber: records[0]?.employees?.employee_number || 'Unknown',
            isOffDay: true,
            notes: 'OFF-DAY'
          });
          processedDates.add(date);
          return;
        }
        
        // Get all check-ins and check-outs for this day
        const checkIns = records.filter((r) => r.status === 'check_in');
        const checkOuts = records.filter((r) => r.status === 'check_out');
        
        // Sort by timestamp to get earliest check-in and latest check-out
        const sortedCheckIns = checkIns.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        const sortedCheckOuts = checkOuts.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        
        // Use earliest check-in and latest check-out
        const earliestCheckIn = sortedCheckIns.length > 0 ? sortedCheckIns[0] : null;
        const latestCheckOut = sortedCheckOuts.length > 0 ? sortedCheckOuts[0] : null;
        
        // Improved handling for single-record days (either just check-in or just check-out)
        // Special handling for April 12 and similar cases
        if ((earliestCheckIn && !latestCheckOut) || (!earliestCheckIn && latestCheckOut)) {
          // For days with only check-ins, ensure they're properly displayed
          if (earliestCheckIn && !latestCheckOut) {
            // Use display values from the check-in record if available
            if (earliestCheckIn.display_check_in && (earliestCheckIn.display_check_out === 'Missing' || !earliestCheckIn.display_check_out)) {
              // This record already has correct display values
              result.push(earliestCheckIn);
            } else {
              // Set display values if missing
              result.push({
                ...earliestCheckIn,
                display_check_in: earliestCheckIn.display_check_in || format(new Date(earliestCheckIn.timestamp), 'HH:mm'),
                display_check_out: 'Missing'
              });
            }
            processedDates.add(date);
            console.log(`Processed single check-in for date ${date}`);
            return;
          }
          
          // For days with only check-outs, ensure they're properly displayed
          if (latestCheckOut && !earliestCheckIn) {
            // Check if there's a check-in from the previous day that might match
            // This is common for night shifts where check-out is the next morning
            const prevDate = new Date(date);
            prevDate.setDate(prevDate.getDate() - 1);
            const prevDateStr = prevDate.toISOString().slice(0,10);  // "YYYY-MM-DD"
            
            if (groupedRecords[prevDateStr]) {
              const prevDayEmployee = groupedRecords[prevDateStr][employeeId];
              if (prevDayEmployee) {
                const prevDayCheckIns = prevDayEmployee.filter((r: any) => r.status === 'check_in');
                if (prevDayCheckIns.length > 0) {
                  console.log(`Found check-in from previous day ${prevDateStr} for checkout on ${date}`);
                  
                  // Sort to get earliest check-in from previous day
                  const sortedPrevCheckIns = prevDayCheckIns.sort((a: any, b: any) => 
                    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
                  );
                  
                  // Use the display values from both records to preserve consistency
                  result.push({
                    ...latestCheckOut,
                    display_check_in: sortedPrevCheckIns[0].display_check_in || 
                      format(new Date(sortedPrevCheckIns[0].timestamp), 'HH:mm'),
                    display_check_out: latestCheckOut.display_check_out || 
                      format(new Date(latestCheckOut.timestamp), 'HH:mm'),
                    shift_type: latestCheckOut.shift_type || sortedPrevCheckIns[0].shift_type
                  });
                } else {
                  // No matching check-in from previous day, just use the check-out as is
                  result.push({
                    ...latestCheckOut,
                    display_check_in: 'Missing',
                    display_check_out: latestCheckOut.display_check_out || 
                      format(new Date(latestCheckOut.timestamp), 'HH:mm')
                  });
                }
              }
            } else {
              // No records from previous day, just use the check-out as is
              // CRITICAL: This is where we need to check if it's an early morning checkout
              // If it is, mark as "Missing Check-in" instead of treating it as OFF-DAY
              if (shouldHandleAsPossibleNightShift(new Date(latestCheckOut.timestamp))) {
                // Handle as night shift with missing check-in
                result.push({
                  ...latestCheckOut,
                  display_check_in: 'Missing',
                  display_check_out: latestCheckOut.display_check_out || 
                    format(new Date(latestCheckOut.timestamp), 'HH:mm'),
                  shift_type: 'night' // Set to night shift type
                });
                console.log(`Treating ${date} with early morning checkout as night shift with missing check-in`);
              } else {
                // Regular case, not night shift
                result.push({
                  ...latestCheckOut,
                  display_check_in: 'Missing',
                  display_check_out: latestCheckOut.display_check_out || 
                    format(new Date(latestCheckOut.timestamp), 'HH:mm')
                });
              }
            }
            
            processedDates.add(date);
            console.log(`Processed single check-out for date ${date}`);
            return;
          }
        }
        
        // If both check-in and check-out exist, use them
        if (earliestCheckIn && latestCheckOut) {
          // Add both records
          result.push({
            date,
            employeeId,
            employeeName: earliestCheckIn.employees?.name || 'Unknown',
            employeeNumber: earliestCheckIn.employees?.employee_number || 'Unknown',
            checkIn: earliestCheckIn,
            checkOut: latestCheckOut,
            shiftType: (earliestCheckIn || latestCheckOut)?.shift_type || 'unknown'
          });
          processedDates.add(date);
          console.log(`Processed complete day with check-in and check-out for date ${date}`);
          return;
        }
        
        // Handle night shifts that span days
        if (earliestCheckIn && earliestCheckIn.shift_type === 'night' && !latestCheckOut) {
          const nextDay = new Date(date);
          nextDay.setDate(nextDay.getDate() + 1);
          const nextDayDate = nextDay.toISOString().slice(0,10);  // "YYYY-MM-DD"
          
          // Check if next day has check-out records
          if (groupedRecords[nextDayDate] && groupedRecords[nextDayDate][employeeId]) {
            const nextDayCheckOuts = groupedRecords[nextDayDate][employeeId].filter((r: any) => r.status === 'check_out');
            
            if (nextDayCheckOuts.length > 0) {
              // Sort to get latest check-out
              const sortedNextDayCheckOuts = nextDayCheckOuts.sort((a: any, b: any) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              );
              
              // Add check-in and next day's check-out
              result.push({
                date,
                employeeId,
                employeeName: earliestCheckIn.employees?.name || 'Unknown',
                employeeNumber: earliestCheckIn.employees?.employee_number || 'Unknown',
                checkIn: earliestCheckIn,
                checkOut: sortedNextDayCheckOuts[0],
                shiftType: 'night'
              });
              
              // Mark both days as processed
              processedDates.add(date);
              processedDates.add(nextDayDate);
              
              console.log(`Processed night shift spanning ${date} to ${nextDayDate}`);
              return;
            }
          }
        }
        
        // If we reach here, just add whatever records we have for this day
        result.push({
          date,
          employeeId,
          employeeName: (checkIns[0] || checkOuts[0])?.employees?.name || 'Unknown',
          employeeNumber: (checkIns[0] || checkOuts[0])?.employees?.employee_number || 'Unknown',
          checkIn: checkIns.length > 0 ? checkIns[0] : null,
          checkOut: checkOuts.length > 0 ? checkOuts[0] : null,
          shiftType: (checkIns[0] || checkOuts[0])?.shift_type || 'unknown'
        });
        processedDates.add(date);
      });
    }
    
    return result;
  }, [groupedRecords]);

  // Get time in 24-hour format
  const getActualTime = (record: any) => {
    if (!record) return '—';
    
    // First check if this record has display values set
    if (record.status === 'check_in' && record.display_check_in && record.display_check_in !== 'Missing') {
      return record.display_check_in;
    }
    
    if (record.status === 'check_out' && record.display_check_out && record.display_check_out !== 'Missing') {
      return record.display_check_out;
    }
    
    // First check if this is a standard shift type with predefined display times
    if (record.shift_type) {
      const shiftType = record.shift_type;
      if (DISPLAY_SHIFT_TIMES[shiftType as keyof typeof DISPLAY_SHIFT_TIMES]) {
        const displayTimes = DISPLAY_SHIFT_TIMES[shiftType as keyof typeof DISPLAY_SHIFT_TIMES];
        
        // Use standard times for check-in and check-out based on shift type
        if (record.status === 'check_in') {
          return displayTimes.startTime;
        } else if (record.status === 'check_out') {
          return displayTimes.endTime;
        }
      }
    }
    
    // If no predefined display time, use the actual timestamp from the database
    if (!record.timestamp) return '—';
    
    try {
      const timestamp = new Date(record.timestamp);
      if (!isValid(timestamp)) return '—';
      
      // Format with 24-hour format
      return formatTime24H(timestamp);
    } catch (error) {
      console.error('Error formatting time:', error);
      return '—';
    }
  };

  // Safe format function to prevent "Invalid time value" errors
  const safeFormatDate = (dateString: string, formatStr: string): string => {
    if (!dateString) return '—';
    
    try {
      const date = new Date(dateString);
      if (!isValid(date)) return '—';
      return format(date, formatStr);
    } catch (error) {
      console.error('Error formatting date:', error, dateString);
      return '—';
    }
  };
  
  if (isLoading) {
    return (
      <div className="mt-4 p-8 text-center bg-white border border-gray-200 rounded-md shadow-sm">
        <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-500">Loading time records...</p>
      </div>
    );
  }
  
  if (records.length === 0) {
    return (
      <div className="mt-4 p-8 text-center bg-white border border-gray-200 rounded-md shadow-sm">
        <Clock className="w-10 h-10 text-gray-300 mx-auto mb-2" />
        <h3 className="text-gray-600 font-medium">No manual time records</h3>
        <p className="text-sm text-gray-500 mt-1">
          Manually added time records will appear here.
        </p>
      </div>
    );
  }
  
  // Mobile Card View
  if (isMobile) {
    return (
      <div className="mt-4 bg-white border border-gray-200 rounded-md shadow-sm">
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 flex items-center">
            <Clock className="w-4 h-4 text-gray-500 mr-2" />
            {title}
          </h3>
        </div>
        
        <div className="overflow-y-auto max-h-90vh px-4 py-2 space-y-3">
          {processedRecords.map((record, index) => (
            <div key={index} className="p-3 border border-gray-200 rounded-md">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium text-gray-800 text-wrap-balance">{record.employeeName}</h4>
                <span className="text-xs text-gray-500">#{record.employeeNumber}</span>
              </div>
              
              <div className="text-xs text-gray-500 mb-2">
                {safeFormatDate(record.date, 'EEE, MMM d, yyyy')}
              </div>
              
              {record.isOffDay ? (
                <div className="flex justify-between items-center mt-2 mb-1 text-sm">
                  <span className="text-gray-500 font-medium">OFF-DAY</span>
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
                    OFF-DAY
                  </span>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div>
                      <span className="text-xs text-gray-500">Check In</span>
                      <div className={`text-sm mt-1 ${record.checkIn?.is_late ? 'text-amber-600' : 'text-gray-700'}`}>
                        {record.checkIn ? (
                          <>
                            {record.checkIn.is_late && <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />}
                            {record.checkIn.display_check_in || getActualTime(record.checkIn)}
                          </>
                        ) : (
                          <span className="text-gray-400">Missing</span>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <span className="text-xs text-gray-500">Check Out</span>
                      <div className={`text-sm mt-1 ${record.checkOut?.early_leave ? 'text-amber-600' : 'text-gray-700'}`}>
                        {record.checkOut ? (
                          <>
                            {record.checkOut.early_leave && <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />}
                            {record.checkOut.display_check_out || getActualTime(record.checkOut)}
                          </>
                        ) : (
                          <span className="text-gray-400">Missing</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {record.shiftType && (
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        record.shiftType === 'morning' ? 'bg-blue-100 text-blue-800' : 
                        record.shiftType === 'evening' ? 'bg-orange-100 text-orange-800' : 
                        record.shiftType === 'night' ? 'bg-purple-100 text-purple-800' : 
                        record.shiftType === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {record.shiftType === 'canteen' 
                          ? (record.checkIn && new Date(record.checkIn.timestamp).getHours() === 7)
                            ? 'Canteen (07:00-16:00)'
                            : 'Canteen (08:00-17:00)'
                          : record.shiftType && typeof record.shiftType === 'string'
                            ? record.shiftType.charAt(0).toUpperCase() + record.shiftType.slice(1)
                            : 'Unknown'}
                      </span>
                    )}
                  </div>
                  
                  {(record.checkIn?.notes || record.checkOut?.notes) && (
                    <div className="mt-2 text-xs text-gray-600 text-break-word">
                      {(record.checkIn?.notes || record.checkOut?.notes || '').replace(/hours:\d+\.\d+;?\s*/, '')}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  // Desktop Table View
  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-md shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-medium text-gray-700 flex items-center">
          <Clock className="w-4 h-4 text-gray-500 mr-2" />
          {title}
        </h3>
      </div>
      
      <div className="overflow-x-auto mobile-table">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Date
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Employee
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Check In
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Check Out
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Shift Type
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Notes
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {processedRecords.map((record, index) => (
              <tr key={index} className={`hover:bg-gray-50 ${record.isOffDay ? 'bg-gray-50' : ''}`}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {safeFormatDate(record.date, 'EEE, MMM d, yyyy')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div>
                    <div className="font-medium">{record.employeeName}</div>
                    <div className="text-xs text-gray-400">#{record.employeeNumber}</div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {record.isOffDay ? (
                    <span className="text-gray-400">OFF-DAY</span>
                  ) : record.checkIn ? (
                    <div className={`flex items-center ${record.checkIn.is_late ? 'text-amber-600' : 'text-gray-600'}`}>
                      {record.checkIn.is_late && <AlertTriangle className="w-4 h-4 mr-1 text-amber-500" />}
                      {record.checkIn.display_check_in || getActualTime(record.checkIn)}
                      {record.checkIn.deduction_minutes > 0 && (
                        <span className="ml-2 px-1.5 py-0.5 bg-red-100 text-red-800 text-xs rounded-full">
                          -{(record.checkIn.deduction_minutes / 60).toFixed(1)}h
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-400">Missing</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {record.isOffDay ? (
                    <span className="text-gray-400">OFF-DAY</span>
                  ) : record.checkOut ? (
                    <div className={`flex items-center ${record.checkOut.early_leave ? 'text-amber-600' : 'text-gray-600'}`}>
                      {record.checkOut.early_leave && <AlertTriangle className="w-4 h-4 mr-1 text-amber-500" />}
                      {record.checkOut.display_check_out || getActualTime(record.checkOut)}
                    </div>
                  ) : (
                    <span className="text-gray-400">Missing</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {record.isOffDay ? (
                    <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">
                      OFF-DAY
                    </span>
                  ) : (
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      record.shiftType === 'morning' ? 'bg-blue-100 text-blue-800' : 
                      record.shiftType === 'evening' ? 'bg-orange-100 text-orange-800' : 
                      record.shiftType === 'night' ? 'bg-purple-100 text-purple-800' : 
                      record.shiftType === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {record.shiftType === 'canteen' 
                        ? (record.checkIn && new Date(record.checkIn.timestamp).getHours() === 7)
                          ? 'Canteen (07:00-16:00)'
                          : 'Canteen (08:00-17:00)'
                        : record.shiftType && typeof record.shiftType === 'string'
                          ? record.shiftType.charAt(0).toUpperCase() + record.shiftType.slice(1)
                          : 'Unknown'}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-normal text-sm text-gray-500 mobile-wrap">
                  {record.isOffDay ? (
                    <span className="text-gray-500">OFF-DAY</span>
                  ) : (record.checkIn?.notes || record.checkOut?.notes) ? (
                    <div className="max-w-[250px] text-break-word">
                      {(record.checkIn?.notes || record.checkOut?.notes || '').replace(/hours:\d+\.\d+;?\s*/, '')}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TimeRecordsTable;