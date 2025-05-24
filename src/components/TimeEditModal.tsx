import React, { useState } from 'react';
import { format, parse, addDays } from 'date-fns';
import { X, Clock, AlertCircle, Info, RefreshCw, Repeat } from 'lucide-react';
import { EmployeeRecord, DailyRecord, DISPLAY_SHIFT_TIMES, LATE_THRESHOLDS } from '../types';
import { formatTimeWith24Hour } from '../utils/dateTimeHelper';

interface TimeEditModalProps {
  employee: EmployeeRecord;
  day: DailyRecord;
  onClose: () => void;
  onSave: (checkIn: Date | null, checkOut: Date | null) => void;
}

const TimeEditModal: React.FC<TimeEditModalProps> = ({ employee, day, onClose, onSave }) => {
  const [checkInTime, setCheckInTime] = useState<string>(
    day.firstCheckIn ? format(day.firstCheckIn, 'HH:mm') : ''
  );
  const [checkOutTime, setCheckOutTime] = useState<string>(
    day.lastCheckOut ? format(day.lastCheckOut, 'HH:mm') : ''
  );
  const [checkInError, setCheckInError] = useState<string>('');
  const [checkOutError, setCheckOutError] = useState<string>('');
  const [showCorrectionInfo, setShowCorrectionInfo] = useState<boolean>(!!day.correctedRecords);

  const dateStr = format(new Date(day.date), 'yyyy-MM-dd');
  
  // Determine if this might be a night shift based on check-in time
  // This ensures we handle night shift logic even if day.shiftType is not set
  const isNightShift = () => {
    // If shift type is explicitly set to night, respect it
    if (day.shiftType === 'night') return true;
    
    // If check-in time is available and is evening (after 21:00), treat as night shift
    if (checkInTime) {
      const hour = parseInt(checkInTime.split(':')[0], 10);
      if (hour >= 21) return true; // After 21:00
    }
    
    return false;
  };

  // Determine if this is a canteen shift
  const isCanteenShift = () => {
    return day.shiftType === 'canteen';
  };
  
  // Check if time falls within 7AM canteen hours
  const is7AMCanteenHours = (timeStr: string): boolean => {
    if (!timeStr) return false;
    
    try {
      const hour = parseInt(timeStr.split(':')[0], 10);
      
      // 07:00 is standard early canteen staff start time
      return hour === 7;
    } catch (error) {
      return false;
    }
  };
  
  // Check if time falls within 8AM canteen hours
  const is8AMCanteenHours = (timeStr: string): boolean => {
    if (!timeStr) return false;
    
    try {
      const hour = parseInt(timeStr.split(':')[0], 10);
      
      // 08:00 is standard late canteen staff start time
      return hour === 8;
    } catch (error) {
      return false;
    }
  };
  
  // Check if this time would be considered late based on shift type
  const isLateForShift = (timeStr: string): boolean => {
    if (!timeStr || !day.shiftType) return false;
    
    try {
      const hour = parseInt(timeStr.split(':')[0], 10);
      const minute = parseInt(timeStr.split(':')[1], 10);
      
      if (day.shiftType === 'canteen') {
        // For early canteen shift (07:00 start) 
        if (hour === 7) {
          return minute > LATE_THRESHOLDS.canteen;
        }
        // For late canteen shift (08:00 start)
        else if (hour === 8) {
          return minute > LATE_THRESHOLDS.canteen;
        }
        // If not at the exact starting hour, it's late
        return (hour > 8 || (hour < 7));
      }
      
      return false;
    } catch (error) {
      return false;
    }
  };

  // Helper to convert 24-hour time to 12-hour format with AM/PM
  const formatTimeWithAmPm = (timeString: string): string => {
    if (!timeString) return '';
    try {
      const timeParts = timeString.split(':');
      const hour = parseInt(timeParts[0], 10);
      const minute = parseInt(timeParts[1], 10);
      
      const period = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;
      
      return `${hour12}:${minute.toString().padStart(2, '0')} ${period}`;
    } catch (e) {
      return timeString;
    }
  };

  // Swap check-in and check-out times (for fixing mislabeled records)
  const handleSwapTimes = () => {
    const tempCheckIn = checkInTime;
    setCheckInTime(checkOutTime);
    setCheckOutTime(tempCheckIn);
    setShowCorrectionInfo(true);
  };

  const handleSave = () => {
    setCheckInError('');
    setCheckOutError('');
    
    // Check if both times are empty - if so, mark as OFF-DAY
    const bothEmpty = !checkInTime.trim() && !checkOutTime.trim();
    
    if (bothEmpty) {
      // Set to OFF-DAY by passing null for both values
      onSave(null, null);
      return;
    }
    
    let checkIn: Date | null = null;
    let checkOut: Date | null = null;
    let hasError = false;

    // Parse check-in time if provided
    if (checkInTime.trim()) {
      try {
        checkIn = parse(`${dateStr} ${checkInTime}`, 'yyyy-MM-dd HH:mm', new Date());
      } catch (error) {
        setCheckInError('Invalid time format');
        hasError = true;
      }
    }

    // Parse check-out time if provided
    if (checkOutTime.trim()) {
      try {
        const checkOutHour = parseInt(checkOutTime.split(':')[0], 10);
        
        // Check if this is a night shift with early morning checkout
        if (isNightShift() && checkOutHour < 12) {
          // For night shift, early morning hours are on the next day
          const nextDayStr = format(addDays(new Date(dateStr), 1), 'yyyy-MM-dd');
          checkOut = parse(`${nextDayStr} ${checkOutTime}`, 'yyyy-MM-dd HH:mm', new Date());
        } else {
          // Regular same-day checkout
          checkOut = parse(`${dateStr} ${checkOutTime}`, 'yyyy-MM-dd HH:mm', new Date());
        }
      } catch (error) {
        setCheckOutError('Invalid time format');
        hasError = true;
      }
    }

    // Skip time sequence validation for night shifts with morning checkout
    if (checkIn && checkOut) {
      const checkInHour = checkIn.getHours();
      const checkOutHour = checkOut.getHours();
      
      // Only validate time sequence if both times are on the same day
      // Skip validation for night shifts when checkout is in early morning hours (next day)
      if (checkIn.getDate() === checkOut.getDate() && !(isNightShift() && checkOutHour < 12)) {
        // Both times on the same day, check that checkout is after checkin
        if (checkIn.getTime() >= checkOut.getTime()) {
          setCheckOutError('Check-out time must be after check-in time');
          hasError = true;
        }
      }
    }

    if (!hasError) {
      onSave(checkIn, checkOut);
    }
  };

  // Get shift specific notes or instructions
  const getShiftSpecificNotes = () => {
    if (!day.shiftType) return null;
    
    if (day.shiftType === 'morning') {
      return (
        <div className="mt-3 bg-blue-50 border border-blue-100 rounded-md p-3 text-sm text-blue-800">
          <p className="font-medium flex items-center">
            <Info className="w-4 h-4 mr-1" /> Morning Shift Schedule
          </p>
          <p>Standard hours: 05:00 - 14:00</p>
          <p>Late threshold: 0 minutes (05:00)</p>
          <p>Early leave allowed from: 13:30</p>
        </div>
      );
    }
    
    if (day.shiftType === 'evening') {
      return (
        <div className="mt-3 bg-orange-50 border border-orange-100 rounded-md p-3 text-sm text-orange-800">
          <p className="font-medium flex items-center">
            <Info className="w-4 h-4 mr-1" /> Evening Shift Schedule
          </p>
          <p>Standard hours: 13:00 - 22:00</p>
          <p>Late threshold: 0 minutes (13:00)</p>
          <p>Early leave allowed from: 21:30</p>
        </div>
      );
    }
    
    if (day.shiftType === 'canteen') {
      // Check if this is early (7AM) or late (8AM) canteen shift
      const checkInHour = day.firstCheckIn?.getHours();
      
      return (
        <div className="mt-3 bg-blue-50 border border-blue-100 rounded-md p-3 text-sm text-blue-800">
          <p className="font-medium flex items-center">
            <Info className="w-4 h-4 mr-1" /> Canteen Staff Schedule
          </p>
          <p>Standard hours: {checkInHour === 7 ? '07:00 - 16:00' : '08:00 - 17:00'}</p>
          <p>Late threshold: 10 minutes ({checkInHour === 7 ? '07:10' : '08:10'})</p>
          <p>Early leave allowed from: {checkInHour === 7 ? '15:30' : '16:30'}</p>
        </div>
      );
    }
    
    if (day.shiftType === 'night' || isNightShift()) {
      return (
        <div className="mt-3 bg-purple-50 border border-purple-100 rounded-md p-3 text-sm text-purple-800">
          <p className="font-medium flex items-center">
            <Info className="w-4 h-4 mr-1" /> Night Shift Schedule
          </p>
          <p>Standard hours: 21:00 - 06:00 (next day)</p>
          <p>Late threshold: 30 minutes (21:30)</p>
          <p>Early leave allowed from: 05:30 (next day)</p>
        </div>
      );
    }
    
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Edit Time Records</h3>
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="mb-6">
            <h4 className="text-base font-medium text-gray-800 mb-2">Employee Information</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Name</p>
                <p className="font-medium">{employee.name}</p>
              </div>
              <div>
                <p className="text-gray-500">Employee No</p>
                <p className="font-medium">{employee.employeeNumber}</p>
              </div>
              <div>
                <p className="text-gray-500">Date</p>
                <p className="font-medium">{format(new Date(day.date), 'MM/dd/yyyy')}</p>
              </div>
              <div>
                <p className="text-gray-500">Shift Type</p>
                <p className="font-medium capitalize">
                  {day.shiftType === 'canteen' ? (
                    day.firstCheckIn?.getHours() === 7 ? 
                      'Canteen (07:00-16:00)' : 
                      'Canteen (08:00-17:00)'
                  ) : (
                    day.shiftType || (isNightShift() ? 'Night (Auto-detected)' : 'Unknown')
                  )}
                </p>
              </div>
            </div>
            
            {/* Shift-specific information */}
            {getShiftSpecificNotes()}
          </div>
          
          {/* Corrected records info */}
          {(showCorrectionInfo || day.correctedRecords) && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="font-medium text-yellow-800 flex items-center">
                <RefreshCw className="w-4 h-4 mr-2" />
                Correcting Mislabeled Records
              </p>
              <p className="text-sm text-yellow-700 mt-1">
                This employee has check-in/check-out records that may have been mislabeled. 
                Use the "Swap Times" button if the check-in should be check-out or vice versa.
              </p>
            </div>
          )}
          
          {/* Time format information */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-md flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-500 mr-2 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-700">
              <p className="font-medium">24-hour time format</p>
              <p>Enter times in 24-hour format. For example:</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                <li>5:00 AM = 05:00</li>
                <li>7:00 AM = 07:00 (Early canteen)</li>
                <li>8:00 AM = 08:00 (Late canteen)</li>
                <li>1:30 PM = 13:30</li>
                <li>4:00 PM = 16:00 (Early canteen checkout)</li>
                <li>5:00 PM = 17:00 (Late canteen checkout)</li>
                <li>9:00 PM = 21:00 (Night shift start)</li>
                <li>6:00 AM = 06:00 (Night shift end)</li>
              </ul>
              
              {isCanteenShift() && (
                <p className="mt-1 text-green-700 font-medium">
                  {day.firstCheckIn?.getHours() === 7 ? 
                    "Canteen hours (07:00 - 16:00) will be used with 10-minute late threshold." : 
                    "Canteen hours (08:00 - 17:00) will be used with 10-minute late threshold."}
                </p>
              )}
              
              {(isNightShift() || day.shiftType === 'night') && (
                <p className="mt-1 font-medium">
                  For night shifts: Morning check-out times (like 06:00) will automatically be recognized as next-day times.
                </p>
              )}
              
              <p className="mt-1 text-amber-600 font-medium">
                Note: Removing both times will mark this as an OFF-DAY.
              </p>
            </div>
          </div>
          
          <div className="space-y-4">
            <div>
              <label htmlFor="check-in-time" className="block text-sm font-medium text-gray-700 mb-1">
                Check-In Time {day.missingCheckIn && <span className="text-red-500">(Missing)</span>}
                {day.correctedRecords && <span className="text-amber-500 ml-1">(Fixed)</span>}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Clock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="time"
                  id="check-in-time"
                  value={checkInTime}
                  onChange={(e) => {
                    setCheckInTime(e.target.value);
                    setCheckInError('');
                  }}
                  className={`block w-full pl-10 pr-3 py-2 sm:text-sm border ${
                    checkInError ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                    'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
                  } rounded-md`}
                  placeholder="HH:MM"
                />
                <div className="mt-1 text-xs text-gray-600">
                  {checkInTime && (
                    <>
                      <span>You entered: {formatTimeWithAmPm(checkInTime)}</span>
                      {isLateForShift(checkInTime) && (
                        <span className="ml-2 text-amber-600 font-medium">
                          (Will be flagged as late)
                        </span>
                      )}
                      {is7AMCanteenHours(checkInTime) && day.shiftType !== 'canteen' && (
                        <span className="ml-2 text-blue-600 font-medium">
                          (Matches canteen 07:00 shift)
                        </span>
                      )}
                      {is8AMCanteenHours(checkInTime) && day.shiftType !== 'canteen' && (
                        <span className="ml-2 text-blue-600 font-medium">
                          (Matches canteen 08:00 shift)
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              {checkInError && <p className="mt-1 text-xs text-red-600">{checkInError}</p>}
              {day.shiftType === 'morning' && (
                <p className="mt-1 text-xs text-gray-500">Expected around 05:00</p>
              )}
              {day.shiftType === 'canteen' && day.firstCheckIn?.getHours() === 7 && (
                <p className="mt-1 text-xs text-gray-500">Expected around 07:00</p>
              )}
              {day.shiftType === 'canteen' && day.firstCheckIn?.getHours() === 8 && (
                <p className="mt-1 text-xs text-gray-500">Expected around 08:00</p>
              )}
              {day.shiftType === 'evening' && (
                <p className="mt-1 text-xs text-gray-500">Expected around 13:00</p>
              )}
              {(isNightShift() || day.shiftType === 'night') && (
                <p className="mt-1 text-xs text-gray-500">Expected around 21:00</p>
              )}
            </div>
            
            <div>
              <label htmlFor="check-out-time" className="block text-sm font-medium text-gray-700 mb-1">
                Check-Out Time {day.missingCheckOut && <span className="text-red-500">(Missing)</span>}
                {day.correctedRecords && <span className="text-amber-500 ml-1">(Fixed)</span>}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Clock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="time"
                  id="check-out-time"
                  value={checkOutTime}
                  onChange={(e) => {
                    setCheckOutTime(e.target.value);
                    setCheckOutError('');
                  }}
                  className={`block w-full pl-10 pr-3 py-2 sm:text-sm border ${
                    checkOutError ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                    'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
                  } rounded-md`}
                  placeholder="HH:MM"
                />
                <div className="mt-1 text-xs text-gray-600">
                  {checkOutTime && `You entered: ${formatTimeWithAmPm(checkOutTime)}`}
                </div>
              </div>
              {checkOutError && <p className="mt-1 text-xs text-red-600">{checkOutError}</p>}
              {day.shiftType === 'morning' && (
                <p className="mt-1 text-xs text-gray-500">Expected around 14:00</p>
              )}
              {day.shiftType === 'canteen' && day.firstCheckIn?.getHours() === 7 && (
                <p className="mt-1 text-xs text-gray-500">Expected around 16:00</p>
              )}
              {day.shiftType === 'canteen' && day.firstCheckIn?.getHours() === 8 && (
                <p className="mt-1 text-xs text-gray-500">Expected around 17:00</p>
              )}
              {day.shiftType === 'evening' && (
                <p className="mt-1 text-xs text-gray-500">Expected around 22:00</p>
              )}
              {(isNightShift() || day.shiftType === 'night') && (
                <p className="mt-1 text-xs text-gray-500">Expected around 06:00 (next day)</p>
              )}
              
              {(isNightShift() || day.shiftType === 'night') && (
                <p className="mt-1 text-xs font-medium text-purple-600">
                  For night shift: Early morning hours (00:00-12:00) will automatically be treated as next-day times.
                </p>
              )}
            </div>
            
            {/* Swap times button for mislabeled records */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleSwapTimes}
                className="flex items-center px-3 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 
                           rounded-md hover:bg-yellow-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
              >
                <Repeat className="w-4 h-4 mr-2" />
                Swap Check-In/Out Times
              </button>
            </div>
          </div>
          
          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimeEditModal;