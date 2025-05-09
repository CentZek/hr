import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock, AlertCircle, CheckCircle, XCircle, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { DISPLAY_SHIFT_TIMES } from '../types';

interface EmployeeShiftRequestProps {
  onShiftApproved?: (employeeData: any, shiftData: any) => void;
}

const EmployeeShiftRequest: React.FC<EmployeeShiftRequestProps> = ({ onShiftApproved }) => {
  const [employeeShiftRequests, setEmployeeShiftRequests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIfMobile = () => setIsMobile(window.innerWidth < 640);
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  useEffect(() => {
    fetchEmployeeShiftRequests();
  }, []);

  const fetchEmployeeShiftRequests = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_shifts')
        .select('id, employee_id, date, shift_type, start_time, end_time, status, notes, employees(name, employee_number)')
        .eq('status', 'pending')
        .order('date', { ascending: false });

      if (error) throw error;
      setEmployeeShiftRequests(data || []);
    } catch (error) {
      console.error('Error fetching employee shift requests:', error);
      toast.error('Failed to load employee shift requests');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveShift = async (shift: any) => {
    setIsProcessing(prev => ({ ...prev, [shift.id]: true }));
    try {
      // First check if there are existing time records for this employee on this date
      const { data: existingRecords, error: checkError } = await supabase
        .from('time_records')
        .select('id, status')
        .eq('employee_id', shift.employee_id)
        .gte('timestamp', `${shift.date}T00:00:00`)
        .lt('timestamp', `${shift.date}T23:59:59`);
        
      if (checkError) throw checkError;
      
      // Delete any existing records for this date
      if (existingRecords && existingRecords.length > 0) {
        console.log(`Deleting ${existingRecords.length} existing records for date ${shift.date}`);
        const recordIds = existingRecords.map(record => record.id);
        const { error: deleteError } = await supabase
          .from('time_records')
          .delete()
          .in('id', recordIds);
          
        if (deleteError) throw deleteError;
      }
      
      // Update the shift status to confirmed
      const { error: updateError } = await supabase
        .from('employee_shifts')
        .update({ status: 'confirmed' })
        .eq('id', shift.id);
        
      if (updateError) throw updateError;
      
      // Use exact shift times directly from the shift record
      const startTime = shift.start_time;
      const endTime = shift.end_time;
      
      // Handle night shift that crosses to next day
      let checkOutDate = shift.date;
      if (shift.shift_type === 'night') {
        const nextDay = new Date(shift.date);
        nextDay.setDate(nextDay.getDate() + 1);
        checkOutDate = format(nextDay, 'yyyy-MM-dd');
      }
      
      // Calculate hours worked for consistency
      const hoursWorked = 9.0; // Standard hours for all shift types
      const hoursNote = `hours:${hoursWorked.toFixed(2)}`;

      // Create time records
      const records = [
        {
          employee_id: shift.employee_id,
          timestamp: `${shift.date}T${startTime}:00`, // Don't append :00.000Z to avoid timezone shifts
          status: 'check_in',
          shift_type: shift.shift_type,
          notes: `Employee submitted shift - HR approved; ${hoursNote}`,
          is_manual_entry: true,
          exact_hours: hoursWorked,
          is_late: false,
          early_leave: false,
          deduction_minutes: 0,
          display_check_in: startTime,
          display_check_out: endTime
        },
        {
          employee_id: shift.employee_id,
          timestamp: `${checkOutDate}T${endTime}:00`, // Don't append :00.000Z to avoid timezone shifts
          status: 'check_out',
          shift_type: shift.shift_type,
          notes: `Employee submitted shift - HR approved; ${hoursNote}`,
          is_manual_entry: true,
          exact_hours: hoursWorked,
          is_late: false,
          early_leave: false,
          deduction_minutes: 0,
          display_check_in: startTime,
          display_check_out: endTime
        }
      ];
      
      const { error: insertError } = await supabase.from('time_records').insert(records);
      if (insertError) throw insertError;
      
      // Remove the shift from the list
      setEmployeeShiftRequests(prev => prev.filter(s => s.id !== shift.id));
      
      // Call callback if provided
      if (onShiftApproved) {
        const employeeData = {
          id: shift.employee_id,
          name: shift.employees.name,
          employeeNumber: shift.employees.employee_number,
          employee_number: shift.employees.employee_number
        };
        
        // Parse timestamps - Use different variable names to avoid confusion
        const checkInDate = new Date(`${shift.date}T${startTime}`);
        const checkOutDateTime = new Date(`${checkOutDate}T${endTime}`);
        
        onShiftApproved(employeeData, {
          ...shift,
          date: shift.date,
          start_time: startTime,
          end_time: endTime,
          checkInDate,
          checkOutDate: checkOutDateTime,
          hoursWorked
        });
      }
      
      toast.success(`Approved shift for ${shift.employees.name}`);
    } catch (error) {
      console.error('Error approving employee shift:', error);
      toast.error('Failed to approve shift');
    } finally {
      setIsProcessing(prev => ({ ...prev, [shift.id]: false }));
    }
  };

  const getShiftTimes = (shiftType: string, dateStr: string) => {
    let startTime, endTime, checkOutDate = dateStr;
    
    if (shiftType === 'morning') {
      startTime = '05:00';
      endTime = '14:00';
    } else if (shiftType === 'evening') {
      startTime = '13:00';  // Fixed from previous incorrect time
      endTime = '22:00';    // Fixed from previous incorrect time
    } else if (shiftType === 'night') {
      startTime = '21:00';
      const nextDay = new Date(dateStr);
      nextDay.setDate(nextDay.getDate() + 1);
      checkOutDate = format(nextDay, 'yyyy-MM-dd');
      endTime = '06:00';
    }
    
    return { startTime, endTime, checkOutDate };
  };

  const handleRejectShift = async (shiftId: string, employeeName: string) => {
    setIsProcessing(prev => ({ ...prev, [shiftId]: true }));
    try {
      const { error } = await supabase
        .from('employee_shifts')
        .update({ status: 'rejected' })
        .eq('id', shiftId);
        
      if (error) throw error;
      setEmployeeShiftRequests(prev => prev.filter(s => s.id !== shiftId));
      toast.success(`Rejected shift for ${employeeName}`);
    } catch (error) {
      console.error('Error rejecting employee shift:', error);
      toast.error('Failed to reject shift');
    } finally {
      setIsProcessing(prev => ({ ...prev, [shiftId]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-gray-200 rounded-md p-4 text-center">
        <div className="animate-spin w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
        <p className="text-sm text-gray-600">Loading shift requests...</p>
      </div>
    );
  }

  if (employeeShiftRequests.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-md p-4 text-center">
        <Info className="w-6 h-6 text-gray-400 mx-auto mb-2" />
        <p className="text-sm text-gray-600">No pending shift requests from employees</p>
      </div>
    );
  }

  // Get time display
  const getShiftTimeDisplay = (shiftType: string, timeType: 'start' | 'end') => {
    const displayTimes = DISPLAY_SHIFT_TIMES[shiftType as keyof typeof DISPLAY_SHIFT_TIMES];
    if (!displayTimes) return '';
    return displayTimes[timeType === 'start' ? 'startTime' : 'endTime'];
  };

  // Mobile view
  if (isMobile) {
    return (
      <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
        <div className="bg-amber-50 p-3 border-b border-amber-100">
          <h4 className="font-medium text-amber-800 flex items-center">
            <Clock className="w-4 h-4 mr-2" />Employee Shift Requests
          </h4>
          <p className="text-xs text-amber-700 mt-1">Employees have submitted the following shifts for approval</p>
        </div>

        <div className="divide-y divide-gray-200">
          {employeeShiftRequests.map(shift => (
            <div key={shift.id} className="p-3 hover:bg-gray-50">
              <div className="flex flex-col">
                <div className="mb-2">
                  <div className="flex flex-wrap justify-between gap-1 mb-1">
                    <p className="font-medium text-wrap-balance">{shift.employees.name}</p>
                    <p className="text-xs text-gray-500">#{shift.employees.employee_number}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs text-gray-700">{format(parseISO(shift.date), 'EEE, MMM d')}</span>
                    <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                      shift.shift_type === 'morning' ? 'bg-blue-100 text-blue-800' : 
                      shift.shift_type === 'evening' ? 'bg-orange-100 text-orange-800' : 
                      'bg-purple-100 text-purple-800'
                    }`}>{shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-gray-600">{getShiftTimeDisplay(shift.shift_type, 'start')} - {getShiftTimeDisplay(shift.shift_type, 'end')}</span>
                  </div>
                  {shift.notes && <p className="text-xs text-gray-600 mt-2 text-break-word">Note: {shift.notes}</p>}
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => handleApproveShift(shift)}
                    disabled={isProcessing[shift.id]}
                    className="flex-1 flex justify-center items-center px-3 py-1.5 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200 disabled:opacity-50"
                  >
                    {isProcessing[shift.id] ? 
                      <span className="animate-spin h-3 w-3 border-2 border-t-transparent border-green-700 rounded-full mr-1"></span> : 
                      <CheckCircle className="w-3 h-3 mr-1" />}
                    Approve
                  </button>
                  <button
                    onClick={() => handleRejectShift(shift.id, shift.employees.name)}
                    disabled={isProcessing[shift.id]}
                    className="flex-1 flex justify-center items-center px-3 py-1.5 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 disabled:opacity-50"
                  >
                    {isProcessing[shift.id] ? 
                      <span className="animate-spin h-3 w-3 border-2 border-t-transparent border-red-700 rounded-full mr-1"></span> : 
                      <XCircle className="w-3 h-3 mr-1" />}
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Desktop view
  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
      <div className="bg-amber-50 p-3 border-b border-amber-100">
        <h4 className="font-medium text-amber-800 flex items-center">
          <Clock className="w-4 h-4 mr-2" />Employee Shift Requests
        </h4>
        <p className="text-xs text-amber-700 mt-1">Employees have submitted the following shifts for approval</p>
      </div>

      <div className="divide-y divide-gray-200">
        {employeeShiftRequests.map(shift => (
          <div key={shift.id} className="p-4 hover:bg-gray-50">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center mb-1">
                  <p className="font-medium text-gray-900">{shift.employees.name}</p>
                  <p className="text-xs text-gray-500 ml-2">#{shift.employees.employee_number}</p>
                </div>
                <div className="flex items-center mt-1 space-x-2">
                  <span className="text-sm text-gray-700">{format(parseISO(shift.date), 'EEEE, MMMM d, yyyy')}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                    shift.shift_type === 'morning' ? 'bg-blue-100 text-blue-800' : 
                    shift.shift_type === 'evening' ? 'bg-orange-100 text-orange-800' : 
                    'bg-purple-100 text-purple-800'
                  }`}>{shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-2 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Start Time</p>
                    <p className="font-medium">{getShiftTimeDisplay(shift.shift_type, 'start')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">End Time</p>
                    <p className="font-medium">{getShiftTimeDisplay(shift.shift_type, 'end')}</p>
                  </div>
                </div>
                {shift.notes && <p className="text-xs text-gray-600 mt-2">Note: {shift.notes}</p>}
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleApproveShift(shift)}
                  disabled={isProcessing[shift.id]}
                  className="inline-flex items-center px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200 disabled:opacity-50"
                >
                  {isProcessing[shift.id] ? 
                    <span className="animate-spin h-3 w-3 border-2 border-t-transparent border-green-700 rounded-full mr-1"></span> : 
                    <CheckCircle className="w-3 h-3 mr-1" />}
                  Approve
                </button>
                <button
                  onClick={() => handleRejectShift(shift.id, shift.employees.name)}
                  disabled={isProcessing[shift.id]}
                  className="inline-flex items-center px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200 disabled:opacity-50"
                >
                  {isProcessing[shift.id] ? 
                    <span className="animate-spin h-3 w-3 border-2 border-t-transparent border-red-700 rounded-full mr-1"></span> : 
                    <XCircle className="w-3 h-3 mr-1" />}
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EmployeeShiftRequest;