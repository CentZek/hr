import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronRight, Clock, PenSquare, TrendingUp, FileSpreadsheet } from 'lucide-react';
import { EmployeeRecord, DailyRecord, PENALTY_OPTIONS } from '../types';
import PenaltyModal from './PenaltyModal';
import TimeEditModal from './TimeEditModal';
import EmployeeSummary from './EmployeeSummary';
import { formatTime24H } from '../utils/dateTimeHelper';
import { calculatePayableHours, determineShiftType } from '../utils/shiftCalculations';
import ConfirmDialog from './ConfirmDialog';

interface EmployeeListProps {
  employeeRecords: EmployeeRecord[];
  showApproved: boolean;
  toggleEmployeeExpanded: (index: number) => void;
  handleToggleApproveDay: (employeeIndex: number, dayIndex: number) => void;
  handleApproveAllForEmployee: (employeeIndex: number) => void;
  handleApplyPenalty: (employeeIndex: number, dayIndex: number, penaltyMinutes: number) => void;
  handleEditTime: (employeeIndex: number, dayIndex: number, checkIn: Date | null, checkOut: Date | null) => void;
}

const EmployeeList: React.FC<EmployeeListProps> = ({
  employeeRecords, showApproved, toggleEmployeeExpanded, handleToggleApproveDay,
  handleApproveAllForEmployee, handleApplyPenalty, handleEditTime
}) => {
  const [penaltyModalOpen, setPenaltyModalOpen] = useState(false);
  const [timeEditModalOpen, setTimeEditModalOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [expandedRawData, setExpandedRawData] = useState<{empIndex: number, dayIndex: number} | null>(null);
  
  // State for approve all for employee confirmation
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);
  const [employeeToApprove, setEmployeeToApprove] = useState<number | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  const openPenaltyModal = (empIndex: number, dayIndex: number) => {
    setSelectedEmployee(empIndex);
    setSelectedDay(dayIndex);
    setPenaltyModalOpen(true);
  };

  const openTimeEditModal = (empIndex: number, dayIndex: number) => {
    setSelectedEmployee(empIndex);
    setSelectedDay(dayIndex);
    setTimeEditModalOpen(true);
  };

  const toggleRawData = (empIndex: number, dayIndex: number) => {
    if (expandedRawData && expandedRawData.empIndex === empIndex && expandedRawData.dayIndex === dayIndex) {
      setExpandedRawData(null);
    } else {
      setExpandedRawData({empIndex, dayIndex});
    }
  };
  
  // Open confirmation dialog before approving all for an employee
  const confirmApproveAllForEmployee = (empIndex: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent the click from toggling the employee expanded state
    setEmployeeToApprove(empIndex);
    setApproveConfirmOpen(true);
  };
  
  // Handle confirm approve all for employee
  const handleConfirmApproveAllForEmployee = () => {
    if (employeeToApprove !== null) {
      setIsApproving(true);
      
      // Apply the approval
      handleApproveAllForEmployee(employeeToApprove);
      
      // Reset state
      setTimeout(() => {
        setIsApproving(false);
        setApproveConfirmOpen(false);
        setEmployeeToApprove(null);
      }, 500);
    }
  };

  const getShiftTypeDisplay = (shiftType: string | null, checkInHour?: number) => {
    if (!shiftType) return { color: 'bg-gray-100 text-gray-800', name: 'Unknown' };
    
    if (shiftType === 'OFF-DAY') return { color: 'bg-gray-100 text-gray-500', name: 'OFF-DAY' };
    
    const colors: Record<string, string> = {
      morning: 'bg-blue-100 text-blue-800',
      evening: 'bg-orange-100 text-orange-800',
      night: 'bg-purple-100 text-purple-800',
      canteen: 'bg-yellow-100 text-yellow-800',
      custom: 'bg-indigo-100 text-indigo-800'
    };
    
    let name = shiftType.charAt(0).toUpperCase() + shiftType.slice(1);
    if (shiftType === 'canteen' && checkInHour !== undefined) {
      name = checkInHour === 7 ? 'Canteen (07:00-16:00)' : 'Canteen (08:00-17:00)';
    }
    
    return { color: colors[shiftType] || 'bg-gray-100 text-gray-800', name };
  };

  // Get standard display time based on shift type
  const getStandardDisplayTime = (shiftType: string | null, timeType: 'start' | 'end') => {
    if (!shiftType || !['morning', 'evening', 'night', 'canteen'].includes(shiftType)) return '';
    
    const displayTimes = {
      morning: { startTime: '05:00', endTime: '14:00' },
      evening: { startTime: '13:00', endTime: '22:00' },
      night: { startTime: '21:00', endTime: '06:00' },
      canteen: { startTime: '07:00', endTime: '16:00' } // Default to early canteen
    };
    
    return timeType === 'start' ? displayTimes[shiftType as keyof typeof displayTimes].startTime : 
                                 displayTimes[shiftType as keyof typeof displayTimes].endTime;
  };

  const isLateNightShiftCheckIn = (checkIn: Date | null, shiftType: string | null): boolean => {
    if (!checkIn || shiftType !== 'night') return false;
    const hour = checkIn.getHours();
    const minute = checkIn.getMinutes();
    return (hour > 21) || (hour === 21 && minute > 0);
  };

  const renderRawDataTable = (day: DailyRecord, empIndex: number, dayIndex: number) => {
    if (!day.allTimeRecords || day.allTimeRecords.length === 0) {
      return <div className="px-4 py-2 text-center text-sm text-gray-500">No raw Excel data available</div>;
    }

    return (
      <div className="px-4 py-2 bg-gray-50">
        <div className="text-sm font-medium text-gray-700 mb-2">Raw Excel Data for {day.date}</div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Index</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date/Time</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Processed</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Shift Type</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {day.allTimeRecords.sort((a, b) => (a.originalIndex || 0) - (b.originalIndex || 0)).map((record, index) => (
                <tr key={index} className={record.mislabeled ? 'bg-amber-50' : ''}>
                  <td className="px-3 py-2 whitespace-nowrap">{record.originalIndex || index}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{format(record.timestamp, 'MM/dd/yyyy HH:mm:ss')}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${record.mislabeled ? 'text-amber-600 font-medium' : ''}`}>
                    {record.status === 'check_in' ? 'C/In' : 'C/Out'}
                    {record.mislabeled && record.originalStatus && 
                      <span className="ml-2 text-xs text-amber-600">(Corrected)</span>
                    }
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{record.processed ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{record.shift_type || 'unknown'}</td>
                  <td className="px-3 py-2">{record.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderMobileDay = (day: DailyRecord, dayIndex: number, empIndex: number, employee: EmployeeRecord) => {
    const checkInHour = day.firstCheckIn?.getHours();
    const shiftDisplay = getShiftTypeDisplay(day.shiftType, checkInHour);
    const isOffDay = day.notes === 'OFF-DAY';
    const isManualEntry = day.notes === 'Manual entry';
    const wasCorrected = day.correctedRecords || day.notes.includes('Fixed mislabeled');
    const isLateNightCheckIn = day.shiftType === 'night' && day.firstCheckIn && isLateNightShiftCheckIn(day.firstCheckIn, day.shiftType);
    const hasRawData = day.allTimeRecords && day.allTimeRecords.length > 0;
    const isRawDataExpanded = expandedRawData?.empIndex === empIndex && expandedRawData?.dayIndex === dayIndex;
    
    // Display times - use standardized times for shift types when appropriate
    let checkInDisplay = day.firstCheckIn ? formatTime24H(day.firstCheckIn) : (isOffDay ? 'OFF-DAY' : 'Missing');
    let checkOutDisplay = day.lastCheckOut ? formatTime24H(day.lastCheckOut) : (isOffDay ? 'OFF-DAY' : 'Missing');
    
    // For manual entries and employee-submitted shifts, use the standard display times
    if ((isManualEntry || day.notes?.includes('Employee submitted')) && day.shiftType) {
      checkInDisplay = getStandardDisplayTime(day.shiftType, 'start');
      checkOutDisplay = getStandardDisplayTime(day.shiftType, 'end');
    }

    // Flag indicators for mobile view
    const hasSinglePoint = day.missingCheckIn || day.missingCheckOut;
    const hasThreeDatapoints = day.allTimeRecords && day.allTimeRecords.length === 3 && day.shiftType !== 'night';
    const hasExcessiveHours = day.hoursWorked > 12;

    return (
      <div key={day.date} className={`mobile-card 
        ${day.approved ? 'bg-green-50' : ''} 
        ${isManualEntry ? 'bg-blue-50' : ''}
        ${isManualEntry && day.approved ? 'bg-teal-50' : ''}
        ${wasCorrected ? 'bg-yellow-50' : ''}
        ${isOffDay ? 'bg-gray-50' : ''}
        ${day.isCrossDay ? 'border-l-4 border-purple-300' : ''}
        ${day.missingCheckIn || day.missingCheckOut ? 'border-l-4 border-red-300' : ''}
        ${(day.isLate || isLateNightCheckIn) && !day.missingCheckIn ? 'border-l-4 border-amber-300' : ''}
        ${day.earlyLeave && !day.missingCheckOut ? 'border-l-4 border-amber-300' : ''}
        ${day.excessiveOvertime && !day.earlyLeave && !day.missingCheckOut ? 'border-l-4 border-blue-300' : ''}`}
      >
        <div className="flex justify-between items-start mb-2">
          <div>
            <div className="font-medium text-gray-800 text-wrap-balance">
              {format(new Date(day.date), 'MM/dd/yyyy')}
              {isManualEntry && <span className="ml-1 text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">Manual</span>}
              {wasCorrected && <span className="ml-1 text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full" title="Original C/In or C/Out was corrected">Fixed</span>}
              {isOffDay && <span className="ml-1 text-xs px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-full">OFF-DAY</span>}
            </div>
            <div className="mt-1 mb-2">
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${shiftDisplay.color}`}>{shiftDisplay.name}</span>
              <span className="ml-1 px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">{day.hoursWorked.toFixed(2)} hrs</span>
              <span className={`ml-1 px-2 py-1 text-xs font-medium rounded-full ${day.approved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {day.approved ? 'Approved' : 'Pending'}
              </span>
            </div>
          </div>
          <div className="flex space-x-2">
            <button onClick={() => openTimeEditModal(empIndex, dayIndex)} className={`p-1 rounded-full ${day.missingCheckIn || day.missingCheckOut || wasCorrected ? 'text-blue-600' : 'text-gray-600'} hover:bg-gray-100`}>
              <PenSquare className="w-5 h-5" />
            </button>
            <button onClick={() => openPenaltyModal(empIndex, dayIndex)} className={`p-1 rounded-full text-gray-600 hover:bg-gray-100 ${isOffDay ? 'opacity-50 cursor-not-allowed' : ''}`} disabled={isOffDay}>
              <AlertTriangle className="w-5 h-5" />
            </button>
            <button onClick={() => handleToggleApproveDay(empIndex, dayIndex)} className={`p-1 rounded-full ${day.approved ? 'text-green-600 hover:bg-green-100' : 'text-gray-400 hover:bg-gray-100'}`}>
              {day.approved ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            </button>
          </div>
        </div>
        
        {/* Flag indicators for mobile */}
        {(hasSinglePoint || hasThreeDatapoints || hasExcessiveHours) && (
          <div className="flex flex-wrap gap-1 mb-2">
            {hasSinglePoint && (
              <span className="px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded-full flex items-center">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {day.missingCheckIn ? (day.missingCheckOut ? 'Missing both' : 'Missing check-in') : 'Missing check-out'}
              </span>
            )}
            {hasThreeDatapoints && (
              <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-800 rounded-full flex items-center">
                <AlertTriangle className="w-3 h-3 mr-1" />
                3 records (non-night)
              </span>
            )}
            {hasExcessiveHours && (
              <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded-full flex items-center">
                <Clock className="w-3 h-3 mr-1" />
                {day.hoursWorked.toFixed(1)}+ hours
              </span>
            )}
          </div>
        )}
        
        <div className="grid grid-cols-2 gap-2 mb-1">
          <div>
            <div className="text-xs text-gray-500">Check In</div>
            <div className={`text-sm mt-1 ${day.missingCheckIn ? 'text-red-500' : (day.isLate || isLateNightCheckIn) ? 'text-amber-600' : 'text-gray-700'}`}>
              {day.firstCheckIn ? 
                <>{(day.isLate || isLateNightCheckIn) && <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />}
                {checkInDisplay}
                {day.shiftType === 'canteen' && <span className="ml-1 text-xs bg-yellow-100 text-yellow-800 px-1 rounded">{day.firstCheckIn.getHours() === 7 ? '07:00' : '08:00'}</span>}</> : 
                isOffDay ? 'OFF-DAY' : <span className="text-red-500">Missing</span>}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Check Out</div>
            <div className={`text-sm mt-1 ${day.missingCheckOut ? 'text-red-500' : day.earlyLeave ? 'text-amber-600' : day.excessiveOvertime ? 'text-blue-600' : 'text-gray-700'}`}>
              {day.lastCheckOut ? 
                <>{day.earlyLeave && <AlertTriangle className="inline w-3 h-3 mr-1 text-amber-500" />}
                {day.excessiveOvertime && <Clock className="inline w-3 h-3 mr-1 text-blue-500" />}
                {checkOutDisplay}</> : 
                isOffDay ? 'OFF-DAY' : <span className="text-red-500">Missing</span>}
            </div>
          </div>
        </div>

        {day.penaltyMinutes > 0 && <div className="text-xs text-red-600 mt-1">Penalty: {(day.penaltyMinutes / 60).toFixed(2)} hr</div>}

        {hasRawData && (
          <div className="mt-2">
            <button 
              onClick={() => toggleRawData(empIndex, dayIndex)}
              className="w-full flex items-center justify-center text-xs py-1 px-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              <FileSpreadsheet className="w-3 h-3 mr-1" />
              {isRawDataExpanded ? 'Hide Raw Data' : 'Show Raw Data'} 
              <span className="ml-1 text-xs bg-gray-200 text-gray-700 px-1.5 rounded-full">
                {day.allTimeRecords!.length}
              </span>
            </button>
            
            {isRawDataExpanded && renderRawDataTable(day, empIndex, dayIndex)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {employeeRecords.map((employee, empIndex) => {
        if (showApproved && !employee.days.some(day => day.approved)) return null;
        
        return (
          <div key={employee.employeeNumber} className="border border-gray-200 rounded-md overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100" onClick={() => toggleEmployeeExpanded(empIndex)}>
              <div className="flex items-center space-x-3">
                <span className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
                  {employee.expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </span>
                <div>
                  <h3 className="text-sm font-medium text-gray-900 text-wrap-balance">{employee.name}</h3>
                  <p className="text-xs text-gray-500">Employee No: {employee.employeeNumber} • {employee.days.length} days</p>
                </div>
              </div>
              <button 
                onClick={(e) => confirmApproveAllForEmployee(empIndex, e)} 
                className="px-2 py-1 text-xs font-medium rounded bg-green-50 text-green-700 hover:bg-green-100"
              >
                Approve All
              </button>
            </div>
            
            {employee.expanded && (
              <div className="border-t border-gray-200">
                <div className="hidden sm:grid sm:grid-cols-9 gap-4 px-6 py-3 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <div>Date</div>
                  <div>Check In</div>
                  <div>Check Out</div>
                  <div>Hours</div>
                  <div>Shift Type</div>
                  <div>Status</div>
                  <div>Penalty</div>
                  <div>Raw Data</div>
                  <div>Actions</div>
                </div>
                
                <div className="divide-y divide-gray-200">
                  {employee.days.map((day, dayIndex) => {
                    if (showApproved && !day.approved) return null;
                    
                    const hasMissingRecords = day.missingCheckIn || day.missingCheckOut;
                    const isManualEntry = day.notes === 'Manual entry' || day.notes?.includes('Employee submitted');
                    const isOffDay = day.notes === 'OFF-DAY';
                    const checkInHour = day.firstCheckIn?.getHours();
                    const shiftDisplay = getShiftTypeDisplay(isOffDay ? 'OFF-DAY' : day.shiftType, checkInHour);
                    const wasCorrected = day.correctedRecords || day.notes?.includes('Fixed mislabeled');
                    const isLateNightCheckIn = day.shiftType === 'night' && day.firstCheckIn && isLateNightShiftCheckIn(day.firstCheckIn, day.shiftType);
                    const hasRawData = day.allTimeRecords && day.allTimeRecords.length > 0;
                    const isRawDataExpanded = expandedRawData?.empIndex === empIndex && expandedRawData?.dayIndex === dayIndex;
                    
                    // Display times - use standardized times for shift types when appropriate
                    let checkInDisplay = day.firstCheckIn ? formatTime24H(day.firstCheckIn) : (isOffDay ? 'OFF-DAY' : 'Missing');
                    let checkOutDisplay = day.lastCheckOut ? formatTime24H(day.lastCheckOut) : (isOffDay ? 'OFF-DAY' : 'Missing');
                    
                    // For manual entries and employee-submitted shifts, use the standard display times
                    if (isManualEntry && day.shiftType) {
                      checkInDisplay = getStandardDisplayTime(day.shiftType, 'start');
                      checkOutDisplay = getStandardDisplayTime(day.shiftType, 'end');
                    }

                    // Flag indicators for desktop view
                    const hasSinglePoint = day.missingCheckIn || day.missingCheckOut;
                    const hasThreeDatapoints = day.allTimeRecords && day.allTimeRecords.length === 3 && day.shiftType !== 'night';
                    const hasExcessiveHours = day.hoursWorked > 12;
                    
                    if (typeof window !== 'undefined' && window.innerWidth < 640) {
                      return renderMobileDay(day, dayIndex, empIndex, employee);
                    }
                    
                    return (
                      <React.Fragment key={day.date}>
                        <div className={`grid grid-cols-9 gap-4 px-6 py-4 text-sm 
                          ${day.approved ? 'bg-green-50' : ''} 
                          ${isManualEntry ? 'bg-blue-50' : ''}
                          ${day.notes === 'Manual entry' && day.approved ? 'bg-teal-50' : ''}
                          ${wasCorrected ? 'bg-yellow-50' : ''}
                          ${isOffDay ? 'bg-gray-50' : ''}
                          ${day.isCrossDay ? 'border-l-4 border-purple-300' : ''}
                          ${day.missingCheckIn || day.missingCheckOut ? 'border-l-4 border-red-300' : ''}
                          ${(day.isLate || isLateNightCheckIn) && !day.missingCheckIn ? 'border-l-4 border-amber-300' : ''}
                          ${day.earlyLeave && !day.missingCheckOut ? 'border-l-4 border-amber-300' : ''}
                          ${day.excessiveOvertime && !day.earlyLeave && !day.missingCheckOut ? 'border-l-4 border-blue-300' : ''}`}
                        >
                          <div className="text-gray-900 font-medium">
                            {format(new Date(day.date), 'MM/dd/yyyy')}
                            {isManualEntry && <span className="ml-1 text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full">Manual</span>}
                            {wasCorrected && <span className="ml-1 text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full" title="Original C/In or C/Out was corrected">Fixed</span>}
                            {isOffDay && <span className="ml-1 text-xs px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-full">OFF-DAY</span>}
                            
                            {/* Flag indicators as badges */}
                            {hasSinglePoint && (
                              <span className="ml-1 text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full flex items-center inline-flex">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                {day.missingCheckIn && day.missingCheckOut ? 'Both missing' : 
                                 day.missingCheckIn ? 'Missing C/In' : 'Missing C/Out'}
                              </span>
                            )}
                            {hasThreeDatapoints && !hasSinglePoint && (
                              <span className="ml-1 text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full flex items-center inline-flex">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                3 records
                              </span>
                            )}
                            {hasExcessiveHours && !hasSinglePoint && !hasThreeDatapoints && (
                              <span className="ml-1 text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full flex items-center inline-flex">
                                <Clock className="w-3 h-3 mr-1" />
                                {day.hoursWorked.toFixed(1)}h
                              </span>
                            )}
                          </div>
                          <div className={`flex items-center ${day.missingCheckIn ? 'text-red-500' : (day.isLate || isLateNightCheckIn) ? 'text-amber-600' : 'text-gray-700'}`}>
                            {day.firstCheckIn ? 
                              <>{(day.isLate || isLateNightCheckIn) && <AlertTriangle className="w-4 h-4 mr-1 text-amber-500" title="Late check-in" />}
                              {checkInDisplay}
                              {day.shiftType === 'canteen' && 
                                <span className="ml-1 text-xs bg-yellow-100 text-yellow-800 px-1 rounded">
                                  {day.firstCheckIn.getHours() === 7 ? '07:00' : '08:00'}
                                </span>}</> : 
                              (isOffDay ? 'OFF-DAY' : <span className="text-red-500">Missing</span>)}
                          </div>
                          <div className={`flex items-center ${day.missingCheckOut ? 'text-red-500' : day.earlyLeave ? 'text-amber-600' : day.excessiveOvertime ? 'text-blue-600' : 'text-gray-700'}`}>
                            {day.lastCheckOut ? 
                              <>{day.earlyLeave && <AlertTriangle className="w-4 h-4 mr-1 text-amber-500" />}
                              {day.excessiveOvertime && <Clock className="w-4 h-4 mr-1 text-blue-500" />}
                              {checkOutDisplay}</> : 
                              (isOffDay ? 'OFF-DAY' : <span className="text-red-500">Missing</span>)}
                          </div>
                          <div className="font-medium text-gray-900">{isOffDay ? '0.00' : day.hoursWorked.toFixed(2)}</div>
                          <div><span className={`px-2 py-1 text-xs font-medium rounded-full ${shiftDisplay.color}`}>{shiftDisplay.name}</span></div>
                          <div>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${day.approved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                              {day.approved ? 'Approved' : 'Pending'}
                            </span>
                          </div>
                          <div>
                            {day.penaltyMinutes > 0 ? 
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">{(day.penaltyMinutes / 60).toFixed(2)} hr</span> : 
                              <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">None</span>}
                          </div>
                          <div>
                            {hasRawData ? (
                              <button 
                                onClick={() => toggleRawData(empIndex, dayIndex)} 
                                className="flex items-center px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                              >
                                <FileSpreadsheet className="w-3 h-3 mr-1" />
                                {isRawDataExpanded ? 'Hide' : 'Show'} 
                                <span className="ml-1 text-xs bg-gray-200 text-gray-700 px-1.5 rounded-full">
                                  {day.allTimeRecords!.length}
                                </span>
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">No data</span>
                            )}
                          </div>
                          <div className="flex space-x-2">
                            <button onClick={() => openTimeEditModal(empIndex, dayIndex)} className={`p-1 rounded-full ${hasMissingRecords || wasCorrected ? 'text-blue-600' : 'text-gray-600'} hover:bg-gray-100`} title={wasCorrected ? "Edit time (Fixed records)" : "Edit Time"}>
                              <PenSquare className="w-5 h-5" />
                            </button>
                            <button onClick={() => openPenaltyModal(empIndex, dayIndex)} className={`p-1 rounded-full text-gray-600 hover:bg-gray-100 ${isOffDay ? 'opacity-50 cursor-not-allowed' : ''}`} title="Apply Penalty" disabled={isOffDay}>
                              <AlertTriangle className="w-5 h-5" />
                            </button>
                            <button onClick={() => handleToggleApproveDay(empIndex, dayIndex)} className={`p-1 rounded-full ${day.approved ? 'text-green-600 hover:bg-green-100' : 'text-gray-400 hover:bg-gray-100'}`} title={day.approved ? "Unapprove" : "Approve"}>
                              {day.approved ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                            </button>
                          </div>
                        </div>
                        
                        {/* Raw Data Expanded View */}
                        {isRawDataExpanded && (
                          <div className="col-span-9">
                            {renderRawDataTable(day, empIndex, dayIndex)}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
                <EmployeeSummary days={employee.days} />
              </div>
            )}
          </div>
        );
      })}

      {penaltyModalOpen && selectedEmployee !== null && selectedDay !== null && (
        <PenaltyModal 
          employee={employeeRecords[selectedEmployee]}
          day={employeeRecords[selectedEmployee].days[selectedDay]}
          onClose={() => setPenaltyModalOpen(false)}
          onApply={(penaltyMinutes) => {
            handleApplyPenalty(selectedEmployee, selectedDay, penaltyMinutes);
            setPenaltyModalOpen(false);
            setSelectedEmployee(null);
            setSelectedDay(null);
          }}
        />
      )}
      
      {timeEditModalOpen && selectedEmployee !== null && selectedDay !== null && (
        <TimeEditModal
          employee={employeeRecords[selectedEmployee]}
          day={employeeRecords[selectedEmployee].days[selectedDay]}
          onClose={() => {
            setTimeEditModalOpen(false);
            setSelectedEmployee(null);
            setSelectedDay(null);
          }}
          onSave={(checkIn, checkOut) => {
            handleEditTime(selectedEmployee, selectedDay, checkIn, checkOut);
            setTimeEditModalOpen(false);
            setSelectedEmployee(null);
            setSelectedDay(null);
          }}
        />
      )}
      
      {/* Approve All Confirmation Dialog */}
      <ConfirmDialog
        isOpen={approveConfirmOpen}
        onClose={() => setApproveConfirmOpen(false)}
        onConfirm={handleConfirmApproveAllForEmployee}
        title="Approve All Records for Employee"
        message={employeeToApprove !== null 
          ? `Are you sure you want to approve all records for ${employeeRecords[employeeToApprove]?.name}? This will mark all of this employee's records as approved.`
          : "Are you sure you want to approve all records for this employee?"
        }
        isProcessing={isApproving}
        confirmButtonText="Yes, Approve All"
        cancelButtonText="Cancel"
        type="warning"
        confirmButtonColor="bg-green-600 hover:bg-green-700"
        icon={<CheckCircle className="w-5 h-5 mr-2 text-white" />}
      />
    </div>
  );
};

export default EmployeeList;