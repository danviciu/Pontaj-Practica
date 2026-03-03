import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';

const handleError = (error) => {
    console.error('API Error:', error);
    const errorMessage = error?.response?.data?.message || error?.message || 'A apărut o eroare la comunicarea cu serverul.';

    toast({
        variant: "destructive",
        title: "Eroare API",
        description: errorMessage,
    });
};

export const queryClientInstance = new QueryClient({
    queryCache: new QueryCache({
        onError: handleError,
    }),
    mutationCache: new MutationCache({
        onError: handleError,
    }),
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});
