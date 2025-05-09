import React from 'react';
import { format, differenceInMinutes } from 'date-fns';
import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import { DISPLAY_SHIFT_TIMES } from '../../types';
import { formatTime24H } from '../../utils/dateTimeHelper';
import { getEveningShiftCheckoutDisplay } from '../../utils/shiftCalculations';

interface DailyBreakdownProps {
  isLoading: boolean;
  records: any[];
}

const DailyBreakdown: React.FC<DailyBreakdownProps> = ({ isLoading, records }) => {
  // Group records by date for better display
  const recordsByDate = records.reduce((acc: any, record: any) => {
    // For evening shifts with early morning checkout, associate with previous day
    let date = format(new Date(record.timestamp), 'yyyy-MM-dd');
    if (record.status === 'check_out' && 
        record.shift_type === 'evening' && 
        new Date(record.timestamp).getHours() < 12) {
      // This is likely an evening shift checkout on the next day
      // Calculate the previous day to group it correctly
      const prevDate = new Date(record.timestamp);
      prevDate.setDate(prevDate.getDate() - 1);
      date = format(prevDate, 'yyyy-MM-dd');
    }

    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(record);
    return acc;
  }, {});

  // Format time in 24-hour format
  const formatTimeDisplay = (timestamp: string | null): string => {
    if (!timestamp) return '–';
    
    const date = new Date(timestamp);
    return formatTime24H(date);
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
        <div className="hidden sm:grid sm:grid-cols-7 gap-2 p-3 text-xs font-medium text-gray-600 bg-gray-50 rounded-t-md">
          <div className="col-span-2">Date</div>
          <div>Check In</div>
          <div>Check Out</div>
          <div>Shift Type</div>
          <div>Hours</div>
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
          
          if (isOffDay) {
            // Display off day record
            const offDayRecord = dayRecords.find(r => r.status === 'off_day');
            
            // Mobile view
            if (typeof window !== 'undefined' && window.innerWidth < 640) {
              return (
                <div key={date} className="p-3 border-b border-gray-100 last:border-0">
                  <div className="font-medium text-gray-800 mb-2">
                    {format(new Date(date), 'EEE, MMM d, yyyy')}
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
              <div key={date} className="grid grid-cols-7 gap-2 p-3 text-sm">
                <div className="col-span-2">
                  <div className="font-medium text-gray-800">
                    {format(new Date(date), 'EEE, MMM d, yyyy')}
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
                <div>
                  <span className="flex items-center text-green-600">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    <span className="text-xs">Approved</span>
                  </span>
                </div>
              </div>
            );
          }
          
          // Get check-in and check-out records
          const checkIn = dayRecords.find(r => r.status === 'check_in');
          const checkOuts = dayRecords.filter(r => r.status === 'check_out');
          // Get the latest check-out time (most important for night shifts)
          const checkOut = checkOuts.length > 0 ? 
            checkOuts.reduce((latest, current) => {
              return new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest;
            }, checkOuts[0]) : null;
          
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
          
          // Determine if there's a penalty
          const hasPenalty = checkIn && checkIn.deduction_minutes > 0;

          // Determine if this is significant overtime
          const isSignificantOvertime = hours > 9.5;

          // Mobile view
          if (typeof window !== 'undefined' && window.innerWidth < 640) {
            return (
              <div key={date} className="p-3 border-b border-gray-100 last:border-0">
                <div className="font-medium text-gray-800 mb-2">
                  {format(new Date(date), 'EEE, MMM d, yyyy')}
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-gray-500">Check In:</span>
                    <div className={`text-sm mt-1 ${checkIn?.is_late ? 'text-amber-600' : 'text-gray-700'}`}>
                      {checkIn ? (
                        <>
                          {checkIn.is_late && <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />}
                          {formatTimeDisplay(checkIn.timestamp)}
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
                          {formatTimeDisplay(checkOut.timestamp)}
                        </>
                      ) : (
                        <span className="text-gray-400">Missing</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="mt-2 flex flex-wrap gap-2">
                  {checkIn && checkIn.shift_type ? (
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                      checkIn.shift_type === 'morning' ? 'bg-blue-100 text-blue-800' : 
                      checkIn.shift_type === 'evening' ? 'bg-orange-100 text-orange-800' : 
                      checkIn.shift_type === 'night' ? 'bg-purple-100 text-purple-800' :
                      checkIn.shift_type === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {checkIn.shift_type === 'canteen' 
                        ? (new Date(checkIn.timestamp).getHours() === 7 ? 'Canteen (07:00)' : 'Canteen (08:00)') :
                        checkIn.shift_type.charAt(0).toUpperCase() + checkIn.shift_type.slice(1)}
                    </span>
                  ) : (
                    <span className="text-gray-400">–</span>
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
            <div key={date} className="grid grid-cols-7 gap-2 p-3 text-sm">
              <div className="col-span-2">
                <div className="font-medium text-gray-800">
                  {format(new Date(date), 'EEE, MMM d, yyyy')}
                </div>
              </div>
              <div>
                {checkIn ? (
                  <div className={`flex items-center ${checkIn.is_late ? 'text-amber-600' : 'text-gray-700'}`}>
                    {checkIn.is_late && <AlertTriangle className="w-3 h-3 mr-1 text-amber-500" />}
                    {formatTimeDisplay(checkIn.timestamp)}
                  </div>
                ) : (
                  <span className="text-gray-400">Missing</span>
                )}
              </div>
              <div>
                {checkOut ? (
                  <div className={`flex items-center ${checkOut.early_leave ? 'text-amber-600' : 'text-gray-700'}`}>
                    {checkOut.early_leave && <AlertTriangle className="w-3 h-3 mr-1 text-amber-500" />}
                    {formatTimeDisplay(checkOut.timestamp)}
                  </div>
                ) : (
                  <span className="text-gray-400">Missing</span>
                )}
              </div>
              <div className="text-gray-700">
                {checkIn && checkIn.shift_type ? (
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    checkIn.shift_type === 'morning' ? 'bg-blue-100 text-blue-800' : 
                    checkIn.shift_type === 'evening' ? 'bg-orange-100 text-orange-800' : 
                    checkIn.shift_type === 'night' ? 'bg-purple-100 text-purple-800' :
                    checkIn.shift_type === 'canteen' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {checkIn.shift_type === 'canteen' 
                      ? (new Date(checkIn.timestamp).getHours() === 7 ? 'Canteen (07:00)' : 'Canteen (08:00)') :
                      checkIn.shift_type.charAt(0).toUpperCase() + checkIn.shift_type.slice(1)}
                  </span>
                ) : (
                  <span className="text-gray-400">–</span>
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
              <div>
                <span className="flex items-center text-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  <span className="text-xs">Approved</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DailyBreakdown;