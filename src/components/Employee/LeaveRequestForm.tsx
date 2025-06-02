import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, X, AlertCircle, Upload } from 'lucide-react';
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
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string>('');

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setUploadError('');
    }
  };

  const uploadFile = async (file: File): Promise<string | null> => {
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now().toString().replace(/\D/g, '')}_${file.name.replace(/\s+/g, '_')}`;
      const filePath = `public/${employeeId}/${fileName}`;
      
      setUploadProgress(10);
      
      // Create the upload
      const { data, error: uploadError } = await supabase.storage
        .from('leave-documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });
      
      if (uploadError) {
        console.error('Storage error:', uploadError);
        setUploadError(uploadError.message || 'Upload error');
        throw new Error(`Upload error: ${uploadError.message}`);
      }
      
      setUploadProgress(90);
      
      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from('leave-documents')
        .getPublicUrl(filePath);
        
      setUploadProgress(100);
      
      return publicUrl;
    } catch (error: any) {
      console.error('Error uploading file:', error);
      setUploadError(`Storage permission error:\n${error.message}`);
      throw new Error(`Error uploading file:\n${error.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    let documentUrl = null;
    let documentName = null;
    let documentType = null;
    
    try {
      // Upload document if provided
      if (file) {
        documentUrl = await uploadFile(file);
        documentName = file.name;
        documentType = file.type;
      }
      
      // Submit leave request with document info if available
      const { data, error } = await supabase
        .from('leave_requests')
        .insert({
          employee_id: employeeId,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          reason: reason,
          status: 'pending',
          document_url: documentUrl,
          document_name: documentName,
          document_type: documentType
        })
        .select();
        
      if (error) throw error;
      
      toast.success('Leave request submitted successfully');
      onSubmit();
    } catch (error: any) {
      console.error('Error submitting leave request:', error);
      toast.error(`Error submitting leave request: ${error.message}`);
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
        
        {/* Supporting Document */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Supporting Document (Optional)
          </label>
          <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
            <div className="space-y-1 text-center">
              <Upload className="mx-auto h-12 w-12 text-gray-400" />
              <div className="flex text-sm text-gray-600">
                <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-purple-600 hover:text-purple-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-purple-500">
                  <span>Upload a file</span>
                  <input
                    id="file-upload"
                    name="file-upload"
                    type="file"
                    className="sr-only"
                    onChange={handleFileChange}
                  />
                </label>
                <p className="pl-1">or drag and drop</p>
              </div>
              <p className="text-xs text-gray-500">
                PDF, PNG, JPG, GIF up to 10MB
              </p>
              
              {file && (
                <div className="mt-2 text-left">
                  <p className="text-xs font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              )}
              
              {uploadError && (
                <div className="mt-2 text-xs text-red-500 text-left">
                  {uploadError}
                </div>
              )}
              
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="mt-2">
                  <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-purple-600 transition-all duration-300" 
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Uploading: {uploadProgress}%</p>
                </div>
              )}
            </div>
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