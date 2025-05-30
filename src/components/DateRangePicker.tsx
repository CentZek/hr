import React, { useState, useEffect } from 'react';
import { format, addDays, subDays, addMonths, subMonths, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday, isBefore, isAfter, parseISO, isValid } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight, X, Check, Calendar as CalendarIcon } from 'lucide-react';

interface DateRangePickerProps {
  onSelect: (startDate: string, endDate: string) => void;
  initialStartDate?: string;
  initialEndDate?: string;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({ 
  onSelect,
  initialStartDate = '',
  initialEndDate = ''
}) => {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState<Date>(today);
  const [selectedStartDate, setSelectedStartDate] = useState<Date | null>(null);
  const [selectedEndDate, setSelectedEndDate] = useState<Date | null>(null);
  const [hoverDate, setHoverDate] = useState<Date | null>(null);
  const [selectionStep, setSelectionStep] = useState<'start' | 'end'>('start');

  // Parse initial dates if provided
  useEffect(() => {
    if (initialStartDate && isValid(parseISO(initialStartDate))) {
      setSelectedStartDate(parseISO(initialStartDate));
      setSelectionStep('end');
    }
    
    if (initialEndDate && isValid(parseISO(initialEndDate))) {
      setSelectedEndDate(parseISO(initialEndDate));
    }
  }, [initialStartDate, initialEndDate]);

  // Navigation handlers
  const previousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Date selection handlers
  const handleDateClick = (date: Date) => {
    if (selectionStep === 'start') {
      // Start new selection
      setSelectedStartDate(date);
      setSelectedEndDate(null);
      setSelectionStep('end');
    } else {
      // Complete selection
      if (selectedStartDate && isBefore(date, selectedStartDate)) {
        // If end date is before start date, swap them
        setSelectedEndDate(selectedStartDate);
        setSelectedStartDate(date);
      } else {
        setSelectedEndDate(date);
      }
      setSelectionStep('start');
      
      // Call onSelect with the formatted dates
      if (selectedStartDate) {
        const startFormatted = format(selectedStartDate, 'yyyy-MM-dd');
        const endFormatted = format(date, 'yyyy-MM-dd');
        onSelect(startFormatted, endFormatted);
      }
    }
  };

  const handleDateHover = (date: Date) => {
    if (selectionStep === 'end') {
      setHoverDate(date);
    } else {
      setHoverDate(null);
    }
  };

  const isInRange = (date: Date) => {
    if (selectedStartDate && selectedEndDate) {
      return isAfter(date, selectedStartDate) && isBefore(date, selectedEndDate);
    }
    
    if (selectedStartDate && hoverDate) {
      return (
        isAfter(date, selectedStartDate) && isBefore(date, hoverDate) ||
        isAfter(date, hoverDate) && isBefore(date, selectedStartDate)
      );
    }
    
    return false;
  };

  // Generate days for the calendar
  const renderCalendarDays = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const startDate = monthStart;
    const endDate = monthEnd;

    const dateFormat = 'd';
    const rows: React.ReactNode[] = [];
    let days: React.ReactNode[] = [];
    
    // Get all days in the month
    const daysInMonth = eachDayOfInterval({ start: startDate, end: endDate });
    
    // Add empty cells for days before the start of the month
    const startDay = getDay(monthStart);
    for (let i = 0; i < startDay; i++) {
      days.push(
        <div key={`empty-start-${i}`} className="h-10 w-10"></div>
      );
    }

    // Add days of the month
    daysInMonth.forEach((day, dayIndex) => {
      const formattedDate = format(day, dateFormat);
      const isSelectedStart = selectedStartDate ? isSameDay(day, selectedStartDate) : false;
      const isSelectedEnd = selectedEndDate ? isSameDay(day, selectedEndDate) : false;
      const isRangeDay = isInRange(day);
      const isDayToday = isToday(day);
      
      days.push(
        <div
          key={day.toString()}
          onClick={() => handleDateClick(day)}
          onMouseEnter={() => handleDateHover(day)}
          className={`
            h-10 w-10 relative flex items-center justify-center 
            ${isSelectedStart || isSelectedEnd ? 'font-bold' : ''}
            ${isDayToday ? 'text-blue-700' : ''}
            cursor-pointer select-none
          `}
        >
          <div 
            className={`
              absolute inset-0 rounded-full 
              ${isSelectedStart ? 'bg-purple-600 text-white' : ''}
              ${isSelectedEnd ? 'bg-purple-600 text-white' : ''}
              ${isRangeDay ? 'bg-purple-100' : ''}
              ${isSelectedStart || isSelectedEnd ? 'z-10' : ''}
              flex items-center justify-center
            `}
          >
            {formattedDate}
          </div>
          
          {/* Show a connecting rectangle between selected days */}
          {isSelectedStart && (selectedEndDate || hoverDate) && (
            <div className="absolute right-0 w-1/2 h-full bg-purple-100 -z-10"></div>
          )}
          
          {isSelectedEnd && selectedStartDate && (
            <div className="absolute left-0 w-1/2 h-full bg-purple-100 -z-10"></div>
          )}
          
          {isRangeDay && (
            <div className="absolute inset-0 bg-purple-100 -z-10"></div>
          )}
        </div>
      );
      
      // Break into rows after 7 days (or at the end)
      if ((startDay + dayIndex + 1) % 7 === 0 || dayIndex === daysInMonth.length - 1) {
        rows.push(
          <div key={`row-${dayIndex}`} className="grid grid-cols-7 gap-0">
            {days}
          </div>
        );
        days = [];
      }
    });

    return rows;
  };

