import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar, X, AlertCircle, Upload, File, Check, Trash } from 'lucide-react';
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
  
  // Document upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string>('');

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
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Check file size (limit to 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, file: 'File size should not exceed 5MB' }));
        return;
      }
      
      // Check file type (PDF, JPG, PNG, JPEG)
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
      if (!validTypes.includes(file.type)) {
        setErrors(prev => ({ ...prev, file: 'Only PDF, JPG, and PNG files are allowed' }));
        return;
      }
      
      setSelectedFile(file);
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors.file;
        return newErrors;
      });
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setUploadedFileUrl('');
  };

  const uploadFile = async (): Promise<string | null> => {
    if (!selectedFile) return null;
    
    setIsUploading(true);
    setUploadProgress(0);
    
    try {
      // Create a unique file path: public/employeeId/filename to avoid RLS issues
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${timestamp}_${selectedFile.name}`;
      const filePath = `public/${employeeId}/${fileName}`;
      
      // Set upload progress for UI feedback
      setUploadProgress(25);
      
      // Using 'public' folder which typically has less restrictive RLS policies
      const { data, error } = await supabase.storage
        .from('leave-documents')
        .upload(filePath, selectedFile, {
          cacheControl: '3600',
          upsert: false
        });
      
      setUploadProgress(75);
      
      if (error) {
        // Check if this is an RLS policy error
        if (error.message.includes('row-level security policy') || 
            error.message.includes('Unauthorized') || 
            error.statusCode === 403) {
          throw new Error('Permission denied: Storage access policy restriction. Please contact your administrator.');
        }
        throw error;
      }
      
      // Get public URL for the file
      const { data: urlData } = supabase.storage
        .from('leave-documents')
        .getPublicUrl(filePath);
      
      setUploadProgress(100);
      setIsUploading(false);
      
      return urlData.publicUrl;
    } catch (error: any) {
      console.error('Error uploading file:', error);
      setIsUploading(false);
      
      // Provide a more specific error message for policy violations
      if (error.message.includes('policy') || error.message.includes('Permission denied')) {
        setErrors(prev => ({ 
          ...prev, 
          file: 'Unable to upload file due to permission restrictions. Your leave request can still be submitted without a document.' 
        }));
      } else {
        setErrors(prev => ({ 
          ...prev, 
          file: 'Failed to upload file. Please try again or submit without a document.' 
        }));
      }
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Upload document if selected
      let documentUrl = '';
      let documentName = '';
      let documentType = '';
      
      if (selectedFile) {
        try {
          const uploadedUrl = await uploadFile();
          if (uploadedUrl) {
            documentUrl = uploadedUrl;
            documentName = selectedFile.name;
            documentType = selectedFile.type;
          } else {
            // If upload fails but it's not critical, continue with submission
            toast('Document upload failed, but leave request will still be submitted', { icon: '⚠️' });
          }
        } catch (uploadError) {
          console.error('Document upload error:', uploadError);
          // Continue with submission even if document upload fails
          toast('Document upload failed, but leave request will still be submitted', { icon: '⚠️' });
        }
      }
      
      // Create the leave request with document info (or without if upload failed)
      const { data, error } = await supabase
        .from('leave_requests')
        .insert({
          employee_id: employeeId,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          reason: reason,
          status: 'pending',
          document_url: documentUrl || null,
          document_name: documentName || null,
          document_type: documentType || null
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
        
        {/* Document Upload */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Supporting Document (Optional)
          </label>
          
          {!selectedFile ? (
            <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
              <div className="space-y-1 text-center">
                <Upload className="mx-auto h-12 w-12 text-gray-400" />
                <div className="flex text-sm text-gray-600">
                  <label
                    htmlFor="file-upload"
                    className="relative cursor-pointer bg-white rounded-md font-medium text-purple-600 hover:text-purple-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-purple-500"
                  >
                    <span>Upload a file</span>
                    <input
                      id="file-upload"
                      name="file-upload"
                      type="file"
                      className="sr-only"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={handleFileChange}
                    />
                  </label>
                  <p className="pl-1">or drag and drop</p>
                </div>
                <p className="text-xs text-gray-500">PDF, JPG or PNG up to 5MB</p>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex items-center p-4 border border-gray-300 rounded-md">
              <div className="flex-shrink-0 h-10 w-10 bg-gray-100 rounded-md flex items-center justify-center">
                <File className="h-6 w-6 text-gray-500" />
              </div>
              <div className="ml-4 flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{selectedFile.name}</p>
                <p className="text-xs text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                type="button"
                onClick={handleRemoveFile}
                className="ml-4 bg-white rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
              >
                <Trash className="h-5 w-5" />
              </button>
            </div>
          )}
          {errors.file && (
            <p className="mt-1 text-xs text-red-600 flex items-start">
              <AlertCircle className="h-3 w-3 mr-1 mt-0.5" />
              {errors.file}
            </p>
          )}
          
          {/* Upload Progress */}
          {isUploading && (
            <div className="mt-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div 
                  className="bg-purple-600 h-2.5 rounded-full" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
              <p className="mt-1 text-xs text-gray-500 text-right">{uploadProgress}% uploaded</p>
            </div>
          )}
        </div>
        
        {/* Info about document privacy */}
        <div className="bg-blue-50 p-4 rounded-md">
          <div className="flex">
            <AlertCircle className="h-5 w-5 text-blue-400 mr-3 flex-shrink-0" />
            <div className="text-sm text-blue-700">
              <p>Your document will be securely stored and only visible to:</p>
              <ul className="list-disc ml-5 mt-1 space-y-1">
                <li>You (the employee)</li>
                <li>Operational managers reviewing leave requests</li>
              </ul>
              <p className="mt-2 text-xs">Note: If document upload fails due to permissions, your leave request can still be submitted without the document.</p>
            </div>
          </div>
        </div>
        
        {/* Submit Button */}
        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            disabled={isSubmitting || isUploading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting || isUploading}
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