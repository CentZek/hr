import React from 'react';
import { format, differenceInMinutes, parseISO } from 'date-fns';
import { AlertTriangle, CheckCircle, Clock, Calendar2 } from 'lucide-react';
import { DISPLAY_SHIFT_TIMES } from '../../types';
import { formatTime24H, formatRecordTime } from '../../utils/dateTimeHelper';
import { getEveningShiftCheckoutDisplay } from '../../utils/shiftCalculations';

interface reqPayload {
  name: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface DailyBreakdownProps {
  isLoading: boolean;
  records: any[];
  doubleDays?: string[];
}

const DailyBreakdown: React.FC<DailyBreakdownProps> = ({ isLoading, records, doubleDays = [] }) => {
  // Group records by date for better display
  const recordsByDate = records.reduce((acc: any, record: any) => {
    // FIXED: Always use working_week_start as the key for grouping
    let dateKey = record.working_week_start || '';
    
    // If working_week_start is not available, extract from timestamp
    if (!dateKey) {
      // Use the UTC date portion so nothing shifts under local timezones
      const utc = parseISO(record.timestamp);
      dateKey = utc.toISOString().slice(0,10);  // "YYYY-MM-DD"
    }

    if (!acc[dateKey]) {
      acc[dateKey] = [];
    }
    acc[dateKey].push(record);
    return acc;
  }, {});

  // FIXED: Get standardized display time based on shift type
  const getStandardDisplayTime = (shiftType: string, timeType: 'start' | 'end'): string => {
    if (!shiftType || !['morning', 'evening', 'night', 'canteen'].includes(shiftType)) {
      return '—';
    }
    
    if (shiftType === 'morning') {
      return timeType === 'start' ? '05:00' : '14:00';
    }
    if (shiftType === 'evening') {
      return timeType === 'start' ? '13:00' : '22:00';
    }
    if (shiftType === 'night') {
      return timeType === 'start' ? '21:00' : '06:00';
    }
    if (shiftType === 'canteen') {
      return timeType === 'start' ? '07:00' : '16:00';
    }
    
    return '—';
  };

  // Format time in 24-hour format with preference for display values
  const formatTimeDisplay = (timestamp: string | null, record: any, timeType: 'in' | 'out'): string => {
    if (!timestamp) return '–';
    
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
    return doubleDays.includes(dateStr);
  };

  if (isLoading) {
    return (
      <div className="bg-gray-50 p-4 text-center">
        <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
        <p className="text-xs text-gray-500">Loading daily records...</p>
      </div>
    );
  }

  if (records.length === 0) {
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
          // Check if this is an off day
          const isOffDay = dayRecords.some(r => r.status === 'off_day');
          const isDoubleTime = isDoubleTimeDay(date);
          
          if (isOffDay) {
            // Display off day record
            const offDayRecord = dayRecords.find(r => r.status === 'off_day');
            
            // Mobile view
            if (typeof window !== 'undefined' && window.innerWidth < 640) {
              return (
                <div key={date} className="p-3 border-b border-gray-100 last:border-0">
                  <div className="font-medium text-gray-800 mb-2 flex items-center justify-between">
                    <div>{format(new Date(date), 'EEE, MMM d, yyyy')}</div>
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
                    {format(new Date(date), 'EEE, MMM d, yyyy')}
                    {isDoubleTime && (
                      <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs">
                        <span className="font-bold mr-0.5">2×</span> Double
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
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
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
            const shiftType = record.shift_type || 'unknown';
            if (!recordsByShiftType[shiftType]) {
              recordsByShiftType[shiftType] = [];
            }
            recordsByShiftType[shiftType].push(record);
          });
          
          // Process each shift type
          return Object.entries(recordsByShiftType).map(([shiftType, shiftRecords]) => {
            // Get check-in and check-out records
            const checkIns = shiftRecords.filter(r => r.status === 'check_in');
            const checkOuts = shiftRecords.filter(r => r.status === 'check_out');
            
            // Get the main check-in and check-out record
            // For check-in, get the earliest
            const checkIn = checkIns.length > 0 ? 
              checkIns.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())[0] : null;
            
            // For check-out, get the latest
            const checkOut = checkOuts.length > 0 ? 
              checkOuts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] : null;
            
            // Get hours - prioritize exact_hours field first
            let hours = 0;
            
            // If we have exact_hours field available, use that (preferred method)
            if (checkIn && checkIn.exact_hours !== null && checkIn.exact_hours !== undefined) {
              hours = parseFloat(checkIn.exact_hours);
            } 
            // If checkout has exact hours, use that as backup
            else if (checkOut && checkOut.exact_hours !== null && checkOut.exact_hours !== undefined) {
              hours = parseFloat(checkOut.exact_hours);
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
              const checkInTime = new Date(checkIn.timestamp);
              const checkOutTime = new Date(checkOut.timestamp);
              
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
            
            // Calculate double-time hours if applicable
            const doubleTimeHours = isDoubleTime ? hours * 2 : hours;
            
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
            
            // Mobile view
            if (typeof window !== 'undefined' && window.innerWidth < 640) {
              return (
                <div key={shiftKey} className={`p-3 border-b border-gray-100 last:border-0 ${isDoubleTime ? 'bg-amber-50' : ''}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium text-gray-800">
                      {format(new Date(date), 'EEE, MMM d, yyyy')}
                    </div>
                    {isDoubleTime && (
                      <span className="inline-flex items-center justify-center px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                        <span className="font-bold mr-1">2×</span> Double-Time
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-gray-500">Check In:</span>
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
                      <span className="text-xs text-gray-500">Check Out:</span>
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
                  
                  <div className="mt-2 flex flex-wrap gap-2">
                    {shiftType && (
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        shiftType === 'morning' ? 'bg-blue-100 text-blue-800' : 
                        shiftType === 'evening' ? 'bg-orange-100 text-orange-800' : 
                        shiftType === 'night' ? 'bg-purple-100 text-purple-800' :
                        shiftType === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {shiftType === 'canteen' 
                          ? (checkIn && new Date(checkIn.timestamp).getHours() === 7 ? 'Canteen (07:00)' : 'Canteen (08:00)') :
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
                    
                    {isDoubleTime && (
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
                    {format(new Date(date), 'EEE, MMM d, yyyy')}
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
                      {checkIn.is_late && <AlertTriangle className="w-3 h-3 mr-1 text-amber-500" />}
                      {checkInDisplay}
                    </div>
                  ) : (
                    <span className="text-gray-400">Missing</span>
                  )}
                </div>
                <div>
                  {checkOut ? (
                    <div className={`flex items-center ${checkOut.early_leave ? 'text-amber-600' : 'text-gray-700'}`}>
                      {checkOut.early_leave && <AlertTriangle className="w-3 h-3 mr-1 text-amber-500" />}
                      {checkOutDisplay}
                    </div>
                  ) : (
                    <span className="text-gray-400">Missing</span>
                  )}
                </div>
                <div className="text-gray-700">
                  {shiftType && (
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      shiftType === 'morning' ? 'bg-blue-100 text-blue-800' : 
                      shiftType === 'evening' ? 'bg-orange-100 text-orange-800' : 
                      shiftType === 'night' ? 'bg-purple-100 text-purple-800' :
                      shiftType === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {shiftType === 'canteen' 
                        ? (checkIn && new Date(checkIn.timestamp).getHours() === 7 ? 'Canteen (07:00)' : 'Canteen (08:00)') :
                        shiftType.charAt(0).toUpperCase() + shiftType.slice(1)}
                    </span>
                  )}
                </div>
                <div className="font-medium text-gray-800 flex items-center">
                  {hours.toFixed(2)}
                  {isSignificantOvertime && 
                    <Clock className="w-3 h-3 ml-1 text-blue-500" title="Overtime hours" />
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