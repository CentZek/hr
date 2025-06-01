import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Clock, AlertCircle, CheckCircle, Download, RefreshCw, PlusCircle, Database, KeyRound, Home, AlertTriangle, Calendar, X, LogOut } from 'lucide-react';
import toast, { Toaster } from 'react-hot-toast';

// Import types
import { EmployeeRecord, DailyRecord } from '../types';

// Import utility functions
import { handleExcelFile, exportToExcel } from '../utils/excelHandlers';
import { calculatePayableHours, determineShiftType } from '../utils/shiftCalculations';
import { addManualEntryToRecords, calculateStats, processRecordsAfterSave } from '../utils/dataHandlers';

// Import services
import { saveRecordsToDatabase, fetchPendingEmployeeShifts, resetAllDatabaseData } from '../services/database';
import { runAllMigrations, checkSupabaseConnection } from '../services/migrationService';
import { supabase } from '../lib/supabase';
import { checkAndRestoreHolidays } from '../services/holidayService';

// Import components
import NavigationTabs from '../components/NavigationTabs';
import EmployeeList from '../components/EmployeeList';
import EmptyState from '../components/EmptyState';
import ManualEntryModal from '../components/ManualEntryModal';
import UserCredentialsModal from '../components/UserCredentialsModal';
import EmployeeShiftRequest from '../components/EmployeeShiftRequest';
import ApproveAllConfirmationDialog from '../components/ApproveAllConfirmationDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import DateRangePicker from '../components/DateRangePicker';

// Import context
import { useAppContext } from '../context/AppContext';
import { useHrAuth } from '../context/HrAuthContext';

