import React from 'react';
import { TabProps } from '../types';

const Tab: React.FC<TabProps> = ({ icon, label, active, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-4 py-3 ${
        active 
          ? 'text-purple-600 border-b-2 border-purple-600 font-medium' 
          : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};

export default Tab;