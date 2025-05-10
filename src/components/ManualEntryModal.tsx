import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { X, Clock, User, Calendar, Check, AlertCircle, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SHIFT_TIMES, DISPLAY_SHIFT_TIMES } from '../types';
import { parseShiftTimes } from '../utils/dateTimeHelper';

interface ManualEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (record: any) => void;
}

const ManualEntryModal: React.FC<ManualEntryModalProps> = ({ isOpen, onClose, onSave }) => {
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [employeeShiftRequests, setEmployeeShiftRequests] = useState<any[]>([]);
  
  // Form state
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [shiftType, setShiftType] = useState<'morning' | 'evening' | 'night'>('morning');
  const [notes, setNotes] = useState<string>('');
  const [createNewEmployee, setCreateNewEmployee] = useState<boolean>(false);
  const [newEmployeeName, setNewEmployeeName] = useState<string>('');
  const [newEmployeeNumber, setNewEmployeeNumber] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset and initialize form when opening
  useEffect(() => {
    if (isOpen) {
      fetchEmployees();
      fetchEmployeeShiftRequests();
      resetForm();
    }
  }, [isOpen]);

  const resetForm = () => {
    setSelectedEmployee('');
    setSelectedDate(format(new Date(), 'yyyy-MM-dd'));
    setShiftType('morning');
    setNotes('');
    setCreateNewEmployee(false);
    setNewEmployeeName('');
    setNewEmployeeNumber('');
    setErrors({});
  };

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, employee_number')
        .order('name');

      if (error) throw error;
      setEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmployeeShiftRequests = async () => {
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
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!createNewEmployee && !selectedEmployee) {
      newErrors.employee = 'Please select an employee';
    }

    if (createNewEmployee) {
      if (!newEmployeeName.trim()) newErrors.newEmployeeName = 'Employee name is required';
      if (!newEmployeeNumber.trim()) newErrors.newEmployeeNumber = 'Employee number is required';
    }

    if (!selectedDate) newErrors.date = 'Date is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const getStandardShiftTimes = (type: 'morning' | 'evening' | 'night') => {
    return {
      start: type === 'morning' ? '05:00' : type === 'evening' ? '13:00' : '21:00',
      end: type === 'morning' ? '14:00' : type === 'evening' ? '22:00' : '06:00',
    };
  };

  const handleApproveEmployeeShift = async (shift: any) => {
    try {
      // Update shift status
      const { error: updateError } = await supabase
        .from('employee_shifts')
        .update({ status: 'confirmed' })
        .eq('id', shift.id);
        
      if (updateError) throw updateError;
      
      // Standardize times based on shift type
      const startTime = shift.shift_type === 'morning' ? '05:00' : shift.shift_type === 'evening' ? '13:00' : '21:00';
      const endTime = shift.shift_type === 'morning' ? '14:00' : shift.shift_type === 'evening' ? '22:00' : '06:00';
      
      // Use our helper function to properly handle day rollover
      const { checkIn, checkOut } = parseShiftTimes(shift.date, startTime, endTime, shift.shift_type);
      
      // First, check for any manual records with this shift type to ensure we're not violating the unique constraint
      const { data: existingManualRecords, error: manualError } = await supabase
        .from('time_records')
        .select('id, status')
        .eq('employee_id', shift.employee_id)
        .eq('shift_type', shift.shift_type)
        .eq('working_week_start', shift.date)
        .eq('is_manual_entry', true);
      
      if (manualError) throw manualError;
      
      // If we found manual entries with the same key fields, delete them to avoid unique constraint violation
      if (existingManualRecords && existingManualRecords.length > 0) {
        const recordIds = existingManualRecords.map(record => record.id);
        console.log(`Deleting ${existingManualRecords.length} existing manual records to avoid constraint violation`);
        const { error: deleteError } = await supabase
          .from('time_records')
          .delete()
          .in('id', recordIds);
          
        if (deleteError) throw deleteError;
      }
      
      // Prepare time records
      const checkInRecord = {
        employee_id: shift.employee_id,
        timestamp: checkIn.toISOString(),
        status: 'check_in',
        shift_type: shift.shift_type,
        notes: 'Employee submitted shift - HR approved; hours:9.00',
        is_manual_entry: true,
        working_week_start: shift.date,
        exact_hours: 9.0
      };
      
      const checkOutRecord = {
        employee_id: shift.employee_id,
        timestamp: checkOut.toISOString(),
        status: 'check_out',
        shift_type: shift.shift_type,
        notes: 'Employee submitted shift - HR approved; hours:9.00',
        is_manual_entry: true,
        working_week_start: shift.date,
        exact_hours: 9.0
      };
      
      // Insert both records in a single insert to ensure atomicity
      const { error: insertError } = await supabase
        .from('time_records')
        .insert([checkInRecord, checkOutRecord]);
      
      if (insertError) throw insertError;
      
      // Refresh the list
      fetchEmployeeShiftRequests();
      return true;
    } catch (error) {
      console.error('Error approving employee shift:', error);
      throw error;
    }
  };

  const handleRejectEmployeeShift = async (shiftId: string) => {
    try {
      const { error } = await supabase
        .from('employee_shifts')
        .update({ status: 'rejected' })
        .eq('id', shiftId);
      if (error) throw error;
      fetchEmployeeShiftRequests();
      return true;
    } catch (error) {
      console.error('Error rejecting employee shift:', error);
      throw error;
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      let employeeId = selectedEmployee;
      let employeeData = employees.find(e => e.id === selectedEmployee);

      // Create new employee if needed
      if (createNewEmployee) {
        const { data: newEmployee, error: createError } = await supabase
          .from('employees')
          .insert({
            name: newEmployeeName.trim(),
            employee_number: newEmployeeNumber.trim()
          })
          .select();

        if (createError) throw createError;

        if (newEmployee && newEmployee.length > 0) {
          employeeId = newEmployee[0].id;
          employeeData = {
            id: newEmployee[0].id,
            name: newEmployeeName.trim(),
            employee_number: newEmployeeNumber.trim()
          };
          
          // Create credentials for new employee
          await supabase
            .from('user_credentials')
            .insert({
              employee_id: employeeId,
              username: `${newEmployeeName.trim()}_${newEmployeeNumber.trim()}`,
              password: newEmployeeNumber.trim()
            });
        } else {
          throw new Error('Failed to create new employee');
        }
      }

      // Get standard times for selected shift
      const times = getStandardShiftTimes(shiftType);

      // Create employee shift first
      await supabase
        .from('employee_shifts')
        .insert({
          employee_id: employeeId,
          date: selectedDate,
          start_time: times.start,
          end_time: times.end,
          shift_type: shiftType,
          status: 'pending',
          notes: notes || 'Manual entry by HR'
        });

      // Parse dates properly with the helper function to handle day rollover
      const { checkIn, checkOut } = parseShiftTimes(
        selectedDate, 
        times.start, 
        times.end, 
        shiftType
      );
      
      // First check for existing manual records that would violate the constraint
      const { data: existingManualRecords, error: manualError } = await supabase
        .from('time_records')
        .select('id, status')
        .eq('employee_id', employeeId)
        .eq('shift_type', shiftType)
        .eq('working_week_start', selectedDate)
        .eq('is_manual_entry', true);
      
      if (manualError) throw manualError;
      
      // If we found manual entries, delete them to avoid constraint violation
      if (existingManualRecords && existingManualRecords.length > 0) {
        const recordIds = existingManualRecords.map(record => record.id);
        console.log(`Deleting ${existingManualRecords.length} existing manual records to avoid constraint violation`);
        const { error: deleteError } = await supabase
          .from('time_records')
          .delete()
          .in('id', recordIds);
          
        if (deleteError) throw deleteError;
      }

      // Prepare time records
      const checkInRecord = {
        employee_id: employeeId,
        timestamp: checkIn.toISOString(),
        status: 'check_in',
        shift_type: shiftType,
        notes: notes || 'Manual entry; hours:9.00',
        is_manual_entry: true,
        working_week_start: selectedDate,
        display_check_in: times.start,
        display_check_out: times.end,
        exact_hours: 9.0
      };
      
      const checkOutRecord = {
        employee_id: employeeId,
        timestamp: checkOut.toISOString(),
        status: 'check_out',
        shift_type: shiftType,
        notes: notes || 'Manual entry; hours:9.00',
        is_manual_entry: true,
        working_week_start: selectedDate,
        display_check_in: times.start,
        display_check_out: times.end,
        exact_hours: 9.0
      };
      
      // Insert both records in a single insert to ensure atomicity
      const { error: insertError } = await supabase
        .from('time_records')
        .insert([checkInRecord, checkOutRecord]);
      
      if (insertError) throw insertError;

      // Call the save callback
      onSave({
        employee: { ...employeeData, employeeNumber: employeeData?.employee_number },
        date: selectedDate,
        checkIn: times.start,
        checkOut: times.end,
        shiftType,
        checkInDate: checkIn,
        checkOutDate: checkOut
      });

    } catch (error) {
      console.error('Error saving manual time record:', error);
      setErrors({ submit: 'Failed to save time record. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 overflow-auto h-[90vh] max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-blue-600 text-white">
          <h3 className="text-lg font-semibold flex items-center">
            <Clock className="w-5 h-5 mr-2" />
            Add Manual Time Record
          </h3>
          <button onClick={onClose} className="text-white hover:text-blue-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-100 rounded-md p-4 flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-500 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">Add missing time records</p>
              <p>Use this form to manually add time records for employees who forgot to clock in or out.</p>
              <p className="mt-1">You can add either a check-in time, a check-out time, or both. These records will be available for approval just like regular time records.</p>
            </div>
          </div>

          {/* Employee Shift Requests Section */}
          {employeeShiftRequests.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <div className="bg-amber-50 p-3 border-b border-amber-100">
                <h4 className="font-medium text-amber-800 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Employee Shift Requests
                </h4>
                <p className="text-xs text-amber-700 mt-1">
                  Employees have submitted the following shifts for approval
                </p>
              </div>
              <div className="divide-y divide-gray-200 max-h-64 overflow-y-auto">
                {employeeShiftRequests.map(shift => (
                  <div key={shift.id} className="p-3 hover:bg-gray-50">
                    <div className="flex flex-col sm:flex-row sm:justify-between">
                      <div>
                        <p className="font-medium text-wrap-balance">{shift.employees.name}</p>
                        <p className="text-xs text-gray-500 mb-2">#{shift.employees.employee_number}</p>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-xs text-gray-500">{format(new Date(shift.date), 'EEE, MMM d')}</span>
                          <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                            shift.shift_type === 'morning' ? 'bg-blue-100 text-blue-800' : 
                            shift.shift_type === 'evening' ? 'bg-orange-100 text-orange-800' : 
                            'bg-purple-100 text-purple-800'
                          }`}>
                            {shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)}
                          </span>
                        </div>
                        <div className="text-sm mb-1">
                          {DISPLAY_SHIFT_TIMES[shift.shift_type as keyof typeof DISPLAY_SHIFT_TIMES].startTime} - {DISPLAY_SHIFT_TIMES[shift.shift_type as keyof typeof DISPLAY_SHIFT_TIMES].endTime}
                        </div>
                        {shift.notes && <p className="text-xs text-gray-600 mt-1 text-break-word">Note: {shift.notes}</p>}
                      </div>
                      <div className="flex space-x-2 mt-2 sm:mt-0">
                        <button
                          onClick={() => handleApproveEmployeeShift(shift)}
                          className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleRejectEmployeeShift(shift.id)}
                          className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs hover:bg-red-200"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Employee Selection */}
          <div className="space-y-4">
            <div className="flex items-center mb-2">
              <input
                type="radio"
                id="existing-employee"
                checked={!createNewEmployee}
                onChange={() => setCreateNewEmployee(false)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="existing-employee" className="ml-2 block text-sm font-medium text-gray-700">
                Select Existing Employee
              </label>
            </div>
            
            {!createNewEmployee && (
              <div className="pl-6">
                <label htmlFor="employee" className="block text-sm font-medium text-gray-700 mb-1">
                  Employee
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>
                  <select
                    id="employee"
                    value={selectedEmployee}
                    onChange={(e) => {
                      setSelectedEmployee(e.target.value);
                      setErrors({ ...errors, employee: '' });
                    }}
                    className={`block w-full pl-10 pr-3 py-2 text-base border ${
                      errors.employee ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                      'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                    } rounded-md`}
                    disabled={loading}
                  >
                    <option value="">Select an employee</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} (#{employee.employee_number})
                      </option>
                    ))}
                  </select>
                </div>
                {errors.employee && <p className="mt-1 text-xs text-red-600">{errors.employee}</p>}
              </div>
            )}

            <div className="flex items-center mb-2">
              <input
                type="radio"
                id="new-employee"
                checked={createNewEmployee}
                onChange={() => setCreateNewEmployee(true)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="new-employee" className="ml-2 block text-sm font-medium text-gray-700">
                Create New Employee
              </label>
            </div>
            
            {createNewEmployee && (
              <div className="pl-6 space-y-4">
                <div>
                  <label htmlFor="new-employee-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Employee Name
                  </label>
                  <input
                    type="text"
                    id="new-employee-name"
                    value={newEmployeeName}
                    onChange={(e) => {
                      setNewEmployeeName(e.target.value);
                      setErrors({ ...errors, newEmployeeName: '' });
                    }}
                    className={`block w-full px-3 py-2 border ${
                      errors.newEmployeeName ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                      'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                    } rounded-md`}
                    placeholder="Full name"
                  />
                  {errors.newEmployeeName && <p className="mt-1 text-xs text-red-600">{errors.newEmployeeName}</p>}
                </div>
                
                <div>
                  <label htmlFor="new-employee-number" className="block text-sm font-medium text-gray-700 mb-1">
                    Employee Number
                  </label>
                  <input
                    type="text"
                    id="new-employee-number"
                    value={newEmployeeNumber}
                    onChange={(e) => {
                      setNewEmployeeNumber(e.target.value);
                      setErrors({ ...errors, newEmployeeNumber: '' });
                    }}
                    className={`block w-full px-3 py-2 border ${
                      errors.newEmployeeNumber ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                      'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                    } rounded-md`}
                    placeholder="Employee ID number"
                  />
                  {errors.newEmployeeNumber && <p className="mt-1 text-xs text-red-600">{errors.newEmployeeNumber}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Date and Shift Type */}
          <div className="space-y-4">
            <div>
              <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Calendar className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="date"
                  id="date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setErrors({ ...errors, date: '' });
                  }}
                  className={`block w-full pl-10 pr-3 py-2 text-base border ${
                    errors.date ? 'border-red-300' : 'border-gray-300'
                  } rounded-md`}
                />
              </div>
              {errors.date && <p className="mt-1 text-xs text-red-600">{errors.date}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Shift Type</label>
              <div className="grid grid-cols-3 gap-3">
                {(['morning', 'evening', 'night'] as const).map((type) => (
                  <div
                    key={type}
                    className={`border rounded-md p-3 flex flex-col items-center cursor-pointer ${
                      shiftType === type ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:bg-gray-50'
                    }`}
                    onClick={() => setShiftType(type)}
                  >
                    <div className="flex items-center mb-1">
                      {shiftType === type ? (
                        <div className="h-4 w-4 rounded-full bg-blue-500 flex items-center justify-center">
                          <Check className="h-3 w-3 text-white" />
                        </div>
                      ) : (
                        <div className="h-4 w-4 rounded-full border border-gray-300"></div>
                      )}
                      <span className="ml-2 text-sm font-medium capitalize">{type}</span>
                    </div>
                    <span className="text-xs text-gray-500 text-wrap-balance">
                      {DISPLAY_SHIFT_TIMES[type].startTime} - {DISPLAY_SHIFT_TIMES[type].endTime}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-amber-600 flex items-start mt-3">
                <AlertCircle className="w-3 h-3 mr-1 mt-1" />
                <div>
                  <div className="font-medium">Standard shift hours will be used:</div>
                  <div className="mt-0.5">
                    {shiftType === 'morning' ? 'Morning shift: 5:00 AM - 2:00 PM' :
                     shiftType === 'evening' ? 'Evening shift: 1:00 PM - 10:00 PM' : 
                     'Night shift: 9:00 PM - 6:00 AM'}
                  </div>
                </div>
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
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                rows={2}
                placeholder="Reason for manual time entry"
              ></textarea>
            </div>

            {errors.submit && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-700">
                {errors.submit}
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4 flex flex-wrap justify-end gap-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? (
              <><span className="inline-block animate-spin h-4 w-4 border-2 border-t-transparent border-white rounded-full mr-2"></span>Saving...</>
            ) : 'Save Record'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualEntryModal;