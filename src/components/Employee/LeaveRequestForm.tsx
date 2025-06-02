import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, X, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface LeaveRequestFormProps {
  employeeId: string;
  onClose: () => void;
  onSubmit: () => void;
}

type LeaveType = 'sick-leave' | 'marriage-leave' | 'bereavement-leave' | 'maternity-leave' | 'paternity-leave';

const LeaveRequestForm: React.FC<LeaveRequestFormProps> = ({ employeeId, onClose, onSubmit }) => {
  const [leaveType, setLeaveType] = useState<LeaveType>('sick-leave');
  const [startDate, setStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const leaveTypes: { value: LeaveType, label: string }[] = [
    { value: 'sick-leave', label: 'Sick Leave' },
    { value: 'marriage-leave', label: 'Marriage Leave' },
    { value: 'bereavement-leave', label: 'Bereavement Leave' },
    { value: 'maternity-leave', label: 'Maternity Leave' },
    { value: 'paternity-leave', label: 'Paternity Leave' },
  ];

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!leaveType) {
      newErrors.leaveType = 'Please select a leave type';
    }
    
    if (!startDate) {
      newErrors.startDate = 'Start date is required';
    }
    
    if (!endDate) {
      newErrors.endDate = 'End date is required';
    } else if (endDate < startDate) {
      newErrors.endDate = 'End date must be after start date';
    }
    
    if (!reason.trim()) {
      newErrors.reason = 'Please provide a reason for your leave request';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    try {
      const { data, error } = await supabase
        .from('leave_requests')
        .insert({
          employee_id: employeeId,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          reason: reason,
          status: 'pending'
        })
        .select();
        
      if (error) throw error;
      
      toast.success('Leave request submitted successfully');
      onSubmit();
    } catch (error) {
      console.error('Error submitting leave request:', error);
      toast.error('Failed to submit leave request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg p-4 shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">Request Leave</h3>
        <button 
          onClick={onClose}
          className="text-gray-400 hover:text-gray-500"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Leave Type */}
        <div>
          <label htmlFor="leave-type" className="block text-sm font-medium text-gray-700 mb-1">
            Leave Type
          </label>
          <select
            id="leave-type"
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className={`block w-full px-3 py-2 border ${
              errors.leaveType ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
              'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
            } rounded-md shadow-sm`}
          >
            {leaveTypes.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
          {errors.leaveType && <p className="mt-1 text-xs text-red-600">{errors.leaveType}</p>}
        </div>
        
        {/* Date Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="start-date" className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Calendar className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="date"
                id="start-date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`block w-full pl-10 pr-3 py-2 sm:text-sm border ${
                  errors.startDate ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                  'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
                } rounded-md`}
              />
            </div>
            {errors.startDate && <p className="mt-1 text-xs text-red-600">{errors.startDate}</p>}
          </div>
          
          <div>
            <label htmlFor="end-date" className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Calendar className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="date"
                id="end-date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`block w-full pl-10 pr-3 py-2 sm:text-sm border ${
                  errors.endDate ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                  'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
                } rounded-md`}
              />
            </div>
            {errors.endDate && <p className="mt-1 text-xs text-red-600">{errors.endDate}</p>}
          </div>
        </div>
        
        {/* Reason */}
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
            Reason
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className={`block w-full px-3 py-2 border ${
              errors.reason ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
              'border-gray-300 focus:ring-purple-500 focus:border-purple-500'
            } rounded-md shadow-sm`}
            placeholder="Briefly explain the reason for your leave request"
          ></textarea>
          {errors.reason && <p className="mt-1 text-xs text-red-600">{errors.reason}</p>}
        </div>
        
        {/* Submit Button */}
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="inline-block animate-spin h-4 w-4 border-2 border-t-transparent border-white rounded-full mr-2"></span>
                Submitting...
              </>
            ) : 'Submit Request'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default LeaveRequestForm;