import React, { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, isToday, isFriday, eachDayOfInterval, getDay, isSameDay, subMonths, addMonths, parseISO } from 'date-fns';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, Info, X, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface HolidayCalendarProps {
  onHolidaysUpdated?: () => void;
}

interface Holiday {
  id: string;
  date: string;
  description?: string;
}

const HolidayCalendar: React.FC<HolidayCalendarProps> = ({ onHolidaysUpdated }) => {
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  // Fetch holidays from database
  useEffect(() => {
    fetchHolidays();
  }, []);

  const fetchHolidays = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .order('date');

      if (error) throw error;
      setHolidays(data || []);
    } catch (err) {
      console.error('Error fetching holidays:', err);
      toast.error('Failed to load holidays data');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle month navigation
  const previousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Handle date selection
  const handleDateSelect = (date: Date) => {
    // If date is already selected, unselect it
    if (selectedDate && isSameDay(selectedDate, date)) {
      setSelectedDate(null);
      return;
    }

    // Otherwise, select it
    setSelectedDate(date);
    
    // Clear any previous errors
    setError('');
  };

  // Add a holiday
  const handleAddHoliday = async () => {
    if (!selectedDate) {
      setError('Please select a date first');
      return;
    }

    setIsSaving(true);
    const formattedDate = format(selectedDate, 'yyyy-MM-dd');
    
    // Check if this date is already a holiday
    const existingHoliday = holidays.find(holiday => 
      holiday.date === formattedDate
    );

    try {
      if (existingHoliday) {
        // If it already exists, we don't need to update anything since we're
        // removing the description field
        toast.success('Date already marked as double-time');
      } else {
        // Add new holiday with just the date
        const { data, error } = await supabase
          .from('holidays')
          .insert([
            { date: formattedDate }
          ])
          .select();

        if (error) throw error;
        
        // Update local state
        if (data && data.length > 0) {
          setHolidays(prev => [...prev, data[0]]);
        }
        
        toast.success('Double-time day added successfully');
      }

      // Reset form
      setSelectedDate(null);
      
      // Notify parent component
      if (onHolidaysUpdated) {
        onHolidaysUpdated();
      }
    } catch (err) {
      console.error('Error saving holiday:', err);
      toast.error('Failed to save double-time day');
      setError('Failed to save double-time day. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete a holiday
  const handleDeleteHoliday = async (id: string) => {
    setIsDeleting(prev => ({ ...prev, [id]: true }));
    
    try {
      const { error } = await supabase
        .from('holidays')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      // Update local state
      setHolidays(prev => prev.filter(h => h.id !== id));
      toast.success('Double-time day removed successfully');
      
      // If the deleted holiday was the selected date, reset selection
      if (selectedDate) {
        const deletedHoliday = holidays.find(h => h.id === id);
        if (deletedHoliday && isSameDay(parseISO(deletedHoliday.date), selectedDate)) {
          setSelectedDate(null);
        }
      }
      
      // Notify parent component
      if (onHolidaysUpdated) {
        onHolidaysUpdated();
      }
    } catch (err) {
      console.error('Error deleting holiday:', err);
      toast.error('Failed to remove double-time day');
    } finally {
      setIsDeleting(prev => ({ ...prev, [id]: false }));
    }
  };

  // Check if a date is a holiday
  const isHoliday = (date: Date): boolean => {
    return holidays.some(holiday => 
      isSameDay(parseISO(holiday.date), date)
    );
  };

  // Check if a date is double-time (Friday or holiday)
  const isDoubleTimeDay = (date: Date): boolean => {
    return isFriday(date) || isHoliday(date);
  };

  // Render calendar days
  const renderCalendarDays = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const startDate = monthStart;
    const endDate = monthEnd;

    const dateFormat = 'd';
    const days = [];

    const daysInMonth = eachDayOfInterval({
      start: startDate,
      end: endDate
    });

    // Add empty cells for days before the start of the month
    const startDay = getDay(monthStart);
    for (let i = 0; i < startDay; i++) {
      days.push(
        <div key={`empty-${i}`} className="h-12 border border-transparent"></div>
      );
    }

    // Add the days of the month
    daysInMonth.forEach((day) => {
      const formattedDate = format(day, dateFormat);
      const isCurrentDay = isToday(day);
      const isSelectedDay = selectedDate && isSameDay(day, selectedDate);
      const isDayHoliday = isHoliday(day);
      const isDayFriday = isFriday(day);
      const isDouble = isDayFriday || isDayHoliday;
      
      days.push(
        <div
          key={day.toString()}
          className={`h-12 border rounded-md flex items-center justify-center relative cursor-pointer transition-colors
            ${isCurrentDay ? 'border-purple-500 font-bold' : 'border-gray-200'}
            ${isSelectedDay ? 'bg-purple-100 border-purple-400' : 'hover:bg-gray-50'}
            ${isDouble ? (isDayHoliday && !isDayFriday ? 'bg-red-50' : 'bg-amber-50') : ''}
          `}
          onClick={() => handleDateSelect(day)}
          title={isDayFriday ? 'Friday (Double Time)' : (isDayHoliday ? 'Holiday (Double Time)' : '')}
        >
          <span className={`text-sm ${isSelectedDay ? 'text-purple-800' : isDouble ? 'text-red-800' : ''}`}>
            {formattedDate}
          </span>
          {isDouble && (
            <span className="absolute top-1 right-1 flex items-center justify-center">
              <span className={`inline-flex items-center justify-center text-[10px] font-bold rounded-full
                ${isDayFriday && !isDayHoliday ? 'bg-amber-200 text-amber-800 h-4 w-4' : 'bg-red-200 text-red-800 h-4 w-4'}`}
              >
                2×
              </span>
            </span>
          )}
        </div>
      );
    });

    return days;
  };

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 bg-purple-600 text-white flex items-center justify-between">
        <h3 className="font-medium flex items-center">
          <CalendarIcon className="w-5 h-5 mr-2" />
          Double-Time Calendar
        </h3>
        {isLoading && (
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
        )}
      </div>
      
      <div className="p-4">
        {/* Info box */}
        <div className="bg-purple-50 border border-purple-100 rounded-md p-3 mb-4">
          <div className="flex">
            <Info className="w-5 h-5 text-purple-600 mr-2 flex-shrink-0" />
            <div className="text-sm text-purple-800">
              <p>All <span className="font-medium">Fridays</span> and <span className="font-medium">selected holidays</span> are double-time. Hours worked on these days will be calculated at 2× the regular rate.</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-amber-100 text-amber-800">
                  <span className="font-bold mr-1">2×</span> Friday
                </span>
                <span className="inline-flex items-center px-2 py-1 rounded-md text-xs bg-red-100 text-red-800">
                  <span className="font-bold mr-1">2×</span> Holiday
                </span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Calendar */}
        <div>
          {/* Calendar navigation */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={previousMonth}
              className="p-1 rounded-full hover:bg-gray-100"
            >
              <ChevronLeft className="h-5 w-5 text-gray-600" />
            </button>
            <h3 className="text-base font-medium text-gray-900">
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
            <button
              onClick={nextMonth}
              className="p-1 rounded-full hover:bg-gray-100"
            >
              <ChevronRight className="h-5 w-5 text-gray-600" />
            </button>
          </div>

          {/* Calendar weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, index) => (
              <div key={day} className="text-xs font-medium text-gray-500 text-center py-1">
                {day}
                {index === 5 && (
                  <span className="ml-1 inline-flex items-center justify-center font-bold text-[10px] bg-amber-200 text-amber-800 rounded-full h-4 w-4">
                    2×
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {renderCalendarDays()}
          </div>
        </div>
        
        {/* Add/Edit Holiday Form */}
        {selectedDate && (
          <div className="border-t border-gray-200 pt-4 mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              {isHoliday(selectedDate) ? 'Remove Double-Time Day' : 'Add Double-Time Day'}
              <span className="ml-2 text-sm font-normal text-gray-500">
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </span>
              {isFriday(selectedDate) && !isHoliday(selectedDate) && (
                <span className="ml-2 text-xs text-amber-600">
                  (Already double-time as Friday)
                </span>
              )}
            </h4>
            
            <div className="space-y-3">
              {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
              
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate(null);
                    setError('');
                  }}
                  className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                
                {isHoliday(selectedDate) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const holiday = holidays.find(h => 
                        isSameDay(parseISO(h.date), selectedDate)
                      );
                      if (holiday) {
                        handleDeleteHoliday(holiday.id);
                      }
                    }}
                    disabled={isSaving}
                    className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                  >
                    Remove Double-Time
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleAddHoliday}
                    disabled={isSaving}
                    className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <span className="flex items-center">
                        <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full mr-1"></span>
                        Saving...
                      </span>
                    ) : (
                      'Mark as Double-Time'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Holiday List */}
        <div className="mt-4 border-t border-gray-200 pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
            <Clock className="w-4 h-4 mr-1 text-purple-500" />
            Double-Time Days
            <span className="ml-2 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full">
              {holidays.length || 0}
            </span>
          </h4>
          
          {holidays.length === 0 ? (
            <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded">
              No additional double-time days have been marked yet. Select dates on the calendar to add them.
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {holidays.map((holiday) => (
                <div
                  key={holiday.id}
                  className="flex justify-between items-start p-2 bg-gray-50 rounded hover:bg-gray-100"
                >
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {format(parseISO(holiday.date), 'MMMM d, yyyy')}
                      <span className="ml-2 text-xs bg-red-100 text-red-800 px-1.5 py-0.5 rounded-full font-bold">
                        2×
                      </span>
                      {isFriday(parseISO(holiday.date)) && (
                        <span className="ml-1 text-xs text-amber-600">
                          (Friday)
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => handleDeleteHoliday(holiday.id)}
                    disabled={isDeleting[holiday.id]}
                    className="p-1 text-gray-400 hover:text-red-500 rounded-full hover:bg-red-50"
                    title="Delete holiday"
                  >
                    {isDeleting[holiday.id] ? (
                      <span className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full"></span>
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HolidayCalendar;