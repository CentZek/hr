import React from 'react';
import { TabProps } from '../types';

const Tab: React.FC<TabProps> = ({ icon, label, active, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-4 py-3 ${
        active 
          ? 'text-purple-700 border-b-2 border-purple-600 font-semibold' 
          : 'text-gray-600 hover:text-gray-800 font-medium'
      }`}
    >
      {icon}
      <span className="text-base">{label}</span>
    </button>
  );
};

export default Tab;