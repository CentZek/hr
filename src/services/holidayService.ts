import { supabase } from '../lib/supabase';
import { format, isFriday, parseISO } from 'date-fns';
import { Holiday } from '../types';

// Fetch all holidays from the database
export const fetchHolidays = async (): Promise<Holiday[]> => {
  try {
    const { data, error } = await supabase
      .from('holidays')
      .select('*')
      .order('date');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching holidays:', error);
    throw error;
  }
};

// Add a new holiday
export const addHoliday = async (date: string): Promise<Holiday> => {
  try {
    const { data, error } = await supabase
      .from('holidays')
      .insert([{ date }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error adding holiday:', error);
    throw error;
  }
};

// Delete a holiday
export const deleteHoliday = async (id: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('holidays')
      .delete()
      .eq('id', id);

    if (error) throw error;
  } catch (error) {
    console.error('Error deleting holiday:', error);
    throw error;
  }
};

// Check if a date is a double-time day (Friday or holiday)
export const isDoubleTimeDay = async (dateStr: string): Promise<boolean> => {
  try {
    const date = parseISO(dateStr);
    
    // First check if it's a Friday
    if (isFriday(date)) {
      return true;
    }
    
    // Then check if it's a holiday
    const { data, error } = await supabase
      .from('holidays')
      .select('id')
      .eq('date', dateStr)
      .maybeSingle();

    if (error) throw error;
    
    return !!data; // Return true if holiday exists, false otherwise
  } catch (error) {
    console.error('Error checking double-time day:', error);
    return false; // Default to false on error
  }
};

// In-memory cache for double-time days
let doubleTimeDaysCache: Record<string, boolean> = {};
let lastCacheRefresh: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Get all double-time days (Fridays and holidays) for a given month range
export const getDoubleTimeDays = async (startDate: string, endDate: string): Promise<string[]> => {
  // Check if cache needs refresh
  const now = Date.now();
  if (now - lastCacheRefresh > CACHE_TTL) {
    doubleTimeDaysCache = {}; // Clear cache
  }
  
  try {
    // Get all holidays in the date range
    const { data: holidays, error } = await supabase
      .from('holidays')
      .select('date')
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;
    
    // Create an array of holiday dates
    const holidayDates = holidays?.map(h => h.date) || [];
    
    // For each date in the range, check if it's a Friday
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    
    const allDates: string[] = [];
    let current = start;
    
    while (current <= end) {
      const dateStr = format(current, 'yyyy-MM-dd');
      
      // Check cache first
      if (doubleTimeDaysCache[dateStr] === undefined) {
        doubleTimeDaysCache[dateStr] = isFriday(current) || holidayDates.includes(dateStr);
      }
      
      if (doubleTimeDaysCache[dateStr]) {
        allDates.push(dateStr);
      }
      
      current = new Date(current.getTime() + 86400000); // Add one day
    }
    
    // Update cache timestamp
    lastCacheRefresh = now;
    
    return allDates;
  } catch (error) {
    console.error('Error getting double-time days:', error);
    return [];
  }
};

// Calculate double-time hours based on records and dates
export const calculateDoubleTimeHours = (hours: number, dateStr: string, cachedDoubleDays?: string[]): number => {
  // Use cached double days if provided
  if (cachedDoubleDays?.includes(dateStr)) {
    return hours * 2;
  }
  
  // Otherwise, check if it's a Friday
  const date = parseISO(dateStr);
  if (isFriday(date)) {
    return hours * 2;
  }
  
  // If no cached days provided, do a direct check in doubleTimeDaysCache
  if (doubleTimeDaysCache[dateStr]) {
    return hours * 2;
  }
  
  return hours; // Return original hours if not double-time
};