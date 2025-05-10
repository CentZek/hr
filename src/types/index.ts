// Type definitions for the application
export interface TimeRecord {
  department: string;
  name: string;
  employeeNumber: string;
  timestamp: Date;
  status: 'check_in' | 'check_out';
  originalIndex?: number;       // Track the original position in the file
  originalStatus?: string;      // Track the original status before correction
  mislabeled?: boolean;         // Flag to indicate if this record was corrected
  notes?: string;               // Additional notes about corrections
  shift_type?: string;          // Store the shift type directly on the record
  processed?: boolean;          // Flag to mark records already processed
  isCrossDay?: boolean;         // Flag to indicate this record is part of a cross-day shift
  fromPrevDay?: boolean;        // Flag for records that belong to the previous day's shift
  prevDayDate?: string;         // The date of the previous day for cross-day shifts
}

export interface DailyRecord {
  date: string;
  firstCheckIn: Date | null;
  lastCheckOut: Date | null;
  hoursWorked: number;
  approved: boolean;
  shiftType: 'morning' | 'evening' | 'night' | 'canteen' | 'custom' | null;
  notes: string;
  missingCheckIn: boolean;
  missingCheckOut: boolean;
  isLate: boolean;
  earlyLeave: boolean;
  excessiveOvertime: boolean;
  penaltyMinutes: number; // Minutes to deduct from total hours
  customShift?: {
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
  };
  correctedRecords?: boolean; // Flag to indicate if original C/In or C/Out was corrected
  
  // New fields to store raw time records
  allTimeRecords?: TimeRecord[]; // All raw time records for this date
  hasMultipleRecords?: boolean;  // Flag indicating there are multiple records for this day
  showRawData?: boolean;         // UI state for whether to show expanded raw data
  isCrossDay?: boolean;          // Flag to indicate this date has cross-day shift
  checkOutNextDay?: boolean;     // Flag to indicate checkout is on next day
  
  // Display values for check-in/check-out times (for consistent display)
  displayCheckIn?: string;
  displayCheckOut?: string;
}

export interface EmployeeRecord {
  employeeNumber: string;
  name: string;
  department: string;
  days: DailyRecord[];
  totalDays: number;
  expanded: boolean;
}

export interface TabProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

// Shift schedule definitions
export const SHIFT_TIMES = {
  morning: {
    start: {
      hour: 5,
      minute: 0
    },
    end: {
      hour: 14,
      minute: 0
    },
    earlyLeaveTime: {
      hour: 13,
      minute: 30
    }
  },
  evening: {
    start: {
      hour: 13,
      minute: 0
    },
    end: {
      hour: 22,
      minute: 0
    },
    earlyLeaveTime: {
      hour: 21,
      minute: 30
    }
  },
  night: {
    start: {
      hour: 21, // Changed from 20 to 21 (9:00 PM)
      minute: 0
    },
    end: {
      hour: 6,
      minute: 0
    },
    earlyLeaveTime: {
      hour: 5,
      minute: 30
    }
  },
  canteen: {
    start: {
      hour: 7, // Changed from 8 to 7 as we now use canteen for both 7AM and 8AM shifts
      minute: 0
    },
    end: {
      hour: 16, // Changed from 17 to 16 to match 7AM start
      minute: 0
    },
    earlyLeaveTime: {
      hour: 15, // Changed from 16:30 to 15:30 to match 7AM start
      minute: 30
    }
  },
  custom: {
    start: {
      hour: 0,
      minute: 0
    },
    end: {
      hour: 0,
      minute: 0
    },
    earlyLeaveTime: {
      hour: 0,
      minute: 0
    }
  }
};

// Penalty options for the UI
export const PENALTY_OPTIONS = [
  { label: 'No Penalty', minutes: 0 },
  { label: '15 Minutes', minutes: 15 },
  { label: '30 Minutes', minutes: 30 },
  { label: '1 Hour', minutes: 60 },
  { label: '2 Hours', minutes: 120 },
  { label: 'Half Day (4 Hours)', minutes: 240 },
  { label: 'Full Day (9 Hours)', minutes: 540 }
];

// Human-readable time formats for display
export const DISPLAY_SHIFT_TIMES = {
  morning: {
    startTime: '05:00',
    endTime: '14:00',
    earlyLeave: '13:30'
  },
  evening: {
    startTime: '13:00',
    endTime: '22:00',
    earlyLeave: '21:30'
  },
  night: {
    startTime: '21:00', // Changed from 8:00 PM to 9:00 PM
    endTime: '06:00',
    earlyLeave: '05:30'
  },
  canteen: {
    startTime: '07:00', // Display time is 7AM for canteen
    endTime: '16:00',   // Display time is 4PM for canteen
    earlyLeave: '15:30' // Early leave from 3:30PM
  },
  custom: {
    startTime: 'Custom',
    endTime: 'Custom',
    earlyLeave: 'Custom'
  }
};

// Tolerance in minutes before someone is considered late
export const LATE_TOLERANCE_MINUTES = 15;

// Late threshold for shifts (in minutes past start time)
export const LATE_THRESHOLDS = {
  morning: 0, // Any time after 5:00 AM
  evening: 0, // Any time after 1:00 PM
  night: 30,  // 30 minutes after 9:00 PM (9:30 PM)
  canteen: 10, // 10 minutes after 7:00 AM or 8:00 AM start time
  custom: 15  // 15 minutes after custom start time
};

// Canteen shift types
export const CANTEEN_SHIFT_HOURS = {
  early: { // 7AM start (previously "office")
    start: {
      hour: 7,
      minute: 0
    },
    end: {
      hour: 16,
      minute: 0
    },
    earlyLeaveTime: {
      hour: 15,
      minute: 30
    }
  },
  late: { // 8AM start (previously "canteen")
    start: {
      hour: 8,
      minute: 0
    },
    end: {
      hour: 17,
      minute: 0
    },
    earlyLeaveTime: {
      hour: 16,
      minute: 30
    }
  }
};