import React, { createContext, useContext, useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(true);
    const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
    const [authError, setAuthError] = useState(null);
    const [appPublicSettings, setAppPublicSettings] = useState(null);

    useEffect(() => {
        checkAppState();
    }, []);

    const checkAppState = async () => {
        setAuthError(null);
        setIsLoadingPublicSettings(true);

        setAppPublicSettings({
            id: appParams.appId || 'local-app',
            public_settings: {},
        });
        setIsLoadingPublicSettings(false);

        await checkUserAuth();
    };

    const checkUserAuth = async () => {
        try {
            setIsLoadingAuth(true);
            const currentUser = await base44.auth.me();
            setUser(currentUser);
            setIsAuthenticated(true);
        } catch (error) {
            setUser(null);
            setIsAuthenticated(false);

            if (error?.status === 401 || error?.status === 403) {
                setAuthError({
                    type: 'auth_required',
                    message: 'Authentication required',
                });
            } else {
                setAuthError({
                    type: 'unknown',
                    message: error?.message || 'Failed to initialize app state.',
                });
            }
        } finally {
            setIsLoadingAuth(false);
        }
    };

    const logout = (shouldRedirect = true) => {
        setUser(null);
        setIsAuthenticated(false);
        if (shouldRedirect) {
            base44.auth.logout(window.location.href);
        } else {
            base44.auth.logout(false);
        }
    };

    const navigateToLogin = () => {
        base44.auth.redirectToLogin(window.location.href);
    };

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated,
            isLoadingAuth,
            isLoadingPublicSettings,
            authError,
            appPublicSettings,
            logout,
            navigateToLogin,
            checkAppState,
        }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
