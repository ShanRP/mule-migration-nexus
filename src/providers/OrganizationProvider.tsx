
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/components/AuthProvider';
import { toast } from 'sonner';

export interface OrganizationOption {
  id: string;
  name: string;
  initial: string;
  session_timeout?: string;
  invite_enabled?: boolean;
  github_url?: string | null;
  github_token?: string | null;
  azure_devops_url?: string | null;
  azure_devops_token?: string | null;
  repository_type: 'github' | 'azure_devops';
}

interface OrganizationContextType {
  organizations: OrganizationOption[];
  selectedOrganization: OrganizationOption | null;
  loading: boolean;
  error: string | null;
  createOrganization: (name: string) => Promise<OrganizationOption | null>;
  updateOrganization: (organizationId: string, updates: Partial<OrganizationOption>) => Promise<boolean>;
  deleteOrganization: (organizationId: string) => Promise<boolean>;
  selectOrganization: (organization: OrganizationOption) => void;
  refreshOrganizations: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

// Constants for caching
const ORGANIZATIONS_CACHE_KEY = 'MULE_USER_ORGANIZATIONS';
const SELECTED_ORGANIZATION_CACHE_KEY = 'MULE_SELECTED_ORGANIZATION_ID';
const CACHE_EXPIRY = 5 * 60 * 1000; // 5 minutes

export const OrganizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [selectedOrganization, setSelectedOrganization] = useState<OrganizationOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fetchInProgressRef = useRef(false);

