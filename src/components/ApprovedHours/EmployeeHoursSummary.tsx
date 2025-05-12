import React from 'react';
import { ChevronDown, ChevronRight, Calendar2 } from 'lucide-react';

interface EmployeeHoursSummaryProps {
  employee: {
    id: string;
    name: string;
    employee_number: string;
    total_days: number;
    total_hours: number;
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
  const avgHoursPerDay = employee.total_hours > 0 && employee.total_days > 0 
    ? parseFloat((employee.total_hours / employee.total_days).toFixed(2))
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
            <div className="font-medium text-gray-900 text-wrap-balance">{employee.name}</div>
            <div className="text-xs text-gray-500">#{employee.employee_number}</div>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2 mt-2">
          <div className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
            Days: <span className="font-medium">{employee.total_days}</span>
          </div>
          <div className="px-2 py-1 bg-purple-50 text-purple-700 rounded text-xs">
            Hours: <span className="font-medium">{employee.total_hours.toFixed(2)}</span>
          </div>
          {doubleTimeHours > 0 && (
            <div className="px-2 py-1 bg-amber-50 text-amber-700 rounded text-xs flex items-center">
              <Calendar2 className="w-3 h-3 mr-1" />
              <span className="font-bold text-xs">2×:</span>
              <span className="font-medium ml-1">{doubleTimeHours.toFixed(2)}</span>
            </div>
          )}
          <div className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs">
            Avg: <span className="font-medium">{avgHoursPerDay.toFixed(2)}/day</span>
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
          <div className="font-medium text-gray-900">{employee.name}</div>
          <div className="text-xs text-gray-500">#{employee.employee_number}</div>
        </div>
      </div>
      <div className="hidden sm:flex sm:items-center font-medium text-gray-800">{employee.total_days}</div>
      <div className="hidden sm:flex sm:items-center">
        <span className="font-medium text-gray-800">{employee.total_hours.toFixed(2)}</span>
        {doubleTimeHours > 0 && (
          <div className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs flex items-center">
            <span className="font-bold text-xs mr-1">2×:</span>
            {doubleTimeHours.toFixed(2)}
          </div>
        )}
      </div>
      <div className="hidden sm:flex sm:items-center text-gray-700">{avgHoursPerDay.toFixed(2)}</div>
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