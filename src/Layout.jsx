import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import { base44 } from '@/api/base44Client';
import {
    LayoutDashboard, Home, Calendar, KeyRound, Shield, ChevronDown, Users, UserCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

const ADMIN_NAV_ITEMS = [
    { type: 'link', name: 'Dashboard', path: 'AdminDashboard', icon: LayoutDashboard },
    {
        type: 'group',
        id: 'practica',
        name: 'Practica',
        icon: Calendar,
        links: [
            { name: 'Clase si planuri', path: 'ClassManagement' },
            { name: 'Toti elevii', path: 'StudentsManagement' },
            { name: 'Programe', path: 'PracticeSchedulesManagement' },
        ],
    },
    {
        type: 'group',
        id: 'organizatie',
        name: 'Organizatie',
        icon: Shield,
        links: [
            { name: 'Administratori', path: 'AdminsManagement' },
            { name: 'Operatori', path: 'OperatorsManagement' },
        ],
    },
];

const STUDENT_NAV_ITEMS = [{ type: 'link', name: 'Acasa', path: 'StudentHome', icon: Home }];

// Primary destinations for the mobile bottom tab bar (admin only). Kept
// short on purpose: this is the day-to-day scope for someone checking
// attendance between classes, not the full system-admin surface — Organizatie
// (Administratori/Operatori) lives in the "Profil" drawer instead, alongside
// account actions, since it isn't a daily-use screen.
const ADMIN_BOTTOM_TABS = [
    { name: 'Azi', path: 'AdminDashboard', icon: LayoutDashboard },
    { name: 'Clase', path: 'ClassManagement', icon: Users },
    { name: 'Programe', path: 'PracticeSchedulesManagement', icon: Calendar },
];

const ORGANIZATION_LINKS = [
    { name: 'Administratori', path: 'AdminsManagement', icon: Shield },
    { name: 'Operatori', path: 'OperatorsManagement', icon: Users },
];

export default function Layout({ children, currentPageName }) {
    const [user, setUser] = useState(null);
    const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
    const [openGroups, setOpenGroups] = useState({
        practica: true,
        organizatie: true,
    });
    const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
    const [passwordForm, setPasswordForm] = useState({
        oldPassword: '',
        newPassword: '',
        confirmPassword: '',
    });

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
    const links = isAdmin ? ADMIN_NAV_ITEMS : STUDENT_NAV_ITEMS;

    useEffect(() => {
        if (!isAdmin) return;

        const activeGroup = ADMIN_NAV_ITEMS.find((item) => (
            item.type === 'group' && item.links.some((entry) => entry.path === currentPageName)
        ));
        if (!activeGroup) return;

        setOpenGroups((prev) => ({
            ...prev,
            [activeGroup.id]: true,
        }));
    }, [isAdmin, currentPageName]);

    function toggleGroup(groupId) {
        setOpenGroups((prev) => ({
            ...prev,
            [groupId]: !prev[groupId],
        }));
    }

    function closePasswordDialog() {
        setPasswordDialogOpen(false);
        setPasswordForm({
            oldPassword: '',
            newPassword: '',
            confirmPassword: '',
        });
        setIsUpdatingPassword(false);
    }

    async function handleChangePassword() {
        if (!passwordForm.oldPassword || !passwordForm.newPassword) {
            toast({
                title: 'Date incomplete',
                description: 'Completeaza parola curenta si parola noua.',
                variant: 'destructive',
            });
            return;
        }

        if (passwordForm.newPassword.length < 8) {
            toast({
                title: 'Parola prea scurta',
                description: 'Parola noua trebuie sa aiba cel putin 8 caractere.',
                variant: 'destructive',
            });
            return;
        }

        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            toast({
                title: 'Parole diferite',
                description: 'Confirmarea parolei noi nu corespunde.',
                variant: 'destructive',
            });
            return;
        }

        setIsUpdatingPassword(true);
        try {
            await base44.auth.changePassword({
                oldPassword: passwordForm.oldPassword,
                newPassword: passwordForm.newPassword,
            });
            toast({
                title: 'Parola actualizata',
                description: 'Parola a fost schimbata cu succes.',
            });
            closePasswordDialog();
        } catch (error) {
            toast({
                title: 'Nu am putut schimba parola',
                description: error?.message || 'A aparut o eroare la schimbarea parolei.',
                variant: 'destructive',
            });
            setIsUpdatingPassword(false);
        }
    }

    function renderMenuItem(item, { mobile = false } = {}) {
        if (item.type !== 'group') {
            const Icon = item.icon;
            const isActive = currentPageName === item.path;

            return (
                <li key={item.path}>
                    <Link
                        to={createPageUrl(item.path)}
                        onClick={mobile ? () => setMobileMenuOpen(false) : undefined}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                            ? 'bg-blue-50 text-blue-600 font-semibold'
                            : 'text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <Icon className="h-5 w-5" />
                        <span>{item.name}</span>
                    </Link>
                </li>
            );
        }

        const Icon = item.icon;
        const isOpen = Boolean(openGroups[item.id]);
        const hasActiveChild = item.links.some((entry) => entry.path === currentPageName);

        return (
            <li key={item.id} className="space-y-1">
                <button
                    type="button"
                    onClick={() => toggleGroup(item.id)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-colors ${hasActiveChild
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <span className="flex items-center gap-3">
                        <Icon className="h-5 w-5" />
                        <span className="font-medium">{item.name}</span>
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <ul className="space-y-1 pl-6">
                        {item.links.map((entry) => {
                            const isActiveChild = currentPageName === entry.path;
                            return (
                                <li key={entry.path}>
                                    <Link
                                        to={createPageUrl(entry.path)}
                                        onClick={mobile ? () => setMobileMenuOpen(false) : undefined}
                                        className={`block px-4 py-2 rounded-md text-sm transition-colors ${isActiveChild
                                            ? 'bg-blue-100 text-blue-700 font-semibold'
                                            : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        {entry.name}
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </li>
        );
    }

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
                    onClick={() => setProfileDrawerOpen(true)}
                    aria-label="Profil"
                >
                    {user?.full_name ? (
                        <span className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 font-semibold text-sm">
                            {user.full_name[0]}
                        </span>
                    ) : (
                        <UserCircle className="h-6 w-6" />
                    )}
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
                        {links.map((link) => renderMenuItem(link))}
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
                            className="w-full mb-2"
                            onClick={() => setPasswordDialogOpen(true)}
                        >
                            <KeyRound className="h-4 w-4 mr-2" />
                            Schimba parola
                        </Button>
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

            {/* Mobile bottom tab bar — primary nav for the day-to-day admin scope */}
            {isAdmin && (
                <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-50 flex pb-[env(safe-area-inset-bottom)]">
                    {ADMIN_BOTTOM_TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = currentPageName === tab.path;
                        return (
                            <Link
                                key={tab.path}
                                to={createPageUrl(tab.path)}
                                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${isActive ? 'text-blue-600' : 'text-gray-500'
                                    }`}
                            >
                                <Icon className="h-5 w-5" />
                                {tab.name}
                            </Link>
                        );
                    })}
                    <button
                        type="button"
                        onClick={() => setProfileDrawerOpen(true)}
                        className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${profileDrawerOpen
                            || ['AdminsManagement', 'OperatorsManagement', 'StudentsManagement'].includes(currentPageName)
                            ? 'text-blue-600'
                            : 'text-gray-500'
                            }`}
                    >
                        <UserCircle className="h-5 w-5" />
                        Profil
                    </button>
                </nav>
            )}

            {/* Main Content */}
            <div className={`md:ml-64 pt-16 md:pt-0 ${isAdmin ? 'pb-20 md:pb-0' : ''}`}>
                {children}
            </div>

            {/* Profile drawer (mobile): account actions + the system-admin
                screens that don't need a permanent slot in the bottom bar. */}
            <Drawer open={profileDrawerOpen} onOpenChange={setProfileDrawerOpen}>
                <DrawerContent>
                    <DrawerHeader>
                        <DrawerTitle>{user?.full_name || 'Profil'}</DrawerTitle>
                        <DrawerDescription>{user?.email}</DrawerDescription>
                    </DrawerHeader>

                    <div className="px-4 pb-2 space-y-1">
                        {isAdmin && (
                            <>
                                <Link
                                    to={createPageUrl('StudentsManagement')}
                                    onClick={() => setProfileDrawerOpen(false)}
                                    className="flex items-center gap-3 px-3 py-3 rounded-lg text-gray-700 hover:bg-gray-50"
                                >
                                    <Users className="h-5 w-5" />
                                    Toti elevii
                                </Link>
                                <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    Organizatie
                                </p>
                                {ORGANIZATION_LINKS.map((link) => {
                                    const Icon = link.icon;
                                    return (
                                        <Link
                                            key={link.path}
                                            to={createPageUrl(link.path)}
                                            onClick={() => setProfileDrawerOpen(false)}
                                            className="flex items-center gap-3 px-3 py-3 rounded-lg text-gray-700 hover:bg-gray-50"
                                        >
                                            <Icon className="h-5 w-5" />
                                            {link.name}
                                        </Link>
                                    );
                                })}
                                <div className="border-t my-2" />
                            </>
                        )}
                    </div>

                    <DrawerFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setProfileDrawerOpen(false);
                                setPasswordDialogOpen(true);
                            }}
                        >
                            <KeyRound className="h-4 w-4 mr-2" />
                            Schimba parola
                        </Button>
                        <Button variant="outline" onClick={() => base44.auth.logout()}>
                            Deconectare
                        </Button>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>

            <Dialog open={passwordDialogOpen} onOpenChange={(open) => (open ? setPasswordDialogOpen(true) : closePasswordDialog())}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Schimba parola</DialogTitle>
                        <DialogDescription>
                            Aceasta modificare se aplica pentru contul conectat ({user?.email || 'utilizator curent'}).
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="currentPassword">Parola curenta</Label>
                            <Input
                                id="currentPassword"
                                type="password"
                                value={passwordForm.oldPassword}
                                onChange={(event) => setPasswordForm((prev) => ({ ...prev, oldPassword: event.target.value }))}
                                autoComplete="current-password"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="newPassword">Parola noua</Label>
                            <Input
                                id="newPassword"
                                type="password"
                                value={passwordForm.newPassword}
                                onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                                autoComplete="new-password"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="confirmNewPassword">Confirma parola noua</Label>
                            <Input
                                id="confirmNewPassword"
                                type="password"
                                value={passwordForm.confirmPassword}
                                onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                                autoComplete="new-password"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closePasswordDialog} disabled={isUpdatingPassword}>
                            Renunta
                        </Button>
                        <Button onClick={handleChangePassword} disabled={isUpdatingPassword}>
                            {isUpdatingPassword ? 'Se actualizeaza...' : 'Salveaza parola'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
