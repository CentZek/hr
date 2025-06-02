import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar, X, AlertCircle, Paperclip, FileText, Trash } from 'lucide-react';
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
  
  // File upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [bucketAvailable, setBucketAvailable] = useState<boolean>(false);
  const [bucketChecked, setBucketChecked] = useState<boolean>(false);

  // Check if the storage bucket exists when component mounts
  useEffect(() => {
    const checkBucketExists = async () => {
      try {
        // List all buckets and check if 'leave-documents' exists
        const { data: buckets, error } = await supabase.storage.listBuckets();
        
        if (error) {
          console.warn('Unable to list storage buckets:', error);
          setBucketAvailable(false);
        } else {
          const leaveBucket = buckets.find(b => b.name === 'leave-documents');
          setBucketAvailable(!!leaveBucket);
          
          if (!leaveBucket) {
            console.log('The leave-documents bucket does not exist in Supabase storage');
          }
        }
      } catch (error) {
        console.error('Error checking bucket:', error);
        setBucketAvailable(false);
      } finally {
        setBucketChecked(true);
      }
    };
    
    checkBucketExists();
  }, []);

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
    
    // Validate file if selected
    if (selectedFile) {
      const maxSizeMB = 5;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;
      
      if (selectedFile.size > maxSizeBytes) {
        newErrors.file = `File size exceeds the ${maxSizeMB}MB limit`;
      }
      
      // Check allowed file types (PDF, DOC, DOCX, JPG, PNG)
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];
      if (!allowedTypes.includes(selectedFile.type)) {
        newErrors.file = 'Only PDF, DOC, DOCX, JPG, or PNG files are allowed';
      }
      
      // Check if bucket is available
      if (!bucketAvailable) {
        newErrors.file = 'Document upload is not available. You can still submit your request without a document.';
        // Auto-clear the selected file when bucket is unavailable
        clearSelectedFile();
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!bucketAvailable) {
      toast.error('Document upload is unavailable. The required storage bucket has not been configured.');
      e.target.value = '';
      return;
    }
    
    const files = e.target.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  const clearSelectedFile = () => {
    setSelectedFile(null);
    // Clear the input value
    const fileInput = document.getElementById('document-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const uploadFile = async (): Promise<{ url: string, fileName: string, fileType: string } | null> => {
    if (!selectedFile) return null;
    if (!bucketAvailable || !bucketChecked) {
      toast.error('Leave documents storage is not configured correctly. Please contact your administrator.');
      return null;
    }
    
    setIsUploading(true);
    setUploadProgress(0);
    
    try {
      // Create a unique file path using employee ID and timestamp
      const timestamp = new Date().getTime();
      const filePath = `${employeeId}/${timestamp}_${selectedFile.name}`;
      
      // Upload the file to Supabase Storage
      const { data, error } = await supabase.storage
        .from('leave-documents')
        .upload(filePath, selectedFile, {
          cacheControl: '3600',
          upsert: false
        });
      
      if (error) {
        console.error('Storage bucket error:', error);
        throw new Error('Failed to upload file. Please try again later.');
      }
      
      // Get the public URL for the file
      const { data: urlData } = supabase.storage
        .from('leave-documents')
        .getPublicUrl(data.path);
      
      return {
        url: urlData.publicUrl,
        fileName: selectedFile.name,
        fileType: selectedFile.type
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      
      // More user-friendly error message
      if (error instanceof Error) {
        throw new Error('Error uploading file: ' + error.message);
      } else {
        throw new Error('Leave documents storage is not configured correctly. Please contact your administrator.');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Handle file upload if selected
      let documentData = null;
      if (selectedFile && bucketAvailable) {
        try {
          documentData = await uploadFile();
        } catch (error) {
          // If file upload fails but was selected, clear the file but allow submission to continue
          clearSelectedFile();
          toast.warning(error instanceof Error ? error.message : 'Document upload failed, but you can still submit your request without a document.');
        }
      }
      
      // Prepare leave request data
      const leaveRequestData = {
        employee_id: employeeId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reason: reason,
        status: 'pending',
        document_url: documentData?.url || null,
        document_name: documentData?.fileName || null,
        document_type: documentData?.fileType || null
      };
      
      // Submit leave request to database
      const { data, error } = await supabase
        .from('leave_requests')
        .insert(leaveRequestData)
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
          <label htmlFor="document-upload" className="block text-sm font-medium text-gray-700 mb-1">
            Supporting Document (Optional)
          </label>
          
          {bucketChecked && !bucketAvailable && (
            <div className="mb-3 flex items-center p-3 bg-yellow-50 text-yellow-800 rounded-md border border-yellow-200">
              <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
              <p className="text-sm">
                <span className="font-medium">Document upload is currently unavailable.</span> Please submit your request without a document.
                <span className="block mt-1 text-xs font-medium">
                  Note for admin: The 'leave-documents' storage bucket needs to be created in your Supabase project.
                </span>
              </p>
            </div>
          )}
          
          <div className="mt-1 flex flex-col space-y-2">
            {!selectedFile ? (
              <div className={`flex items-center justify-center px-6 pt-5 pb-6 border-2 
                ${!bucketAvailable ? 'border-gray-200 bg-gray-50' : 'border-gray-300'} 
                border-dashed rounded-md ${!bucketAvailable ? 'opacity-50' : ''}`}
              >
                <div className="space-y-1 text-center">
                  <Paperclip className="mx-auto h-10 w-10 text-gray-400" />
                  <div className="flex text-sm text-gray-600">
                    <label
                      htmlFor="document-upload"
                      className={`relative ${bucketAvailable ? 'cursor-pointer' : 'cursor-not-allowed'} 
                        rounded-md font-medium 
                        ${bucketAvailable ? 'text-purple-600 hover:text-purple-500' : 'text-gray-400'} 
                        focus-within:outline-none`}
                    >
                      <span>Upload a file</span>
                      <input
                        id="document-upload"
                        name="document-upload"
                        type="file"
                        className="sr-only"
                        onChange={handleFileChange}
                        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                        disabled={!bucketAvailable}
                      />
                    </label>
                    <p className="pl-1">or drag and drop</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    PDF, DOC, DOCX, JPG, PNG up to 5MB
                  </p>
                  {!bucketAvailable && (
                    <p className="text-xs text-red-500 mt-1">
                      Document upload is disabled due to missing storage configuration
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 border border-gray-300 rounded-md bg-gray-50">
                <div className="flex items-center">
                  <FileText className="h-5 w-5 text-purple-500 mr-2" />
                  <span className="text-sm font-medium text-gray-700 truncate" title={selectedFile.name}>
                    {selectedFile.name}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearSelectedFile}
                  className="text-gray-400 hover:text-gray-500"
                  title="Remove file"
                >
                  <Trash className="h-4 w-4" />
                </button>
              </div>
            )}
            
            {isUploading && (
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-purple-600 h-2.5 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
              </div>
            )}
            
            {errors.file && <p className="mt-1 text-xs text-red-600">{errors.file}</p>}
          </div>
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