  // Predefined date range options
  const predefinedRanges = [
    { label: 'Today', action: () => {
      const today = new Date();
      setSelectedStartDate(today);
      setSelectedEndDate(today);
      onSelect(format(today, 'yyyy-MM-dd'), format(today, 'yyyy-MM-dd'));
      setSelectionStep('start');
    }},
    { label: 'Yesterday', action: () => {
      const yesterday = subDays(new Date(), 1);
      setSelectedStartDate(yesterday);
      setSelectedEndDate(yesterday);
      onSelect(format(yesterday, 'yyyy-MM-dd'), format(yesterday, 'yyyy-MM-dd'));
      setSelectionStep('start');
    }},
    { label: 'Last 7 days', action: () => {
      const end = new Date();
      const start = subDays(end, 6);
      setSelectedStartDate(start);
      setSelectedEndDate(end);
      onSelect(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      setSelectionStep('start');
    }},
    { label: 'This month', action: () => {
      const today = new Date();
      const start = startOfMonth(today);
      setSelectedStartDate(start);
      setSelectedEndDate(today);
      onSelect(format(start, 'yyyy-MM-dd'), format(today, 'yyyy-MM-dd'));
      setSelectionStep('start');
    }},
    { label: 'Last month', action: () => {
      const today = new Date();
      const lastMonth = subMonths(today, 1);
      const start = startOfMonth(lastMonth);
      const end = endOfMonth(lastMonth);
      setSelectedStartDate(start);
      setSelectedEndDate(end);
      onSelect(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      setSelectionStep('start');
    }},
  ];

  // Reset selection
  const resetSelection = () => {
    setSelectedStartDate(null);
    setSelectedEndDate(null);
    setSelectionStep('start');
  };

  // Apply selection
  const applySelection = () => {
    if (selectedStartDate && selectedEndDate) {
      onSelect(
        format(selectedStartDate, 'yyyy-MM-dd'),
        format(selectedEndDate, 'yyyy-MM-dd')
      );
    } else if (selectedStartDate) {
      // If only start date is selected, use it for both
      const dateStr = format(selectedStartDate, 'yyyy-MM-dd');
      onSelect(dateStr, dateStr);
    }
  };

  return (
    <div className="bg-white rounded-lg overflow-hidden">
      <div className="flex">
        {/* Predefined ranges sidebar */}
        <div className="hidden sm:block w-48 bg-gray-50 p-4 border-r border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Quick select</h3>
          <div className="space-y-2">
            {predefinedRanges.map((range, index) => (
              <button
                key={index}
                onClick={range.action}
                className="w-full text-left px-2 py-1 text-sm text-gray-700 hover:bg-gray-200 rounded"
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Calendar */}
        <div className="flex-1 p-4">
          <div className="flex items-center justify-between mb-4">
            <button onClick={previousMonth} className="p-1 hover:bg-gray-100 rounded-full">
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <h2 className="text-lg font-medium text-gray-900">
              {format(currentMonth, 'MMMM yyyy')}
            </h2>
            <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-full">
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
          
          {/* Days of week header */}
          <div className="grid grid-cols-7 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div
                key={day}
                className="h-10 flex items-center justify-center text-sm font-medium text-gray-500"
              >
                {day}
              </div>
            ))}
          </div>
          
          {/* Calendar grid */}
          <div className="mb-4">
            {renderCalendarDays()}
          </div>
          
          {/* Selection info and buttons */}
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex justify-between mb-4 text-sm">
              <div>
                <div className="text-gray-500 mb-1">Start date</div>
                <div className="font-medium">
                  {selectedStartDate 
                    ? format(selectedStartDate, 'MMMM d, yyyy') 
                    : '(Not selected)'}
                </div>
              </div>
              <div>
                <div className="text-gray-500 mb-1">End date</div>
                <div className="font-medium">
                  {selectedEndDate 
                    ? format(selectedEndDate, 'MMMM d, yyyy') 
                    : selectionStep === 'end' ? '(Select end date)' : '(Not selected)'}
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={resetSelection}
                className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900"
              >
                Reset
              </button>
              <button
                onClick={applySelection}
                disabled={!selectedStartDate}
                className="px-4 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                <Check className="w-4 h-4 mr-1" />
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Mobile Quick Select */}
      <div className="sm:hidden p-4 border-t border-gray-200">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Quick select</h3>
        <div className="grid grid-cols-2 gap-2">
          {predefinedRanges.map((range, index) => (
            <button
              key={index}
              onClick={range.action}
              className="px-2 py-1.5 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DateRangePicker;