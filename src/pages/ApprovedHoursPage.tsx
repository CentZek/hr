import React, { useState, useEffect, useMemo } from 'react';
import { format, parse, subMonths, isSameDay, startOfMonth, endOfMonth, parseISO, isWithinInterval, isValid } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Clock, ArrowLeft, Download, Users, Calendar, Filter, Trash2, Home, Calendar as Calendar2, User, CheckSquare, X } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApprovedHours, fetchEmployeeDetails, deleteAllTimeRecords } from '../services/database';
import { exportApprovedHoursToExcel } from '../utils/excelHandlers';
import { fetchHolidays, getDoubleTimeDays } from '../services/holidayService';
import EmployeeHoursSummary from '../components/ApprovedHours/EmployeeHoursSummary';
import DailyBreakdown from '../components/ApprovedHours/DailyBreakdown';
import DeleteConfirmDialog from '../components/DeleteConfirmDialog';
import NavigationTabs from '../components/NavigationTabs';
import HolidayCalendar from '../components/HolidayCalendar';
import DateRangePicker from '../components/ApprovedHours/DateRangePicker';
import MultiEmployeeFilter from '../components/ApprovedHours/MultiEmployeeFilter';

const ApprovedHoursPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [employees, setEmployees] = useState<any[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [dailyRecords, setDailyRecords] = useState<any[]>([]);
  
  // New date range filter state
  const [dateRange, setDateRange] = useState<{
    startDate: Date | null;
    endDate: Date | null;
  }>({
    startDate: startOfMonth(new Date()),
    endDate: endOfMonth(new Date())
  });
  
  // Switch to handle whether we're using the date range or the month filter
  const [useCustomDateRange, setUseCustomDateRange] = useState<boolean>(false);
  
  // Legacy month filter (kept for backward compatibility)
  const [filterMonth, setFilterMonth] = useState<string>("current");
  
  // New multi-employee selection
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [dailyRecordsLoading, setDailyRecordsLoading] = useState(false);
  const [totalHours, setTotalHours] = useState(0);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalDoubleTimeHours, setTotalDoubleTimeHours] = useState(0);
  const [totalPayableHours, setTotalPayableHours] = useState(0);
  const [doubleDays, setDoubleDays] = useState<string[]>([]);
  const [showCalendar, setShowCalendar] = useState(false);
  
  // Delete confirmation state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Selected report type
  const [reportType, setReportType] = useState<'summary' | 'detail'>('summary');
  
  // Track summary statistics for the report
  const [summaryStats, setSummaryStats] = useState({
    totalFridaysWorked: 0,
    totalHolidaysWorked: 0,
    totalOffDays: 0
  });

  // Generate month options for the dropdown - for legacy month selector
  const monthOptions = useMemo(() => [
    { value: "all", label: "All Time" },
    { value: "current", label: "Current Month" },
    ...Array.from({ length: 24 }).map((_, i) => {
      const date = subMonths(new Date(), i);
      return {
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM yyyy')
      };
    })
  ], []);

  // Helper to get date strings for query from the date range or month filter
  const getQueryDates = () => {
    if (useCustomDateRange && dateRange.startDate && dateRange.endDate) {
      return {
        startDate: format(dateRange.startDate, 'yyyy-MM-dd'),
        endDate: format(dateRange.endDate, 'yyyy-MM-dd')
      };
    } else {
      if (filterMonth === "all") {
        // For "all" time, use a large date range
        return {
          startDate: format(subMonths(new Date(), 36), 'yyyy-MM-dd'),
          endDate: format(new Date(new Date().getFullYear() + 1, 11, 31), 'yyyy-MM-dd')
        };
      } else if (filterMonth === "current") {
        // For current month
        return {
          startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
          endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd')
        };
      } else {
        // For specific month
        const [year, month] = filterMonth.split('-');
        const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        return {
          startDate: format(startOfMonth(monthDate), 'yyyy-MM-dd'),
          endDate: format(endOfMonth(monthDate), 'yyyy-MM-dd')
        };
      }
    }
  };

  // Fetch double-time days when date range changes
  useEffect(() => {
    const loadDoubleDays = async () => {
      try {
        const { startDate, endDate } = getQueryDates();
        const days = await getDoubleTimeDays(startDate, endDate);
        setDoubleDays(days);
      } catch (error) {
        console.error('Error loading double-time days:', error);
      }
    };
    
    loadDoubleDays();
  }, [dateRange, filterMonth, useCustomDateRange]);

  // Fetch all approved hours summary
  useEffect(() => {
    const loadApprovedHours = async () => {
      setIsLoading(true);
      try {
        const { startDate, endDate } = getQueryDates();
        
        const { data, totalHoursSum } = await fetchApprovedHours(
          startDate, endDate
        );
        
        setAllEmployees(data); // Store all employees
        
        // Filter employees if specific employees are selected
        if (selectedEmployeeIds.length > 0) {
          const filteredData = data.filter((emp) => selectedEmployeeIds.includes(emp.id));
          setEmployees(filteredData);
        } else {
          setEmployees(data);
        }
        
        setTotalEmployees(selectedEmployeeIds.length > 0 ? selectedEmployeeIds.length : data.length);
        
        // Calculate total regular hours and total double-time hours
        let regularHours = 0;
        let doubleTimeHours = 0;
        let totalFridaysWorked = 0;
        let totalHolidaysWorked = 0;
        let totalOffDays = 0;
        
        // Process each employee's data to calculate double-time hours
        // Only count selected employees or all if none selected
        const employeesToProcess = selectedEmployeeIds.length > 0 
          ? data.filter(emp => selectedEmployeeIds.includes(emp.id))
          : data;
        
        employeesToProcess.forEach(employee => {
          let employeeDoubleTime = 0;
          let employeeRegularTime = 0;
          
          // Track statistics
          totalFridaysWorked += employee.fridays_worked || 0;
          totalHolidaysWorked += employee.holidays_worked || 0;
          totalOffDays += employee.off_days || 0;
          
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
        
        // Update summary statistics for the report
        setSummaryStats({
          totalFridaysWorked,
          totalHolidaysWorked,
          totalOffDays
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
  }, [filterMonth, doubleDays, selectedEmployeeIds, dateRange, useCustomDateRange]);

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
      const { startDate, endDate } = getQueryDates();
      
      const { data: records } = await fetchEmployeeDetails(
        employeeId, startDate, endDate
      );
      setDailyRecords(records);
    } catch (error) {
      console.error('Error loading employee details:', error);
      toast.error('Failed to load employee details');
    } finally {
      setDailyRecordsLoading(false);
    }
  };

  const handleExport = () => {
    // Prepare data for export based on selected employees and date range
    const selectedEmployees = selectedEmployeeIds.length > 0
      ? employees.filter(emp => selectedEmployeeIds.includes(emp.id))
      : employees;
    
    // For each selected employee, include their daily records if expanded
    const detailedEmployees = selectedEmployees.map(employee => {
      if (employee.id === expandedEmployee) {
        return {
          ...employee,
          detailedRecords: dailyRecords
        };
      }
      return employee;
    });
    
    // Prepare export data with date range information
    const { startDate, endDate } = getQueryDates();
    const exportData = {
      summary: detailedEmployees,
      details: expandedEmployee ? dailyRecords : [],
      dateRange: {
        startDate,
        endDate
      },
      reportType,
      doubleDays, // Include double-time days for export calculations
      summaryStats // Include summary statistics
    };
    
    exportApprovedHoursToExcel(exportData);
    toast.success('Data exported successfully');
  };
  
  // Handle delete all records
  const handleDeleteAllRecords = async () => {
    setIsDeleting(true);
    
    const { startDate, endDate } = getQueryDates();
    const dateRangeLabel = useCustomDateRange 
      ? `${format(dateRange.startDate!, 'MMM d, yyyy')} to ${format(dateRange.endDate!, 'MMM d, yyyy')}`
      : (filterMonth === "all" 
          ? 'all time' 
          : filterMonth === "current"
            ? 'current month'
            : monthOptions.find(m => m.value === filterMonth)?.label || filterMonth);
    
    const loadingToast = toast.loading(`Deleting time records for ${dateRangeLabel}...`);
    
    try {
      // Perform the delete operation with date range
      const { success, message, count } = await deleteAllTimeRecords(startDate, endDate);
      
      toast.dismiss(loadingToast);
      if (success) {
        toast.success(`Successfully deleted time records for ${dateRangeLabel} (${count} entries)`);
        
        // Refresh the data
        const { data, totalHoursSum } = await fetchApprovedHours(startDate, endDate);
        setAllEmployees(data || []);
        setEmployees(data || []);
        setTotalHours(totalHoursSum || 0);
        setTotalEmployees(data?.length || 0);
        setDailyRecords([]);
        setExpandedEmployee(null);
        
        // Reset summary stats
        setSummaryStats({
          totalFridaysWorked: 0,
          totalHolidaysWorked: 0,
          totalOffDays: 0
        });
      } else {
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
      const { startDate, endDate } = getQueryDates();
      const days = await getDoubleTimeDays(startDate, endDate);
      setDoubleDays(days);
      
      // Reload employee data if expanded
      if (expandedEmployee) {
        setDailyRecordsLoading(true);
        const { data: records } = await fetchEmployeeDetails(
          expandedEmployee, startDate, endDate
        );
        setDailyRecords(records);
        setDailyRecordsLoading(false);
      }
      
      toast.success('Double-time days updated successfully');
    } catch (error) {
      console.error('Error refreshing data after calendar update:', error);
      toast.error('Failed to refresh data');
    }
  };

  // Handle date range change
  const handleDateRangeChange = (range: { startDate: Date | null, endDate: Date | null }) => {
    setDateRange(range);
    setUseCustomDateRange(true); // Switch to using custom date range
    setExpandedEmployee(null); // Reset expanded employee when changing date range
    setDailyRecords([]);
  };

  // Handle switching between date range and month filter
  const handleFilterTypeChange = (useRange: boolean) => {
    setUseCustomDateRange(useRange);
    // Reset expanded employee
    setExpandedEmployee(null);
    setDailyRecords([]);
  };

  // Handle month filter change (legacy)
  const handleMonthFilterChange = (month: string) => {
    setFilterMonth(month);
    setUseCustomDateRange(false); // Switch to using month filter
    setExpandedEmployee(null); // Reset expanded employee
    setDailyRecords([]);
  };

  // Handle employee filter change
  const handleEmployeeSelectionChange = (employeeIds: string[]) => {
    setSelectedEmployeeIds(employeeIds);
    setExpandedEmployee(null);
    setDailyRecords([]);
  };

  // Format date for display
  const formatDateRangeForDisplay = () => {
    if (useCustomDateRange) {
      if (dateRange.startDate && dateRange.endDate) {
        return `${format(dateRange.startDate, 'MMM d, yyyy')} - ${format(dateRange.endDate, 'MMM d, yyyy')}`;
      }
      return 'Invalid Date Range';
    } else {
      if (filterMonth === "all") return "All Time";
      if (filterMonth === "current") return format(new Date(), 'MMMM yyyy');
      
      const option = monthOptions.find(m => m.value === filterMonth);
      return option ? option.label : 'Unknown';
    }
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
              </div>
            </div>
          </div>

          {/* Card content */}
          <div className="p-6 space-y-6">
            {/* Summary stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                  <div className="text-lg font-bold text-green-900">{totalPayableHours.toFixed(2)}</div>
                </div>
              </div>
            </div>
            
            {/* Additional summary stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 rounded-md">
                <Calendar className="w-5 h-5 text-indigo-600" />
                <div>
                  <div className="text-xs text-indigo-600 font-medium">Fridays Worked</div>
                  <div className="text-lg font-bold text-indigo-900">{summaryStats.totalFridaysWorked}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 rounded-md">
                <Calendar2 className="w-5 h-5 text-rose-600" />
                <div>
                  <div className="text-xs text-rose-600 font-medium">Holidays Worked</div>
                  <div className="text-lg font-bold text-rose-900">{summaryStats.totalHolidaysWorked}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-md">
                <Calendar className="w-5 h-5 text-gray-600" />
                <div>
                  <div className="text-xs text-gray-600 font-medium">OFF-Days</div>
                  <div className="text-lg font-bold text-gray-900">{summaryStats.totalOffDays}</div>
                </div>
              </div>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Left column - Filters */}
              <div className="lg:col-span-7 space-y-4">
                {/* Filter type toggle */}
                <div className="flex">
                  <button
                    onClick={() => handleFilterTypeChange(false)}
                    className={`px-3 py-1 text-sm ${!useCustomDateRange ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'} rounded-l-md`}
                  >
                    Month
                  </button>
                  <button
                    onClick={() => handleFilterTypeChange(true)}
                    className={`px-3 py-1 text-sm ${useCustomDateRange ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'} rounded-r-md`}
                  >
                    Custom Date Range
                  </button>
                </div>
                
                {useCustomDateRange ? (
                  <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                    <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
                      <Calendar className="w-4 h-4 mr-2 text-purple-500" />
                      Select Date Range
                    </h3>
                    <DateRangePicker 
                      startDate={dateRange.startDate} 
                      endDate={dateRange.endDate} 
                      onChange={handleDateRangeChange}
                    />
                    <div className="mt-2 text-xs text-gray-500">
                      Current selection: {formatDateRangeForDisplay()}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col space-y-2">
                    <label className="text-sm font-medium text-gray-700 flex items-center">
                      <Calendar className="w-4 h-4 mr-2 text-purple-500" />
                      Select Month
                    </label>
                    <select
                      value={filterMonth}
                      onChange={(e) => handleMonthFilterChange(e.target.value)}
                      className="border border-gray-300 rounded-md px-3 py-2 focus:ring-purple-500 focus:border-purple-500"
                    >
                      {monthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                
                {/* Employee Selection */}
                <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
                    <Users className="w-4 h-4 mr-2 text-purple-500" />
                    Select Employees
                  </h3>
                  <MultiEmployeeFilter 
                    employees={allEmployees}
                    selectedEmployeeIds={selectedEmployeeIds}
                    onChange={handleEmployeeSelectionChange}
                  />
                  <div className="mt-2 text-xs text-gray-500">
                    {selectedEmployeeIds.length === 0 
                      ? "All employees selected" 
                      : `${selectedEmployeeIds.length} employee(s) selected`}
                  </div>
                </div>
              </div>
              
              {/* Right column - Actions */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
                  <h3 className="text-sm font-medium text-gray-700 mb-3">Report Actions</h3>
                  <div className="flex flex-col space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-700">Report Type:</label>
                      <div className="flex">
                        <button
                          onClick={() => setReportType('summary')}
                          className={`px-3 py-1 text-sm ${reportType === 'summary' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'} rounded-l-md`}
                        >
                          Summary
                        </button>
                        <button
                          onClick={() => setReportType('detail')}
                          className={`px-3 py-1 text-sm ${reportType === 'detail' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700'} rounded-r-md`}
                        >
                          Detailed
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={handleCalendarToggle}
                        className={`flex justify-center items-center gap-1 px-3 py-2 ${
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
                        className="flex justify-center items-center gap-1 px-3 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
                        disabled={isLoading || totalEmployees === 0}
                      >
                        <Download className="w-4 h-4" />
                        Export Report
                      </button>
                      
                      <button
                        onClick={() => setIsDeleteDialogOpen(true)}
                        className="col-span-2 flex justify-center items-center gap-1 px-3 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                        disabled={isLoading || totalEmployees === 0}
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Records for this Period
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Date Range Display */}
                <div className="bg-blue-50 p-4 rounded-md border border-blue-100">
                  <h3 className="text-sm font-medium text-blue-700 flex items-center mb-2">
                    <Calendar className="w-4 h-4 mr-2" />
                    Current Selection
                  </h3>
                  <div className="flex items-center justify-between">
                    <span className="text-blue-800 font-medium">{formatDateRangeForDisplay()}</span>
                    {selectedEmployeeIds.length > 0 && (
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                        {selectedEmployeeIds.length} employee(s)
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Statistics Box */}
                <div className="bg-indigo-50 p-4 rounded-md border border-indigo-100">
                  <h3 className="text-sm font-medium text-indigo-700 flex items-center mb-2">
                    <CheckSquare className="w-4 h-4 mr-2" />
                    Statistics
                  </h3>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="flex flex-col">
                      <span className="text-indigo-500">Fridays</span>
                      <span className="font-medium text-indigo-800">{summaryStats.totalFridaysWorked} days</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-indigo-500">Holidays</span>
                      <span className="font-medium text-indigo-800">{summaryStats.totalHolidaysWorked} days</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-indigo-500">OFF-Days</span>
                      <span className="font-medium text-indigo-800">{summaryStats.totalOffDays} days</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
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
                  <div>Working Days</div>
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
                      {selectedEmployeeIds.length > 0 
                        ? "No records found for the selected employees and time period."
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
                          employee={{
                            ...employee,
                            // Add working_days property that only counts non-zero, non-OFF-DAY days
                            working_days: employee.working_days || 
                              (employee.total_days - (employee.off_days || 0))
                          }}
                          isExpanded={expandedEmployee === employee.id}
                          onExpand={() => handleEmployeeExpand(employee.id)}
                        />
                        
                        {/* Daily Records */}
                        {expandedEmployee === employee.id && (
                          <DailyBreakdown 
                            isLoading={dailyRecordsLoading}
                            records={dailyRecords}
                            doubleDays={doubleDays}
                          />
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
        title={`Delete Records for ${formatDateRangeForDisplay()}`}
        message={
          `You are about to delete all time records for ${formatDateRangeForDisplay()}. 
          This action cannot be undone. All approved hours data within this period will be permanently removed from the database.`
        }
        isDeleting={isDeleting}
        deleteButtonText={`Delete Records for this Period`}
        scope={"custom"}
      />
      
      <Toaster position="top-right" />
    </div>
  );
};

export default ApprovedHoursPage;