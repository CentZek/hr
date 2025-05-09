import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isToday, isSameMonth, isSameDay, addMonths, subMonths, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns';
import { Clock, Calendar, LogOut, Plus, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Trash2, Edit2, Home, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast, { Toaster } from 'react-hot-toast';
import ShiftEntryForm from '../components/Employee/ShiftEntryForm';
import ShiftDetail from '../components/Employee/ShiftDetail';
import { getEmployeeShifts, addEmployeeShift, deleteEmployeeShift } from '../services/employeeService';
import { DISPLAY_SHIFT_TIMES } from '../types';

type Shift = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  shift_type: 'morning' | 'evening' | 'night';
  status: 'pending' | 'confirmed' | 'rejected';
  notes?: string;
  hr_notes?: string;
  penalty_minutes?: number;
  is_approved_record?: boolean;
};

const EmployeeDashboardPage: React.FC = () => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [employeeName, setEmployeeName] = useState<string>('');
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [selectedDateShifts, setSelectedDateShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showNewShiftForm, setShowNewShiftForm] = useState<boolean>(false);
  const [currentView, setCurrentView] = useState<'calendar' | 'detail'>('calendar');
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const navigate = useNavigate();

  // Check authentication and load initial data
  useEffect(() => {
    const checkAuth = async () => {
      // Get employee details from localStorage
      const storedEmployeeId = localStorage.getItem('employeeId');
      const storedEmployeeName = localStorage.getItem('employeeName');
      
      if (!storedEmployeeId || !storedEmployeeName) {
        navigate('/login', { replace: true });
        return;
      }

      setEmployeeId(storedEmployeeId);
      setEmployeeName(storedEmployeeName);
      loadShifts(storedEmployeeId);
    };

    checkAuth();
  }, [navigate]);

  // Load employee shifts
  const loadShifts = async (empId: string) => {
    setIsLoading(true);
    try {
      const data = await getEmployeeShifts(empId);
      console.log("Loaded shifts:", data);
      setShifts(data);
      if (selectedDate) {
        filterShiftsByDate(data, selectedDate);
      }
    } catch (error) {
      console.error('Error loading shifts:', error);
      toast.error('Failed to load your shift data');
    } finally {
      setIsLoading(false);
    }
  };

  // Filter shifts by selected date
  const filterShiftsByDate = (allShifts: Shift[], date: Date) => {
    const filteredShifts = allShifts.filter(shift => 
      isSameDay(parseISO(shift.date), date)
    );
    console.log("Filtered shifts for date", format(date, 'yyyy-MM-dd'), ":", filteredShifts);
    setSelectedDateShifts(filteredShifts);
  };

  // Update shifts when selected date changes
  useEffect(() => {
    if (selectedDate && shifts.length > 0) {
      filterShiftsByDate(shifts, selectedDate);
    }
  }, [selectedDate, shifts]);

  // Handle month navigation
  const previousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  // Handle date selection
  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    filterShiftsByDate(shifts, date);
    setShowNewShiftForm(false); // Close form when changing dates
  };

  // Handle adding a new shift
  const handleAddShift = async (shiftData: any) => {
    if (!selectedDate || !employeeId) return;
    
    try {
      const newShift = await addEmployeeShift({
        ...shiftData,
        employee_id: employeeId,
        date: format(selectedDate, 'yyyy-MM-dd'),
      });
      
      setShifts(prev => [...prev, newShift]);
      setSelectedDateShifts(prev => [...prev, newShift]);
      setShowNewShiftForm(false);
      toast.success('Shift added successfully');
    } catch (error) {
      console.error('Error adding shift:', error);
      toast.error('Failed to add shift');
    }
  };

  // Handle deleting a shift
  const handleDeleteShift = async (shiftId: string) => {
    if (!confirm('Are you sure you want to delete this shift?')) return;
    
    try {
      // Check if this is an approved record (which can't be deleted)
      if (shiftId.startsWith('tr-')) {
        toast.error("Approved time records cannot be deleted");
        return;
      }
      
      await deleteEmployeeShift(shiftId);
      setShifts(shifts.filter(shift => shift.id !== shiftId));
      setSelectedDateShifts(selectedDateShifts.filter(shift => shift.id !== shiftId));
      
      if (selectedShift && selectedShift.id === shiftId) {
        setSelectedShift(null);
        setCurrentView('calendar');
      }
      
      toast.success('Shift deleted successfully');
    } catch (error) {
      console.error('Error deleting shift:', error);
      toast.error('Failed to delete shift');
    }
  };

  // Handle viewing a shift's details
  const handleViewShiftDetails = (shift: Shift) => {
    setSelectedShift(shift);
    setCurrentView('detail');
  };

  // Handle logout
  const handleLogout = async () => {
    localStorage.removeItem('employeeId');
    localStorage.removeItem('employeeName');
    localStorage.removeItem('employeeNumber');
    navigate('/login', { replace: true });
  };

  // Get formatted display time for UI
  const getDisplayTime = (shiftType: string, timeType: 'start' | 'end') => {
    if (!shiftType || !['morning', 'evening', 'night'].includes(shiftType)) {
      return timeType === 'start' ? '5:00:00 AM' : '2:00:00 PM'; // Default to morning shift
    }
    
    const displayTimes = DISPLAY_SHIFT_TIMES[shiftType as keyof typeof DISPLAY_SHIFT_TIMES];
    return timeType === 'start' ? displayTimes.startTime : displayTimes.endTime;
  };

  // Render calendar days
  const renderCalendarDays = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const startDate = monthStart;
    const endDate = monthEnd;

    const dateFormat = 'd';
    const days = [];

    const daysInMonth = eachDayOfInterval({
      start: startDate,
      end: endDate
    });

    // Add empty cells for days before the start of the month
    const startDay = getDay(monthStart);
    for (let i = 0; i < startDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="h-12 border border-transparent"></div>
      );
    }

    // Add the days of the month
    daysInMonth.forEach((day) => {
      const formattedDate = format(day, dateFormat);
      const isCurrentDay = isToday(day);
      const isSelectedDay = selectedDate && isSameDay(day, selectedDate);
      const dayShifts = shifts.filter(shift => isSameDay(parseISO(shift.date), day));
      const hasPendingShift = dayShifts.some(shift => shift.status === 'pending');
      const hasConfirmedShift = dayShifts.some(shift => shift.status === 'confirmed');
      const hasApprovedRecord = dayShifts.some(shift => shift.is_approved_record === true);
      
      days.push(
        <div
          key={day.toString()}
          className={`h-12 border rounded-md flex items-center justify-center relative cursor-pointer transition-colors
            ${isCurrentDay ? 'border-purple-500 font-bold' : 'border-gray-200'}
            ${isSelectedDay ? 'bg-purple-100 border-purple-400' : 'hover:bg-gray-50'}
          `}
          onClick={() => handleDateSelect(day)}
        >
          <span className={`text-sm ${isSelectedDay ? 'text-purple-800' : ''}`}>{formattedDate}</span>
          {hasPendingShift && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500"></span>
          )}
          {hasConfirmedShift && !hasApprovedRecord && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-green-500"></span>
          )}
          {hasApprovedRecord && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-blue-500"></span>
          )}
        </div>
      );
    });

    return days;
  };

  // Generate status indicators for calendar key
  const getStatusBadges = () => {
    return (
      <div className="flex justify-center mt-4 space-x-4 text-xs text-gray-500">
        <div className="flex items-center">
          <span className="h-2 w-2 rounded-full bg-amber-500 mr-1"></span>
          <span>Pending</span>
        </div>
        <div className="flex items-center">
          <span className="h-2 w-2 rounded-full bg-green-500 mr-1"></span>
          <span>Confirmed</span>
        </div>
        <div className="flex items-center">
          <span className="h-2 w-2 rounded-full bg-blue-500 mr-1"></span>
          <span>Approved Record</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <Clock className="h-6 w-6 text-purple-600 mr-2" />
              <h1 className="text-xl font-medium text-gray-900">Time Tracking</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigate('/')}
                className="flex items-center text-gray-600 hover:text-gray-800"
              >
                <Home className="w-4 h-4 mr-1" />
                Back to Home
              </button>
              <span className="text-sm text-gray-600 ml-4">Welcome, {employeeName}</span>
              <button 
                onClick={handleLogout}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm leading-5 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <LogOut className="w-4 h-4 mr-1" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-gray-600 mb-8">
          <p>Track your working hours and manage your shifts</p>
        </div>

        {/* Content sections */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left column - Calendar */}
          <div className="md:col-span-1 bg-white rounded-lg shadow p-6">
            <div className="flex items-center mb-4">
              <Calendar className="h-5 w-5 text-purple-600 mr-2" />
              <h2 className="text-lg font-medium text-gray-900">Select Date</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">Tap on a date to view or record your shifts</p>

            {/* Calendar navigation */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={previousMonth}
                className="p-1 rounded-full hover:bg-gray-100"
              >
                <ChevronLeft className="h-5 w-5 text-gray-600" />
              </button>
              <h3 className="text-base font-medium text-gray-900">
                {format(currentMonth, 'MMMM yyyy')}
              </h3>
              <button
                onClick={nextMonth}
                className="p-1 rounded-full hover:bg-gray-100"
              >
                <ChevronRight className="h-5 w-5 text-gray-600" />
              </button>
            </div>

            {/* Calendar weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="text-xs font-medium text-gray-500 text-center py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {renderCalendarDays()}
            </div>

            {/* Calendar key */}
            {getStatusBadges()}
          </div>

          {/* Right column - Shift details */}
          <div className="md:col-span-2 bg-white rounded-lg shadow">
            {currentView === 'calendar' && selectedDate && (
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center">
                    <Clock className="h-5 w-5 text-purple-600 mr-2" />
                    <h2 className="text-lg font-medium text-gray-900">
                      {format(selectedDate, 'EEEE, MMMM d, yyyy')}
                    </h2>
                  </div>
                  {!showNewShiftForm && !selectedDateShifts.some(shift => shift.is_approved_record) && (
                    <button
                      onClick={() => setShowNewShiftForm(true)}
                      className="inline-flex items-center px-3 py-1.5 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Shift
                    </button>
                  )}
                </div>

                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full"></div>
                  </div>
                ) : showNewShiftForm ? (
                  <ShiftEntryForm
                    date={selectedDate}
                    onSubmit={handleAddShift}
                    onCancel={() => setShowNewShiftForm(false)}
                  />
                ) : selectedDateShifts.length > 0 ? (
                  <div className="space-y-4">
                    {/* Approved records notice */}
                    {selectedDateShifts.some(shift => shift.is_approved_record) && (
                      <div className="bg-blue-50 border border-blue-200 rounded-md p-3 flex items-start mb-4">
                        <Info className="w-5 h-5 text-blue-500 mr-2 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-blue-800">
                            Approved Time Record
                          </p>
                          <p className="text-xs text-blue-700">
                            This record has been approved by HR. You can view the details, but cannot modify it.
                          </p>
                        </div>
                      </div>
                    )}
                    
                    {selectedDateShifts.map((shift) => (
                      <div key={shift.id} className={`border rounded-lg p-4 hover:bg-gray-50 ${shift.is_approved_record ? 'border-blue-200 bg-blue-50' : ''}`}>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center mb-2 flex-wrap gap-2">
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                shift.shift_type === 'morning' ? 'bg-blue-100 text-blue-800' : 
                                shift.shift_type === 'evening' ? 'bg-orange-100 text-orange-800' : 
                                'bg-purple-100 text-purple-800'
                              }`}>
                                {shift.shift_type.charAt(0).toUpperCase() + shift.shift_type.slice(1)} Shift
                              </span>
                              <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                shift.is_approved_record ? 'bg-blue-100 text-blue-800' :
                                shift.status === 'confirmed' ? 'bg-green-100 text-green-800' : 
                                shift.status === 'rejected' ? 'bg-red-100 text-red-800' : 
                                'bg-amber-100 text-amber-800'
                              }`}>
                                {shift.is_approved_record ? 'Approved' :
                                 shift.status.charAt(0).toUpperCase() + shift.status.slice(1)}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-gray-500">Start Time</p>
                                <p className="font-medium">{getDisplayTime(shift.shift_type, 'start')}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">End Time</p>
                                <p className="font-medium">{getDisplayTime(shift.shift_type, 'end')}</p>
                              </div>
                            </div>
                            {shift.penalty_minutes && shift.penalty_minutes > 0 && (
                              <div className="mt-2 text-sm text-red-600 flex items-center">
                                <AlertCircle className="w-4 h-4 mr-1" />
                                <span>Penalty: {shift.penalty_minutes} minutes</span>
                              </div>
                            )}
                            {shift.hr_notes && (
                              <div className="mt-2 text-sm text-gray-600">
                                <p className="font-medium">HR Notes:</p>
                                <p>{shift.hr_notes}</p>
                              </div>
                            )}
                            {shift.is_approved_record && (
                              <div className="mt-2 text-sm text-blue-600 flex items-center">
                                <CheckCircle className="w-4 h-4 mr-1" />
                                <span>HR-Approved Time Record</span>
                              </div>
                            )}
                          </div>
                          {!shift.is_approved_record && (
                            <div className="flex space-x-2">
                              <button
                                onClick={() => handleViewShiftDetails(shift)}
                                className="p-1 text-blue-600 hover:bg-blue-50 rounded-full"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              {shift.status === 'pending' && (
                                <button
                                  onClick={() => handleDeleteShift(shift.id)}
                                  className="p-1 text-red-600 hover:bg-red-50 rounded-full"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Clock className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-gray-500 mb-2">No shifts recorded</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      You have no shifts recorded for this date. Add a shift to track your hours.
                    </p>
                    <button
                      onClick={() => setShowNewShiftForm(true)}
                      className="inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add New Shift
                    </button>
                  </div>
                )}
              </div>
            )}

            {currentView === 'detail' && (
              <div className="p-6">
                <button
                  onClick={() => {
                    setCurrentView('calendar');
                    setSelectedShift(null);
                  }}
                  className="flex items-center text-purple-600 mb-4"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back to calendar
                </button>
                
                {selectedShift ? (
                  <ShiftDetail 
                    shift={selectedShift}
                    onDelete={handleDeleteShift}
                    onClose={() => {
                      setCurrentView('calendar');
                      setSelectedShift(null);
                    }}
                  />
                ) : (
                  <div className="text-center py-8">
                    <h3 className="text-lg font-medium text-gray-500 mb-2">No shift selected</h3>
                    <p className="text-sm text-gray-500">
                      Please select a shift to view details
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <Toaster position="top-right" />
    </div>
  );
};

export default EmployeeDashboardPage;