function HrPage() {
  const navigate = useNavigate();
  const { isAuthenticated, username, logout } = useHrAuth();
  
  const {
    employeeRecords, setEmployeeRecords,
    hasUploadedFile, setHasUploadedFile,
    currentFileName, setCurrentFileName,
    totalEmployees, setTotalEmployees,
    totalDays, setTotalDays,
    saveToSupabase, // Use the new Supabase functions
    clearData, // Updated clear data function
    isLoading: isContextLoading
  } = useAppContext();
  
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showApproved, setShowApproved] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [savingErrors, setSavingErrors] = useState<{employeeName: string, date: string, error: string}[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  
  // Date range state
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Modal states
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false);
  const [isUserCredentialsOpen, setIsUserCredentialsOpen] = useState(false);
  const [recentManualEntry, setRecentManualEntry] = useState<any>(null);
  
  // Approve All confirmation dialog state
  const [isApproveAllDialogOpen, setIsApproveAllDialogOpen] = useState(false);
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  
  // Reset confirmation dialog state
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Check if screen is mobile
  useEffect(() => {
    const checkIfMobile = () => {
      setIsMobile(window.innerWidth < 640);
    };
    
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    
    return () => {
      window.removeEventListener('resize', checkIfMobile);
    };
  }, []);

  // Check Supabase connection
  const checkConnection = async () => {
    const { connected, error } = await checkSupabaseConnection();
    if (!connected) {
      setConnectionError(error || 'Could not connect to Supabase');
      toast.error(`Database connection error: ${error || 'Unknown error'}`);
    } else {
      setConnectionError(null);
    }
    return connected;
  };

  // Run migrations when component mounts
  useEffect(() => {
    const initializeSystem = async () => {
      // First check connection
      const isConnected = await checkConnection();
      if (!isConnected) {
        return;
      }
      
      setIsMigrating(true);
      const migrationResult = await runAllMigrations();
      setIsMigrating(false);
      
      if (migrationResult.success) {
        if (migrationResult.counts.credentials > 0) {
          toast.success(`Created login credentials for ${migrationResult.counts.credentials} employees`);
        }
      } else {
        toast.error('Error initializing system. Some features may not work properly.');
      }
    };
    
    initializeSystem();
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Prevent file upload during reset operation
    if (isResetting) {
      toast.error('Please wait for the reset operation to complete');
      return;
    }
    
    const file = event.target.files?.[0];
    if (!file) {
      toast.error('No file selected');
      return;
    }

    setIsUploading(true);
    setHasUploadedFile(true);
    setCurrentFileName(file.name);
    const loadingToast = toast.loading('Processing file...');
    
    try {
      const records = await handleExcelFile(file);
      setEmployeeRecords(records);
      
      // Calculate statistics
      const stats = calculateStats(records);
      setTotalEmployees(stats.totalEmployees);
      setTotalDays(stats.totalDays);
      
      // Save to Supabase for persistence
      await saveToSupabase(file.name, records);
      
      toast.dismiss(loadingToast);
      toast.success('File processed successfully. Review and approve hours before saving.');
    } catch (error) {
      console.error('Error processing file:', error);
      toast.dismiss(loadingToast);
      toast.error(error instanceof Error ? error.message : 'Error processing file');
    } finally {
      setIsUploading(false);
      // Reset the file input
      event.target.value = '';
    }
  };

  const toggleEmployeeExpanded = (index: number) => {
    setEmployeeRecords(prev => {
      const newRecords = [...prev];
      newRecords[index] = {
        ...newRecords[index],
        expanded: !newRecords[index].expanded
      };
      return newRecords;
    });
  };

  const handleToggleApproveDay = (employeeIndex: number, dayIndex: number) => {
    setEmployeeRecords(prev => {
      const newRecords = [...prev];
      newRecords[employeeIndex].days[dayIndex].approved = !newRecords[employeeIndex].days[dayIndex].approved;
      return newRecords;
    });
  };

  const handleApplyPenalty = (employeeIndex: number, dayIndex: number, penaltyMinutes: number) => {
    console.log(`Applying penalty of ${penaltyMinutes} minutes to employee ${employeeIndex}, day ${dayIndex}`);
    
    setEmployeeRecords(prev => {
      const newRecords = [...prev];
      const day = newRecords[employeeIndex].days[dayIndex];
      
      // Update penalty minutes
      day.penaltyMinutes = penaltyMinutes;
      
      // Recalculate hours worked with the penalty applied
      if (day.firstCheckIn && day.lastCheckOut) {
        // Derive shift type if missing
        const shiftType = day.shiftType || determineShiftType(day.firstCheckIn);
        
        // Update the shift type if it was missing
        if (!day.shiftType) {
          day.shiftType = shiftType;
        }
        
        console.log(`Before recalculation, hours were: ${day.hoursWorked.toFixed(2)}`);
        
        // Calculate new hours with penalty applied
        day.hoursWorked = calculatePayableHours(
          day.firstCheckIn, 
          day.lastCheckOut, 
          shiftType, 
          penaltyMinutes,
          true // Mark as manual edit to use exact time calculation
        );
        
        console.log(`After recalculation with ${penaltyMinutes} minute penalty, hours are: ${day.hoursWorked.toFixed(2)}`);
      } else {
        console.log(`Missing check-in or check-out for this day, cannot recalculate hours`);
      }
      
      return newRecords;
    });
    
    toast.success(`Penalty applied: ${penaltyMinutes} minutes (${(penaltyMinutes / 60).toFixed(2)} hours)`);
  };

  const handleEditTime = (employeeIndex: number, dayIndex: number, checkIn: Date | null, checkOut: Date | null, shiftType: string | null, notes: string) => {
    setEmployeeRecords(prev => {
      const newRecords = [...prev];
      const day = newRecords[employeeIndex].days[dayIndex];
      
      // If notes is provided and it's not "OFF-DAY", it's a leave request
      const isLeaveRequest = notes && notes !== 'OFF-DAY';
      
      // If both check-in and check-out are null, mark as OFF-DAY or leave type
      if (checkIn === null && checkOut === null) {
        day.firstCheckIn = null;
        day.lastCheckOut = null;
        day.missingCheckIn = true;
        day.missingCheckOut = true;
        day.hoursWorked = 0;
        day.notes = notes || 'OFF-DAY';
        day.shiftType = isLeaveRequest ? null : 'off_day';
        day.isLate = false;
        day.earlyLeave = false;
        day.excessiveOvertime = false;
        day.penaltyMinutes = 0;
        
        return newRecords;
      }
      
      // Update check-in and check-out times
      if (checkIn !== null) {
        day.firstCheckIn = checkIn;
        day.missingCheckIn = false;
      }
      
      if (checkOut !== null) {
        day.lastCheckOut = checkOut;
        day.missingCheckOut = false;
      }
      
      // If changing from OFF-DAY or leave, we need to update the notes and determine shift type
      if (day.notes === 'OFF-DAY' || isLeaveRequest) {
        day.notes = 'Manual entry';
      }
      
      // Determine shift type if not already set
      if (!day.shiftType && day.firstCheckIn) {
        day.shiftType = determineShiftType(day.firstCheckIn);
      }
      
      // Recalculate hours and flags
      if (day.firstCheckIn && day.lastCheckOut) {
        const shiftType = day.shiftType || determineShiftType(day.firstCheckIn);
        
        // CRITICAL FIX: Always recalculate hours when either check-in or check-out changes
        day.hoursWorked = calculatePayableHours(
          day.firstCheckIn, 
          day.lastCheckOut, 
          shiftType,
          day.penaltyMinutes,
          true // Mark as manual edit to use exact time calculation
        );
        
        console.log(`Calculated ${day.hoursWorked.toFixed(2)} hours for edited time records with ${day.penaltyMinutes} minute penalty`);
      }
      
      return newRecords;
    });
    
    toast.success('Time records updated successfully');
  };

  const handleApproveAllForEmployee = (employeeIndex: number) => {
    setEmployeeRecords(prev => {
      const newRecords = [...prev];
      newRecords[employeeIndex].days = newRecords[employeeIndex].days.map(day => ({
        ...day,
        approved: true
      }));
      return newRecords;
    });
    toast.success(`All records approved for ${employeeRecords[employeeIndex].name}`);
  };

  const handleApproveAll = () => {
    setIsApprovingAll(true);
    
    // Apply approval to all records
    setEmployeeRecords(prev => 
      prev.map(employee => ({
        ...employee,
        days: employee.days.map(day => ({
          ...day,
          approved: true
        }))
      }))
    );
    
    setIsApprovingAll(false);
    setIsApproveAllDialogOpen(false);
    toast.success('All records approved');
  };

  const handleReset = () => {
    setIsResetConfirmOpen(true);
  };
  
  const confirmReset = async () => {
    setIsResetting(true);
    const loadingToast = toast.loading('Resetting database...');
    
    try {
      // Use the new resetAllDatabaseData function
      const result = await resetAllDatabaseData();
      
      // After reset is complete, check if holidays need to be restored
      await checkAndRestoreHolidays();
      
      if (result.success) {
        // Clear local state
        clearData();
        toast.dismiss(loadingToast);
        toast.success(`${result.message} Double-time days have been preserved.`);
      } else {
        toast.dismiss(loadingToast);
        toast.error(`Reset failed: ${result.message}`);
      }
    } catch (error) {
      console.error('Error during reset:', error);
      toast.dismiss(loadingToast);
      toast.error('An unexpected error occurred during reset.');
    } finally {
      // Add a small delay before setting isResetting to false to ensure all operations are completed
      setTimeout(() => {
        setIsResetting(false);
        setIsResetConfirmOpen(false);
      }, 1000);
    }
  };

  const handleExportAll = () => {
    exportToExcel(employeeRecords);
    toast.success(`Exported to file`);
  };

  const handleSaveToDatabase = async () => {
    // Prevent saving during reset operation
    if (isResetting) {
      toast.error('Please wait for the reset operation to complete');
      return;
    }
    
    // Check connection first
    const isConnected = await checkConnection();
    if (!isConnected) {
      return;
    }
    
    let approvedCount = 0;
    setSavingErrors([]);
    
    // Count total approved records
    employeeRecords.forEach(emp => {
      emp.days.forEach(day => {
        if (day.approved) approvedCount++;
      });
    });
    
    if (approvedCount === 0) {
      toast.error('No approved records to save');
      return;
    }
    
    setIsSaving(true);
    const loadingToast = toast.loading(`Saving ${approvedCount} approved records...`);
    
    try {
      const { successCount, errorCount, errorDetails } = await saveRecordsToDatabase(employeeRecords);

      // Store error details for display
      if (errorDetails && errorDetails.length > 0) {
        setSavingErrors(errorDetails);
      }

      // Process records after saving - remove approved days
      const updatedRecords = processRecordsAfterSave(employeeRecords);
      setEmployeeRecords(updatedRecords);
      
      // Update totals
      const { totalEmployees: updatedEmpCount, totalDays: updatedDaysCount } = calculateStats(updatedRecords);
      setTotalEmployees(updatedEmpCount);
      setTotalDays(updatedDaysCount);
      
      // Update in Supabase
      if (updatedRecords.length > 0) {
        // Only update Supabase if there are records left
        await saveToSupabase(currentFileName, updatedRecords);
      }
      
      toast.dismiss(loadingToast);
      if (successCount > 0) {
        toast.success(`Successfully saved ${successCount} records to database`);
        // Show a success message with a link to view the approved hours
        toast((t) => (
          <div className="flex flex-col">
            <span>Successfully saved {successCount} records</span>
            <button 
              onClick={() => {
                navigate('/approved-hours');
                toast.dismiss(t.id);
              }}
              className="mt-2 px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
            >
              View Approved Hours
            </button>
          </div>
        ), { duration: 5000 });
      }
      if (errorCount > 0) {
        toast.error(`Failed to save ${errorCount} records. Check browser console for details.`);
        console.error("Failed records:", errorDetails);
      }
    } catch (error) {
      console.error('Error saving records:', error);
      toast.dismiss(loadingToast);
      toast.error(error instanceof Error ? error.message : 'Error saving records');
    } finally {
      setIsSaving(false);
    }
  };

  // Run system migrations - Initialize database
  const handleRunMigrations = async () => {
    // Check connection first
    const isConnected = await checkConnection();
    if (!isConnected) {
      return;
    }
    
    // Prevent multiple clicks
    if (isMigrating) {
      return;
    }
    
    setIsMigrating(true);
    const loadingToast = toast.loading('Running database migrations...');
    
    try {
      const result = await runAllMigrations();
      
      toast.dismiss(loadingToast);
      if (result.success) {
        toast.success('Database migrations completed successfully');
        
        // Show counts if available
        if (result.counts.credentials > 0) {
          toast.success(`Created ${result.counts.credentials} user credentials`);
        }
      } else {
        toast.error('Database migrations failed: ' + result.messages.join(', '));
      }
    } catch (error) {
      console.error('Error running migrations:', error);
      toast.dismiss(loadingToast);
      toast.error(error instanceof Error ? error.message : 'Error running migrations');
    } finally {
      setIsMigrating(false);
    }
  };

  // Handle employee shift request approval
  const handleEmployeeShiftApproved = async (employeeData: any, shiftData: any) => {
    // Prevent operation during reset
    if (isResetting) {
      toast.error('Please wait for the reset operation to complete');
      return;
    }
    
    // Create a daily record in the format expected by the app
    const dailyRecord: DailyRecord = {
      date: shiftData.date,
      firstCheckIn: shiftData.checkInDate,
      lastCheckOut: shiftData.checkOutDate,
      hoursWorked: shiftData.hoursWorked || 9.0, // Use provided hours or default to standard shift
      approved: false, // Not auto-approved
      shiftType: shiftData.shift_type,
      notes: 'Employee submitted shift - HR approved',
      missingCheckIn: false,
      missingCheckOut: false,
      isLate: false,
      earlyLeave: false,
      excessiveOvertime: shiftData.hoursWorked > 9.5,
      penaltyMinutes: 0
    };
    
    // Look for existing employee in records
    let employeeIndex = employeeRecords.findIndex(emp => 
      emp.employeeNumber === employeeData.employee_number || 
      emp.employeeNumber === employeeData.employeeNumber
    );
    
    // Create a new array to avoid direct state mutation
    const updatedRecords = [...employeeRecords];
    
    if (employeeIndex >= 0) {
      // Employee exists, check if this date already exists
      const dayIndex = updatedRecords[employeeIndex].days.findIndex(day => day.date === shiftData.date);
      
      if (dayIndex >= 0) {
        // Update existing day
        updatedRecords[employeeIndex].days[dayIndex] = dailyRecord;
      } else {
        // Add new day
        updatedRecords[employeeIndex].days.push(dailyRecord);
        updatedRecords[employeeIndex].totalDays += 1;
      }
      
      // Ensure the employee's section is expanded to see the new entry
      updatedRecords[employeeIndex].expanded = true;
      
    } else {
      // Employee doesn't exist in current records, create a new entry
      employeeIndex = updatedRecords.length;
      updatedRecords.push({
        employeeNumber: employeeData.employee_number || employeeData.employeeNumber,
        name: employeeData.name,
        department: '',
        days: [dailyRecord],
        totalDays: 1,
        expanded: true // Auto-expand to show the new entry
      });
    }
    
    // Update the state with new records
    setEmployeeRecords(updatedRecords);
    
    // Update totals if necessary
    if (employeeIndex === employeeRecords.length) {
      setTotalEmployees(prev => prev + 1);
    }
    setTotalDays(prev => prev + 1);
    
    // Set hasUploadedFile to true to ensure proper display
    setHasUploadedFile(true);
    
    // Save to Supabase
    await saveToSupabase(currentFileName || 'Employee Shift Approvals', updatedRecords);
    
    // Show success message
    toast.success(`Added ${employeeData.name}'s submitted shift to the Face ID Data`);
  };

  // Handle saving manual time entry
  const handleManualEntrySave = async (recordData: any) => {
    // Prevent manual entry during reset
    if (isResetting) {
      toast.error('Please wait for the reset operation to complete');
      return;
    }
    
    setIsManualEntryOpen(false);
    
    try {
      // Add the manual entry to the displayed records
      const { updatedRecords, employeeIndex, isNewEmployee } = addManualEntryToRecords(recordData, employeeRecords);
      
      // Update state with the modified records
      setEmployeeRecords(updatedRecords);
      
      // Update totals
      setTotalEmployees(prev => isNewEmployee ? prev + 1 : prev);
      setTotalDays(prev => prev + 1);
      setHasUploadedFile(true);
      
      // Save to Supabase
      await saveToSupabase(currentFileName || 'Manual Entries', updatedRecords);
      
      // Store the recent manual entry for highlighting
      const empNumber = String(recordData.employee.employee_number || recordData.employee.employeeNumber || "").trim();
      setRecentManualEntry({
        employeeNumber: empNumber,
        date: recordData.date
      });
      
      toast.success('Manual time record added successfully');
    } catch (error) {
      console.error('Error adding manual entry:', error);
      toast.error('Failed to add manual entry');
    }
  };

  // Clear recent manual entry notification after 10 seconds
  useEffect(() => {
    if (recentManualEntry) {
      const timer = setTimeout(() => {
        setRecentManualEntry(null);
      }, 10000);
      
      return () => clearTimeout(timer);
    }
  }, [recentManualEntry]);
  
  // Toggle date range picker
  const handleToggleDateRangePicker = () => {
    setShowDateRangePicker(!showDateRangePicker);
  };
  
  // Handle date range selection
  const handleDateRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setShowDateRangePicker(false); // Close the picker after selection
  };

  // Handle logout
  const handleLogout = () => {
    logout();
    navigate('/hr-login', { replace: true });
  };

  // If still loading from context, show loading state
  if (isContextLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md text-center">
          <div className="animate-spin w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-700">Loading your data...</p>
        </div>
      </div>
    );
  }

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
                  Face ID Data Processor
                </h1>
                {username && (
                  <span className="ml-2 text-sm text-gray-600">
                    (Logged in as: {username})
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => navigate('/')}
                  className="text-gray-600 hover:text-gray-800 font-medium flex items-center"
                >
                  <Home className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Back to Home</span>
                  <span className="sm:hidden">Home</span>
                </button>
                <button
                  onClick={() => setIsUserCredentialsOpen(true)}
                  className="text-green-600 hover:text-green-800 font-medium flex items-center"
                  disabled={isResetting}
                >
                  <KeyRound className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Manage User Credentials</span>
                  <span className="sm:hidden">Users</span>
                </button>
                <button
                  onClick={handleRunMigrations}
                  disabled={isMigrating || isResetting}
                  className="text-blue-600 hover:text-blue-800 font-medium flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Database className="w-4 h-4 mr-1" />
                  {isMigrating ? 
                    <span className="hidden sm:inline">Initializing...</span> : 
                    <span className="hidden sm:inline">Initialize System</span>
                  }
                  {isMigrating ? 
                    <span className="sm:hidden">Init...</span> : 
                    <span className="sm:hidden">Init</span>
                  }
                </button>
                <button
                  onClick={() => navigate('/approved-hours')}
                  className="text-purple-600 hover:text-purple-800 font-medium whitespace-nowrap"
                >
                  <span className="hidden sm:inline">View Approved Hours</span>
                  <span className="sm:hidden">Approved</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="text-red-600 hover:text-red-800 font-medium flex items-center"
                >
                  <LogOut className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Logout</span>
                  <span className="sm:hidden">Logout</span>
                </button>
              </div>
            </div>
          </div>

          {/* Card content */}
          <div className="p-6 space-y-6">
            {/* Connection error message */}
            {connectionError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start">
                <AlertTriangle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-700">
                  <p className="font-medium">Database Connection Error</p>
                  <p>{connectionError}</p>
                  <p className="mt-2">Please check your Supabase connection settings and ensure your database is accessible.</p>
                  <button 
                    onClick={checkConnection}
                    className="mt-2 px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200 text-sm"
                  >
                    Retry Connection
                  </button>
                </div>
              </div>
            )}

            {/* Reset in progress warning */}
            {isResetting && (
              <div className="bg-orange-50 border border-orange-200 rounded-md p-4 flex items-start">
                <AlertTriangle className="w-5 h-5 text-orange-500 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-orange-700">
                  <p className="font-medium">Reset Operation in Progress</p>
                  <p>Please wait for the reset operation to complete before uploading files or making changes.</p>
                  <div className="mt-2 flex items-center">
                    <div className="animate-spin w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full mr-2"></div>
                    <span>Resetting database...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Info box */}
            <div className="bg-pink-50 border border-pink-100 rounded-md p-4 flex items-start">
              <AlertCircle className="w-5 h-5 text-pink-500 mr-3 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-pink-800">
                <p>Upload Face ID data to process check-in and check-out times. Shift times are:</p>
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li><strong>Morning shift:</strong> 05:00 AM - 02:00 PM (allowed check-out from 01:30 PM)</li>
                  <li><strong>Evening shift:</strong> 01:00 PM - 10:00 PM (allowed check-out from 09:30 PM)</li>
                  <li><strong>Night shift:</strong> 09:00 PM - 06:00 AM (allowed check-out from 05:30 AM)</li>
                </ul>
                <p className="mt-2"><strong>Note:</strong> Check-ins between 4:30 AM and 5:00 AM are considered part of the morning shift.</p>
              </div>
            </div>
            
            {/* Date Range Picker (optional) */}
            {showDateRangePicker && (
              <div className="bg-white border border-gray-200 rounded-md p-4 shadow-sm">
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

            {/* Employee Shift Requests Section */}
            <EmployeeShiftRequest onShiftApproved={handleEmployeeShiftApproved} />

            {/* Error section for failed records */}
            {savingErrors.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-md p-4">
                <div className="flex items-center mb-2">
                  <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                  <h3 className="text-red-800 font-medium">Failed to save {savingErrors.length} records</h3>
                </div>
                <div className="max-h-40 overflow-auto text-sm">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="text-left border-b border-red-200">
                        <th className="py-2 px-3">Employee</th>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savingErrors.map((err, index) => (
                        <tr key={index} className="border-b border-red-100">
                          <td className="py-2 px-3">{err.employeeName}</td>
                          <td className="py-2 px-3">{err.date}</td>
                          <td className="py-2 px-3 text-red-700">{err.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Upload section */}
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2 flex justify-between items-center">
                <span>Upload Face ID Data File (Excel)</span>
                <button
                  onClick={() => setIsManualEntryOpen(true)}
                  className="text-blue-600 hover:text-blue-800 flex items-center text-sm font-medium"
                  disabled={isUploading || isResetting}
                >
                  <PlusCircle className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Add Record Manually</span>
                  <span className="sm:hidden">Add Manual</span>
                </button>
              </div>
              <button 
                onClick={() => document.getElementById('file-upload')?.click()}
                disabled={isUploading || isResetting}
                className="w-full bg-purple-600 hover:bg-purple-700 focus:ring-4 focus:ring-purple-200 
                  text-white rounded-md py-2.5 px-4 flex items-center justify-center
                  disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
              >
                <Upload className="w-4 h-4 mr-2" />
                {isUploading ? 'Processing...' : 'Select File'}
              </button>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
                disabled={isUploading || isResetting}
              />
              {currentFileName && (
                <div className="mt-2 text-sm text-gray-500 text-right text-wrap-balance">
                  {currentFileName}
                </div>
              )}
            </div>

            {/* Recent Manual Entry Notification */}
            {recentManualEntry && (
              <div className="bg-green-50 border border-green-100 rounded-md p-4 flex items-start">
                <CheckCircle className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-green-800">
                  <p className="font-medium">Manual entry added successfully</p>
                  <p>The manual time record has been added and is now visible in the employee list below.</p>
                </div>
              </div>
            )}

            {/* Results Section */}
            {employeeRecords.length > 0 ? (
              <div className="space-y-4">
                {/* Summary and controls */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-y-3">
                  <div className="text-sm text-gray-600">
                    Processed {totalEmployees} Employees • {totalDays} Days
                    <label className="ml-4 inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={showApproved} 
                        onChange={() => setShowApproved(!showApproved)}
                        className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">Show Approved</span>
                    </label>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:flex gap-2">
                    {/* First row of buttons (mobile only) */}
                    <div className="col-span-2 flex gap-2 sm:hidden">
                      <button
                        onClick={handleReset}
                        disabled={isResetting}
                        className="flex-1 inline-flex items-center justify-center px-3 py-1.5 border border-gray-300 text-sm leading-5 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isResetting ? (
                          <span className="inline-block h-4 w-4 rounded-full border-2 border-gray-400 border-t-transparent animate-spin mr-1"></span>
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-1" />
                        )}
                        Reset
                      </button>
                      
                      <button
                        onClick={() => setIsManualEntryOpen(true)}
                        disabled={isResetting}
                        className="flex-1 inline-flex items-center justify-center px-3 py-1.5 border border-transparent text-sm leading-5 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <PlusCircle className="w-4 h-4 mr-1" />
                        Add
                      </button>
                    </div>
                    
                    {/* Second row of buttons (mobile only) */}
                    <div className="col-span-2 flex gap-2 sm:hidden">
                      <button
                        onClick={handleExportAll}
                        disabled={isResetting}
                        className="flex-1 inline-flex items-center justify-center px-3 py-1.5 border border-gray-300 text-sm leading-5 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Export
                      </button>
                      
                      <button
                        onClick={() => setIsApproveAllDialogOpen(true)}
                        disabled={isResetting}
                        className="flex-1 inline-flex items-center justify-center px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Approve
                      </button>
                    </div>
                    
                    {/* Third row (full-width Save button on mobile) */}
                    <button
                      onClick={handleSaveToDatabase}
                      disabled={isSaving || !employeeRecords.some(emp => emp.days.some(d => d.approved)) || !!connectionError || isResetting}
                      className="col-span-2 sm:col-span-1 inline-flex items-center justify-center px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSaving ? (
                        <>
                          <span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin mr-2"></span>
                          {isMobile ? 'Saving...' : 'Saving Approved Records...'}
                        </>
                      ) : (
                        isMobile ? 'Save Records' : 'Save Approved Records'
                      )}
                    </button>
                    
                    {/* Desktop-only buttons */}
                    <button
                      onClick={handleReset}
                      disabled={isResetting}
                      className="hidden sm:inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm leading-5 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isResetting ? (
                        <span className="inline-block h-4 w-4 rounded-full border-2 border-gray-400 border-t-transparent animate-spin mr-2"></span>
                      ) : (
                        <RefreshCw className="w-4 h-4 mr-1" />
                      )}
                      Reset
                    </button>
                    
                    <button
                      onClick={() => setIsManualEntryOpen(true)}
                      disabled={isResetting}
                      className="hidden sm:inline-flex items-center px-3 py-1.5 border border-transparent text-sm leading-5 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <PlusCircle className="w-4 h-4 mr-1" />
                      Add Manual Entry
                    </button>
                    
                    <button
                      onClick={handleExportAll}
                      disabled={isResetting}
                      className="hidden sm:inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm leading-5 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Export All
                    </button>
                    
                    <button
                      onClick={() => setIsApproveAllDialogOpen(true)}
                      disabled={isResetting}
                      className="hidden sm:inline-flex items-center px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Approve All
                    </button>
                  </div>
                </div>
                
                {/* Employee List */}
                <EmployeeList 
                  employeeRecords={employeeRecords}
                  showApproved={showApproved}
                  toggleEmployeeExpanded={toggleEmployeeExpanded}
                  handleToggleApproveDay={handleToggleApproveDay}
                  handleApproveAllForEmployee={handleApproveAllForEmployee}
                  handleApplyPenalty={handleApplyPenalty}
                  handleEditTime={handleEditTime}
                />
              </div>
            ) : (
              // Empty state
              <EmptyState 
                hasUploadedFile={hasUploadedFile}
                onUploadClick={() => document.getElementById('file-upload')?.click()}
                onManualEntryClick={() => setIsManualEntryOpen(true)}
              />
            )}
          </div>
        </div>
      </div>
      
      {/* Manual Entry Modal */}
      <ManualEntryModal
        isOpen={isManualEntryOpen}
        onClose={() => setIsManualEntryOpen(false)}
        onSave={handleManualEntrySave}
      />
      
      {/* User Credentials Modal */}
      <UserCredentialsModal
        isOpen={isUserCredentialsOpen}
        onClose={() => setIsUserCredentialsOpen(false)}
      />
      
      {/* Approve All Confirmation Dialog */}
      <ApproveAllConfirmationDialog
        isOpen={isApproveAllDialogOpen}
        onClose={() => setIsApproveAllDialogOpen(false)}
        onConfirm={handleApproveAll}
        totalRecords={totalDays}
        isProcessing={isApprovingAll}
      />
      
      {/* Reset Confirmation Dialog */}
      <ConfirmDialog 
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        onConfirm={confirmReset}
        title="Reset Face ID Data"
        message="This will delete Face ID Data, processed files, and employee shifts, but will preserve approved time records and double-time days. This action cannot be undone. Are you sure you want to proceed?"
        isProcessing={isResetting}
        confirmButtonText="Yes, Reset Face ID Data"
        cancelButtonText="Cancel"
        type="danger"
      />
      
      <Toaster position="top-right" />
    </div>
  );
}

export default HrPage;