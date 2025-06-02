import React, { createContext, useContext, useState, useEffect } from 'react';
import { EmployeeRecord } from '../types';
import { 
  saveProcessedExcelFile,
  getActiveProcessedFile,
  getProcessedEmployees,
  updateProcessedEmployeeData,
  deleteProcessedExcelData
} from '../services/excelDataService';
import { supabase } from '../lib/supabase';

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
  
  // Supabase integration
  activeFileId: string | null;
  setActiveFileId: React.Dispatch<React.SetStateAction<string | null>>;
  isLoading: boolean;
  
  // Actions
  saveToSupabase: (fileName: string, records: EmployeeRecord[]) => Promise<boolean>;
  updateInSupabase: (records: EmployeeRecord[]) => Promise<boolean>;
  clearData: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // HR page state
  const [employeeRecords, setEmployeeRecords] = useState<EmployeeRecord[]>([]);
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalDays, setTotalDays] = useState(0);
  
  // Supabase integration
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load active file data from Supabase on initial render
  useEffect(() => {
    const loadActiveFileData = async () => {
      try {
        setIsLoading(true);
        
        // First check if we have an active file ID in localStorage
        const storedFileId = localStorage.getItem('activeFileId');
        
        if (storedFileId) {
          // Verify the file still exists in the database
          const { data: fileVerify } = await supabase
            .from('processed_excel_files')
            .select('id')
            .eq('id', storedFileId)
            .maybeSingle();
            
          if (!fileVerify) {
            // File doesn't exist anymore, clear localStorage and reset state
            console.log('File ID in localStorage no longer exists in database');
            localStorage.removeItem('activeFileId');
            localStorage.removeItem('currentFileName');
            setActiveFileId(null);
            setCurrentFileName('');
            setIsLoading(false);
            return;
          }
          
          // Fetch employees for this file
          const employees = await getProcessedEmployees(storedFileId);
          
          if (employees && employees.length > 0) {
            setActiveFileId(storedFileId);
            setEmployeeRecords(employees);
            setHasUploadedFile(true);
            setTotalEmployees(employees.length);
            setTotalDays(employees.reduce((sum, emp) => sum + emp.days.length, 0));
            
            // Try to get file name from localStorage if available
            const storedFileName = localStorage.getItem('currentFileName');
            if (storedFileName) {
              setCurrentFileName(storedFileName);
            }
            
            setIsLoading(false);
            return;
          } else {
            // If no employees found for this file, clear localStorage and reset state
            localStorage.removeItem('activeFileId');
            localStorage.removeItem('currentFileName');
            setActiveFileId(null);
            setCurrentFileName('');
            console.log('No employees found for stored file ID, resetting state');
          }
        }
        
        // If no active file ID in localStorage or no employees found,
        // try to fetch the most recently active file from Supabase
        const activeFile = await getActiveProcessedFile();
        
        if (activeFile) {
          setActiveFileId(activeFile.fileId);
          setCurrentFileName(activeFile.fileName);
          setTotalEmployees(activeFile.totalEmployees);
          setTotalDays(activeFile.totalDays);
          
          // Store the active file ID in localStorage for future reference
          localStorage.setItem('activeFileId', activeFile.fileId);
          localStorage.setItem('currentFileName', activeFile.fileName);
          
          // Fetch employees for this file
          const employees = await getProcessedEmployees(activeFile.fileId);
          
          if (employees && employees.length > 0) {
            setEmployeeRecords(employees);
            setHasUploadedFile(true);
          }
        }
        
        setIsLoading(false);
      } catch (error) {
        console.error('Error loading active file data:', error);
        setIsLoading(false);
      }
    };
    
    loadActiveFileData();
  }, []);
  
  // Save to localStorage when activeFileId changes
  useEffect(() => {
    if (activeFileId) {
      localStorage.setItem('activeFileId', activeFileId);
    }
  }, [activeFileId]);

  // Save to localStorage when currentFileName changes
  useEffect(() => {
    if (currentFileName) {
      localStorage.setItem('currentFileName', currentFileName);
    }
  }, [currentFileName]);

  // Update in Supabase whenever employee records change (if we have an active file)
  useEffect(() => {
    const updateSupabaseData = async () => {
      if (activeFileId && employeeRecords.length > 0 && hasUploadedFile) {
        // Skip updating Supabase if we're still loading initial data
        if (isLoading) return;
        
        try {
          const result = await updateInSupabase(employeeRecords);
          
          // If the update resulted in a new file ID, update our state
          if (result && activeFileId !== localStorage.getItem('activeFileId')) {
            const newFileId = localStorage.getItem('activeFileId');
            if (newFileId) {
              setActiveFileId(newFileId);
            }
          }
        } catch (error) {
          console.error('Error in auto-update to Supabase:', error);
          // Continue without crashing the app
        }
      }
    };
    
    // Debounce updates to avoid excessive API calls
    const timeoutId = setTimeout(updateSupabaseData, 2000);
    return () => clearTimeout(timeoutId);
  }, [employeeRecords, activeFileId, hasUploadedFile, isLoading]);

  // Save processed data to Supabase
  const saveToSupabase = async (fileName: string, records: EmployeeRecord[]): Promise<boolean> => {
    try {
      if (!fileName || !records || records.length === 0) {
        console.error('Invalid data for saveToSupabase - fileName or records missing');
        return false;
      }
      
      const fileId = await saveProcessedExcelFile(fileName, records);
      
      if (fileId) {
        setActiveFileId(fileId);
        return true;
      } else {
        console.error('Failed to save to Supabase - no file ID returned');
        return false;
      }
    } catch (error) {
      console.error('Error saving to Supabase:', error);
      return false;
    }
  };
  
  // Update existing data in Supabase
  const updateInSupabase = async (records: EmployeeRecord[]): Promise<boolean> => {
    if (!activeFileId) {
      console.error('Cannot update in Supabase - no active file ID');
      return false;
    }
    
    try {
      // Ensure currentFileName is not empty
      const effectiveFileName = currentFileName || 'Untitled File';
      
      const result = await updateProcessedEmployeeData(activeFileId, records, effectiveFileName);
      
      if (!result.success) {
        console.error('Update to Supabase failed');
        return false;
      }
      
      if (result.fileId && result.fileId !== activeFileId) {
        // If a new file was created, update the activeFileId
        setActiveFileId(result.fileId);
        localStorage.setItem('activeFileId', result.fileId);
      }
      
      return true;
    } catch (error) {
      console.error('Error updating in Supabase:', error);
      return false;
    }
  };

  // Function to clear all data
  const clearData = async () => {
    try {
      // Clear data from Supabase if we have an active file
      if (activeFileId) {
        await deleteProcessedExcelData(activeFileId);
      }
      
      // Reset all state variables
      setEmployeeRecords([]);
      setHasUploadedFile(false);
      setCurrentFileName('');
      setTotalEmployees(0);
      setTotalDays(0);
      setActiveFileId(null);
      
      // Clear localStorage
      localStorage.removeItem('activeFileId');
      localStorage.removeItem('currentFileName');
    } catch (error) {
      console.error('Error clearing data:', error);
    }
  };

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
        activeFileId,
        setActiveFileId,
        isLoading,
        saveToSupabase,
        updateInSupabase,
        clearData
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