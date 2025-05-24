import React from 'react';
import DatePicker from 'react-datepicker';
import { format } from 'date-fns';
import { Calendar } from 'lucide-react';
import "react-datepicker/dist/react-datepicker.css";

interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (dates: [Date | null, Date | null]) => void;
  className?: string;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({ 
  startDate, 
  endDate, 
  onChange,
  className = ""
}) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Calendar className="w-4 h-4 text-gray-500" />
      <div className="relative inline-block">
        <DatePicker
          selectsRange={true}
          startDate={startDate}
          endDate={endDate}
          onChange={(dates) => onChange(dates)}
          dateFormat="yyyy-MM-dd"
          className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          wrapperClassName="date-range-wrapper"
          placeholderText="Select date range"
          isClearable={false}
          showMonthDropdown
          showYearDropdown
          dropdownMode="select"
        />
      </div>
    </div>
  );
};

export default DateRangePicker;