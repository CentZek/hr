import React, { useState, useEffect } from 'react';
import { format, subMonths, isSameDay, startOfMonth, endOfMonth, parseISO, isValid } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Clock, ArrowLeft, Download, Users, Calendar, Filter, Trash2, Home, Calendar as Calendar2, User, X, ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApprovedHours, fetchEmployeeDetails, deleteAllTimeRecords } from '../services/database';
import { exportApprovedHoursToExcel } from '../utils/excelHandlers';
import { fetchHolidays, getDoubleTimeDays } from '../services/holidayService';
import EmployeeHoursSummary from '../components/ApprovedHours/EmployeeHoursSummary';
import DailyBreakdown from '../components/ApprovedHours/DailyBreakdown';
import DeleteConfirmDialog from '../components/DeleteConfirmDialog';
import NavigationTabs from '../components/NavigationTabs';
import HolidayCalendar from '../components/HolidayCalendar';
import EmployeeFilter from '../components/ApprovedHours/EmployeeFilter';
import EmployeeDetailCard from '../components/ApprovedHours/EmployeeDetailCard';
import MultiEmployeeFilter from '../components/ApprovedHours/MultiEmployeeFilter';
import DateRangePicker from '../components/DateRangePicker';
import { useHrAuth } from '../context/HrAuthContext';

// Safely format a date - handles invalid dates
const safeFormat = (date: Date | string | null | undefined, formatStr: string, defaultValue = ''): string => {
  if (!date) return defaultValue;
  
  try {
    let dateObj: Date;
    if (typeof date === 'string') {
      dateObj = parseISO(date);
    } else {
      dateObj = date;
    }
    
    if (!isValid(dateObj)) return defaultValue;
    return format(dateObj, formatStr);
  } catch (error) {
    console.error('Error formatting date:', error);
    return defaultValue;
  }
};

const ApprovedHoursPage: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, username, logout } = useHrAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [employees, setEmployees] = useState<any[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [dailyRecords, setDailyRecords] = useState<any[]>([]);
  // Set default filter to current month instead of "all"
  const currentMonthValue = format(new Date(), 'yyyy-MM');
  const [filterMonth, setFilterMonth] = useState<string>(currentMonthValue);
  const [filterEmployee, setFilterEmployee] = useState<string>("all");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [dailyRecordsLoading, setDailyRecordsLoading] = useState(false);
  const [totalHours, setTotalHours] = useState(0);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalDoubleTimeHours, setTotalDoubleTimeHours] = useState(0);
  const [totalPayableHours, setTotalPayableHours] = useState(0);
  const [doubleDays, setDoubleDays] = useState<string[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [startDate, setStartDate] = useState<string>(safeFormat(subMonths(new Date(), 1), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(safeFormat(new Date(), 'yyyy-MM-dd'));
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  
  // Delete confirmation state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Generate month options for the dropdown
  const monthOptions = [
    { value: "all", label: "All Time" },
    { value: "custom", label: "Custom Date Range" },
    ...Array.from({ length: 12 }).map((_, i) => {
      const date = subMonths(new Date(), i);
      return {
        value: safeFormat(date, 'yyyy-MM'),
        label: safeFormat(date, 'MMMM yyyy')
      };
    })
  ];

  // Fetch double-time days once and when date range changes
  useEffect(() => {
    const loadDoubleDays = async () => {
      try {
        let start, end;
        
        if (filterMonth === "all") {
          // Use a large date range for "all time" (past year to future year)
          start = safeFormat(subMonths(new Date(), 12), 'yyyy-MM-dd');
          end = safeFormat(new Date(new Date().getFullYear() + 1, 11, 31), 'yyyy-MM-dd');
        } else if (filterMonth === "custom") {
          // Use the selected date range
          start = startDate;
          end = endDate;
          
          // Validate dates
          if (!start || !end || !isValid(parseISO(start)) || !isValid(parseISO(end))) {
            console.error('Invalid date range for double days query');
            return;
          }
        } else {
          // Use the selected month
          try {
            const [year, month] = filterMonth.split('-');
            const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            if (isValid(monthDate)) {
              start = safeFormat(startOfMonth(monthDate), 'yyyy-MM-dd');
              end = safeFormat(endOfMonth(monthDate), 'yyyy-MM-dd');
            } else {
              // Use current month as fallback
              start = safeFormat(startOfMonth(new Date()), 'yyyy-MM-dd');
              end = safeFormat(endOfMonth(new Date()), 'yyyy-MM-dd');
            }
          } catch (error) {
            console.error('Error parsing filter month:', error);
            // Use current month as fallback
            start = safeFormat(startOfMonth(new Date()), 'yyyy-MM-dd');
            end = safeFormat(endOfMonth(new Date()), 'yyyy-MM-dd');
          }
        }
        
        // Only proceed if we have valid dates
        if (start && end) {
          const days = await getDoubleTimeDays(start, end);
          setDoubleDays(days);
        }
      } catch (error) {
        console.error('Error loading double-time days:', error);
      }
    };
    
    loadDoubleDays();
  }, [filterMonth, startDate, endDate]);

  // Fetch all approved hours summary
  useEffect(() => {
    const loadApprovedHours = async () => {
      setIsLoading(true);
      try {
        let dateFilter = "";
        
        if (filterMonth === "custom") {
          // Validate dates before setting the filter
          if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
            dateFilter = `${startDate}|${endDate}`;
          } else {
            console.warn('Invalid date range, using default filter');
            // Default to recent month if dates are invalid
            const defaultStart = safeFormat(subMonths(new Date(), 1), 'yyyy-MM-dd');
            const defaultEnd = safeFormat(new Date(), 'yyyy-MM-dd');
            dateFilter = `${defaultStart}|${defaultEnd}`;
          }
        } else if (filterMonth !== "all") {
          dateFilter = filterMonth;
        }
        
        const { data, totalHoursSum } = await fetchApprovedHours(dateFilter);
        setAllEmployees(data); // Store all employees
        
        // Filter employees if specific employees are selected
        if (selectedEmployees.length > 0) {
          const filteredData = data.filter((emp) => selectedEmployees.includes(emp.id));
          setEmployees(filteredData);
        } else if (filterEmployee !== "all") {
          const filteredData = data.filter((emp) => emp.id === filterEmployee);
          setEmployees(filteredData);
        } else {
          setEmployees(data);
        }
        
        setTotalEmployees(selectedEmployees.length > 0 ? selectedEmployees.length : data.length);
        
        // Calculate total regular hours and total double-time hours
        let regularHours = 0;
        let doubleTimeHours = 0;
        
        // Process each employee's data to calculate double-time hours
        const employeesToCalculate = selectedEmployees.length > 0 
          ? data.filter(emp => selectedEmployees.includes(emp.id))
          : filterEmployee !== "all" 
            ? data.filter(emp => emp.id === filterEmployee) 
            : data;
            
        employeesToCalculate.forEach(employee => {
          let employeeDoubleTime = 0;
          let employeeRegularTime = 0;
          
          // If we have the working_week_start for each record, we can calculate more accurately
          if (employee.working_week_dates) {
            employee.working_week_dates.forEach((dateStr: string) => {
              const hours = employee.hours_by_date?.[dateStr] || 0;
              if (doubleDays.includes(dateStr)) {
                employeeDoubleTime += hours;
                doubleTimeHours += hours; // Add the bonus hours (base hours already counted)
                regularHours += hours; // Base hours
              } else {
                employeeRegularTime += hours;
                regularHours += hours;
              }
            });
          } else {
            // If detailed data is not available, just add to regular hours
            regularHours += employee.total_hours || 0;
            
            // Estimate that 20% of hours might be double-time (just a placeholder calculation)
            const estimatedDoubleTime = (employee.total_hours || 0) * 0.2;
            doubleTimeHours += estimatedDoubleTime;
          }
          
          // Attach double-time hours to employee record for display
          employee.double_time_hours = employeeDoubleTime;
        });
        
        setTotalHours(regularHours);
        setTotalDoubleTimeHours(doubleTimeHours);
        setTotalPayableHours(regularHours + doubleTimeHours);
      } catch (error) {
        console.error('Error loading approved hours:', error);
        toast.error('Failed to load approved hours data');
      } finally {
        setIsLoading(false);
      }
    };

    loadApprovedHours();
  }, [filterMonth, doubleDays, filterEmployee, selectedEmployees, startDate, endDate]);

  // Handle employee expansion
  const handleEmployeeExpand = async (employeeId: string) => {
    // Toggle expand/collapse
    if (expandedEmployee === employeeId) {
      setExpandedEmployee(null);
      setDailyRecords([]);
      return;
    }

    setExpandedEmployee(employeeId);
    setDailyRecordsLoading(true);

    try {
      // Fetch detailed daily breakdown for this employee
      let dateFilter = "";
      
      if (filterMonth === "custom") {
        // Validate dates before setting the filter
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          dateFilter = `${startDate}|${endDate}`;
        } else {
          console.warn('Invalid date range, using default filter');
          // Default to recent month if dates are invalid
          const defaultStart = safeFormat(subMonths(new Date(), 1), 'yyyy-MM-dd');
          const defaultEnd = safeFormat(new Date(), 'yyyy-MM-dd');
          dateFilter = `${defaultStart}|${defaultEnd}`;
        }
      } else if (filterMonth !== "all") {
        dateFilter = filterMonth;
      }
      
      const { data: records } = await fetchEmployeeDetails(employeeId, dateFilter);
      setDailyRecords(records);
    } catch (error) {
      console.error('Error loading employee details:', error);
      toast.error('Failed to load employee details');
    } finally {
      setDailyRecordsLoading(false);
    }
  };

  const handleExport = () => {
    // Prepare data for export
    const exportData = {
      summary: employees,
      details: dailyRecords,
      filterMonth,
      dateRange: filterMonth === "custom" ? { startDate, endDate } : undefined,
      doubleDays // Include double-time days for export calculations
    };
    
    exportApprovedHoursToExcel(exportData);
    toast.success('Data exported successfully');
  };
  
  // Handle delete all records
  const handleDeleteAllRecords = async () => {
    setIsDeleting(true);
    let loadingMessage = 'Deleting time records...';
    
    if (filterMonth === "custom") {
      loadingMessage = `Deleting time records from ${startDate && parseISO(startDate) && isValid(parseISO(startDate)) ? safeFormat(parseISO(startDate), 'MMM d, yyyy') : 'start date'} to ${endDate && parseISO(endDate) && isValid(parseISO(endDate)) ? safeFormat(parseISO(endDate), 'MMM d, yyyy') : 'end date'}...`;
    } else if (filterMonth !== "all") {
      loadingMessage = `Deleting time records for ${monthOptions.find(m => m.value === filterMonth)?.label || 'selected month'}...`;
    }
    
    const loadingToast = toast.loading(loadingMessage);
    
    try {
      // Prepare date filter
      let dateFilter = "";
      
      if (filterMonth === "custom") {
        // Validate dates before setting the filter
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          dateFilter = `${startDate}|${endDate}`;
        } else {
          console.warn('Invalid date range, using default filter');
          toast.dismiss(loadingToast);
          toast.error('Invalid date range selected');
          setIsDeleting(false);
          setIsDeleteDialogOpen(false);
          return;
        }
      } else if (filterMonth !== "all") {
        dateFilter = filterMonth;
      }
      
      // Prepare employee filter
      const employeeFilter = selectedEmployees.length > 0 ? selectedEmployees.join(',') : 
                            (filterEmployee !== "all" ? filterEmployee : "");
      
      // Perform the delete operation
      const { success, message, count } = await deleteAllTimeRecords(dateFilter, employeeFilter, false);
      
      toast.dismiss(loadingToast);
      if (success) {
        // Show appropriate success message
        if (filterMonth === "all" && employeeFilter === "") {
          toast.success(`Successfully deleted all time records (${count} entries)`);
        } else {
          let successMessage = `Successfully deleted ${count} time records`;
          
          if (filterMonth === "custom") {
            successMessage += ` for the selected date range`;
          } else if (filterMonth !== "all") {
            const monthLabel = monthOptions.find(m => m.value === filterMonth)?.label || filterMonth;
            successMessage += ` for ${monthLabel}`;
          }
          
          if (employeeFilter) {
            const employeeNames = selectedEmployees.length > 0 
              ? selectedEmployees.map(id => {
                  const emp = allEmployees.find(e => e.id === id);
                  return emp ? emp.name : 'Unknown';
                }).join(', ')
              : allEmployees.find(e => e.id === filterEmployee)?.name || 'selected employee';
            
            successMessage += ` for ${employeeNames}`;
          }
          
          toast.success(successMessage);
        }
        
        // Refresh the data
        const { data, totalHoursSum } = await fetchApprovedHours(dateFilter);
        setAllEmployees(data || []);
        
        if (selectedEmployees.length > 0) {
          const filteredData = data.filter((emp) => selectedEmployees.includes(emp.id));
          setEmployees(filteredData);
        } else if (filterEmployee !== "all") {
          const filteredData = data.filter((emp) => emp.id === filterEmployee);
          setEmployees(filteredData);
        } else {
          setEmployees(data || []);
        }
        
        setTotalHours(totalHoursSum || 0);
        setTotalEmployees(selectedEmployees.length > 0 ? selectedEmployees.length : data?.length || 0);
        setDailyRecords([]);
        setExpandedEmployee(null);
      } else {
        toast.dismiss(loadingToast);
        toast.error(`Failed to delete records: ${message}`);
      }
    } catch (error) {
      console.error('Error during deletion:', error);
      toast.dismiss(loadingToast);
      toast.error('An unexpected error occurred while deleting records');
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
    }
  };

  // Handle calendar toggle
  const handleCalendarToggle = () => {
    setShowCalendar(!showCalendar);
  };

  // Refresh data after calendar update
  const handleHolidaysUpdated = async () => {
    try {
      // Refresh double days
      let start, end;
      
      if (filterMonth === "all") {
        start = safeFormat(subMonths(new Date(), 12), 'yyyy-MM-dd');
        end = safeFormat(new Date(new Date().getFullYear() + 1, 11, 31), 'yyyy-MM-dd');
      } else if (filterMonth === "custom") {
        if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
          start = startDate;
          end = endDate;
        } else {
          // Use default range if dates are invalid
          start = safeFormat(subMonths(new Date(), 1), 'yyyy-MM-dd');
          end = safeFormat(new Date(), 'yyyy-MM-dd');
        }
      } else {
        try {
          const [year, month] = filterMonth.split('-');
          const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
          if (isValid(monthDate)) {
            start = safeFormat(startOfMonth(monthDate), 'yyyy-MM-dd');
            end = safeFormat(endOfMonth(monthDate), 'yyyy-MM-dd');
          } else {
            start = safeFormat(startOfMonth(new Date()), 'yyyy-MM-dd');
            end = safeFormat(endOfMonth(new Date()), 'yyyy-MM-dd');
          }
        } catch (error) {
          console.error('Error parsing filter month:', error);
          start = safeFormat(startOfMonth(new Date()), 'yyyy-MM-dd');
          end = safeFormat(endOfMonth(new Date()), 'yyyy-MM-dd');
        }
      }
      
      // Only proceed if we have valid dates
      if (start && end) {
        const days = await getDoubleTimeDays(start, end);
        setDoubleDays(days);
        
        // Reload employee data if expanded
        if (expandedEmployee) {
          setDailyRecordsLoading(true);
          let dateFilter = "";
          
          if (filterMonth === "custom") {
            if (startDate && endDate && isValid(parseISO(startDate)) && isValid(parseISO(endDate))) {
              dateFilter = `${startDate}|${endDate}`;
            } else {
              // Use default range if dates are invalid
              const defaultStart = safeFormat(subMonths(new Date(), 1), 'yyyy-MM-dd');
              const defaultEnd = safeFormat(new Date(), 'yyyy-MM-dd');
              dateFilter = `${defaultStart}|${defaultEnd}`;
            }
          } else if (filterMonth !== "all") {
            dateFilter = filterMonth;
          }
          
          const { data: records } = await fetchEmployeeDetails(
            expandedEmployee, 
            dateFilter
          );
          setDailyRecords(records);
          setDailyRecordsLoading(false);
        }
        
        toast.success('Double-time days updated successfully');
      }
    } catch (error) {
      console.error('Error refreshing data after calendar update:', error);
      toast.error('Failed to refresh data');
    }
  };

  // Handle employee filter change
  const handleEmployeeFilterChange = (employeeId: string) => {
    setFilterEmployee(employeeId);
    setExpandedEmployee(null);
    setDailyRecords([]);
    setSelectedEmployees([]);
    
    // If a specific employee is selected, preemptively expand their details
    if (employeeId !== "all") {
      setTimeout(() => {
        handleEmployeeExpand(employeeId);
      }, 100);
    }
  };
  
  // Handle multiple employee selection
  const handleEmployeeSelectionChange = (employeeId: string, isSelected: boolean) => {
    if (isSelected) {
      setSelectedEmployees(prev => [...prev, employeeId]);
    } else {
      setSelectedEmployees(prev => prev.filter(id => id !== employeeId));
    }
    
    // Reset single employee filter when using multi-select
    if (filterEmployee !== "all") {
      setFilterEmployee("all");
    }
    
    // Reset expanded employee
    setExpandedEmployee(null);
    setDailyRecords([]);
  };
  
  // Select/deselect all employees
  const handleSelectAllEmployees = () => {
    if (selectedEmployees.length === allEmployees.length) {
      // Deselect all
      setSelectedEmployees([]);
    } else {
      // Select all
      setSelectedEmployees(allEmployees.map(emp => emp.id));
    }
    
    // Reset expanded employee
    setExpandedEmployee(null);
    setDailyRecords([]);
  };
  
  // Clear all employee selections
  const handleClearEmployeeSelection = () => {
    setSelectedEmployees([]);
    setExpandedEmployee(null);
    setDailyRecords([]);
  };
  
  // Handle date range picker toggle
  const handleDateRangePickerToggle = () => {
    setShowDateRangePicker(!showDateRangePicker);
    if (!showDateRangePicker && filterMonth !== "custom") {
      setFilterMonth("custom");
    }
  };
  
  // Handle date range selection
  const handleDateRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setShowDateRangePicker(false); // Close the picker after selection
    setFilterMonth("custom"); // Set to custom filter mode
  };
  
  // Navigate to previous/next month in date picker
  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prevMonth => {
      const newMonth = new Date(prevMonth);
      if (direction === 'prev') {
        newMonth.setMonth(newMonth.getMonth() - 1);
      } else {
        newMonth.setMonth(newMonth.getMonth() + 1);
      }
      return newMonth;
    });
  };
  
  // Handle date selection in calendar
  const handleDateSelect = (dateStr: string) => {
    // If start date is not set or both dates are set, reset and set start date
    if (!startDate || (startDate && endDate)) {
      setStartDate(dateStr);
      setEndDate('');
    } 
    // If start date is set but end date is not, set end date
    else if (startDate && !endDate) {
      // Ensure end date is not before start date
      if (dateStr < startDate) {
        setEndDate(startDate);
        setStartDate(dateStr);
      } else {
        setEndDate(dateStr);
      }
    }
  };

  // Handle logout
  const handleLogout = () => {
    logout();
    navigate('/hr-login', { replace: true });
  };
  
  // Generate calendar days for the current month
  const renderCalendarDays = () => {
    const daysInMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth() + 1,
      0
    ).getDate();
    
    const firstDayOfMonth = new Date(
      currentMonth.getFullYear(),
      currentMonth.getMonth(),
      1
    ).getDay();
    
    const days = [];
    
    // Add empty cells for days before the start of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(<div key={`empty-${i}`} className="h-8 w-8"></div>);
    }
    
    // Add the days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      const dateObj = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
      if (!isValid(dateObj)) continue; // Skip invalid dates
      
      const dateStr = safeFormat(dateObj, 'yyyy-MM-dd');
      
      const isStartDate = dateStr === startDate;
      const isEndDate = dateStr === endDate;
      const isInRange = startDate && endDate && dateStr >= startDate && dateStr <= endDate;
      
      days.push(
        <div
          key={dateStr}
          onClick={() => handleDateSelect(dateStr)}
          className={`h-8 w-8 flex items-center justify-center rounded-full cursor-pointer text-sm
            ${isStartDate || isEndDate ? 'bg-purple-600 text-white' : ''}
            ${isInRange && !isStartDate && !isEndDate ? 'bg-purple-100 text-purple-800' : ''}
            ${!isStartDate && !isEndDate && !isInRange ? 'hover:bg-gray-100' : ''}
          `}
        >
          {i}
        </div>
      );
    }
    
    return days;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation tabs */}
      <NavigationTabs />

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100">
          {/* Card header */}
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center">
                <Clock className="w-5 h-5 text-purple-600 mr-2" />
                <h1 className="text-lg font-medium text-gray-800">
                  Approved Hours
                </h1>
                {username && (
                  <span className="ml-2 text-sm text-gray-600">
                    (Logged in as: {username})
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => navigate('/')}
                  className="flex items-center text-gray-600 hover:text-gray-800"
                >
                  <Home className="w-4 h-4 mr-1" />
                  Back to Home
                </button>
                <button
                  onClick={() => navigate('/hr')}
                  className="flex items-center text-purple-600 hover:text-purple-800"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  Back to Face ID Data
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center text-red-600 hover:text-red-800"
                >
                  <LogOut className="w-4 h-4 mr-1" />
                  Logout
                </button>
              </div>
            </div>
          </div>

          {/* Card content */}
          <div className="p-6 space-y-6">
            {/* Filters & Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Summary stats */}
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-md">
                  <Users className="w-5 h-5 text-purple-600" />
                  <div>
                    <div className="text-xs text-purple-600 font-medium">Employees</div>
                    <div className="text-lg font-bold text-purple-900">{totalEmployees}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-md">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <div>
                    <div className="text-xs text-blue-600 font-medium">Regular Hours</div>
                    <div className="text-lg font-bold text-blue-900">{totalHours.toFixed(2)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-md">
                  <Calendar2 className="w-5 h-5 text-amber-600" />
                  <div>
                    <div className="text-xs text-amber-600 font-medium">Double-Time Hours</div>
                    <div className="text-lg font-bold text-amber-900">{totalDoubleTimeHours.toFixed(2)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-md">
                  <Clock className="w-5 h-5 text-green-600" />
                  <div>
                    <div className="text-xs text-green-600 font-medium">Total Hours</div>
                    <div className="text-lg font-bold text-green-900">{(totalHours + totalDoubleTimeHours).toFixed(2)}</div>
                  </div>
                </div>
              </div>

              {/* Filter and Export */}
              <div className="flex gap-2 flex-wrap">
                {/* Date Range Filter */}
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <div className="relative">
                    <select
                      value={filterMonth}
                      onChange={(e) => {
                        setFilterMonth(e.target.value);
                        if (e.target.value === "custom") {
                          setShowDateRangePicker(true);
                        } else {
                          setShowDateRangePicker(false);
                        }
                      }}
                      className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    >
                      {monthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {/* Date Range Display */}
                {filterMonth === "custom" && (
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={handleDateRangePickerToggle}
                      className="flex items-center gap-1 px-3 py-1 border border-gray-300 rounded text-sm"
                    >
                      <span>{startDate && parseISO(startDate) && isValid(parseISO(startDate)) ? safeFormat(parseISO(startDate), 'MMM d, yyyy') : 'Start date'}</span>
                      <span>to</span>
                      <span>{endDate && parseISO(endDate) && isValid(parseISO(endDate)) ? safeFormat(parseISO(endDate), 'MMM d, yyyy') : 'End date'}</span>
                      <Calendar className="w-4 h-4 ml-1" />
                    </button>
                  </div>
                )}
                
                {/* Employee Filter */}
                <MultiEmployeeFilter 
                  employees={allEmployees}
                  selectedEmployees={selectedEmployees}
                  onChange={handleEmployeeSelectionChange}
                  onSelectAll={handleSelectAllEmployees}
                  onClear={handleClearEmployeeSelection}
                />
                
                <button
                  onClick={handleCalendarToggle}
                  className={`flex items-center gap-1 px-3 py-1 ${
                    showCalendar 
                      ? 'bg-amber-600 hover:bg-amber-700 text-white' 
                      : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                  } text-sm rounded`}
                >
                  <Calendar className="w-4 h-4" />
                  {showCalendar ? 'Hide Calendar' : 'Manage Holidays'}
                </button>
                
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
                
                {/* Delete Button */}
                <button
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                  disabled={isLoading || totalEmployees === 0}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Records
                </button>
              </div>
            </div>
            
            {/* Date Range Picker */}
            {showDateRangePicker && (
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-sm font-medium flex items-center text-gray-700">
                    <Calendar className="w-4 h-4 mr-2 text-purple-500" />
                    Select Date Range
                  </h3>
                  <button 
                    onClick={() => setShowDateRangePicker(false)}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <DateRangePicker 
                  onSelect={handleDateRangeChange} 
                  initialStartDate={startDate} 
                  initialEndDate={endDate} 
                />
              </div>
            )}

            {/* Holiday Calendar (conditionally displayed) */}
            {showCalendar && (
              <div className="mb-6">
                <HolidayCalendar onHolidaysUpdated={handleHolidaysUpdated} />
              </div>
            )}

            {/* Employee Hours List */}
            {isLoading ? (
              <div className="py-20 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                <p className="text-gray-500">Loading approved hours data...</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-md overflow-hidden">
                {/* Table Header */}
                <div className="grid grid-cols-6 gap-2 bg-gray-50 p-4 text-sm font-medium text-gray-600">
                  <div className="col-span-2">Employee</div>
                  <div>Total Days</div>
                  <div>Total Hours</div>
                  <div>Avg Hours/Day</div>
                  <div>Actions</div>
                </div>

                {/* Employee List */}
                {employees.length === 0 ? (
                  <div className="p-8 text-center">
                    <Calendar className="w-10 h-10 mx-auto text-gray-300 mb-2" />
                    <h3 className="text-gray-500 font-medium">No approved hours found</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      {selectedEmployees.length > 0 || filterEmployee !== "all" 
                        ? "No records found for the selected employee(s) and time period."
                        : "Try selecting a different date range or approve time records from the Face ID data page."}
                    </p>
                    <button
                      onClick={() => navigate('/hr')}
                      className="mt-4 px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
                    >
                      Go to Face ID Data
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {employees.map((employee) => (
                      <React.Fragment key={employee.id}>
                        <EmployeeHoursSummary 
                          employee={employee} 
                          isExpanded={expandedEmployee === employee.id}
                          onExpand={() => handleEmployeeExpand(employee.id)}
                        />
                        
                        {/* Employee Detail Card */}
                        {expandedEmployee === employee.id && (
                          <>
                            <EmployeeDetailCard 
                              employee={employee}
                              doubleDays={doubleDays}
                            />
                            
                            {/* Daily Records */}
                            <DailyBreakdown 
                              isLoading={dailyRecordsLoading}
                              records={dailyRecords}
                              doubleDays={doubleDays}
                            />
                          </>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDeleteAllRecords}
        title={
          selectedEmployees.length > 0 
            ? `Delete Records for ${selectedEmployees.length} Selected Employee${selectedEmployees.length !== 1 ? 's' : ''}`
            : filterMonth === "custom" 
              ? `Delete Records for Selected Date Range` 
              : filterMonth === "all" 
                ? "Delete All Time Records" 
                : `Delete Records for ${monthOptions.find(m => m.value === filterMonth)?.label}`
        }
        message={
          selectedEmployees.length > 0 
            ? `You are about to delete all time records for ${selectedEmployees.length} selected employee${selectedEmployees.length !== 1 ? 's' : ''}${
                filterMonth === "custom" 
                  ? ` from ${startDate && parseISO(startDate) && isValid(parseISO(startDate)) ? safeFormat(parseISO(startDate), 'MMMM d, yyyy') : 'start date'} to ${endDate && parseISO(endDate) && isValid(parseISO(endDate)) ? safeFormat(parseISO(endDate), 'MMMM d, yyyy') : 'end date'}` 
                  : filterMonth !== "all" 
                    ? ` for ${monthOptions.find(m => m.value === filterMonth)?.label}` 
                    : ''
              }. This action cannot be undone.`
            : filterMonth === "custom"
              ? `You are about to delete all time records from ${startDate && parseISO(startDate) && isValid(parseISO(startDate)) ? safeFormat(parseISO(startDate), 'MMMM d, yyyy') : 'start date'} to ${endDate && parseISO(endDate) && isValid(parseISO(endDate)) ? safeFormat(parseISO(endDate), 'MMMM d, yyyy') : 'end date'}. This action cannot be undone.`
              : filterMonth === "all"
                ? "You are about to delete ALL time records for ALL employees from the database. This will reset the entire system and cannot be undone."
                : `You are about to delete all time records for ${monthOptions.find(m => m.value === filterMonth)?.label}. This action cannot be undone.`
        }
        isDeleting={isDeleting}
        deleteButtonText={
          selectedEmployees.length > 0 
            ? `Delete Records for ${selectedEmployees.length} Employee${selectedEmployees.length !== 1 ? 's' : ''}`
            : filterMonth === "custom" 
              ? "Delete Date Range Records" 
              : filterMonth === "all" 
                ? "Delete All Records" 
                : "Delete Month Records"
        }
        scope={filterMonth === "all" ? "all" : "month"}
      />
      
      <Toaster position="top-right" />
    </div>
  );
};

export default ApprovedHoursPage;