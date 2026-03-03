/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import React from 'react';

const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const ClassPracticePlansManagement = React.lazy(() => import('./pages/ClassPracticePlansManagement'));
const OnboardingSetup = React.lazy(() => import('./pages/OnboardingSetup'));
const OperatorStudentsList = React.lazy(() => import('./pages/OperatorStudentsList'));
const OperatorsManagement = React.lazy(() => import('./pages/OperatorsManagement'));
const PracticePeriodsManagement = React.lazy(() => import('./pages/PracticePeriodsManagement'));
const PracticeSchedulesManagement = React.lazy(() => import('./pages/PracticeSchedulesManagement'));
const ScheduleManagement = React.lazy(() => import('./pages/ScheduleManagement'));
const StudentHome = React.lazy(() => import('./pages/StudentHome'));
const StudentsManagement = React.lazy(() => import('./pages/StudentsManagement'));
const ClassManagement = React.lazy(() => import('./pages/ClassManagement'));
const Login = React.lazy(() => import('./pages/Login'));
import __Layout from './Layout.jsx';


export const PAGES = {
    "AdminDashboard": AdminDashboard,
    "ClassPracticePlansManagement": ClassPracticePlansManagement,
    "OnboardingSetup": OnboardingSetup,
    "OperatorStudentsList": OperatorStudentsList,
    "OperatorsManagement": OperatorsManagement,
    "PracticePeriodsManagement": PracticePeriodsManagement,
    "PracticeSchedulesManagement": PracticeSchedulesManagement,
    "ScheduleManagement": ScheduleManagement,
    "StudentHome": StudentHome,
    "StudentsManagement": StudentsManagement,
    "ClassManagement": ClassManagement,
    "Login": Login,
}

export const pagesConfig = {
    mainPage: "StudentHome",
    Pages: PAGES,
    Layout: __Layout,
};
