import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileSpreadsheet, Clock, Home, Menu, X } from 'lucide-react';
import Tab from './Tab';

const NavigationTabs: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIfMobile = () => setIsMobile(window.innerWidth < 640);
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);

  const routes = [
    { path: '/', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { path: '/hr', label: 'Face ID Data', icon: <FileSpreadsheet className="w-5 h-5" /> },
    { path: '/approved-hours', label: 'Approved Hours', icon: <Clock className="w-5 h-5" /> }
  ];
  
  if (isMobile) {
    return (
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <div className="flex items-center">
              {routes.find(r => r.path === currentPath)?.icon || <Home className="w-5 h-5 text-purple-600 mr-1.5" />}
              <span className="font-medium text-gray-800">
                {currentPath === '/' && 'Home'}
                {currentPath === '/hr' && 'Face ID Data'}
                {currentPath === '/approved-hours' && 'Approved Hours'}
                {currentPath === '/login' && 'Login'}
                {currentPath === '/employee' && 'Dashboard'}
              </span>
            </div>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-gray-500 hover:text-gray-700 p-2">
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
          
          {isMobileMenuOpen && (
            <div className="py-2 space-y-1 border-t border-gray-200 mb-2">
              {routes.map(route => (
                <button 
                  key={route.path}
                  onClick={() => {
                    navigate(route.path);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center px-4 py-3 text-sm ${
                    currentPath === route.path ? 'text-purple-600 font-medium bg-purple-50' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {React.cloneElement(route.icon, { className: "w-5 h-5 mr-3" })}
                  {route.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex">
          {routes.map(route => (
            <Tab 
              key={route.path}
              icon={route.icon} 
              label={route.label} 
              active={currentPath === route.path} 
              onClick={() => navigate(route.path)} 
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default NavigationTabs;