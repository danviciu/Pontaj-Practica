import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import { LayoutDashboard, Building2, Users, Home, Menu, X, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Layout({ children, currentPageName }) {
    const [user, setUser] = useState(null);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        async function loadUser() {
            try {
                const currentUser = await base44.auth.me();
                setUser(currentUser);
            } catch (error) {
                setUser(null);
            }
        }
        loadUser();
    }, []);

    const isAdmin = user?.role === 'admin';

    const adminLinks = [
        { name: 'Dashboard', path: 'AdminDashboard', icon: LayoutDashboard },
        { name: 'Operatori', path: 'OperatorsManagement', icon: Building2 },
        { name: 'Gestionare Clase', path: 'ClassManagement', icon: Users },
        { name: 'Toți Elevii', path: 'StudentsManagement', icon: Users },
        { name: 'Programe Practică', path: 'PracticeSchedulesManagement', icon: Calendar },
    ];

    const studentLinks = [{ name: 'Acasă', path: 'StudentHome', icon: Home }];

    const links = isAdmin ? adminLinks : studentLinks;

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Mobile Header */}
            <div className="md:hidden fixed top-0 left-0 right-0 bg-white border-b z-50 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-sm">P</span>
                    </div>
                    <span className="font-bold text-gray-900">Pontaj Practica</span>
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                >
                    {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </Button>
            </div>

            {/* Desktop Sidebar */}
            <div className="hidden md:flex fixed top-0 left-0 bottom-0 w-64 bg-white border-r flex-col">
                <div className="p-6 border-b">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                            <span className="text-white font-bold">P</span>
                        </div>
                        <div>
                            <h1 className="font-bold text-gray-900">Pontaj Practica</h1>
                            <p className="text-xs text-gray-500">
                                {isAdmin ? 'Panou Admin' : 'Panou Elev'}
                            </p>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 p-4">
                    <ul className="space-y-2">
                        {links.map((link) => {
                            const Icon = link.icon;
                            const isActive = currentPageName === link.path;
                            return (
                                <li key={link.path}>
                                    <Link
                                        to={createPageUrl(link.path)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                                                ? 'bg-blue-50 text-blue-600 font-semibold'
                                                : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        <Icon className="h-5 w-5" />
                                        <span>{link.name}</span>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                {user && (
                    <div className="p-4 border-t">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                                <span className="text-gray-600 font-semibold text-sm">
                                    {user.full_name?.[0] || 'U'}
                                </span>
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-gray-900">{user.full_name}</p>
                                <p className="text-xs text-gray-500">{user.email}</p>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => base44.auth.logout()}
                            className="w-full"
                        >
                            Deconectare
                        </Button>
                    </div>
                )}
            </div>

            {/* Mobile Menu */}
            {mobileMenuOpen && (
                <div className="md:hidden fixed inset-0 bg-white z-40 pt-16">
                    <nav className="p-4">
                        <ul className="space-y-2">
                            {links.map((link) => {
                                const Icon = link.icon;
                                const isActive = currentPageName === link.path;
                                return (
                                    <li key={link.path}>
                                        <Link
                                            to={createPageUrl(link.path)}
                                            onClick={() => setMobileMenuOpen(false)}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                                                    ? 'bg-blue-50 text-blue-600 font-semibold'
                                                    : 'text-gray-600 hover:bg-gray-50'
                                                }`}
                                        >
                                            <Icon className="h-5 w-5" />
                                            <span>{link.name}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </nav>

                    {user && (
                        <div className="absolute bottom-0 left-0 right-0 p-4 border-t bg-white">
                            <div className="flex items-center gap-3 mb-3">
                                <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                                    <span className="text-gray-600 font-semibold text-sm">
                                        {user.full_name?.[0] || 'U'}
                                    </span>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-semibold text-gray-900">{user.full_name}</p>
                                    <p className="text-xs text-gray-500">{user.email}</p>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => base44.auth.logout()}
                                className="w-full"
                            >
                                Deconectare
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {/* Main Content */}
            <div className="md:ml-64 pt-16 md:pt-0">
                {children}
            </div>
        </div>
    );
}
