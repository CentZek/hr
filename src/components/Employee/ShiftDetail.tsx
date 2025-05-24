import React from 'react';
import { format, parseISO } from 'date-fns';
import { Clock, CheckCircle, AlertCircle, Trash2, MessageCircle } from 'lucide-react';
import { DISPLAY_SHIFT_TIMES } from '../../types';
import { formatTime24H } from '../../utils/dateTimeHelper';

interface ShiftDetailProps {
  shift: any;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const ShiftDetail: React.FC<ShiftDetailProps> = ({ shift, onDelete, onClose }) => {
  // Format the time string for display
  const formatTimeDisplay = (timeStr: string) => {
    if (!timeStr) return '';
    
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours, 10);
    const minute = parseInt(minutes, 10);
    
    // Return in 24-hour format
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  // Calculate total hours (end - start)
  const calculateHours = () => {
    if (!shift.start_time || !shift.end_time) return 0;
    // Always return standard 9 hours for approved shifts
    return "9.00";
  };

  // Get status color and icon
  const getStatusDisplay = () => {
    if (shift.is_approved_record) {
      return {
        color: 'bg-blue-100 text-blue-800',
        icon: <CheckCircle className="h-4 w-4 mr-1" />
      };
    }
    
    switch (shift.status) {
      case 'confirmed':
        return {
          color: 'bg-green-100 text-green-800',
          icon: <CheckCircle className="h-4 w-4 mr-1" />
        };
      case 'rejected':
        return {
          color: 'bg-red-100 text-red-800',
          icon: <AlertCircle className="h-4 w-4 mr-1" />
        };
      default:
        return {
          color: 'bg-amber-100 text-amber-800',
          icon: <Clock className="h-4 w-4 mr-1" />
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  // Get standardized display time based on shift type
  const getStandardDisplayTime = (timeType: 'start' | 'end') => {
    if (!shift.shift_type) return '';
    
    const displayTimes = DISPLAY_SHIFT_TIMES[shift.shift_type as keyof typeof DISPLAY_SHIFT_TIMES];
    if (!displayTimes) return formatTimeDisplay(timeType === 'start' ? shift.start_time : shift.end_time);
    
    // Get the standard 24-hour time
    const timeStr = timeType === 'start' ? displayTimes.startTime : displayTimes.endTime;
    return timeStr.split(' ')[0]; // Take only the 24H part, e.g., "21:00" from "21:00 (9:00 PM)"
  };

  return (
    <div className="bg-white rounded-lg">
      <div className="border-b border-gray-200 p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-gray-900">Shift Details</h3>
          {shift.status === 'pending' && !shift.is_approved_record && (
            <button
              onClick={() => onDelete(shift.id)}
              className="inline-flex items-center px-3 py-1.5 text-sm border border-red-300 text-red-700 rounded-md hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </button>
          )}
        </div>
        
        <div className="mb-4">
          <div className="flex items-center mb-2 flex-wrap gap-2">
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
              shift.shift_type === 'morning' ? 'bg-blue-100 text-blue-800' : 
              shift.shift_type === 'evening' ? 'bg-orange-100 text-orange-800' : 
              'bg-purple-100 text-purple-800'
            }`}>
              {shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} Shift
            </span>
            <span className={`flex items-center px-2 py-1 text-xs font-medium rounded-full ${statusDisplay.color}`}>
              {statusDisplay.icon}
              {shift.is_approved_record ? 'Approved' : shift.status.charAt(0).toUpperCase() + shift.status.slice(1)}
            </span>
          </div>
          
          <p className="text-sm text-gray-500 mb-2 text-wrap-balance">
            {format(parseISO(shift.date), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
      </div>
      
      <div className="p-4">
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <p className="text-xs text-gray-500 mb-1">Start Time</p>
            <p className="text-lg font-medium">{getStandardDisplayTime('start')}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">End Time</p>
            <p className="text-lg font-medium">{getStandardDisplayTime('end')}</p>
          </div>
        </div>
        
        <div className="bg-gray-50 p-3 rounded-md mb-4">
          <p className="text-xs text-gray-500 mb-1">Total Hours</p>
          <p className="text-lg font-medium text-gray-900">
            {`${calculateHours()} hours`}
            {shift.penalty_minutes && shift.penalty_minutes > 0 && (
              <span className="ml-2 text-sm text-red-600">
                (-{(shift.penalty_minutes / 60).toFixed(2)} hr penalty)
              </span>
            )}
          </p>
        </div>
        
        {shift.notes && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 mb-1">
              {shift.is_approved_record ? 'Record Notes' : 'Your Notes'}
            </p>
            <div className="bg-gray-50 p-3 rounded-md text-sm text-break-word">
              {shift.notes.replace(/hours:\d+\.\d+;?\s*/, '')}
            </div>
          </div>
        )}
        
        {shift.hr_notes && (
          <div className="mb-4 border-l-4 border-purple-500 pl-3">
            <p className="text-xs text-purple-600 mb-1 flex items-center">
              <MessageCircle className="w-3 h-3 mr-1" />
              HR Comments
            </p>
            <div className="text-sm text-break-word">
              {shift.hr_notes}
            </div>
          </div>
        )}
        
        {shift.is_approved_record && (
          <div className="bg-blue-50 border border-blue-100 rounded-md p-3 text-sm text-blue-800 flex items-center mb-4">
            <CheckCircle className="w-4 h-4 mr-2 flex-shrink-0" />
            <p>This is an approved time record from HR. It cannot be modified or deleted.</p>
          </div>
        )}
        
        {!shift.is_approved_record && shift.status === 'pending' && (
          <div className="bg-amber-50 border border-amber-100 rounded-md p-3 text-sm text-amber-800 flex items-center">
            <Clock className="w-4 h-4 mr-2 flex-shrink-0" />
            <p>This shift is awaiting approval from HR.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ShiftDetail;