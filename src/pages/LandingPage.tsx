import React from 'react';
import { Link } from 'react-router-dom';
import { Users, FileText, DollarSign, User } from 'lucide-react';
import AnimatedClock from '../components/AnimatedClock';

const LandingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#e6eaff] flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-4xl">
        {/* Header Section */}
        <div className="flex flex-col items-center mb-10">
          <div className="mb-6">
            <AnimatedClock />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2 text-center">Employee Work Hour Tracker</h1>
          <p className="text-base text-gray-700 font-medium text-center">Select your role to continue to the platform</p>
        </div>

        {/* Main Card Layout */}
        <div className="space-y-6">
          {/* Employee Card - Full width, yellow */}
          <Link to="/login" className="block bg-gradient-to-b from-[#ffc107] to-[#e8a200] rounded-lg shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg w-full">
            <div className="p-8 flex flex-col items-center text-center text-white">
              <div className="w-14 h-14 rounded-full bg-white bg-opacity-20 flex items-center justify-center mb-4">
                <User className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-2">Employee</h2>
              <p className="text-base sm:text-lg font-medium">Track your work hours and shifts</p>
            </div>
          </Link>
          
          {/* Three cards in a row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Operational Manager Card */}
            <div className="bg-gradient-to-b from-[#1a237e] to-[#0d1452] rounded-lg shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">
              <div className="p-6 flex flex-col items-center text-center text-white">
                <div className="w-12 h-12 rounded-full bg-white bg-opacity-20 flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-xl font-bold mb-2">Operational Manager</h2>
                <p className="text-base font-medium">View operational schedules</p>
              </div>
            </div>

            {/* HR Card with link to app */}
            <Link to="/hr" className="bg-gradient-to-b from-[#1a237e] to-[#0d1452] rounded-lg shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">
              <div className="p-6 flex flex-col items-center text-center text-white">
                <div className="w-12 h-12 rounded-full bg-white bg-opacity-20 flex items-center justify-center mb-4">
                  <FileText className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-xl font-bold mb-2">HR</h2>
                <p className="text-base font-medium">Manage Face ID data and system settings</p>
              </div>
            </Link>

            {/* Accountant Card */}
            <div className="bg-gradient-to-b from-[#1a237e] to-[#0d1452] rounded-lg shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">
              <div className="p-6 flex flex-col items-center text-center text-white">
                <div className="w-12 h-12 rounded-full bg-white bg-opacity-20 flex items-center justify-center mb-4">
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-xl font-bold mb-2">Accountant</h2>
                <p className="text-base font-medium">Manage salaries and generate payslips</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-gray-600 font-medium mt-10">
          © 2025 Employee Work Hour Tracker. All rights reserved.
        </div>
      </div>
    </div>
  );
};

export default LandingPage;