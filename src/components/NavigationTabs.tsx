import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileSpreadsheet, Clock, Home, Menu, X, LogOut, Users, Briefcase } from 'lucide-react';
import Tab from './Tab';
import { useHrAuth } from '../context/HrAuthContext';

const NavigationTabs: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const { isAuthenticated, logout, username } = useHrAuth();

  useEffect(() => {
    const checkIfMobile = () => setIsMobile(window.innerWidth < 640);
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => window.removeEventListener('resize', checkIfMobile);
  }, []);
  
  const handleLogout = () => {
    logout();
    navigate('/', { replace: true });
  };

  // Determine which routes to show based on path/role
  const isOperationalManager = currentPath === '/operational-manager';
  
  // Define routes for each role
  const hrRoutes = [
    { path: '/', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { path: '/hr', label: 'Face ID Data', icon: <FileSpreadsheet className="w-5 h-5" /> },
    { path: '/approved-hours', label: 'Approved Hours', icon: <Clock className="w-5 h-5" /> }
  ];
  
  const operationalManagerRoutes = [
    { path: '/', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { path: '/operational-manager', label: 'Leave Management', icon: <Briefcase className="w-5 h-5" /> }
  ];

  // Choose which routes to display based on current path/role
  const routes = isOperationalManager ? operationalManagerRoutes : hrRoutes;
  
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
                {(currentPath === '/approved-hours' || currentPath === '/approved/approved-hours') && 'Approved Hours'}
                {currentPath === '/login' && 'Login'}
                {currentPath === '/employee' && 'Dashboard'}
                {currentPath === '/hr-login' && 'HR Login'}
                {currentPath === '/operational-manager' && 'Leave Management'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isAuthenticated && (
                <button 
                  onClick={handleLogout}
                  className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full flex items-center"
                >
                  <LogOut className="w-3 h-3 mr-1" />
                  Logout
                </button>
              )}
              <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-gray-500 hover:text-gray-700 p-2">
                {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
          
          {isMobileMenuOpen && (
            <div className="py-2 space-y-1 border-t border-gray-200 mb-2">
              {routes.map((route) => (
                <button 
                  key={route.path}
                  onClick={() => {
                    navigate(route.path);
                    setIsMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center px-4 py-3 text-sm ${
                    currentPath === route.path || 
                    (currentPath === '/approved/approved-hours' && route.path === '/approved-hours')
                      ? 'text-purple-600 font-medium bg-purple-50' 
                      : 'text-gray-600 hover:bg-gray-50'
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
        <div className="flex items-center justify-between">
          <div className="flex">
            {routes.map(route => (
              <Tab 
                key={route.path}
                icon={route.icon} 
                label={route.label} 
                active={
                  currentPath === route.path || 
                  (currentPath === '/approved/approved-hours' && route.path === '/approved-hours')
                } 
                onClick={() => navigate(route.path)} 
              />
            ))}
          </div>
          
          {isAuthenticated && (
            <div className="flex items-center gap-3 py-2">
              <div className="text-sm text-purple-600">
                Logged in as <span className="font-medium">{username}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="flex items-center text-red-600 hover:text-red-800 text-sm"
              >
                <LogOut className="w-4 h-4 mr-1" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NavigationTabs;