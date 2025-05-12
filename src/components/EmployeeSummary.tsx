import React from 'react';
import { DailyRecord } from '../types';
import { Clock, Calendar, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';

interface EmployeeSummaryProps {
  days: DailyRecord[];
  doubleDays?: string[];
}

const EmployeeSummary: React.FC<EmployeeSummaryProps> = ({ days, doubleDays = [] }) => {
  // Only include days with hours > 0 for calculations and exclude OFF-DAYs
  const validDays = days.filter(day => day.hoursWorked > 0 && day.notes !== 'OFF-DAY');
  
  // Calculate totals
  const totalHours = parseFloat(validDays.reduce((sum, day) => sum + day.hoursWorked, 0).toFixed(2));
  const totalDays = validDays.length;
  const offDaysCount = days.filter(d => d.notes === 'OFF-DAY').length;
  const avgHoursPerDay = totalDays > 0 ? parseFloat((totalHours / totalDays).toFixed(2)) : 0;
  
  // Calculate double-time hours
  const doubleTimeHours = parseFloat(validDays.reduce((sum, day) => {
    // Check if the day is in doubleDays
    if (doubleDays.includes(day.date) || day.date.includes('2x')) {
      return sum + day.hoursWorked;
    }
    return sum;
  }, 0).toFixed(2));
  
  // Calculate total payable hours (regular + double-time)
  const totalPayableHours = totalHours + doubleTimeHours;
  
  // Count issues
  const lateDays = days.filter(d => d.isLate).length;
  const earlyLeaveDays = days.filter(d => d.earlyLeave).length;
  const missingRecordDays = days.filter(d => (d.missingCheckIn || d.missingCheckOut) && d.notes !== 'OFF-DAY').length;
  const overtimeDays = days.filter(d => d.excessiveOvertime).length;
  const penaltyDays = days.filter(d => d.penaltyMinutes > 0).length;
  const totalPenaltyHours = parseFloat((days.reduce((sum, day) => sum + day.penaltyMinutes, 0) / 60).toFixed(2));
  const approvedDays = days.filter(d => d.approved && d.notes !== 'OFF-DAY').length;
  const canteenLateDays = days.filter(d => {
    if (!d.firstCheckIn || d.shiftType !== 'canteen') return false;
    const hour = d.firstCheckIn.getHours();
    const minute = d.firstCheckIn.getMinutes();
    return ((hour === 7 && minute < 30) || (hour === 8 && minute < 30)) && d.isLate;
  }).length;

  return (
    <div className="bg-gray-50 p-4 border-t border-gray-200">
      <h3 className="text-sm font-medium text-gray-800 mb-3">Summary</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Hours Summary */}
        <div className="bg-white p-3 rounded-md border border-gray-200 shadow-sm">
          <div className="flex items-center text-purple-600 mb-2">
            <Clock className="w-4 h-4 mr-1" />
            <span className="text-xs font-medium uppercase">Working Hours</span>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-800">{totalPayableHours.toFixed(2)}</p>
            <p className="text-xs text-gray-500">Total Payable Hours</p>
          </div>
          <div className="mt-2 flex flex-col">
            <div className="flex justify-between">
              <p className="text-xs text-gray-500">Regular:</p>
              <p className="text-xs font-medium">{totalHours.toFixed(2)} hrs</p>
            </div>
            {doubleTimeHours > 0 && (
              <div className="flex justify-between">
                <p className="text-xs text-amber-600">Double-Time:</p>
                <p className="text-xs font-medium text-amber-600">+{doubleTimeHours.toFixed(2)} hrs</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Days Summary */}
        <div className="bg-white p-3 rounded-md border border-gray-200 shadow-sm">
          <div className="flex items-center text-green-600 mb-2">
            <Calendar className="w-4 h-4 mr-1" />
            <span className="text-xs font-medium uppercase">Days</span>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-800">{totalDays}</p>
            <p className="text-xs text-gray-500">Working Days</p>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{approvedDays} day{approvedDays !== 1 ? 's' : ''}</p>
              <p className="text-xs text-gray-500">Approved</p>
            </div>
            {offDaysCount > 0 && (
              <div className="ml-4">
                <p className="text-sm font-medium">{offDaysCount} day{offDaysCount !== 1 ? 's' : ''}</p>
                <p className="text-xs text-gray-500">OFF-DAYS</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Penalties Summary */}
        <div className="bg-white p-3 rounded-md border border-gray-200 shadow-sm">
          <div className="flex items-center text-red-600 mb-2">
            <AlertTriangle className="w-4 h-4 mr-1" />
            <span className="text-xs font-medium uppercase">Penalties</span>
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-800">{totalPenaltyHours.toFixed(2)}</p>
            <p className="text-xs text-gray-500">Penalty Hours</p>
          </div>
          <div className="mt-2">
            <p className="text-sm font-medium">{penaltyDays} day{penaltyDays !== 1 ? 's' : ''}</p>
            <p className="text-xs text-gray-500">With Penalties</p>
          </div>
        </div>
        
        {/* Issues Summary */}
        <div className="bg-white p-3 rounded-md border border-gray-200 shadow-sm">
          <div className="flex items-center text-amber-600 mb-2">
            <AlertCircle className="w-4 h-4 mr-1" />
            <span className="text-xs font-medium uppercase">Issues</span>
          </div>
          <div className="space-y-1 mt-1">
            {[
              { label: 'Late Days:', value: lateDays },
              { label: 'Canteen Late:', value: canteenLateDays },
              { label: 'Early Leave:', value: earlyLeaveDays },
              { label: 'Missing Records:', value: missingRecordDays },
              { label: 'Overtime Days:', value: overtimeDays }
            ].map((issue, i) => issue.value > 0 && (
              <div key={i} className="flex justify-between">
                <span className="text-xs">{issue.label}</span>
                <span className="text-xs font-medium">{issue.value}</span>
              </div>
            ))}
            
            {lateDays === 0 && canteenLateDays === 0 && earlyLeaveDays === 0 && 
             missingRecordDays === 0 && overtimeDays === 0 && (
              <div className="flex items-center text-green-600">
                <CheckCircle className="w-3 h-3 mr-1" />
                <span className="text-xs">No issues found</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeSummary;