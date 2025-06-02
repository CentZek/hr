import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Calendar, CheckCircle, XCircle, Clock, Clock4, Download, File } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface LeaveRequestListProps {
  employeeId: string;
  onNewRequest: () => void;
}

const LeaveRequestList: React.FC<LeaveRequestListProps> = ({ employeeId, onNewRequest }) => {
  const [requests, setRequests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    fetchLeaveRequests();
  }, [employeeId]);

  const fetchLeaveRequests = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('leave_requests')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      
      setRequests(data || []);
    } catch (error) {
      console.error('Error fetching leave requests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'approved':
        return { 
          color: 'bg-green-100 text-green-800', 
          icon: <CheckCircle className="w-4 h-4 mr-1" /> 
        };
      case 'rejected':
        return { 
          color: 'bg-red-100 text-red-800', 
          icon: <XCircle className="w-4 h-4 mr-1" /> 
        };
      default:
        return { 
          color: 'bg-amber-100 text-amber-800', 
          icon: <Clock className="w-4 h-4 mr-1" /> 
        };
    }
  };
  
  const formatLeaveType = (type: string): string => {
    return type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const handleViewDocument = async (documentUrl: string) => {
    window.open(documentUrl, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-700"></div>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-6">
        <Clock4 className="mx-auto h-12 w-12 text-gray-300" />
        <h3 className="mt-2 text-sm font-medium text-gray-900">No leave requests</h3>
        <p className="mt-1 text-sm text-gray-500">Get started by creating a new leave request.</p>
        <div className="mt-6">
          <button
            type="button"
            onClick={onNewRequest}
            className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
          >
            <Calendar className="-ml-1 mr-2 h-5 w-5" />
            New Leave Request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">Your Leave Requests</h3>
        <button
          onClick={onNewRequest}
          className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
        >
          <Calendar className="h-4 w-4 mr-1" />
          New Request
        </button>
      </div>
      <div className="space-y-4">
        {requests.map((request) => {
          const statusDisplay = getStatusDisplay(request.status);
          
          return (
            <div key={request.id} className="border rounded-md p-4 hover:bg-gray-50">
              <div className="flex justify-between">
                <div className="flex flex-col">
                  <div className="flex items-center">
                    <h4 className="text-base font-medium text-gray-900">{formatLeaveType(request.leave_type)}</h4>
                    <span className={`ml-2 px-2 py-0.5 text-xs rounded-full flex items-center ${statusDisplay.color}`}>
                      {statusDisplay.icon}
                      {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-600">
                    <span className="font-medium">
                      {format(parseISO(request.start_date), 'MMM d, yyyy')}
                      {request.start_date !== request.end_date && ` – ${format(parseISO(request.end_date), 'MMM d, yyyy')}`}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{request.reason}</p>
                  
                  {/* Document attachment section */}
                  {request.document_url && (
                    <div className="mt-2 flex items-center">
                      <button
                        onClick={() => handleViewDocument(request.document_url)}
                        className="inline-flex items-center px-2 py-1 text-xs rounded bg-blue-50 text-blue-600 hover:bg-blue-100"
                      >
                        <File className="w-3 h-3 mr-1" />
                        {request.document_name || 'View Document'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {format(parseISO(request.created_at), 'MMM d, yyyy')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LeaveRequestList;