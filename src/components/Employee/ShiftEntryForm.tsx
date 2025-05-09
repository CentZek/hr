import React, { useState } from 'react';
import { format } from 'date-fns';
import { Clock, X, Calendar, Check } from 'lucide-react';
import { SHIFT_TIMES, DISPLAY_SHIFT_TIMES } from '../../types';

interface ShiftEntryFormProps {
  date: Date | null;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  existingShift?: any;
}

// Valid shift types
const VALID_SHIFT_TYPES = ['morning', 'evening', 'night'] as const;
type ShiftType = typeof VALID_SHIFT_TYPES[number];

// Helper to validate shift type
const isValidShiftType = (type: any): type is ShiftType => {
  return VALID_SHIFT_TYPES.includes(type);
};

const ShiftEntryForm: React.FC<ShiftEntryFormProps> = ({ 
  date, 
  onSubmit, 
  onCancel,
  existingShift
}) => {
  // Validate existingShift.shift_type and default to 'morning' if invalid
  const initialShiftType = isValidShiftType(existingShift?.shift_type) 
    ? existingShift.shift_type 
    : 'morning';

  const [shiftType, setShiftType] = useState<ShiftType>(initialShiftType);
  const [startTime, setStartTime] = useState<string>(
    existingShift?.start_time || ''
  );
  const [endTime, setEndTime] = useState<string>(
    existingShift?.end_time || ''
  );
  const [notes, setNotes] = useState<string>(
    existingShift?.notes || ''
  );
  const [errors, setErrors] = useState<{
    startTime?: string;
    endTime?: string;
    general?: string;
  }>({});

  // For default times based on shift
  const getDefaultTimes = (type: ShiftType) => {
    const times = SHIFT_TIMES[type];
    
    return {
      start: `${String(times.start.hour).padStart(2, '0')}:${String(times.start.minute).padStart(2, '0')}`,
      end: `${String(times.end.hour).padStart(2, '0')}:${String(times.end.minute).padStart(2, '0')}`
    };
  };

  // Apply default times when shift type changes
  const handleShiftTypeChange = (type: ShiftType) => {
    setShiftType(type);
    const times = getDefaultTimes(type);
    setStartTime(times.start);
    setEndTime(times.end);
  };

  const validateForm = () => {
    const newErrors: {
      startTime?: string;
      endTime?: string;
      general?: string;
    } = {};
    
    if (!startTime) {
      newErrors.startTime = 'Start time is required';
    }
    
    if (!endTime) {
      newErrors.endTime = 'End time is required';
    }
    
    // For night shift, end time is expected to be less than start time (crossing midnight)
    if (shiftType === 'night' && startTime && endTime) {
      const startHour = parseInt(startTime.split(':')[0], 10);
      const endHour = parseInt(endTime.split(':')[0], 10);
      
      // For night shift, we expect end time to be in early morning hours (less than start time)
      if (endHour > 12 && endHour < startHour) {
        newErrors.endTime = 'For night shift, end time should be in the morning hours';
      }
    } else if (startTime && endTime) {
      // For day shifts, ensure end time is after start time
      const startHour = parseInt(startTime.split(':')[0], 10);
      const startMinute = parseInt(startTime.split(':')[1], 10);
      const endHour = parseInt(endTime.split(':')[0], 10);
      const endMinute = parseInt(endTime.split(':')[1], 10);
      
      const startValue = startHour * 60 + startMinute;
      const endValue = endHour * 60 + endMinute;
      
      if (endValue <= startValue) {
        newErrors.endTime = 'End time must be after start time';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    // Use standard shift times based on shift type
    const times = getDefaultTimes(shiftType);
    
    onSubmit({
      shift_type: shiftType,
      start_time: times.start,
      end_time: times.end,
      notes: notes,
      status: 'pending'
    });
  };

  // Get shift time range in 24-hour format with 12-hour reference in parentheses
  const getShiftTimeRange = (type: ShiftType): string => {
    const displayTimes = DISPLAY_SHIFT_TIMES[type];
    return `${displayTimes.startTime} - ${displayTimes.endTime}`;
  };

  return (
    <div className="p-6 border-t border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center">
          <Calendar className="h-5 w-5 text-purple-600 mr-2" />
          <h2 className="text-lg font-medium text-gray-900">
            {date ? format(date, 'EEEE, MMMM d, yyyy') : 'New Shift'}
          </h2>
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-gray-400 hover:text-gray-500 rounded-full"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {errors.general && (
          <div className="bg-red-50 border border-red-200 p-3 rounded-md text-sm text-red-600">
            {errors.general}
          </div>
        )}

        {/* Shift Type Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Shift Type
          </label>
          <div className="grid grid-cols-3 gap-3">
            {VALID_SHIFT_TYPES.map((type) => (
              <div
                key={type}
                className={`border rounded-md p-3 flex flex-col items-center cursor-pointer transition-colors ${
                  shiftType === type 
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-300 hover:bg-gray-50'
                }`}
                onClick={() => handleShiftTypeChange(type)}
              >
                <div className="flex items-center justify-center mb-1">
                  <div className={`h-4 w-4 rounded-full ${
                    shiftType === type ? 'bg-purple-500' : 'border border-gray-300'
                  }`}>
                    {shiftType === type && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <span className="ml-2 text-sm font-medium capitalize">
                    {type}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {getShiftTimeRange(type)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Time Inputs */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="start-time" className="block text-sm font-medium text-gray-700 mb-1">
              Start Time
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Clock className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="time"
                id="start-time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className={`block w-full pl-10 pr-3 py-2 text-base border ${
                  errors.startTime ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                  'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
                } rounded-md`}
              />
            </div>
            {errors.startTime && (
              <p className="mt-1 text-xs text-red-600">{errors.startTime}</p>
            )}
          </div>
          
          <div>
            <label htmlFor="end-time" className="block text-sm font-medium text-gray-700 mb-1">
              End Time
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Clock className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="time"
                id="end-time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={`block w-full pl-10 pr-3 py-2 text-base border ${
                  errors.endTime ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                  'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
                } rounded-md`}
              />
            </div>
            {errors.endTime && (
              <p className="mt-1 text-xs text-red-600">{errors.endTime}</p>
            )}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
            Notes (Optional)
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
            placeholder="Add any additional information about this shift"
          ></textarea>
        </div>

        {/* Form Actions */}
        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            {existingShift ? 'Update Shift' : 'Add Shift'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ShiftEntryForm;