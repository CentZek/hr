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
  
  // Get working days and off days counts
  const totalDays = employee.total_days || 0;
  const offDaysCount = employee.off_days_count || 0;
  const workingDays = employee.working_days !== undefined ? employee.working_days : (totalDays - offDaysCount);

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-800">{employee.name}</h3>
          <p className="text-base text-gray-600 font-medium">Employee #{employee.employee_number}</p>
        </div>
        
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-md">
            <div>
              <div className="text-sm text-gray-600 font-medium">Total Days</div>
              <div className="text-lg font-bold text-gray-800">{totalDays}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-md">
            <div>
              <div className="text-sm text-gray-600 font-medium">Working Days</div>
              <div className="text-lg font-bold text-gray-800">{workingDays}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-md">
            <div>
              <div className="text-sm text-gray-600 font-medium">Off Days</div>
              <div className="text-lg font-bold text-gray-800">{offDaysCount}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-md">
            <div>
              <div className="text-sm text-blue-600 font-semibold">Regular Hours</div>
              <div className="text-lg font-bold text-blue-900">{regularHours.toFixed(2)}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-md">
            <div>
              <div className="text-sm text-amber-600 font-semibold flex items-center">Double-Time Hours
                <span className="ml-1 text-sm text-white bg-amber-500 rounded-full px-1 font-bold">2×</span>
              </div>
              <div className="text-lg font-bold text-amber-900">{doubleTimeHours.toFixed(2)}</div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 rounded-md">
            <div>
              <div className="text-sm text-green-600 font-semibold">Total Hours</div>
              <div className="text-lg font-bold text-green-900">{totalPayableHours.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="border border-gray-200 rounded-md p-4">
        <h4 className="text-base font-semibold text-gray-700 mb-3 flex items-center">
          <Calendar className="w-4 h-4 mr-2 text-amber-500" />
          Double-Time Days
          <span className="ml-2 text-sm bg-amber-100 text-amber-800 rounded-full px-1.5 py-0.5 font-bold">2×</span>
        </h4>
        <div className="space-y-2 max-h-32 overflow-y-auto">
          {employee.working_week_dates?.filter((date: string) => doubleDays.includes(date))
            .sort()
            .map((date: string) => (
              <div key={date} className="flex justify-between items-center text-base">
                <span className="text-gray-700 font-medium">
                  {format(new Date(date), 'EEE, MMM d, yyyy')}
                </span>
                <span className="font-semibold text-amber-600">
                  {(employee.hours_by_date?.[date] || 0).toFixed(2)} × 2 = {((employee.hours_by_date?.[date] || 0) * 2).toFixed(2)} hrs
                </span>
              </div>
            ))}
          {!employee.working_week_dates?.some((date: string) => doubleDays.includes(date)) && (
            <p className="text-base text-gray-600 italic font-medium">No double-time days in this period</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeeDetailCard;