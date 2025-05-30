import { supabase } from '../lib/supabase';
import { format, isFriday, parseISO, isValid } from 'date-fns';
import { Holiday } from '../types';

// In-memory cache for double-time days and holidays
let doubleTimeDaysCache: Record<string, boolean> = {};
let holidaysCache: string[] = [];
let lastCacheRefresh: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Fetch all holidays from the database
export const fetchHolidays = async (): Promise<Holiday[]> => {
  try {
    // Check if we need to refresh cache
    const now = Date.now();
    if (now - lastCacheRefresh > CACHE_TTL || holidaysCache.length === 0) {
      await refreshHolidayCache();
    }
    
    // Return cached holidays as objects
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
    
    // Update the cache
    if (!holidaysCache.includes(date)) {
      holidaysCache.push(date);
    }
    
    // Clear the double-time days cache to ensure fresh calculations
    doubleTimeDaysCache = {};
    
    return data;
  } catch (error) {
    console.error('Error adding holiday:', error);
    throw error;
  }
};

// Delete a holiday
export const deleteHoliday = async (id: string): Promise<void> => {
  try {
    // First get the holiday date so we can remove it from cache
    const { data: holiday, error: fetchError } = await supabase
      .from('holidays')
      .select('date')
      .eq('id', id)
      .single();
      
    if (fetchError) throw fetchError;
    
    // Delete from database
    const { error } = await supabase
      .from('holidays')
      .delete()
      .eq('id', id);

    if (error) throw error;
    
    // Update cache
    if (holiday) {
      holidaysCache = holidaysCache.filter(date => date !== holiday.date);
      doubleTimeDaysCache = {}; // Clear double-time cache
    }
  } catch (error) {
    console.error('Error deleting holiday:', error);
    throw error;
  }
};

// Check if a date is a holiday
export const isHoliday = async (dateStr: string): Promise<boolean> => {
  // Check if we need to refresh cache
  const now = Date.now();
  if (now - lastCacheRefresh > CACHE_TTL || holidaysCache.length === 0) {
    await refreshHolidayCache();
  }
  
  return holidaysCache.includes(dateStr);
};

// Check if a date is a double-time day (Friday or holiday)
export const isDoubleTimeDay = async (dateStr: string): Promise<boolean> => {
  try {
    // Validate the date before proceeding
    if (!dateStr || !isValid(parseISO(dateStr))) {
      console.warn('Invalid date provided to isDoubleTimeDay:', dateStr);
      return false;
    }
    
    // Check cache first
    if (doubleTimeDaysCache[dateStr] !== undefined) {
      return doubleTimeDaysCache[dateStr];
    }
    
    const date = parseISO(dateStr);
    
    // First check if it's a Friday
    const isFri = isFriday(date);
    if (isFri) {
      doubleTimeDaysCache[dateStr] = true;
      return true;
    }
    
    // Check if we need to refresh holiday cache
    const now = Date.now();
    if (now - lastCacheRefresh > CACHE_TTL || holidaysCache.length === 0) {
      await refreshHolidayCache();
    }
    
    // Then check if it's a holiday using cache
    const isHol = holidaysCache.includes(dateStr);
    doubleTimeDaysCache[dateStr] = isHol;
    
    return isHol;
  } catch (error) {
    console.error('Error checking double-time day:', error);
    return false; // Default to false on error
  }
};

