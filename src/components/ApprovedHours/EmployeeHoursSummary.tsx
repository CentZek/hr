import React from 'react';
import { format } from 'date-fns';
import { Calendar, Clock, Calendar as Calendar2, ChevronDown, ChevronRight } from 'lucide-react';

interface EmployeeHoursSummaryProps {
  employee: {
    id: string;
    name: string;
    employee_number: string;
    total_days: number;
    total_hours: number;
    working_days?: number; // Number of actual working days (total days minus off days)
    off_days_count?: number; // Number of off days
    double_time_hours?: number;
  };
  isExpanded: boolean;
  onExpand: () => void;
}

const EmployeeHoursSummary: React.FC<EmployeeHoursSummaryProps> = ({ 
  employee, 
  isExpanded, 
  onExpand 
}) => {
  // Calculate average hours per day - use working_days if available, otherwise total_days
  const workingDays = employee.working_days !== undefined ? employee.working_days : employee.total_days;
  const avgHoursPerDay = employee.total_hours > 0 && workingDays > 0 
    ? parseFloat((employee.total_hours / workingDays).toFixed(2))
    : 0;
    
  // Calculate double-time hours (if available)
  const doubleTimeHours = employee.double_time_hours || 0;
  
  // Calculate total payable hours (regular + double-time)
  const totalPayableHours = employee.total_hours + doubleTimeHours;

  return (
    <div 
      className={`grid grid-cols-1 sm:grid-cols-6 gap-2 p-4 ${isExpanded ? 'bg-purple-50' : 'hover:bg-gray-50'} cursor-pointer`}
      onClick={onExpand}
    >
      {/* Mobile View */}
      <div className="sm:hidden mb-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
            {isExpanded ? 
              <ChevronDown className="h-5 w-5" /> : 
              <ChevronRight className="h-5 w-5" />
            }
          </span>
          <div>
            <div className="font-bold text-gray-900 text-wrap-balance text-lg">{employee.name}</div>
            <div className="text-sm font-bold text-gray-500">#{employee.employee_number}</div>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-bold">
            Days: <span className="font-bold">{employee.total_days}</span>
          </div>
          {employee.off_days_count !== undefined && employee.off_days_count > 0 && (
            <div className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-bold">
              Off-Days: <span className="font-bold">{employee.off_days_count}</span>
            </div>
          )}
          {employee.working_days !== undefined && (
            <div className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-bold">
              Working: <span className="font-bold">{employee.working_days}</span>
            </div>
          )}
          <div className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs font-bold">
            Hours: <span className="font-bold">{employee.total_hours.toFixed(2)}</span>
          </div>
          {doubleTimeHours > 0 && (
            <div className="px-2 py-1 bg-amber-50 text-amber-700 rounded text-xs font-bold flex items-center">
              <Calendar2 className="w-3 h-3 mr-1" />
              <span className="font-bold text-xs">2×:</span>
              <span className="font-bold ml-1">{doubleTimeHours.toFixed(2)}</span>
            </div>
          )}
          <div className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-bold">
            Total: <span className="font-bold">{totalPayableHours.toFixed(2)}</span>
          </div>
          <div className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-bold">
            Avg: <span className="font-bold">{avgHoursPerDay.toFixed(2)}/day</span>
          </div>
        </div>
      </div>
      
      {/* Desktop View */}
      <div className="hidden sm:col-span-2 sm:flex sm:items-center sm:gap-2">
        <span className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600">
          {isExpanded ? 
            <ChevronDown className="h-5 w-5" /> : 
            <ChevronRight className="h-5 w-5" />
          }
        </span>
        <div>
          <div className="font-bold text-gray-900 text-lg">{employee.name}</div>
          <div className="text-sm font-bold text-gray-500">#{employee.employee_number}</div>
        </div>
      </div>
      <div className="hidden sm:flex sm:items-center sm:gap-2">
        <div className="font-bold text-gray-800">{employee.total_days}</div>
        {employee.off_days_count !== undefined && employee.off_days_count > 0 && (
          <div className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs font-bold flex items-center">
            <span>{employee.off_days_count} off</span>
          </div>
        )}
        {employee.working_days !== undefined && (
          <div className="ml-1 px-1.5 py-0.5 bg-green-50 text-green-700 rounded-full text-xs font-bold flex items-center">
            <span>{employee.working_days} work</span>
          </div>
        )}
      </div>
      <div className="hidden sm:flex sm:items-center">
        <div className="font-bold text-gray-800">
          <span className="mr-1">{totalPayableHours.toFixed(2)}</span>
          {doubleTimeHours > 0 && (
            <div className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs flex items-center">
              <span className="font-bold text-xs mr-1">2×:</span>
              {doubleTimeHours.toFixed(2)}
            </div>
          )}
        </div>
      </div>
      <div className="hidden sm:flex sm:items-center text-gray-700 font-bold">{avgHoursPerDay.toFixed(2)}</div>
      <div className="hidden sm:flex sm:items-center">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
        >
          {isExpanded ? 'Hide Details' : 'View Details'}
        </button>
      </div>
      
      {/* Mobile View Button (Only visible when needed) */}
      <div className="flex justify-center sm:hidden mt-2">
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          className="text-xs px-3 py-1.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200 w-full"
        >
          {isExpanded ? 'Hide Details' : 'View Details'}
        </button>
      </div>
    </div>
  );
};

export default EmployeeHoursSummary;