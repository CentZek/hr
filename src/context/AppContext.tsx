import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { EmployeeRecord } from '../types';
import { 
  getStorageItem, 
  setStorageItem, 
  clearAppStorage, 
  initializeStorage,
  validateAndFixStorage,
  StorageType,
  getCurrentStorageType
} from '../utils/storage';
import { isLocalStorageSupported, isIndexedDBSupported } from '../utils/browserDetection';

interface AppContextType {
  // HR page state
  employeeRecords: EmployeeRecord[];
  setEmployeeRecords: React.Dispatch<React.SetStateAction<EmployeeRecord[]>>;
  hasUploadedFile: boolean;
  setHasUploadedFile: React.Dispatch<React.SetStateAction<boolean>>;
  currentFileName: string;
  setCurrentFileName: React.Dispatch<React.SetStateAction<string>>;
  totalEmployees: number;
  setTotalEmployees: React.Dispatch<React.SetStateAction<number>>;
  totalDays: number;
  setTotalDays: React.Dispatch<React.SetStateAction<number>>;
  
  // Other shared state
  clearData: () => void;
  storageInitialized: boolean;
  storageError: string | null;
  retryStorage: () => void;
  storageType: StorageType;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // HR page state
  const [employeeRecords, setEmployeeRecords] = useState<EmployeeRecord[]>([]);
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalDays, setTotalDays] = useState(0);
  
  // Storage status
  const [storageInitialized, setStorageInitialized] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastSaveTime, setLastSaveTime] = useState<number>(0);
  const [lastSaveAttempt, setLastSaveAttempt] = useState<number>(0);
  const [storageType, setStorageType] = useState<StorageType>(StorageType.MEMORY);
  const [isLoadingStorage, setIsLoadingStorage] = useState(true);
  
  // Initialize storage on component mount
  useEffect(() => {
    const initStorage = async () => {
      try {
        setIsLoadingStorage(true);
        
        // Check if storage is available
        const currentStorageType = getCurrentStorageType();
        setStorageType(currentStorageType);
        
        if (currentStorageType === StorageType.MEMORY) {
          console.warn('Using memory storage fallback. Your data will not persist across page reloads.');
        }
        
        // Initialize storage with version check
        await initializeStorage();
        
        // Validate and fix any corrupted storage
        await validateAndFixStorage();
        
        // Load data from storage
        await loadFromStorage();
        
        setStorageInitialized(true);
        setStorageError(null);
      } catch (error) {
        console.error('Error initializing context:', error);
        setStorageError('Failed to initialize application storage. Your data may not be saved.');
      } finally {
        setIsLoadingStorage(false);
      }
    };
    
    initStorage();
  }, []);

  // Load data from storage
  const loadFromStorage = async () => {
    try {
      // Use getStorageItem with type safety and defaults
      const savedEmployeeRecords = await getStorageItem<EmployeeRecord[]>('employeeRecords', []);
      const savedHasUploadedFile = await getStorageItem<boolean>('hasUploadedFile', false);
      const savedCurrentFileName = await getStorageItem<string>('currentFileName', '');
      const savedTotalEmployees = await getStorageItem<number>('totalEmployees', 0);
      const savedTotalDays = await getStorageItem<number>('totalDays', 0);

      // Validate employee records array
      if (Array.isArray(savedEmployeeRecords)) {
        setEmployeeRecords(savedEmployeeRecords);
      } else {
        console.warn('Invalid employeeRecords format in storage, using empty array');
        setEmployeeRecords([]);
      }
      
      setHasUploadedFile(Boolean(savedHasUploadedFile));
      setCurrentFileName(String(savedCurrentFileName || ''));
      setTotalEmployees(Number(savedTotalEmployees || 0));
      setTotalDays(Number(savedTotalDays || 0));
      
      console.log('Successfully loaded data from storage');
    } catch (error) {
      console.error('Error loading data from storage:', error);
      // Reset to defaults on error
      setEmployeeRecords([]);
      setHasUploadedFile(false);
      setCurrentFileName('');
      setTotalEmployees(0);
      setTotalDays(0);
      setStorageError('Failed to load saved data. Starting with empty state.');
    }
  };

  // Retry storage initialization when there was an error
  const retryStorage = useCallback(async () => {
    try {
      setStorageError(null);
      
      // Try to validate and fix storage
      await validateAndFixStorage();
      
      // Load data from storage
      await loadFromStorage();
      
      setStorageInitialized(true);
    } catch (error) {
      console.error('Error retrying storage initialization:', error);
      setStorageError('Still having trouble with data storage. Your data may not be saved.');
    }
  }, []);

  // Save data with throttling to prevent excessive storage operations
  const saveToStorage = useCallback(async () => {
    try {
      // Don't save too frequently
      const now = Date.now();
      if (now - lastSaveAttempt < 500) {
        return; // Skip if less than 500ms since last attempt
      }
      
      setLastSaveAttempt(now);
      
      // Use Promise.all for parallel saves
      const savePromises = [
        setStorageItem('employeeRecords', employeeRecords),
        setStorageItem('hasUploadedFile', hasUploadedFile),
        setStorageItem('currentFileName', currentFileName),
        setStorageItem('totalEmployees', totalEmployees),
        setStorageItem('totalDays', totalDays),
        setStorageItem('lastSyncTimestamp', now)
      ];
      
      // Wait for all saves to complete
      const results = await Promise.all(savePromises);
      
      // Check if all saves were successful
      if (results.every(result => result)) {
        setStorageError(null);
        setLastSaveTime(now);
      } else {
        throw new Error('Some storage operations failed');
      }
    } catch (error) {
      console.error('Error saving data to storage:', error);
      setStorageError('Having trouble saving your data. Your changes may not persist when you leave this page.');
    }
  }, [
    employeeRecords, 
    hasUploadedFile, 
    currentFileName, 
    totalEmployees, 
    totalDays, 
    lastSaveAttempt
  ]);

  // Save data to storage when it changes, with debouncing
  useEffect(() => {
    // Skip saving during initialization
    if (!storageInitialized || isLoadingStorage) return;
    
    // Debounce saves to prevent excessive writes
    const timerId = setTimeout(() => {
      saveToStorage();
    }, 1000);
    
    return () => clearTimeout(timerId);
  }, [
    storageInitialized, 
    isLoadingStorage, 
    employeeRecords, 
    hasUploadedFile, 
    currentFileName, 
    totalEmployees, 
    totalDays, 
    saveToStorage
  ]);

  // Function to clear all data
  const clearData = useCallback(async () => {
    try {
      // Update state
      setEmployeeRecords([]);
      setHasUploadedFile(false);
      setCurrentFileName('');
      setTotalEmployees(0);
      setTotalDays(0);
      
      // Clear storage
      await clearAppStorage();
      
      setStorageError(null);
    } catch (error) {
      console.error('Error clearing data:', error);
      setStorageError('Failed to clear data completely.');
    }
  }, []);

  return (
    <AppContext.Provider
      value={{
        employeeRecords,
        setEmployeeRecords,
        hasUploadedFile,
        setHasUploadedFile,
        currentFileName,
        setCurrentFileName,
        totalEmployees,
        setTotalEmployees,
        totalDays,
        setTotalDays,
        clearData,
        storageInitialized,
        storageError,
        retryStorage,
        storageType
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};