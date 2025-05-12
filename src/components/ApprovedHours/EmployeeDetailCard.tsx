import React from 'react';
import { format } from 'date-fns';
import { Calendar, Clock } from 'lucide-react';

interface EmployeeDetailCardProps {
  employee: any;
  doubleDays: string[];
}

const EmployeeDetailCard: React.FC<EmployeeDetailCardProps> = ({ employee, doubleDays }) => {
  // Calculate double-time hours
  const doubleTimeHours = employee.double_time_hours || 0;
  const regularHours = employee.total_hours || 0;
  const totalPayableHours = regularHours + doubleTimeHours;

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-800">{employee.name}</h3>
          <p className="text-gray-500">Employee #{employee.employee_number}</p>
        </div>
        
        <div className="flex flex-wrap gap-4">
          <div className="bg-gray-100 p-3 rounded-md">
            <p className="text-xs text-gray-500">Total Days</p>
            <p className="text-lg font-bold text-gray-800">{employee.total_days}</p>
          </div>
          
          <div className="bg-blue-50 p-3 rounded-md">
            <p className="text-xs text-blue-500">Regular Hours</p>
            <p className="text-lg font-bold text-blue-700">{regularHours.toFixed(2)}</p>
          </div>
          
          <div className="bg-amber-50 p-3 rounded-md">
            <div className="flex items-center gap-1">
              <p className="text-xs text-amber-500">Double-Time Hours</p>
              <span className="text-xs text-white bg-amber-500 rounded-full px-1 font-bold">2×</span>
            </div>
            <p className="text-lg font-bold text-amber-700">{doubleTimeHours.toFixed(2)}</p>
          </div>
          
          <div className="bg-green-50 p-3 rounded-md">
            <p className="text-xs text-green-500">Total Payable Hours</p>
            <p className="text-lg font-bold text-green-700">{totalPayableHours.toFixed(2)}</p>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-gray-200 rounded-md p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <Clock className="w-4 h-4 mr-2 text-purple-500" />
            Regular Days
          </h4>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {employee.working_week_dates?.filter((date: string) => !doubleDays.includes(date))
              .sort()
              .map((date: string) => (
                <div key={date} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">
                    {format(new Date(date), 'EEE, MMM d, yyyy')}
                  </span>
                  <span className="font-medium text-blue-600">
                    {(employee.hours_by_date?.[date] || 0).toFixed(2)} hrs
                  </span>
                </div>
              ))}
            {!employee.working_week_dates?.some((date: string) => !doubleDays.includes(date)) && (
              <p className="text-sm text-gray-500 italic">No regular days in this period</p>
            )}
          </div>
        </div>
        
        <div className="border border-gray-200 rounded-md p-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
            <Calendar className="w-4 h-4 mr-2 text-amber-500" />
            Double-Time Days
            <span className="ml-2 text-xs bg-amber-100 text-amber-800 rounded-full px-1.5 py-0.5 font-bold">2×</span>
          </h4>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {employee.working_week_dates?.filter((date: string) => doubleDays.includes(date))
              .sort()
              .map((date: string) => (
                <div key={date} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">
                    {format(new Date(date), 'EEE, MMM d, yyyy')}
                  </span>
                  <span className="font-medium text-amber-600">
                    {(employee.hours_by_date?.[date] || 0).toFixed(2)} × 2 = {((employee.hours_by_date?.[date] || 0) * 2).toFixed(2)} hrs
                  </span>
                </div>
              ))}
            {!employee.working_week_dates?.some((date: string) => doubleDays.includes(date)) && (
              <p className="text-sm text-gray-500 italic">No double-time days in this period</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmployeeDetailCard;