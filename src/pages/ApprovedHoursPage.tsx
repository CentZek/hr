import React, { useState, useEffect } from 'react';
import { format, subMonths, isSameDay, startOfMonth, endOfMonth } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Clock, ArrowLeft, Download, Users, Calendar, Filter, Trash2, Home, Calendar as Calendar2, User } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';
import { fetchApprovedHours, fetchEmployeeDetails, deleteAllTimeRecords } from '../services/database';
import { exportApprovedHoursToExcel } from '../utils/excelHandlers';
import { fetchHolidays, getDoubleTimeDays } from '../services/holidayService';
import EmployeeHoursSummary from '../components/ApprovedHours/EmployeeHoursSummary';
import DailyBreakdown from '../components/ApprovedHours/DailyBreakdown';
import DeleteConfirmDialog from '../components/DeleteConfirmDialog';
import NavigationTabs from '../components/NavigationTabs';
import HolidayCalendar from '../components/HolidayCalendar';

const ApprovedHoursPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [employees, setEmployees] = useState<any[]>([]);
  const [allEmployees, setAllEmployees] = useState<any[]>([]);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);
  const [dailyRecords, setDailyRecords] = useState<any[]>([]);
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterEmployee, setFilterEmployee] = useState<string>("all");
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

  // Generate month options for the dropdown
  const monthOptions = [
    { value: "all", label: "All Time" },
    ...Array.from({ length: 12 }).map((_, i) => {
      const date = subMonths(new Date(), i);
      return {
        value: format(date, 'yyyy-MM'),
        label: format(date, 'MMMM yyyy')
      };
    })
  ];

  // Fetch double-time days once and when month changes
  useEffect(() => {
    const loadDoubleDays = async () => {
      try {
        let startDate, endDate;
        
        if (filterMonth === "all") {
          // Use a large date range for "all time" (past year to future year)
          startDate = format(subMonths(new Date(), 12), 'yyyy-MM-dd');
          endDate = format(new Date(new Date().getFullYear() + 1, 11, 31), 'yyyy-MM-dd');
        } else {
          // Use the selected month
          const [year, month] = filterMonth.split('-');
          const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
          startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
          endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
        }
        
        const days = await getDoubleTimeDays(startDate, endDate);
        setDoubleDays(days);
      } catch (error) {
        console.error('Error loading double-time days:', error);
      }
    };
    
    loadDoubleDays();
  }, [filterMonth]);

  // Fetch all approved hours summary
  useEffect(() => {
    const loadApprovedHours = async () => {
      setIsLoading(true);
      try {
        const { data, totalHoursSum } = await fetchApprovedHours(filterMonth === "all" ? "" : filterMonth);
        setAllEmployees(data); // Store all employees
        
        // Filter employees if a specific employee is selected
        if (filterEmployee !== "all") {
          const filteredData = data.filter((emp) => emp.id === filterEmployee);
          setEmployees(filteredData);
        } else {
          setEmployees(data);
        }
        
        setTotalEmployees(data.length);
        
        // Calculate total regular hours and total double-time hours
        let regularHours = 0;
        let doubleTimeHours = 0;
        
        // Process each employee's data to calculate double-time hours
        data.forEach(employee => {
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
        
        // If filtering by employee, only count their hours
        if (filterEmployee !== "all") {
          const selectedEmployee = data.find(emp => emp.id === filterEmployee);
          if (selectedEmployee) {
            regularHours = selectedEmployee.total_hours || 0;
            doubleTimeHours = selectedEmployee.double_time_hours || 0;
          }
        }
        
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
  }, [filterMonth, doubleDays, filterEmployee]);

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
      const { data: records } = await fetchEmployeeDetails(employeeId, filterMonth === "all" ? "" : filterMonth);
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
      doubleDays // Include double-time days for export calculations
    };
    
    exportApprovedHoursToExcel(exportData);
    toast.success('Data exported successfully');
  };
  
  // Handle delete all records
  const handleDeleteAllRecords = async () => {
    setIsDeleting(true);
    const loadingToast = toast.loading(
      filterMonth === "all" 
        ? 'Deleting all time records...' 
        : `Deleting time records for ${monthOptions.find(m => m.value === filterMonth)?.label}...`
    );
    
    try {
      // Perform the delete operation
      const { success, message, count } = await deleteAllTimeRecords(filterMonth === "all" ? "" : filterMonth);
      
      toast.dismiss(loadingToast);
      if (success) {
        // Show appropriate success message
        if (filterMonth === "all") {
          toast.success(`Successfully deleted all time records (${count} entries)`);
        } else {
          const monthLabel = monthOptions.find(m => m.value === filterMonth)?.label || filterMonth;
          toast.success(`Successfully deleted time records for ${monthLabel} (${count} entries)`);
        }
        
        // Refresh the data
        const { data, totalHoursSum } = await fetchApprovedHours(filterMonth === "all" ? "" : filterMonth);
        setAllEmployees(data || []);
        setEmployees(data || []);
        setTotalHours(totalHoursSum || 0);
        setTotalEmployees(data?.length || 0);
        setDailyRecords([]);
        setExpandedEmployee(null);
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
      let startDate, endDate;
      
      if (filterMonth === "all") {
        startDate = format(subMonths(new Date(), 12), 'yyyy-MM-dd');
        endDate = format(new Date(new Date().getFullYear() + 1, 11, 31), 'yyyy-MM-dd');
      } else {
        const [year, month] = filterMonth.split('-');
        const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        startDate = format(startOfMonth(monthDate), 'yyyy-MM-dd');
        endDate = format(endOfMonth(monthDate), 'yyyy-MM-dd');
      }
      
      const days = await getDoubleTimeDays(startDate, endDate);
      setDoubleDays(days);
      
      // Reload employee data if expanded
      if (expandedEmployee) {
        setDailyRecordsLoading(true);
        const { data: records } = await fetchEmployeeDetails(
          expandedEmployee, 
          filterMonth === "all" ? "" : filterMonth
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

  // Handle employee filter change
  const handleEmployeeFilterChange = (employeeId: string) => {
    setFilterEmployee(employeeId);
    setExpandedEmployee(null);
    setDailyRecords([]);
    
    // If a specific employee is selected, preemptively expand their details
    if (employeeId !== "all") {
      setTimeout(() => {
        handleEmployeeExpand(employeeId);
      }, 100);
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
                {/* Employee Filter */}
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gray-500" />
                  <select
                    value={filterEmployee}
                    onChange={(e) => handleEmployeeFilterChange(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="all">All Employees</option>
                    {allEmployees
                      .sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically
                      .map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                  </select>
                </div>
                
                {/* Month Filter */}
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <select
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    {monthOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                
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
                      {filterEmployee !== "all" 
                        ? "No records found for the selected employee and time period."
                        : "Try selecting a different month or approve time records from the Face ID data page."}
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
        title={filterMonth === "all" ? "Delete All Time Records" : `Delete Records for ${monthOptions.find(m => m.value === filterMonth)?.label}`}
        message={
          filterMonth === "all"
            ? "You are about to delete ALL time records for ALL employees from the database. This will reset the entire system and cannot be undone."
            : `You are about to delete all time records for ${monthOptions.find(m => m.value === filterMonth)?.label}. This action cannot be undone.`
        }
        isDeleting={isDeleting}
        deleteButtonText={filterMonth === "all" ? "Delete All Records" : "Delete Month Records"}
        scope={filterMonth === "all" ? "all" : "month"}
      />
      
      <Toaster position="top-right" />
    </div>
  );
};

export default ApprovedHoursPage;