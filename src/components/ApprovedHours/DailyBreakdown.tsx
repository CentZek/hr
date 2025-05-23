import React from 'react';
import { format, differenceInMinutes, parseISO, isValid } from 'date-fns';
import { AlertTriangle, CheckCircle, Clock, Calendar as Calendar2 } from 'lucide-react';
import { DISPLAY_SHIFT_TIMES } from '../../types';
import { formatTime24H, formatRecordTime, ensureValidDate, safeGetHours } from '../../utils/dateTimeHelper';
import { getEveningShiftCheckoutDisplay } from '../../utils/shiftCalculations';

interface DailyBreakdownProps {
  isLoading: boolean;
  records: any[];
  doubleDays?: string[];
}

const DailyBreakdown: React.FC<DailyBreakdownProps> = ({ isLoading, records, doubleDays = [] }) => {
  // Group records by date for better display
  const recordsByDate = React.useMemo(() => {
    if (!records || !Array.isArray(records)) {
      console.warn('Invalid records passed to DailyBreakdown:', records);
      return {};
    }
    
    const acc: Record<string, any[]> = {};
    
    records.forEach(record => {
      if (!record) return; // Skip invalid records
      
      // FIXED: Always use working_week_start as the key for grouping
      let dateKey = record.working_week_start || '';
      
      // If working_week_start is not available, extract from timestamp
      if (!dateKey) {
        try {
          // Use the UTC date portion so nothing shifts under local timezones
          if (record.timestamp) {
            const timestamp = record.timestamp;
            const utc = typeof timestamp === 'string' ? parseISO(timestamp) : timestamp;
            if (utc instanceof Date && isValid(utc)) {
              dateKey = utc.toISOString().slice(0,10);  // "YYYY-MM-DD"
            } else {
              dateKey = new Date().toISOString().slice(0,10); // Fallback to today
            }
          } else {
            dateKey = new Date().toISOString().slice(0,10); // Fallback to today
          }
        } catch (error) {
          console.error("Error extracting date key:", error);
          dateKey = new Date().toISOString().slice(0,10); // Fallback to today
        }
      }

      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      
      try {
        acc[dateKey].push(record);
      } catch (error) {
        console.error(`Error adding record to group for date ${dateKey}:`, error);
      }
    });
    
    return acc;
  }, [records]);

  // FIXED: Get standardized display time based on shift type
  const getStandardDisplayTime = (shiftType: string | null, timeType: 'start' | 'end'): string => {
    if (!shiftType || !['morning', 'evening', 'night', 'canteen'].includes(shiftType)) return '—';
    
    const displayTimes = {
      morning: { startTime: '05:00', endTime: '14:00' },
      evening: { startTime: '13:00', endTime: '22:00' },
      night: { startTime: '21:00', endTime: '06:00' },
      canteen: { startTime: '07:00', endTime: '16:00' } // Default to early canteen
    };
    
    return timeType === 'start' ? 
      displayTimes[shiftType as keyof typeof displayTimes].startTime : 
      displayTimes[shiftType as keyof typeof displayTimes].endTime;
  };

  // Format time in 24-hour format with preference for display values
  const formatTimeDisplay = (timestamp: string | null, record: any, timeType: 'in' | 'out'): string => {
    if (!timestamp) return '–';
    if (!record) return '–';
    
    try {
      // Use our new helper function that prioritizes display values for Excel imports
      // and manual entries differently
      return formatRecordTime(record, timeType === 'in' ? 'check_in' : 'check_out');
    } catch (err) {
      console.error("Error formatting time:", err);
      return '–';
    }
  };

  // Check if a date is a double-time day (Friday or holiday)
  const isDoubleTimeDay = (dateStr: string): boolean => {
    if (!dateStr) return false;
    return doubleDays.includes(dateStr);
  };

  const isLateNightShiftCheckIn = (date: Date | null, shiftType: string | null): boolean => {
    if (!date || !shiftType) return false;
    if (shiftType !== 'night') return false;
    
    try {
      const hour = safeGetHours(date);
      return hour >= 21; // 9 PM or later
    } catch (error) {
      console.error("Error checking if late night shift check in:", error);
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-50 p-4 text-center">
        <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
        <p className="text-xs text-gray-500">Loading daily records...</p>
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div className="bg-gray-50 p-4 text-center">
        <p className="text-sm text-gray-500">No detailed records found for this employee.</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 px-4 py-2">
      <div className="bg-white rounded-md border border-gray-200 divide-y divide-gray-100">
        {/* Header */}
        <div className="hidden sm:grid sm:grid-cols-8 gap-2 p-3 text-xs font-medium text-gray-600 bg-gray-50 rounded-t-md">
          <div className="col-span-2">Date</div>
          <div>Check In</div>
          <div>Check Out</div>
          <div>Shift Type</div>
          <div>Hours</div>
          <div>Double-Time</div>
          <div>Status</div>
        </div>

        {/* Mobile Header */}
        <div className="sm:hidden p-3 text-xs font-medium text-gray-600 bg-gray-50 rounded-t-md text-center">
          Daily Records
        </div>

        {/* Records by date */}
        {Object.entries(recordsByDate).map(([date, dayRecords]: [string, any[]]) => {
          if (!date || !Array.isArray(dayRecords)) return null;
          
          // Check if this is an off day
          const isOffDay = dayRecords.some(r => r && r.status === 'off_day');
          const isDoubleTime = isDoubleTimeDay(date);
          
          if (isOffDay) {
            // Display off day record
            const offDayRecord = dayRecords.find(r => r && r.status === 'off_day');
            
            // Mobile view
            if (typeof window !== 'undefined' && window.innerWidth < 640) {
              return (
                <div key={date} className="p-3 border-b border-gray-100 last:border-0">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium text-gray-800">
                      {date ? format(new Date(date), 'EEE, MMM d, yyyy') : 'Unknown Date'}
                    </div>
                    {isDoubleTime && (
                      <span className="inline-flex items-center justify-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                        <span className="font-bold mr-1">2×</span> Double-Time
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-gray-500">Status:</span>
                      <div className="mt-1">
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
                          OFF-DAY
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500">Hours:</span>
                      <div className="font-medium text-gray-800 mt-1">
                        0.00
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            
            // Desktop view
            return (
              <div key={date} className={`grid grid-cols-8 gap-2 p-3 text-sm ${isDoubleTime ? 'bg-amber-50' : ''}`}>
                <div className="col-span-2">
                  <div className="font-medium text-gray-800 flex items-center">
                    {date ? format(new Date(date), 'EEE, MMM d, yyyy') : 'Unknown Date'}
                    {isDoubleTime && (
                      <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs">
                        <span className="font-bold mr-0.5">2×</span> Double-Time
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-red-500 font-medium">OFF-DAY</span>
                </div>
                <div>
                  <span className="text-red-500 font-medium">OFF-DAY</span>
                </div>
                <div className="text-gray-700">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">
                    OFF-DAY
                  </span>
                </div>
                <div className="font-medium text-gray-800">
                  0.00
                </div>
                <div className="font-medium text-gray-800">
                  0.00
                </div>
                <div>
                  <span className="flex items-center text-green-600">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    <span className="text-xs">Approved</span>
                  </span>
                </div>
              </div>
            );
          }
          
          // Group records by shift type
          const recordsByShiftType: Record<string, any[]> = {};
          
          dayRecords.forEach(record => {
            if (!record) return; // Skip invalid records
            
            const shiftType = record.shift_type || 'unknown';
            if (!recordsByShiftType[shiftType]) {
              recordsByShiftType[shiftType] = [];
            }
            
            try {
              recordsByShiftType[shiftType].push(record);
            } catch (error) {
              console.error(`Error adding record to shift type group ${shiftType}:`, error);
            }
          });
          
          // Process each shift type separately
          return Object.entries(recordsByShiftType).map(([shiftType, shiftRecords]) => {
            if (!Array.isArray(shiftRecords) || shiftRecords.length === 0) return null;
            
            // Get check-in and check-out records
            const checkIns = shiftRecords.filter(r => r && r.status === 'check_in');
            const checkOuts = shiftRecords.filter(r => r && r.status === 'check_out');
            
            // Get the main check-in and check-out record
            // For check-in, get the earliest
            const checkIn = checkIns.length > 0 ? 
              checkIns.sort((a, b) => {
                // Safely ensure we have Date objects
                const aDate = ensureValidDate(a.timestamp);
                const bDate = ensureValidDate(b.timestamp);
                
                // Compare if both are valid dates, otherwise preserve original order
                if (aDate && bDate) {
                  return aDate.getTime() - bDate.getTime();
                }
                return 0;
              })[0] : null;
            
            // For check-out, get the latest
            const checkOut = checkOuts.length > 0 ? 
              checkOuts.sort((a, b) => {
                // Safely ensure we have Date objects
                const aDate = ensureValidDate(a.timestamp);
                const bDate = ensureValidDate(b.timestamp);
                
                // Compare if both are valid dates, otherwise preserve original order
                if (aDate && bDate) {
                  return bDate.getTime() - aDate.getTime();
                }
                return 0;
              })[0] : null;
            
            // Get hours - prioritize exact_hours field first
            let hours = 0;
            
            // If we have exact_hours field available, use that (preferred method)
            if (checkIn && checkIn.exact_hours !== null && checkIn.exact_hours !== undefined) {
              hours = parseFloat(checkIn.exact_hours || 0);
            } 
            // If checkout has exact hours, use that as backup
            else if (checkOut && checkOut.exact_hours !== null && checkOut.exact_hours !== undefined) {
              hours = parseFloat(checkOut.exact_hours || 0);
            }
            // Fall back to parsing from notes
            else if (checkIn && checkIn.notes && checkIn.notes.includes("hours:")) {
              try {
                const hoursMatch = checkIn.notes.match(/hours:(\d+\.\d+)/);
                if (hoursMatch && hoursMatch[1]) {
                  hours = parseFloat(hoursMatch[1]);
                  if (isNaN(hours)) hours = 0;
                }
              } catch (e) {
                console.error("Error parsing hours from notes:", e);
              }
            } 
            else if (checkOut && checkOut.notes && checkOut.notes.includes("hours:")) {
              try {
                const hoursMatch = checkOut.notes.match(/hours:(\d+\.\d+)/);
                if (hoursMatch && hoursMatch[1]) {
                  hours = parseFloat(hoursMatch[1]);
                  if (isNaN(hours)) hours = 0;
                }
              } catch (e) {
                console.error("Error parsing hours from notes:", e);
              }
            }
            
            // If no stored hours, calculate using the timestamps
            if (hours === 0 && checkIn && checkOut) {
              try {
                // Validate timestamps
                const checkInTime = ensureValidDate(checkIn.timestamp);
                const checkOutTime = ensureValidDate(checkOut.timestamp);
                
                if (checkInTime && checkOutTime) {
                  // Calculate total minutes
                  let diffMinutes = differenceInMinutes(checkOutTime, checkInTime);
                  
                  // If time difference is negative, it means checkout is on the next day
                  if (diffMinutes < 0) {
                    diffMinutes += 24 * 60; // Add 24 hours
                  }
                  
                  // Convert to hours
                  hours = diffMinutes / 60;
                  
                  // Apply deduction minutes if any
                  if (checkIn.deduction_minutes) {
                    hours = Math.max(0, hours - (checkIn.deduction_minutes / 60));
                  }
                  
                  // Round to exactly a 2 decimal number
                  hours = parseFloat(hours.toFixed(2));
                }
              } catch (error) {
                console.error('Error calculating hours from timestamps:', error);
              }
            }
            
            // Calculate double-time hours if applicable
            const doubleTimeHours = isDoubleTime ? hours : 0;
            
            // Determine if there's a penalty
            const hasPenalty = checkIn && checkIn.deduction_minutes > 0;

            // Determine if this is significant overtime
            const isSignificantOvertime = hours > 9.5;

            // Get display times for this shift
            let checkInDisplay = checkIn ? 
              formatTimeDisplay(checkIn.timestamp, checkIn, 'in') :
              (isOffDay ? 'OFF-DAY' : 'Missing');
            
            let checkOutDisplay = checkOut ? 
              formatTimeDisplay(checkOut.timestamp, checkOut, 'out') : 
              (isOffDay ? 'OFF-DAY' : 'Missing');
            
            // Generate a unique key for this shift group
            const shiftKey = `${date}-${shiftType}`;
            
            // Get check-in hour safely for later use
            const checkInTime = ensureValidDate(checkIn?.timestamp);
            const checkInHour = checkInTime ? checkInTime.getHours() : null;
            
            // Determine if this is a late night check-in for night shift
            const isLateNightCheckIn = checkInTime && 
              shiftType === 'night' && 
              checkInHour !== null && 
              checkInHour >= 21;
            
            // Mobile view
            if (typeof window !== 'undefined' && window.innerWidth < 640) {
              return (
                <div key={shiftKey} className={`p-3 border-b border-gray-100 last:border-0 ${isDoubleTime ? 'bg-amber-50' : ''}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium text-gray-800">
                      {date ? format(new Date(date), 'EEE, MMM d, yyyy') : 'Unknown Date'}
                    </div>
                    {isDoubleTime && (
                      <span className="inline-flex items-center justify-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                        <span className="font-bold mr-1">2×</span> Double-Time
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div>
                      <span className="text-xs text-gray-500">Check In</span>
                      <div className={`text-sm mt-1 ${checkIn?.is_late ? 'text-amber-600' : 'text-gray-700'}`}>
                        {checkIn ? (
                          <>
                            {checkIn.is_late && <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />}
                            {checkInDisplay}
                          </>
                        ) : (
                          <span className="text-gray-400">Missing</span>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <span className="text-xs text-gray-500">Check Out</span>
                      <div className={`text-sm mt-1 ${checkOut?.early_leave ? 'text-amber-600' : 'text-gray-700'}`}>
                        {checkOut ? (
                          <>
                            {checkOut.early_leave && <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />}
                            {checkOutDisplay}
                          </>
                        ) : (
                          <span className="text-gray-400">Missing</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {shiftType && (
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        shiftType === 'morning' ? 'bg-blue-100 text-blue-800' : 
                        shiftType === 'evening' ? 'bg-orange-100 text-orange-800' : 
                        shiftType === 'night' ? 'bg-purple-100 text-purple-800' :
                        shiftType === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {shiftType === 'canteen' 
                          ? (checkInHour === 7 ? 'Canteen (07:00-16:00)' : 'Canteen (08:00-17:00)') :
                          shiftType.charAt(0).toUpperCase() + shiftType.slice(1)}
                      </span>
                    )}
                    
                    <span className="font-medium text-gray-800 flex items-center px-2 py-0.5 bg-gray-100 rounded-full text-xs">
                      {hours.toFixed(2)} hrs
                      {isSignificantOvertime && 
                        <Clock className="w-3 h-3 ml-1 text-blue-500" title="Overtime hours" />
                      }
                      {hasPenalty && (
                        <span className="ml-1 text-xs text-red-600">
                          (-{(checkIn.deduction_minutes / 60).toFixed(2)}h)
                        </span>
                      )}
                    </span>
                    
                    {isDoubleTime && doubleTimeHours > 0 && (
                      <span className="font-medium text-amber-800 flex items-center px-2 py-0.5 bg-amber-100 rounded-full text-xs">
                        <span className="font-bold mr-1">2×</span>
                        {doubleTimeHours.toFixed(2)} hrs
                      </span>
                    )}
                    
                    <span className="flex items-center text-green-600 px-2 py-0.5 bg-green-50 rounded-full text-xs">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      <span>Approved</span>
                    </span>
                  </div>
                </div>
              );
            }
            
            // Desktop view
            return (
              <div key={shiftKey} className={`grid grid-cols-8 gap-2 p-3 text-sm ${isDoubleTime ? 'bg-amber-50' : ''}`}>
                <div className="col-span-2">
                  <div className="font-medium text-gray-800 flex items-center">
                    {date ? format(new Date(date), 'EEE, MMM d, yyyy') : 'Unknown Date'}
                    {isDoubleTime && (
                      <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs">
                        <span className="font-bold mr-0.5">2×</span> Double-Time
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  {checkIn ? (
                    <div className={`flex items-center ${checkIn.is_late ? 'text-amber-600' : 'text-gray-700'}`}>
                      {checkIn.is_late && <AlertTriangle className="w-4 h-4 mr-1 text-amber-500" />}
                      {checkInDisplay}
                    </div>
                  ) : (
                    <span className="text-gray-400">Missing</span>
                  )}
                </div>
                <div>
                  {checkOut ? (
                    <div className={`flex items-center ${checkOut.early_leave ? 'text-amber-600' : 'text-gray-700'}`}>
                      {checkOut.early_leave && <AlertTriangle className="w-4 h-4 mr-1 text-amber-500" />}
                      {checkOutDisplay}
                    </div>
                  ) : (
                    <span className="text-gray-400">Missing</span>
                  )}
                </div>
                <div className="text-gray-700">
                  {shiftType && (
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      shiftType === 'morning' ? 'bg-blue-100 text-blue-800' : 
                      shiftType === 'evening' ? 'bg-orange-100 text-orange-800' : 
                      shiftType === 'night' ? 'bg-purple-100 text-purple-800' :
                      shiftType === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {shiftType === 'canteen' 
                        ? (checkInHour === 7 ? 'Canteen (07:00-16:00)' : 'Canteen (08:00-17:00)') :
                        shiftType.charAt(0).toUpperCase() + shiftType.slice(1)}
                    </span>
                  )}
                </div>
                <div className="font-medium flex items-center">
                  {hours.toFixed(2)}
                  {isSignificantOvertime && 
                    <Clock className="w-4 h-4 ml-1 text-blue-500" title="Overtime hours" />
                  }
                  {hasPenalty && (
                    <span className="ml-1 text-xs text-red-600">
                      (-{(checkIn.deduction_minutes / 60).toFixed(2)}h)
                    </span>
                  )}
                </div>
                <div className="font-medium flex items-center">
                  {isDoubleTime ? (
                    <span className="inline-flex items-center text-amber-800">
                      <span className="font-bold mr-1">2×</span>
                      {doubleTimeHours.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </div>
                <div>
                  <span className="flex items-center text-green-600">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    <span className="text-xs">Approved</span>
                  </span>
                </div>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
};

export default DailyBreakdown;