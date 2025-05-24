import React, { useState } from 'react';
import { format, isValid, parse, isAfter, isBefore, addMonths, subMonths, addYears } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface DateRangePickerProps {
  startDate: Date | null;
  endDate: Date | null;
  onChange: (range: { startDate: Date | null; endDate: Date | null }) => void;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  startDate,
  endDate,
  onChange
}) => {
  const [focusedInput, setFocusedInput] = useState<'start' | 'end' | null>(null);
  const [viewDate, setViewDate] = useState<Date>(startDate || new Date());
  
  // Pre-defined date ranges
  const predefinedRanges = [
    { label: 'This Month', startDate: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1), endDate: () => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0) },
    { label: 'Last Month', startDate: () => new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), endDate: () => new Date(new Date().getFullYear(), new Date().getMonth(), 0) },
    { label: 'Last 3 Months', startDate: () => subMonths(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 2), endDate: () => new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0) },
    { label: 'Year to Date', startDate: () => new Date(new Date().getFullYear(), 0, 1), endDate: () => new Date() },
  ];

  const handleDateChange = (date: Date) => {
    if (focusedInput === 'start') {
      // If selecting start date and it's after end date, adjust end date
      const newEndDate = endDate && isAfter(date, endDate) ? date : endDate;
      onChange({ startDate: date, endDate: newEndDate });
      setFocusedInput('end');
    } else if (focusedInput === 'end') {
      // If selecting end date and it's before start date, don't allow
      if (startDate && isBefore(date, startDate)) {
        return;
      }
      onChange({ startDate, endDate: date });
      setFocusedInput(null);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'start' | 'end') => {
    const inputDate = e.target.value;
    try {
      // Try to parse the date
      const parsedDate = parse(inputDate, 'yyyy-MM-dd', new Date());
      if (isValid(parsedDate)) {
        if (type === 'start') {
          onChange({ startDate: parsedDate, endDate });
        } else {
          if (startDate && isAfter(parsedDate, startDate)) {
            onChange({ startDate, endDate: parsedDate });
          }
        }
      }
    } catch (error) {
      console.error('Invalid date format:', error);
    }
  };

  // Navigation functions
  const prevMonth = () => setViewDate(subMonths(viewDate, 1));
  const nextMonth = () => setViewDate(addMonths(viewDate, 1));
  const prevYear = () => setViewDate(subMonths(viewDate, 12));
  const nextYear = () => setViewDate(addMonths(viewDate, 12));

  // Generate days for the calendar
  const generateCalendarDays = () => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    
    // Get first day of month and how many days to show from previous month
    const firstDayOfMonth = new Date(year, month, 1);
    const startingDayOfWeek = firstDayOfMonth.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Get last day of month
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const totalDaysInMonth = lastDayOfMonth.getDate();
    
    // Previous month days to display
    const prevMonthDays = [];
    if (startingDayOfWeek > 0) {
      const prevMonth = new Date(year, month, 0);
      const prevMonthTotalDays = prevMonth.getDate();
      
      for (let i = prevMonthTotalDays - startingDayOfWeek + 1; i <= prevMonthTotalDays; i++) {
        prevMonthDays.push({
          date: new Date(year, month - 1, i),
          isCurrentMonth: false,
          isPrevMonth: true
        });
      }
    }
    
    // Current month days
    const currentMonthDays = [];
    for (let i = 1; i <= totalDaysInMonth; i++) {
      currentMonthDays.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
        isPrevMonth: false,
        isNextMonth: false
      });
    }
    
    // Calculate how many next month days we need to fill the calendar grid
    const totalCurrentDays = prevMonthDays.length + currentMonthDays.length;
    const nextMonthDaysNeeded = Math.ceil(totalCurrentDays / 7) * 7 - totalCurrentDays;
    
    // Next month days
    const nextMonthDays = [];
    for (let i = 1; i <= nextMonthDaysNeeded; i++) {
      nextMonthDays.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
        isNextMonth: true
      });
    }
    
    return [...prevMonthDays, ...currentMonthDays, ...nextMonthDays];
  };

  const calendarDays = generateCalendarDays();

  const isPastDate = (date: Date) => {
    return isBefore(date, new Date(new Date().setHours(0, 0, 0, 0)));
  };

  const isDayInRange = (day: Date) => {
    if (!startDate || !endDate) return false;
    return (
      isAfter(day, startDate) && 
      isBefore(day, endDate) || 
      isSameDay(day, startDate) || 
      isSameDay(day, endDate)
    );
  };

  const isSameDay = (date1: Date, date2: Date) => {
    return date1.getDate() === date2.getDate() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
  };

  // Apply a predefined date range
  const applyPredefinedRange = (index: number) => {
    const range = predefinedRanges[index];
    onChange({
      startDate: range.startDate(),
      endDate: range.endDate()
    });
    setFocusedInput(null);
  };
  
  // Week day headers
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-4">
      {/* Pre-defined ranges */}
      <div className="flex flex-wrap gap-2">
        {predefinedRanges.map((range, index) => (
          <button
            key={index}
            onClick={() => applyPredefinedRange(index)}
            className="px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
          >
            {range.label}
          </button>
        ))}
      </div>
      
      {/* Date inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="start-date" className="block text-xs text-gray-500 mb-1">Start Date</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Calendar className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="date"
              id="start-date"
              value={startDate ? format(startDate, 'yyyy-MM-dd') : ''}
              onChange={(e) => handleInputChange(e, 'start')}
              onClick={() => setFocusedInput('start')}
              className="block w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
            />
          </div>
        </div>
        <div>
          <label htmlFor="end-date" className="block text-xs text-gray-500 mb-1">End Date</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Calendar className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type="date"
              id="end-date"
              value={endDate ? format(endDate, 'yyyy-MM-dd') : ''}
              onChange={(e) => handleInputChange(e, 'end')}
              onClick={() => setFocusedInput('end')}
              className="block w-full pl-10 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
            />
          </div>
        </div>
      </div>
      
      {/* Calendar */}
      <div className="bg-white border border-gray-200 rounded-md shadow-sm">
        {/* Calendar header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200">
          <div className="flex items-center">
            <button onClick={prevYear} className="p-1 rounded-full hover:bg-gray-100">
              <ChevronsLeft className="h-4 w-4 text-gray-600" />
            </button>
            <button onClick={prevMonth} className="p-1 rounded-full hover:bg-gray-100">
              <ChevronLeft className="h-4 w-4 text-gray-600" />
            </button>
          </div>
          <div className="text-sm font-medium">{format(viewDate, 'MMMM yyyy')}</div>
          <div className="flex items-center">
            <button onClick={nextMonth} className="p-1 rounded-full hover:bg-gray-100">
              <ChevronRight className="h-4 w-4 text-gray-600" />
            </button>
            <button onClick={nextYear} className="p-1 rounded-full hover:bg-gray-100">
              <ChevronsRight className="h-4 w-4 text-gray-600" />
            </button>
          </div>
        </div>
        
        {/* Calendar grid */}
        <div className="p-3">
          {/* Week day headers */}
          <div className="grid grid-cols-7 mb-1">
            {weekDays.map(day => (
              <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar days */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => {
              const isSelected = startDate && endDate && isDayInRange(day.date);
              const isStartDate = startDate && isSameDay(day.date, startDate);
              const isEndDate = endDate && isSameDay(day.date, endDate);
              const isToday = isSameDay(day.date, new Date());
              
              return (
                <button
                  key={index}
                  onClick={() => handleDateChange(day.date)}
                  className={`
                    h-8 w-full flex items-center justify-center text-xs rounded
                    ${!day.isCurrentMonth ? 'text-gray-400' : 'text-gray-700'}
                    ${isSelected ? 'bg-purple-100' : 'hover:bg-gray-100'}
                    ${(isStartDate || isEndDate) ? 'bg-purple-600 text-white hover:bg-purple-700' : ''}
                    ${isToday && !isSelected && !isStartDate && !isEndDate ? 'border border-purple-500' : ''}
                  `}
                >
                  {day.date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
        
        {/* Selected range display */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
          {startDate && endDate ? (
            <div>
              <span className="font-medium">Selected Range:</span> {format(startDate, 'MMM d, yyyy')} - {format(endDate, 'MMM d, yyyy')}
            </div>
          ) : (
            <div>Please select a date range</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DateRangePicker;