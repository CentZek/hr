import { supabase } from '../lib/supabase';
import { format } from 'date-fns';

// Fetch leave requests for an employee
export const getEmployeeLeaveRequests = async (employeeId: string) => {
  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error fetching leave requests:', error);
    throw error;
  }
};

// Create a new leave request
export const createLeaveRequest = async (leaveData: {
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string;
}) => {
  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .insert({
        ...leaveData,
        status: 'pending'
      })
      .select();
      
    if (error) throw error;
    
    return data?.[0] || null;
  } catch (error) {
    console.error('Error creating leave request:', error);
    throw error;
  }
};

// Update a leave request status
export const updateLeaveRequestStatus = async (requestId: string, status: 'approved' | 'rejected') => {
  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .update({ status })
      .eq('id', requestId)
      .select();
      
    if (error) throw error;
    
    return data?.[0] || null;
  } catch (error) {
    console.error(`Error ${status === 'approved' ? 'approving' : 'rejecting'} leave request:`, error);
    throw error;
  }
};

// Fetch all leave requests for HR/Manager view
export const getAllLeaveRequests = async () => {
  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .select(`
        id, 
        leave_type, 
        start_date, 
        end_date, 
        reason, 
        status, 
        created_at,
        employee_id,
        employees (
          id,
          name,
          employee_number
        )
      `)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    return data || [];
  } catch (error) {
    console.error('Error fetching all leave requests:', error);
    throw error;
  }
};

// Check if an employee has leave on a specific date
export const checkEmployeeLeaveOnDate = async (employeeId: string, dateStr: string) => {
  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('id, leave_type, status')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .lte('start_date', dateStr)
      .gte('end_date', dateStr);
      
    if (error) throw error;
    
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('Error checking employee leave:', error);
    return null;
  }
};

// Get leave status for a range of dates (for calendar display)
export const getLeaveStatusForDateRange = async (employeeId: string, startDate: string, endDate: string) => {
  try {
    const { data, error } = await supabase
      .from('leave_requests')
      .select('id, leave_type, start_date, end_date, status')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .or(`start_date.lte.${endDate},end_date.gte.${startDate}`);
      
    if (error) throw error;
    
    // Format the data into a map of date -> leave type
    const leaveDates: Record<string, string> = {};
    
    data?.forEach(leave => {
      // Get dates between start and end
      const start = new Date(leave.start_date);
      const end = new Date(leave.end_date);
      
      // For each day in the leave period
      for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
        const dateString = format(date, 'yyyy-MM-dd');
        leaveDates[dateString] = leave.leave_type;
      }
    });
    
    return leaveDates;
  } catch (error) {
    console.error('Error getting leave status for date range:', error);
    return {};
  }
};