  // Fetch organizations when user is available
  const fetchOrganizations = useCallback(async (forceRefresh = false) => {
    if (!user || fetchInProgressRef.current) return;
    
    fetchInProgressRef.current = true;
    setLoading(true);
    try {
      const cacheKey = `${ORGANIZATIONS_CACHE_KEY}_${user.id}`;
      const savedSelectedOrganizationId = localStorage.getItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`);
      
      // Check cache first if not forcing refresh
      if (!forceRefresh) {
        const cachedData = localStorage.getItem(cacheKey);
        if (cachedData) {
          try {
            const { data, timestamp } = JSON.parse(cachedData);
            if (Date.now() - timestamp < CACHE_EXPIRY) {
              setOrganizations(data);
              if (savedSelectedOrganizationId) {
                const savedOrganization = data.find(o => o.id === savedSelectedOrganizationId);
                if (savedOrganization) {
                  setSelectedOrganization(savedOrganization);
                } else if (data.length > 0) {
                  setSelectedOrganization(data[0]);
                  localStorage.setItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`, data[0].id);
                }
              } else if (!selectedOrganization && data.length > 0) {
                setSelectedOrganization(data[0]);
                localStorage.setItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`, data[0].id);
              }
              setIsInitialized(true);
              setLoading(false);
              fetchInProgressRef.current = false;
              return;
            }
          } catch (e) {
            console.error("Error parsing cached organizations:", e);
          }
        }
      }

      // Fetch from DB using the existing function
      const { data, error } = await supabase
        .rpc('get_user_organizations', { 
          user_id_param: user.id 
        });

      if (error) throw error;

      let formattedOrganizations = [];
      if (data && data.length > 0) {
        formattedOrganizations = data.map((organization: any) => ({
          id: organization.id,
          name: organization.name,
          initial: organization.initial,
          session_timeout: organization.session_timeout,
          invite_enabled: organization.invite_enabled,
          github_url: organization.github_url,
          github_token: organization.github_token,
          azure_devops_url: organization.azure_devops_url,
          azure_devops_token: organization.azure_devops_token,
          repository_type: (organization.repository_type === 'azure_devops' ? 'azure_devops' : 'github') as 'github' | 'azure_devops'
        }));
      } else {
        // Default organization should have been created by the trigger
        // But let's create one if it doesn't exist
        const { data: newOrganization, error: createError } = await supabase
          .from('organizations')
          .insert([
            {
              user_id: user.id,
              name: 'Default Organization',
              initial: 'D',
              session_timeout: '30 days',
              invite_enabled: false,
              github_url: null,
              github_token: null,
              azure_devops_url: null,
              azure_devops_token: null,
              repository_type: 'github'
            }
          ])
          .select()
          .single();

        if (createError) throw createError;

        formattedOrganizations = [{
          id: newOrganization.id,
          name: newOrganization.name,
          initial: newOrganization.initial,
          session_timeout: newOrganization.session_timeout,
          invite_enabled: newOrganization.invite_enabled,
          github_url: newOrganization.github_url,
          github_token: newOrganization.github_token,
          azure_devops_url: newOrganization.azure_devops_url,
          azure_devops_token: newOrganization.azure_devops_token,
          repository_type: (newOrganization.repository_type === 'azure_devops' ? 'azure_devops' : 'github') as 'github' | 'azure_devops'
        }];
      }

      // Cache the organizations data
      localStorage.setItem(cacheKey, JSON.stringify({
        data: formattedOrganizations,
        timestamp: Date.now()
      }));

      setOrganizations(formattedOrganizations);

      // Set selected organization
      if (savedSelectedOrganizationId) {
        const savedOrganization = formattedOrganizations.find(o => o.id === savedSelectedOrganizationId);
        if (savedOrganization) {
          setSelectedOrganization(savedOrganization);
        } else if (formattedOrganizations.length > 0) {
          setSelectedOrganization(formattedOrganizations[0]);
          localStorage.setItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`, formattedOrganizations[0].id);
        }
      } else if (!selectedOrganization && formattedOrganizations.length > 0) {
        setSelectedOrganization(formattedOrganizations[0]);
        localStorage.setItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`, formattedOrganizations[0].id);
      }
      
      setIsInitialized(true);
    } catch (error) {
      console.error('Error in fetchOrganizations:', error);
      setError('Failed to load organizations');
      toast.error('Failed to load organizations');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      fetchInProgressRef.current = false;
    }
  }, [user, selectedOrganization]);

  // Initial fetch when user is available
  useEffect(() => {
    if (user && !isInitialized) {
      fetchOrganizations();
    } else if (!user) {
      setOrganizations([]);
      setSelectedOrganization(null);
      setIsInitialized(false);
    }
  }, [user, isInitialized, fetchOrganizations]);

  const createOrganization = async (name: string) => {
    if (!user) return null;

    try {
      const initial = name.charAt(0).toUpperCase();

      const { data, error } = await supabase
        .from('organizations')
        .insert([
          { 
            user_id: user.id,
            name,
            initial,
            session_timeout: '30 days',
            invite_enabled: false,
            github_url: null,
            github_token: null,
            azure_devops_url: null,
            azure_devops_token: null,
            repository_type: 'github'
          }
        ])
        .select()
        .single();

      if (error) throw error;

      const newOrganization: OrganizationOption = {
        id: data.id,
        name: data.name,
        initial: data.initial,
        session_timeout: data.session_timeout,
        invite_enabled: data.invite_enabled,
        github_url: data.github_url,
        github_token: data.github_token,
        azure_devops_url: data.azure_devops_url,
        azure_devops_token: data.azure_devops_token,
        repository_type: (data.repository_type === 'azure_devops' ? 'azure_devops' : 'github') as 'github' | 'azure_devops'
      };

      // Update organizations array with new organization
      setOrganizations(prev => [...prev, newOrganization]);
      
      // Update cache
      const cacheKey = `${ORGANIZATIONS_CACHE_KEY}_${user.id}`;
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        try {
          const { data: cachedOrganizations } = JSON.parse(cachedData);
          localStorage.setItem(cacheKey, JSON.stringify({
            data: [...cachedOrganizations, newOrganization],
            timestamp: Date.now()
          }));
        } catch (e) {
          console.error("Error updating organization cache:", e);
        }
      }

      // Set as selected organization
      setSelectedOrganization(newOrganization);
      localStorage.setItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`, newOrganization.id);

      toast.success('Organization created successfully');
      return newOrganization;
    } catch (error) {
      console.error('Error creating organization:', error);
      toast.error('Failed to create organization');
      return null;
    }
  };

  const updateOrganization = async (organizationId: string, updates: Partial<OrganizationOption>) => {
    if (!user) return false;

    try {
      const { error } = await supabase
        .from('organizations')
        .update(updates)
        .eq('id', organizationId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Update local state
      const updatedOrganizations = organizations.map(o => 
        o.id === organizationId ? { ...o, ...updates } : o
      );
      
      setOrganizations(updatedOrganizations);
      
      // Update cache
      const cacheKey = `${ORGANIZATIONS_CACHE_KEY}_${user.id}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        data: updatedOrganizations,
        timestamp: Date.now()
      }));

      // Update selected organization if it's the one being updated
      if (selectedOrganization?.id === organizationId) {
        setSelectedOrganization({ ...selectedOrganization, ...updates });
      }

      toast.success('Organization updated successfully');
      return true;
    } catch (error) {
      console.error('Error updating organization:', error);
      toast.error('Failed to update organization');
      return false;
    }
  };

  const deleteOrganization = async (organizationId: string) => {
    if (!user) return false;

    try {
      // Don't allow deletion if it's the only organization
      if (organizations.length <= 1) {
        toast.error('Cannot delete the only organization. Please create another organization first.');
        return false;
      }

      const { error } = await supabase
        .from('organizations')
        .delete()
        .eq('id', organizationId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Update the organizations list
      const updatedOrganizations = organizations.filter(o => o.id !== organizationId);
      setOrganizations(updatedOrganizations);
      
      // Update cache
      const cacheKey = `${ORGANIZATIONS_CACHE_KEY}_${user.id}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        data: updatedOrganizations,
        timestamp: Date.now()
      }));

      // If the deleted organization was selected, select another one
      if (selectedOrganization?.id === organizationId) {
        const newSelectedOrganization = updatedOrganizations[0];
        setSelectedOrganization(newSelectedOrganization);
        localStorage.setItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`, newSelectedOrganization.id);
      }

      toast.success('Organization deleted successfully');
      return true;
    } catch (error) {
      console.error('Error deleting organization:', error);
      toast.error('Failed to delete organization');
      return false;
    }
  };

  const refreshOrganizations = async () => {
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    await fetchOrganizations(true);
  };

  const selectOrganization = (organization: OrganizationOption) => {
    if (selectedOrganization?.id !== organization.id) {
      setSelectedOrganization(organization);
      if (user) {
        localStorage.setItem(`${SELECTED_ORGANIZATION_CACHE_KEY}_${user.id}`, organization.id);
      }
    }
  };

  // Set up realtime subscription for organization changes
  useEffect(() => {
    if (!user || !isInitialized) return;
    
    const organizationsChannel = supabase
      .channel('organization-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'organizations',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          console.log('Organization change detected:', payload);
          fetchOrganizations(true);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to organization changes');
        }
      });
      
    return () => {
      console.log('Cleaning up organization subscription');
      supabase.removeChannel(organizationsChannel);
    };
  }, [user?.id, isInitialized, fetchOrganizations]);

  return (
    <OrganizationContext.Provider
      value={{
        organizations,
        selectedOrganization,
        loading,
        error,
        createOrganization,
        updateOrganization,
        deleteOrganization,
        selectOrganization,
        refreshOrganizations
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
};

export const useOrganizations = () => {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganizations must be used within an OrganizationProvider');
  }
  return context;
};
