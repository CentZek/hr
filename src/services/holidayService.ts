import { supabase } from '../lib/supabase';
import { format, isFriday, parseISO, isValid } from 'date-fns';
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
    // Validate the date before proceeding
    if (!dateStr || !isValid(parseISO(dateStr))) {
      console.warn('Invalid date provided to isDoubleTimeDay:', dateStr);
      return false;
    }
    
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
let holidaysCache: string[] = [];
let lastCacheRefresh: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Pre-fetch all holidays and cache them
export const preloadHolidaysCache = async (): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('holidays')
      .select('date')
      .order('date');

    if (error) throw error;
    
    holidaysCache = data ? data.map(h => h.date) : [];
    lastCacheRefresh = Date.now();
    
    console.log(`Preloaded ${holidaysCache.length} holidays into cache`);
  } catch (error) {
    console.error('Error preloading holidays cache:', error);
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
  if (now - lastCacheRefresh > CACHE_TTL || holidaysCache.length === 0) {
    await preloadHolidaysCache();
  }
  
  try {
    // Get all holidays in the date range from cache
    const holidayDates = holidaysCache.filter(date => 
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
        doubleTimeDaysCache[dateStr] = isFriday(current) || holidayDates.includes(dateStr);
      }
      
      if (doubleTimeDaysCache[dateStr]) {
        allDates.push(dateStr);
      }
      
      current = new Date(current.getTime() + 86400000); // Add one day
    }
    
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
        
        // Insert holidays from backup - without the ID to avoid conflicts
        for (const holiday of backupData) {
          try {
            await supabase
              .from('holidays')
              .insert({
                date: holiday.date,
                description: holiday.description || null
              });
          } catch (insertError) {
            console.error(`Error restoring holiday ${holiday.date}:`, insertError);
          }
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
    
    // Process each holiday individually for backup
    for (const holiday of holidays) {
      try {
        // Check if holiday already exists in backup
        const { data: existing, error: checkError } = await supabase
          .from('holidays_backup')
          .select('id')
          .eq('date', holiday.date)
          .maybeSingle();
          
        if (checkError) {
          console.error(`Error checking holiday existence: ${holiday.date}`, checkError);
          continue;
        }
        
        const now = new Date().toISOString();
        
        if (existing) {
          // Update existing backup
          const { error: updateError } = await supabase
            .from('holidays_backup')
            .update({
              description: holiday.description,
              created_at: holiday.created_at,
              restored_at: now
            })
            .eq('id', existing.id);
            
          if (updateError) {
            console.error(`Error updating holiday backup: ${holiday.date}`, updateError);
          }
        } else {
          // Create new backup using single item insert
          const { error: insertError } = await supabase
            .from('holidays_backup')
            .insert({
              id: holiday.id,
              date: holiday.date,
              description: holiday.description,
              created_at: holiday.created_at,
              restored_at: now
            });
            
          if (insertError) {
            console.error(`Error backing up holiday: ${holiday.date}`, insertError);
          }
        }
      } catch (err) {
        console.error(`Error processing holiday backup for ${holiday.date}:`, err);
      }
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
  holidaysCache = [];
  lastCacheRefresh = 0;
  
  // Trigger preloading of holidays
  preloadHolidaysCache();
};

// Explicitly check if a date is Friday (for UI components that need direct access)
export const isDateFriday = (dateStr: string): boolean => {
  if (!dateStr || !isValid(parseISO(dateStr))) return false;
  return isFriday(parseISO(dateStr));
};