// Get all double-time days (Fridays and holidays) for a given date range
export const getDoubleTimeDays = async (startDate: string, endDate: string): Promise<string[]> => {
  // Validate input dates
  if (!startDate || !endDate) {
    console.warn('Missing date range parameters in getDoubleTimeDays:', { startDate, endDate });
    return [];
  }
  
  if (!isValid(parseISO(startDate)) || !isValid(parseISO(endDate))) {
    console.warn('Invalid date range provided to getDoubleTimeDays:', { startDate, endDate });
    return [];
  }
  
  // Check if cache needs refresh
  const now = Date.now();
  if (now - lastCacheRefresh > CACHE_TTL) {
    doubleTimeDaysCache = {}; // Clear cache
  }
  
  try {
    // Ensure holidays cache is up-to-date
    if (holidaysCache.length === 0) {
      await refreshHolidayCache();
    }
    
    // Get holidays in the date range
    const holidaysInRange = holidaysCache.filter(date => 
      date >= startDate && date <= endDate
    );
    
    // For each date in the range, check if it's a Friday
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    
    const allDates: string[] = [];
    let current = start;
    
    while (current <= end) {
      const dateStr = format(current, 'yyyy-MM-dd');
      
      // Check cache first
      if (doubleTimeDaysCache[dateStr] === undefined) {
        doubleTimeDaysCache[dateStr] = isFriday(current) || holidaysInRange.includes(dateStr);
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

// Refresh the holiday cache
export const refreshHolidayCache = async (): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('holidays')
      .select('date')
      .order('date');
      
    if (error) throw error;
    
    holidaysCache = data ? data.map(h => h.date) : [];
    lastCacheRefresh = Date.now();
    
    console.log(`Refreshed holiday cache with ${holidaysCache.length} holidays`);
  } catch (error) {
    console.error('Error refreshing holiday cache:', error);
    // Keep using existing cache if refresh fails
  }
};

// Calculate double-time hours based on records and dates
export const calculateDoubleTimeHours = (hours: number, dateStr: string, cachedDoubleDays?: string[]): number => {
  // Use cached double days if provided
  if (cachedDoubleDays?.includes(dateStr)) {
    return hours;
  }
  
  // Otherwise, check if it's a Friday
  if (!dateStr || !isValid(parseISO(dateStr))) {
    return 0; // If invalid date, return 0
  }
  
  const date = parseISO(dateStr);
  if (isFriday(date)) {
    return hours;
  }
  
  // If no cached days provided, do a direct check in doubleTimeDaysCache
  if (doubleTimeDaysCache[dateStr]) {
    return hours;
  }
  
  return 0; // Return 0 if not double-time
};

// Check if holidays need to be restored after reset
export const checkAndRestoreHolidays = async (): Promise<boolean> => {
  try {
    // Check if we have any holidays
    const { data: holidays, count, error } = await supabase
      .from('holidays')
      .select('*', { count: 'exact' });
      
    if (error) throw error;
    
    if (!holidays || holidays.length === 0 || count === 0) {
      console.log('No holidays found, attempting to restore from backup...');
      
      // Try to restore from backup table
      const { data: backupData, error: backupError } = await supabase
        .from('holidays_backup')
        .select('*');
        
      if (backupError) {
        console.error('Error fetching backup holidays:', backupError);
        return false;
      }
      
      if (backupData && backupData.length > 0) {
        console.log(`Found ${backupData.length} holidays in backup, restoring...`);
        
        // Insert holidays from backup
        const { error: insertError } = await supabase
          .from('holidays')
          .insert(
            backupData.map(h => ({
              date: h.date,
              description: h.description || null
            }))
          );
          
        if (insertError) {
          console.error('Error restoring holidays from backup:', insertError);
          return false;
        }
        
        console.log('Successfully restored holidays from backup');
        
        // After restoring, clear the cache to force a refresh
        refreshDoubleTimeDaysCache();
        
        return true;
      } else {
        console.log('No backup holiday data found');
        return false;
      }
    }
    
    console.log(`Holidays check: ${holidays.length} holidays found, no restoration needed`);
    return true;
  } catch (error) {
    console.error('Error checking/restoring holiday data:', error);
    return false;
  }
};

// Function to backup all current holidays
export const backupCurrentHolidays = async (): Promise<boolean> => {
  try {
    console.log('Starting holiday backup process...');
    
    // Fetch all current holidays
    const { data: holidays, error: fetchError } = await supabase
      .from('holidays')
      .select('*');
      
    if (fetchError) {
      console.error('Error fetching holidays for backup:', fetchError);
      return false;
    }
    
    if (!holidays || holidays.length === 0) {
      console.log('No holidays to backup');
      return true;
    }
    
    console.log(`Found ${holidays.length} holidays to backup`);
    
    // Delete existing backups to avoid duplicates
    const { error: deleteError } = await supabase
      .from('holidays_backup')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
      
    if (deleteError) {
      console.warn('Error clearing existing backups:', deleteError);
      // Continue anyway
    }
    
    // Batch insert all holidays to backup table
    const now = new Date().toISOString();
    const backupRecords = holidays.map(holiday => ({
      id: holiday.id,
      date: holiday.date,
      description: holiday.description,
      created_at: holiday.created_at,
      restored_at: now
    }));
    
    // Create new backup
    const { error: insertError } = await supabase
      .from('holidays_backup')
      .insert(backupRecords);
      
    if (insertError) {
      console.error('Error backing up holidays:', insertError);
      return false;
    }
    
    console.log(`Successfully backed up ${holidays.length} holidays`);
    return true;
  } catch (error) {
    console.error('Error in backupCurrentHolidays:', error);
    return false;
  }
};

// Force refresh of the double-time days cache
export const refreshDoubleTimeDaysCache = (): void => {
  console.log('Refreshing double-time days cache');
  doubleTimeDaysCache = {};
  lastCacheRefresh = 0;
};

// Explicitly check if a date is Friday (for UI components that need direct access)
export const isDateFriday = (dateStr: string): boolean => {
  if (!dateStr || !isValid(parseISO(dateStr))) return false;
  return isFriday(parseISO(dateStr));
};